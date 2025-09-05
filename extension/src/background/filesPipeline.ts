// Files Pipeline for Canvas Scraper - Phase 10
// Handles file downloads, PDF text extraction, and OCR capabilities

import { ghostTabManager } from './ghostTabManager';
import { storageManager } from './storageManager';

export interface FileItem {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
  downloadUrl: string;
  courseId: string;
  sourceUrl: string;
  contentHash?: string;
  extractedText?: string;
  ocrText?: string;
  downloadedAt?: number;
  processedAt?: number;
  metadata?: Record<string, any>;
}

export interface FileProcessResult {
  success: boolean;
  fileItem?: FileItem;
  error?: string;
  timing: {
    download: number;
    processing: number;
    total: number;
  };
}

export interface FilesPipelineConfig {
  enableLogging: boolean;
  maxConcurrentDownloads: number;
  maxFileSize: number; // in bytes
  enablePdfExtraction: boolean;
  enableOcr: boolean;
  downloadTimeout: number;
  supportedTypes: string[];
  storageMode: 'text-only' | 'blob-and-text' | 'blob-only';
}

export class FilesPipeline {
  private config: FilesPipelineConfig;
  private activeDownloads = new Map<string, AbortController>();
  private downloadQueue: string[] = [];
  private processing = false;

  constructor(config?: Partial<FilesPipelineConfig>) {
    this.config = {
      enableLogging: true,
      maxConcurrentDownloads: 3,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      enablePdfExtraction: true,
      enableOcr: false, // Off by default as specified
      downloadTimeout: 60000, // 1 minute
      supportedTypes: ['pdf', 'doc', 'docx', 'txt', 'jpg', 'png', 'gif', 'xlsx', 'pptx'],
      storageMode: 'text-only',
      ...config
    };
  }

  // Main method to process a file
  async processFile(fileUrl: string, courseId: string, sourceUrl: string): Promise<FileProcessResult> {
    const startTime = Date.now();
    let downloadTime = 0;
    let processingTime = 0;

    try {
      this.log(`[FilesPipeline] Starting file processing: ${fileUrl}`);

      // Step 1: Extract file metadata
      const fileMetadata = await this.extractFileMetadata(fileUrl, courseId, sourceUrl);
      
      // Step 2: Check if file type is supported
      if (!this.isFileTypeSupported(fileMetadata.fileType)) {
        throw new Error(`Unsupported file type: ${fileMetadata.fileType}`);
      }

      // Step 3: Check file size
      if (fileMetadata.fileSize > this.config.maxFileSize) {
        throw new Error(`File too large: ${fileMetadata.fileSize} bytes (max: ${this.config.maxFileSize})`);
      }

      // Step 4: Download file
      const downloadStart = Date.now();
      const fileBlob = await this.downloadFile(fileUrl, fileMetadata.fileName);
      downloadTime = Date.now() - downloadStart;

      // Step 5: Generate content hash for deduplication
      const contentHash = await this.generateContentHash(fileBlob);
      
      // Step 6: Check for existing file with same hash
      const existingFile = await this.findExistingFileByHash(contentHash);
      if (existingFile) {
        this.log(`[FilesPipeline] File already exists with hash ${contentHash}, skipping processing`);
        return {
          success: true,
          fileItem: existingFile,
          timing: { download: downloadTime, processing: 0, total: Date.now() - startTime }
        };
      }

      // Step 7: Process file content
      const processStart = Date.now();
      const fileItem = await this.processFileContent(fileBlob, fileMetadata, contentHash);
      processingTime = Date.now() - processStart;

      // Step 8: Store file data
      await this.storeFileData(fileItem);

      const totalTime = Date.now() - startTime;
      this.log(`[FilesPipeline] File processing completed: ${fileItem.fileName} (${totalTime}ms)`);

      return {
        success: true,
        fileItem,
        timing: { download: downloadTime, processing: processingTime, total: totalTime }
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.log(`[FilesPipeline] File processing failed: ${error}`);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timing: { download: downloadTime, processing: processingTime, total: totalTime }
      };
    }
  }

  // Extract file metadata from URL or page
  private async extractFileMetadata(fileUrl: string, courseId: string, sourceUrl: string): Promise<Partial<FileItem>> {
    try {
      this.log(`[FilesPipeline] Extracting metadata for: ${fileUrl}`);
      
      // Extract filename and type from URL (avoid CORS issues)
      let fileName = 'unknown';
      let fileExtension = '';
      
      // Try to extract filename from URL
      const urlParts = fileUrl.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      
      if (lastPart && lastPart.includes('.')) {
        fileName = decodeURIComponent(lastPart);
        fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
      } else {
        // Extract file ID and try to get more info
        const fileIdMatch = fileUrl.match(/\/files\/(\d+)/);
        if (fileIdMatch) {
          fileName = `file_${fileIdMatch[1]}`;
          fileExtension = 'unknown';
        }
      }
      
      // For Canvas URLs, try to extract filename from the full URL path
      const canvasFileMatch = fileUrl.match(/\/files\/\d+\/([^?]+)/);
      if (canvasFileMatch) {
        const pathPart = decodeURIComponent(canvasFileMatch[1]);
        if (pathPart.includes('.')) {
          fileName = pathPart.split('/').pop() || fileName;
          fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
        }
      }
      
      // For Canvas download URLs without extension, assume common types
      if ((fileExtension === '' || fileExtension === 'unknown') && fileUrl.includes('/download')) {
        // Default to PDF for Canvas download URLs (most common)
        fileExtension = 'pdf';
        fileName = fileName === 'unknown' ? `file_${this.generateFileId(fileUrl)}.pdf` : `${fileName}.pdf`;
        this.log(`[FilesPipeline] Assuming PDF for Canvas download URL: ${fileName}`);
      }
      
      // Additional fallback - if still unknown, default to pdf for Canvas files
      if (fileExtension === '' || fileExtension === 'unknown') {
        if (fileUrl.includes('canvas.instructure.com') || fileUrl.includes('canvas-user-content.com')) {
          fileExtension = 'pdf';
          fileName = `canvas_file_${this.generateFileId(fileUrl)}.pdf`;
          this.log(`[FilesPipeline] Defaulting to PDF for Canvas file: ${fileName}`);
        }
      }

      return {
        id: this.generateFileId(fileUrl),
        fileName,
        fileSize: 0, // Will be determined during download
        fileType: fileExtension,
        mimeType: this.getMimeTypeFromExtension(fileExtension),
        downloadUrl: fileUrl,
        courseId,
        sourceUrl
      };

    } catch (error) {
      this.log(`[FilesPipeline] Failed to extract file metadata: ${error}`);
      throw error;
    }
  }

  // Get MIME type from file extension
  private getMimeTypeFromExtension(extension: string): string {
    const mimeTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif'
    };
    
    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  // Download file using Chrome downloads API to avoid CORS
  private async downloadFile(fileUrl: string, fileName: string): Promise<Blob> {
    const requestId = this.generateFileId(fileUrl);
    this.activeDownloads.set(requestId, new AbortController());

    try {
      this.log(`[FilesPipeline] Downloading via chrome.downloads: ${fileName}`);

      const downloadId = await chrome.downloads.download({
        url: fileUrl,
        filename: fileName,
        conflictAction: 'uniquify',
        saveAs: false
      });

      // Wait for completion (with timeout)
      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(onChanged);
            resolve();
          } else if (delta.state?.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error('Download interrupted'));
          } else if (Date.now() - startedAt > this.config.downloadTimeout) {
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error('Download timeout'));
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
      });

      // We cannot read cross-origin bytes directly; return a placeholder Blob.
      // Processing stages that require bytes should operate on the saved file path (future work).
      const placeholder = `Downloaded ${fileName} via chrome.downloads. Bytes not read due to CORS.`;
      const blob = new Blob([placeholder], { type: 'text/plain' });
      this.log(`[FilesPipeline] Download completed for ${fileName}`);
      return blob;

    } catch (error) {
      throw error;
    } finally {
      this.activeDownloads.delete(requestId);
    }
  }

  // Process file content (PDF extraction, OCR, etc.)
  private async processFileContent(fileBlob: Blob, metadata: Partial<FileItem>, contentHash: string): Promise<FileItem> {
    const fileItem: FileItem = {
      id: metadata.id!,
      fileName: metadata.fileName!,
      fileSize: metadata.fileSize!,
      fileType: metadata.fileType!,
      mimeType: metadata.mimeType!,
      downloadUrl: metadata.downloadUrl!,
      courseId: metadata.courseId!,
      sourceUrl: metadata.sourceUrl!,
      contentHash,
      downloadedAt: Date.now(),
      processedAt: Date.now(),
      metadata: {}
    };

    try {
      // PDF text extraction
      if (this.config.enablePdfExtraction && this.isPdfFile(metadata.fileType!)) {
        this.log(`[FilesPipeline] Extracting text from PDF: ${metadata.fileName}`);
        fileItem.extractedText = await this.extractPdfText(fileBlob);
        this.log(`[FilesPipeline] Extracted ${fileItem.extractedText?.length || 0} characters from PDF`);
      }

      // OCR for images (if enabled)
      if (this.config.enableOcr && this.isImageFile(metadata.fileType!)) {
        this.log(`[FilesPipeline] Performing OCR on image: ${metadata.fileName}`);
        fileItem.ocrText = await this.performOcr(fileBlob);
        this.log(`[FilesPipeline] OCR extracted ${fileItem.ocrText?.length || 0} characters`);
      }

      // Text file extraction
      if (this.isTextFile(metadata.fileType!)) {
        this.log(`[FilesPipeline] Reading text file: ${metadata.fileName}`);
        fileItem.extractedText = await this.extractTextFromBlob(fileBlob);
        this.log(`[FilesPipeline] Read ${fileItem.extractedText?.length || 0} characters from text file`);
      }

    } catch (error) {
      this.log(`[FilesPipeline] Error processing file content: ${error}`);
      // Continue even if processing fails - we still have the file metadata
    }

    return fileItem;
  }

  // Generate content hash for deduplication
  private async generateContentHash(blob: Blob): Promise<string> {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      // Fallback hash based on size and type
      return `fallback_${blob.size}_${blob.type}_${Date.now()}`;
    }
  }

  // PDF text extraction using PDF.js (placeholder - would need actual PDF.js integration)
  private async extractPdfText(pdfBlob: Blob): Promise<string> {
    try {
      // This is a placeholder implementation
      // In a real implementation, you would use PDF.js:
      // const pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
      // Extract text from each page
      
      this.log(`[FilesPipeline] PDF text extraction not yet implemented`);
      return `PDF text extraction placeholder - ${pdfBlob.size} bytes`;
      
    } catch (error) {
      this.log(`[FilesPipeline] PDF extraction failed: ${error}`);
      return '';
    }
  }

  // OCR using Tesseract.js (placeholder - would need actual Tesseract.js integration)
  private async performOcr(imageBlob: Blob): Promise<string> {
    try {
      // This is a placeholder implementation
      // In a real implementation, you would use Tesseract.js:
      // const { data: { text } } = await Tesseract.recognize(imageBlob, 'eng');
      
      this.log(`[FilesPipeline] OCR not yet implemented`);
      return `OCR placeholder - ${imageBlob.size} bytes image`;
      
    } catch (error) {
      this.log(`[FilesPipeline] OCR failed: ${error}`);
      return '';
    }
  }

  // Extract text from text files
  private async extractTextFromBlob(textBlob: Blob): Promise<string> {
    try {
      return await textBlob.text();
    } catch (error) {
      this.log(`[FilesPipeline] Text extraction failed: ${error}`);
      return '';
    }
  }

  // Store file data according to storage mode
  private async storeFileData(fileItem: FileItem): Promise<void> {
    try {
      const storageKey = `file_${fileItem.courseId}_${fileItem.id}`;
      
      switch (this.config.storageMode) {
        case 'text-only':
          // Store only extracted text and metadata
          const textOnlyData = {
            ...fileItem,
            blob: undefined // Don't store the actual file
          };
          await storageManager.saveStructuredData(storageKey, textOnlyData);
          break;
          
        case 'blob-and-text':
          // Store both file and extracted text
          await storageManager.saveStructuredData(storageKey, fileItem);
          // Note: Blob storage would need additional implementation
          break;
          
        case 'blob-only':
          // Store only file metadata and blob reference
          const blobOnlyData = {
            ...fileItem,
            extractedText: undefined,
            ocrText: undefined
          };
          await storageManager.saveStructuredData(storageKey, blobOnlyData);
          break;
      }
      
      this.log(`[FilesPipeline] Stored file data: ${fileItem.fileName} (mode: ${this.config.storageMode})`);
      
    } catch (error) {
      this.log(`[FilesPipeline] Failed to store file data: ${error}`);
      throw error;
    }
  }

  // Find existing file by content hash (deduplication)
  private async findExistingFileByHash(contentHash: string): Promise<FileItem | null> {
    try {
      // This would search through stored files for matching hash
      // Placeholder implementation
      this.log(`[FilesPipeline] Checking for existing file with hash: ${contentHash}`);
      return null;
      
    } catch (error) {
      this.log(`[FilesPipeline] Error checking for existing file: ${error}`);
      return null;
    }
  }

  // Process multiple files from a course
  async processFilesFromCourse(courseId: string): Promise<FileProcessResult[]> {
    this.log(`[FilesPipeline] Processing files from course ${courseId}`);
    
    try {
      // Get file URLs from assignments and modules (discovered in Phase 8/9)
      const fileUrls = await this.discoverFileUrls(courseId);
      
      if (fileUrls.length === 0) {
        this.log(`[FilesPipeline] No files found for course ${courseId}`);
        return [];
      }

      this.log(`[FilesPipeline] Found ${fileUrls.length} files to process`);
      
      const results: FileProcessResult[] = [];
      
      // Process files with concurrency control
      for (let i = 0; i < fileUrls.length; i += this.config.maxConcurrentDownloads) {
        const batch = fileUrls.slice(i, i + this.config.maxConcurrentDownloads);
        
        this.log(`[FilesPipeline] Processing batch ${Math.floor(i / this.config.maxConcurrentDownloads) + 1}: ${batch.length} files`);
        
        const batchPromises = batch.map(fileInfo => 
          this.processFile(fileInfo.url, courseId, fileInfo.sourceUrl)
        );
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              success: false,
              error: result.reason?.message || 'Unknown error',
              timing: { download: 0, processing: 0, total: 0 }
            });
          }
        });
        
        // Delay between batches to avoid overwhelming Canvas
        if (i + this.config.maxConcurrentDownloads < fileUrls.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      return results;

    } catch (error) {
      this.log(`[FilesPipeline] Error processing files from course: ${error}`);
      return [];
    }
  }

  // Discover file URLs from assignments and modules
  private async discoverFileUrls(courseId: string): Promise<Array<{url: string, sourceUrl: string, fileName?: string}>> {
    const fileUrls: Array<{url: string, sourceUrl: string, fileName?: string}> = [];
    
    try {
      // This would integrate with Phase 8/9 results to find files
      // For now, return empty array as we discovered files are mainly in assignments/modules
      this.log(`[FilesPipeline] File discovery from course ${courseId} - placeholder implementation`);
      
      // In a real implementation, this would:
      // 1. Get assignment details from Phase 9
      // 2. Extract file URLs from assignment attachments
      // 3. Get module items with file links
      // 4. Return all discovered file URLs
      
    } catch (error) {
      this.log(`[FilesPipeline] Error discovering files: ${error}`);
    }
    
    return fileUrls;
  }

  // Generate unique file ID
  private generateFileId(fileUrl: string): string {
    // Extract file ID from Canvas URL or generate from URL
    const idMatch = fileUrl.match(/\/files\/(\d+)/);
    if (idMatch) {
      return idMatch[1];
    }
    
    // Fallback to hash of URL
    return btoa(fileUrl).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  }

  // Check if file type is supported
  private isFileTypeSupported(fileType: string): boolean {
    return this.config.supportedTypes.includes(fileType.toLowerCase());
  }

  // Check if file is a PDF
  private isPdfFile(fileType: string): boolean {
    return fileType.toLowerCase() === 'pdf';
  }

  // Check if file is an image
  private isImageFile(fileType: string): boolean {
    return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(fileType.toLowerCase());
  }

  // Check if file is a text file
  private isTextFile(fileType: string): boolean {
    return ['txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts'].includes(fileType.toLowerCase());
  }

  // Get pipeline statistics
  getStats(): {
    activeDownloads: number;
    queuedDownloads: number;
    maxConcurrent: number;
    supportedTypes: string[];
    storageMode: string;
  } {
    return {
      activeDownloads: this.activeDownloads.size,
      queuedDownloads: this.downloadQueue.length,
      maxConcurrent: this.config.maxConcurrentDownloads,
      supportedTypes: this.config.supportedTypes,
      storageMode: this.config.storageMode
    };
  }

  // Cancel all active downloads
  async cancelAllDownloads(): Promise<void> {
    this.log(`[FilesPipeline] Cancelling ${this.activeDownloads.size} active downloads`);
    
    for (const controller of this.activeDownloads.values()) {
      controller.abort();
    }
    
    this.activeDownloads.clear();
    this.downloadQueue.length = 0;
  }

  // Test file pipeline functionality
  async testFilePipeline(): Promise<void> {
    this.log(`[FilesPipeline] Testing file pipeline functionality...`);
    
    try {
      // Test with a sample Canvas file URL (this would be discovered from Phase 8/9)
      const testFileUrl = 'https://canvas.instructure.com/courses/12671534/files/309228954/download';
      const result = await this.processFile(testFileUrl, '12671534', 'test-source');
      
      if (result.success) {
        this.log(`[FilesPipeline] ✅ Test successful: ${result.fileItem?.fileName}`);
        this.log(`[FilesPipeline] File size: ${result.fileItem?.fileSize} bytes`);
        this.log(`[FilesPipeline] Extracted text: ${result.fileItem?.extractedText?.length || 0} characters`);
        this.log(`[FilesPipeline] Processing time: ${result.timing.total}ms`);
      } else {
        this.log(`[FilesPipeline] ❌ Test failed: ${result.error}`);
      }
      
    } catch (error) {
      this.log(`[FilesPipeline] Test error: ${error}`);
    }
  }

  // Utility method for logging
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(message);
    }
  }
}

export const filesPipeline = new FilesPipeline();
