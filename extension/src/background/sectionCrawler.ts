// Section Crawler for Canvas Scraper - Phase 8
// Crawls different sections of Canvas courses (announcements, assignments, discussions, etc.)

import { ghostTabManager } from './ghostTabManager';
import { studentIndexManager } from './studentIndex';

export interface SectionItem {
  id: string;
  title: string;
  url: string;
  type: string;
  courseId: string;
  section: string;
  metadata?: Record<string, any>;
  discoveredAt: number;
  updatedAt: number;
}

export interface SectionCrawlResult {
  section: string;
  courseId: string;
  items: SectionItem[];
  success: boolean;
  error?: string;
  timing: {
    start: number;
    end: number;
    duration: number;
  };
}

export interface SectionCrawlerConfig {
  enableLogging: boolean;
  defaultTimeout: number;
  maxRetries: number;
  useGhostTabs: boolean;
}

export class SectionCrawler {
  private config: SectionCrawlerConfig;

  constructor(config?: Partial<SectionCrawlerConfig>) {
    this.config = {
      enableLogging: true,
      defaultTimeout: 30000,
      maxRetries: 3,
      useGhostTabs: false,
      ...config
    };
  }

  // Main method to crawl a specific section for a course
  async crawlSection(courseId: string, section: string): Promise<SectionCrawlResult> {
    const startTime = Date.now();
    
    try {
      this.log(`[SectionCrawler] Starting crawl for ${section} in course ${courseId}`);
      
      const course = await this.getCourse(courseId);
      if (!course) {
        throw new Error(`Course ${courseId} not found`);
      }

      const sectionUrl = this.buildSectionUrl(course.url, section);
      const items = await this.crawlSectionContent(sectionUrl, section, courseId);
      
      const endTime = Date.now();
      const result: SectionCrawlResult = {
        section,
        courseId,
        items,
        success: true,
        timing: {
          start: startTime,
          end: endTime,
          duration: endTime - startTime
        }
      };

      this.log(`[SectionCrawler] Completed ${section} crawl for course ${courseId}: ${items.length} items`);
      return result;

    } catch (error) {
      const endTime = Date.now();
      const result: SectionCrawlResult = {
        section,
        courseId,
        items: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timing: {
          start: startTime,
          end: endTime,
          duration: endTime - startTime
        }
      };

      this.log(`[SectionCrawler] Error crawling ${section} for course ${courseId}: ${result.error}`);
      return result;
    }
  }

  // Crawl all sections for a course
  async crawlAllSections(courseId: string): Promise<SectionCrawlResult[]> {
    const sections = [
      'announcements',
      'assignments', 
      'discussions',
      'pages',
      'files',
      'quizzes',
      'modules',
      'grades',
      'people',
      'syllabus'
    ];

    const results: SectionCrawlResult[] = [];
    
    for (const section of sections) {
      try {
        const result = await this.crawlSection(courseId, section);
        results.push(result);
      } catch (error) {
        this.log(`[SectionCrawler] Failed to crawl ${section} for course ${courseId}: ${error}`);
        results.push({
          section,
          courseId,
          items: [],
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timing: { start: Date.now(), end: Date.now(), duration: 0 }
        });
      }
    }

    return results;
  }

  // Get course information from student index
  private async getCourse(courseId: string) {
    const studentIndex = await studentIndexManager.loadStudentIndex();
    return studentIndex.courses[courseId];
  }

  // Build URL for a specific section
  private buildSectionUrl(courseUrl: string, section: string): string {
    const baseUrl = courseUrl.replace(/\/$/, '');
    
    const sectionPaths: Record<string, string> = {
      announcements: '/announcements',
      assignments: '/assignments',
      discussions: '/discussion_topics',
      pages: '/wiki',
      files: '/files',
      quizzes: '/quizzes',
      modules: '/modules',
      grades: '/grades',
      people: '/users',
      syllabus: '/syllabus'
    };

    const path = sectionPaths[section];
    if (!path) {
      throw new Error(`Unknown section: ${section}`);
    }

    return `${baseUrl}${path}`;
  }

  // Crawl the actual content of a section
  private async crawlSectionContent(url: string, section: string, courseId: string): Promise<SectionItem[]> {
    if (this.config.useGhostTabs) {
      return this.crawlWithGhostTab(url, section, courseId);
    } else {
      return this.crawlWithFetch(url, section, courseId);
    }
  }

  // Crawl using ghost tab (for JavaScript-heavy content)
  private async crawlWithGhostTab(url: string, section: string, courseId: string): Promise<SectionItem[]> {
    this.log(`[SectionCrawler] Ghost tab method called for ${section} - this should not be reached when useGhostTabs=false`);
    
    const requestId = `section_${section}_${courseId}_${Date.now()}`;
    
    const ghostTabRequest = {
      id: requestId,
      url: url,
      timeout: this.config.defaultTimeout,
      waitFor: {
        selector: 'body',
        timeout: 10000
      },
      actions: [
        { type: 'wait' as const, value: 2000 },
        { type: 'scroll' as const, value: 0 }
      ],
      extractors: this.getExtractorsForSection(section)
    };

    try {
      this.log(`[SectionCrawler] About to call ghostTabManager.createGhostTab for ${section}`);
      
      // Use the imported ghostTabManager directly (not this.ghostTabManager)
      const response = await ghostTabManager.createGhostTab(ghostTabRequest);
      
      if (!response.success) {
        throw new Error(`Ghost tab failed: ${response.error}`);
      }

      return this.parseSectionItems(response.html || '', section, courseId, url);

    } catch (error) {
      this.log(`[SectionCrawler] Ghost tab crawl failed for ${section}: ${error}`);
      throw error;
    }
  }

  // Crawl using fetch (for simple content)
  private async crawlWithFetch(url: string, section: string, courseId: string): Promise<SectionItem[]> {
    try {
      this.log(`[SectionCrawler] Using fetch method for ${section} at ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      this.log(`[SectionCrawler] Fetched ${html.length} bytes for ${section}`);
      
      const items = this.parseSectionItems(html, section, courseId, url);
      this.log(`[SectionCrawler] Parsed ${items.length} items for ${section}`);
      
      return items;

    } catch (error) {
      this.log(`[SectionCrawler] Fetch crawl failed for ${section}: ${error}`);
      throw error;
    }
  }

  // Get extractors for a specific section
  private getExtractorsForSection(section: string) {
    const extractors: Array<{ name: string; selector: string; attribute?: string; multiple?: boolean }> = [];

    switch (section) {
      case 'announcements':
        extractors.push(
          { name: 'announcementLinks', selector: 'a[href*="/announcements/"]', attribute: 'href', multiple: true },
          { name: 'announcementTitles', selector: '.announcement-title, .discussion-title', multiple: true }
        );
        break;
      
      case 'assignments':
        extractors.push(
          { name: 'assignmentLinks', selector: 'a[href*="/assignments/"]', attribute: 'href', multiple: true },
          { name: 'assignmentTitles', selector: '.assignment-title, .assignment_name', multiple: true }
        );
        break;
      
      case 'discussions':
        extractors.push(
          { name: 'discussionLinks', selector: 'a[href*="/discussions/"]', attribute: 'href', multiple: true },
          { name: 'discussionTitles', selector: '.discussion-title, .discussion_name', multiple: true }
        );
        break;
      
      case 'pages':
        extractors.push(
          { name: 'pageLinks', selector: 'a[href*="/pages/"]', attribute: 'href', multiple: true },
          { name: 'pageTitles', selector: '.page-title, .wiki-page-link', multiple: true }
        );
        break;
      
      case 'files':
        extractors.push(
          { name: 'fileLinks', selector: 'a[href*="/files/"]', attribute: 'href', multiple: true },
          { name: 'fileNames', selector: '.ef-name-col, .filename', multiple: true }
        );
        break;
      
      case 'quizzes':
        extractors.push(
          { name: 'quizLinks', selector: 'a[href*="/quizzes/"]', attribute: 'href', multiple: true },
          { name: 'quizTitles', selector: '.quiz-title, .quiz_name', multiple: true }
        );
        break;
      
      case 'modules':
        extractors.push(
          { name: 'moduleLinks', selector: 'a[href*="/modules/"]', attribute: 'href', multiple: true },
          { name: 'moduleTitles', selector: '.module-title, .module_name', multiple: true }
        );
        break;
      
      case 'grades':
        extractors.push(
          { name: 'gradeLinks', selector: 'a[href*="/grades/"]', attribute: 'href', multiple: true },
          { name: 'gradeTitles', selector: '.grade-title, .assignment_name', multiple: true }
        );
        break;
      
      case 'people':
        extractors.push(
          { name: 'peopleLinks', selector: 'a[href*="/users/"]', attribute: 'href', multiple: true },
          { name: 'peopleNames', selector: '.user_name, .student_name', multiple: true }
        );
        break;
      
      case 'syllabus':
        extractors.push(
          { name: 'syllabusContent', selector: '.syllabus, .wiki-page-body', multiple: false }
        );
        break;
    }

    return extractors;
  }

  // Parse section items from HTML
  private parseSectionItems(html: string, section: string, courseId: string, baseUrl: string): SectionItem[] {
    const items: SectionItem[] = [];
    const now = Date.now();

    try {
      // Create a DOM parser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract items based on section type
      switch (section) {
        case 'announcements':
          items.push(...this.parseAnnouncements(doc, courseId, baseUrl, now));
          break;
        case 'assignments':
          items.push(...this.parseAssignments(doc, courseId, baseUrl, now));
          break;
        case 'discussions':
          items.push(...this.parseDiscussions(doc, courseId, baseUrl, now));
          break;
        case 'pages':
          items.push(...this.parsePages(doc, courseId, baseUrl, now));
          break;
        case 'files':
          items.push(...this.parseFiles(doc, courseId, baseUrl, now));
          break;
        case 'quizzes':
          items.push(...this.parseQuizzes(doc, courseId, baseUrl, now));
          break;
        case 'modules':
          items.push(...this.parseModules(doc, courseId, baseUrl, now));
          break;
        case 'grades':
          items.push(...this.parseGrades(doc, courseId, baseUrl, now));
          break;
        case 'people':
          items.push(...this.parsePeople(doc, courseId, baseUrl, now));
          break;
        case 'syllabus':
          items.push(...this.parseSyllabus(doc, courseId, baseUrl, now));
          break;
      }

    } catch (error) {
      this.log(`[SectionCrawler] Error parsing ${section} HTML: ${error}`);
    }

    return items;
  }

  // Parse announcements
  private parseAnnouncements(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/announcements/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Announcement ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `announcement_${index}`,
          title,
          url,
          type: 'announcement',
          courseId,
          section: 'announcements',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse assignments
  private parseAssignments(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/assignments/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Assignment ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `assignment_${index}`,
          title,
          url,
          type: 'assignment',
          courseId,
          section: 'assignments',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse discussions
  private parseDiscussions(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/discussions/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Discussion ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `discussion_${index}`,
          title,
          url,
          type: 'discussion',
          courseId,
          section: 'discussions',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse pages
  private parsePages(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/pages/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Page ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `page_${index}`,
          title,
          url,
          type: 'page',
          courseId,
          section: 'pages',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse files
  private parseFiles(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/files/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `File ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `file_${index}`,
          title,
          url,
          type: 'file',
          courseId,
          section: 'files',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse quizzes
  private parseQuizzes(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/quizzes/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Quiz ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `quiz_${index}`,
          title,
          url,
          type: 'quiz',
          courseId,
          section: 'quizzes',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse modules
  private parseModules(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/modules/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Module ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `module_${index}`,
          title,
          url,
          type: 'module',
          courseId,
          section: 'modules',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse grades
  private parseGrades(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/grades/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Grade ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `grade_${index}`,
          title,
          url,
          type: 'grade',
          courseId,
          section: 'grades',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse people
  private parsePeople(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    const links = doc.querySelectorAll('a[href*="/users/"]');
    
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || `Person ${index + 1}`;
      
      if (href) {
        const url = href.startsWith('http') ? href : `https://canvas.instructure.com${href}`;
        items.push({
          id: `person_${index}`,
          title,
          url,
          type: 'person',
          courseId,
          section: 'people',
          discoveredAt: timestamp,
          updatedAt: timestamp
        });
      }
    });

    return items;
  }

  // Parse syllabus
  private parseSyllabus(doc: Document, courseId: string, baseUrl: string, timestamp: number): SectionItem[] {
    const items: SectionItem[] = [];
    
    // Syllabus is typically a single page
    items.push({
      id: 'syllabus_0',
      title: 'Course Syllabus',
      url: baseUrl,
      type: 'syllabus',
      courseId,
      section: 'syllabus',
      discoveredAt: timestamp,
      updatedAt: timestamp
    });

    return items;
  }

  // Utility method for logging
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(message);
    }
  }
}

export const sectionCrawler = new SectionCrawler();
