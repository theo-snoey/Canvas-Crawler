// Canvas Scraper Options Page
// Handles configuration form and settings persistence

interface ExtensionOptions {
  hosts: string[];
  settings: {
    syncFrequency: 'startup-only' | 'hourly' | 'daily' | 'manual';
    maxConcurrentFetches: number;
    maxConcurrentGhostTabs: number;
    fileExtraction: 'metadata-only' | 'text-extraction' | 'on-demand';
  };
}

const DEFAULT_OPTIONS: ExtensionOptions = {
  hosts: ['https://youruniversity.instructure.com'],
  settings: {
    syncFrequency: 'startup-only',
    maxConcurrentFetches: 6,
    maxConcurrentGhostTabs: 2,
    fileExtraction: 'metadata-only'
  }
};

class OptionsController {
  private options: ExtensionOptions = { ...DEFAULT_OPTIONS };

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Set up event listeners
    document.getElementById('save-options')?.addEventListener('click', () => this.saveOptions());
    document.getElementById('reset-defaults')?.addEventListener('click', () => this.resetToDefaults());

    // Load current options
    await this.loadOptions();
    
    // Populate form
    this.populateForm();
  }

  private async loadOptions(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(['canvasOptions']);
      if (result.canvasOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...result.canvasOptions };
      }
    } catch (error) {
      console.error('[Options] Failed to load options:', error);
      this.showStatus('Failed to load options', 'error');
    }
  }

  private populateForm(): void {
    // Canvas hosts
    const hostsTextarea = document.getElementById('canvas-hosts') as HTMLTextAreaElement;
    if (hostsTextarea) {
      hostsTextarea.value = this.options.hosts.join('\n');
    }

    // Sync frequency
    const syncFrequencySelect = document.getElementById('sync-frequency') as HTMLSelectElement;
    if (syncFrequencySelect) {
      syncFrequencySelect.value = this.options.settings.syncFrequency;
    }

    // Max concurrent fetches
    const maxFetchesInput = document.getElementById('max-fetches') as HTMLInputElement;
    if (maxFetchesInput) {
      maxFetchesInput.value = this.options.settings.maxConcurrentFetches.toString();
    }

    // Max ghost tabs
    const maxGhostTabsInput = document.getElementById('max-ghost-tabs') as HTMLInputElement;
    if (maxGhostTabsInput) {
      maxGhostTabsInput.value = this.options.settings.maxConcurrentGhostTabs.toString();
    }

    // File extraction mode
    const fileExtractionSelect = document.getElementById('file-extraction') as HTMLSelectElement;
    if (fileExtractionSelect) {
      fileExtractionSelect.value = this.options.settings.fileExtraction;
    }
  }

  private getFormData(): ExtensionOptions {
    const hostsTextarea = document.getElementById('canvas-hosts') as HTMLTextAreaElement;
    const syncFrequencySelect = document.getElementById('sync-frequency') as HTMLSelectElement;
    const maxFetchesInput = document.getElementById('max-fetches') as HTMLInputElement;
    const maxGhostTabsInput = document.getElementById('max-ghost-tabs') as HTMLInputElement;
    const fileExtractionSelect = document.getElementById('file-extraction') as HTMLSelectElement;

    // Parse hosts from textarea
    const hosts = hostsTextarea?.value
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0) || [];

    return {
      hosts,
      settings: {
        syncFrequency: (syncFrequencySelect?.value as ExtensionOptions['settings']['syncFrequency']) || 'startup-only',
        maxConcurrentFetches: parseInt(maxFetchesInput?.value || '6', 10),
        maxConcurrentGhostTabs: parseInt(maxGhostTabsInput?.value || '2', 10),
        fileExtraction: (fileExtractionSelect?.value as ExtensionOptions['settings']['fileExtraction']) || 'metadata-only'
      }
    };
  }

  private async saveOptions(): Promise<void> {
    try {
      const formData = this.getFormData();
      
      // Validate hosts
      if (formData.hosts.length === 0) {
        this.showStatus('Please enter at least one Canvas host URL', 'error');
        return;
      }

      // Validate numeric inputs
      if (formData.settings.maxConcurrentFetches < 1 || formData.settings.maxConcurrentFetches > 10) {
        this.showStatus('Max concurrent fetches must be between 1 and 10', 'error');
        return;
      }

      if (formData.settings.maxConcurrentGhostTabs < 1 || formData.settings.maxConcurrentGhostTabs > 3) {
        this.showStatus('Max ghost tabs must be between 1 and 3', 'error');
        return;
      }

      // Save to storage
      await chrome.storage.sync.set({ canvasOptions: formData });
      
      // Update local options
      this.options = formData;
      
      this.showStatus('Options saved successfully!', 'success');
      
      // Notify service worker of config change
      chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', options: formData });
      
    } catch (error) {
      console.error('[Options] Failed to save options:', error);
      this.showStatus('Failed to save options: ' + error.message, 'error');
    }
  }

  private async resetToDefaults(): Promise<void> {
    try {
      this.options = { ...DEFAULT_OPTIONS };
      this.populateForm();
      
      await chrome.storage.sync.set({ canvasOptions: this.options });
      
      this.showStatus('Options reset to defaults', 'success');
      
      // Notify service worker of config change
      chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', options: this.options });
      
    } catch (error) {
      console.error('[Options] Failed to reset options:', error);
      this.showStatus('Failed to reset options: ' + error.message, 'error');
    }
  }

  private showStatus(message: string, type: 'success' | 'error'): void {
    const statusElement = document.getElementById('status') as HTMLDivElement;
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `status ${type}`;
      statusElement.style.display = 'block';
      
      // Hide after 3 seconds
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 3000);
    }
  }
}

// Initialize options page when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new OptionsController();
});

export {};
