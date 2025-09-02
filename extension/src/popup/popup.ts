// Canvas Scraper Popup
// Handles UI interactions and communicates with service worker

interface ExtensionState {
  isAuthenticated: boolean;
  lastCrawl: number | null;
  currentTask: string | null;
  errorCount: number;
}

class PopupController {
  private state: ExtensionState = {
    isAuthenticated: false,
    lastCrawl: null,
    currentTask: null,
    errorCount: 0
  };

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Set up event listeners
    document.getElementById('start-crawl')?.addEventListener('click', () => this.startCrawl());
    document.getElementById('check-auth')?.addEventListener('click', () => this.checkAuth());
    document.getElementById('open-options')?.addEventListener('click', () => this.openOptions());

    // Load initial state
    await this.loadState();
    
    // Update UI
    this.updateUI();
  }

  private async loadState(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (response && response.state) {
        this.state = response.state;
      }
    } catch (error) {
      console.error('[Popup] Failed to load state:', error);
    }
  }

  private updateUI(): void {
    // Update authentication status
    const authStatus = document.getElementById('auth-status');
    if (authStatus) {
      authStatus.textContent = this.state.isAuthenticated ? 'Authenticated' : 'Not Authenticated';
      authStatus.className = `status-value ${this.state.isAuthenticated ? 'authenticated' : 'not-authenticated'}`;
    }

    // Update last sync time
    const lastSync = document.getElementById('last-sync');
    if (lastSync) {
      if (this.state.lastCrawl) {
        const date = new Date(this.state.lastCrawl);
        lastSync.textContent = date.toLocaleString();
      } else {
        lastSync.textContent = 'Never';
      }
    }

    // Update current task
    const currentTask = document.getElementById('current-task');
    if (currentTask) {
      currentTask.textContent = this.state.currentTask || 'Idle';
    }

    // Update button states
    const startCrawlBtn = document.getElementById('start-crawl') as HTMLButtonElement;
    if (startCrawlBtn) {
      startCrawlBtn.disabled = !this.state.isAuthenticated || this.state.currentTask !== null;
      startCrawlBtn.textContent = this.state.currentTask ? 'Running...' : 'Start Crawl';
    }
  }

  private async startCrawl(): Promise<void> {
    try {
      const startCrawlBtn = document.getElementById('start-crawl') as HTMLButtonElement;
      startCrawlBtn.disabled = true;
      startCrawlBtn.textContent = 'Starting...';

      const response = await chrome.runtime.sendMessage({ type: 'START_CRAWL' });
      
      if (response && response.success) {
        console.log('[Popup] Crawl started successfully');
        await this.loadState();
        this.updateUI();
      } else {
        console.error('[Popup] Failed to start crawl:', response?.error);
        alert('Failed to start crawl: ' + (response?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[Popup] Error starting crawl:', error);
      alert('Error starting crawl: ' + error.message);
    } finally {
      await this.loadState();
      this.updateUI();
    }
  }

  private async checkAuth(): Promise<void> {
    try {
      const checkAuthBtn = document.getElementById('check-auth') as HTMLButtonElement;
      checkAuthBtn.disabled = true;
      checkAuthBtn.textContent = 'Checking...';

      const response = await chrome.runtime.sendMessage({ type: 'AUTH_CHECK' });
      
      if (response) {
        this.state.isAuthenticated = response.isAuthenticated;
        console.log('[Popup] Auth check result:', response.isAuthenticated);
        this.updateUI();
      }
    } catch (error) {
      console.error('[Popup] Error checking auth:', error);
      alert('Error checking authentication: ' + error.message);
    } finally {
      const checkAuthBtn = document.getElementById('check-auth') as HTMLButtonElement;
      checkAuthBtn.disabled = false;
      checkAuthBtn.textContent = 'Check Auth';
    }
  }

  private openOptions(): void {
    chrome.runtime.openOptionsPage();
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

export {};
