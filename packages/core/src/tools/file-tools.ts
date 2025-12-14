/**
 * File Tools - Read, Write, Edit files with change tracking
 *
 * Inspired by OpenCode's file tools but integrated with RagForge's
 * ChangeTracker for tracking modifications in the code graph.
 *
 * @see https://github.com/sst/opencode/tree/main/packages/opencode/src/tool
 */

import type {
  GeneratedToolDefinition,
  ToolHandlerGenerator,
  ToolGenerationContext,
} from './types/index.js';
import { createTwoFilesPatch } from 'diff';
import { distance as levenshtein } from 'fastest-levenshtein';
import type { IngestionLock } from './ingestion-lock.js';
import { isDocumentFile, parseDocumentFile, type DocumentFileInfo } from '../runtime/adapters/document-file-parser.js';

// Image and document extensions for delegation
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

// ============================================
// Constants
// ============================================

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

// ============================================
// Tool Definitions
// ============================================

/**
 * Generate read_file tool
 */
export function generateReadFileTool(): GeneratedToolDefinition {
  return {
    name: 'read_file',
    section: 'file_ops',
    description: `Read file contents with line numbers.

Returns file content with line numbers (format: "00001| content").
Supports pagination with offset and limit for large files.

Parameters:
- path: Absolute or relative file path
- offset: Start line (0-based, optional)
- limit: Max lines to read (default: 2000)

Long lines (>2000 chars) are truncated with "...".
Binary files cannot be read.

Example: read_file({ path: "src/index.ts" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to read (absolute or relative to project root)',
        },
        offset: {
          type: 'number',
          description: 'Start line (0-based). Use for pagination.',
        },
        limit: {
          type: 'number',
          description: 'Max lines to read (default: 2000)',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate write_file tool
 */
export function generateWriteFileTool(): GeneratedToolDefinition {
  return {
    name: 'write_file',
    section: 'file_ops',
    description: `Write content to a file (overwrites if exists).

⚠️ WARNING: This will OVERWRITE existing files without confirmation!
Use create_file if you want to create a NEW file safely.

Creates parent directories if they don't exist.
Returns change_type: 'created' or 'updated' with diff.

Parameters:
- path: Absolute or relative file path
- content: Full file content to write

Example: write_file({ path: "src/utils.ts", content: "export const foo = 1;" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to write (absolute or relative to project root)',
        },
        content: {
          type: 'string',
          description: 'Full file content to write',
        },
      },
      required: ['path', 'content'],
    },
  };
}

/**
 * Generate create_file tool (fails if file exists)
 */
export function generateCreateFileTool(): GeneratedToolDefinition {
  return {
    name: 'create_file',
    section: 'file_ops',
    description: `Create a NEW file (fails if file already exists).

Use this when you want to create a new file and ensure you don't accidentally overwrite an existing one.
If you need to update an existing file, use write_file or edit_file instead.

Creates parent directories if they don't exist.

Parameters:
- path: Absolute or relative file path
- content: Full file content to write

Example: create_file({ path: "src/new-component.ts", content: "export const Component = () => {};" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to create (absolute or relative to project root)',
        },
        content: {
          type: 'string',
          description: 'Full file content to write',
        },
      },
      required: ['path', 'content'],
    },
  };
}

/**
 * Generate edit_file tool
 */
export function generateEditFileTool(): GeneratedToolDefinition {
  return {
    name: 'edit_file',
    section: 'file_ops',
    description: `Edit a file using search/replace OR line numbers.

**Method 1: Search/Replace**
- old_string: Text to find and replace (line number prefixes like "00001| " are auto-stripped)
- new_string: Replacement text

**Method 2: Line Numbers**
- start_line: First line to replace (1-based, from read_file output)
- end_line: Last line to replace (inclusive)
- new_string: New content for those lines

**Method 3: Append**
- append: true (adds new_string at the end of the file)
- new_string: Content to append

Tips:
- You can copy text directly from read_file output - line prefixes are auto-removed
- Use read_file first to see current content and line numbers
- Provide enough context for unique matching
- To add content at the end, use append: true

Examples:
  # Search/replace (line prefixes auto-stripped)
  edit_file({ path: "src/index.ts", old_string: "00005| const x = 1;", new_string: "const x = 2;" })

  # By line numbers
  edit_file({ path: "src/index.ts", start_line: 5, end_line: 7, new_string: "// replaced content" })

  # Append to end of file
  edit_file({ path: "src/index.ts", append: true, new_string: "export function newFunc() {}" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to edit',
        },
        old_string: {
          type: 'string',
          description: 'Text to find and replace (line number prefixes auto-stripped)',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text (or content to append if append=true)',
        },
        start_line: {
          type: 'number',
          description: 'First line to replace (1-based). Use with end_line instead of old_string.',
        },
        end_line: {
          type: 'number',
          description: 'Last line to replace (1-based, inclusive).',
        },
        append: {
          type: 'boolean',
          description: 'If true, append new_string to end of file instead of replacing',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)',
        },
      },
      required: ['path', 'new_string'],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export interface FileToolsContext {
  /**
   * Project root directory (for relative paths)
   * Can be a string or a getter function for dynamic resolution
   */
  projectRoot: string | (() => string | null);
  /** ChangeTracker instance (optional, for tracking changes) */
  changeTracker?: any;
  /** Callback after file modification (for re-ingestion)
   * Can return ingestion stats or queue info */
  onFileModified?: (filePath: string, changeType: 'created' | 'updated' | 'deleted') => Promise<any>;
  /** Callback after file is accessed (read)
   * Used for touched-files tracking to create File nodes for files outside projects */
  onFileAccessed?: (filePath: string) => Promise<void>;
  /** Ingestion lock for coordinating with RAG tools (deprecated - lock is now managed by BrainManager) */
  ingestionLock?: IngestionLock;
}

/**
 * Helper to resolve projectRoot from context (handles both string and getter)
 */
function getProjectRoot(ctx: FileToolsContext): string | null {
  if (typeof ctx.projectRoot === 'function') {
    return ctx.projectRoot();
  }
  return ctx.projectRoot;
}

/**
 * Generate handler for read_file
 */
export function generateReadFileHandler(ctx: FileToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: filePath, offset = 0, limit = DEFAULT_READ_LIMIT } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Get dynamic project root
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.join(projectRoot, filePath);

    // Check file exists
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `File not found: ${absolutePath}` };
      }
      throw err;
    }

    // Get file extension
    const ext = pathModule.extname(absolutePath).toLowerCase();

    // Check if it's a document file (PDF, DOCX, XLSX, CSV)
    if (isDocumentFile(absolutePath)) {
      try {
        // Import Gemini Vision fallback for low-confidence OCR
        const { getOCRService } = await import('../runtime/index.js');
        const ocrService = getOCRService({ primaryProvider: 'gemini' });

        const geminiVisionFallback = ocrService.isAvailable()
          ? async (imageBuffer: Buffer, prompt: string): Promise<string> => {
              const result = await ocrService.extractTextFromData(imageBuffer, 'image/png', { prompt });
              if (result.error) throw new Error(result.error);
              return result.text || '';
            }
          : undefined;

        const docInfo = await parseDocumentFile(absolutePath, {
          extractText: true,
          useOcr: true,
          geminiVisionFallback,
        });

        if (!docInfo) {
          return { error: `Failed to parse document: ${absolutePath}` };
        }

        // Notify touched-files tracker (non-blocking)
        if (ctx.onFileAccessed) {
          ctx.onFileAccessed(absolutePath).catch((err: Error) => {
            console.error('[FileTools] onFileAccessed error:', err.message);
          });
        }

        return {
          path: filePath,
          absolute_path: absolutePath,
          format: docInfo.format,
          page_count: docInfo.pageCount,
          extraction_method: docInfo.extractionMethod,
          ocr_confidence: docInfo.ocrConfidence,
          has_full_text: docInfo.hasFullText,
          needs_gemini_vision: docInfo.needsGeminiVision,
          metadata: docInfo.metadata,
          content: docInfo.textContent || '(No text extracted)',
        };
      } catch (err: any) {
        return { error: `Document parsing error: ${err.message}` };
      }
    }

    // Check if it's an image file
    if (IMAGE_EXTENSIONS.has(ext)) {
      try {
        const { getOCRService } = await import('../runtime/index.js');
        const ocrService = getOCRService(); // Use default provider (Tesseract, fallback to Gemini)

        if (!ocrService.isAvailable()) {
          return { error: `OCR service not available for image: ${absolutePath}` };
        }

        const result = await ocrService.extractText(absolutePath);

        // Notify touched-files tracker (non-blocking)
        if (ctx.onFileAccessed) {
          ctx.onFileAccessed(absolutePath).catch((err: Error) => {
            console.error('[FileTools] onFileAccessed error:', err.message);
          });
        }

        return {
          path: filePath,
          absolute_path: absolutePath,
          format: 'image',
          extraction_method: result.provider,
          ocr_confidence: result.confidence,
          content: result.text || '(No text extracted from image)',
          processing_time_ms: result.processingTimeMs,
        };
      } catch (err: any) {
        return { error: `Image OCR error: ${err.message}` };
      }
    }

    // Check if other binary file
    if (await isBinaryFile(absolutePath)) {
      return { error: `Cannot read binary file: ${absolutePath}. Supported binary formats: PDF, DOCX, XLSX, XLS, CSV, PNG, JPG, JPEG, GIF, WEBP, BMP, SVG` };
    }

    // Read text file
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    // Apply offset and limit
    const selectedLines = lines.slice(offset, offset + limit);
    const formattedLines = selectedLines.map((line, index) => {
      const lineNum = (index + offset + 1).toString().padStart(5, '0');
      const truncatedLine = line.length > MAX_LINE_LENGTH
        ? line.substring(0, MAX_LINE_LENGTH) + '...'
        : line;
      return `${lineNum}| ${truncatedLine}`;
    });

    const lastReadLine = offset + selectedLines.length;
    const hasMoreLines = totalLines > lastReadLine;

    let output = formattedLines.join('\n');
    if (hasMoreLines) {
      output += `\n\n(File has more lines. Use offset=${lastReadLine} to continue. Total: ${totalLines} lines)`;
    } else {
      output += `\n\n(End of file - ${totalLines} lines)`;
    }

    // Notify touched-files tracker (non-blocking)
    if (ctx.onFileAccessed) {
      ctx.onFileAccessed(absolutePath).catch((err: Error) => {
        console.error('[FileTools] onFileAccessed error:', err.message);
      });
    }

    return {
      path: filePath,
      absolute_path: absolutePath,
      total_lines: totalLines,
      lines_read: selectedLines.length,
      offset,
      has_more: hasMoreLines,
      content: output,
    };
  };
}

/**
 * Generate handler for write_file
 */
export function generateWriteFileHandler(ctx: FileToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: filePath, content } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const crypto = await import('crypto');

    // Get dynamic project root
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.join(projectRoot, filePath);

    // Note: No lock acquisition here - ingestion is queued and processed async
    // The lock is acquired by BrainManager.flushAgentEditQueue() when processing
    // brain_search waits for pending edits via waitForPendingEdits()

    // Check if file exists (for change tracking)
    let oldContent: string | null = null;
    let oldHash: string | null = null;
    let changeType: 'created' | 'updated' = 'created';

    try {
      oldContent = await fs.readFile(absolutePath, 'utf-8');
      oldHash = crypto.createHash('sha256').update(oldContent).digest('hex').substring(0, 16);
      changeType = 'updated';
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
      // File doesn't exist, will be created
    }

    // Create parent directories if needed
    const parentDir = pathModule.dirname(absolutePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Write file
    await fs.writeFile(absolutePath, content, 'utf-8');
    const newHash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

    // Track change if ChangeTracker is available
    if (ctx.changeTracker) {
      const relativePath = pathModule.relative(projectRoot, absolutePath);
      try {
        await ctx.changeTracker.trackEntityChange(
          'File',
          `file:${relativePath}`,
          relativePath,
          oldContent,
          content,
          oldHash,
          newHash,
          changeType,
          { source: 'file_tool', tool: 'write_file' }
        );
      } catch (err: any) {
        // ChangeTracker might fail if entity doesn't exist in graph yet
        // That's okay - the file is still written
        console.warn(`ChangeTracker warning: ${err.message}`);
      }
    }

    // Queue for re-ingestion (non-blocking)
    let ingestionStats: any = null;
    if (ctx.onFileModified) {
      ingestionStats = await ctx.onFileModified(absolutePath, changeType);
    }

    // Notify touched-files tracker (non-blocking)
    if (ctx.onFileAccessed) {
      ctx.onFileAccessed(absolutePath).catch((err: Error) => {
        console.error('[FileTools] onFileAccessed error:', err.message);
      });
    }

    // Generate diff for output
    const diff = createTwoFilesPatch(
      filePath,
      filePath,
      oldContent || '',
      content,
      '',
      '',
      { context: 3 }
    );

    // Determine if ingestion was queued or completed immediately
    const wasQueued = ingestionStats?.queued === true;

    return {
      path: filePath,
      absolute_path: absolutePath,
      change_type: changeType,
      lines_written: content.split('\n').length,
      hash: newHash,
      diff: trimDiff(diff),
      rag_synced: !wasQueued && !!ctx.onFileModified,
      rag_queued: wasQueued,
      ingestion_stats: ingestionStats,
      note: wasQueued
        ? '📥 RAG update queued. brain_search will wait for completion.'
        : ctx.onFileModified
          ? '✅ RAG graph updated. You can now query the new content.'
          : '⚠️ RAG graph NOT updated (no re-ingestion configured).',
    };
  };
}

/**
 * Generate create_file handler (fails if file exists)
 */
export function generateCreateFileHandler(ctx: FileToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: filePath, content } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Get dynamic project root
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.join(projectRoot, filePath);

    // Check if file already exists
    try {
      await fs.access(absolutePath);
      return {
        error: `File already exists: ${filePath}. Use write_file to overwrite or edit_file to modify.`,
        suggestion: 'Use write_file if you want to overwrite, or edit_file to modify specific parts.',
      };
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        return { error: `Access error: ${err.message}` };
      }
      // ENOENT = file doesn't exist, which is what we want
    }

    // File doesn't exist, delegate to write_file handler
    const writeHandler = generateWriteFileHandler(ctx);
    return writeHandler(params);
  };
}

/**
 * Strip line number prefixes from text (e.g., "00001| content" -> "content")
 * Handles the format from read_file output
 */
function stripLineNumberPrefixes(text: string): string {
  // Pattern: 5 digits + "| " at the start of each line
  return text.replace(/^\d{5}\| /gm, '');
}

/**
 * Generate handler for edit_file
 */
export function generateEditFileHandler(ctx: FileToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: filePath, new_string, replace_all = false, append = false } = params;
    // Convert null to undefined for proper handling
    const old_string = params.old_string ?? undefined;
    const start_line = params.start_line ?? undefined;
    const end_line = params.end_line ?? undefined;

    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const crypto = await import('crypto');

    // Get dynamic project root
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.join(projectRoot, filePath);

    // Note: No lock acquisition here - ingestion is queued and processed async
    // The lock is acquired by BrainManager.flushAgentEditQueue() when processing
    // brain_search waits for pending edits via waitForPendingEdits()

    // Read existing content
    let oldContent: string;
    try {
      oldContent = await fs.readFile(absolutePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `File not found: ${absolutePath}` };
      }
      throw err;
    }

    const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex').substring(0, 16);

    let newContent: string;

    // Method 3: Append mode
    if (append) {
      const cleanNewString = stripLineNumberPrefixes(new_string);
      // Add newline before if content doesn't end with one
      const separator = oldContent.endsWith('\n') ? '' : '\n';
      newContent = oldContent + separator + cleanNewString;
    }
    // Method 2: Line numbers mode
    else if (start_line !== undefined && end_line !== undefined) {
      const lines = oldContent.split('\n');
      const startIdx = start_line - 1; // Convert to 0-based
      const endIdx = end_line - 1;

      if (startIdx < 0 || startIdx > endIdx) {
        return { error: `Invalid line range: ${start_line}-${end_line}. start_line must be <= end_line.` };
      }

      // Allow appending by using start_line = lines.length + 1
      if (startIdx > lines.length) {
        return { error: `Invalid start_line: ${start_line}. File has ${lines.length} lines. Use append: true to add content at the end.` };
      }

      // Strip line prefixes from new_string too (in case user copied from read_file)
      const cleanNewString = stripLineNumberPrefixes(new_string);

      // Replace the lines (or append if startIdx == lines.length)
      const before = lines.slice(0, startIdx);
      const after = endIdx < lines.length ? lines.slice(endIdx + 1) : [];
      const newLines = cleanNewString.split('\n');

      newContent = [...before, ...newLines, ...after].join('\n');
    }
    // Method 1: Search/replace mode
    else if (old_string !== undefined) {
      // Strip line number prefixes from old_string (user may have copied from read_file)
      const cleanOldString = stripLineNumberPrefixes(old_string);
      // Also strip from new_string for consistency
      const cleanNewString = stripLineNumberPrefixes(new_string);

      if (cleanOldString === cleanNewString) {
        return { error: 'old_string and new_string must be different (after stripping line prefixes)' };
      }

      // Perform replacement with fuzzy matching
      try {
        newContent = replaceWithFuzzyMatch(oldContent, cleanOldString, cleanNewString, replace_all);
      } catch (err: any) {
        return { error: err.message };
      }
    } else {
      return { error: 'Provide one of: old_string (search/replace), start_line+end_line (line mode), or append: true' };
    }

    // Write updated content
    await fs.writeFile(absolutePath, newContent, 'utf-8');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex').substring(0, 16);

    // Track change
    if (ctx.changeTracker) {
      const relativePath = pathModule.relative(projectRoot, absolutePath);
      try {
        await ctx.changeTracker.trackEntityChange(
          'File',
          `file:${relativePath}`,
          relativePath,
          oldContent,
          newContent,
          oldHash,
          newHash,
          'updated',
          { source: 'file_tool', tool: 'edit_file' }
        );
      } catch (err: any) {
        console.warn(`ChangeTracker warning: ${err.message}`);
      }
    }

    // Queue for re-ingestion (non-blocking)
    let ingestionStats: any = null;
    if (ctx.onFileModified) {
      ingestionStats = await ctx.onFileModified(absolutePath, 'updated');
    }

    // Notify touched-files tracker (non-blocking)
    if (ctx.onFileAccessed) {
      ctx.onFileAccessed(absolutePath).catch((err: Error) => {
        console.error('[FileTools] onFileAccessed error:', err.message);
      });
    }

    // Generate diff
    const diff = createTwoFilesPatch(
      filePath,
      filePath,
      oldContent,
      newContent,
      '',
      '',
      { context: 3 }
    );

    // Determine if ingestion was queued or completed immediately
    const wasQueued = ingestionStats?.queued === true;

    return {
      path: filePath,
      absolute_path: absolutePath,
      change_type: 'updated',
      hash: newHash,
      diff: trimDiff(diff),
      rag_synced: !wasQueued && !!ctx.onFileModified,
      rag_queued: wasQueued,
      ingestion_stats: ingestionStats,
      note: wasQueued
        ? '📥 RAG update queued. brain_search will wait for completion.'
        : ctx.onFileModified
          ? '✅ RAG graph updated. You can now query the new content.'
          : '⚠️ RAG graph NOT updated (no re-ingestion configured).',
    };
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if file is binary
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const ext = path.extname(filePath).toLowerCase();

  // Known binary extensions
  const binaryExtensions = [
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar',
    '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.bin', '.dat', '.obj', '.o', '.a', '.lib', '.wasm', '.pyc',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.pdf'
  ];

  if (binaryExtensions.includes(ext)) return true;

  // Check file content for binary data
  try {
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
    await handle.close();

    if (bytesRead === 0) return false;

    // Check for null bytes or high ratio of non-printable chars
    let nonPrintableCount = 0;
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true; // Null byte = definitely binary
      if (buffer[i] < 9 || (buffer[i] > 13 && buffer[i] < 32)) {
        nonPrintableCount++;
      }
    }

    return nonPrintableCount / bytesRead > 0.3;
  } catch {
    return false;
  }
}

// Similarity thresholds for block anchor fallback matching (from OpenCode)
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

/**
 * Replace with fuzzy matching (inspired by OpenCode)
 * Tries multiple strategies to find and replace text
 */
function replaceWithFuzzyMatch(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): string {
  // Strategy 1: Exact match
  if (content.includes(oldString)) {
    return performReplace(content, oldString, newString, replaceAll);
  }

  // Strategy 2: Line-trimmed match
  const trimmedMatch = findLineTrimmedMatch(content, oldString);
  if (trimmedMatch) {
    return performReplace(content, trimmedMatch, newString, replaceAll);
  }

  // Strategy 3: Block anchor match (first/last line anchors with Levenshtein similarity)
  const blockMatch = findBlockAnchorMatch(content, oldString);
  if (blockMatch) {
    return performReplace(content, blockMatch, newString, replaceAll);
  }

  // Strategy 4: Whitespace-normalized match
  const wsMatch = findWhitespaceNormalizedMatch(content, oldString);
  if (wsMatch) {
    return performReplace(content, wsMatch, newString, replaceAll);
  }

  // Strategy 5: Indentation-flexible match
  const indentMatch = findIndentationFlexibleMatch(content, oldString);
  if (indentMatch) {
    return performReplace(content, indentMatch, newString, replaceAll);
  }

  throw new Error(
    `Could not find old_string in file. Make sure the text matches exactly, ` +
    `including whitespace and indentation. Use read_file to see current content.`
  );
}

/**
 * Perform the actual replacement
 */
function performReplace(
  content: string,
  search: string,
  replacement: string,
  replaceAll: boolean
): string {
  if (replaceAll) {
    return content.replaceAll(search, replacement);
  }

  const firstIndex = content.indexOf(search);
  const lastIndex = content.lastIndexOf(search);

  if (firstIndex !== lastIndex) {
    throw new Error(
      `Found multiple matches for old_string. ` +
      `Provide more surrounding lines for unique matching, or use replace_all=true.`
    );
  }

  return content.substring(0, firstIndex) + replacement + content.substring(firstIndex + search.length);
}

/**
 * Find match with trimmed lines (ignoring leading/trailing whitespace per line)
 */
function findLineTrimmedMatch(content: string, search: string): string | null {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  // Remove trailing empty line if present
  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matches = true;

    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false;
        break;
      }
    }

    if (matches) {
      // Return the actual content that matched
      return contentLines.slice(i, i + searchLines.length).join('\n');
    }
  }

  return null;
}

/**
 * Find match with normalized whitespace
 */
function findWhitespaceNormalizedMatch(content: string, search: string): string | null {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedSearch = normalize(search);

  const lines = content.split('\n');

  // Try single line match
  for (const line of lines) {
    if (normalize(line) === normalizedSearch) {
      return line;
    }
  }

  // Try multi-line match
  const searchLines = search.split('\n');
  if (searchLines.length > 1) {
    for (let i = 0; i <= lines.length - searchLines.length; i++) {
      const block = lines.slice(i, i + searchLines.length);
      if (normalize(block.join('\n')) === normalizedSearch) {
        return block.join('\n');
      }
    }
  }

  return null;
}

/**
 * Find match with flexible indentation
 */
function findIndentationFlexibleMatch(content: string, search: string): string | null {
  const removeIndentation = (text: string): string => {
    const lines = text.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    if (nonEmptyLines.length === 0) return text;

    const minIndent = Math.min(
      ...nonEmptyLines.map(line => {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
      })
    );

    return lines
      .map(line => line.trim().length === 0 ? line : line.slice(minIndent))
      .join('\n');
  };

  const normalizedSearch = removeIndentation(search);
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const block = contentLines.slice(i, i + searchLines.length).join('\n');
    if (removeIndentation(block) === normalizedSearch) {
      return block;
    }
  }

  return null;
}

/**
 * Find match using block anchors (first/last line) with Levenshtein similarity
 * This is the most sophisticated matcher, inspired by OpenCode's BlockAnchorReplacer
 */
function findBlockAnchorMatch(content: string, search: string): string | null {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  // Need at least 3 lines for block anchor matching
  if (searchLines.length < 3) {
    return null;
  }

  // Remove trailing empty line if present
  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = [];

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLineSearch) {
      continue;
    }

    // Look for matching last line after this first line
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break; // Only match first occurrence of last line
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Calculate similarity for candidate(s)
  const calculateSimilarity = (startLine: number, endLine: number): number => {
    const actualBlockSize = endLine - startLine + 1;
    let similarity = 0;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2); // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = contentLines[startLine + j].trim();
        const searchLine = searchLines[j].trim();
        const maxLen = Math.max(originalLine.length, searchLine.length);

        if (maxLen === 0) continue;

        const distance = levenshtein(originalLine, searchLine);
        similarity += (1 - distance / maxLen) / linesToCheck;
      }
    } else {
      // No middle lines to compare, accept based on anchors
      similarity = 1.0;
    }

    return similarity;
  };

  // Extract matched block from content
  const extractBlock = (startLine: number, endLine: number): string => {
    return contentLines.slice(startLine, endLine + 1).join('\n');
  };

  // Single candidate: use relaxed threshold
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    const similarity = calculateSimilarity(startLine, endLine);

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      return extractBlock(startLine, endLine);
    }
    return null;
  }

  // Multiple candidates: find best match
  let bestMatch: { startLine: number; endLine: number } | null = null;
  let maxSimilarity = -1;

  for (const candidate of candidates) {
    const similarity = calculateSimilarity(candidate.startLine, candidate.endLine);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatch = candidate;
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    return extractBlock(bestMatch.startLine, bestMatch.endLine);
  }

  return null;
}

/**
 * Trim diff output for cleaner display
 */
function trimDiff(diff: string): string {
  const lines = diff.split('\n');
  const contentLines = lines.filter(
    line =>
      (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) &&
      !line.startsWith('---') &&
      !line.startsWith('+++')
  );

  if (contentLines.length === 0) return diff;

  // Find minimum indentation
  let min = Infinity;
  for (const line of contentLines) {
    const content = line.slice(1);
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/);
      if (match) min = Math.min(min, match[1].length);
    }
  }

  if (min === Infinity || min === 0) return diff;

  // Trim indentation
  const trimmedLines = lines.map(line => {
    if (
      (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) &&
      !line.startsWith('---') &&
      !line.startsWith('+++')
    ) {
      const prefix = line[0];
      const content = line.slice(1);
      return prefix + content.slice(min);
    }
    return line;
  });

  return trimmedLines.join('\n');
}

// ============================================
// Install Package Tool
// ============================================

/**
 * Generate install_package tool
 * Updated with path parameter for explicit directory targeting
 * Test edit 1
 */
export function generateInstallPackageTool(): GeneratedToolDefinition {
  return {
    name: 'install_package',
    description: `Install an npm package in the project.

Runs 'npm install' to add a package to package.json.
The package.json will be updated and the package downloaded to node_modules.

Parameters:
- package_name: Package name with optional version (e.g., "three", "lodash@4.17.21")
- path: Directory containing package.json (recommended to specify explicitly)
- dev: If true, install as devDependency (default: false)

Example: install_package({ package_name: "three", path: "/path/to/project" })
Example: install_package({ package_name: "typescript", dev: true, path: "." })`,
    inputSchema: {
      type: 'object',
      properties: {
        package_name: {
          type: 'string',
          description: 'Package name with optional version (e.g., "three", "lodash@4.17.21")',
        },
        path: {
          type: 'string',
          description: 'Directory containing package.json. Recommended to specify explicitly to avoid installing in wrong location. Falls back to project root if not specified.',
        },
        dev: {
          type: 'boolean',
          description: 'Install as devDependency (default: false)',
        },
      },
      required: ['package_name'],
    },
  };
}

/**
 * Generate handler for install_package
 */
export function generateInstallPackageHandler(ctx: FileToolsContext): (args: any) => Promise<any> {
  return async (args: { package_name: string; path?: string; dev?: boolean }) => {
    const { package_name, path: targetPath, dev = false } = args;
    const { execSync } = await import('child_process');
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve target directory: explicit path > project root > cwd
    let projectRoot: string;
    if (targetPath) {
      projectRoot = pathModule.isAbsolute(targetPath)
        ? targetPath
        : pathModule.resolve(process.cwd(), targetPath);
    } else {
      const ctxRoot = getProjectRoot(ctx);
      if (!ctxRoot) {
        return {
          error: 'No path specified and no project loaded. Either specify path parameter or use load_project first.',
          suggestion: 'Specify the path parameter explicitly, e.g., path: "/path/to/project"',
        };
      }
      projectRoot = ctxRoot;
    }

    // Validate package name (basic security check)
    if (!/^(@[\w-]+\/)?[\w.-]+(@[\w.-]+)?$/.test(package_name)) {
      return { error: `Invalid package name: ${package_name}` };
    }

    const packageJsonPath = pathModule.join(projectRoot, 'package.json');

    // Check if package.json exists
    try {
      await fs.access(packageJsonPath);
    } catch {
      return { error: 'No package.json found in project root. Run "npm init" first.' };
    }

    // Read current package.json to check if already installed
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    const baseName = package_name.split('@')[0] || package_name.replace(/^@/, '').split('@')[0];
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    if (deps[baseName] || devDeps[baseName]) {
      const installedIn = deps[baseName] ? 'dependencies' : 'devDependencies';
      const version = deps[baseName] || devDeps[baseName];
      return {
        already_installed: true,
        package: baseName,
        version,
        location: installedIn,
        message: `${baseName}@${version} is already installed in ${installedIn}`,
      };
    }

    // Install the package
    const flag = dev ? '--save-dev' : '--save';
    const startTime = Date.now();

    try {
      console.log(`📦 Installing ${package_name}${dev ? ' (dev)' : ''}...`);
      execSync(`npm install ${flag} ${package_name}`, {
        cwd: projectRoot,
        stdio: 'pipe', // Capture output
        encoding: 'utf-8',
      });

      // Read updated package.json to get installed version
      const updatedPackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const installedVersion = dev
        ? updatedPackageJson.devDependencies?.[baseName]
        : updatedPackageJson.dependencies?.[baseName];

      // Notify about file modification for re-ingestion
      if (ctx.onFileModified) {
        await ctx.onFileModified(packageJsonPath, 'updated');
      }

      return {
        installed: true,
        package: baseName,
        version: installedVersion,
        path: projectRoot,
        dev,
        duration_ms: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        error: `Failed to install ${package_name}: ${err.message}`,
        stderr: err.stderr?.toString() || '',
      };
    }
  };
}

// ============================================
// Export All File Tools
// ============================================

export interface FileToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all file tools with handlers
 */
export function generateFileTools(ctx: FileToolsContext): FileToolsResult {
  return {
    tools: [
      generateReadFileTool(),
      generateWriteFileTool(),
      generateCreateFileTool(),
      generateEditFileTool(),
      generateInstallPackageTool(),
    ],
    handlers: {
      read_file: generateReadFileHandler(ctx),
      write_file: generateWriteFileHandler(ctx),
      create_file: generateCreateFileHandler(ctx),
      edit_file: generateEditFileHandler(ctx),
      install_package: generateInstallPackageHandler(ctx),
    },
  };
}
