// Page Loader for Canvas Scraper
// Handles network requests with authentication, caching, and error handling

import { configManager } from './configManager';
import { storageManager } from './storageManager';

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | FormData;
  credentials?: 'include' | 'omit';
  cache?: 'default' | 'no-cache' | 'force-cache';
  timeout?: number;
  retries?: number;
}

export interface FetchResult {
  success: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  text?: string;
  error?: string;
  etag?: string;
  lastModified?: string;
  size?: number;
  cached?: boolean;
}

export interface CacheEntry {
  url: string;
  etag?: string;
  lastModified?: string;
  lastFetched: number;
  size: number;
  hash: string;
}

export class PageLoader {
  private defaultTimeout = 30000; // 30 seconds
  private defaultRetries = 3;
  private cache = new Map<string, CacheEntry>();

  constructor() {
    this.loadCache();
  }

  // Main fetch method with authentication and error handling
  async fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const fetchOptions: FetchOptions = {
      method: 'GET',
      credentials: 'include',
      cache: 'no-cache',
      timeout: this.defaultTimeout,
      retries: this.defaultRetries,
      ...options
    };

    // Add conditional request headers if we have cached data
    const cacheEntry = this.cache.get(url);
    if (cacheEntry) {
      if (cacheEntry.etag) {
        fetchOptions.headers = { ...fetchOptions.headers, 'If-None-Match': cacheEntry.etag };
      }
      if (cacheEntry.lastModified) {
        fetchOptions.headers = { ...fetchOptions.headers, 'If-Modified-Since': cacheEntry.lastModified };
      }
    }

    // Add Canvas-specific headers
    fetchOptions.headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...fetchOptions.headers
    };

    let lastError: string | undefined;
    
    for (let attempt = 0; attempt <= fetchOptions.retries!; attempt++) {
      try {
        const result = await this.performFetch(url, fetchOptions);
        
        // Handle 304 Not Modified
        if (result.status === 304 && cacheEntry) {
          console.log(`[PageLoader] Cache hit for ${url}`);
          return {
            ...result,
            cached: true,
            text: await this.getCachedContent(url)
          };
        }
        
        // Update cache on successful fetch
        if (result.success && result.text) {
          await this.updateCache(url, result);
        }
        
        return result;
        
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastError = errorMessage;
        
        console.warn(`[PageLoader] Fetch attempt ${attempt + 1} failed for ${url}:`, errorMessage);
        
        if (attempt < fetchOptions.retries!) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    return {
      success: false,
      status: 0,
      statusText: 'Network Error',
      url,
      headers: {},
      error: lastError || 'Max retries exceeded'
    };
  }

  private async performFetch(url: string, options: FetchOptions): Promise<FetchResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        credentials: options.credentials,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const result: FetchResult = {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers,
        etag: headers['etag'],
        lastModified: headers['last-modified'],
        size: parseInt(headers['content-length'] || '0')
      };

      // Handle different response types
      if (response.ok) {
        const contentType = headers['content-type'] || '';
        
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
          result.text = await response.text();
        } else {
          result.error = `Unsupported content type: ${contentType}`;
        }
      } else {
        result.error = `HTTP ${response.status}: ${response.statusText}`;
      }

      return result;

    } catch (error: unknown) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request timeout');
        }
        throw error;
      }
      
      throw new Error('Unknown fetch error');
    }
  }

  // Cache management
  private async updateCache(url: string, result: FetchResult): Promise<void> {
    if (!result.text) return;

    const hash = await this.hashContent(result.text);
    const entry: CacheEntry = {
      url,
      etag: result.etag,
      lastModified: result.lastModified,
      lastFetched: Date.now(),
      size: result.text.length,
      hash
    };

    this.cache.set(url, entry);
    await this.saveCache();
    
    console.log(`[PageLoader] Cached ${url} (${result.text.length} bytes, hash: ${hash})`);
  }

  private async getCachedContent(url: string): Promise<string | undefined> {
    // In a real implementation, this would retrieve from storage
    // For now, we'll return undefined to force a fresh fetch
    return undefined;
  }

  private async hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async loadCache(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['pageCache']);
      if (result.pageCache) {
        this.cache = new Map(Object.entries(result.pageCache));
        console.log(`[PageLoader] Loaded ${this.cache.size} cache entries`);
      }
    } catch (error) {
      console.error('[PageLoader] Failed to load cache:', error);
    }
  }

  private async saveCache(): Promise<void> {
    try {
      const cacheObj = Object.fromEntries(this.cache);
      await chrome.storage.local.set({ pageCache: cacheObj });
    } catch (error) {
      console.error('[PageLoader] Failed to save cache:', error);
    }
  }

  // Utility methods
  async clearCache(): Promise<void> {
    this.cache.clear();
    await chrome.storage.local.remove(['pageCache']);
    console.log('[PageLoader] Cache cleared');
  }

  getCacheStats(): { size: number; totalSize: number } {
    const totalSize = Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0);
    return { size: this.cache.size, totalSize };
  }

  // Canvas-specific helpers
  async fetchDashboard(host: string): Promise<FetchResult> {
    return this.fetchPage(`${host}/dashboard`);
  }

  async fetchCourseList(host: string): Promise<FetchResult> {
    return this.fetchPage(`${host}/courses`);
  }

  async fetchCoursePage(host: string, courseId: string): Promise<FetchResult> {
    return this.fetchPage(`${host}/courses/${courseId}`);
  }
}

export const pageLoader = new PageLoader();

