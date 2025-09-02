// Canvas Content Script
// Injected into Canvas pages for DOM extraction and UI automation

interface ScrapeRequest {
  type: 'scrape-page' | 'expand-content' | 'extract-links';
  selector?: string;
  expandSelectors?: string[];
}

interface ScrapeResponse {
  success: boolean;
  data?: any;
  error?: string;
}

class CanvasContentScript {
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (this.isInitialized) return;
    
    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sendResponse);
      return true; // Keep message channel open
    });

    // Wait for page to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.onPageReady());
    } else {
      this.onPageReady();
    }

    this.isInitialized = true;
    console.log('[ContentScript] Initialized on', window.location.href);
  }

  private onPageReady(): void {
    console.log('[ContentScript] Page ready:', window.location.href);
    
    // Notify service worker that content script is ready
    chrome.runtime.sendMessage({
      type: 'CONTENT_SCRIPT_READY',
      url: window.location.href,
      title: document.title
    });
  }

  private async handleMessage(
    message: ScrapeRequest, 
    sendResponse: (response: ScrapeResponse) => void
  ): Promise<void> {
    try {
      console.log('[ContentScript] Received message:', message.type);
      
      switch (message.type) {
        case 'scrape-page':
          const pageData = await this.scrapePage();
          sendResponse({ success: true, data: pageData });
          break;
        
        case 'expand-content':
          await this.expandContent(message.expandSelectors || []);
          const expandedData = await this.scrapePage();
          sendResponse({ success: true, data: expandedData });
          break;
        
        case 'extract-links':
          const links = this.extractLinks();
          sendResponse({ success: true, data: links });
          break;
        
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[ContentScript] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  private async scrapePage(): Promise<any> {
    // Basic page scraping - will be enhanced in Phase 8-9
    const pageData = {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      content: this.extractMainContent(),
      links: this.extractLinks(),
      metadata: this.extractMetadata()
    };

    return pageData;
  }

  private extractMainContent(): string {
    // Extract main content area
    const selectors = [
      '#content',
      '.content',
      'main',
      '.main-content',
      '[role="main"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || '';
      }
    }

    // Fallback to body content
    return document.body.textContent?.trim() || '';
  }

  private extractLinks(): Array<{ href: string; text: string; title?: string }> {
    const links: Array<{ href: string; text: string; title?: string }> = [];
    const anchorElements = document.querySelectorAll('a[href]');

    anchorElements.forEach(anchor => {
      const href = anchor.getAttribute('href');
      const text = anchor.textContent?.trim();
      const title = anchor.getAttribute('title');

      if (href && text) {
        links.push({ href, text, title: title || undefined });
      }
    });

    return links;
  }

  private extractMetadata(): Record<string, string> {
    const metadata: Record<string, string> = {};
    
    // Extract meta tags
    const metaTags = document.querySelectorAll('meta');
    metaTags.forEach(meta => {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (name && content) {
        metadata[name] = content;
      }
    });

    // Extract data attributes
    const dataElements = document.querySelectorAll('[data-*]');
    dataElements.forEach(element => {
      const attributes = element.attributes;
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr.name.startsWith('data-')) {
          metadata[attr.name] = attr.value;
        }
      }
    });

    return metadata;
  }

  private async expandContent(selectors: string[]): Promise<void> {
    // Expand collapsible content (load more, show comments, etc.)
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      
      for (const element of elements) {
        if (element instanceof HTMLElement) {
          // Click to expand
          element.click();
          
          // Wait a bit for content to load
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
}

// Initialize content script
const contentScript = new CanvasContentScript();

export {};
