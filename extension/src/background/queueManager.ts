// Queue Manager for Canvas Scraper
// Handles prioritized work queue, concurrency controls, retry logic, and persistence

import { pageLoader, FetchResult } from './pageLoader';
import { htmlParser, ParsedContent } from './htmlParser';
import { storageManager } from './storageManager';
import { courseDiscovery } from './courseDiscovery';
import { studentIndexManager } from './studentIndex';

export interface CrawlTask {
  id: string;
  type: 'dashboard' | 'course-list' | 'announcements' | 'assignments' | 'discussions' | 'pages' | 'files' | 'quizzes' | 'modules' | 'grades' | 'people' | 'syllabus';
  url: string;
  courseId?: string;
  priority: number; // 1-10, higher is more important
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  scheduledFor: number;
  lastAttempt?: number;
  error?: string;
  metadata?: any;
}

export interface QueueStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  retries: number;
}

export interface ConcurrencyConfig {
  maxConcurrentTasks: number;
  maxConcurrentGhostTabs: number;
  taskTimeoutMs: number;
  retryDelayMs: number;
  maxRetries: number;
}

export class QueueManager {
  private queue: CrawlTask[] = [];
  private running: Set<string> = new Set();
  private completed: Set<string> = new Set();
  private failed: Set<string> = new Set();
  private config: ConcurrencyConfig;
  private isProcessing = false;
  private processingInterval: number | null = null;

  constructor(config: ConcurrencyConfig) {
    this.config = config;
    this.loadQueue();
  }

  // Queue Management
  async addTask(task: Omit<CrawlTask, 'id' | 'retryCount' | 'createdAt'>): Promise<string> {
    const id = this.generateTaskId(task.type, task.url);
    const crawlTask: CrawlTask = {
      ...task,
      id,
      retryCount: 0,
      createdAt: Date.now()
    };

    // Check if task already exists
    const existingIndex = this.queue.findIndex(t => t.id === id);
    if (existingIndex >= 0) {
      // Update existing task if it has higher priority
      if (crawlTask.priority > this.queue[existingIndex].priority) {
        this.queue[existingIndex] = crawlTask;
        console.log(`[QueueManager] Updated task ${id} with higher priority`);
      }
    } else {
      this.queue.push(crawlTask);
      console.log(`[QueueManager] Added task ${id} to queue`);
    }

    await this.saveQueue();
    this.startProcessing();
    return id;
  }

  async removeTask(taskId: string): Promise<boolean> {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      await this.saveQueue();
      console.log(`[QueueManager] Removed task ${taskId} from queue`);
      return true;
    }
    return false;
  }

  async getTask(taskId: string): Promise<CrawlTask | null> {
    return this.queue.find(t => t.id === taskId) || null;
  }

  async getAllTasks(): Promise<CrawlTask[]> {
    return [...this.queue];
  }

  // Queue Processing
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('[QueueManager] Starting queue processing');
    
    // Use the correct global object for setInterval in service worker context
    const globalObj = (typeof globalThis !== 'undefined' ? globalThis : 
                      typeof self !== 'undefined' ? self : 
                      typeof window !== 'undefined' ? window : 
                      this) as any;
    
    this.processingInterval = globalObj.setInterval(() => {
      this.processQueue();
    }, 1000); // Check every second
  }

  private async processQueue(): Promise<void> {
    if (this.running.size >= this.config.maxConcurrentTasks) {
      return; // At capacity
    }

    // Sort queue by priority and scheduled time
    this.queue.sort((a, b) => {
      if (a.scheduledFor !== b.scheduledFor) {
        return a.scheduledFor - b.scheduledFor;
      }
      return b.priority - a.priority; // Higher priority first
    });

    // Process ready tasks
    for (const task of this.queue) {
      if (this.running.size >= this.config.maxConcurrentTasks) break;
      
      if (task.scheduledFor <= Date.now() && !this.running.has(task.id)) {
        await this.executeTask(task);
      }
    }
  }

  private async executeTask(task: CrawlTask): Promise<void> {
    this.running.add(task.id);
    task.lastAttempt = Date.now();
    
    console.log(`[QueueManager] Executing task ${task.id} (${task.type})`);
    
    try {
      // Fetch the page using pageLoader
      const fetchResult = await pageLoader.fetchPage(task.url);
      
      if (!fetchResult.success) {
        throw new Error(`HTTP ${fetchResult.status}: ${fetchResult.error || fetchResult.statusText}`);
      }
      
      if (!fetchResult.text) {
        throw new Error('No content received from page');
      }
      
      // Parse the HTML content
      let parsedContent: ParsedContent;
      let extractedData: any = {};
      
      switch (task.type) {
        case 'dashboard':
          parsedContent = htmlParser.parseDashboard(fetchResult.text);
          
          // Course discovery processing
          const dashboardCourses = courseDiscovery.parseDashboard(fetchResult.text);
          console.log(`[QueueManager] Discovered ${dashboardCourses.length} courses from dashboard`);
          
          if (dashboardCourses.length > 0) {
            await studentIndexManager.updateCourses(dashboardCourses);
          }
          
          extractedData = {
            courses: (parsedContent as any).courses || [],
            discoveredCourses: dashboardCourses,
            title: parsedContent.title,
            links: parsedContent.links.filter(link => link.href.includes('/courses/'))
          };
          break;
          
        case 'course-list':
          parsedContent = htmlParser.parseCourseList(fetchResult.text);
          
          // Course discovery processing
          const courseListCourses = courseDiscovery.parseCourseList(fetchResult.text);
          console.log(`[QueueManager] Discovered ${courseListCourses.length} courses from course list`);
          
          if (courseListCourses.length > 0) {
            await studentIndexManager.updateCourses(courseListCourses);
          }
          
          extractedData = {
            courses: (parsedContent as any).courses || [],
            discoveredCourses: courseListCourses,
            title: parsedContent.title
          };
          break;
          
        default:
          parsedContent = htmlParser.parseHtml(fetchResult.text);
          extractedData = {
            title: parsedContent.title,
            links: parsedContent.links,
            structure: parsedContent.structure
          };
          break;
      }
      
      // Save the raw HTML snapshot
      await storageManager.saveHtmlSnapshot({
        id: `${task.id}_snapshot`,
        url: task.url,
        html: fetchResult.text,
        timestamp: Date.now(),
        hash: await this.hashContent(fetchResult.text),
        size: fetchResult.text.length
      });
      
      // Save the parsed structured data
      await storageManager.saveStructuredData({
        id: `${task.id}_data`,
        courseId: task.courseId || 'dashboard',
        collection: task.type,
        itemId: task.id,
        data: {
          ...extractedData,
          fetchResult: {
            status: fetchResult.status,
            etag: fetchResult.etag,
            lastModified: fetchResult.lastModified,
            size: fetchResult.size,
            cached: fetchResult.cached
          }
        },
        timestamp: Date.now(),
        version: '1.0'
      });
      
      // Task completed successfully
      this.completed.add(task.id);
      this.running.delete(task.id);
      await this.removeTask(task.id);
      
      console.log(`[QueueManager] Task ${task.id} completed successfully (${fetchResult.text.length} bytes)`);
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      task.error = errorMessage;
      task.retryCount++;
      
      console.error(`[QueueManager] Task ${task.id} failed:`, errorMessage);
      
      if (task.retryCount >= this.config.maxRetries) {
        // Task failed permanently
        this.failed.add(task.id);
        this.running.delete(task.id);
        await this.removeTask(task.id);
        console.log(`[QueueManager] Task ${task.id} failed permanently after ${task.retryCount} retries`);

        // Record recent error for Status UI
        try {
          const key = 'recentErrors';
          const result = await chrome.storage.local.get([key]);
          const recent: Array<any> = Array.isArray(result[key]) ? result[key] : [];
          recent.unshift({
            id: task.id,
            type: task.type,
            url: task.url,
            error: task.error,
            when: Date.now()
          });
          // Cap to last 50
          const trimmed = recent.slice(0, 50);
          await chrome.storage.local.set({ [key]: trimmed });
        } catch (e) {
          console.warn('[QueueManager] Failed to record recent error');
        }
      } else {
        // Schedule retry with exponential backoff
        const delay = this.calculateRetryDelay(task.retryCount);
        task.scheduledFor = Date.now() + delay;
        this.running.delete(task.id);
        
        console.log(`[QueueManager] Task ${task.id} scheduled for retry in ${delay}ms`);
      }
    }
    
    await this.saveQueue();
  }



  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff with jitter
    const baseDelay = this.config.retryDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }

  // Queue Statistics
  getStats(): QueueStats {
    return {
      total: this.queue.length + this.running.size + this.completed.size + this.failed.size,
      pending: this.queue.length,
      running: this.running.size,
      completed: this.completed.size,
      failed: this.failed.size,
      retries: this.queue.reduce((sum, task) => sum + task.retryCount, 0)
    };
  }

  getRunningTasks(): string[] {
    return Array.from(this.running);
  }

  getCompletedTasks(): string[] {
    return Array.from(this.completed);
  }

  getFailedTasks(): string[] {
    return Array.from(this.failed);
  }

  // Persistence
  private async saveQueue(): Promise<void> {
    try {
      await chrome.storage.local.set({
        crawlQueue: this.queue,
        queueStats: {
          running: Array.from(this.running),
          completed: Array.from(this.completed),
          failed: Array.from(this.failed),
          lastUpdated: Date.now()
        }
      });
    } catch (error) {
      console.error('[QueueManager] Failed to save queue:', error);
    }
  }

  private async loadQueue(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['crawlQueue', 'queueStats']);
      
      if (result.crawlQueue) {
        this.queue = result.crawlQueue;
        console.log(`[QueueManager] Loaded ${this.queue.length} tasks from storage`);
      }
      
      if (result.queueStats) {
        this.running = new Set(result.queueStats.running || []);
        this.completed = new Set(result.queueStats.completed || []);
        this.failed = new Set(result.queueStats.failed || []);
        console.log(`[QueueManager] Loaded queue stats: ${this.running.size} running, ${this.completed.size} completed, ${this.failed.size} failed`);
      }
    } catch (error) {
      console.error('[QueueManager] Failed to load queue:', error);
    }
  }

  // Utility Methods
  private generateTaskId(type: string, url: string): string {
    const timestamp = Date.now();
    const urlHash = this.simpleHash(url);
    return `${type}_${timestamp}_${urlHash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Cleanup
  async clearQueue(): Promise<void> {
    this.queue = [];
    this.running.clear();
    this.completed.clear();
    this.failed.clear();
    await this.saveQueue();
    console.log('[QueueManager] Queue cleared');
  }

  async stopProcessing(): Promise<void> {
    this.isProcessing = false;
    if (this.processingInterval) {
      // Use the correct global object for clearInterval
      const globalObj = (typeof globalThis !== 'undefined' ? globalThis : 
                        typeof self !== 'undefined' ? self : 
                        typeof window !== 'undefined' ? window : 
                        this) as any;
      globalObj.clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('[QueueManager] Queue processing stopped');
  }

  // Task Scheduling
  async scheduleTask(task: Omit<CrawlTask, 'id' | 'retryCount' | 'createdAt'>, delayMs: number = 0): Promise<string> {
    const scheduledTask = {
      ...task,
      scheduledFor: Date.now() + delayMs
    };
    return this.addTask(scheduledTask);
  }

  async scheduleRecurringTask(task: Omit<CrawlTask, 'id' | 'retryCount' | 'createdAt'>, intervalMs: number): Promise<string> {
    // For now, just schedule once. In a full implementation, this would create recurring tasks
    return this.addTask(task);
  }
}

// Default configuration
export const defaultConcurrencyConfig: ConcurrencyConfig = {
  maxConcurrentTasks: 4,
  maxConcurrentGhostTabs: 2,
  taskTimeoutMs: 30000, // 30 seconds
  retryDelayMs: 1000,   // 1 second base delay
  maxRetries: 3
};

export const queueManager = new QueueManager(defaultConcurrencyConfig);
