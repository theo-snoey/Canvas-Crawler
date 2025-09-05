// Storage Test for Canvas Scraper
// Simple test to verify storage functionality

import { storageManager } from './storageManager';
import { ContentUtils, StorageOptimizer } from './contentUtils';

export async function testStorageFunctionality(): Promise<void> {
  console.log('[StorageTest] Starting storage functionality test...');

  try {
    // Wait for storage to be ready
    while (!storageManager.isReady()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Test 1: Save and retrieve HTML snapshot
    console.log('[StorageTest] Test 1: HTML snapshot storage');
    const testHtml = '<html><body><h1>Test Content</h1><p>This is a test.</p></body></html>';
    const testUrl = 'https://test.instructure.com/courses/123';
    
    const optimizedHtml = await StorageOptimizer.optimizeHtmlForStorage(testHtml, testUrl);
    const htmlSnapshot = {
      id: optimizedHtml.id,
      url: testUrl,
      html: optimizedHtml.normalizedHtml,
      timestamp: Date.now(),
      hash: optimizedHtml.hash,
      size: optimizedHtml.size
    };

    await storageManager.saveHtmlSnapshot(htmlSnapshot);
    const retrievedSnapshot = await storageManager.getHtmlSnapshot(htmlSnapshot.id);
    
    if (retrievedSnapshot && retrievedSnapshot.hash === htmlSnapshot.hash) {
      console.log('[StorageTest] ✓ HTML snapshot storage test passed');
    } else {
      console.error('[StorageTest] ✗ HTML snapshot storage test failed');
    }

    // Test 2: Save and retrieve structured data
    console.log('[StorageTest] Test 2: Structured data storage');
    const testData = {
      courseId: '123',
      name: 'Test Course',
      assignments: [
        { id: '1', title: 'Assignment 1' },
        { id: '2', title: 'Assignment 2' }
      ]
    };

    const optimizedData = await StorageOptimizer.optimizeStructuredData(
      testData, '123', 'assignments', 'list'
    );
    
    const structuredData = {
      id: optimizedData.id,
      courseId: '123',
      collection: 'assignments',
      itemId: 'list',
      data: testData,
      timestamp: Date.now(),
      version: '1.0.0'
    };

    await storageManager.saveStructuredData(structuredData);
    const retrievedData = await storageManager.getStructuredData(structuredData.id);
    
    if (retrievedData && retrievedData.data.courseId === testData.courseId) {
      console.log('[StorageTest] ✓ Structured data storage test passed');
    } else {
      console.error('[StorageTest] ✗ Structured data storage test failed');
    }

    // Test 3: Content hashing and compression
    console.log('[StorageTest] Test 3: Content hashing and compression');
    const testContent = 'This is a test content that will be hashed and compressed.';
    const hash = await ContentUtils.hashContent(testContent);
    const compressed = await ContentUtils.compressText(testContent);
    const decompressed = await ContentUtils.decompressText(compressed);
    
    if (decompressed === testContent && hash.length === 64) {
      console.log('[StorageTest] ✓ Content hashing and compression test passed');
      console.log(`[StorageTest] Original size: ${ContentUtils.getContentSize(testContent)} bytes`);
      console.log(`[StorageTest] Compressed size: ${compressed.byteLength} bytes`);
      console.log(`[StorageTest] Compression ratio: ${(compressed.byteLength / ContentUtils.getContentSize(testContent)).toFixed(2)}`);
    } else {
      console.error('[StorageTest] ✗ Content hashing and compression test failed');
    }

    // Test 4: Storage stats
    console.log('[StorageTest] Test 4: Storage statistics');
    const stats = await storageManager.getStorageStats();
    console.log('[StorageTest] Storage stats:', stats);

    // Test 5: Student index operations
    console.log('[StorageTest] Test 5: Student index operations');
    await storageManager.updateStudentIndex({
      courses: ['123', '456'],
      lastCrawl: Date.now()
    });
    
    const studentIndex = await storageManager.getStudentIndex();
    if (studentIndex.courses.length === 2) {
      console.log('[StorageTest] ✓ Student index operations test passed');
    } else {
      console.error('[StorageTest] ✗ Student index operations test failed');
    }

    console.log('[StorageTest] All storage tests completed successfully!');

  } catch (error) {
    console.error('[StorageTest] Storage test failed:', error);
  }
}
