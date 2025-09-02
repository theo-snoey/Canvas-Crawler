// Enhanced Auth Manager for Canvas Scraper
// Handles authentication across multiple Canvas hosts with fallback strategies

import { configManager } from './configManager';

export interface AuthResult {
  isAuthenticated: boolean;
  host: string;
  method: 'page-check' | 'api-check' | 'none';
  error?: string;
}

export class AuthManager {
  private currentAuthState: AuthResult | null = null;
  private loginTabId: number | null = null;
  private dashboardDetectionTabId: number | null = null;

  constructor() {
    this.initializeTabListeners();
  }

  private initializeTabListeners(): void {
    // Listen for tab updates to detect login completion
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        this.handleTabUpdate(tabId, tab.url);
      }
    });

    // Listen for tab removal to clean up references
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === this.loginTabId) {
        this.loginTabId = null;
      }
      if (tabId === this.dashboardDetectionTabId) {
        this.dashboardDetectionTabId = null;
      }
    });
  }

  async performAuthProbe(): Promise<AuthResult> {
    const hosts = configManager.getHosts();
    console.log('[AuthManager] Checking authentication for hosts:', hosts);

    // Try each host until we find one that works
    for (const host of hosts) {
      try {
        const result = await this.checkHostAuth(host);
        if (result.isAuthenticated) {
          this.currentAuthState = result;
          console.log('[AuthManager] Authenticated on host:', host);
          return result;
        }
      } catch (error) {
        console.error('[AuthManager] Auth check failed for host:', host, error);
      }
    }

    // If no host is authenticated, return the last failed result
    const lastResult: AuthResult = {
      isAuthenticated: false,
      host: hosts[0] || 'unknown',
      method: 'none',
      error: 'No hosts authenticated'
    };
    this.currentAuthState = lastResult;
    return lastResult;
  }

  private async checkHostAuth(host: string): Promise<AuthResult> {
    // Method 1: Try API endpoint first (faster and more reliable)
    try {
      const apiResult = await this.checkApiAuth(host);
      if (apiResult.isAuthenticated) {
        return apiResult;
      }
    } catch (error) {
      console.log('[AuthManager] API check failed for host:', host, error);
    }

    // Method 2: Fallback to page content check
    try {
      const pageResult = await this.checkPageAuth(host);
      return pageResult;
    } catch (error) {
      console.error('[AuthManager] Page check failed for host:', host, error);
      return {
        isAuthenticated: false,
        host,
        method: 'none',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async checkApiAuth(host: string): Promise<AuthResult> {
    const apiUrl = `${host}/api/v1/users/self`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (response.ok) {
      const userData = await response.json();
      if (userData && userData.id) {
        return {
          isAuthenticated: true,
          host,
          method: 'api-check'
        };
      }
    }

    return {
      isAuthenticated: false,
      host,
      method: 'api-check'
    };
  }

  private async checkPageAuth(host: string): Promise<AuthResult> {
    const response = await fetch(host, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });

    const responseText = await response.text();
    
    // Check for login page indicators
    const isLoginPage = response.url.includes('/login') || 
                       responseText.includes('id="login_form"') ||
                       responseText.includes('class="login-form"') ||
                       responseText.includes('Sign in to Canvas') ||
                       responseText.includes('Forgot Password?') ||
                       responseText.includes('Log In') ||
                       responseText.includes('login-button');

    // Check for dashboard indicators
    const isDashboard = responseText.includes('dashboard') ||
                        responseText.includes('courses') ||
                        responseText.includes('calendar') ||
                        responseText.includes('inbox') ||
                        responseText.includes('Canvas') && !isLoginPage;

    if (response.ok && !isLoginPage && isDashboard) {
      return {
        isAuthenticated: true,
        host,
        method: 'page-check'
      };
    }

    return {
      isAuthenticated: false,
      host,
      method: 'page-check'
    };
  }

  async promptForLogin(): Promise<void> {
    const hosts = configManager.getHosts();
    const primaryHost = hosts[0] || 'https://canvas.instructure.com';
    
    console.log('[AuthManager] Prompting for login on host:', primaryHost);

    // Show notification
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Canvas Scraper',
      message: 'Please log in to Canvas to enable data crawling'
    });

    // Open login tab
    const loginTab = await chrome.tabs.create({
      url: `${primaryHost}/login`,
      active: false
    });

    this.loginTabId = loginTab.id || null;

    // Set up dashboard detection
    await this.setupDashboardDetection(primaryHost);
  }

  private async setupDashboardDetection(host: string): Promise<void> {
    // Create a hidden tab to monitor for dashboard access
    const detectionTab = await chrome.tabs.create({
      url: host,
      active: false
    });

    this.dashboardDetectionTabId = detectionTab.id || null;
  }

  private async handleTabUpdate(tabId: number, url: string): Promise<void> {
    // Check if this is our dashboard detection tab
    if (tabId === this.dashboardDetectionTabId) {
      const hosts = configManager.getHosts();
      const isCanvasHost = hosts.some(host => url.startsWith(host));
      
      if (isCanvasHost && !url.includes('/login')) {
        console.log('[AuthManager] Dashboard detected, checking auth...');
        
        // Wait a moment for the page to fully load
        setTimeout(async () => {
          const authResult = await this.performAuthProbe();
          if (authResult.isAuthenticated) {
            console.log('[AuthManager] Login detected, starting crawl...');
            await this.onLoginSuccess();
          }
        }, 2000);
      }
    }
  }

  private async onLoginSuccess(): Promise<void> {
    // Close the login and detection tabs
    if (this.loginTabId) {
      try {
        await chrome.tabs.remove(this.loginTabId);
      } catch (error) {
        console.log('[AuthManager] Login tab already closed');
      }
      this.loginTabId = null;
    }

    if (this.dashboardDetectionTabId) {
      try {
        await chrome.tabs.remove(this.dashboardDetectionTabId);
      } catch (error) {
        console.log('[AuthManager] Detection tab already closed');
      }
      this.dashboardDetectionTabId = null;
    }

    // Notify service worker to start crawl
    chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS' });
  }

  getCurrentAuthState(): AuthResult | null {
    return this.currentAuthState;
  }

  isAuthenticated(): boolean {
    return this.currentAuthState?.isAuthenticated || false;
  }

  getAuthenticatedHost(): string | null {
    return this.currentAuthState?.isAuthenticated ? this.currentAuthState.host : null;
  }
}

export const authManager = new AuthManager();
