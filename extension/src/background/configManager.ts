// Configuration Manager for Canvas Scraper
// Handles user settings, Canvas hosts, and configuration persistence

export interface CanvasConfig {
  hosts: string[];
  settings: {
    syncFrequency: 'startup-only' | 'hourly' | 'daily' | 'manual';
    maxConcurrentFetches: number;
    maxConcurrentGhostTabs: number;
    fileExtraction: 'metadata-only' | 'text-extraction' | 'on-demand';
  };
}

const DEFAULT_CONFIG: CanvasConfig = {
  hosts: ['https://canvas.instructure.com'],
  settings: {
    syncFrequency: 'startup-only',
    maxConcurrentFetches: 6,
    maxConcurrentGhostTabs: 2,
    fileExtraction: 'metadata-only'
  }
};

export class ConfigManager {
  private config: CanvasConfig = { ...DEFAULT_CONFIG };
  private isLoaded = false;

  constructor() {
    this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(['canvasOptions']);
      if (result.canvasOptions) {
        this.config = { ...DEFAULT_CONFIG, ...result.canvasOptions };
      }
      this.isLoaded = true;
      console.log('[ConfigManager] Configuration loaded:', this.config);
    } catch (error) {
      console.error('[ConfigManager] Failed to load config:', error);
      this.config = { ...DEFAULT_CONFIG };
      this.isLoaded = true;
    }
  }

  async saveConfig(newConfig: Partial<CanvasConfig>): Promise<void> {
    try {
      this.config = { ...this.config, ...newConfig };
      await chrome.storage.sync.set({ canvasOptions: this.config });
      console.log('[ConfigManager] Configuration saved:', this.config);
    } catch (error) {
      console.error('[ConfigManager] Failed to save config:', error);
    }
  }

  getConfig(): CanvasConfig {
    return { ...this.config };
  }

  getHosts(): string[] {
    return [...this.config.hosts];
  }

  getSettings() {
    return { ...this.config.settings };
  }

  isConfigLoaded(): boolean {
    return this.isLoaded;
  }

  async resetToDefaults(): Promise<void> {
    await this.saveConfig(DEFAULT_CONFIG);
  }
}

export const configManager = new ConfigManager();
