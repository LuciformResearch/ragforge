import { v4 as uuidv4 } from 'uuid';

/**
 * A chunk of text from a document
 */
export interface Chunk {
  /** Unique identifier */
  uuid: string;
  /** Text content */
  content: string;
  /** Index in the document (0-based) */
  index: number;
  /** Start character position in original text */
  startChar: number;
  /** End character position in original text */
  endChar: number;
  /** Word count */
  wordCount: number;
  /** Reference to source document path */
  sourcePath: string;
}

/**
 * Chunker configuration
 */
export interface ChunkerConfig {
  /** Target chunk size in characters (default: 1000) */
  chunkSize?: number;
  /** Overlap between chunks in characters (default: 200) */
  chunkOverlap?: number;
  /** Strategy: 'simple' | 'sentence' | 'paragraph' (default: 'sentence') */
  strategy?: 'simple' | 'sentence' | 'paragraph';
  /** Minimum chunk size - won't create chunks smaller than this (default: 100) */
  minChunkSize?: number;
}

const DEFAULT_CONFIG: Required<ChunkerConfig> = {
  chunkSize: 1000,
  chunkOverlap: 200,
  strategy: 'sentence',
  minChunkSize: 100,
};

/**
 * Chunker - Split text into overlapping chunks
 *
 * Strategies:
 * - simple: Split at exact character positions
 * - sentence: Split at sentence boundaries (., !, ?)
 * - paragraph: Split at paragraph boundaries (\n\n)
 */
export class Chunker {
  private config: Required<ChunkerConfig>;

  constructor(config: ChunkerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Split text into chunks
   */
  chunk(text: string, sourcePath: string): Chunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Normalize whitespace
    const normalizedText = this.normalizeText(text);

    // If text is smaller than minChunkSize, return it as a single chunk
    // We never want to lose content
    if (normalizedText.length < this.config.minChunkSize) {
      return [this.createChunk(normalizedText, 0, 0, normalizedText.length, sourcePath)];
    }

    switch (this.config.strategy) {
      case 'paragraph':
        return this.chunkByParagraph(normalizedText, sourcePath);
      case 'sentence':
        return this.chunkBySentence(normalizedText, sourcePath);
      case 'simple':
      default:
        return this.chunkSimple(normalizedText, sourcePath);
    }
  }

  /**
   * Simple chunking - split at character positions with overlap
   */
  private chunkSimple(text: string, sourcePath: string): Chunk[] {
    const chunks: Chunk[] = [];
    const { chunkSize, chunkOverlap } = this.config;

    let start = 0;
    let index = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.slice(start, end);

      if (content.trim().length >= this.config.minChunkSize) {
        chunks.push(this.createChunk(content, index, start, end, sourcePath));
        index++;
      }

      // Move start position, accounting for overlap
      start = end - chunkOverlap;

      // Prevent infinite loop
      if (start >= text.length - this.config.minChunkSize) {
        break;
      }
    }

    return chunks;
  }

  /**
   * Sentence-aware chunking - try to break at sentence boundaries
   */
  private chunkBySentence(text: string, sourcePath: string): Chunk[] {
    const chunks: Chunk[] = [];
    const { chunkSize, chunkOverlap } = this.config;

    // Split into sentences
    const sentences = this.splitIntoSentences(text);

    let currentChunk = '';
    let currentStart = 0;
    let chunkStartChar = 0;
    let index = 0;

    for (const sentence of sentences) {
      // If adding this sentence exceeds chunk size, save current chunk
      if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
        const endChar = chunkStartChar + currentChunk.length;

        if (currentChunk.trim().length >= this.config.minChunkSize) {
          chunks.push(this.createChunk(currentChunk.trim(), index, chunkStartChar, endChar, sourcePath));
          index++;
        }

        // Start new chunk with overlap
        const overlapText = this.getOverlapFromEnd(currentChunk, chunkOverlap);
        currentChunk = overlapText + sentence;
        chunkStartChar = endChar - overlapText.length;
      } else {
        currentChunk += sentence;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length >= this.config.minChunkSize) {
      chunks.push(this.createChunk(
        currentChunk.trim(),
        index,
        chunkStartChar,
        chunkStartChar + currentChunk.length,
        sourcePath
      ));
    }

    return chunks;
  }

  /**
   * Paragraph-aware chunking - try to break at paragraph boundaries
   */
  private chunkByParagraph(text: string, sourcePath: string): Chunk[] {
    const chunks: Chunk[] = [];
    const { chunkSize, chunkOverlap } = this.config;

    // Split into paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    let currentChunk = '';
    let chunkStartChar = 0;
    let currentPos = 0;
    let index = 0;

    for (const paragraph of paragraphs) {
      const trimmedPara = paragraph.trim();

      // If adding this paragraph exceeds chunk size, save current chunk
      if (currentChunk.length + trimmedPara.length + 2 > chunkSize && currentChunk.length > 0) {
        if (currentChunk.trim().length >= this.config.minChunkSize) {
          chunks.push(this.createChunk(
            currentChunk.trim(),
            index,
            chunkStartChar,
            chunkStartChar + currentChunk.length,
            sourcePath
          ));
          index++;
        }

        // Start new chunk with overlap
        const overlapText = this.getOverlapFromEnd(currentChunk, chunkOverlap);
        currentChunk = overlapText + trimmedPara + '\n\n';
        chunkStartChar = currentPos - overlapText.length;
      } else {
        if (currentChunk.length === 0) {
          chunkStartChar = currentPos;
        }
        currentChunk += trimmedPara + '\n\n';
      }

      currentPos += paragraph.length + 2; // +2 for \n\n
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length >= this.config.minChunkSize) {
      chunks.push(this.createChunk(
        currentChunk.trim(),
        index,
        chunkStartChar,
        chunkStartChar + currentChunk.length,
        sourcePath
      ));
    }

    return chunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Match sentences ending with . ! ? followed by space or end
    // Keep the delimiter with the sentence
    const sentenceRegex = /[^.!?]*[.!?]+[\s]*/g;
    const sentences: string[] = [];
    let match;
    let lastIndex = 0;

    while ((match = sentenceRegex.exec(text)) !== null) {
      sentences.push(match[0]);
      lastIndex = sentenceRegex.lastIndex;
    }

    // Add remaining text if any
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining.trim().length > 0) {
        sentences.push(remaining);
      }
    }

    return sentences;
  }

  /**
   * Get overlap text from end of string
   */
  private getOverlapFromEnd(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) {
      return text;
    }

    // Try to break at word boundary
    const overlapStart = text.length - overlapSize;
    const spaceIndex = text.indexOf(' ', overlapStart);

    if (spaceIndex !== -1 && spaceIndex < text.length - 10) {
      return text.slice(spaceIndex + 1);
    }

    return text.slice(overlapStart);
  }

  /**
   * Normalize text - clean up whitespace
   */
  private normalizeText(text: string): string {
    return text
      // Replace multiple spaces with single space
      .replace(/[ \t]+/g, ' ')
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      // Remove excessive newlines (more than 2)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Create a chunk object
   */
  private createChunk(
    content: string,
    index: number,
    startChar: number,
    endChar: number,
    sourcePath: string
  ): Chunk {
    return {
      uuid: uuidv4(),
      content,
      index,
      startChar,
      endChar,
      wordCount: this.countWords(content),
      sourcePath,
    };
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }
}

/**
 * Convenience function - chunk text with default settings
 */
export function chunkText(text: string, sourcePath: string, config?: ChunkerConfig): Chunk[] {
  const chunker = new Chunker(config);
  return chunker.chunk(text, sourcePath);
}
