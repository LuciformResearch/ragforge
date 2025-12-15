/**
 * ReportEditor - Lightweight markdown report editor with incremental operations
 *
 * Provides edit operations for building reports incrementally:
 * - set_report: Set full content (for initial draft)
 * - edit_report: Search/replace text
 * - append_to_report: Add content at end
 * - insert_after_heading: Insert after a specific heading
 * - replace_section: Replace entire section content
 *
 * @since 2025-12-15
 */

export interface ReportSection {
  /** Heading text (e.g., "## Details") */
  heading: string;
  /** Heading level (1-6) */
  level: number;
  /** Start position in content */
  startPos: number;
  /** End position (start of next section or EOF) */
  endPos: number;
  /** Line number (1-indexed) */
  line: number;
}

export interface EditResult {
  success: boolean;
  error?: string;
  /** Content after edit */
  content: string;
}

/**
 * ReportEditor for incremental markdown editing
 */
export class ReportEditor {
  private content: string = '';
  private sectionCache: ReportSection[] = [];
  private cacheValid: boolean = false;

  constructor(initialContent: string = '') {
    this.content = initialContent;
  }

  // ============================================
  // Read Operations
  // ============================================

  /**
   * Get current report content
   */
  getContent(): string {
    return this.content;
  }

  /**
   * Get report length in characters
   */
  getLength(): number {
    return this.content.length;
  }

  /**
   * Check if report is empty
   */
  isEmpty(): boolean {
    return this.content.trim() === '';
  }

  /**
   * Get all sections in the report
   */
  getSections(): ReportSection[] {
    this.ensureSectionCache();
    return [...this.sectionCache];
  }

  /**
   * Find a section by heading (partial match, case-insensitive)
   */
  findSection(heading: string): ReportSection | undefined {
    this.ensureSectionCache();
    const normalized = this.normalizeHeading(heading).toLowerCase();
    return this.sectionCache.find(s =>
      this.normalizeHeading(s.heading).toLowerCase().includes(normalized) ||
      normalized.includes(this.normalizeHeading(s.heading).toLowerCase())
    );
  }

  // ============================================
  // Write Operations
  // ============================================

  /**
   * Set full report content (use for initial draft)
   */
  setReport(content: string): EditResult {
    this.content = content;
    this.invalidateCache();
    return { success: true, content: this.content };
  }

  /**
   * Search and replace text in report
   * @param oldText Text to find
   * @param newText Replacement text
   * @param replaceAll Replace all occurrences (default: false)
   */
  replace(oldText: string, newText: string, replaceAll: boolean = false): EditResult {
    if (!oldText) {
      return { success: false, error: 'old_text cannot be empty', content: this.content };
    }

    if (!this.content.includes(oldText)) {
      return {
        success: false,
        error: `Text not found: "${oldText.substring(0, 50)}${oldText.length > 50 ? '...' : ''}"`,
        content: this.content
      };
    }

    if (replaceAll) {
      this.content = this.content.split(oldText).join(newText);
    } else {
      this.content = this.content.replace(oldText, newText);
    }

    this.invalidateCache();
    return { success: true, content: this.content };
  }

  /**
   * Append content to end of report
   */
  append(text: string): EditResult {
    if (!text) {
      return { success: false, error: 'text cannot be empty', content: this.content };
    }

    // Ensure proper spacing
    const trimmedContent = this.content.trimEnd();
    const needsNewlines = trimmedContent.length > 0 && !trimmedContent.endsWith('\n\n');

    this.content = trimmedContent + (needsNewlines ? '\n\n' : '') + text;
    this.invalidateCache();
    return { success: true, content: this.content };
  }

  /**
   * Insert content after a heading
   * @param heading The heading to insert after (e.g., "## Summary")
   * @param content Content to insert
   */
  insertAfterHeading(heading: string, content: string): EditResult {
    if (!heading || !content) {
      return { success: false, error: 'heading and content are required', content: this.content };
    }

    const section = this.findSection(heading);
    if (!section) {
      return {
        success: false,
        error: `Heading not found: "${heading}"`,
        content: this.content
      };
    }

    // Find the end of the heading line
    const headingEndPos = this.content.indexOf('\n', section.startPos);
    if (headingEndPos === -1) {
      // Heading is at end of file
      this.content = this.content + '\n\n' + content;
    } else {
      // Insert after heading line
      this.content =
        this.content.slice(0, headingEndPos) +
        '\n\n' + content +
        this.content.slice(headingEndPos);
    }

    this.invalidateCache();
    return { success: true, content: this.content };
  }

  /**
   * Replace entire section (heading + content until next same-level heading)
   * @param heading The section heading to replace
   * @param newContent New content for the section (heading will be preserved)
   * @param includeHeading If true, newContent should include the heading
   */
  replaceSection(heading: string, newContent: string, includeHeading: boolean = false): EditResult {
    if (!heading) {
      return { success: false, error: 'heading is required', content: this.content };
    }

    const section = this.findSection(heading);
    if (!section) {
      return {
        success: false,
        error: `Section not found: "${heading}"`,
        content: this.content
      };
    }

    // Build replacement content
    let replacement: string;
    if (includeHeading) {
      replacement = newContent;
    } else {
      // Preserve original heading
      replacement = section.heading + '\n\n' + newContent;
    }

    // Ensure proper spacing
    if (!replacement.endsWith('\n')) {
      replacement += '\n';
    }

    // Replace section
    this.content =
      this.content.slice(0, section.startPos) +
      replacement +
      this.content.slice(section.endPos);

    this.invalidateCache();
    return { success: true, content: this.content };
  }

  /**
   * Delete a section
   */
  deleteSection(heading: string): EditResult {
    const section = this.findSection(heading);
    if (!section) {
      return {
        success: false,
        error: `Section not found: "${heading}"`,
        content: this.content
      };
    }

    this.content =
      this.content.slice(0, section.startPos) +
      this.content.slice(section.endPos);

    // Clean up extra newlines
    this.content = this.content.replace(/\n{3,}/g, '\n\n').trim();

    this.invalidateCache();
    return { success: true, content: this.content };
  }

  /**
   * Insert a new section (heading + content)
   * @param heading Full heading including # marks
   * @param content Section content
   * @param afterHeading Optional: insert after this heading. If not specified, appends to end.
   */
  insertSection(heading: string, content: string, afterHeading?: string): EditResult {
    const fullSection = heading + '\n\n' + content;

    if (afterHeading) {
      const result = this.insertAfterHeading(afterHeading, '');
      if (!result.success) {
        return result;
      }
      // Now insert the section after the heading
      const section = this.findSection(afterHeading);
      if (section) {
        // Insert at end of the target section
        this.content =
          this.content.slice(0, section.endPos) +
          '\n' + fullSection + '\n' +
          this.content.slice(section.endPos);
        this.invalidateCache();
        return { success: true, content: this.content };
      }
    }

    // Append to end
    return this.append(fullSection);
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Invalidate the section cache
   */
  private invalidateCache(): void {
    this.cacheValid = false;
  }

  /**
   * Rebuild section cache if needed
   */
  private ensureSectionCache(): void {
    if (this.cacheValid) return;

    this.sectionCache = [];
    const lines = this.content.split('\n');
    const headingRegex = /^(#{1,6})\s+(.+)$/;

    let currentPos = 0;
    const headings: Array<{ heading: string; level: number; startPos: number; line: number }> = [];

    // First pass: find all headings
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(headingRegex);

      if (match) {
        headings.push({
          heading: line,
          level: match[1].length,
          startPos: currentPos,
          line: i + 1,
        });
      }

      currentPos += line.length + 1; // +1 for newline
    }

    // Second pass: determine section boundaries
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      let endPos = this.content.length;

      // Find next heading of same or higher level
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].level <= h.level) {
          endPos = headings[j].startPos;
          break;
        }
      }

      this.sectionCache.push({
        heading: h.heading,
        level: h.level,
        startPos: h.startPos,
        endPos,
        line: h.line,
      });
    }

    this.cacheValid = true;
  }

  /**
   * Normalize heading for comparison
   */
  private normalizeHeading(heading: string): string {
    return heading.trim().replace(/\s+/g, ' ');
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get a preview of the report (first N characters)
   */
  getPreview(maxLength: number = 500): string {
    if (this.content.length <= maxLength) {
      return this.content;
    }
    return this.content.slice(0, maxLength) + '...';
  }

  /**
   * Get word count
   */
  getWordCount(): number {
    return this.content
      .split(/\s+/)
      .filter(word => word.length > 0)
      .length;
  }

  /**
   * Clone the editor with current content
   */
  clone(): ReportEditor {
    return new ReportEditor(this.content);
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a new ReportEditor
 */
export function createReportEditor(initialContent: string = ''): ReportEditor {
  return new ReportEditor(initialContent);
}
