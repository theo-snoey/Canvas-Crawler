// Canvas Ghost-Tab Scraper Service Worker
// Handles startup, auth probe, crawl orchestration, and background tasks

import { authManager } from './authManager';
import { configManager } from './configManager';

interface CrawlState {
  isAuthenticated: boolean;
  lastCrawl: number | null;
  currentTask: string | null;
  errorCount: number;
  authenticatedHost: string | null;
}

class CanvasServiceWorker {
  private state: CrawlState = {
    isAuthenticated: false,
    lastCrawl: null,
    currentTask: null,
    errorCount: 0,
    authenticatedHost: null
  };

  constructor() {
    this.initializeListeners();
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

  private async handleStartup(): Promise<void> {
    console.log('[ServiceWorker] Chrome startup detected');
    await this.performAuthProbe();
  }

  private async handleInstalled(): Promise<void> {
    console.log('[ServiceWorker] Extension installed');
    await this.performAuthProbe();
  }

  private async performAuthProbe(): Promise<void> {
    try {
      this.state.currentTask = 'auth-probe';
      
      // Wait for config to load
      while (!configManager.isConfigLoaded()) {
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
    }
  }

  private async startCrawl(): Promise<void> {
    console.log('[ServiceWorker] Starting crawl...');
    // TODO: Implement crawl queue in Phase 4
    this.state.lastCrawl = Date.now();
  }

  private async handleMessage(
    message: any, 
    sender: chrome.runtime.MessageSender, 
    sendResponse: (response?: any) => void
  ): Promise<void> {
    try {
      switch (message.type) {
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
    }
  }
}

// Initialize service worker
const serviceWorker = new CanvasServiceWorker();

// Set up periodic sync alarm based on config
const setupAlarms = async () => {
  // Wait for config to load
  while (!configManager.isConfigLoaded()) {
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
