// Student Index Storage Manager
// Manages student course data with deduplication and persistence

import { storageManager } from './storageManager';
import { Course, StudentIndex } from './courseDiscovery';

export interface CourseIndexEntry {
  course: Course;
  sections: {
    announcements: { count: number; lastSync?: number };
    assignments: { count: number; lastSync?: number };
    discussions: { count: number; lastSync?: number };
    pages: { count: number; lastSync?: number };
    files: { count: number; lastSync?: number };
    quizzes: { count: number; lastSync?: number };
    modules: { count: number; lastSync?: number };
    grades: { count: number; lastSync?: number };
    people: { count: number; lastSync?: number };
    syllabus: { lastSync?: number };
  };
  stats: {
    totalItems: number;
    lastCrawl: number;
    crawlDuration: number;
    errors: number;
  };
}

export class StudentIndexManager {
  private canvasHost: string;
  private currentIndex: StudentIndex | null = null;

  constructor(canvasHost = 'https://canvas.instructure.com') {
    this.canvasHost = canvasHost;
  }

  // Load or create student index
  async loadStudentIndex(): Promise<StudentIndex> {
    try {
      const result = await chrome.storage.local.get(['studentIndex']);
      const stored = result.studentIndex;
      
      if (stored && stored.canvasHost === this.canvasHost) {
        this.currentIndex = stored;
        console.log(`[StudentIndex] Loaded existing index with ${Object.keys(stored.courses).length} courses`);
        return stored;
      } else {
        // Create new index
        this.currentIndex = this.createEmptyIndex();
        await this.saveStudentIndex();
        console.log('[StudentIndex] Created new student index');
        return this.currentIndex;
      }
    } catch (error) {
      console.error('[StudentIndex] Error loading student index:', error);
      this.currentIndex = this.createEmptyIndex();
      return this.currentIndex;
    }
  }

  // Update courses in the student index
  async updateCourses(courses: Course[]): Promise<void> {
    if (!this.currentIndex) {
      await this.loadStudentIndex();
    }

    let newCourses = 0;
    let updatedCourses = 0;

    for (const course of courses) {
      const existingCourse = this.currentIndex!.courses[course.id];
      
      if (existingCourse) {
        // Update existing course if data has changed
        if (this.hasCourseDifferences(existingCourse, course)) {
          this.currentIndex!.courses[course.id] = {
            ...existingCourse,
            ...course,
            discoveredAt: existingCourse.discoveredAt, // Preserve original discovery time
            updatedAt: Date.now()
          };
          updatedCourses++;
        }
      } else {
        // Add new course
        this.currentIndex!.courses[course.id] = course;
        newCourses++;
      }
    }

    // Update index metadata
    this.currentIndex!.lastSync = Date.now();
    this.currentIndex!.totalCourses = Object.keys(this.currentIndex!.courses).length;
    this.currentIndex!.activeCourses = Object.values(this.currentIndex!.courses)
      .filter(c => c.status === 'active').length;
    this.currentIndex!.completedCourses = Object.values(this.currentIndex!.courses)
      .filter(c => c.status === 'completed').length;

    await this.saveStudentIndex();

    console.log(`[StudentIndex] Updated courses: ${newCourses} new, ${updatedCourses} updated, ${this.currentIndex!.totalCourses} total`);
  }

  // Get all courses
  getCourses(): Course[] {
    if (!this.currentIndex) return [];
    return Object.values(this.currentIndex.courses);
  }

  // Get active courses only
  getActiveCourses(): Course[] {
    return this.getCourses().filter(course => course.status === 'active');
  }

  // Get course by ID
  getCourse(courseId: string): Course | null {
    if (!this.currentIndex) return null;
    return this.currentIndex.courses[courseId] || null;
  }

  // Create course index entry for detailed tracking
  async createCourseIndex(courseId: string): Promise<CourseIndexEntry | null> {
    const course = this.getCourse(courseId);
    if (!course) return null;

    const indexEntry: CourseIndexEntry = {
      course,
      sections: {
        announcements: { count: 0 },
        assignments: { count: 0 },
        discussions: { count: 0 },
        pages: { count: 0 },
        files: { count: 0 },
        quizzes: { count: 0 },
        modules: { count: 0 },
        grades: { count: 0 },
        people: { count: 0 },
        syllabus: {}
      },
      stats: {
        totalItems: 0,
        lastCrawl: 0,
        crawlDuration: 0,
        errors: 0
      }
    };

    // Store course index
    await chrome.storage.local.set({ [`courseIndex_${courseId}`]: indexEntry });
    
    console.log(`[StudentIndex] Created course index for ${course.name} (${courseId})`);
    return indexEntry;
  }

  // Get course index
  async getCourseIndex(courseId: string): Promise<CourseIndexEntry | null> {
    try {
      const result = await chrome.storage.local.get([`courseIndex_${courseId}`]);
      return result[`courseIndex_${courseId}`] || null;
    } catch (error) {
      console.error(`[StudentIndex] Error loading course index for ${courseId}:`, error);
      return null;
    }
  }

  // Update course index section
  async updateCourseSection(
    courseId: string, 
    section: keyof CourseIndexEntry['sections'], 
    data: { count?: number; lastSync?: number }
  ): Promise<void> {
    let courseIndex = await this.getCourseIndex(courseId);
    
    if (!courseIndex) {
      courseIndex = await this.createCourseIndex(courseId);
      if (!courseIndex) return;
    }

    // Update section data
    if (data.count !== undefined) {
      courseIndex.sections[section].count = data.count;
    }
    if (data.lastSync !== undefined) {
      courseIndex.sections[section].lastSync = data.lastSync;
    }

    // Update total items
    courseIndex.stats.totalItems = Object.values(courseIndex.sections)
      .reduce((sum, section) => sum + (section.count || 0), 0);

    // Save updated index
    await chrome.storage.local.set({ [`courseIndex_${courseId}`]: courseIndex });
  }

  // Get statistics
  getStats(): {
    totalCourses: number;
    activeCourses: number;
    completedCourses: number;
    lastSync: number;
    oldestCourse?: Course;
    newestCourse?: Course;
  } {
    if (!this.currentIndex) {
      return {
        totalCourses: 0,
        activeCourses: 0,
        completedCourses: 0,
        lastSync: 0
      };
    }

    const courses = this.getCourses();
    const sortedByDiscovered = courses.sort((a, b) => a.discoveredAt - b.discoveredAt);

    return {
      totalCourses: this.currentIndex.totalCourses,
      activeCourses: this.currentIndex.activeCourses,
      completedCourses: this.currentIndex.completedCourses,
      lastSync: this.currentIndex.lastSync,
      oldestCourse: sortedByDiscovered[0],
      newestCourse: sortedByDiscovered[sortedByDiscovered.length - 1]
    };
  }

  // Remove course from index
  async removeCourse(courseId: string): Promise<boolean> {
    if (!this.currentIndex) return false;

    if (this.currentIndex.courses[courseId]) {
      delete this.currentIndex.courses[courseId];
      
      // Update counts
      this.currentIndex.totalCourses = Object.keys(this.currentIndex.courses).length;
      this.currentIndex.activeCourses = Object.values(this.currentIndex.courses)
        .filter(c => c.status === 'active').length;
      this.currentIndex.completedCourses = Object.values(this.currentIndex.courses)
        .filter(c => c.status === 'completed').length;

      await this.saveStudentIndex();
      
      // Also remove course index
      await chrome.storage.local.remove([`courseIndex_${courseId}`]);
      
      console.log(`[StudentIndex] Removed course ${courseId}`);
      return true;
    }

    return false;
  }

  // Clear all course data
  async clearAll(): Promise<void> {
    this.currentIndex = this.createEmptyIndex();
    await this.saveStudentIndex();
    
    // Remove all course indexes
    const allData = await chrome.storage.local.get(null);
    const courseIndexKeys = Object.keys(allData).filter(key => key.startsWith('courseIndex_'));
    
    if (courseIndexKeys.length > 0) {
      await chrome.storage.local.remove(courseIndexKeys);
    }
    
    console.log('[StudentIndex] Cleared all course data');
  }

  // Export student index for backup
  async exportIndex(): Promise<StudentIndex | null> {
    if (!this.currentIndex) {
      await this.loadStudentIndex();
    }
    return this.currentIndex;
  }

  // Import student index from backup
  async importIndex(index: StudentIndex): Promise<void> {
    this.currentIndex = {
      ...index,
      canvasHost: this.canvasHost, // Ensure host matches
      lastSync: Date.now()
    };
    
    await this.saveStudentIndex();
    console.log(`[StudentIndex] Imported index with ${Object.keys(index.courses).length} courses`);
  }

  // Private methods
  private createEmptyIndex(): StudentIndex {
    return {
      userId: 'unknown', // Will be populated when we can detect user
      canvasHost: this.canvasHost,
      courses: {},
      lastSync: Date.now(),
      totalCourses: 0,
      activeCourses: 0,
      completedCourses: 0
    };
  }

  private async saveStudentIndex(): Promise<void> {
    if (!this.currentIndex) return;
    
    try {
      await chrome.storage.local.set({ studentIndex: this.currentIndex });
    } catch (error) {
      console.error('[StudentIndex] Error saving student index:', error);
    }
  }

  private hasCourseDifferences(existing: Course, updated: Course): boolean {
    // Check if any important fields have changed
    return (
      existing.name !== updated.name ||
      existing.code !== updated.code ||
      existing.status !== updated.status ||
      existing.term !== updated.term ||
      existing.url !== updated.url
    );
  }
}

export const studentIndexManager = new StudentIndexManager();
