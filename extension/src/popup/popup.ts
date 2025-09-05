// Popup script for Canvas Scraper
// Handles UI updates and user interactions

interface ExtensionState {
  isAuthenticated: boolean;
  lastSync: number | null;
  currentTask: string | null;
  authenticatedHost: string | null;
  storageStats?: {
    htmlSnapshots: number;
    structured: number;
    extractedText: number;
    blobs: number;
    totalSize: number;
  };
  queueStats?: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    retries: number;
  };
  currentSession?: {
    id: string;
    startTime: number;
    status: string;
    tasksScheduled: number;
    tasksCompleted: number;
    tasksFailed: number;
  };
}

class PopupManager {
  private state: ExtensionState = {
    isAuthenticated: false,
    lastSync: null,
    currentTask: null,
    authenticatedHost: null
  };

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadState();
    this.setupEventListeners();
    this.updateUI();
  }

  private async loadState(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      this.state = response.state;
      
      // Load storage stats
      const statsResponse = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
      if (statsResponse.success) {
        this.state.storageStats = statsResponse.stats;
      }

      // Load queue stats
      const queueResponse = await chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATS' });
      if (queueResponse.success) {
        this.state.queueStats = queueResponse.stats;
      }

      // Load current session
      const sessionResponse = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_SESSION' });
      if (sessionResponse.success && sessionResponse.session) {
        this.state.currentSession = sessionResponse.session;
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  }

  private setupEventListeners(): void {
    // Check auth button
    const checkAuthBtn = document.getElementById('checkAuth') as HTMLButtonElement;
    if (checkAuthBtn) {
      checkAuthBtn.addEventListener('click', () => this.checkAuth());
    }

    // Start crawl button
    const startCrawlBtn = document.getElementById('startCrawl') as HTMLButtonElement;
    if (startCrawlBtn) {
      startCrawlBtn.addEventListener('click', () => this.startCrawl());
    }

    // Clear storage button
    const clearStorageBtn = document.getElementById('clearStorage') as HTMLButtonElement;
    if (clearStorageBtn) {
      clearStorageBtn.addEventListener('click', () => this.clearStorage());
    }

    // Clear queue button
    const clearQueueBtn = document.getElementById('clearQueue') as HTMLButtonElement;
    if (clearQueueBtn) {
      clearQueueBtn.addEventListener('click', () => this.clearQueue());
    }

    // Cancel crawl button
    const cancelCrawlBtn = document.getElementById('cancelCrawl') as HTMLButtonElement;
    if (cancelCrawlBtn) {
      cancelCrawlBtn.addEventListener('click', () => this.cancelCrawl());
    }

    // Test queue button
    const testQueueBtn = document.getElementById('testQueue') as HTMLButtonElement;
    if (testQueueBtn) {
      testQueueBtn.addEventListener('click', () => this.testQueue());
    }

    // Test page loader button
    const testPageLoaderBtn = document.getElementById('testPageLoader') as HTMLButtonElement;
    if (testPageLoaderBtn) {
      testPageLoaderBtn.addEventListener('click', () => this.testPageLoader());
    }

    // Test ghost tab button
    const testGhostTabBtn = document.getElementById('testGhostTab') as HTMLButtonElement;
    if (testGhostTabBtn) {
      testGhostTabBtn.addEventListener('click', () => this.testGhostTab());
    }

    // Test course discovery button
    const testCourseDiscoveryBtn = document.getElementById('testCourseDiscovery') as HTMLButtonElement;
    if (testCourseDiscoveryBtn) {
      testCourseDiscoveryBtn.addEventListener('click', () => this.testCourseDiscovery());
    }

    // Test section crawlers button
    const testSectionCrawlersBtn = document.getElementById('testSectionCrawlers') as HTMLButtonElement;
    if (testSectionCrawlersBtn) {
      testSectionCrawlersBtn.addEventListener('click', () => this.testSectionCrawlers());
    }

    // Test all sections button
    const testAllSectionsBtn = document.getElementById('testAllSections') as HTMLButtonElement;
    if (testAllSectionsBtn) {
      testAllSectionsBtn.addEventListener('click', () => this.testAllSections());
    }

    // Test section parsing button
    const testSectionParsingBtn = document.getElementById('testSectionParsing') as HTMLButtonElement;
    if (testSectionParsingBtn) {
      testSectionParsingBtn.addEventListener('click', () => this.testSectionParsing());
    }

    // View all data button
    const viewAllDataBtn = document.getElementById('viewAllData') as HTMLButtonElement;
    if (viewAllDataBtn) {
      viewAllDataBtn.addEventListener('click', () => this.viewAllData());
    }

    // Show content counts button
    const showContentCountsBtn = document.getElementById('showContentCounts') as HTMLButtonElement;
    if (showContentCountsBtn) {
      showContentCountsBtn.addEventListener('click', () => this.showContentCounts());
    }

    // Debug HTML patterns button
    const debugHtmlPatternsBtn = document.getElementById('debugHtmlPatterns') as HTMLButtonElement;
    if (debugHtmlPatternsBtn) {
      debugHtmlPatternsBtn.addEventListener('click', () => this.debugHtmlPatterns());
    }

    // Test detail crawlers button
    const testDetailCrawlersBtn = document.getElementById('testDetailCrawlers') as HTMLButtonElement;
    if (testDetailCrawlersBtn) {
      testDetailCrawlersBtn.addEventListener('click', () => this.testDetailCrawlers());
    }

    // Test single assignment button
    const testSingleAssignmentBtn = document.getElementById('testSingleAssignment') as HTMLButtonElement;
    if (testSingleAssignmentBtn) {
      testSingleAssignmentBtn.addEventListener('click', () => this.testSingleAssignment());
    }

    // Test all assignments button
    const testAllAssignmentsBtn = document.getElementById('testAllAssignments') as HTMLButtonElement;
    if (testAllAssignmentsBtn) {
      testAllAssignmentsBtn.addEventListener('click', () => this.testAllAssignments());
    }

    // Test quiz details button
    const testQuizDetailsBtn = document.getElementById('testQuizDetails') as HTMLButtonElement;
    if (testQuizDetailsBtn) {
      testQuizDetailsBtn.addEventListener('click', () => this.testQuizDetails());
    }

    // Test files pipeline button
    const testFilesPipelineBtn = document.getElementById('testFilesPipeline') as HTMLButtonElement;
    if (testFilesPipelineBtn) {
      testFilesPipelineBtn.addEventListener('click', () => this.testFilesPipeline());
    }

    // Test incremental sync button
    const testIncrementalSyncBtn = document.getElementById('testIncrementalSync') as HTMLButtonElement;
    if (testIncrementalSyncBtn) {
      testIncrementalSyncBtn.addEventListener('click', () => this.testIncrementalSync());
    }

    // Run all tests button
    const runAllTestsBtn = document.getElementById('runAllTests') as HTMLButtonElement;
    if (runAllTestsBtn) {
      runAllTestsBtn.addEventListener('click', () => this.runAllTests());
    }

    // Options button
    const optionsBtn = document.getElementById('options') as HTMLButtonElement;
    if (optionsBtn) {
      optionsBtn.addEventListener('click', () => this.openOptions());
    }

    // Open status page
    const openStatusBtn = document.getElementById('openStatus') as HTMLButtonElement;
    if (openStatusBtn) {
      openStatusBtn.addEventListener('click', () => this.openStatus());
    }
  }

  private updateUI(): void {
    // Update status text
    const statusElement = document.getElementById('status');
    if (statusElement) {
      if (this.state.isAuthenticated) {
        const hostname = this.state.authenticatedHost ? 
          new URL(this.state.authenticatedHost).hostname : 'Canvas';
        statusElement.textContent = `Authenticated (${hostname})`;
        statusElement.className = 'status authenticated';
      } else {
        statusElement.textContent = 'Not authenticated';
        statusElement.className = 'status not-authenticated';
      }
    }

    // Update last sync
    const lastSyncElement = document.getElementById('lastSync');
    if (lastSyncElement) {
      if (this.state.lastSync) {
        const date = new Date(this.state.lastSync);
        lastSyncElement.textContent = `Last Sync: ${date.toLocaleString()}`;
      } else {
        lastSyncElement.textContent = 'Last Sync: Never';
      }
    }

    // Update current task
    const currentTaskElement = document.getElementById('currentTask');
    if (currentTaskElement) {
      currentTaskElement.textContent = `Current Task: ${this.state.currentTask || 'Idle'}`;
    }

    // Update storage stats
    const storageStatsElement = document.getElementById('storageStats');
    if (storageStatsElement && this.state.storageStats) {
      const stats = this.state.storageStats;
      const totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
      storageStatsElement.innerHTML = `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">HTML Snapshots:</span>
            <span class="stat-value">${stats.htmlSnapshots}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Structured Data:</span>
            <span class="stat-value">${stats.structured}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Extracted Text:</span>
            <span class="stat-value">${stats.extractedText}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Blobs:</span>
            <span class="stat-value">${stats.blobs}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Total Size:</span>
            <span class="stat-value">${totalSizeMB} MB</span>
          </div>
        </div>
      `;
    }

    // Update queue stats
    const queueStatsElement = document.getElementById('queueStats');
    if (queueStatsElement && this.state.queueStats) {
      const stats = this.state.queueStats;
      queueStatsElement.innerHTML = `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Total Tasks:</span>
            <span class="stat-value">${stats.total}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Pending:</span>
            <span class="stat-value">${stats.pending}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Running:</span>
            <span class="stat-value">${stats.running}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Completed:</span>
            <span class="stat-value">${stats.completed}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Failed:</span>
            <span class="stat-value">${stats.failed}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Retries:</span>
            <span class="stat-value">${stats.retries}</span>
          </div>
        </div>
      `;
    }

    // Update current session
    const sessionElement = document.getElementById('currentSession');
    if (sessionElement && this.state.currentSession) {
      const session = this.state.currentSession;
      const startTime = new Date(session.startTime).toLocaleString();
      sessionElement.innerHTML = `
        <div class="session-info">
          <div class="session-header">
            <span class="session-id">${session.id}</span>
            <span class="session-status ${session.status}">${session.status}</span>
          </div>
          <div class="session-details">
            <div>Started: ${startTime}</div>
            <div>Progress: ${session.tasksCompleted}/${session.tasksScheduled} completed</div>
            <div>Failed: ${session.tasksFailed}</div>
          </div>
        </div>
      `;
    } else if (sessionElement) {
      sessionElement.innerHTML = '<div class="no-session">No active crawl session</div>';
    }

    // Update button states
    this.updateButtonStates();
  }

  private updateButtonStates(): void {
    const checkAuthBtn = document.getElementById('checkAuth') as HTMLButtonElement;
    const startCrawlBtn = document.getElementById('startCrawl') as HTMLButtonElement;
    const clearStorageBtn = document.getElementById('clearStorage') as HTMLButtonElement;
    const clearQueueBtn = document.getElementById('clearQueue') as HTMLButtonElement;
    const cancelCrawlBtn = document.getElementById('cancelCrawl') as HTMLButtonElement;
    const testQueueBtn = document.getElementById('testQueue') as HTMLButtonElement;

    if (checkAuthBtn) {
      checkAuthBtn.disabled = this.state.currentTask === 'auth-probe';
    }

    if (startCrawlBtn) {
      startCrawlBtn.disabled = !this.state.isAuthenticated || this.state.currentTask !== null || (this.state.currentSession?.status === 'running');
    }

    if (clearStorageBtn) {
      clearStorageBtn.disabled = this.state.currentTask !== null;
    }

    if (clearQueueBtn) {
      clearQueueBtn.disabled = this.state.currentTask !== null;
    }

    if (cancelCrawlBtn) {
      cancelCrawlBtn.disabled = !this.state.currentSession || this.state.currentSession.status !== 'running';
    }

    if (testQueueBtn) {
      testQueueBtn.disabled = this.state.currentTask !== null;
    }
  }

  private async checkAuth(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AUTH_CHECK' });
      this.state.isAuthenticated = response.isAuthenticated;
      this.state.authenticatedHost = response.host;
      this.updateUI();
    } catch (error) {
      console.error('Auth check failed:', error);
    }
  }

  private async startCrawl(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'START_CRAWL' });
      this.state.currentTask = 'crawling';
      this.updateUI();
    } catch (error) {
      console.error('Start crawl failed:', error);
    }
  }

  private async clearStorage(): Promise<void> {
    if (confirm('Are you sure you want to clear all stored data? This action cannot be undone.')) {
      try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_STORAGE' });
        this.state.storageStats = {
          htmlSnapshots: 0,
          structured: 0,
          extractedText: 0,
          blobs: 0,
          totalSize: 0
        };
        this.updateUI();
      } catch (error) {
        console.error('Clear storage failed:', error);
      }
    }
  }

  private async clearQueue(): Promise<void> {
    if (confirm('Are you sure you want to clear the crawl queue? This will cancel all pending tasks.')) {
      try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
        this.state.queueStats = {
          total: 0,
          pending: 0,
          running: 0,
          completed: 0,
          failed: 0,
          retries: 0
        };
        this.updateUI();
      } catch (error) {
        console.error('Clear queue failed:', error);
      }
    }
  }

  private async cancelCrawl(): Promise<void> {
    if (confirm('Are you sure you want to cancel the current crawl session?')) {
      try {
        await chrome.runtime.sendMessage({ type: 'CANCEL_CRAWL' });
        this.state.currentSession = undefined;
        this.updateUI();
      } catch (error) {
        console.error('Cancel crawl failed:', error);
      }
    }
  }

  private async testQueue(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_QUEUE' });
      console.log('Queue test started, check service worker console for results');
    } catch (error) {
      console.error('Test queue failed:', error);
    }
  }

  private async testPageLoader(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_PAGE_LOADER' });
      console.log('Page loader test started, check service worker console for results');
    } catch (error) {
      console.error('Test page loader failed:', error);
    }
  }

  private async testGhostTab(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_GHOST_TAB' });
      console.log('Ghost tab test started, check service worker console for results');
    } catch (error) {
      console.error('Test ghost tab failed:', error);
    }
  }

  private async testCourseDiscovery(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_COURSE_DISCOVERY' });
      console.log('Course discovery test started, check service worker console for results');
    } catch (error) {
      console.error('Test course discovery failed:', error);
    }
  }

  private async testSectionCrawlers(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'CRAWL_SECTIONS_PHASE8' });
      console.log('Section crawlers test V2 started, check service worker console for results');
    } catch (error) {
      console.error('Test section crawlers failed:', error);
    }
  }

  private async testAllSections(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_ALL_SECTIONS_PHASE8' });
      console.log('All sections test started, check service worker console for results');
    } catch (error) {
      console.error('Test all sections failed:', error);
    }
  }

  private async testSectionParsing(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_SECTION_PARSING_PHASE8' });
      console.log('Section parsing test started, check service worker console for results');
    } catch (error) {
      console.error('Test section parsing failed:', error);
    }
  }

  private async viewAllData(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'VIEW_ALL_DATA' });
      console.log('Data viewer started, check service worker console for all collected data');
    } catch (error) {
      console.error('View all data failed:', error);
    }
  }

  private async showContentCounts(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'SHOW_CONTENT_COUNTS' });
      console.log('Content counts started, check service worker console for detailed breakdown');
    } catch (error) {
      console.error('Show content counts failed:', error);
    }
  }

  private async debugHtmlPatterns(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'DEBUG_HTML_PATTERNS' });
      console.log('HTML pattern debugging started, check service worker console for actual HTML samples');
    } catch (error) {
      console.error('Debug HTML patterns failed:', error);
    }
  }

  private async testDetailCrawlers(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_DETAIL_CRAWLERS_PHASE9' });
      console.log('Detail crawlers test started, check service worker console for detailed content extraction');
    } catch (error) {
      console.error('Test detail crawlers failed:', error);
    }
  }

  private async testSingleAssignment(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_SINGLE_ASSIGNMENT_PHASE9' });
      console.log('Single assignment test started, check service worker console for assignment details');
    } catch (error) {
      console.error('Test single assignment failed:', error);
    }
  }

  private async testAllAssignments(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_ALL_ASSIGNMENTS_PHASE9' });
      console.log('All assignments test started, check service worker console for all assignment details');
    } catch (error) {
      console.error('Test all assignments failed:', error);
    }
  }

  private async testQuizDetails(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_QUIZ_DETAILS_PHASE9' });
      console.log('Quiz details test started, check service worker console for quiz content');
    } catch (error) {
      console.error('Test quiz details failed:', error);
    }
  }

  private async testFilesPipeline(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_FILES_PIPELINE_PHASE10' });
      console.log('Files pipeline test started, check service worker console for file processing results');
    } catch (error) {
      console.error('Test files pipeline failed:', error);
    }
  }

  private async testIncrementalSync(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'TEST_INCREMENTAL_SYNC_PHASE11' });
      console.log('Incremental sync test started, check service worker console for caching and change detection results');
    } catch (error) {
      console.error('Test incremental sync failed:', error);
    }
  }

  private async runAllTests(): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'RUN_ALL_TESTS' });
      console.log('Full test suite started, check service worker console for results');
    } catch (error) {
      console.error('Run all tests failed:', error);
    }
  }

  private openOptions(): void {
    chrome.runtime.openOptionsPage();
  }

  private openStatus(): void {
    // Open the built status page from dist
    const url = chrome.runtime.getURL('status/status.html');
    chrome.tabs.create({ url });
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});

