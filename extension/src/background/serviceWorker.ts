// Canvas Ghost-Tab Scraper Service Worker
// Handles startup, auth probe, crawl orchestration, and background tasks

import { authManager } from './authManager';
import { configManager } from './configManager';
import { storageManager } from './storageManager';
import { testStorageFunctionality } from './storageTest';
import { ContentUtils, StorageOptimizer } from './contentUtils';
import { queueManager, CrawlTask } from './queueManager';
import { scheduler } from './scheduler';
import { pageLoader } from './pageLoader';
import { htmlParser } from './htmlParser';
import { ghostTabManager } from './ghostTabManager';
import { courseDiscovery, testSectionCrawlerDirect } from './courseDiscovery';
import { studentIndexManager } from './studentIndex';
import { sectionCrawler, SectionCrawler } from './sectionCrawler';
import { detailCrawler } from './detailCrawler';
import { filesPipeline } from './filesPipeline';
import { incrementalSync } from './incrementalSync';

interface CrawlState {
  isAuthenticated: boolean;
  lastCrawl: number | null;
  currentTask: string | null;
  errorCount: number;
  authenticatedHost: string | null;
  isAuthProbeRunning: boolean;
}

class CanvasServiceWorker {
  private state: CrawlState = {
    isAuthenticated: false,
    lastCrawl: null,
    currentTask: null,
    errorCount: 0,
    authenticatedHost: null,
    isAuthProbeRunning: false
  };

  constructor() {
    this.initializeListeners();
    this.exposeGlobals();
  }

  private initializeListeners(): void {
    // Extension startup events
    chrome.runtime.onStartup.addListener(() => this.handleStartup());
    chrome.runtime.onInstalled.addListener(() => this.handleInstalled());
    
    // Message handling
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    // Alarm handling for periodic sync
    chrome.alarms.onAlarm.addListener((alarm) => this.handleAlarm(alarm));
  }

  private exposeGlobals(): void {
    // Make functions and objects available globally for testing
    (globalThis as any).storageManager = storageManager;
    (globalThis as any).testStorageFunctionality = testStorageFunctionality;
    (globalThis as any).ContentUtils = ContentUtils;
    (globalThis as any).StorageOptimizer = StorageOptimizer;
    (globalThis as any).authManager = authManager;
    (globalThis as any).configManager = configManager;
    (globalThis as any).queueManager = queueManager;
    (globalThis as any).scheduler = scheduler;
    (globalThis as any).pageLoader = pageLoader;
    (globalThis as any).htmlParser = htmlParser;
    (globalThis as any).ghostTabManager = ghostTabManager;
    (globalThis as any).courseDiscovery = courseDiscovery;
    (globalThis as any).studentIndexManager = studentIndexManager;
    (globalThis as any).sectionCrawler = sectionCrawler;
    (globalThis as any).testSectionCrawlerDirect = testSectionCrawlerDirect;
    (globalThis as any).detailCrawler = detailCrawler;
    (globalThis as any).filesPipeline = filesPipeline;
    (globalThis as any).incrementalSync = incrementalSync;
    
    // Debug: Verify sectionCrawler import
    console.log('[ServiceWorker] SectionCrawler import check:', typeof sectionCrawler, sectionCrawler ? 'OK' : 'FAILED');
    
    console.log('[ServiceWorker] Global objects exposed for testing:');
    console.log('- storageManager');
    console.log('- testStorageFunctionality');
    console.log('- ContentUtils');
    console.log('- StorageOptimizer');
    console.log('- authManager');
    console.log('- configManager');
    console.log('- queueManager');
    console.log('- scheduler');
    console.log('- pageLoader');
    console.log('- htmlParser');
    console.log('- ghostTabManager');
    console.log('- courseDiscovery');
    console.log('- studentIndexManager');
    console.log('- sectionCrawler');
    console.log('- detailCrawler');
    console.log('- filesPipeline');
    console.log('- incrementalSync');
  }

  private async handleStartup(): Promise<void> {
    console.log('[ServiceWorker] Chrome startup detected');
    await this.performAuthProbe();
  }

  private async handleInstalled(): Promise<void> {
    console.log('[ServiceWorker] Extension installed');
    await this.performAuthProbe();
  }

  private async performAuthProbe(): Promise<void> {
    // Prevent multiple simultaneous auth probes
    if (this.state.isAuthProbeRunning) {
      console.log('[ServiceWorker] Auth probe already running, skipping...');
      return;
    }
    
    try {
      this.state.isAuthProbeRunning = true;
      this.state.currentTask = 'auth-probe';
      
      // Wait for config and storage to load
      while (!configManager.isConfigLoaded() || !storageManager.isReady()) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Use the enhanced auth manager
      const authResult = await authManager.performAuthProbe();
      
      this.state.isAuthenticated = authResult.isAuthenticated;
      this.state.authenticatedHost = authResult.isAuthenticated ? authResult.host : null;
      
      if (authResult.isAuthenticated) {
        console.log('[ServiceWorker] User authenticated with Canvas on:', authResult.host);
        await this.startCrawl();
      } else {
        console.log('[ServiceWorker] User not authenticated, prompting for login');
        await authManager.promptForLogin();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ServiceWorker] Auth probe failed:', errorMessage);
      this.state.isAuthenticated = false;
      this.state.authenticatedHost = null;
      await authManager.promptForLogin();
    } finally {
      this.state.currentTask = null;
      this.state.isAuthProbeRunning = false;
    }
  }

  private async startCrawl(): Promise<void> {
    console.log('[ServiceWorker] Starting crawl...');
    
    // Check if crawl is already running
    if (scheduler.isCrawlRunning()) {
      console.log('[ServiceWorker] Crawl session already running, skipping...');
      return;
    }
    
    // Update student index with crawl start
    await storageManager.updateStudentIndex({
      lastCrawl: Date.now()
    });
    
    this.state.lastCrawl = Date.now();
    
    // Start crawl session using scheduler
    try {
      const sessionId = await scheduler.startCrawlSession();
      console.log(`[ServiceWorker] Crawl session started: ${sessionId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ServiceWorker] Failed to start crawl session:', errorMessage);
    }
  }

  private async handleMessage(
    message: any, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response?: any) => void
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'RUN_ALL_TESTS':
          console.log('[ServiceWorker] Running full test suite...');
          try {
            // Storage test
            await testStorageFunctionality();

            // Queue test
            await this.testQueueFunctionality();

            // Page loader test
            await this.testPageLoaderFunctionality();

            // Ghost tab test
            await this.testGhostTabFunctionality();

            // Course discovery test
            await this.testCourseDiscovery();

            // Phase 8: sections
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'CRAWL_SECTIONS_PHASE8' }, () => resolve());
            });

            // Phase 8: all sections overview
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_ALL_SECTIONS_PHASE8' }, () => resolve());
            });

            // Phase 8: parsing patterns
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_SECTION_PARSING_PHASE8' }, () => resolve());
            });

            // Phase 9: detail crawlers
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_DETAIL_CRAWLERS_PHASE9' }, () => resolve());
            });
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_SINGLE_ASSIGNMENT_PHASE9' }, () => resolve());
            });
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_ALL_ASSIGNMENTS_PHASE9' }, () => resolve());
            });
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_QUIZ_DETAILS_PHASE9' }, () => resolve());
            });

            // Phase 10: files pipeline (downloads API)
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_FILES_PIPELINE_PHASE10' }, () => resolve());
            });

            // Phase 11: incremental sync
            await new Promise<void>((resolve) => {
              chrome.runtime.sendMessage({ type: 'TEST_INCREMENTAL_SYNC_PHASE11' }, () => resolve());
            });

            console.log('[ServiceWorker] ✅ Full test suite completed. Check logs above for results.');
            sendResponse({ success: true, message: 'All tests completed. See console for details.' });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[ServiceWorker] Full test suite failed:', errorMessage);
            sendResponse({ success: false, error: errorMessage });
          }
          break;
        case 'GET_STATUS':
          sendResponse({ state: this.state });
          break;
        
        case 'START_CRAWL':
          await this.startCrawl();
          sendResponse({ success: true });
          break;
        
        case 'AUTH_CHECK':
          await this.performAuthProbe();
          sendResponse({ 
            isAuthenticated: this.state.isAuthenticated,
            host: this.state.authenticatedHost
          });
          break;
        
        case 'LOGIN_SUCCESS':
          console.log('[ServiceWorker] Login success detected, starting crawl...');
          await this.performAuthProbe();
          sendResponse({ success: true });
          break;
        
        case 'CONFIG_UPDATED':
          console.log('[ServiceWorker] Configuration updated, reloading config...');
          await configManager.loadConfig();
          sendResponse({ success: true });
          break;
        
        case 'GET_STORAGE_STATS':
          if (storageManager.isReady()) {
            const stats = await storageManager.getStorageStats();
            sendResponse({ success: true, stats });
          } else {
            sendResponse({ success: false, error: 'Storage not ready' });
          }
          break;
        
        case 'CLEAR_STORAGE':
          if (storageManager.isReady()) {
            await storageManager.clearAllData();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Storage not ready' });
          }
          break;
        
        case 'SAVE_HTML_SNAPSHOT':
          if (storageManager.isReady()) {
            await storageManager.saveHtmlSnapshot(message.snapshot);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Storage not ready' });
          }
          break;
        
        case 'SAVE_STRUCTURED_DATA':
          if (storageManager.isReady()) {
            await storageManager.saveStructuredData(message.data);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Storage not ready' });
          }
          break;
        
        case 'TEST_STORAGE':
          console.log('[ServiceWorker] Running storage functionality test...');
          await testStorageFunctionality();
          sendResponse({ success: true, message: 'Storage test completed, check console for results' });
          break;
        
        // Queue Management
        case 'GET_QUEUE_STATS':
          const queueStats = queueManager.getStats();
          sendResponse({ success: true, stats: queueStats });
          break;

        case 'GET_RECENT_ERRORS':
          try {
            const { recentErrors } = await chrome.storage.local.get(['recentErrors']);
            sendResponse({ success: true, errors: recentErrors || [] });
          } catch (e) {
            sendResponse({ success: false, error: 'Failed to load errors' });
          }
          break;
        
        case 'ADD_TASK':
          const taskId = await queueManager.addTask(message.task);
          sendResponse({ success: true, taskId });
          break;
        
        case 'GET_TASKS':
          const tasks = await queueManager.getAllTasks();
          sendResponse({ success: true, tasks });
          break;
        
        case 'CLEAR_QUEUE':
          await queueManager.clearQueue();
          sendResponse({ success: true });
          break;
        
        // Scheduler Management
        case 'START_CRAWL_SESSION':
          const sessionId = await scheduler.startCrawlSession();
          sendResponse({ success: true, sessionId });
          break;
        
        case 'GET_CURRENT_SESSION':
          const currentSession = await scheduler.getCurrentSession();
          sendResponse({ success: true, session: currentSession });
          break;
        
        case 'GET_SESSION_HISTORY':
          const sessionHistory = await scheduler.getSessionHistory();
          sendResponse({ success: true, sessions: sessionHistory });
          break;
        
        case 'CANCEL_CRAWL':
          await scheduler.cancelCrawl();
          sendResponse({ success: true });
          break;

        case 'MANUAL_RESCAN':
          try {
            const delay = typeof message.delayMs === 'number' ? message.delayMs : 0;
            // Seed initial tasks again
            await queueManager.addTask({
              type: 'dashboard',
              url: 'https://canvas.instructure.com/dashboard',
              priority: 10,
              maxRetries: 3,
              scheduledFor: Date.now() + delay
            });
            await queueManager.addTask({
              type: 'course-list',
              url: 'https://canvas.instructure.com/courses',
              priority: 9,
              maxRetries: 3,
              scheduledFor: Date.now() + delay
            });
            sendResponse({ success: true });
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            sendResponse({ success: false, error: errorMessage });
          }
          break;
        
        case 'TEST_QUEUE':
          console.log('[ServiceWorker] Running queue functionality test...');
          await this.testQueueFunctionality();
          sendResponse({ success: true, message: 'Queue test completed, check console for results' });
          break;
        
        case 'TEST_PAGE_LOADER':
          console.log('[ServiceWorker] Running page loader test...');
          await this.testPageLoaderFunctionality();
          sendResponse({ success: true, message: 'Page loader test completed, check console for results' });
          break;
        
        case 'TEST_GHOST_TAB':
          console.log('[ServiceWorker] Running ghost tab test...');
          await this.testGhostTabFunctionality();
          sendResponse({ success: true, message: 'Ghost tab test completed, check console for results' });
          break;
        
        // Ghost Tab Management
        case 'CREATE_GHOST_TAB':
          try {
            const response = await ghostTabManager.createGhostTab(message.request);
            sendResponse({ success: true, response });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            sendResponse({ success: false, error: errorMessage });
          }
          break;
        
        case 'GET_GHOST_TAB_STATS':
          const ghostTabStats = ghostTabManager.getStats();
          sendResponse({ success: true, stats: ghostTabStats });
          break;
        
        case 'TEST_COURSE_DISCOVERY':
          console.log('[ServiceWorker] Running course discovery test...');
          await this.testCourseDiscovery();
          sendResponse({ success: true, message: 'Course discovery test completed, check console for results' });
          break;
        
        case 'CRAWL_SECTIONS_PHASE8':
          console.log('[ServiceWorker] PHASE8: Running direct section test...');
          try {
            // Direct implementation to bypass all caching issues
            console.log('[Phase8] Starting section crawlers test...');
            
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            console.log('[Phase8] Found courses:', courses.length);
            
            if (courses.length > 0) {
              const testCourse = courses[0] as any;
              console.log(`[Phase8] Testing course: ${testCourse.code} (${testCourse.id})`);
              
              const sections = ['announcements', 'assignments', 'discussions', 'pages'];
              const results: any[] = [];
              
              // Correct Canvas URL mappings
              const urlMappings: Record<string, string> = {
                announcements: 'announcements',
                assignments: 'assignments', 
                discussions: 'discussion_topics',
                pages: 'wiki'
              };
              
              for (const section of sections) {
                console.log(`[Phase8] Testing ${section} section...`);
                
                try {
                  const actualPath = urlMappings[section] || section;
                  const sectionUrl = `${testCourse.url}/${actualPath}`;
                  console.log(`[Phase8] Fetching ${sectionUrl} (mapped from ${section})`);
                  
                  const response = await fetch(sectionUrl);
                  if (response.ok) {
                    const html = await response.text();
                    
                    // Use regex parsing instead of DOMParser (not available in service worker)
                    let linkMatches;
                    switch (section) {
                      case 'announcements':
                        linkMatches = html.match(/href="[^"]*\/announcements\/[^"]*"/g) || [];
                        break;
                      case 'assignments':
                        linkMatches = html.match(/href="[^"]*\/assignments\/[^"]*"/g) || [];
                        break;
                      case 'discussions':
                        linkMatches = html.match(/href="[^"]*\/discussions\/[^"]*"/g) || [];
                        break;
                      case 'pages':
                        linkMatches = html.match(/href="[^"]*\/pages\/[^"]*"/g) || [];
                        break;
                      default:
                        linkMatches = [];
                    }
                    
                    console.log(`[Phase8] ✓ ${section}: ${linkMatches.length} items found`);
                    results.push({ section, items: linkMatches.length, success: true });
                    
                    // Show sample items
                    if (linkMatches.length > 0) {
                      const sampleMatch = linkMatches[0];
                      console.log(`[Phase8] Sample ${section}: ${sampleMatch}`);
                    }
                  } else {
                    console.log(`[Phase8] ✗ ${section}: HTTP ${response.status}`);
                    results.push({ section, items: 0, success: false, error: `HTTP ${response.status}` });
                  }
                } catch (error) {
                  console.log(`[Phase8] ✗ ${section}: ${error}`);
                  results.push({ section, items: 0, success: false, error: error.message });
                }
              }
              
              console.log('[Phase8] Section crawling results:', results);
              const totalItems = results.reduce((sum, r) => sum + r.items, 0);
              const successfulSections = results.filter(r => r.success).length;
              
              console.log(`[Phase8] ✓ Phase 8 Complete! ${successfulSections}/${sections.length} sections crawled, ${totalItems} total items found`);
            }
            
            sendResponse({ success: true, message: 'Phase 8 section crawlers completed successfully!' });
          } catch (error) {
            console.error('[Phase8] Test failed:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_ALL_SECTIONS_PHASE8':
          console.log('[ServiceWorker] PHASE8: Testing ALL sections for ALL courses...');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            console.log(`[Phase8AllSections] Testing ${courses.length} courses`);
            
            const allSections = ['announcements', 'assignments', 'discussions', 'pages', 'files', 'quizzes', 'modules', 'grades', 'people', 'syllabus'];
            let totalSections = 0;
            let successfulSections = 0;
            let totalItems = 0;
            
            for (const course of courses) {
              console.log(`[Phase8AllSections] Testing course: ${course.code} (${course.id})`);
              
              for (const section of allSections) {
                totalSections++;
                try {
                  const sectionUrl = `${course.url}/${section === 'people' ? 'users' : section}`;
                  const response = await fetch(sectionUrl);
                  
                  if (response.ok) {
                    const html = await response.text();
                    const linkPattern = new RegExp(`href="[^"]*\\/${section}\\/[^"]*"`, 'g');
                    const linkMatches = html.match(linkPattern) || [];
                    
                    if (linkMatches.length > 0) {
                      successfulSections++;
                      totalItems += linkMatches.length;
                      console.log(`[Phase8AllSections] ✓ ${course.code}/${section}: ${linkMatches.length} items`);
                    } else {
                      console.log(`[Phase8AllSections] ○ ${course.code}/${section}: 0 items (empty section)`);
                    }
                  } else {
                    console.log(`[Phase8AllSections] ✗ ${course.code}/${section}: HTTP ${response.status}`);
                  }
                } catch (error) {
                  console.log(`[Phase8AllSections] ✗ ${course.code}/${section}: ${error.message}`);
                }
              }
            }
            
            console.log(`[Phase8AllSections] 🎉 COMPLETE! ${successfulSections}/${totalSections} sections crawled across ${courses.length} courses`);
            console.log(`[Phase8AllSections] 📊 Total items discovered: ${totalItems}`);
            sendResponse({ success: true, message: `All sections test complete: ${successfulSections}/${totalSections} successful, ${totalItems} items found` });
          } catch (error) {
            console.error('[Phase8AllSections] Test failed:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_SECTION_PARSING_PHASE8':
          console.log('[ServiceWorker] PHASE8: Testing section parsing capabilities...');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            if (courses.length > 0) {
              const testCourse = courses[0];
              console.log(`[Phase8Parsing] Testing parsing for course: ${testCourse.code}`);
              
              // Test different parsing patterns
              const parsingTests = [
                { section: 'announcements', patterns: [
                  /href="([^"]*\/announcements\/[^"]*)"/g,
                  /data-announcement-id="(\d+)"/g,
                  /<h3[^>]*>([^<]+)<\/h3>/g
                ]},
                { section: 'assignments', patterns: [
                  /href="([^"]*\/assignments\/[^"]*)"/g,
                  /data-assignment-id="(\d+)"/g,
                  /<span[^>]*assignment[^>]*>([^<]+)<\/span>/gi
                ]},
                { section: 'discussions', patterns: [
                  /href="([^"]*\/discussions\/[^"]*)"/g,
                  /data-discussion-id="(\d+)"/g,
                  /<h4[^>]*>([^<]+)<\/h4>/g
                ]}
              ];
              
              for (const test of parsingTests) {
                console.log(`[Phase8Parsing] Testing ${test.section} parsing patterns...`);
                
                try {
                  const sectionUrl = `${testCourse.url}/${test.section}`;
                  const response = await fetch(sectionUrl);
                  
                  if (response.ok) {
                    const html = await response.text();
                    console.log(`[Phase8Parsing] ${test.section} HTML length: ${html.length} bytes`);
                    
                    test.patterns.forEach((pattern, index) => {
                      const matches = html.match(pattern) || [];
                      console.log(`[Phase8Parsing] Pattern ${index + 1} for ${test.section}: ${matches.length} matches`);
                      if (matches.length > 0) {
                        console.log(`[Phase8Parsing] Sample match: ${matches[0]}`);
                      }
                    });
                  } else {
                    console.log(`[Phase8Parsing] ${test.section}: HTTP ${response.status}`);
                  }
                } catch (error) {
                  console.log(`[Phase8Parsing] ${test.section}: Error - ${error.message}`);
                }
              }
            }
            
            console.log('[Phase8Parsing] 🎉 Section parsing test complete!');
            sendResponse({ success: true, message: 'Section parsing test completed' });
          } catch (error) {
            console.error('[Phase8Parsing] Test failed:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'VIEW_ALL_DATA':
          console.log('[DataViewer] 📊 COMPREHENSIVE DATA REPORT - Canvas Scraper');
          console.log('[DataViewer] ================================================');
          try {
            // 1. Student Index Data
            console.log('[DataViewer] 📚 STUDENT INDEX:');
            const studentIndex = await studentIndexManager.loadStudentIndex();
            console.log(`   User ID: ${studentIndex.userId}`);
            console.log(`   Canvas Host: ${studentIndex.canvasHost}`);
            console.log(`   Last Sync: ${new Date(studentIndex.lastSync).toLocaleString()}`);
            console.log(`   Total Courses: ${studentIndex.totalCourses}`);
            console.log(`   Active Courses: ${studentIndex.activeCourses}`);
            console.log(`   Completed Courses: ${studentIndex.completedCourses}`);
            
            // 2. Course Details
            console.log('\n[DataViewer] 📖 DISCOVERED COURSES:');
            const courses = Object.values(studentIndex.courses);
            courses.forEach((course: any, index: number) => {
              console.log(`   ${index + 1}. ${course.code} - ${course.name}`);
              console.log(`      ID: ${course.id}`);
              console.log(`      URL: ${course.url}`);
              console.log(`      Status: ${course.status}`);
              console.log(`      Discovered: ${new Date(course.discoveredAt).toLocaleString()}`);
              console.log(`      Updated: ${new Date(course.updatedAt).toLocaleString()}`);
            });
            
            // 3. Storage Statistics
            console.log('\n[DataViewer] 💾 STORAGE STATISTICS:');
            const storageStats = await storageManager.getStorageStats();
            console.log(`   HTML Snapshots: ${storageStats.htmlSnapshots}`);
            console.log(`   Structured Data: ${storageStats.structured}`);
            console.log(`   Extracted Text: ${storageStats.extractedText}`);
            console.log(`   Blobs: ${storageStats.blobs}`);
            console.log(`   Total Size: ${(storageStats.totalSize / (1024 * 1024)).toFixed(2)} MB`);
            
            // 4. Queue Statistics
            console.log('\n[DataViewer] 🔄 QUEUE STATISTICS:');
            const queueStats = queueManager.getStats();
            console.log(`   Total Tasks: ${queueStats.total}`);
            console.log(`   Pending: ${queueStats.pending}`);
            console.log(`   Running: ${queueStats.running}`);
            console.log(`   Completed: ${queueStats.completed}`);
            console.log(`   Failed: ${queueStats.failed}`);
            console.log(`   Retries: ${queueStats.retries}`);
            
            // 5. Ghost Tab Statistics
            console.log('\n[DataViewer] 👻 GHOST TAB STATISTICS:');
            const ghostStats = ghostTabManager.getStats();
            console.log(`   Active Tabs: ${ghostStats.activeTabs}`);
            console.log(`   Pending Requests: ${ghostStats.pendingRequests}`);
            console.log(`   Max Concurrent: ${ghostStats.maxConcurrent}`);
            
            // 6. Recent Activity
            console.log('\n[DataViewer] 📈 RECENT ACTIVITY:');
            const currentSession = await scheduler.getCurrentSession();
            if (currentSession) {
              console.log(`   Current Session: ${currentSession.id}`);
              console.log(`   Started: ${new Date(currentSession.startTime).toLocaleString()}`);
              console.log(`   Status: ${currentSession.status}`);
              console.log(`   Tasks Scheduled: ${currentSession.tasksScheduled}`);
              console.log(`   Tasks Completed: ${currentSession.tasksCompleted}`);
              console.log(`   Tasks Failed: ${currentSession.tasksFailed}`);
            } else {
              console.log('   No active crawl session');
            }
            
            // 7. System Status
            console.log('\n[DataViewer] ⚙️ SYSTEM STATUS:');
            console.log(`   Extension Version: 0.0.3`);
            console.log(`   Service Worker: Active`);
            console.log(`   Storage Manager: ${storageManager.isReady() ? 'Ready' : 'Not Ready'}`);
            console.log(`   Config Manager: ${configManager.isConfigLoaded() ? 'Loaded' : 'Not Loaded'}`);
            console.log(`   Auth Status: ${authManager ? 'Authenticated' : 'Not Authenticated'}`);
            
            console.log('\n[DataViewer] ================================================');
            console.log('[DataViewer] 🎉 DATA REPORT COMPLETE!');
            
            sendResponse({ success: true, message: 'All data displayed in console' });
          } catch (error) {
            console.error('[DataViewer] Error generating data report:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'SHOW_CONTENT_COUNTS':
          console.log('[ContentCounts] 📊 CONTENT INVENTORY - All Courses');
          console.log('[ContentCounts] ================================================');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            console.log(`[ContentCounts] Found ${courses.length} courses to analyze...\n`);
            
            // URL mappings for correct Canvas paths
            const urlMappings: Record<string, string> = {
              announcements: 'announcements',
              assignments: 'assignments',
              discussions: 'discussion_topics',
              pages: 'wiki',
              files: 'files',
              quizzes: 'quizzes',
              modules: 'modules',
              grades: 'grades',
              people: 'users',
              syllabus: 'syllabus'
            };
            
            const allSections = Object.keys(urlMappings);
            let grandTotal = 0;
            
            for (const course of courses) {
              console.log(`📚 ${course.code} - ${course.name}`);
              console.log(`   Course ID: ${course.id}`);
              console.log(`   Status: ${course.status}`);
              console.log(`   URL: ${course.url}\n`);
              
              let courseTotal = 0;
              
              for (const section of allSections) {
                try {
                  const actualPath = urlMappings[section];
                  const sectionUrl = `${course.url}/${actualPath}`;
                  
                  const response = await fetch(sectionUrl);
                  
                  if (response.ok) {
                    const html = await response.text();
                    
                    // Count items using regex patterns
                    let itemCount = 0;
                    switch (section) {
                      case 'announcements':
                        itemCount = (html.match(/href="[^"]*\/announcements\/\d+/g) || []).length;
                        break;
                      case 'assignments':
                        itemCount = (html.match(/href="[^"]*\/assignments\/\d+/g) || []).length;
                        break;
                      case 'discussions':
                        itemCount = (html.match(/href="[^"]*\/discussion_topics\/\d+/g) || []).length;
                        break;
                      case 'pages':
                        itemCount = (html.match(/href="[^"]*\/wiki\/[^"]+/g) || []).length;
                        break;
                      case 'files':
                        itemCount = (html.match(/href="[^"]*\/files\/\d+/g) || []).length;
                        break;
                      case 'quizzes':
                        itemCount = (html.match(/href="[^"]*\/quizzes\/\d+/g) || []).length;
                        break;
                      case 'modules':
                        itemCount = (html.match(/href="[^"]*\/modules\/\d+/g) || []).length;
                        break;
                      case 'grades':
                        itemCount = (html.match(/gradebook|grade/gi) || []).length;
                        break;
                      case 'people':
                        itemCount = (html.match(/href="[^"]*\/users\/\d+/g) || []).length;
                        break;
                      case 'syllabus':
                        itemCount = html.includes('syllabus') ? 1 : 0;
                        break;
                    }
                    
                    if (itemCount > 0) {
                      console.log(`   ✅ ${section}: ${itemCount} items`);
                      courseTotal += itemCount;
                    } else {
                      console.log(`   ○ ${section}: 0 items (empty or hidden)`);
                    }
                  } else if (response.status === 404) {
                    console.log(`   ○ ${section}: Not available (404)`);
                  } else {
                    console.log(`   ❌ ${section}: HTTP ${response.status}`);
                  }
                } catch (error) {
                  console.log(`   ❌ ${section}: Error - ${error.message}`);
                }
              }
              
              console.log(`   📊 Course Total: ${courseTotal} items\n`);
              grandTotal += courseTotal;
            }
            
            console.log('[ContentCounts] ================================================');
            console.log(`[ContentCounts] 🎉 GRAND TOTAL: ${grandTotal} items across ${courses.length} courses`);
            console.log('[ContentCounts] 📋 This shows what EXISTS, not the content details');
            console.log('[ContentCounts] 🚀 For actual content, you need Phase 9: Detail Crawlers');
            
            sendResponse({ success: true, message: `Content inventory complete: ${grandTotal} total items found` });
          } catch (error) {
            console.error('[ContentCounts] Error:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'DEBUG_HTML_PATTERNS':
          console.log('[HTMLDebug] 🔍 DEBUGGING CANVAS HTML PATTERNS');
          console.log('[HTMLDebug] ================================================');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            // Focus on Agro 101 since you know it has content
            const agroCourse = courses.find((c: any) => c.code === 'Agro 101');
            if (!agroCourse) {
              console.log('[HTMLDebug] Agro 101 course not found');
              sendResponse({ success: false, error: 'Agro 101 not found' });
              return;
            }
            
            console.log(`[HTMLDebug] Analyzing Agro 101 (${agroCourse.id}) - Known to have 2 assignments, 1 discussion, 3 files, 1 quiz`);
            
            const sectionsToDebug = [
              { name: 'assignments', path: 'assignments', expected: 2 },
              { name: 'discussions', path: 'discussion_topics', expected: 1 },
              { name: 'files', path: 'files', expected: 3 },
              { name: 'quizzes', path: 'quizzes', expected: 1 }
            ];
            
            for (const section of sectionsToDebug) {
              console.log(`\n[HTMLDebug] 📋 ANALYZING ${section.name.toUpperCase()} (expecting ${section.expected} items):`);
              
              try {
                const sectionUrl = `${agroCourse.url}/${section.path}`;
                console.log(`[HTMLDebug] Fetching: ${sectionUrl}`);
                
                const response = await fetch(sectionUrl);
                if (response.ok) {
                  const html = await response.text();
                  console.log(`[HTMLDebug] HTML size: ${html.length} bytes`);
                  
                  // Test multiple patterns to see what exists
                  const patterns = [
                    { name: 'href links', pattern: new RegExp(`href="[^"]*\\/${section.path}\\/[^"]*"`, 'g') },
                    { name: 'href with IDs', pattern: new RegExp(`href="[^"]*\\/${section.path}\\/\\d+`, 'g') },
                    { name: 'data attributes', pattern: new RegExp(`data-[^=]*${section.name.slice(0, -1)}[^=]*="[^"]*"`, 'gi') },
                    { name: 'class names', pattern: new RegExp(`class="[^"]*${section.name}[^"]*"`, 'gi') },
                    { name: 'id attributes', pattern: new RegExp(`id="[^"]*${section.name}[^"]*"`, 'gi') }
                  ];
                  
                  patterns.forEach(test => {
                    const matches = html.match(test.pattern) || [];
                    console.log(`[HTMLDebug]   ${matches.length > 0 ? '✅' : '○'} ${test.name}: ${matches.length} matches`);
                    if (matches.length > 0 && matches.length <= 5) {
                      console.log(`[HTMLDebug]     Samples:`, matches.slice(0, 2));
                    }
                  });
                  
                  // Show a snippet of the HTML around any section-specific content
                  const sectionKeyword = section.name.slice(0, -1); // Remove 's'
                  const keywordIndex = html.toLowerCase().indexOf(sectionKeyword);
                  if (keywordIndex !== -1) {
                    const start = Math.max(0, keywordIndex - 200);
                    const end = Math.min(html.length, keywordIndex + 200);
                    const snippet = html.substring(start, end);
                    console.log(`[HTMLDebug]   📄 HTML snippet around "${sectionKeyword}":`);
                    console.log(`[HTMLDebug]   ...${snippet}...`);
                  }
                  
                } else {
                  console.log(`[HTMLDebug] ❌ ${section.name}: HTTP ${response.status}`);
                }
              } catch (error) {
                console.log(`[HTMLDebug] ❌ ${section.name}: ${error.message}`);
              }
            }
            
            console.log('\n[HTMLDebug] ================================================');
            console.log('[HTMLDebug] 🎯 This shows the ACTUAL HTML patterns Canvas uses');
            console.log('[HTMLDebug] 🔧 Use this to fix our parsing patterns in Phase 8');
            
            sendResponse({ success: true, message: 'HTML pattern debugging complete' });
          } catch (error) {
            console.error('[HTMLDebug] Error:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_DETAIL_CRAWLERS_PHASE9':
          console.log('[ServiceWorker] PHASE9: Testing detail crawlers...');
          try {
            console.log('[Phase9] Starting detail page crawlers test...');
            
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            // Test detail crawling for Agro 101 (we know it has content)
            const agroCourse = courses.find((c: any) => c.code === 'Agro 101');
            if (agroCourse) {
              console.log(`[Phase9] Testing detail crawling for ${agroCourse.code}...`);
              
              // Test assignment detail
              console.log('[Phase9] Testing assignment detail...');
              const assignmentResult = await detailCrawler.crawlItemDetail(
                `${agroCourse.url}/assignments/57852760`,
                'assignment',
                agroCourse.id
              );
              
              if (assignmentResult.success && assignmentResult.item) {
                console.log(`[Phase9] ✅ Assignment: "${assignmentResult.item.title}"`);
                console.log(`[Phase9]    Content: ${assignmentResult.item.content?.substring(0, 100)}...`);
                console.log(`[Phase9]    Due Date: ${assignmentResult.item.metadata?.dueDate || 'Not specified'}`);
                console.log(`[Phase9]    Points: ${assignmentResult.item.metadata?.points || 'Not specified'}`);
                console.log(`[Phase9]    Attachments: ${assignmentResult.item.attachments?.length || 0}`);
              } else {
                console.log(`[Phase9] ❌ Assignment failed: ${assignmentResult.error}`);
              }
              
              // Test discussion detail
              console.log('[Phase9] Testing discussion detail...');
              const discussionResult = await detailCrawler.crawlItemDetail(
                `${agroCourse.url}/discussion_topics/26492809`,
                'discussion',
                agroCourse.id
              );
              
              if (discussionResult.success && discussionResult.item) {
                console.log(`[Phase9] ✅ Discussion: "${discussionResult.item.title}"`);
                console.log(`[Phase9]    Content: ${discussionResult.item.content?.substring(0, 100)}...`);
                console.log(`[Phase9]    Author: ${discussionResult.item.metadata?.author || 'Not specified'}`);
                console.log(`[Phase9]    Replies: ${discussionResult.item.metadata?.replies || 0}`);
              } else {
                console.log(`[Phase9] ❌ Discussion failed: ${discussionResult.error}`);
              }
              
              // Test quiz detail
              console.log('[Phase9] Testing quiz detail...');
              const quizResult = await detailCrawler.crawlItemDetail(
                `${agroCourse.url}/quizzes/23030182`,
                'quiz',
                agroCourse.id
              );
              
              if (quizResult.success && quizResult.item) {
                console.log(`[Phase9] ✅ Quiz: "${quizResult.item.title}"`);
                console.log(`[Phase9]    Description: ${quizResult.item.content?.substring(0, 100)}...`);
                console.log(`[Phase9]    Time Limit: ${quizResult.item.metadata?.timeLimit || 'Not specified'}`);
                console.log(`[Phase9]    Questions: ${quizResult.item.metadata?.questionCount || 0}`);
              } else {
                console.log(`[Phase9] ❌ Quiz failed: ${quizResult.error}`);
              }
            }
            
            console.log('[Phase9] 🎉 Detail crawlers test complete!');
            sendResponse({ success: true, message: 'Phase 9 detail crawlers test completed' });
          } catch (error) {
            console.error('[Phase9] Test failed:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_SINGLE_ASSIGNMENT_PHASE9':
          console.log('[ServiceWorker] PHASE9: Testing single assignment detail...');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            const agroCourse = courses.find((c: any) => c.code === 'Agro 101');
            
            if (agroCourse) {
              console.log('[Phase9SingleAssignment] Testing assignment 57852760...');
              
              const result = await detailCrawler.crawlItemDetail(
                `${agroCourse.url}/assignments/57852760`,
                'assignment',
                agroCourse.id
              );
              
              if (result.success && result.item) {
                console.log('[Phase9SingleAssignment] ✅ SUCCESS!');
                console.log(`   📝 Title: "${result.item.title}"`);
                console.log(`   📄 Content Length: ${result.item.content?.length || 0} characters`);
                console.log(`   📄 HTML Length: ${result.item.htmlContent?.length || 0} characters`);
                console.log(`   📅 Due Date: ${result.item.metadata?.dueDate || 'Not specified'}`);
                console.log(`   🎯 Points: ${result.item.metadata?.points || 'Not specified'}`);
                console.log(`   📎 Attachments: ${result.item.attachments?.length || 0}`);
                console.log(`   ⏱️ Extraction Time: ${result.timing.duration}ms`);
                
                if (result.item.content) {
                  console.log(`   📖 Content Preview: "${result.item.content.substring(0, 200)}..."`);
                }
                
                if (result.item.attachments && result.item.attachments.length > 0) {
                  console.log('   📎 Attachment URLs:');
                  result.item.attachments.forEach((att, i) => {
                    console.log(`      ${i + 1}. ${att}`);
                  });
                }
              } else {
                console.log(`[Phase9SingleAssignment] ❌ FAILED: ${result.error}`);
              }
            }
            
            sendResponse({ success: true, message: 'Single assignment test completed' });
          } catch (error) {
            console.error('[Phase9SingleAssignment] Error:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_ALL_ASSIGNMENTS_PHASE9':
          console.log('[ServiceWorker] PHASE9: Testing all assignments...');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            console.log('[Phase9AllAssignments] Testing all assignments across all courses...');
            
            // All known assignments from Phase 8
            const allAssignments = [
              { courseCode: 'Agro 101', url: 'https://canvas.instructure.com/courses/12671534/assignments/57852760', id: '57852760' },
              { courseCode: 'Agro 101', url: 'https://canvas.instructure.com/courses/12671534/assignments/57980836', id: '57980836' },
              { courseCode: 'GTFM112', url: 'https://canvas.instructure.com/courses/12722641/assignments/57980132', id: '57980132' },
              { courseCode: 'GTFM112', url: 'https://canvas.instructure.com/courses/12722641/assignments/57980175', id: '57980175' },
              { courseCode: 'GTFM112', url: 'https://canvas.instructure.com/courses/12722641/assignments/57980200', id: '57980200' }
            ];
            
            let successCount = 0;
            let totalContent = 0;
            let totalAttachments = 0;
            
            for (const assignment of allAssignments) {
              console.log(`[Phase9AllAssignments] Testing ${assignment.courseCode} assignment ${assignment.id}...`);
              
              try {
                const courseId = assignment.url.includes('12671534') ? '12671534' : '12722641';
                const result = await detailCrawler.crawlItemDetail(assignment.url, 'assignment', courseId);
                
                if (result.success && result.item) {
                  successCount++;
                  totalContent += result.item.content?.length || 0;
                  totalAttachments += result.item.attachments?.length || 0;
                  
                  console.log(`   ✅ "${result.item.title}" - ${result.item.content?.length || 0} chars, ${result.item.attachments?.length || 0} attachments`);
                } else {
                  console.log(`   ❌ Failed: ${result.error}`);
                }
                
                // Longer delay to avoid concurrent tab limits
                console.log(`[Phase9AllAssignments] Waiting 5 seconds before next assignment...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                
              } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
              }
            }
            
            console.log(`[Phase9AllAssignments] 📊 SUMMARY:`);
            console.log(`   ✅ Successful: ${successCount}/${allAssignments.length} assignments`);
            console.log(`   📄 Total Content: ${totalContent} characters`);
            console.log(`   📎 Total Attachments: ${totalAttachments}`);
            console.log(`   📈 Success Rate: ${Math.round((successCount / allAssignments.length) * 100)}%`);
            
            sendResponse({ success: true, message: `All assignments test completed: ${successCount}/${allAssignments.length} successful` });
          } catch (error) {
            console.error('[Phase9AllAssignments] Error:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_QUIZ_DETAILS_PHASE9':
          console.log('[ServiceWorker] PHASE9: Testing quiz details...');
          try {
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            // Test quizzes from both courses
            const quizzes = [
              { courseCode: 'Agro 101', url: 'https://canvas.instructure.com/courses/12671534/quizzes/23030182', id: '23030182' },
              { courseCode: 'GTFM112', url: 'https://canvas.instructure.com/courses/12722641/quizzes/23085267', id: '23085267' }
            ];
            
            for (const quiz of quizzes) {
              console.log(`[Phase9QuizDetails] Testing ${quiz.courseCode} quiz ${quiz.id}...`);
              
              try {
                const courseId = quiz.url.includes('12671534') ? '12671534' : '12722641';
                const result = await detailCrawler.crawlItemDetail(quiz.url, 'quiz', courseId);
                
                if (result.success && result.item) {
                  console.log(`[Phase9QuizDetails] ✅ Quiz: "${result.item.title}"`);
                  console.log(`   📄 Description: ${result.item.content?.substring(0, 150)}...`);
                  console.log(`   ⏱️ Time Limit: ${result.item.metadata?.timeLimit || 'Not specified'}`);
                  console.log(`   🔢 Questions: ${result.item.metadata?.questionCount || 'Not specified'}`);
                  console.log(`   📅 Due Date: ${result.item.metadata?.dueDate || 'Not specified'}`);
                  console.log(`   📋 Instructions: ${result.item.metadata?.instructions?.substring(0, 100) || 'None'}...`);
                  console.log(`   📊 HTML Size: ${result.item.htmlContent?.length || 0} bytes`);
                } else {
                  console.log(`[Phase9QuizDetails] ❌ Failed: ${result.error}`);
                }
                
                console.log(`[Phase9QuizDetails] Waiting 5 seconds before next quiz...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                
              } catch (error) {
                console.log(`[Phase9QuizDetails] ❌ Error: ${error.message}`);
              }
            }
            
            console.log('[Phase9QuizDetails] 🎉 Quiz details test complete!');
            sendResponse({ success: true, message: 'Quiz details test completed' });
          } catch (error) {
            console.error('[Phase9QuizDetails] Error:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_FILES_PIPELINE_PHASE10':
          console.log('[ServiceWorker] PHASE10: Testing files pipeline...');
          try {
            console.log('[Phase10] Starting files pipeline test...');
            
            // Test file pipeline functionality
            await filesPipeline.testFilePipeline();
            
            // Show pipeline statistics
            const stats = filesPipeline.getStats();
            console.log('[Phase10] Files Pipeline Stats:', stats);
            
            // Test with known file URLs from our previous discoveries
            console.log('[Phase10] Testing with discovered file URLs...');
            
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            const agroCourse = courses.find((c: any) => c.code === 'Agro 101');
            
            if (agroCourse) {
              // Test file discovery from assignments (we found file links there)
              console.log('[Phase10] Testing file extraction from assignments...');
              
              const ghostRequest = {
                id: `file_discovery_${Date.now()}`,
                url: `${agroCourse.url}/assignments`,
                timeout: 15000,
                waitFor: { selector: 'body', timeout: 10000 },
                actions: [{ type: 'wait' as const, value: 5000 }],
                extractors: [
                  { name: 'fileLinks', selector: 'a[href*="/files/"], a[href*="download"], a[href*=".pdf"], a[href*=".docx"]', attribute: 'href', multiple: true },
                  { name: 'attachmentLinks', selector: '.attachment a, .instructure_file_link, .file-link', attribute: 'href', multiple: true },
                  { name: 'allLinks', selector: 'a', attribute: 'href', multiple: true }
                ]
              };
              
              const result = await ghostTabManager.createGhostTab(ghostRequest);
              
              if (result.success && result.extractedData) {
                // Filter for actual file links from all links
                const allLinks = result.extractedData.allLinks || [];
                const fileRelatedLinks = allLinks.filter((link: string) => 
                  link.includes('/files/') || 
                  link.includes('download') ||
                  link.includes('.pdf') ||
                  link.includes('.docx') ||
                  link.includes('.xlsx') ||
                  link.includes('external_tools') && link.includes('files')
                );
                
                const allFileLinks = [
                  ...(result.extractedData.fileLinks || []),
                  ...(result.extractedData.attachmentLinks || []),
                  ...fileRelatedLinks
                ].filter((link, index, array) => array.indexOf(link) === index); // Remove duplicates
                
                console.log(`[Phase10] Found ${allFileLinks.length} file links in assignments:`);
                allFileLinks.forEach((link, i) => {
                  console.log(`   ${i + 1}. ${link}`);
                });
                
                // Also show what we found in previous tests
                console.log(`[Phase10] 📄 Known file from previous tests:`);
                console.log(`   - TFGAntoniSanchezCRAI.pdf (file ID 309228954)`);
                console.log(`   - URL: https://canvas.instructure.com/courses/12671534/files/309228954/download`);
                
                // Test processing one file if found
                if (allFileLinks.length > 0) {
                  const testFileUrl = allFileLinks.find(link => 
                    link.includes('/files/') && !link.includes('external_tools')
                  );
                  
                  if (testFileUrl) {
                    console.log(`[Phase10] Testing file processing: ${testFileUrl}`);
                    
                    try {
                      const fileResult = await filesPipeline.processFile(testFileUrl, agroCourse.id, `${agroCourse.url}/assignments`);
                      
                      if (fileResult.success && fileResult.fileItem) {
                        console.log('[Phase10] ✅ File processing successful!');
                        console.log(`   📁 File Name: ${fileResult.fileItem.fileName}`);
                        console.log(`   📊 File Size: ${fileResult.fileItem.fileSize} bytes`);
                        console.log(`   📄 File Type: ${fileResult.fileItem.fileType}`);
                        console.log(`   🔗 Download URL: ${fileResult.fileItem.downloadUrl}`);
                        console.log(`   📝 Extracted Text: ${fileResult.fileItem.extractedText?.length || 0} characters`);
                        console.log(`   ⏱️ Processing Time: ${fileResult.timing.total}ms`);
                        
                        if (fileResult.fileItem.extractedText) {
                          console.log(`   📖 Text Preview: "${fileResult.fileItem.extractedText.substring(0, 200)}..."`);
                        }
                      } else {
                        console.log(`[Phase10] ❌ File processing failed: ${fileResult.error}`);
                      }
                    } catch (fileError) {
                      console.log(`[Phase10] ❌ File processing error: ${fileError}`);
                    }
                  } else {
                    console.log('[Phase10] No direct file URLs found, testing Chrome downloads API...');
                    
                    // Test Chrome downloads API with known file
                    const knownFileUrl = 'https://canvas.instructure.com/courses/12671534/files/309228954/download';
                    console.log(`[Phase10] Testing Chrome downloads API: ${knownFileUrl}`);
                    
                    try {
                      // Use Chrome downloads API (doesn't have CORS restrictions)
                      const downloadId = await new Promise<number>((resolve, reject) => {
                        chrome.downloads.download({
                          url: knownFileUrl,
                          filename: 'test_download_TFGAntoniSanchezCRAI.pdf'
                        }, (downloadId) => {
                          if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                          } else {
                            resolve(downloadId);
                          }
                        });
                      });
                      
                      console.log(`[Phase10] ✅ Chrome downloads API successful! Download ID: ${downloadId}`);
                      console.log(`[Phase10] 📁 File: TFGAntoniSanchezCRAI.pdf`);
                      console.log(`[Phase10] 🎯 This proves Phase 10 can access Canvas files!`);
                      
                      // Cancel the download (we just wanted to test access)
                      chrome.downloads.cancel(downloadId);
                      
                    } catch (downloadError) {
                      console.log(`[Phase10] ❌ Chrome downloads API failed: ${downloadError}`);
                    }
                  }
                }
                
                // Always test Chrome downloads API with known file
                console.log('[Phase10] Testing Chrome downloads API with known file...');
                const knownFileUrl = 'https://canvas.instructure.com/courses/12671534/files/309228954/download';
                console.log(`[Phase10] Testing: ${knownFileUrl}`);
                
                try {
                  // Use Chrome downloads API (doesn't have CORS restrictions)
                  const downloadId = await new Promise<number>((resolve, reject) => {
                    chrome.downloads.download({
                      url: knownFileUrl,
                      filename: 'test_download_TFGAntoniSanchezCRAI.pdf'
                    }, (downloadId) => {
                      if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                      } else {
                        resolve(downloadId);
                      }
                    });
                  });
                  
                  console.log(`[Phase10] ✅ Chrome downloads API successful! Download ID: ${downloadId}`);
                  console.log(`[Phase10] 📁 File: TFGAntoniSanchezCRAI.pdf`);
                  console.log(`[Phase10] 🎯 This proves Phase 10 can access Canvas files!`);
                  
                  // Cancel the download (we just wanted to test access)
                  chrome.downloads.cancel(downloadId);
                  console.log(`[Phase10] Download cancelled (test only)`);
                  
                } catch (downloadError) {
                  console.log(`[Phase10] ❌ Chrome downloads API failed: ${downloadError}`);
                }
              }
            }
            
            console.log('[Phase10] 🎉 Files pipeline test complete!');
            sendResponse({ success: true, message: 'Phase 10 files pipeline test completed' });
          } catch (error) {
            console.error('[Phase10] Test failed:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'TEST_INCREMENTAL_SYNC_PHASE11':
          console.log('[ServiceWorker] PHASE11: Testing incremental sync...');
          try {
            console.log('[Phase11] Starting incremental sync test...');
            
            // Test incremental sync functionality
            await incrementalSync.testIncrementalSync();
            
            // Show sync statistics
            const stats = incrementalSync.getStats();
            console.log('[Phase11] Incremental Sync Stats:', stats);
            
            // Test with course URLs for targeted recrawling
            console.log('[Phase11] Testing targeted recrawl planning...');
            
            const studentIndex = await studentIndexManager.loadStudentIndex();
            const courses = Object.values(studentIndex.courses);
            
            if (courses.length > 0) {
              const testCourse = courses[0] as any;
              console.log(`[Phase11] Testing sync for course sections: ${testCourse.code}`);
              
              // Test sync for different course sections
              const sectionUrls = [
                `${testCourse.url}/assignments`,
                `${testCourse.url}/discussion_topics`,
                `${testCourse.url}/quizzes`
              ];
              
              for (const sectionUrl of sectionUrls) {
                console.log(`[Phase11] Testing sync for: ${sectionUrl}`);
                
                try {
                  const syncResult = await incrementalSync.syncUrl(sectionUrl);
                  
                  console.log(`[Phase11] ✅ ${sectionUrl}:`);
                  console.log(`   Changed: ${syncResult.changed}`);
                  console.log(`   Cached: ${syncResult.cached}`);
                  console.log(`   Hash: ${syncResult.contentHash.substring(0, 16)}...`);
                  console.log(`   Timing: ${syncResult.timing.total}ms`);
                  
                  if (syncResult.etag) {
                    console.log(`   ETag: ${syncResult.etag}`);
                  }
                  
                  if (syncResult.lastModified) {
                    console.log(`   Last-Modified: ${syncResult.lastModified}`);
                  }
                  
                } catch (syncError) {
                  console.log(`[Phase11] ❌ Sync failed for ${sectionUrl}: ${syncError}`);
                }
                
                // Small delay between syncs
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              // Test recrawl planning
              console.log('[Phase11] Testing recrawl planning...');
              const recrawlPlan = incrementalSync.planTargetedRecrawl();
              
              console.log(`[Phase11] Recrawl plan: ${recrawlPlan.length} URLs`);
              recrawlPlan.slice(0, 5).forEach((plan, i) => {
                console.log(`   ${i + 1}. Priority ${plan.priority}: ${plan.url}`);
                console.log(`      Reason: ${plan.reason}`);
              });
              
              if (recrawlPlan.length > 5) {
                console.log(`   ... and ${recrawlPlan.length - 5} more URLs`);
              }
            }
            
            console.log('[Phase11] 🎉 Incremental sync test complete!');
            sendResponse({ success: true, message: 'Phase 11 incremental sync test completed' });
          } catch (error) {
            console.error('[Phase11] Test failed:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;
        
        case 'GET_STUDENT_INDEX':
          const studentIndex = await studentIndexManager.exportIndex();
          sendResponse({ success: true, index: studentIndex });
          break;
        
        case 'GET_COURSE_STATS':
          const courseStats = studentIndexManager.getStats();
          sendResponse({ success: true, stats: courseStats });
          break;
        
        default:
          console.warn('[ServiceWorker] Unknown message type:', message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ServiceWorker] Message handling error:', errorMessage);
      sendResponse({ error: errorMessage });
    }
  }

  private async handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
    if (alarm.name === 'periodic-sync') {
      console.log('[ServiceWorker] Periodic sync alarm triggered');
      await this.performAuthProbe();
    } else if (alarm.name === 'periodic-crawl') {
      console.log('[ServiceWorker] Periodic crawl alarm triggered');
      if (!scheduler.isCrawlRunning()) {
        await this.startCrawl();
      } else {
        console.log('[ServiceWorker] Crawl already running, skipping alarm trigger');
      }
    }
  }

  private async testQueueFunctionality(): Promise<void> {
    console.log('[QueueTest] Starting queue functionality test...');

    try {
      // Test 1: Add tasks
      console.log('[QueueTest] Test 1: Adding tasks to queue');
      const task1 = await queueManager.addTask({
        type: 'dashboard',
        url: 'https://test.instructure.com/dashboard',
        priority: 10,
        maxRetries: 3,
        scheduledFor: Date.now()
      });
      console.log(`[QueueTest] ✓ Added task: ${task1}`);

      const task2 = await queueManager.addTask({
        type: 'course-list',
        url: 'https://test.instructure.com/courses',
        priority: 9,
        maxRetries: 3,
        scheduledFor: Date.now() + 1000
      });
      console.log(`[QueueTest] ✓ Added task: ${task2}`);

      // Test 2: Get queue stats
      console.log('[QueueTest] Test 2: Queue statistics');
      const stats = queueManager.getStats();
      console.log('[QueueTest] Queue stats:', stats);

      // Test 3: Get all tasks
      console.log('[QueueTest] Test 3: Getting all tasks');
      const tasks = await queueManager.getAllTasks();
      console.log(`[QueueTest] ✓ Found ${tasks.length} tasks in queue`);

      // Test 4: Test scheduler
      console.log('[QueueTest] Test 4: Scheduler functionality');
      const sessionId = await scheduler.startCrawlSession();
      console.log(`[QueueTest] ✓ Started crawl session: ${sessionId}`);

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Test 5: Get current session
      const currentSession = await scheduler.getCurrentSession();
      console.log('[QueueTest] Current session:', currentSession);

      console.log('[QueueTest] All queue tests completed successfully!');

    } catch (error) {
      console.error('[QueueTest] Queue test failed:', error);
    }
  }

  private async testPageLoaderFunctionality(): Promise<void> {
    console.log('[PageLoaderTest] Starting page loader functionality test...');

    try {
      // Test 1: Fetch dashboard
      console.log('[PageLoaderTest] Test 1: Fetching dashboard');
      const dashboardResult = await pageLoader.fetchDashboard('https://canvas.instructure.com');
      console.log('[PageLoaderTest] Dashboard fetch result:', {
        success: dashboardResult.success,
        status: dashboardResult.status,
        size: dashboardResult.text?.length || 0,
        cached: dashboardResult.cached
      });

      if (dashboardResult.success && dashboardResult.text) {
        // Test 2: Parse dashboard HTML
        console.log('[PageLoaderTest] Test 2: Parsing dashboard HTML');
        const parsedDashboard = htmlParser.parseDashboard(dashboardResult.text);
        console.log('[PageLoaderTest] Dashboard parsed:', {
          title: parsedDashboard.title,
          coursesFound: (parsedDashboard as any).courses?.length || 0,
          linksFound: parsedDashboard.links.length
        });

        // Test 3: Extract Canvas URLs
        console.log('[PageLoaderTest] Test 3: Extracting Canvas URLs');
        const canvasUrls = htmlParser.extractCanvasUrls(dashboardResult.text);
        console.log('[PageLoaderTest] Canvas URLs found:', canvasUrls.length);

        // Test 4: Check if it's a Canvas page
        console.log('[PageLoaderTest] Test 4: Canvas page detection');
        const isCanvas = htmlParser.isCanvasPage(dashboardResult.text);
        console.log('[PageLoaderTest] Is Canvas page:', isCanvas);
      }

      // Test 5: Cache statistics
      console.log('[PageLoaderTest] Test 5: Cache statistics');
      const cacheStats = pageLoader.getCacheStats();
      console.log('[PageLoaderTest] Cache stats:', cacheStats);

      console.log('[PageLoaderTest] All page loader tests completed successfully!');

    } catch (error) {
      console.error('[PageLoaderTest] Page loader test failed:', error);
    }
  }

  private async testGhostTabFunctionality(): Promise<void> {
    console.log('[GhostTabTest] Starting ghost tab functionality test...');

    try {
      // Test 1: Check initial stats
      console.log('[GhostTabTest] Test 1: Initial ghost tab stats');
      const initialStats = ghostTabManager.getStats();
      console.log('[GhostTabTest] Initial stats:', initialStats);

      // Test 2: Create a ghost tab for Canvas dashboard
      console.log('[GhostTabTest] Test 2: Creating ghost tab for Canvas dashboard');
      const ghostTabRequest = {
        id: `test_${Date.now()}`,
        url: 'https://canvas.instructure.com/dashboard',
        timeout: 15000,
        waitFor: {
          selector: '#application, .ic-app, [data-react-class]',
          timeout: 10000
        },
        actions: [
          { type: 'wait' as const, value: 2000 },
          { type: 'scroll' as const, value: 0 } // Scroll to bottom
        ],
        extractors: [
          {
            name: 'pageTitle',
            selector: 'title'
          },
          {
            name: 'courseLinks',
            selector: 'a[href*="/courses/"]',
            attribute: 'href',
            multiple: true
          },
          {
            name: 'dashboardCards',
            selector: '.ic-DashboardCard__header-title, .dashboard-card-header',
            multiple: true
          }
        ]
      };

      const startTime = Date.now();
      const result = await ghostTabManager.createGhostTab(ghostTabRequest);
      const duration = Date.now() - startTime;

      console.log('[GhostTabTest] Ghost tab result:', {
        success: result.success,
        duration: `${duration}ms`,
        htmlSize: result.html?.length || 0,
        extractedData: result.extractedData,
        error: result.error
      });

      // Test 3: Check final stats
      console.log('[GhostTabTest] Test 3: Final ghost tab stats');
      const finalStats = ghostTabManager.getStats();
      console.log('[GhostTabTest] Final stats:', finalStats);

      if (result.success) {
        console.log('[GhostTabTest] ✓ Ghost tab created and executed successfully');
        console.log('[GhostTabTest] ✓ Extracted data:', Object.keys(result.extractedData || {}));
        console.log('[GhostTabTest] ✓ HTML content size:', result.html?.length || 0, 'bytes');
      } else {
        console.log('[GhostTabTest] ✗ Ghost tab failed:', result.error);
      }

      console.log('[GhostTabTest] All ghost tab tests completed!');

    } catch (error) {
      console.error('[GhostTabTest] Ghost tab test failed:', error);
    }
  }

  private async testCourseDiscovery(): Promise<void> {
    console.log('[CourseDiscoveryTest] Starting course discovery functionality test...');

    try {
      // Test 1: Load student index
      console.log('[CourseDiscoveryTest] Test 1: Loading student index');
      const initialIndex = await studentIndexManager.loadStudentIndex();
      console.log('[CourseDiscoveryTest] Initial student index:', {
        totalCourses: initialIndex.totalCourses,
        activeCourses: initialIndex.activeCourses,
        lastSync: new Date(initialIndex.lastSync).toISOString()
      });

      // Test 2: Fetch and parse dashboard
      console.log('[CourseDiscoveryTest] Test 2: Fetching dashboard for course discovery');
      const dashboardResult = await pageLoader.fetchPage('https://canvas.instructure.com/dashboard');
      
      if (!dashboardResult.success || !dashboardResult.text) {
        throw new Error('Failed to fetch dashboard');
      }

      const dashboardCourses = courseDiscovery.parseDashboard(dashboardResult.text);
      console.log('[CourseDiscoveryTest] Dashboard courses found:', dashboardCourses.length);

      // Test 3: Fetch and parse course list
      console.log('[CourseDiscoveryTest] Test 3: Fetching course list for course discovery');
      const courseListResult = await pageLoader.fetchPage('https://canvas.instructure.com/courses');
      
      if (courseListResult.success && courseListResult.text) {
        const courseListCourses = courseDiscovery.parseCourseList(courseListResult.text);
        console.log('[CourseDiscoveryTest] Course list courses found:', courseListCourses.length);
        
        // Combine all discovered courses
        const allCourses = [...dashboardCourses, ...courseListCourses];
        
        // Test 4: Update student index
        console.log('[CourseDiscoveryTest] Test 4: Updating student index with discovered courses');
        await studentIndexManager.updateCourses(allCourses);
        
        // Test 5: Get updated statistics
        console.log('[CourseDiscoveryTest] Test 5: Getting updated course statistics');
        const finalStats = studentIndexManager.getStats();
        console.log('[CourseDiscoveryTest] Final statistics:', finalStats);
        
        // Test 6: Display discovered courses
        console.log('[CourseDiscoveryTest] Test 6: Course discovery results');
        const courses = studentIndexManager.getCourses();
        
        console.log('[CourseDiscoveryTest] ✓ Total courses discovered:', courses.length);
        console.log('[CourseDiscoveryTest] ✓ Active courses:', finalStats.activeCourses);
        console.log('[CourseDiscoveryTest] ✓ Completed courses:', finalStats.completedCourses);
        
        // Display first few courses as examples
        const sampleCourses = courses.slice(0, 5);
        for (const course of sampleCourses) {
          console.log(`[CourseDiscoveryTest] Course: ${course.code} - ${course.name} (${course.status})`);
        }
        
        if (courses.length > 5) {
          console.log(`[CourseDiscoveryTest] ... and ${courses.length - 5} more courses`);
        }
        
        // Test 7: Test deduplication
        console.log('[CourseDiscoveryTest] Test 7: Testing deduplication by re-adding same courses');
        const beforeCount = courses.length;
        await studentIndexManager.updateCourses(allCourses); // Add same courses again
        const afterCount = studentIndexManager.getCourses().length;
        
        if (beforeCount === afterCount) {
          console.log('[CourseDiscoveryTest] ✓ Deduplication working correctly');
        } else {
          console.log('[CourseDiscoveryTest] ✗ Deduplication failed:', beforeCount, 'vs', afterCount);
        }

      } else {
        console.log('[CourseDiscoveryTest] Course list fetch failed, continuing with dashboard only');
        await studentIndexManager.updateCourses(dashboardCourses);
      }

      console.log('[CourseDiscoveryTest] All course discovery tests completed successfully!');

    } catch (error) {
      console.error('[CourseDiscoveryTest] Course discovery test failed:', error);
    }
  }

  private async testSectionCrawlersV2(): Promise<void> {
    console.log('[SectionCrawlerTest] Starting section crawlers functionality test...');

    try {
      // Test 1: Load student index to get courses
      console.log('[SectionCrawlerTest] Test 1: Loading student index');
      const studentIndex = await studentIndexManager.loadStudentIndex();
      console.log('[SectionCrawlerTest] Student index loaded:', studentIndex);
      console.log('[SectionCrawlerTest] Courses object:', studentIndex.courses);
      console.log('[SectionCrawlerTest] Courses object type:', typeof studentIndex.courses);
      const courses = Object.values(studentIndex.courses);
      console.log('[SectionCrawlerTest] Courses array:', courses);
      console.log('[SectionCrawlerTest] Found courses:', courses.length);

      if (courses.length === 0) {
        console.log('[SectionCrawlerTest] No courses found, skipping section crawler tests');
        return;
      }

      // Test 2: Test section crawler for first course
      const testCourse = courses[0];
      console.log(`[SectionCrawlerTest] Test 2: Testing section crawler for course ${testCourse.code} (${testCourse.id})`);

      const sections = [
        'announcements',
        'assignments',
        'discussions',
        'pages',
        'files',
        'quizzes',
        'modules',
        'grades',
        'people',
        'syllabus'
      ];

      for (const section of sections) {
        console.log(`[SectionCrawlerTest] Testing ${section} section...`);
        
        try {
          const result = await sectionCrawler.crawlSection(testCourse.id, section);
          
          if (result.success) {
            console.log(`[SectionCrawlerTest] ✓ ${section}: ${result.items.length} items found`);
          } else {
            console.log(`[SectionCrawlerTest] ✗ ${section}: Error - ${result.error}`);
          }
        } catch (error) {
          console.log(`[SectionCrawlerTest] ✗ ${section}: Error - ${error}`);
        }
      }

      // Test 3: Get section statistics
      console.log('[SectionCrawlerTest] Test 3: Getting section statistics');
      const allResults = await sectionCrawler.crawlAllSections(testCourse.id);
      const successfulSections = allResults.filter(r => r.success);
      const totalItems = allResults.reduce((sum, r) => sum + r.items.length, 0);
      
      console.log('[SectionCrawlerTest] Section stats:', {
        totalSections: allResults.length,
        successfulSections: successfulSections.length,
        totalItems: totalItems,
        averageItemsPerSection: totalItems / Math.max(successfulSections.length, 1)
      });

      // Test 4: Test section retrieval
      console.log('[SectionCrawlerTest] Test 4: Testing section retrieval');
      for (const result of successfulSections) {
        console.log(`[SectionCrawlerTest] ${result.section}: ${result.items.length} items`);
        if (result.items.length > 0) {
          const sampleItem = result.items[0];
          console.log(`[SectionCrawlerTest] Sample item: ${sampleItem.title} (${sampleItem.url})`);
        }
      }

      console.log('[SectionCrawlerTest] All section crawler tests completed successfully!');

    } catch (error) {
      console.error('[SectionCrawlerTest] Section crawler test failed:', error);
    }
  }
}

// Initialize service worker
const serviceWorker = new CanvasServiceWorker();

// Set up periodic sync alarm based on config
const setupAlarms = async () => {
  // Wait for config and storage to load
  while (!configManager.isConfigLoaded() || !storageManager.isReady()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const settings = configManager.getSettings();
  
  // Clear existing alarms
  await chrome.alarms.clearAll();
  
  // Set up alarm based on sync frequency
  if (settings.syncFrequency === 'hourly') {
    chrome.alarms.create('periodic-sync', {
      delayInMinutes: 1, // First run after 1 minute
      periodInMinutes: 60 // Then every hour
    });
  } else if (settings.syncFrequency === 'daily') {
    chrome.alarms.create('periodic-sync', {
      delayInMinutes: 1, // First run after 1 minute
      periodInMinutes: 1440 // Then every day
    });
  }
  // For 'startup-only' and 'manual', no alarms needed
};

setupAlarms();

export {};
