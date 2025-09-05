// Scheduler for Canvas Scraper
// Handles periodic crawling, alarm management, and crawl lifecycle

import { queueManager, CrawlTask } from './queueManager';
import { configManager } from './configManager';
import { authManager } from './authManager';
import { storageManager } from './storageManager';

export interface SchedulerConfig {
  enabled: boolean;
  syncFrequency: 'startup-only' | 'hourly' | 'daily' | 'manual';
  crawlDelayMs: number;
  maxCrawlDurationMs: number;
  enableIncrementalSync: boolean;
}

export interface CrawlSession {
  id: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  tasksScheduled: number;
  tasksCompleted: number;
  tasksFailed: number;
  error?: string;
}

export class Scheduler {
  private currentSession: CrawlSession | null = null;
  private config: SchedulerConfig;
  private isRunning = false;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.initializeAlarms();
  }

  // Alarm Management
  private async initializeAlarms(): Promise<void> {
    try {
      // Clear existing alarms
      await chrome.alarms.clearAll();
      
      if (!this.config.enabled) {
        console.log('[Scheduler] Alarms disabled');
        return;
      }

      // Set up alarm based on sync frequency
      switch (this.config.syncFrequency) {
        case 'hourly':
          chrome.alarms.create('periodic-crawl', {
            delayInMinutes: 1, // First run after 1 minute
            periodInMinutes: 60 // Then every hour
          });
          console.log('[Scheduler] Hourly crawl alarm created');
          break;
          
        case 'daily':
          chrome.alarms.create('periodic-crawl', {
            delayInMinutes: 1, // First run after 1 minute
            periodInMinutes: 1440 // Then every day
          });
          console.log('[Scheduler] Daily crawl alarm created');
          break;
          
        case 'startup-only':
        case 'manual':
          console.log('[Scheduler] No periodic alarms (startup-only/manual mode)');
          break;
      }
    } catch (error) {
      console.error('[Scheduler] Failed to initialize alarms:', error);
    }
  }

  // Crawl Session Management
  async startCrawlSession(): Promise<string> {
    // Atomic check and set - prevent race conditions
    if (this.isRunning) {
      console.log('[Scheduler] Crawl session already running, rejecting request');
      throw new Error('Crawl session already running');
    }
    
    // Set running flag immediately to prevent race conditions
    this.isRunning = true;
    console.log('[Scheduler] Set isRunning = true');
    
    try {
      // Check authentication
      const authResult = await authManager.performAuthProbe();
      if (!authResult.isAuthenticated) {
        this.isRunning = false; // Reset flag on auth failure
        throw new Error('User not authenticated');
      }

      const sessionId = `crawl_${Date.now()}`;
    
      this.currentSession = {
        id: sessionId,
        startTime: Date.now(),
        status: 'running',
        tasksScheduled: 0,
        tasksCompleted: 0,
        tasksFailed: 0
      };

      console.log(`[Scheduler] Starting crawl session ${sessionId}`);
      
      // Schedule initial tasks
      await this.scheduleInitialTasks();
      
      // Start queue processing
      await this.monitorCrawlProgress();
      
      return sessionId;
      
    } catch (error: unknown) {
      // Reset running flag on any error
      this.isRunning = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // If we have a session, end it properly
      if (this.currentSession) {
        await this.endCrawlSession('failed', errorMessage);
      }
      
      throw error;
    }
  }

  async endCrawlSession(status: 'completed' | 'failed' | 'cancelled', error?: string): Promise<void> {
    if (!this.currentSession) {
      console.warn('[Scheduler] No active crawl session to end');
      return;
    }

    this.currentSession.endTime = Date.now();
    this.currentSession.status = status;
    if (error) {
      this.currentSession.error = error;
    }

    this.isRunning = false;
    console.log('[Scheduler] Set isRunning = false');
    
    console.log(`[Scheduler] Crawl session ${this.currentSession.id} ended with status: ${status}`);
    
    // Save session results
    await this.saveCrawlSession();
    
    // Update student index
    await storageManager.updateStudentIndex({
      lastCrawl: Date.now()
    });
    
    this.currentSession = null;
  }

  private async scheduleInitialTasks(): Promise<void> {
    if (!this.currentSession) return;

    const hosts = configManager.getHosts();
    if (hosts.length === 0) {
      throw new Error('No Canvas hosts configured');
    }

    const primaryHost = hosts[0]; // Use first host for now
    
    // Schedule dashboard crawl (highest priority)
    await queueManager.addTask({
      type: 'dashboard',
      url: `${primaryHost}/dashboard`,
      priority: 10,
      maxRetries: 3,
      scheduledFor: Date.now()
    });
    this.currentSession.tasksScheduled++;

    // Schedule course list crawl
    await queueManager.addTask({
      type: 'course-list',
      url: `${primaryHost}/courses`,
      priority: 9,
      maxRetries: 3,
      scheduledFor: Date.now() + 1000 // 1 second delay
    });
    this.currentSession.tasksScheduled++;

    console.log(`[Scheduler] Scheduled ${this.currentSession.tasksScheduled} initial tasks`);
  }

  private async monitorCrawlProgress(): Promise<void> {
    if (!this.currentSession) return;

    const maxDuration = this.config.maxCrawlDurationMs;
    const startTime = Date.now();

    while (this.isRunning && (Date.now() - startTime) < maxDuration) {
      const stats = queueManager.getStats();
      
      // Update session progress
      this.currentSession.tasksCompleted = stats.completed;
      this.currentSession.tasksFailed = stats.failed;
      
      // Check if all tasks are complete
      if (stats.pending === 0 && stats.running === 0) {
        console.log('[Scheduler] All tasks completed');
        await this.endCrawlSession('completed');
        return;
      }
      
      // Check for timeout
      if ((Date.now() - startTime) >= maxDuration) {
        console.log('[Scheduler] Crawl session timed out');
        await this.endCrawlSession('cancelled', 'Session timed out');
        return;
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Task Scheduling Helpers
  async scheduleCourseTasks(courseId: string, courseUrl: string): Promise<void> {
    const tasks: Array<Omit<CrawlTask, 'id' | 'retryCount' | 'createdAt'>> = [
      {
        type: 'announcements',
        url: `${courseUrl}/announcements`,
        courseId,
        priority: 8,
        maxRetries: 3,
        scheduledFor: Date.now()
      },
      {
        type: 'assignments',
        url: `${courseUrl}/assignments`,
        courseId,
        priority: 8,
        maxRetries: 3,
        scheduledFor: Date.now() + 1000
      },
      {
        type: 'discussions',
        url: `${courseUrl}/discussions`,
        courseId,
        priority: 7,
        maxRetries: 3,
        scheduledFor: Date.now() + 2000
      },
      {
        type: 'pages',
        url: `${courseUrl}/pages`,
        courseId,
        priority: 6,
        maxRetries: 3,
        scheduledFor: Date.now() + 3000
      },
      {
        type: 'files',
        url: `${courseUrl}/files`,
        courseId,
        priority: 5,
        maxRetries: 3,
        scheduledFor: Date.now() + 4000
      },
      {
        type: 'quizzes',
        url: `${courseUrl}/quizzes`,
        courseId,
        priority: 5,
        maxRetries: 3,
        scheduledFor: Date.now() + 5000
      },
      {
        type: 'modules',
        url: `${courseUrl}/modules`,
        courseId,
        priority: 6,
        maxRetries: 3,
        scheduledFor: Date.now() + 6000
      },
      {
        type: 'grades',
        url: `${courseUrl}/grades`,
        courseId,
        priority: 7,
        maxRetries: 3,
        scheduledFor: Date.now() + 7000
      },
      {
        type: 'people',
        url: `${courseUrl}/users`,
        courseId,
        priority: 4,
        maxRetries: 3,
        scheduledFor: Date.now() + 8000
      },
      {
        type: 'syllabus',
        url: `${courseUrl}/syllabus`,
        courseId,
        priority: 8,
        maxRetries: 3,
        scheduledFor: Date.now() + 9000
      }
    ];

    for (const task of tasks) {
      await queueManager.addTask(task);
      if (this.currentSession) {
        this.currentSession.tasksScheduled++;
      }
    }

    console.log(`[Scheduler] Scheduled ${tasks.length} tasks for course ${courseId}`);
  }

  // Session Management
  async getCurrentSession(): Promise<CrawlSession | null> {
    return this.currentSession;
  }

  async getSessionHistory(): Promise<CrawlSession[]> {
    try {
      const result = await chrome.storage.local.get(['crawlSessions']);
      return result.crawlSessions || [];
    } catch (error) {
      console.error('[Scheduler] Failed to load session history:', error);
      return [];
    }
  }

  private async saveCrawlSession(): Promise<void> {
    if (!this.currentSession) return;

    try {
      const result = await chrome.storage.local.get(['crawlSessions']);
      const sessions = result.crawlSessions || [];
      
      // Add current session to history
      sessions.push(this.currentSession);
      
      // Keep only last 10 sessions
      if (sessions.length > 10) {
        sessions.splice(0, sessions.length - 10);
      }
      
      await chrome.storage.local.set({ crawlSessions: sessions });
    } catch (error) {
      console.error('[Scheduler] Failed to save crawl session:', error);
    }
  }

  // Configuration
  async updateConfig(newConfig: Partial<SchedulerConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    await this.initializeAlarms();
  }

  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  // Utility Methods
  isCrawlRunning(): boolean {
    return this.isRunning;
  }

  async cancelCrawl(): Promise<void> {
    if (this.currentSession) {
      await this.endCrawlSession('cancelled', 'Cancelled by user');
    }
  }

  async clearHistory(): Promise<void> {
    await chrome.storage.local.remove(['crawlSessions']);
    console.log('[Scheduler] Session history cleared');
  }
}

// Default configuration
export const defaultSchedulerConfig: SchedulerConfig = {
  enabled: true,
  syncFrequency: 'startup-only',
  crawlDelayMs: 1000,
  maxCrawlDurationMs: 300000, // 5 minutes
  enableIncrementalSync: true
};

export const scheduler = new Scheduler(defaultSchedulerConfig);
