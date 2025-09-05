// Incremental Sync for Canvas Scraper - Phase 11
// Implements ETag/Last-Modified caching and change detection for efficient updates

import { storageManager } from './storageManager';
import { pageLoader } from './pageLoader';

export interface CacheEntry {
  url: string;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  lastChecked: number;
  lastUpdated: number;
  hitCount: number;
  metadata?: Record<string, any>;
}

export interface ChangeSignal {
  url: string;
  changeType: 'added' | 'modified' | 'removed';
  detectedAt: number;
  previousHash?: string;
  currentHash?: string;
  metadata?: Record<string, any>;
}

export interface SyncResult {
  url: string;
  changed: boolean;
  cached: boolean;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  timing: {
    cacheCheck: number;
    download: number;
    processing: number;
    total: number;
  };
}

export interface IncrementalSyncConfig {
  enableLogging: boolean;
  maxCacheAge: number; // in milliseconds
  maxCacheEntries: number;
  enableETagCaching: boolean;
  enableLastModified: boolean;
  enableContentHashing: boolean;
  forceRefreshInterval: number; // force refresh after this many days
}

export class IncrementalSync {
  private config: IncrementalSyncConfig;
  private cache = new Map<string, CacheEntry>();
  private changeSignals = new Map<string, ChangeSignal[]>();

  constructor(config?: Partial<IncrementalSyncConfig>) {
    this.config = {
      enableLogging: true,
      maxCacheAge: 24 * 60 * 60 * 1000, // 24 hours
      maxCacheEntries: 10000,
      enableETagCaching: true,
      enableLastModified: true,
      enableContentHashing: true,
      forceRefreshInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
      ...config
    };

    this.loadCache();
  }

  // Main method for incremental sync of a URL
  async syncUrl(url: string, options?: { forceRefresh?: boolean }): Promise<SyncResult> {
    const startTime = Date.now();
    let cacheCheckTime = 0;
    let downloadTime = 0;
    let processingTime = 0;

    try {
      this.log(`[IncrementalSync] Starting sync for: ${url}`);

      // Step 1: Check cache
      const cacheStart = Date.now();
      const cacheEntry = await this.getCacheEntry(url);
      const shouldRefresh = this.shouldRefreshUrl(url, cacheEntry, options?.forceRefresh);
      cacheCheckTime = Date.now() - cacheStart;

      if (!shouldRefresh && cacheEntry) {
        this.log(`[IncrementalSync] Using cached content for: ${url}`);
        
        // Update hit count and last checked
        cacheEntry.hitCount++;
        cacheEntry.lastChecked = Date.now();
        await this.updateCacheEntry(url, cacheEntry);

        return {
          url,
          changed: false,
          cached: true,
          etag: cacheEntry.etag,
          lastModified: cacheEntry.lastModified,
          contentHash: cacheEntry.contentHash,
          timing: {
            cacheCheck: cacheCheckTime,
            download: 0,
            processing: 0,
            total: Date.now() - startTime
          }
        };
      }

      // Step 2: Fetch with conditional headers
      const downloadStart = Date.now();
      const fetchResult = await this.conditionalFetch(url, cacheEntry);
      downloadTime = Date.now() - downloadStart;

      if (fetchResult.notModified && cacheEntry) {
        this.log(`[IncrementalSync] Content not modified: ${url}`);
        
        // Update cache metadata
        cacheEntry.lastChecked = Date.now();
        cacheEntry.hitCount++;
        await this.updateCacheEntry(url, cacheEntry);

        return {
          url,
          changed: false,
          cached: true,
          etag: cacheEntry.etag,
          lastModified: cacheEntry.lastModified,
          contentHash: cacheEntry.contentHash,
          timing: {
            cacheCheck: cacheCheckTime,
            download: downloadTime,
            processing: 0,
            total: Date.now() - startTime
          }
        };
      }

      // Step 3: Process new content
      const processingStart = Date.now();
      const contentHash = await this.generateContentHash(fetchResult.content);
      const newCacheEntry = await this.createCacheEntry(url, fetchResult, contentHash);
      processingTime = Date.now() - processingStart;

      // Step 4: Detect changes
      const hasChanged = await this.detectChanges(url, cacheEntry, newCacheEntry);

      // Step 5: Update cache
      await this.updateCacheEntry(url, newCacheEntry);

      // Step 6: Record change signals if content changed
      if (hasChanged) {
        await this.recordChangeSignal(url, cacheEntry, newCacheEntry);
      }

      const totalTime = Date.now() - startTime;
      this.log(`[IncrementalSync] Sync completed for: ${url} (changed: ${hasChanged}, ${totalTime}ms)`);

      return {
        url,
        changed: hasChanged,
        cached: false,
        etag: newCacheEntry.etag,
        lastModified: newCacheEntry.lastModified,
        contentHash: contentHash,
        timing: {
          cacheCheck: cacheCheckTime,
          download: downloadTime,
          processing: processingTime,
          total: totalTime
        }
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.log(`[IncrementalSync] Sync failed for ${url}: ${error}`);
      
      // Return error result
      return {
        url,
        changed: false,
        cached: false,
        contentHash: '',
        timing: {
          cacheCheck: cacheCheckTime,
          download: downloadTime,
          processing: processingTime,
          total: totalTime
        }
      };
    }
  }

  // Check if URL should be refreshed
  private shouldRefreshUrl(url: string, cacheEntry: CacheEntry | null, forceRefresh?: boolean): boolean {
    if (forceRefresh) {
      this.log(`[IncrementalSync] Force refresh requested for: ${url}`);
      return true;
    }

    if (!cacheEntry) {
      this.log(`[IncrementalSync] No cache entry found for: ${url}`);
      return true;
    }

    const now = Date.now();
    const age = now - cacheEntry.lastUpdated;

    // Check if cache is too old
    if (age > this.config.maxCacheAge) {
      this.log(`[IncrementalSync] Cache expired for: ${url} (age: ${Math.round(age / (60 * 1000))} minutes)`);
      return true;
    }

    // Check if force refresh interval has passed
    if (age > this.config.forceRefreshInterval) {
      this.log(`[IncrementalSync] Force refresh interval reached for: ${url}`);
      return true;
    }

    return false;
  }

  // Perform conditional fetch with ETag/Last-Modified headers
  private async conditionalFetch(url: string, cacheEntry: CacheEntry | null): Promise<{
    content: string;
    etag?: string;
    lastModified?: string;
    notModified: boolean;
  }> {
    try {
      const headers: Record<string, string> = {};

      // Add conditional headers if available
      if (cacheEntry && this.config.enableETagCaching && cacheEntry.etag) {
        headers['If-None-Match'] = cacheEntry.etag;
      }

      if (cacheEntry && this.config.enableLastModified && cacheEntry.lastModified) {
        headers['If-Modified-Since'] = cacheEntry.lastModified;
      }

      this.log(`[IncrementalSync] Fetching with headers: ${Object.keys(headers).join(', ')}`);

      const response = await fetch(url, { headers });

      // Handle 304 Not Modified
      if (response.status === 304) {
        this.log(`[IncrementalSync] Content not modified (304): ${url}`);
        return {
          content: '',
          etag: cacheEntry?.etag,
          lastModified: cacheEntry?.lastModified,
          notModified: true
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.text();
      const etag = response.headers.get('etag') || undefined;
      const lastModified = response.headers.get('last-modified') || undefined;

      this.log(`[IncrementalSync] Fetched ${content.length} bytes with ETag: ${etag}, Last-Modified: ${lastModified}`);

      return {
        content,
        etag,
        lastModified,
        notModified: false
      };

    } catch (error) {
      this.log(`[IncrementalSync] Conditional fetch failed: ${error}`);
      throw error;
    }
  }

  // Generate content hash for change detection
  private async generateContentHash(content: string): Promise<string> {
    try {
      if (!this.config.enableContentHashing) {
        return `no-hash-${Date.now()}`;
      }

      // Normalize content before hashing (remove dynamic timestamps, etc.)
      const normalizedContent = this.normalizeContent(content);
      
      const encoder = new TextEncoder();
      const data = encoder.encode(normalizedContent);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
    } catch (error) {
      // Fallback hash
      return `fallback-${content.length}-${Date.now()}`;
    }
  }

  // Normalize content to remove dynamic elements before hashing
  private normalizeContent(content: string): string {
    return content
      // Remove timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP')
      .replace(/\d{13,}/g, 'TIMESTAMP') // Unix timestamps
      // Remove session IDs and tokens
      .replace(/session[_-]id[^&\s"]*/gi, 'SESSION_ID')
      .replace(/csrf[_-]token[^&\s"]*/gi, 'CSRF_TOKEN')
      .replace(/authenticity[_-]token[^&\s"]*/gi, 'AUTH_TOKEN')
      // Remove dynamic IDs
      .replace(/id="[^"]*\d{10,}[^"]*"/g, 'id="DYNAMIC_ID"')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Create cache entry from fetch result
  private async createCacheEntry(url: string, fetchResult: any, contentHash: string): Promise<CacheEntry> {
    const now = Date.now();
    
    return {
      url,
      etag: fetchResult.etag,
      lastModified: fetchResult.lastModified,
      contentHash,
      lastChecked: now,
      lastUpdated: now,
      hitCount: 0,
      metadata: {
        contentLength: fetchResult.content?.length || 0,
        responseHeaders: {
          etag: fetchResult.etag,
          lastModified: fetchResult.lastModified
        }
      }
    };
  }

  // Detect changes between old and new cache entries
  private async detectChanges(url: string, oldEntry: CacheEntry | null, newEntry: CacheEntry): Promise<boolean> {
    if (!oldEntry) {
      this.log(`[IncrementalSync] New content detected: ${url}`);
      return true;
    }

    // Check content hash
    if (oldEntry.contentHash !== newEntry.contentHash) {
      this.log(`[IncrementalSync] Content changed (hash): ${url}`);
      return true;
    }

    // Check ETag
    if (oldEntry.etag && newEntry.etag && oldEntry.etag !== newEntry.etag) {
      this.log(`[IncrementalSync] Content changed (ETag): ${url}`);
      return true;
    }

    // Check Last-Modified
    if (oldEntry.lastModified && newEntry.lastModified && oldEntry.lastModified !== newEntry.lastModified) {
      this.log(`[IncrementalSync] Content changed (Last-Modified): ${url}`);
      return true;
    }

    return false;
  }

  // Record change signal for targeted recrawling
  private async recordChangeSignal(url: string, oldEntry: CacheEntry | null, newEntry: CacheEntry): Promise<void> {
    const changeSignal: ChangeSignal = {
      url,
      changeType: oldEntry ? 'modified' : 'added',
      detectedAt: Date.now(),
      previousHash: oldEntry?.contentHash,
      currentHash: newEntry.contentHash,
      metadata: {
        oldETag: oldEntry?.etag,
        newETag: newEntry.etag,
        oldLastModified: oldEntry?.lastModified,
        newLastModified: newEntry.lastModified
      }
    };

    // Store change signals per URL
    if (!this.changeSignals.has(url)) {
      this.changeSignals.set(url, []);
    }
    
    const signals = this.changeSignals.get(url)!;
    signals.push(changeSignal);
    
    // Keep only recent signals (last 100)
    if (signals.length > 100) {
      signals.splice(0, signals.length - 100);
    }

    this.log(`[IncrementalSync] Recorded ${changeSignal.changeType} signal for: ${url}`);
    
    // Save to storage
    await this.saveChangeSignals();
  }

  // Get cache entry for URL
  private async getCacheEntry(url: string): Promise<CacheEntry | null> {
    return this.cache.get(url) || null;
  }

  // Update cache entry
  private async updateCacheEntry(url: string, entry: CacheEntry): Promise<void> {
    this.cache.set(url, entry);
    
    // Cleanup old entries if cache is too large
    if (this.cache.size > this.config.maxCacheEntries) {
      await this.cleanupCache();
    }
    
    // Save cache periodically
    await this.saveCache();
  }

  // Load cache from storage
  private async loadCache(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['incrementalSyncCache']);
      const stored = result.incrementalSyncCache;
      
      if (stored && Array.isArray(stored)) {
        for (const entry of stored) {
          this.cache.set(entry.url, entry);
        }
        this.log(`[IncrementalSync] Loaded ${this.cache.size} cache entries`);
      }

      // Load change signals
      const signalsResult = await chrome.storage.local.get(['changeSignals']);
      const storedSignals = signalsResult.changeSignals;
      
      if (storedSignals) {
        Object.entries(storedSignals).forEach(([url, signals]) => {
          this.changeSignals.set(url, signals as ChangeSignal[]);
        });
        this.log(`[IncrementalSync] Loaded change signals for ${this.changeSignals.size} URLs`);
      }

    } catch (error) {
      this.log(`[IncrementalSync] Error loading cache: ${error}`);
    }
  }

  // Save cache to storage
  private async saveCache(): Promise<void> {
    try {
      const cacheArray = Array.from(this.cache.values());
      await chrome.storage.local.set({ incrementalSyncCache: cacheArray });
      
    } catch (error) {
      this.log(`[IncrementalSync] Error saving cache: ${error}`);
    }
  }

  // Save change signals to storage
  private async saveChangeSignals(): Promise<void> {
    try {
      const signalsObject: Record<string, ChangeSignal[]> = {};
      this.changeSignals.forEach((signals, url) => {
        signalsObject[url] = signals;
      });
      
      await chrome.storage.local.set({ changeSignals: signalsObject });
      
    } catch (error) {
      this.log(`[IncrementalSync] Error saving change signals: ${error}`);
    }
  }

  // Cleanup old cache entries
  private async cleanupCache(): Promise<void> {
    this.log(`[IncrementalSync] Cleaning up cache (${this.cache.size} entries)`);
    
    // Sort by last checked (least recently used first)
    const entries = Array.from(this.cache.entries())
      .sort(([, a], [, b]) => a.lastChecked - b.lastChecked);
    
    // Remove oldest entries
    const toRemove = entries.slice(0, entries.length - this.config.maxCacheEntries + 1000);
    
    for (const [url] of toRemove) {
      this.cache.delete(url);
    }
    
    this.log(`[IncrementalSync] Removed ${toRemove.length} old cache entries`);
    await this.saveCache();
  }

  // Get URLs that have changed recently
  getChangedUrls(since?: number): string[] {
    const sinceTime = since || (Date.now() - (24 * 60 * 60 * 1000)); // Last 24 hours
    const changedUrls: string[] = [];
    
    this.changeSignals.forEach((signals, url) => {
      const recentChanges = signals.filter(signal => signal.detectedAt > sinceTime);
      if (recentChanges.length > 0) {
        changedUrls.push(url);
      }
    });
    
    return changedUrls;
  }

  // Plan targeted recrawl based on change signals
  planTargetedRecrawl(): Array<{url: string, priority: number, reason: string}> {
    const recrawlPlan: Array<{url: string, priority: number, reason: string}> = [];
    
    // High priority: URLs with recent changes
    const recentChanges = this.getChangedUrls(Date.now() - (60 * 60 * 1000)); // Last hour
    recentChanges.forEach(url => {
      recrawlPlan.push({
        url,
        priority: 10,
        reason: 'Recent content changes detected'
      });
    });
    
    // Medium priority: URLs not checked recently
    const now = Date.now();
    this.cache.forEach((entry, url) => {
      const timeSinceCheck = now - entry.lastChecked;
      
      if (timeSinceCheck > this.config.maxCacheAge) {
        recrawlPlan.push({
          url,
          priority: 5,
          reason: `Cache expired (${Math.round(timeSinceCheck / (60 * 60 * 1000))} hours old)`
        });
      }
    });
    
    // Sort by priority (highest first)
    recrawlPlan.sort((a, b) => b.priority - a.priority);
    
    return recrawlPlan;
  }

  // Get sync statistics
  getStats(): {
    cacheEntries: number;
    changeSignals: number;
    hitRate: number;
    oldestEntry: number;
    newestEntry: number;
    totalHits: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hitCount, 0);
    const totalRequests = entries.reduce((sum, entry) => sum + entry.hitCount + 1, 0); // +1 for initial request
    
    return {
      cacheEntries: this.cache.size,
      changeSignals: this.changeSignals.size,
      hitRate: totalRequests > 0 ? Math.round((totalHits / totalRequests) * 100) : 0,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.lastUpdated)) : 0,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.lastUpdated)) : 0,
      totalHits
    };
  }

  // Clear all cache and change signals
  async clearAll(): Promise<void> {
    this.cache.clear();
    this.changeSignals.clear();
    
    await chrome.storage.local.remove(['incrementalSyncCache', 'changeSignals']);
    this.log(`[IncrementalSync] Cleared all cache and change signals`);
  }

  // Test incremental sync functionality
  async testIncrementalSync(): Promise<void> {
    this.log(`[IncrementalSync] Testing incremental sync functionality...`);
    
    try {
      // Test with Canvas dashboard (we know this URL works)
      const testUrl = 'https://canvas.instructure.com/dashboard';
      
      console.log('[Phase11Test] Test 1: First sync (should fetch)');
      const firstSync = await this.syncUrl(testUrl);
      console.log('[Phase11Test] First sync result:', {
        changed: firstSync.changed,
        cached: firstSync.cached,
        contentHash: firstSync.contentHash.substring(0, 16) + '...',
        timing: firstSync.timing
      });
      
      console.log('[Phase11Test] Test 2: Second sync (should use cache)');
      const secondSync = await this.syncUrl(testUrl);
      console.log('[Phase11Test] Second sync result:', {
        changed: secondSync.changed,
        cached: secondSync.cached,
        contentHash: secondSync.contentHash.substring(0, 16) + '...',
        timing: secondSync.timing
      });
      
      console.log('[Phase11Test] Test 3: Force refresh');
      const forceSync = await this.syncUrl(testUrl, { forceRefresh: true });
      console.log('[Phase11Test] Force sync result:', {
        changed: forceSync.changed,
        cached: forceSync.cached,
        timing: forceSync.timing
      });
      
      // Show statistics
      const stats = this.getStats();
      console.log('[Phase11Test] Sync statistics:', stats);
      
      console.log('[Phase11Test] ✅ Incremental sync test complete!');
      
    } catch (error) {
      console.log('[Phase11Test] ❌ Test failed:', error);
    }
  }

  // Utility method for logging
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(message);
    }
  }
}

export const incrementalSync = new IncrementalSync();

