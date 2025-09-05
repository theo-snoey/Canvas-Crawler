// Storage Manager for Canvas Scraper
// Handles IndexedDB, chrome.storage.local, schema versioning, and migrations

export interface StorageSchema {
  version: number;
  studentIndex: {
    courses: string[];
    lastCrawl: number | null;
    version: string;
  };
  courseIndex: Record<string, {
    collections: Record<string, {
      itemIds: string[];
      etag: string | null;
      lastModified: string | null;
      lastHash: string | null;
    }>;
    lastUpdated: number;
  }>;
}

export interface HtmlSnapshot {
  id: string;
  url: string;
  html: string;
  timestamp: number;
  hash: string;
  size: number;
}

export interface StructuredData {
  id: string;
  courseId: string;
  collection: string;
  itemId: string;
  data: any;
  timestamp: number;
  version: string;
}

export interface ExtractedText {
  id: string;
  sourceId: string;
  sourceType: 'html' | 'pdf' | 'image';
  text: string;
  timestamp: number;
  hash: string;
}

export interface BlobData {
  id: string;
  sourceId: string;
  mimeType: string;
  data: ArrayBuffer;
  hash: string;
  timestamp: number;
  size: number;
}

const CURRENT_SCHEMA_VERSION = 1;
const DB_NAME = 'CanvasScraperDB';
const DB_VERSION = 1;

export class StorageManager {
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.initializeIndexedDB();
      await this.initializeChromeStorage();
      await this.migrateSchema();
      this.isInitialized = true;
      console.log('[StorageManager] Storage initialized successfully');
    } catch (error) {
      console.error('[StorageManager] Failed to initialize storage:', error);
      throw error;
    }
  }

  private async initializeIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[StorageManager] IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[StorageManager] IndexedDB opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.log('[StorageManager] Creating IndexedDB stores...');

        // Create stores
        if (!db.objectStoreNames.contains('htmlSnapshots')) {
          const snapshotStore = db.createObjectStore('htmlSnapshots', { keyPath: 'id' });
          snapshotStore.createIndex('url', 'url', { unique: false });
          snapshotStore.createIndex('timestamp', 'timestamp', { unique: false });
          snapshotStore.createIndex('hash', 'hash', { unique: false });
        }

        if (!db.objectStoreNames.contains('structured')) {
          const structuredStore = db.createObjectStore('structured', { keyPath: 'id' });
          structuredStore.createIndex('courseId', 'courseId', { unique: false });
          structuredStore.createIndex('collection', 'collection', { unique: false });
          structuredStore.createIndex('itemId', 'itemId', { unique: false });
          structuredStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('extractedText')) {
          const textStore = db.createObjectStore('extractedText', { keyPath: 'id' });
          textStore.createIndex('sourceId', 'sourceId', { unique: false });
          textStore.createIndex('sourceType', 'sourceType', { unique: false });
          textStore.createIndex('hash', 'hash', { unique: false });
        }

        if (!db.objectStoreNames.contains('blobs')) {
          const blobStore = db.createObjectStore('blobs', { keyPath: 'id' });
          blobStore.createIndex('sourceId', 'sourceId', { unique: false });
          blobStore.createIndex('hash', 'hash', { unique: false });
          blobStore.createIndex('mimeType', 'mimeType', { unique: false });
        }
      };
    });
  }

  private async initializeChromeStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['canvasStorageSchema']);
      if (!result.canvasStorageSchema) {
        // Initialize with default schema
        const defaultSchema: StorageSchema = {
          version: CURRENT_SCHEMA_VERSION,
          studentIndex: {
            courses: [],
            lastCrawl: null,
            version: '1.0.0'
          },
          courseIndex: {}
        };
        await chrome.storage.local.set({ canvasStorageSchema: defaultSchema });
        console.log('[StorageManager] Chrome storage initialized with default schema');
      }
    } catch (error) {
      console.error('[StorageManager] Failed to initialize chrome storage:', error);
      throw error;
    }
  }

  private async migrateSchema(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['canvasStorageSchema']);
      const currentSchema = result.canvasStorageSchema as StorageSchema;

      if (!currentSchema || currentSchema.version < CURRENT_SCHEMA_VERSION) {
        console.log('[StorageManager] Migrating schema from v', currentSchema?.version || 0, 'to v', CURRENT_SCHEMA_VERSION);
        
        // Migration logic here
        const migratedSchema: StorageSchema = {
          version: CURRENT_SCHEMA_VERSION,
          studentIndex: currentSchema?.studentIndex || {
            courses: [],
            lastCrawl: null,
            version: '1.0.0'
          },
          courseIndex: currentSchema?.courseIndex || {}
        };

        await chrome.storage.local.set({ canvasStorageSchema: migratedSchema });
        console.log('[StorageManager] Schema migration completed');
      }
    } catch (error) {
      console.error('[StorageManager] Schema migration failed:', error);
      throw error;
    }
  }

  // IndexedDB Operations
  async saveHtmlSnapshot(snapshot: HtmlSnapshot): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['htmlSnapshots'], 'readwrite');
      const store = transaction.objectStore('htmlSnapshots');
      const request = store.put(snapshot);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getHtmlSnapshot(id: string): Promise<HtmlSnapshot | null> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['htmlSnapshots'], 'readonly');
      const store = transaction.objectStore('htmlSnapshots');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveStructuredData(data: StructuredData): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['structured'], 'readwrite');
      const store = transaction.objectStore('structured');
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStructuredData(id: string): Promise<StructuredData | null> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['structured'], 'readonly');
      const store = transaction.objectStore('structured');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveExtractedText(text: ExtractedText): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['extractedText'], 'readwrite');
      const store = transaction.objectStore('extractedText');
      const request = store.put(text);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveBlob(blob: BlobData): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['blobs'], 'readwrite');
      const store = transaction.objectStore('blobs');
      const request = store.put(blob);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Chrome Storage Operations
  async getStudentIndex(): Promise<StorageSchema['studentIndex']> {
    const result = await chrome.storage.local.get(['canvasStorageSchema']);
    return result.canvasStorageSchema?.studentIndex || {
      courses: [],
      lastCrawl: null,
      version: '1.0.0'
    };
  }

  async updateStudentIndex(updates: Partial<StorageSchema['studentIndex']>): Promise<void> {
    const result = await chrome.storage.local.get(['canvasStorageSchema']);
    const schema = result.canvasStorageSchema as StorageSchema;
    
    schema.studentIndex = { ...schema.studentIndex, ...updates };
    await chrome.storage.local.set({ canvasStorageSchema: schema });
  }

  async getCourseIndex(courseId: string): Promise<StorageSchema['courseIndex'][string] | null> {
    const result = await chrome.storage.local.get(['canvasStorageSchema']);
    return result.canvasStorageSchema?.courseIndex?.[courseId] || null;
  }

  async updateCourseIndex(courseId: string, updates: Partial<StorageSchema['courseIndex'][string]>): Promise<void> {
    const result = await chrome.storage.local.get(['canvasStorageSchema']);
    const schema = result.canvasStorageSchema as StorageSchema;
    
    if (!schema.courseIndex[courseId]) {
      schema.courseIndex[courseId] = {
        collections: {},
        lastUpdated: Date.now()
      };
    }
    
    schema.courseIndex[courseId] = { ...schema.courseIndex[courseId], ...updates };
    await chrome.storage.local.set({ canvasStorageSchema: schema });
  }

  // Utility Methods
  isReady(): boolean {
    return this.isInitialized && this.db !== null;
  }

  async clearAllData(): Promise<void> {
    // Clear IndexedDB
    if (this.db) {
      const stores = ['htmlSnapshots', 'structured', 'extractedText', 'blobs'];
      for (const storeName of stores) {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        await new Promise<void>((resolve, reject) => {
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
    }

    // Clear Chrome storage
    await chrome.storage.local.clear();
    
    // Reinitialize
    await this.initialize();
  }

  async getStorageStats(): Promise<{
    htmlSnapshots: number;
    structured: number;
    extractedText: number;
    blobs: number;
    totalSize: number;
  }> {
    if (!this.db) throw new Error('IndexedDB not initialized');

    const stats = {
      htmlSnapshots: 0,
      structured: 0,
      extractedText: 0,
      blobs: 0,
      totalSize: 0
    };

    const stores = ['htmlSnapshots', 'structured', 'extractedText', 'blobs'];
    
    for (const storeName of stores) {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const countRequest = store.count();
      
      await new Promise<void>((resolve, reject) => {
        countRequest.onsuccess = () => {
          stats[storeName as keyof typeof stats] = countRequest.result;
          resolve();
        };
        countRequest.onerror = () => reject(countRequest.error);
      });
    }

    return stats;
  }
}

export const storageManager = new StorageManager();

