// Ghost Tab Manager for Canvas Scraper
// Creates and manages background tabs for JavaScript-heavy content extraction

export interface GhostTabRequest {
  id: string;
  url: string;
  timeout?: number;
  waitFor?: {
    selector?: string;
    text?: string;
    timeout?: number;
  };
  actions?: Array<{
    type: 'click' | 'scroll' | 'wait' | 'expand';
    selector?: string;
    timeout?: number;
    value?: string | number;
  }>;
  extractors?: Array<{
    name: string;
    selector: string;
    attribute?: string;
    multiple?: boolean;
  }>;
}

export interface GhostTabResponse {
  id: string;
  success: boolean;
  html?: string;
  extractedData?: Record<string, any>;
  error?: string;
  timing: {
    created: number;
    loaded: number;
    completed: number;
    duration: number;
  };
}

export interface GhostTabConfig {
  maxConcurrentTabs: number;
  defaultTimeout: number;
  tabLifetime: number;
  windowState: 'normal' | 'fullscreen' | 'maximized';
  enableLogging: boolean;
}

export class GhostTabManager {
  private activeTabs = new Map<string, chrome.tabs.Tab>();
  private pendingRequests = new Map<string, {
    request: GhostTabRequest;
    resolve: (response: GhostTabResponse) => void;
    reject: (error: Error) => void;
    timeout: number;
    startTime: number;
  }>();
  private config: GhostTabConfig;
  private messageHandlers = new Map<string, (message: any, sender: chrome.runtime.MessageSender) => void>();

  constructor(config?: Partial<GhostTabConfig>) {
    this.config = {
      maxConcurrentTabs: 2,
      defaultTimeout: 30000,
      tabLifetime: 60000,
      windowState: 'normal',
      enableLogging: true,
      ...config
    };

    this.initializeMessageHandlers();
  }

  private initializeMessageHandlers(): void {
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type?.startsWith('GHOST_TAB_')) {
        this.handleContentScriptMessage(message, sender);
      }
    });

    // Clean up tabs when they're removed
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.cleanupTab(tabId);
    });

    this.log('[GhostTabManager] Message handlers initialized');
  }

  // Main method to create a ghost tab and extract content
  async createGhostTab(request: GhostTabRequest): Promise<GhostTabResponse> {
    if (this.activeTabs.size >= this.config.maxConcurrentTabs) {
      throw new Error(`Maximum concurrent tabs (${this.config.maxConcurrentTabs}) reached`);
    }

    const startTime = Date.now();
    const timeout = request.timeout || this.config.defaultTimeout;

    return new Promise((resolve, reject) => {
      // Store the pending request
      this.pendingRequests.set(request.id, {
        request,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.handleTimeout(request.id);
        }, timeout),
        startTime
      });

      // Create the tab
      this.createBackgroundTab(request.url, request.id)
        .then(tab => {
          if (tab && tab.id) {
            this.activeTabs.set(request.id, tab);
            this.log(`[GhostTabManager] Created tab ${tab.id} for request ${request.id}`);
          } else {
            this.handleError(request.id, new Error('Failed to create tab'));
          }
        })
        .catch(error => {
          this.handleError(request.id, error);
        });
    });
  }

  private async createBackgroundTab(url: string, requestId: string): Promise<chrome.tabs.Tab | null> {
    try {
      // Create a minimized popup window that's effectively invisible
      const window = await chrome.windows.create({
        url: url,
        focused: false,
        width: 1, // Minimal size
        height: 1, // Minimal size
        left: 0, // Position at top-left corner
        top: 0,
        type: 'popup' // Use popup type for better control
      });

      if (!window || !window.tabs || window.tabs.length === 0) {
        this.log(`[GhostTabManager] Failed to create invisible window for ${url}`);
        return null;
      }

      const tab = window.tabs[0];

      // Immediately minimize the window to make it effectively invisible
      try {
        await chrome.windows.update(window.id, { state: 'minimized' });
        this.log(`[GhostTabManager] Minimized invisible window ${window.id}`);
      } catch (minimizeError) {
        this.log(`[GhostTabManager] Could not minimize window: ${minimizeError}`);
      }

      // Inject a script to mark this as a ghost tab using sessionStorage
      if (tab && tab.id) {
        // Wait a moment for the tab to start loading
        setTimeout(async () => {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              func: (requestId: string) => {
                sessionStorage.setItem('ghost-tab-id', requestId);
                sessionStorage.setItem('ghost-tab-mode', 'true');
              },
              args: [requestId]
            });
            this.log(`[GhostTabManager] Marked invisible tab ${tab.id} as ghost tab with ID ${requestId}`);
          } catch (error) {
            this.log(`[GhostTabManager] Failed to mark invisible tab as ghost tab: ${error}`);
          }
        }, 500);
      }

      this.log(`[GhostTabManager] Created invisible ghost tab ${tab.id} in minimized window for ${url}`);
      return tab;

    } catch (error) {
      this.log(`[GhostTabManager] Failed to create invisible background tab: ${error}`);
      return null;
    }
  }

  private handleContentScriptMessage(message: any, sender: chrome.runtime.MessageSender): void {
    if (!sender.tab?.id) {
      this.log('[GhostTabManager] Message received but no tab ID');
      return;
    }

    const requestId = this.findRequestByTabId(sender.tab.id);
    if (!requestId) {
      this.log(`[GhostTabManager] No request found for tab ${sender.tab.id}`);
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.log(`[GhostTabManager] No pending request found for ${requestId}`);
      return;
    }

    this.log(`[GhostTabManager] Received message ${message.type} for request ${requestId}`);

    switch (message.type) {
      case 'GHOST_TAB_READY':
        this.handleTabReady(requestId, message.data);
        break;
      case 'GHOST_TAB_COMPLETE':
        this.handleTabComplete(requestId, message.data);
        break;
      case 'GHOST_TAB_ERROR':
        this.handleError(requestId, new Error(message.error));
        break;
      default:
        this.log(`[GhostTabManager] Unknown message type: ${message.type}`);
    }
  }

  private findRequestByTabId(tabId: number): string | null {
    for (const [requestId, tab] of this.activeTabs.entries()) {
      if (tab.id === tabId) {
        return requestId;
      }
    }
    return null;
  }

  private async handleTabReady(requestId: string, data: any): Promise<void> {
    this.log(`[GhostTabManager] Tab ready for request ${requestId}`);
    
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.log(`[GhostTabManager] No pending request found for ${requestId}`);
      return;
    }

    const tab = this.activeTabs.get(requestId);
    if (!tab || !tab.id) {
      this.log(`[GhostTabManager] No active tab found for ${requestId}`);
      return;
    }

    try {
      // Send the scraping instructions to the content script
      this.log(`[GhostTabManager] Sending execution instructions to tab ${tab.id}`);
      await chrome.tabs.sendMessage(tab.id, {
        type: 'GHOST_TAB_EXECUTE',
        request: pending.request
      });

      this.log(`[GhostTabManager] Sent execution instructions to tab ${tab.id}`);
    } catch (error) {
      this.log(`[GhostTabManager] Failed to send execution instructions: ${error}`);
      this.handleError(requestId, error as Error);
    }
  }

  private handleTabComplete(requestId: string, data: any): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const response: GhostTabResponse = {
      id: requestId,
      success: true,
      html: data.html,
      extractedData: data.extractedData,
      timing: {
        created: pending.startTime,
        loaded: data.loadTime || Date.now(),
        completed: Date.now(),
        duration: Date.now() - pending.startTime
      }
    };

    this.completeRequest(requestId, response);
  }

  private handleTimeout(requestId: string): void {
    const error = new Error(`Ghost tab request ${requestId} timed out`);
    this.handleError(requestId, error);
  }

  private handleError(requestId: string, error: Error): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const response: GhostTabResponse = {
      id: requestId,
      success: false,
      error: error.message,
      timing: {
        created: pending.startTime,
        loaded: 0,
        completed: Date.now(),
        duration: Date.now() - pending.startTime
      }
    };

    this.completeRequest(requestId, response);
  }

  private completeRequest(requestId: string, response: GhostTabResponse): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    // Clear timeout
    clearTimeout(pending.timeout);

    // Resolve the promise
    pending.resolve(response);

    // Clean up
    this.cleanupRequest(requestId);

    this.log(`[GhostTabManager] Completed request ${requestId} (${response.success ? 'success' : 'error'})`);
  }

  private cleanupRequest(requestId: string): void {
    // Remove from pending requests
    this.pendingRequests.delete(requestId);

    // Close the tab and its window
    const tab = this.activeTabs.get(requestId);
    if (tab && tab.id) {
      // Get the window ID for the tab
      chrome.tabs.get(tab.id).then(tabInfo => {
        if (tabInfo.windowId) {
          // Close the entire window (which contains the invisible ghost tab)
          chrome.windows.remove(tabInfo.windowId).catch(error => {
            this.log(`[GhostTabManager] Failed to remove invisible window ${tabInfo.windowId}: ${error}`);
          });
        } else {
          // Fallback to just removing the tab
          chrome.tabs.remove(tab.id!).catch(error => {
            this.log(`[GhostTabManager] Failed to remove tab ${tab.id}: ${error}`);
          });
        }
      }).catch(error => {
        this.log(`[GhostTabManager] Failed to get tab info for cleanup: ${error}`);
      });
    }

    // Remove from active tabs
    this.activeTabs.delete(requestId);
  }

  private cleanupTab(tabId: number): void {
    // Find and cleanup any request associated with this tab
    const requestId = this.findRequestByTabId(tabId);
    if (requestId) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Tab was closed unexpectedly'));
        this.pendingRequests.delete(requestId);
      }
      this.activeTabs.delete(requestId);
    }
  }

  // Utility methods
  getActiveTabCount(): number {
    return this.activeTabs.size;
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  getStats(): {
    activeTabs: number;
    pendingRequests: number;
    maxConcurrent: number;
  } {
    return {
      activeTabs: this.activeTabs.size,
      pendingRequests: this.pendingRequests.size,
      maxConcurrent: this.config.maxConcurrentTabs
    };
  }

  async cleanup(): Promise<void> {
    // Cancel all pending requests
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Ghost tab manager is shutting down'));
    }
    this.pendingRequests.clear();

    // Close all active tabs
    const tabIds = Array.from(this.activeTabs.values())
      .map(tab => tab.id)
      .filter((id): id is number => id !== undefined);

    if (tabIds.length > 0) {
      try {
        await chrome.tabs.remove(tabIds);
      } catch (error) {
        this.log(`[GhostTabManager] Failed to close tabs during cleanup: ${error}`);
      }
    }

    this.activeTabs.clear();
    this.log('[GhostTabManager] Cleanup completed');
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(message);
    }
  }
}

export const ghostTabManager = new GhostTabManager();
