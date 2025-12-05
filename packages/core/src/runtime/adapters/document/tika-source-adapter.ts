/**
 * Tika Source Adapter
 *
 * Parses documents (PDF, DOCX, images with OCR, etc.) into Neo4j graph structure
 * using Apache Tika for parsing and our custom chunker.
 */

import fg from 'fast-glob';
import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  SourceAdapter,
  type SourceConfig,
  type ParseOptions,
  type ParseResult,
  type ParsedNode,
  type ParsedRelationship,
  type ValidationResult,
} from '../types.js';
import { TikaParser, SUPPORTED_EXTENSIONS } from './tika-parser.js';
import { Chunker, type ChunkerConfig } from './chunker.js';
import { UniqueIDHelper } from '../../utils/UniqueIDHelper.js';

// Helper to generate deterministic UUIDs
function generateUUID(type: string, key: string): string {
  return UniqueIDHelper.GenerateDeterministicUUID(`${type}:${key}`);
}
import { getLocalTimestamp } from '../../utils/timestamp.js';

/**
 * Tika-specific source configuration
 */
export interface TikaSourceConfig extends SourceConfig {
  type: 'document';
  adapter: 'tika';
  options?: {
    /** OCR settings */
    ocr?: {
      enabled?: boolean;
      languages?: string[];
    };
    /** Chunking settings */
    chunking?: {
      chunk_size?: number;
      chunk_overlap?: number;
      strategy?: 'simple' | 'sentence' | 'paragraph';
    };
    /** Path to custom Tika config (for advanced OCR settings) */
    tika_config_path?: string;
  };
}

/**
 * Adapter for parsing documents using Apache Tika
 *
 * Supports:
 * - All document formats (PDF, DOCX, PPTX, etc.)
 * - OCR for images and scanned documents
 * - Metadata extraction
 */
export class TikaSourceAdapter extends SourceAdapter {
  readonly type = 'document';
  readonly adapterName = 'tika';

  private tikaParser: TikaParser | null = null;

  /**
   * Validate source configuration
   */
  async validate(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.type !== 'document') {
      errors.push(`Invalid source type: ${config.type}. Expected 'document'`);
    }

    if (config.adapter !== 'tika') {
      errors.push(`Invalid adapter: ${config.adapter}. Expected 'tika'`);
    }

    if (!config.root) {
      warnings.push('No root directory specified. Will use current working directory');
    }

    if (!config.include || config.include.length === 0) {
      warnings.push('No include patterns specified. Will parse all documents in root directory');
    }

    const options = (config as TikaSourceConfig).options;
    if (options?.chunking) {
      if (options.chunking.chunk_size && options.chunking.chunk_size < 50) {
        warnings.push('chunk_size is very small (<50 chars). This may create too many chunks.');
      }

      if (options.chunking.chunk_overlap && options.chunking.chunk_size &&
          options.chunking.chunk_overlap >= options.chunking.chunk_size) {
        errors.push('chunk_overlap must be less than chunk_size');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Parse documents into Neo4j graph structure
   */
  async parse(options: ParseOptions): Promise<ParseResult> {
    const startTime = Date.now();
    const { source } = options;
    const config = source as TikaSourceConfig;

    // Get options with defaults
    const chunkingConfig: ChunkerConfig = {
      chunkSize: config.options?.chunking?.chunk_size ?? 1000,
      chunkOverlap: config.options?.chunking?.chunk_overlap ?? 200,
      strategy: config.options?.chunking?.strategy ?? 'sentence',
    };

    // Discover files
    const rootDir = path.resolve(config.root || process.cwd());
    const includePatterns = config.include || ['**/*'];
    const excludePatterns = config.exclude || ['**/node_modules/**', '**/.git/**'];

    options.onProgress?.({
      phase: 'discovering',
      filesProcessed: 0,
      totalFiles: 0,
      percentComplete: 0,
    });

    // Find matching files
    const files = await fg(includePatterns, {
      cwd: rootDir,
      ignore: excludePatterns,
      absolute: true,
    });

    // Filter by supported extensions
    const documentFiles = files.filter(file => TikaParser.isSupported(file));

    if (documentFiles.length === 0) {
      return {
        graph: {
          nodes: [],
          relationships: [],
          metadata: {
            filesProcessed: 0,
            nodesGenerated: 0,
            relationshipsGenerated: 0,
            parseTimeMs: Date.now() - startTime,
            warnings: ['No document files found matching the include patterns'],
          },
        },
        isIncremental: false,
      };
    }

    // Initialize Tika parser
    const tikaConfigPath = config.options?.tika_config_path ||
      this.getDefaultTikaConfig(config.options?.ocr?.enabled ?? true);

    this.tikaParser = new TikaParser({
      configPath: tikaConfigPath,
      debug: false,
    });

    const nodes: ParsedNode[] = [];
    const relationships: ParsedRelationship[] = [];
    const warnings: string[] = [];

    try {
      // Start Tika server
      options.onProgress?.({
        phase: 'parsing',
        filesProcessed: 0,
        totalFiles: documentFiles.length,
        percentComplete: 0,
      });

      await this.tikaParser.start();

      // Initialize chunker
      const chunker = new Chunker(chunkingConfig);

      // Parse each document
      for (let i = 0; i < documentFiles.length; i++) {
        const filePath = documentFiles[i];
        const relPath = path.relative(rootDir, filePath);

        try {
          options.onProgress?.({
            phase: 'parsing',
            currentFile: relPath,
            filesProcessed: i,
            totalFiles: documentFiles.length,
            percentComplete: Math.round((i / documentFiles.length) * 100),
          });

          // Parse document with Tika
          const parsedDoc = await this.tikaParser.parse(filePath);

          // Create Document node
          const documentUuid = generateUUID('Document', relPath);
          const documentNode: ParsedNode = {
            labels: ['Document'],
            id: documentUuid,
            properties: {
              uuid: documentUuid,
              title: parsedDoc.metadata.title || path.basename(filePath, path.extname(filePath)),
              path: relPath,
              type: parsedDoc.extension,
              content_type: parsedDoc.metadata.contentType,
              content_hash: parsedDoc.contentHash,
              author: parsedDoc.metadata.author,
              language: parsedDoc.metadata.language,
              word_count: parsedDoc.metadata.wordCount || this.countWords(parsedDoc.content),
              page_count: parsedDoc.metadata.pageCount,
              file_size: parsedDoc.fileSize,
              created_at: parsedDoc.metadata.createdAt?.toISOString(),
              modified_at: parsedDoc.metadata.modifiedAt?.toISOString(),
              ingested_at: getLocalTimestamp(),
            },
          };

          nodes.push(documentNode);

          // Chunk the content
          const chunks = chunker.chunk(parsedDoc.content, relPath);

          // Create Chunk nodes and relationships
          for (let j = 0; j < chunks.length; j++) {
            const chunk = chunks[j];

            const chunkNode: ParsedNode = {
              labels: ['Chunk'],
              id: chunk.uuid,
              properties: {
                uuid: chunk.uuid,
                content: chunk.content,
                chunk_index: chunk.index,
                start_char: chunk.startChar,
                end_char: chunk.endChar,
                word_count: chunk.wordCount,
                document_path: relPath,
                ingested_at: getLocalTimestamp(),
              },
            };

            nodes.push(chunkNode);

            // Document CONTAINS Chunk
            relationships.push({
              type: 'CONTAINS',
              from: documentUuid,
              to: chunk.uuid,
              properties: { position: j },
            });

            // Chunk IN_DOCUMENT Document
            relationships.push({
              type: 'IN_DOCUMENT',
              from: chunk.uuid,
              to: documentUuid,
            });

            // Sequential linking: NEXT_CHUNK
            if (j > 0) {
              relationships.push({
                type: 'NEXT_CHUNK',
                from: chunks[j - 1].uuid,
                to: chunk.uuid,
              });
            }
          }

        } catch (error: any) {
          warnings.push(`Failed to parse ${relPath}: ${error.message}`);
        }
      }

      options.onProgress?.({
        phase: 'complete',
        filesProcessed: documentFiles.length,
        totalFiles: documentFiles.length,
        percentComplete: 100,
      });

    } finally {
      // Always stop Tika
      if (this.tikaParser) {
        await this.tikaParser.stop();
        this.tikaParser = null;
      }
    }

    return {
      graph: {
        nodes,
        relationships,
        metadata: {
          filesProcessed: documentFiles.length,
          nodesGenerated: nodes.length,
          relationshipsGenerated: relationships.length,
          parseTimeMs: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      },
      isIncremental: false,
    };
  }

  /**
   * Get default Tika config path based on OCR setting
   */
  private getDefaultTikaConfig(ocrEnabled: boolean): string | undefined {
    if (!ocrEnabled) {
      // Use default config that excludes OCR
      return undefined;
    }

    // Look for OCR-enabled config in known locations
    const possiblePaths = [
      path.join(process.cwd(), 'tika-config-ocr.xml'),
      path.join(__dirname, '../../../../tika-config-ocr.xml'),
      path.join(__dirname, '../../../../../test-documents/tika-config-ocr.xml'),
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    // No custom config found, Tika will use defaults
    return undefined;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }
}
