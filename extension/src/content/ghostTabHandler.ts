// Ghost Tab Handler for Content Scripts
// Handles page automation and content extraction in background tabs

export interface PageReadyOptions {
  selector?: string;
  text?: string;
  timeout?: number;
}

export interface AutomationAction {
  type: 'click' | 'scroll' | 'wait' | 'expand';
  selector?: string;
  timeout?: number;
  value?: string | number;
}

export interface ContentExtractor {
  name: string;
  selector: string;
  attribute?: string;
  multiple?: boolean;
}

export class GhostTabHandler {
  private isGhostTab = false;
  private requestId: string | null = null;

  constructor() {
    this.initializeGhostTabHandling();
  }

  private initializeGhostTabHandling(): void {
    // Check if this is a ghost tab by looking for URL parameter
    const hasGhostTabParam = window.location.search.includes('ghost-tab=true');
    
    console.log('[GhostTabHandler] Initializing ghost tab handling');
    console.log('[GhostTabHandler] Current URL:', window.location.href);
    console.log('[GhostTabHandler] Has ghost-tab param:', hasGhostTabParam);
    
    if (hasGhostTabParam) {
      this.isGhostTab = true;
      console.log('[GhostTabHandler] Ghost tab mode activated!');
      this.handleGhostTabLoad();
    } else {
      console.log('[GhostTabHandler] Regular tab mode');
    }

    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GHOST_TAB_EXECUTE') {
        this.handleExecutionRequest(message.request);
        return true; // Keep message channel open
      }
    });
  }

  private handleGhostTabLoad(): void {
    console.log('[GhostTabHandler] Ghost tab detected, waiting for page ready...');
    
    // Wait for page to be ready, then notify service worker
    this.waitForPageReady()
      .then(() => {
        console.log('[GhostTabHandler] Page ready, sending GHOST_TAB_READY message');
        this.sendMessage('GHOST_TAB_READY', {
          url: window.location.href,
          title: document.title,
          loadTime: Date.now()
        });
      })
      .catch(error => {
        console.error('[GhostTabHandler] Page ready failed:', error);
        this.sendMessage('GHOST_TAB_ERROR', {
          error: error.message
        });
      });
  }

  private async handleExecutionRequest(request: any): Promise<void> {
    this.requestId = request.id;
    console.log('[GhostTabHandler] Received execution request:', request.id);

    try {
      // Wait for any specific conditions
      if (request.waitFor) {
        console.log('[GhostTabHandler] Waiting for condition:', request.waitFor);
        await this.waitForCondition(request.waitFor);
      }

      // Execute automation actions
      if (request.actions && request.actions.length > 0) {
        console.log('[GhostTabHandler] Executing actions:', request.actions.length);
        await this.executeActions(request.actions);
      }

      // Extract content
      const extractedData: Record<string, any> = {};
      if (request.extractors && request.extractors.length > 0) {
        console.log('[GhostTabHandler] Extracting content with', request.extractors.length, 'extractors');
        for (const extractor of request.extractors) {
          extractedData[extractor.name] = this.extractContent(extractor);
        }
      }

      // Get final HTML
      const html = document.documentElement.outerHTML;
      console.log('[GhostTabHandler] Extraction complete, HTML size:', html.length, 'bytes');

      // Send completion message
      this.sendMessage('GHOST_TAB_COMPLETE', {
        html,
        extractedData,
        url: window.location.href,
        title: document.title
      });

    } catch (error) {
      console.error('[GhostTabHandler] Execution failed:', error);
      this.sendMessage('GHOST_TAB_ERROR', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async waitForPageReady(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkReady = () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error('Page ready timeout'));
          return;
        }

        if (document.readyState === 'complete') {
          // Additional check for Canvas-specific loading indicators
          const loadingElements = document.querySelectorAll('.loading, .spinner, [data-loading="true"]');
          if (loadingElements.length === 0) {
            resolve();
            return;
          }
        }

        setTimeout(checkReady, 100);
      };

      checkReady();
    });
  }

  private async waitForCondition(options: PageReadyOptions): Promise<void> {
    const timeout = options.timeout || 5000;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Wait condition timeout: ${JSON.stringify(options)}`));
          return;
        }

        let conditionMet = false;

        if (options.selector) {
          const element = document.querySelector(options.selector);
          conditionMet = element !== null;
        }

        if (options.text && !conditionMet) {
          conditionMet = document.body.textContent?.includes(options.text) || false;
        }

        if (conditionMet) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };

      check();
    });
  }

  private async executeActions(actions: AutomationAction[]): Promise<void> {
    for (const action of actions) {
      await this.executeAction(action);
      // Small delay between actions
      await this.wait(200);
    }
  }

  private async executeAction(action: AutomationAction): Promise<void> {
    switch (action.type) {
      case 'click':
        await this.clickElement(action.selector!);
        break;
      case 'scroll':
        await this.scrollPage(action.value as number || 0);
        break;
      case 'wait':
        await this.wait(action.value as number || 1000);
        break;
      case 'expand':
        await this.expandContent(action.selector);
        break;
      default:
        console.warn(`Unknown action type: ${action.type}`);
    }
  }

  private async clickElement(selector: string): Promise<void> {
    const element = document.querySelector(selector) as HTMLElement;
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Scroll element into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.wait(300);

    // Click the element
    element.click();
    await this.wait(500); // Wait for any resulting changes
  }

  private async scrollPage(amount: number): Promise<void> {
    if (amount === 0) {
      // Scroll to bottom
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else {
      // Scroll by amount
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }
    await this.wait(500);
  }

  private async expandContent(selector?: string): Promise<void> {
    // Common expansion patterns in Canvas
    const expandSelectors = [
      '.show-more',
      '.expand',
      '.load-more',
      '[data-behavior="load-more"]',
      '.btn-load-more',
      selector
    ].filter(Boolean);

    for (const sel of expandSelectors) {
      const elements = document.querySelectorAll(sel as string);
      for (const element of elements) {
        if (element instanceof HTMLElement && element.offsetParent !== null) {
          element.click();
          await this.wait(1000); // Wait for content to load
        }
      }
    }
  }

  private extractContent(extractor: ContentExtractor): any {
    const elements = extractor.multiple 
      ? document.querySelectorAll(extractor.selector)
      : [document.querySelector(extractor.selector)].filter(Boolean);

    if (elements.length === 0) {
      return extractor.multiple ? [] : null;
    }

    const extractValue = (element: Element): string | null => {
      if (extractor.attribute) {
        return element.getAttribute(extractor.attribute);
      }
      return element.textContent?.trim() || null;
    };

    if (extractor.multiple) {
      return Array.from(elements).map(extractValue).filter(Boolean);
    } else {
      return extractValue(elements[0]);
    }
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private sendMessage(type: string, data: any): void {
    chrome.runtime.sendMessage({
      type,
      data,
      requestId: this.requestId,
      timestamp: Date.now()
    }).catch(error => {
      console.error(`Failed to send message ${type}:`, error);
    });
  }

  // Public utility methods for regular content script usage
  isInGhostTab(): boolean {
    return this.isGhostTab;
  }

  async autoExpandContent(): Promise<void> {
    if (!this.isGhostTab) return;
    await this.expandContent();
  }

  async waitForCanvasReady(): Promise<void> {
    // Wait for Canvas-specific readiness indicators
    await this.waitForCondition({
      selector: '#application, .ic-app, [data-react-class]',
      timeout: 10000
    });

    // Wait for any loading spinners to disappear
    await this.waitForCondition({
      timeout: 5000
    });
  }
}

// Initialize the ghost tab handler
export const ghostTabHandler = new GhostTabHandler();
