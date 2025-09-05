// Course Discovery Parser
// Extracts course information from Canvas dashboard and course list pages

export interface Course {
  id: string;
  name: string;
  code: string;
  url: string;
  term?: string;
  status: 'active' | 'completed' | 'unpublished';
  lastActivity?: string;
  role?: string;
  color?: string;
  favorite?: boolean;
  discoveredAt: number;
  updatedAt: number;
}

export interface StudentIndex {
  userId: string;
  userName?: string;
  canvasHost: string;
  courses: Record<string, Course>;
  lastSync: number;
  totalCourses: number;
  activeCourses: number;
  completedCourses: number;
}

export class CourseDiscovery {
  private canvasHost: string;
  
  constructor(canvasHost = 'https://canvas.instructure.com') {
    this.canvasHost = canvasHost;
  }

  // Parse dashboard HTML to extract course information
  parseDashboard(html: string): Course[] {
    const courses: Course[] = [];
    
    try {
      console.log(`[CourseDiscovery] Parsing dashboard HTML (${html.length} bytes)`);
      
      // Method 1: Parse dashboard cards (modern Canvas)
      const dashboardCourses = this.parseDashboardCards(html);
      console.log(`[CourseDiscovery] Dashboard cards method found: ${dashboardCourses.length} courses`);
      courses.push(...dashboardCourses);
      
      // Method 2: Parse course links from navigation or content
      const linkCourses = this.parseCourseLinks(html);
      console.log(`[CourseDiscovery] Course links method found: ${linkCourses.length} courses`);
      courses.push(...linkCourses);
      
      // Method 3: Parse from JSON data embedded in page
      const jsonCourses = this.parseEmbeddedJson(html);
      console.log(`[CourseDiscovery] JSON data method found: ${jsonCourses.length} courses`);
      courses.push(...jsonCourses);
      
      // Debug: Look for any course-related content
      const courseMatches = html.match(/courses?\//gi);
      const courseIdMatches = html.match(/\/courses\/\d+/gi);
      console.log(`[CourseDiscovery] Debug - Found ${courseMatches?.length || 0} 'course' references, ${courseIdMatches?.length || 0} course ID patterns`);
      
      // Show the actual course ID patterns we found
      if (courseIdMatches && courseIdMatches.length > 0) {
        console.log(`[CourseDiscovery] Course ID patterns found:`, courseIdMatches);
        
        // For each course ID pattern, show some context around it
        courseIdMatches.forEach((pattern, index) => {
          const patternIndex = html.indexOf(pattern);
          if (patternIndex !== -1) {
            const start = Math.max(0, patternIndex - 100);
            const end = Math.min(html.length, patternIndex + pattern.length + 100);
            const context = html.substring(start, end);
            console.log(`[CourseDiscovery] Context ${index + 1}: ...${context}...`);
          }
        });
      }
      
      // Also try to find any data attributes or JavaScript variables with course IDs
      const dataAttributeMatches = html.match(/data-[^=]*course[^=]*="[^"]*"/gi);
      const jsVariableMatches = html.match(/course[^=]*[:=]\s*["']?[\d\/]+/gi);
      console.log(`[CourseDiscovery] Data attributes: ${dataAttributeMatches?.length || 0}, JS variables: ${jsVariableMatches?.length || 0}`);
      
      if (dataAttributeMatches) {
        console.log(`[CourseDiscovery] Data attributes found:`, dataAttributeMatches.slice(0, 3));
      }
      if (jsVariableMatches) {
        console.log(`[CourseDiscovery] JS variables found:`, jsVariableMatches.slice(0, 3));
      }
      
      console.log(`[CourseDiscovery] Found ${courses.length} courses from dashboard`);
      
    } catch (error) {
      console.error('[CourseDiscovery] Error parsing dashboard:', error);
    }
    
    return this.deduplicateCourses(courses);
  }

  // Parse course list page HTML
  parseCourseList(html: string): Course[] {
    const courses: Course[] = [];
    
    try {
      // Parse course table rows
      const tableRegex = /<tr[^>]*class="[^"]*course[^"]*"[^>]*>(.*?)<\/tr>/gis;
      let match;
      
      while ((match = tableRegex.exec(html)) !== null) {
        const rowHtml = match[1];
        const course = this.parseCourseRow(rowHtml);
        if (course) {
          courses.push(course);
        }
      }
      
      // Also try parsing course cards if present
      const cardCourses = this.parseDashboardCards(html);
      courses.push(...cardCourses);
      
      console.log(`[CourseDiscovery] Found ${courses.length} courses from course list`);
      
    } catch (error) {
      console.error('[CourseDiscovery] Error parsing course list:', error);
    }
    
    return this.deduplicateCourses(courses);
  }

  private parseDashboardCards(html: string): Course[] {
    const courses: Course[] = [];
    
    // Modern Canvas dashboard cards
    const cardSelectors = [
      // Dashboard card patterns
      /<div[^>]*class="[^"]*ic-DashboardCard[^"]*"[^>]*>(.*?)<\/div>/gis,
      /<div[^>]*class="[^"]*dashboard-card[^"]*"[^>]*>(.*?)<\/div>/gis,
      /<div[^>]*data-course-id="([^"]*)"[^>]*>(.*?)<\/div>/gis
    ];
    
    for (const regex of cardSelectors) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        const cardHtml = match[1] || match[2];
        const courseId = match[1] && match[1].match(/^\d+$/) ? match[1] : null;
        
        const course = this.parseCardContent(cardHtml, courseId);
        if (course) {
          courses.push(course);
        }
      }
    }
    
    return courses;
  }

  private parseCardContent(cardHtml: string, courseId?: string | null): Course | null {
    try {
      // Extract course name
      const nameMatch = cardHtml.match(/<h3[^>]*class="[^"]*ic-DashboardCard__header-title[^"]*"[^>]*>(.*?)<\/h3>/i) ||
                       cardHtml.match(/<.*?class="[^"]*dashboard-card-header[^"]*"[^>]*>(.*?)<\/.*?>/i) ||
                       cardHtml.match(/<a[^>]*href="[^"]*\/courses\/\d+[^"]*"[^>]*>(.*?)<\/a>/i);
      
      if (!nameMatch) return null;
      
      const name = this.cleanText(nameMatch[1]);
      
      // Extract course URL and ID
      const urlMatch = cardHtml.match(/href="([^"]*\/courses\/(\d+)[^"]*)"/i);
      if (!urlMatch) return null;
      
      const url = this.resolveUrl(urlMatch[1]);
      const id = courseId || urlMatch[2];
      
      // Extract course code (usually before the name or in subtitle)
      const codeMatch = cardHtml.match(/<span[^>]*class="[^"]*course-code[^"]*"[^>]*>(.*?)<\/span>/i) ||
                       name.match(/^([A-Z]+\s*\d+[A-Z]*)\s*[-:]\s*/);
      
      const code = codeMatch ? this.cleanText(codeMatch[1]) : this.extractCodeFromName(name);
      
      // Extract additional metadata
      const status = this.extractStatus(cardHtml);
      const term = this.extractTerm(cardHtml);
      const color = this.extractColor(cardHtml);
      
      return {
        id,
        name,
        code,
        url,
        term,
        status,
        color,
        favorite: cardHtml.includes('favorite') || cardHtml.includes('starred'),
        discoveredAt: Date.now(),
        updatedAt: Date.now()
      };
      
    } catch (error) {
      console.error('[CourseDiscovery] Error parsing card content:', error);
      return null;
    }
  }

  private parseCourseLinks(html: string): Course[] {
    const courses: Course[] = [];
    
    // Multiple regex patterns to catch different link formats
    const linkPatterns = [
      // Standard anchor tags with course URLs
      /<a[^>]*href="([^"]*\/courses\/(\d+)[^"]*)"[^>]*>(.*?)<\/a>/gi,
      // Links that might span multiple lines or have nested elements
      /<a[^>]*href="([^"]*\/courses\/(\d+)[^"]*)"[^>]*>[\s\S]*?<\/a>/gi,
      // Data attributes or other formats
      /data-course-id="(\d+)"[^>]*>([^<]*)/gi,
      // Href patterns without full anchor tag context
      /href="([^"]*\/courses\/(\d+)[^"]*)"/gi
    ];
    
    let totalMatches = 0;
    
    for (let i = 0; i < linkPatterns.length; i++) {
      const regex = linkPatterns[i];
      let match;
      let patternMatches = 0;
      
      while ((match = regex.exec(html)) !== null) {
        patternMatches++;
        totalMatches++;
        
        let url, id, linkText;
        
        if (i === 2) { // data-course-id pattern
          id = match[1];
          linkText = match[2];
          url = `${this.canvasHost}/courses/${id}`;
        } else if (i === 3) { // href pattern only
          url = this.resolveUrl(match[1]);
          id = match[2];
          linkText = `Course ${id}`;
        } else { // standard patterns
          url = this.resolveUrl(match[1]);
          id = match[2];
          linkText = this.cleanText(match[3] || '');
        }
        
        console.log(`[CourseDiscovery] Pattern ${i+1} match ${patternMatches}: ID=${id}, text="${linkText}", url="${url}"`);
        
        // Skip if this looks like a navigation link
        if (this.isNavigationLink(linkText)) {
          console.log(`[CourseDiscovery] Skipping navigation link: "${linkText}"`);
          continue;
        }
        
        // For empty or generic link text, try to find nearby text content
        if (!linkText || linkText.length < 3 || linkText.match(/^(course|link|\d+)$/i)) {
          linkText = this.findNearbyText(html, match.index || 0) || `Course ${id}`;
          console.log(`[CourseDiscovery] Using nearby text: "${linkText}"`);
        }
        
        // Extract course name and code
        const { name, code } = this.parseNameAndCode(linkText);
        console.log(`[CourseDiscovery] Parsed name="${name}", code="${code}"`);
        
        if (name && code && !courses.find(c => c.id === id)) {
          courses.push({
            id,
            name,
            code,
            url,
            status: 'active',
            discoveredAt: Date.now(),
            updatedAt: Date.now()
          });
          console.log(`[CourseDiscovery] Added course: ${code} - ${name}`);
        }
      }
      
      console.log(`[CourseDiscovery] Pattern ${i+1} found ${patternMatches} matches`);
    }
    
    console.log(`[CourseDiscovery] Course links parsing: found ${totalMatches} total matches, extracted ${courses.length} unique courses`);
    return courses;
  }

  private parseEmbeddedJson(html: string): Course[] {
    const courses: Course[] = [];
    
    try {
      console.log('[CourseDiscovery] Looking for embedded JSON data...');
      
      // Multiple patterns for embedded JSON data
      const jsonPatterns = [
        // ENV variable
        /<script[^>]*>\s*(?:window\.|var\s+)?ENV\s*=\s*({.*?});\s*<\/script>/gis,
        // Other common Canvas variables
        /<script[^>]*>\s*(?:window\.|var\s+)?CANVAS_ENV\s*=\s*({.*?});\s*<\/script>/gis,
        /<script[^>]*>\s*(?:window\.|var\s+)?dashboard\s*=\s*({.*?});\s*<\/script>/gis,
        // Canvas dashboard data with course objects
        /<script[^>]*>[\s\S]*?courses?[\s\S]*?<\/script>/gis,
        // Specific pattern for the JSON objects we found in context
        /"originalName":"([^"]+)","courseCode":"([^"]+)","assetString":"course_(\d+)","href":"\/courses\/(\d+)"/gi
      ];
      
      for (let i = 0; i < jsonPatterns.length; i++) {
        const regex = jsonPatterns[i];
        let match;
        
        while ((match = regex.exec(html)) !== null) {
          console.log(`[CourseDiscovery] Found JSON pattern ${i + 1}, attempting to parse...`);
          
          try {
            let jsonData;
            if (i < 3) {
              // For structured JSON patterns
              jsonData = JSON.parse(match[1]);
            } else if (i === 4) {
              // For the specific JSON object pattern we found
              console.log(`[CourseDiscovery] Found JSON object pattern with ${match.length} groups`);
              if (match.length >= 5) {
                const course: Course = {
                  id: match[4], // course ID from href
                  name: match[1], // originalName
                  code: match[2], // courseCode
                  url: `https://canvas.instructure.com/courses/${match[4]}`,
                  status: 'active',
                  discoveredAt: Date.now(),
                  updatedAt: Date.now()
                };
                console.log(`[CourseDiscovery] Extracted course from JSON pattern:`, course);
                courses.push(course);
              }
              continue;
            } else {
              // For script content, try to extract JSON objects
              const scriptContent = match[0];
              const jsonObjects = this.extractJsonFromScript(scriptContent);
              for (const obj of jsonObjects) {
                const extractedCourses = this.extractCoursesFromObject(obj);
                courses.push(...extractedCourses);
              }
              continue;
            }
            
            console.log(`[CourseDiscovery] Successfully parsed JSON data, keys:`, Object.keys(jsonData));
            
            // Extract courses from various JSON structures
            const extractedCourses = this.extractCoursesFromObject(jsonData);
            courses.push(...extractedCourses);
            
          } catch (parseError) {
            console.log(`[CourseDiscovery] Failed to parse JSON from pattern ${i + 1}:`, parseError.message);
          }
        }
      }
      
    } catch (error) {
      console.log('[CourseDiscovery] Error in JSON parsing:', error.message);
    }
    
    return courses;
  }

  private parseEnvCard(card: any): Course | null {
    try {
      if (!card.id || !card.shortName || !card.originalName) return null;
      
      return {
        id: String(card.id),
        name: card.originalName,
        code: card.shortName,
        url: `${this.canvasHost}/courses/${card.id}`,
        term: card.term?.name,
        status: card.published === false ? 'unpublished' : 'active',
        color: card.color,
        favorite: card.isFavorited,
        discoveredAt: Date.now(),
        updatedAt: Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  private parseEnvCourse(courseData: any): Course | null {
    try {
      if (!courseData.id || !courseData.name) return null;
      
      return {
        id: String(courseData.id),
        name: courseData.name,
        code: courseData.course_code || this.extractCodeFromName(courseData.name),
        url: `${this.canvasHost}/courses/${courseData.id}`,
        term: courseData.term?.name,
        status: courseData.workflow_state === 'completed' ? 'completed' : 'active',
        role: courseData.enrollments?.[0]?.type,
        discoveredAt: Date.now(),
        updatedAt: Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  private parseCourseRow(rowHtml: string): Course | null {
    try {
      // Extract course link
      const linkMatch = rowHtml.match(/<a[^>]*href="([^"]*\/courses\/(\d+)[^"]*)"[^>]*>(.*?)<\/a>/i);
      if (!linkMatch) return null;
      
      const url = this.resolveUrl(linkMatch[1]);
      const id = linkMatch[2];
      const nameText = this.cleanText(linkMatch[3]);
      
      // Parse name and code
      const { name, code } = this.parseNameAndCode(nameText);
      
      // Extract additional info from row
      const status = this.extractStatusFromRow(rowHtml);
      const term = this.extractTermFromRow(rowHtml);
      
      return {
        id,
        name,
        code,
        url,
        term,
        status,
        discoveredAt: Date.now(),
        updatedAt: Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  // Utility methods
  private deduplicateCourses(courses: Course[]): Course[] {
    const seen = new Set<string>();
    const unique: Course[] = [];
    
    for (const course of courses) {
      if (!seen.has(course.id)) {
        seen.add(course.id);
        unique.push(course);
      }
    }
    
    return unique;
  }

  private cleanText(text: string): string {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp;
      .replace(/&amp;/g, '&')  // Replace &amp;
      .replace(/&lt;/g, '<')   // Replace &lt;
      .replace(/&gt;/g, '>')   // Replace &gt;
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }

  private resolveUrl(url: string): string {
    if (url.startsWith('http')) return url;
    if (url.startsWith('/')) return this.canvasHost + url;
    return this.canvasHost + '/' + url;
  }

  private isNavigationLink(text: string): boolean {
    const navTerms = ['dashboard', 'calendar', 'inbox', 'history', 'help', 'profile', 'settings'];
    const lowerText = text.toLowerCase();
    return navTerms.some(term => lowerText.includes(term));
  }

  private parseNameAndCode(text: string): { name: string; code: string } {
    // Clean the text first
    const cleanedText = text.trim();
    
    // Try to extract course code and name from text like "CS 101: Introduction to Computer Science"
    const codeNameMatch = cleanedText.match(/^([A-Z]+\s*\d+[A-Z]*)\s*[-:]\s*(.+)$/i);
    if (codeNameMatch) {
      return {
        code: codeNameMatch[1].trim().toUpperCase(),
        name: codeNameMatch[2].trim()
      };
    }
    
    // Try to extract code from beginning (more flexible)
    const codeMatch = cleanedText.match(/^([A-Z]*\d+[A-Z]*\s*\d*[A-Z]*)/i);
    if (codeMatch && codeMatch[1].length >= 2) {
      const code = codeMatch[1].trim().toUpperCase();
      const name = cleanedText.replace(codeMatch[0], '').replace(/^[-:\s]+/, '').trim();
      return {
        code,
        name: name || cleanedText
      };
    }
    
    // Try to find any word that looks like a course code
    const anyCodeMatch = cleanedText.match(/\b([A-Z]{2,4}\s*\d{2,4}[A-Z]?)\b/i);
    if (anyCodeMatch) {
      return {
        code: anyCodeMatch[1].trim().toUpperCase(),
        name: cleanedText
      };
    }
    
    // Fallback: use full text as name and generate code
    return {
      name: cleanedText,
      code: this.extractCodeFromName(cleanedText)
    };
  }

  private extractCodeFromName(name: string): string {
    // Try to extract a course code from the name
    const codeMatch = name.match(/([A-Z]+\s*\d+[A-Z]*)/);
    if (codeMatch) return codeMatch[1];
    
    // Generate code from first letters and numbers
    const words = name.split(' ');
    let code = '';
    for (const word of words) {
      const letters = word.match(/[A-Z]+/g);
      const numbers = word.match(/\d+/g);
      if (letters) code += letters.join('');
      if (numbers) code += numbers.join('');
      if (code.length >= 6) break;
    }
    
    return code || name.substring(0, 8).toUpperCase();
  }

  private extractStatus(html: string): 'active' | 'completed' | 'unpublished' {
    if (html.includes('unpublished') || html.includes('not-published')) return 'unpublished';
    if (html.includes('completed') || html.includes('concluded')) return 'completed';
    return 'active';
  }

  private extractTerm(html: string): string | undefined {
    const termMatch = html.match(/term[^>]*>([^<]+)</i) ||
                     html.match(/semester[^>]*>([^<]+)</i) ||
                     html.match(/quarter[^>]*>([^<]+)</i);
    return termMatch ? this.cleanText(termMatch[1]) : undefined;
  }

  private extractColor(html: string): string | undefined {
    const colorMatch = html.match(/background-color:\s*([^;)]+)/i) ||
                      html.match(/color:\s*([^;)]+)/i);
    return colorMatch ? colorMatch[1].trim() : undefined;
  }

  private extractStatusFromRow(html: string): 'active' | 'completed' | 'unpublished' {
    return this.extractStatus(html);
  }

  private extractTermFromRow(html: string): string | undefined {
    return this.extractTerm(html);
  }

  private findNearbyText(html: string, position: number): string | null {
    // Look for text content near the match position
    const start = Math.max(0, position - 200);
    const end = Math.min(html.length, position + 200);
    const snippet = html.substring(start, end);
    
    // Try to find meaningful text in nearby elements
    const textMatches = snippet.match(/>([^<]{10,})</g);
    if (textMatches && textMatches.length > 0) {
      const text = textMatches[0].replace(/^>/, '').trim();
      if (text && !text.match(/^(link|course|view|go to|click)$/i)) {
        return text;
      }
    }
    
    return null;
  }

  private extractJsonFromScript(scriptContent: string): any[] {
    const objects: any[] = [];
    
    try {
      // Look for JSON object patterns in script content
      const objectMatches = scriptContent.match(/{[^{}]*"[^"]*course[^"]*"[^{}]*}/gi);
      
      if (objectMatches) {
        for (const match of objectMatches) {
          try {
            const obj = JSON.parse(match);
            objects.push(obj);
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    } catch (error) {
      // Skip
    }
    
    return objects;
  }

  private extractCoursesFromObject(obj: any): Course[] {
    const courses: Course[] = [];
    
    try {
      // Check various common structures
      if (obj.DASHBOARD && obj.DASHBOARD.cards) {
        for (const card of obj.DASHBOARD.cards) {
          const course = this.parseEnvCard(card);
          if (course) courses.push(course);
        }
      }
      
      if (obj.courses && Array.isArray(obj.courses)) {
        for (const courseData of obj.courses) {
          const course = this.parseEnvCourse(courseData);
          if (course) courses.push(course);
        }
      }
      
      // Check if the object itself looks like a course
      if (obj.id && (obj.name || obj.originalName) && String(obj.id).match(/^\d+$/)) {
        const course = this.parseEnvCourse(obj);
        if (course) courses.push(course);
      }
      
    } catch (error) {
      // Skip invalid objects
    }
    
    return courses;
  }
}

export const courseDiscovery = new CourseDiscovery();

// Phase 8: Section Crawler functionality integrated into courseDiscovery
export const testSectionCrawlerDirect = async () => {
  console.log('[Phase8Test] Testing section crawler functionality directly...');
  
  try {
    // Get student index
    const studentIndex = await (globalThis as any).studentIndexManager.loadStudentIndex();
    console.log('[Phase8Test] Student index loaded:', studentIndex);
    
    // Get courses array
    const courses = Object.values(studentIndex.courses);
    console.log('[Phase8Test] Courses array:', courses);
    console.log('[Phase8Test] Found courses:', courses.length);
    
    if (courses.length > 0) {
      const testCourse = courses[0] as any;
      console.log('[Phase8Test] Testing course:', testCourse.code, testCourse.id);
      
      // Test section URL building
      const announcementsUrl = `${testCourse.url}/announcements`;
      console.log('[Phase8Test] Announcements URL:', announcementsUrl);
      
      // Test fetch-based section crawling
      try {
        const response = await fetch(announcementsUrl);
        console.log('[Phase8Test] Fetch response:', response.status, response.statusText);
        
        if (response.ok) {
          const html = await response.text();
          console.log('[Phase8Test] Fetched HTML length:', html.length);
          
          // Simple parsing test
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const links = doc.querySelectorAll('a[href*="/announcements/"]');
          console.log('[Phase8Test] Found announcement links:', links.length);
          
          // Show first few links
          for (let i = 0; i < Math.min(3, links.length); i++) {
            const link = links[i];
            const href = link.getAttribute('href');
            const title = link.textContent?.trim();
            console.log(`[Phase8Test] Link ${i + 1}: ${title} -> ${href}`);
          }
        }
      } catch (fetchError) {
        console.log('[Phase8Test] Fetch failed:', fetchError);
      }
    }
    
    console.log('[Phase8Test] Section crawler test completed!');
    
  } catch (error) {
    console.error('[Phase8Test] Test failed:', error);
  }
};
