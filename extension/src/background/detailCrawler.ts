// Detail Crawler for Canvas Scraper - Phase 9
// Extracts full content details from individual Canvas items

import { ghostTabManager } from './ghostTabManager';
import { studentIndexManager } from './studentIndex';

export interface DetailItem {
  id: string;
  type: string;
  courseId: string;
  title: string;
  content?: string;
  htmlContent?: string;
  metadata?: Record<string, any>;
  attachments?: string[];
  links?: string[];
  extractedAt: number;
  updatedAt: number;
}

export interface DetailCrawlResult {
  success: boolean;
  item?: DetailItem;
  error?: string;
  timing: {
    start: number;
    end: number;
    duration: number;
  };
}

export interface DetailCrawlerConfig {
  enableLogging: boolean;
  defaultTimeout: number;
  maxRetries: number;
  useGhostTabs: boolean;
  extractFullHtml: boolean;
}

export class DetailCrawler {
  private config: DetailCrawlerConfig;

  constructor(config?: Partial<DetailCrawlerConfig>) {
    this.config = {
      enableLogging: true,
      defaultTimeout: 30000,
      maxRetries: 3,
      useGhostTabs: true,
      extractFullHtml: true,
      ...config
    };
  }

  // Main method to crawl details for a specific item
  async crawlItemDetail(itemUrl: string, itemType: string, courseId: string): Promise<DetailCrawlResult> {
    const startTime = Date.now();
    
    try {
      this.log(`[DetailCrawler] Starting detail crawl for ${itemType}: ${itemUrl}`);
      
      let item: DetailItem;
      
      if (this.config.useGhostTabs) {
        item = await this.crawlWithGhostTab(itemUrl, itemType, courseId);
      } else {
        item = await this.crawlWithFetch(itemUrl, itemType, courseId);
      }
      
      const endTime = Date.now();
      const result: DetailCrawlResult = {
        success: true,
        item,
        timing: {
          start: startTime,
          end: endTime,
          duration: endTime - startTime
        }
      };

      this.log(`[DetailCrawler] Completed ${itemType} detail crawl: ${item.title}`);
      return result;

    } catch (error) {
      const endTime = Date.now();
      const result: DetailCrawlResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timing: {
          start: startTime,
          end: endTime,
          duration: endTime - startTime
        }
      };

      this.log(`[DetailCrawler] Error crawling ${itemType} detail: ${result.error}`);
      return result;
    }
  }

  // Crawl using ghost tab (for JavaScript-heavy content)
  private async crawlWithGhostTab(itemUrl: string, itemType: string, courseId: string): Promise<DetailItem> {
    const requestId = `detail_${itemType}_${Date.now()}`;
    
    const ghostTabRequest = {
      id: requestId,
      url: itemUrl,
      timeout: this.config.defaultTimeout,
      waitFor: {
        selector: 'body',
        timeout: 10000
      },
      actions: [
        { type: 'wait' as const, value: 3000 },
        { type: 'scroll' as const, value: 0 }
      ],
      extractors: this.getExtractorsForType(itemType)
    };

    try {
      const response = await ghostTabManager.createGhostTab(ghostTabRequest);
      
      if (!response.success) {
        throw new Error(`Ghost tab failed: ${response.error}`);
      }

      return this.parseItemDetails(response.html || '', response.extractedData || {}, itemUrl, itemType, courseId);

    } catch (error) {
      this.log(`[DetailCrawler] Ghost tab crawl failed for ${itemType}: ${error}`);
      throw error;
    }
  }

  // Crawl using fetch (for simple content)
  private async crawlWithFetch(itemUrl: string, itemType: string, courseId: string): Promise<DetailItem> {
    try {
      const response = await fetch(itemUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return this.parseItemDetails(html, {}, itemUrl, itemType, courseId);

    } catch (error) {
      this.log(`[DetailCrawler] Fetch crawl failed for ${itemType}: ${error}`);
      throw error;
    }
  }

  // Get extractors for a specific item type
  private getExtractorsForType(itemType: string) {
    const extractors: Array<{ name: string; selector: string; attribute?: string; multiple?: boolean }> = [];

    switch (itemType) {
      case 'announcement':
        extractors.push(
          { name: 'title', selector: 'h1, .discussion_topic .summary, .discussion-title' },
          { name: 'content', selector: '.discussion_topic .message, .user_content' },
          { name: 'author', selector: '.author, .discussion_topic .author' },
          { name: 'date', selector: '.discussion_topic .date, .published-date' },
          { name: 'attachments', selector: 'a[href*="/files/"], .attachment', attribute: 'href', multiple: true }
        );
        break;
      
      case 'assignment':
        extractors.push(
          { name: 'title', selector: 'h1, .assignment-title, .title, [data-testid="assignment-name"], .assignment_name' },
          { name: 'description', selector: '.description, .user_content, .assignment_description, .show-content, [data-testid="assignment-description"]' },
          { name: 'dueDate', selector: '.due_date_display, .due-date, .datetime_field, [data-testid="due-date"]' },
          { name: 'points', selector: '.points_possible, .points, [data-testid="points-possible"], .assignment-points' },
          { name: 'instructions', selector: '.instructions, .assignment_instructions, .directions' },
          { name: 'attachments', selector: 'a[href*="/files/"], .attachment, .instructure_file_link', attribute: 'href', multiple: true },
          { name: 'submissionTypes', selector: '.submission_types, .submission-types, [data-testid="submission-type"]' },
          { name: 'allText', selector: 'h1, h2, h3, .content, .description, div, p, span', multiple: true }
        );
        break;
      
      case 'discussion':
        extractors.push(
          { name: 'title', selector: 'h1, .discussion-title, .discussion_topic_title' },
          { name: 'content', selector: '.discussion_topic .message, .user_content' },
          { name: 'author', selector: '.author' },
          { name: 'replies', selector: '.discussion_entry, .discussion-entry', multiple: true },
          { name: 'replyCount', selector: '.replies_count, .reply-count' },
          { name: 'attachments', selector: 'a[href*="/files/"], .attachment', attribute: 'href', multiple: true }
        );
        break;
      
      case 'page':
        extractors.push(
          { name: 'title', selector: 'h1, .page-title, .wiki-page-title' },
          { name: 'content', selector: '.wiki-page-body, .user_content, .page-content' },
          { name: 'lastModified', selector: '.last-modified, .updated-at' },
          { name: 'author', selector: '.author, .edited-by' }
        );
        break;
      
      case 'quiz':
        extractors.push(
          { name: 'title', selector: 'h1, .quiz-title, .quiz_title, [data-testid="quiz-title"], .assignment_name' },
          { name: 'description', selector: '.description, .user_content, .quiz_description, .show-content, .quiz-instructions' },
          { name: 'instructions', selector: '.instructions, .quiz_instructions, .quiz-description' },
          { name: 'timeLimit', selector: '.time_limit, .time-limit, .quiz-time-limit' },
          { name: 'attempts', selector: '.allowed_attempts, .attempts, .quiz-attempts' },
          { name: 'questions', selector: '.question, .quiz_question, .quiz-item', multiple: true },
          { name: 'dueDate', selector: '.due_date, .due-date, .datetime_field' },
          { name: 'allText', selector: 'h1, h2, h3, .content, .description, div, p, span', multiple: true }
        );
        break;
      
      case 'file':
        extractors.push(
          { name: 'fileName', selector: '.file-name, .filename, h1' },
          { name: 'fileSize', selector: '.file-size, .size' },
          { name: 'fileType', selector: '.file-type, .content-type' },
          { name: 'downloadLink', selector: 'a[href*="download"]', attribute: 'href' },
          { name: 'previewLink', selector: 'a[href*="preview"]', attribute: 'href' }
        );
        break;
      
      case 'module':
        extractors.push(
          { name: 'title', selector: 'h1, .module-title, .context_module_title' },
          { name: 'items', selector: '.context_module_item, .module-item', multiple: true },
          { name: 'itemLinks', selector: '.context_module_item a, .module-item a', attribute: 'href', multiple: true },
          { name: 'itemTitles', selector: '.context_module_item .title, .module-item .title', multiple: true }
        );
        break;
      
      case 'person':
        extractors.push(
          { name: 'name', selector: '.user_name, .student_name, h1' },
          { name: 'email', selector: '.email, .user_email' },
          { name: 'role', selector: '.role, .enrollment_role' },
          { name: 'avatar', selector: '.avatar, .user_avatar', attribute: 'src' }
        );
        break;
    }

    return extractors;
  }

  // Parse item details from HTML and extracted data
  private parseItemDetails(html: string, extractedData: Record<string, any>, itemUrl: string, itemType: string, courseId: string): DetailItem {
    const itemId = this.extractItemId(itemUrl, itemType);
    const now = Date.now();

    // Get title from extracted data or parse from HTML
    let title = extractedData.title || this.extractTitleFromHtml(html, itemType);
    if (!title) {
      title = `${itemType} ${itemId}`;
    }

    // Build the detail item
    const item: DetailItem = {
      id: itemId,
      type: itemType,
      courseId,
      title: this.cleanText(title),
      extractedAt: now,
      updatedAt: now,
      metadata: {}
    };

    // Add content if available (try multiple sources)
    let content = extractedData.content || extractedData.description || extractedData.instructions;
    
    // If no content found, try to extract from allText
    if (!content && extractedData.allText && Array.isArray(extractedData.allText)) {
      // Find the longest meaningful text element
      const meaningfulText = extractedData.allText
        .filter((text: string) => text && text.length > 20)
        .filter((text: string) => !text.match(/^(Published|Unpublished|Edit|Manage|Start|Click|Show|Hide)/i))
        .sort((a: string, b: string) => b.length - a.length)[0];
      
      if (meaningfulText) {
        content = meaningfulText;
      }
    }
    
    if (content) {
      item.content = this.cleanText(content);
    }

    // Add HTML content if requested
    if (this.config.extractFullHtml) {
      item.htmlContent = html;
    }

    // Add type-specific metadata
    switch (itemType) {
      case 'assignment':
        item.metadata = {
          dueDate: extractedData.dueDate,
          points: extractedData.points,
          submissionTypes: extractedData.submissionTypes,
          instructions: this.cleanText(extractedData.instructions)
        };
        break;
      
      case 'discussion':
        item.metadata = {
          author: extractedData.author,
          replyCount: extractedData.replyCount,
          replies: extractedData.replies?.length || 0
        };
        break;
      
      case 'quiz':
        item.metadata = {
          timeLimit: extractedData.timeLimit,
          attempts: extractedData.attempts,
          dueDate: extractedData.dueDate,
          questionCount: extractedData.questions?.length || 0,
          instructions: this.cleanText(extractedData.instructions)
        };
        break;
      
      case 'file':
        item.metadata = {
          fileName: extractedData.fileName,
          fileSize: extractedData.fileSize,
          fileType: extractedData.fileType,
          downloadLink: extractedData.downloadLink,
          previewLink: extractedData.previewLink
        };
        break;
      
      case 'module':
        item.metadata = {
          itemCount: extractedData.items?.length || 0,
          itemLinks: extractedData.itemLinks || [],
          itemTitles: extractedData.itemTitles || []
        };
        break;
      
      case 'person':
        item.metadata = {
          email: extractedData.email,
          role: extractedData.role,
          avatar: extractedData.avatar
        };
        break;
    }

    // Extract attachments
    if (extractedData.attachments) {
      item.attachments = Array.isArray(extractedData.attachments) 
        ? extractedData.attachments 
        : [extractedData.attachments];
    }

    return item;
  }

  // Extract item ID from URL
  private extractItemId(url: string, itemType: string): string {
    const patterns = {
      assignment: /\/assignments\/(\d+)/,
      discussion: /\/discussion_topics\/(\d+)/,
      announcement: /\/announcements\/(\d+)/,
      page: /\/wiki\/([^/?]+)/,
      quiz: /\/quizzes\/(\d+)/,
      file: /\/files\/(\d+)/,
      module: /\/modules\/(\d+)/,
      person: /\/users\/(\d+)/
    };

    const pattern = patterns[itemType as keyof typeof patterns];
    if (pattern) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Fallback to URL-based ID
    return url.split('/').pop() || 'unknown';
  }

  // Extract title from HTML using regex (for service worker compatibility)
  private extractTitleFromHtml(html: string, itemType: string): string | null {
    // Try multiple title extraction strategies
    const titlePatterns = [
      // Canvas-specific patterns
      /data-testid="assignment-name"[^>]*>([^<]+)</i,
      /class="[^"]*assignment[^"]*name[^"]*"[^>]*>([^<]+)</i,
      /class="[^"]*quiz[^"]*title[^"]*"[^>]*>([^<]+)</i,
      // Standard HTML patterns
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>([^<]+)<\/title>/i,
      /<h2[^>]*>([^<]+)<\/h2>/i,
      /<h3[^>]*>([^<]+)<\/h3>/i,
      // Fallback patterns
      /class="[^"]*title[^"]*"[^>]*>([^<]+)</i,
      /class="[^"]*name[^"]*"[^>]*>([^<]+)</i
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let title = match[1].trim();
        
        // Clean up Canvas-specific title patterns
        title = title.replace(/^(Assignments?|Discussions?|Announcements?|Pages?|Quizzes?):\s*/i, '');
        title = title.replace(/\s*-\s*[^-]*$/, ''); // Remove course name suffix
        title = title.replace(/\s*(Published|Unpublished|Start Assignment|Edit|Manage|SpeedGrader|Send To|Copy To|Share to Commons).*$/i, ''); // Remove Canvas UI text
        
        if (title.length > 3 && !title.match(/^(sdfsd|undefined|null)$/i)) {
          return title;
        }
      }
    }

    return null;
  }

  // Clean text content
  private cleanText(text: string | undefined): string {
    if (!text) return '';
    
    return text
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/^\s+|\s+$/g, '')      // Trim
      .replace(/&nbsp;/g, ' ')        // Convert HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }

  // Crawl details for multiple items
  async crawlMultipleItems(items: Array<{url: string, type: string, courseId: string}>): Promise<DetailCrawlResult[]> {
    const results: DetailCrawlResult[] = [];
    
    for (const item of items) {
      try {
        this.log(`[DetailCrawler] Processing ${item.type} ${results.length + 1}/${items.length}...`);
        
        const result = await this.crawlItemDetail(item.url, item.type, item.courseId);
        results.push(result);
        
        // Longer delay to avoid concurrent tab limits and Canvas rate limiting
        this.log(`[DetailCrawler] Waiting 5 seconds before next item...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        this.log(`[DetailCrawler] Failed to crawl ${item.type}: ${error}`);
        results.push({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timing: { start: Date.now(), end: Date.now(), duration: 0 }
        });
      }
    }

    return results;
  }

  // Crawl all details for a specific course
  async crawlCourseDetails(courseId: string): Promise<DetailCrawlResult[]> {
    this.log(`[DetailCrawler] Starting detail crawl for course ${courseId}`);
    
    try {
      // Get course information
      const studentIndex = await studentIndexManager.loadStudentIndex();
      const course = studentIndex.courses[courseId];
      
      if (!course) {
        throw new Error(`Course ${courseId} not found`);
      }

      // Get section items (this would come from Phase 8 results)
      // For now, we'll use the known items from our tests
      const testItems = await this.getTestItemsForCourse(course);
      
      return await this.crawlMultipleItems(testItems);
      
    } catch (error) {
      this.log(`[DetailCrawler] Error crawling course details: ${error}`);
      return [];
    }
  }

  // Get test items for a course (based on our Phase 8 discoveries)
  private async getTestItemsForCourse(course: any): Promise<Array<{url: string, type: string, courseId: string}>> {
    const items: Array<{url: string, type: string, courseId: string}> = [];
    
    if (course.code === 'Agro 101') {
      // Based on our Phase 8 discoveries
      items.push(
        { url: `${course.url}/assignments/57852760`, type: 'assignment', courseId: course.id },
        { url: `${course.url}/assignments/57980836`, type: 'assignment', courseId: course.id },
        { url: `${course.url}/discussion_topics/26492809`, type: 'discussion', courseId: course.id },
        { url: `${course.url}/quizzes/23030182`, type: 'quiz', courseId: course.id }
      );
    } else if (course.code === 'GTFM112') {
      items.push(
        { url: `${course.url}/assignments/57980132`, type: 'assignment', courseId: course.id },
        { url: `${course.url}/assignments/57980175`, type: 'assignment', courseId: course.id },
        { url: `${course.url}/assignments/57980200`, type: 'assignment', courseId: course.id },
        { url: `${course.url}/discussion_topics/26492629`, type: 'discussion', courseId: course.id },
        { url: `${course.url}/quizzes/23085267`, type: 'quiz', courseId: course.id }
      );
    }

    return items;
  }

  // Utility method for logging
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(message);
    }
  }
}

export const detailCrawler = new DetailCrawler();
