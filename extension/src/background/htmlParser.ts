// HTML Parser for Canvas Scraper
// Handles HTML parsing, sanitization, and content extraction

export interface ParsedContent {
  title: string;
  text: string;
  links: Array<{ href: string; text: string; title?: string }>;
  images: Array<{ src: string; alt: string; title?: string }>;
  forms: Array<{ action: string; method: string; inputs: Array<{ name: string; type: string; value?: string }> }>;
  metadata: Record<string, string>;
  structure: {
    headings: Array<{ level: number; text: string; id?: string }>;
    lists: Array<{ type: 'ul' | 'ol'; items: string[] }>;
    tables: Array<{ headers: string[]; rows: string[][] }>;
  };
}

export interface ParseOptions {
  removeScripts?: boolean;
  removeStyles?: boolean;
  removeComments?: boolean;
  normalizeWhitespace?: boolean;
  extractLinks?: boolean;
  extractImages?: boolean;
  extractForms?: boolean;
  extractMetadata?: boolean;
}

export class HtmlParser {
  private defaultOptions: ParseOptions = {
    removeScripts: true,
    removeStyles: true,
    removeComments: true,
    normalizeWhitespace: true,
    extractLinks: true,
    extractImages: true,
    extractForms: true,
    extractMetadata: true
  };

  // Main parsing method
  parseHtml(html: string, options: ParseOptions = {}): ParsedContent {
    const opts = { ...this.defaultOptions, ...options };
    
    // Sanitize HTML
    const sanitizedHtml = this.sanitizeHtml(html, opts);
    
    // Check if DOMParser is available (not in service worker)
    if (typeof DOMParser !== 'undefined') {
      // Parse with DOMParser (content script/popup context)
      const parser = new DOMParser();
      const doc = parser.parseFromString(sanitizedHtml, 'text/html');
      return this.extractContentFromDOM(doc, opts);
    } else {
      // Fallback to regex-based parsing (service worker context)
      return this.extractContentFromString(sanitizedHtml, opts);
    }
  }

  // DOM-based content extraction (for content scripts/popup)
  private extractContentFromDOM(doc: Document, opts: ParseOptions): ParsedContent {
    
    // Extract content
    const content: ParsedContent = {
      title: this.extractTitleFromDOM(doc),
      text: this.extractTextFromDOM(doc, opts),
      links: opts.extractLinks ? this.extractLinksFromDOM(doc) : [],
      images: opts.extractImages ? this.extractImagesFromDOM(doc) : [],
      forms: opts.extractForms ? this.extractFormsFromDOM(doc) : [],
      metadata: opts.extractMetadata ? this.extractMetadataFromDOM(doc) : {},
      structure: {
        headings: this.extractHeadingsFromDOM(doc),
        lists: this.extractListsFromDOM(doc),
        tables: this.extractTablesFromDOM(doc)
      }
    };
    
    return content;
  }

  // String-based content extraction (for service worker context)
  private extractContentFromString(html: string, opts: ParseOptions): ParsedContent {
    const content: ParsedContent = {
      title: this.extractTitleFromString(html),
      text: this.extractTextFromString(html, opts),
      links: opts.extractLinks ? this.extractLinksFromString(html) : [],
      images: opts.extractImages ? this.extractImagesFromString(html) : [],
      forms: opts.extractForms ? this.extractFormsFromString(html) : [],
      metadata: opts.extractMetadata ? this.extractMetadataFromString(html) : {},
      structure: {
        headings: this.extractHeadingsFromString(html),
        lists: this.extractListsFromString(html),
        tables: this.extractTablesFromString(html)
      }
    };
    
    return content;
  }

  // Sanitize HTML by removing unwanted elements
  private sanitizeHtml(html: string, options: ParseOptions): string {
    let sanitized = html;
    
    if (options.removeScripts) {
      sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    
    if (options.removeStyles) {
      sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      sanitized = sanitized.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
    }
    
    if (options.removeComments) {
      sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');
    }
    
    if (options.normalizeWhitespace) {
      sanitized = sanitized.replace(/\s+/g, ' ').trim();
    }
    
    return sanitized;
  }

  // Extract page title from DOM
  private extractTitleFromDOM(doc: Document): string {
    const titleElement = doc.querySelector('title');
    return titleElement ? titleElement.textContent?.trim() || '' : '';
  }

  // Extract page title from string
  private extractTitleFromString(html: string): string {
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    return titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
  }

  // Extract main text content from DOM
  private extractTextFromDOM(doc: Document, options: ParseOptions): string {
    // Remove unwanted elements for text extraction
    const clone = doc.cloneNode(true) as Document;
    
    if (options.removeScripts) {
      clone.querySelectorAll('script').forEach(el => el.remove());
    }
    
    if (options.removeStyles) {
      clone.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());
    }
    
    // Get text content from main content areas
    const contentSelectors = [
      'main',
      'article',
      '.content',
      '.main-content',
      '#content',
      '#main',
      '.canvas-content',
      '.course-content'
    ];
    
    let content = '';
    for (const selector of contentSelectors) {
      const element = clone.querySelector(selector);
      if (element) {
        content = element.textContent || '';
        break;
      }
    }
    
    // Fallback to body if no main content found
    if (!content) {
      content = clone.body?.textContent || '';
    }
    
    // Normalize whitespace
    if (options.normalizeWhitespace) {
      content = content.replace(/\s+/g, ' ').trim();
    }
    
    return content;
  }

  // Extract main text content from string
  private extractTextFromString(html: string, options: ParseOptions): string {
    let text = html;
    
    // Remove unwanted elements
    if (options.removeScripts) {
      text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    if (options.removeStyles) {
      text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    }
    
    // Extract text from main content areas
    const contentPatterns = [
      /<main[^>]*>(.*?)<\/main>/is,
      /<article[^>]*>(.*?)<\/article>/is,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
      /<body[^>]*>(.*?)<\/body>/is
    ];
    
    let content = '';
    for (const pattern of contentPatterns) {
      const match = text.match(pattern);
      if (match) {
        content = match[1];
        break;
      }
    }
    
    if (!content) content = text;
    
    // Remove HTML tags and normalize whitespace
    content = content.replace(/<[^>]*>/g, ' ');
    if (options.normalizeWhitespace) {
      content = content.replace(/\s+/g, ' ').trim();
    }
    
    return content;
  }

  // Extract all links from DOM
  private extractLinksFromDOM(doc: Document): Array<{ href: string; text: string; title?: string }> {
    const links: Array<{ href: string; text: string; title?: string }> = [];
    
    doc.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      const text = link.textContent?.trim() || '';
      const title = link.getAttribute('title') || undefined;
      
      if (href && text) {
        links.push({ href, text, title });
      }
    });
    
    return links;
  }

  // Extract all links from string
  private extractLinksFromString(html: string): Array<{ href: string; text: string; title?: string }> {
    const links: Array<{ href: string; text: string; title?: string }> = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = match[2].replace(/<[^>]*>/g, '').trim();
      if (href && text) {
        links.push({ href, text });
      }
    }
    
    return links;
  }

  // Stub methods for string-based extraction (simplified for service worker)
  private extractImagesFromString(html: string): Array<{ src: string; alt: string; title?: string }> {
    const images: Array<{ src: string; alt: string; title?: string }> = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gis;
    let match;
    
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      const alt = match[2] || '';
      if (src) {
        images.push({ src, alt });
      }
    }
    
    return images;
  }

  private extractFormsFromString(html: string): Array<{ action: string; method: string; inputs: Array<{ name: string; type: string; value?: string }> }> {
    return []; // Simplified for service worker
  }

  private extractMetadataFromString(html: string): Record<string, string> {
    const metadata: Record<string, string> = {};
    const metaRegex = /<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gis;
    let match;
    
    while ((match = metaRegex.exec(html)) !== null) {
      const name = match[1];
      const content = match[2];
      if (name && content) {
        metadata[name] = content;
      }
    }
    
    return metadata;
  }

  private extractHeadingsFromString(html: string): Array<{ level: number; text: string; id?: string }> {
    const headings: Array<{ level: number; text: string; id?: string }> = [];
    const headingRegex = /<h([1-6])[^>]*(?:id=["']([^"']*)["'])?[^>]*>(.*?)<\/h[1-6]>/gis;
    let match;
    
    while ((match = headingRegex.exec(html)) !== null) {
      const level = parseInt(match[1]);
      const id = match[2] || undefined;
      const text = match[3].replace(/<[^>]*>/g, '').trim();
      if (text) {
        headings.push({ level, text, id });
      }
    }
    
    return headings;
  }

  private extractListsFromString(html: string): Array<{ type: 'ul' | 'ol'; items: string[] }> {
    return []; // Simplified for service worker
  }

  private extractTablesFromString(html: string): Array<{ headers: string[]; rows: string[][] }> {
    return []; // Simplified for service worker
  }

  // Extract all images from DOM
  private extractImagesFromDOM(doc: Document): Array<{ src: string; alt: string; title?: string }> {
    const images: Array<{ src: string; alt: string; title?: string }> = [];
    
    doc.querySelectorAll('img[src]').forEach(img => {
      const src = img.getAttribute('src');
      const alt = img.getAttribute('alt') || '';
      const title = img.getAttribute('title') || undefined;
      
      if (src) {
        images.push({ src, alt, title });
      }
    });
    
    return images;
  }

  // Extract forms from DOM
  private extractFormsFromDOM(doc: Document): Array<{ action: string; method: string; inputs: Array<{ name: string; type: string; value?: string }> }> {
    const forms: Array<{ action: string; method: string; inputs: Array<{ name: string; type: string; value?: string }> }> = [];
    
    doc.querySelectorAll('form').forEach(form => {
      const action = form.getAttribute('action') || '';
      const method = form.getAttribute('method') || 'GET';
      const inputs: Array<{ name: string; type: string; value?: string }> = [];
      
      form.querySelectorAll('input, select, textarea').forEach(input => {
        const name = input.getAttribute('name');
        const type = input.getAttribute('type') || input.tagName.toLowerCase();
        const value = input.getAttribute('value') || undefined;
        
        if (name) {
          inputs.push({ name, type, value });
        }
      });
      
      forms.push({ action, method, inputs });
    });
    
    return forms;
  }

  // Extract metadata from DOM
  private extractMetadataFromDOM(doc: Document): Record<string, string> {
    const metadata: Record<string, string> = {};
    
    // Meta tags
    doc.querySelectorAll('meta').forEach(meta => {
      const name = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      
      if (name && content) {
        metadata[name] = content;
      }
    });
    
    // Open Graph tags
    doc.querySelectorAll('meta[property^="og:"]').forEach(meta => {
      const property = meta.getAttribute('property');
      const content = meta.getAttribute('content');
      
      if (property && content) {
        metadata[property] = content;
      }
    });
    
    return metadata;
  }

  // Extract headings from DOM
  private extractHeadingsFromDOM(doc: Document): Array<{ level: number; text: string; id?: string }> {
    const headings: Array<{ level: number; text: string; id?: string }> = [];
    
    doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
      const level = parseInt(heading.tagName.charAt(1));
      const text = heading.textContent?.trim() || '';
      const id = heading.getAttribute('id') || undefined;
      
      if (text) {
        headings.push({ level, text, id });
      }
    });
    
    return headings;
  }

  // Extract lists from DOM
  private extractListsFromDOM(doc: Document): Array<{ type: 'ul' | 'ol'; items: string[] }> {
    const lists: Array<{ type: 'ul' | 'ol'; items: string[] }> = [];
    
    doc.querySelectorAll('ul, ol').forEach(list => {
      const type = list.tagName.toLowerCase() as 'ul' | 'ol';
      const items: string[] = [];
      
      list.querySelectorAll('li').forEach(item => {
        const text = item.textContent?.trim() || '';
        if (text) {
          items.push(text);
        }
      });
      
      if (items.length > 0) {
        lists.push({ type, items });
      }
    });
    
    return lists;
  }

  // Extract tables from DOM
  private extractTablesFromDOM(doc: Document): Array<{ headers: string[]; rows: string[][] }> {
    const tables: Array<{ headers: string[]; rows: string[][] }> = [];
    
    doc.querySelectorAll('table').forEach(table => {
      const headers: string[] = [];
      const rows: string[][] = [];
      
      // Extract headers
      table.querySelectorAll('th').forEach(th => {
        const text = th.textContent?.trim() || '';
        if (text) {
          headers.push(text);
        }
      });
      
      // Extract rows
      table.querySelectorAll('tr').forEach(tr => {
        const row: string[] = [];
        tr.querySelectorAll('td').forEach(td => {
          const text = td.textContent?.trim() || '';
          row.push(text);
        });
        
        if (row.length > 0) {
          rows.push(row);
        }
      });
      
      if (headers.length > 0 || rows.length > 0) {
        tables.push({ headers, rows });
      }
    });
    
    return tables;
  }

  // Canvas-specific parsing helpers
  parseDashboard(html: string): ParsedContent & { courses?: Array<{ id: string; name: string; url: string }> } {
    const content = this.parseHtml(html);
    
    // Extract course list from dashboard
    const courses: Array<{ id: string; name: string; url: string }> = [];
    
    if (typeof DOMParser !== 'undefined') {
      // DOM-based extraction (content script/popup)
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      doc.querySelectorAll('a[href*="/courses/"]').forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim() || '';
        
        if (href && text) {
          const match = href.match(/\/courses\/(\d+)/);
          if (match) {
            courses.push({
              id: match[1],
              name: text,
              url: href.startsWith('http') ? href : `https://canvas.instructure.com${href}`
            });
          }
        }
      });
    } else {
      // Regex-based extraction (service worker)
      const courseRegex = /<a[^>]+href=["']([^"']*\/courses\/(\d+)[^"']*)["'][^>]*>(.*?)<\/a>/gis;
      let match;
      
      while ((match = courseRegex.exec(html)) !== null) {
        const href = match[1];
        const id = match[2];
        const text = match[3].replace(/<[^>]*>/g, '').trim();
        
        if (href && id && text) {
          courses.push({
            id,
            name: text,
            url: href.startsWith('http') ? href : `https://canvas.instructure.com${href}`
          });
        }
      }
    }
    
    return { ...content, courses };
  }

  parseCourseList(html: string): ParsedContent & { courses: Array<{ id: string; name: string; url: string; code?: string }> } {
    const content = this.parseHtml(html);
    const courses: Array<{ id: string; name: string; url: string; code?: string }> = [];
    
    if (typeof DOMParser !== 'undefined') {
      // DOM-based extraction (content script/popup)
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      doc.querySelectorAll('.course-list-item, .course-item, [data-course-id]').forEach(item => {
        const link = item.querySelector('a[href*="/courses/"]');
        if (link) {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim() || '';
          const courseId = item.getAttribute('data-course-id') || href?.match(/\/courses\/(\d+)/)?.[1];
          
          if (href && text && courseId) {
            courses.push({
              id: courseId,
              name: text,
              url: href.startsWith('http') ? href : `https://canvas.instructure.com${href}`,
              code: item.querySelector('.course-code')?.textContent?.trim()
            });
          }
        }
      });
    } else {
      // Regex-based extraction (service worker)
      const courseRegex = /<a[^>]+href=["']([^"']*\/courses\/(\d+)[^"']*)["'][^>]*>(.*?)<\/a>/gis;
      let match;
      
      while ((match = courseRegex.exec(html)) !== null) {
        const href = match[1];
        const id = match[2];
        const text = match[3].replace(/<[^>]*>/g, '').trim();
        
        if (href && id && text) {
          courses.push({
            id,
            name: text,
            url: href.startsWith('http') ? href : `https://canvas.instructure.com${href}`
          });
        }
      }
    }
    
    return { ...content, courses };
  }

  // Utility methods
  extractCanvasUrls(html: string): string[] {
    const urls: string[] = [];
    
    if (typeof DOMParser !== 'undefined') {
      // DOM-based extraction (content script/popup)
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      doc.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && (href.includes('canvas.instructure.com') || href.includes('/courses/'))) {
          urls.push(href);
        }
      });
    } else {
      // Regex-based extraction (service worker)
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gis;
      let match;
      
      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        if (href && (href.includes('canvas.instructure.com') || href.includes('/courses/'))) {
          urls.push(href);
        }
      }
    }
    
    return [...new Set(urls)]; // Remove duplicates
  }

  isCanvasPage(html: string): boolean {
    const content = this.parseHtml(html);
    return content.title.toLowerCase().includes('canvas') || 
           content.text.toLowerCase().includes('canvas') ||
           content.metadata['application-name'] === 'Canvas';
  }
}

export const htmlParser = new HtmlParser();
