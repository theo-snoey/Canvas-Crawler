// Content Utilities for Canvas Scraper
// Handles content hashing, compression, and data processing

import { gzip, ungzip } from 'pako';

export class ContentUtils {
  private static encoder = new TextEncoder();
  private static decoder = new TextDecoder();

  /**
   * Generate SHA-256 hash of content
   */
  static async hashContent(content: string | ArrayBuffer): Promise<string> {
    const data = typeof content === 'string' ? this.encoder.encode(content) : content;
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return this.arrayBufferToHex(hashBuffer);
  }

  /**
   * Compress text content using gzip
   */
  static async compressText(text: string): Promise<ArrayBuffer> {
    const encoded = this.encoder.encode(text);
    const compressed = gzip(encoded);
    return compressed.buffer;
  }

  /**
   * Decompress text content
   */
  static async decompressText(compressed: ArrayBuffer): Promise<string> {
    const decompressed = ungzip(new Uint8Array(compressed));
    return this.decoder.decode(decompressed);
  }

  /**
   * Normalize HTML content for consistent hashing
   */
  static normalizeHtml(html: string): string {
    return html
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/>\s+</g, '><') // Remove whitespace between tags
      .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .trim();
  }

  /**
   * Extract text content from HTML
   */
  static extractTextFromHtml(html: string): string {
    // Simple text extraction - remove HTML tags
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
      .replace(/&amp;/g, '&') // Replace &amp; with &
      .replace(/&lt;/g, '<') // Replace &lt; with <
      .replace(/&gt;/g, '>') // Replace &gt; with >
      .replace(/&quot;/g, '"') // Replace &quot; with "
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Generate a unique ID for content
   */
  static generateId(prefix: string, content: string): string {
    const timestamp = Date.now();
    const hash = this.simpleHash(content);
    return `${prefix}_${timestamp}_${hash}`;
  }

  /**
   * Calculate content size in bytes
   */
  static getContentSize(content: string | ArrayBuffer): number {
    if (typeof content === 'string') {
      return this.encoder.encode(content).byteLength;
    }
    return content.byteLength;
  }

  /**
   * Check if content has changed by comparing hashes
   */
  static async hasContentChanged(oldHash: string, newContent: string): Promise<boolean> {
    const newHash = await this.hashContent(newContent);
    return oldHash !== newHash;
  }

  /**
   * Batch process multiple content items
   */
  static async batchProcess<T>(
    items: T[],
    processor: (item: T) => Promise<any>,
    batchSize: number = 10
  ): Promise<any[]> {
    const results: any[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
      
      // Small delay to prevent blocking
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    return results;
  }

  /**
   * Clean up old content based on timestamp
   */
  static isContentExpired(timestamp: number, maxAgeMs: number): boolean {
    return Date.now() - timestamp > maxAgeMs;
  }

  // Private utility methods

  private static arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Storage optimization utilities
 */
export class StorageOptimizer {
  /**
   * Optimize HTML content for storage
   */
  static async optimizeHtmlForStorage(html: string, url: string): Promise<{
    id: string;
    normalizedHtml: string;
    hash: string;
    size: number;
    compressedSize: number;
  }> {
    const normalizedHtml = ContentUtils.normalizeHtml(html);
    const hash = await ContentUtils.hashContent(normalizedHtml);
    const id = ContentUtils.generateId('html', `${url}_${hash}`);
    const size = ContentUtils.getContentSize(html);
    const compressed = await ContentUtils.compressText(normalizedHtml);
    const compressedSize = compressed.byteLength;

    return {
      id,
      normalizedHtml,
      hash,
      size,
      compressedSize
    };
  }

  /**
   * Optimize structured data for storage
   */
  static async optimizeStructuredData(
    data: any,
    courseId: string,
    collection: string,
    itemId: string
  ): Promise<{
    id: string;
    hash: string;
    size: number;
  }> {
    const jsonString = JSON.stringify(data);
    const hash = await ContentUtils.hashContent(jsonString);
    const id = ContentUtils.generateId('struct', `${courseId}_${collection}_${itemId}`);
    const size = ContentUtils.getContentSize(jsonString);

    return {
      id,
      hash,
      size
    };
  }

  /**
   * Calculate storage efficiency metrics
   */
  static calculateEfficiency(originalSize: number, compressedSize: number): {
    compressionRatio: number;
    spaceSaved: number;
    efficiencyPercentage: number;
  } {
    const compressionRatio = compressedSize / originalSize;
    const spaceSaved = originalSize - compressedSize;
    const efficiencyPercentage = ((originalSize - compressedSize) / originalSize) * 100;

    return {
      compressionRatio,
      spaceSaved,
      efficiencyPercentage
    };
  }
}

/**
 * Content deduplication utilities
 */
export class DeduplicationUtils {
  private static hashCache = new Map<string, string>();

  /**
   * Check if content is duplicate
   */
  static async isDuplicate(content: string, existingHashes: Set<string>): Promise<{
    isDuplicate: boolean;
    hash: string;
  }> {
    const hash = await ContentUtils.hashContent(content);
    const isDuplicate = existingHashes.has(hash);
    
    return {
      isDuplicate,
      hash
    };
  }

  /**
   * Find similar content using fuzzy matching
   */
  static findSimilarContent(
    targetContent: string,
    existingContent: Array<{ content: string; hash: string }>,
    similarityThreshold: number = 0.8
  ): Array<{ content: string; hash: string; similarity: number }> {
    const similar: Array<{ content: string; hash: string; similarity: number }> = [];

    for (const item of existingContent) {
      const similarity = this.calculateSimilarity(targetContent, item.content);
      if (similarity >= similarityThreshold) {
        similar.push({
          content: item.content,
          hash: item.hash,
          similarity
        });
      }
    }

    return similar.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Calculate similarity between two strings using Jaccard similarity
   */
  private static calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }
}
