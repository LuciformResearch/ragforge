import TikaServer from '@nisyaban/tika-server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Document metadata extracted by Tika
 */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  createdAt?: Date;
  modifiedAt?: Date;
  contentType?: string;
  language?: string;
  pageCount?: number;
  wordCount?: number;
  [key: string]: unknown;
}

/**
 * Result of parsing a document
 */
export interface ParsedDocument {
  /** Original file path */
  filePath: string;
  /** File name without path */
  fileName: string;
  /** File extension (lowercase, without dot) */
  extension: string;
  /** Extracted text content */
  content: string;
  /** Document metadata */
  metadata: DocumentMetadata;
  /** Content hash for change detection */
  contentHash: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Tika parser configuration
 */
export interface TikaParserConfig {
  /** Path to custom Tika config XML (enables OCR, etc.) */
  configPath?: string;
  /** Request timeout in ms (default: 60000) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * TikaParser - Wrapper around Tika Server for document parsing
 *
 * Handles:
 * - Starting/stopping Tika server
 * - Text extraction from any document format
 * - Metadata extraction
 * - OCR for images (when configured)
 */
export class TikaParser {
  private server: TikaServer | null = null;
  private config: TikaParserConfig;
  private isStarted = false;

  constructor(config: TikaParserConfig = {}) {
    this.config = {
      timeout: 60000,
      debug: false,
      ...config,
    };
  }

  /**
   * Start the Tika server (must be called before parsing)
   */
  async start(): Promise<void> {
    if (this.isStarted) return;

    const serverOptions: Record<string, unknown> = {};

    if (this.config.configPath) {
      serverOptions.tikaConfig = this.config.configPath;
    }

    this.server = new TikaServer(serverOptions);

    if (this.config.debug) {
      this.server.on('debug', (msg: string) => {
        console.log('[TikaParser]', msg);
      });
    }

    await this.server.start();
    this.isStarted = true;
  }

  /**
   * Stop the Tika server
   */
  async stop(): Promise<void> {
    if (!this.isStarted || !this.server) return;

    await this.server.stop();
    this.server = null;
    this.isStarted = false;
  }

  /**
   * Parse a document and extract text + metadata
   */
  async parse(filePath: string): Promise<ParsedDocument> {
    if (!this.isStarted || !this.server) {
      throw new Error('TikaParser not started. Call start() first.');
    }

    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    const fileContent = fs.readFileSync(absolutePath);
    const fileName = path.basename(absolutePath);
    const extension = path.extname(fileName).toLowerCase().slice(1);
    const stats = fs.statSync(absolutePath);

    // Extract text
    const content = await this.server.queryText(fileContent, {
      filename: fileName,
    });

    // Extract metadata
    const rawMetadata = await this.server.queryMeta(fileContent, {
      filename: fileName,
    });

    const metadata = this.normalizeMetadata(rawMetadata);

    // Calculate content hash for change detection
    const contentHash = this.hashContent(content);

    return {
      filePath: absolutePath,
      fileName,
      extension,
      content: content.trim(),
      metadata,
      contentHash,
      fileSize: stats.size,
    };
  }

  /**
   * Parse multiple documents
   */
  async parseMany(filePaths: string[], onProgress?: (current: number, total: number, file: string) => void): Promise<ParsedDocument[]> {
    const results: ParsedDocument[] = [];
    const total = filePaths.length;

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];

      if (onProgress) {
        onProgress(i + 1, total, filePath);
      }

      try {
        const doc = await this.parse(filePath);
        results.push(doc);
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error);
        // Continue with other files
      }
    }

    return results;
  }

  /**
   * Check if a file extension is supported
   */
  static isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Normalize Tika metadata to our format
   */
  private normalizeMetadata(raw: Record<string, unknown>): DocumentMetadata {
    const metadata: DocumentMetadata = {};

    // Title
    metadata.title = this.extractFirst(raw, [
      'dc:title',
      'title',
      'pdf:docinfo:title',
      'meta:title',
    ]);

    // Author
    metadata.author = this.extractFirst(raw, [
      'dc:creator',
      'Author',
      'meta:author',
      'pdf:docinfo:author',
      'creator',
    ]);

    // Content type
    metadata.contentType = this.extractFirst(raw, [
      'Content-Type',
      'content-type',
    ]);

    // Language
    metadata.language = this.extractFirst(raw, [
      'language',
      'dc:language',
    ]);

    // Page count
    const pageCount = this.extractFirst(raw, [
      'xmpTPg:NPages',
      'meta:page-count',
      'Page-Count',
    ]);
    if (pageCount) {
      metadata.pageCount = parseInt(pageCount, 10) || undefined;
    }

    // Word count
    const wordCount = this.extractFirst(raw, [
      'meta:word-count',
      'Word-Count',
    ]);
    if (wordCount) {
      metadata.wordCount = parseInt(wordCount, 10) || undefined;
    }

    // Created date
    const created = this.extractFirst(raw, [
      'dcterms:created',
      'meta:creation-date',
      'Creation-Date',
      'created',
    ]);
    if (created) {
      metadata.createdAt = new Date(created);
    }

    // Modified date
    const modified = this.extractFirst(raw, [
      'dcterms:modified',
      'Last-Modified',
      'modified',
    ]);
    if (modified) {
      metadata.modifiedAt = new Date(modified);
    }

    return metadata;
  }

  /**
   * Extract first matching value from metadata
   */
  private extractFirst(raw: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = raw[key];
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
    return undefined;
  }

  /**
   * Simple hash function for content
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Supported file extensions
 */
export const SUPPORTED_EXTENSIONS = new Set([
  // Documents
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.txt',
  '.md',
  '.html',
  '.htm',
  '.xml',
  // Presentations
  '.ppt',
  '.pptx',
  '.odp',
  // Spreadsheets
  '.xls',
  '.xlsx',
  '.ods',
  '.csv',
  // Ebooks
  '.epub',
  // Email
  '.eml',
  '.msg',
  // Images (OCR)
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif',
  '.bmp',
  '.gif',
]);
