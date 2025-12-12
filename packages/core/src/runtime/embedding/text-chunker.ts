/**
 * Text Chunker for Embedding
 *
 * Splits large text into overlapping chunks for better embedding coverage.
 * Uses paragraph and sentence boundaries for natural splits.
 */

export interface ChunkOptions {
  /** Target chunk size in characters (default: 2000) */
  chunkSize?: number;
  /** Overlap between chunks in characters (default: 200) */
  overlap?: number;
  /** Minimum chunk size to keep (default: 100) */
  minChunkSize?: number;
  /** Strategy for splitting: 'paragraph' | 'sentence' | 'fixed' (default: 'paragraph') */
  strategy?: 'paragraph' | 'sentence' | 'fixed';
}

export interface TextChunk {
  /** Chunk text content */
  text: string;
  /** Chunk index (0-based) */
  index: number;
  /** Start character position in original text */
  startChar: number;
  /** End character position in original text */
  endChar: number;
  /** Start line number (1-based) */
  startLine: number;
  /** End line number (1-based) */
  endLine: number;
}

const DEFAULT_CHUNK_SIZE = 2000;
const DEFAULT_OVERLAP = 200;
const DEFAULT_MIN_CHUNK_SIZE = 100;

/**
 * Build a map of character position to line number
 */
function buildLineMap(text: string): { charToLine: number[]; lineStarts: number[] } {
  const charToLine: number[] = new Array(text.length + 1);
  const lineStarts: number[] = [0];
  let currentLine = 1;

  for (let i = 0; i < text.length; i++) {
    charToLine[i] = currentLine;
    if (text[i] === '\n') {
      currentLine++;
      lineStarts.push(i + 1);
    }
  }
  charToLine[text.length] = currentLine;

  return { charToLine, lineStarts };
}

/**
 * Get line number for a character position
 */
function getLineForChar(charPos: number, charToLine: number[]): number {
  return charToLine[Math.min(charPos, charToLine.length - 1)] || 1;
}

/**
 * Split text into overlapping chunks using natural boundaries
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    overlap = DEFAULT_OVERLAP,
    minChunkSize = DEFAULT_MIN_CHUNK_SIZE,
    strategy = 'paragraph',
  } = options;

  // Build line mapping for the entire text
  const { charToLine } = buildLineMap(text);

  // If text is small enough, return as single chunk
  if (text.length <= chunkSize) {
    const endLine = getLineForChar(text.length, charToLine);
    return [{
      text,
      index: 0,
      startChar: 0,
      endChar: text.length,
      startLine: 1,
      endLine,
    }];
  }

  // Split into segments based on strategy
  const segments = splitIntoSegments(text, strategy);

  // Build chunks from segments with overlap
  const rawChunks = buildChunksFromSegments(segments, {
    chunkSize,
    overlap,
    minChunkSize,
  });

  // Add line numbers to chunks
  return rawChunks.map(chunk => ({
    ...chunk,
    startLine: getLineForChar(chunk.startChar, charToLine),
    endLine: getLineForChar(chunk.endChar - 1, charToLine), // -1 because endChar is exclusive
  }));
}

/**
 * Split text into natural segments (paragraphs or sentences)
 */
function splitIntoSegments(text: string, strategy: 'paragraph' | 'sentence' | 'fixed'): string[] {
  if (strategy === 'fixed') {
    // Just return the whole text, will be split by size later
    return [text];
  }

  if (strategy === 'paragraph') {
    // Split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\s*\n/);

    // If paragraphs are still too large, split them into sentences
    const result: string[] = [];
    for (const para of paragraphs) {
      if (para.length > DEFAULT_CHUNK_SIZE * 1.5) {
        // Split large paragraph into sentences
        result.push(...splitIntoSentences(para));
      } else if (para.trim()) {
        result.push(para);
      }
    }
    return result;
  }

  // Sentence strategy
  return splitIntoSentences(text);
}

/**
 * Split text into sentences
 */
function splitIntoSentences(text: string): string[] {
  // Regex to split on sentence boundaries while preserving the delimiter
  // Handles: . ! ? followed by space or newline
  // Avoids splitting on: abbreviations (Mr., Dr., etc.), decimals, URLs
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\s*\n/g;

  const sentences = text.split(sentenceRegex);

  // Filter empty and combine very short sentences
  const result: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (buffer.length + trimmed.length < 100) {
      // Combine short sentences
      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
    } else {
      if (buffer) {
        result.push(buffer);
      }
      buffer = trimmed;
    }
  }

  if (buffer) {
    result.push(buffer);
  }

  return result;
}

/** Raw chunk without line numbers (internal use) */
interface RawChunk {
  text: string;
  index: number;
  startChar: number;
  endChar: number;
}

/**
 * Build overlapping chunks from segments
 */
function buildChunksFromSegments(
  segments: string[],
  options: { chunkSize: number; overlap: number; minChunkSize: number }
): RawChunk[] {
  const { chunkSize, overlap, minChunkSize } = options;
  const chunks: RawChunk[] = [];

  let currentChunk = '';
  let currentStartChar = 0;
  let globalOffset = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentWithSpace = currentChunk ? '\n\n' + segment : segment;

    // Check if adding this segment would exceed chunk size
    if (currentChunk.length + segmentWithSpace.length > chunkSize && currentChunk.length >= minChunkSize) {
      // Save current chunk
      chunks.push({
        text: currentChunk,
        index: chunks.length,
        startChar: currentStartChar,
        endChar: currentStartChar + currentChunk.length,
      });

      // Start new chunk with overlap
      // Find overlap text from the end of current chunk
      const overlapText = getOverlapText(currentChunk, overlap);
      currentStartChar = currentStartChar + currentChunk.length - overlapText.length;
      currentChunk = overlapText + (overlapText ? '\n\n' : '') + segment;
    } else {
      // Add segment to current chunk
      currentChunk += segmentWithSpace;
    }

    globalOffset += segment.length + (i < segments.length - 1 ? 2 : 0); // +2 for \n\n
  }

  // Don't forget the last chunk
  if (currentChunk.length >= minChunkSize) {
    chunks.push({
      text: currentChunk,
      index: chunks.length,
      startChar: currentStartChar,
      endChar: currentStartChar + currentChunk.length,
    });
  } else if (chunks.length > 0) {
    // Append to previous chunk if too small
    const lastChunk = chunks[chunks.length - 1];
    lastChunk.text += '\n\n' + currentChunk;
    lastChunk.endChar = lastChunk.startChar + lastChunk.text.length;
  } else if (currentChunk.trim()) {
    // Even if small, keep it if it's the only content
    chunks.push({
      text: currentChunk,
      index: 0,
      startChar: 0,
      endChar: currentChunk.length,
    });
  }

  return chunks;
}

/**
 * Get overlap text from the end of a chunk
 * Tries to break at natural boundaries (sentence, paragraph)
 */
function getOverlapText(text: string, targetLength: number): string {
  if (text.length <= targetLength) {
    return text;
  }

  // Start from the position where we want overlap to begin
  const startPos = text.length - targetLength;
  let overlapStart = startPos;

  // Look for natural break points after startPos
  // Priority: paragraph > sentence > word

  // Look for paragraph break
  const paragraphBreak = text.indexOf('\n\n', startPos);
  if (paragraphBreak !== -1 && paragraphBreak < startPos + targetLength / 2) {
    overlapStart = paragraphBreak + 2;
  } else {
    // Look for sentence break
    const sentenceMatch = text.slice(startPos).match(/[.!?]\s+/);
    if (sentenceMatch && sentenceMatch.index !== undefined) {
      overlapStart = startPos + sentenceMatch.index + sentenceMatch[0].length;
    } else {
      // Look for word break
      const wordBreak = text.indexOf(' ', startPos);
      if (wordBreak !== -1) {
        overlapStart = wordBreak + 1;
      }
    }
  }

  return text.slice(overlapStart);
}

/**
 * Check if text needs chunking based on size threshold
 */
export function needsChunking(text: string, threshold: number = DEFAULT_CHUNK_SIZE): boolean {
  return text.length > threshold;
}

/**
 * Estimate number of chunks for a text
 */
export function estimateChunkCount(
  textLength: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): number {
  if (textLength <= chunkSize) return 1;
  const effectiveSize = chunkSize - overlap;
  return Math.ceil((textLength - overlap) / effectiveSize);
}
