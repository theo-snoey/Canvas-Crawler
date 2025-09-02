// Canvas Ghost-Tab Scraper Service Worker
// Handles startup, auth probe, crawl orchestration, and background tasks

interface CrawlState {
  isAuthenticated: boolean;
  lastCrawl: number | null;
  currentTask: string | null;
  errorCount: number;
}

class CanvasServiceWorker {
  private state: CrawlState = {
    isAuthenticated: false,
    lastCrawl: null,
    currentTask: null,
    errorCount: 0
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
      
      // Try to fetch Canvas dashboard with credentials
      const response = await fetch('https://canvas.instructure.com/', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (response.ok && response.url.includes('canvas')) {
        this.state.isAuthenticated = true;
        console.log('[ServiceWorker] User authenticated with Canvas');
        await this.startCrawl();
      } else {
        this.state.isAuthenticated = false;
        console.log('[ServiceWorker] User not authenticated');
        await this.promptForLogin();
      }
    } catch (error) {
      console.error('[ServiceWorker] Auth probe failed:', error);
      this.state.isAuthenticated = false;
      await this.promptForLogin();
    } finally {
      this.state.currentTask = null;
    }
  }

  private async promptForLogin(): Promise<void> {
    // Show notification to user
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Canvas Scraper',
      message: 'Please log in to Canvas to enable data crawling'
    });

    // Open login tab
    await chrome.tabs.create({
      url: 'https://canvas.instructure.com/login',
      active: false
    });
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
          sendResponse({ isAuthenticated: this.state.isAuthenticated });
          break;
        
        default:
          console.warn('[ServiceWorker] Unknown message type:', message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[ServiceWorker] Message handling error:', error);
      sendResponse({ error: error.message });
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

// Set up periodic sync alarm (hourly)
chrome.alarms.create('periodic-sync', {
  delayInMinutes: 1, // First run after 1 minute
  periodInMinutes: 60 // Then every hour
});

export {};
