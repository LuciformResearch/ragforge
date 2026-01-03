/**
 * Touched Files Watcher
 *
 * Processes orphan files (files accessed outside known projects) through states:
 *   discovered → parsing → parsed → linked → embedding → embedded
 *
 * Uses the shared FileStateMachine for state management, providing:
 * - Unified state tracking with project files
 * - Error handling with retry logic
 * - Progress tracking
 *
 * Delegates file processing to FileProcessor for:
 * - Batch node creation (UNWIND optimization)
 * - Batch relationship creation
 * - Reference extraction and linking
 *
 * @since 2025-12-13
 */

import * as path from 'path';
import type { Neo4jClient } from '../runtime/client/neo4j-client.js';
import type { EmbeddingService } from './embedding-service.js';
import type { IngestionLock } from '../tools/ingestion-lock.js';
import {
  FileStateMachine,
  type FileState,
  type FileStateInfo,
} from './file-state-machine.js';
import {
  FileProcessor,
  type FileInfo,
  type BatchResult as FileProcessorBatchResult,
} from './file-processor.js';
import { EmbeddingCoordinator } from './embedding-coordinator.js';

// ============================================
// Types
// ============================================

// Re-export FileState as the canonical state type
export type { FileState, FileStateInfo };

export interface OrphanFile {
  absolutePath: string;
  state: FileState;
  uuid: string;
  name: string;
  extension: string;
  hash?: string;
}

export interface TouchedFilesWatcherConfig {
  /** Neo4j client */
  neo4jClient: Neo4jClient;
  /** Embedding service (optional - if not provided, files stay at 'linked') */
  embeddingService?: EmbeddingService;
  /** Ingestion lock (optional - for blocking RAG queries during parsing) */
  ingestionLock?: IngestionLock;
  /** Embedding lock (optional - for blocking semantic RAG queries during embedding) */
  embeddingLock?: IngestionLock;
  /** Project ID for touched-files */
  projectId?: string;
  /** Batch size for parsing (default: 10) */
  parsingBatchSize?: number;
  /** Batch size for embeddings (default: 500) */
  embeddingBatchSize?: number;
  /** Verbose logging */
  verbose?: boolean;
  /** Callback when processing starts */
  onProcessingStart?: (dirtyCount: number, indexedCount: number) => void;
  /** Callback when batch completes */
  onBatchComplete?: (stats: ProcessingStats) => void;
  /** Callback when all processing completes */
  onProcessingComplete?: (stats: ProcessingStats) => void;
  /**
   * Callback when a file transitions to 'linked' state
   * Used to resolve PENDING_IMPORT → CONSUMES relations
   */
  onFileIndexed?: (filePath: string) => Promise<void>;
  /**
   * Callback to create a mentioned file (for unresolved imports)
   * Returns true if the mentioned file was created or already exists
   */
  onCreateMentionedFile?: (
    targetPath: string,
    importedBy: {
      filePath: string;
      scopeUuid?: string;
      symbols: string[];
      importPath: string;
    }
  ) => Promise<{ created: boolean; fileState: string }>;
  /**
   * Callback to check if a file exists in the graph and get its state
   */
  onGetFileState?: (absolutePath: string) => Promise<string | null>;
}

export interface ProcessingStats {
  /** Files parsed (dirty → indexed) */
  parsed: number;
  /** Files embedded (indexed → embedded) */
  embedded: number;
  /** Files skipped (unchanged hash) */
  skipped: number;
  /** Errors encountered */
  errors: number;
  /** Duration in ms */
  durationMs: number;
}

// ============================================
// Touched Files Watcher
// ============================================

export class TouchedFilesWatcher {
  private neo4jClient: Neo4jClient;
  private embeddingService?: EmbeddingService;
  private projectId: string;
  private parsingBatchSize: number;
  private embeddingBatchSize: number;
  private verbose: boolean;
  private isProcessing = false;
  private config: TouchedFilesWatcherConfig;
  private _stateMachine?: FileStateMachine;
  private _fileProcessor?: FileProcessor;
  private _embeddingCoordinator?: EmbeddingCoordinator;

  constructor(config: TouchedFilesWatcherConfig) {
    this.config = config;
    this.neo4jClient = config.neo4jClient;
    this.embeddingService = config.embeddingService;
    this.projectId = config.projectId || 'touched-files';
    this.parsingBatchSize = config.parsingBatchSize || 10;
    this.embeddingBatchSize = config.embeddingBatchSize || 500;
    this.verbose = config.verbose || false;
  }

  /**
   * Get the shared state machine instance
   */
  get stateMachine(): FileStateMachine {
    if (!this._stateMachine) {
      this._stateMachine = new FileStateMachine(this.neo4jClient);
    }
    return this._stateMachine;
  }

  /**
   * Get the file processor instance (lazy initialization)
   */
  private get fileProcessor(): FileProcessor {
    if (!this._fileProcessor) {
      this._fileProcessor = new FileProcessor({
        neo4jClient: this.neo4jClient,
        stateMachine: this.stateMachine,
        projectId: this.projectId,
        verbose: this.verbose,
        concurrency: this.parsingBatchSize,
        onFileLinked: this.config.onFileIndexed,
        onCreateMentionedFile: this.config.onCreateMentionedFile,
        onGetFileState: this.config.onGetFileState,
      });
    }
    return this._fileProcessor;
  }

  /**
   * Get the embedding coordinator instance (lazy initialization)
   */
  private get embeddingCoordinator(): EmbeddingCoordinator | undefined {
    if (!this.embeddingService) {
      return undefined;
    }
    if (!this._embeddingCoordinator) {
      this._embeddingCoordinator = new EmbeddingCoordinator({
        neo4jClient: this.neo4jClient,
        embeddingService: this.embeddingService,
        stateMachine: this.stateMachine,
        embeddingLock: this.config.embeddingLock,
        verbose: this.verbose,
      });
    }
    return this._embeddingCoordinator;
  }

  /**
   * Check if processing is in progress
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Process all pending orphan files through the state machine:
   *   discovered → parsing → parsed → linked → embedding → embedded
   *
   * This is the main entry point for batch processing
   */
  async processAll(): Promise<ProcessingStats> {
    if (this.isProcessing) {
      if (this.verbose) {
        console.log('[TouchedFilesWatcher] Already processing, skipping');
      }
      return { parsed: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };
    }

    this.isProcessing = true;
    const startTime = Date.now();
    const stats: ProcessingStats = { parsed: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

    try {
      // Reset any stuck files first
      const stuckReset = await this.stateMachine.resetStuckFiles(this.projectId);
      if (stuckReset > 0 && this.verbose) {
        console.log(`[TouchedFilesWatcher] Reset ${stuckReset} stuck files`);
      }

      // Get files needing parsing (discovered state)
      const toParse = await this.getFilesNeedingParsing();
      // Get files needing embedding (linked state)
      const toEmbed = await this.getFilesNeedingEmbedding();

      if (toParse.length === 0 && toEmbed.length === 0) {
        if (this.verbose) {
          console.log('[TouchedFilesWatcher] No pending files to process');
        }
        return stats;
      }

      this.config.onProcessingStart?.(toParse.length, toEmbed.length);

      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Processing ${toParse.length} to parse, ${toEmbed.length} to embed`);
      }

      // Phase 1: discovered → linked (parsing + relations)
      if (toParse.length > 0) {
        // Acquire ingestion lock to block RAG queries during parsing
        const ingestionLock = this.config.ingestionLock;
        const opKey = ingestionLock?.acquire('watcher-batch', `orphan-parse:${toParse.length}`, {
          description: `Parsing ${toParse.length} orphan files`,
          timeoutMs: 120000, // 2 minutes for large batches
        });

        try {
          const parseStats = await this.processFilesForParsing(toParse);
          stats.parsed = parseStats.processed;
          stats.skipped += parseStats.skipped;
          stats.errors += parseStats.errors;
        } finally {
          // Release ingestion lock after parsing (embedding has its own lock)
          if (opKey && ingestionLock) {
            ingestionLock.release(opKey);
          }
        }
      }

      // Phase 2: linked → embedded (embeddings)
      // Re-fetch linked files as some may have been added from parsing
      const filesToEmbed = await this.getFilesNeedingEmbedding();
      if (filesToEmbed.length > 0 && this.embeddingService) {
        const embedStats = await this.processFilesForEmbedding(filesToEmbed);
        stats.embedded = embedStats.embedded;
        stats.errors += embedStats.errors;
      }

      stats.durationMs = Date.now() - startTime;
      this.config.onProcessingComplete?.(stats);

      // Mark indexes as dirty if data was changed (Kuzu only - lazy rebuild before search)
      if (stats.parsed > 0 || stats.embedded > 0) {
        const client = this.neo4jClient as any;
        if (typeof client.markIndexesDirty === 'function') {
          client.markIndexesDirty();
        }
      }

      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Complete: ${stats.parsed} parsed, ${stats.embedded} embedded, ${stats.skipped} skipped, ${stats.errors} errors (${stats.durationMs}ms)`);
      }

      return stats;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process files in a specific directory (used by brain_search)
   * Returns when all files in the directory are embedded
   */
  async processDirectory(dirPath: string, timeout = 30000): Promise<ProcessingStats> {
    const absoluteDirPath = path.resolve(dirPath);
    const startTime = Date.now();
    const stats: ProcessingStats = { parsed: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

    // Get pending files in directory
    const pendingFiles = await this.getPendingFilesInDirectory(absoluteDirPath);

    if (pendingFiles.length === 0) {
      return stats;
    }

    if (this.verbose) {
      console.log(`[TouchedFilesWatcher] Processing ${pendingFiles.length} pending files in ${absoluteDirPath}`);
    }

    // Process with timeout
    const deadline = startTime + timeout;

    // Phase 1: Parse files in discovered state
    const toParse = pendingFiles.filter(f => f.state === 'discovered');
    if (toParse.length > 0) {
      // Acquire ingestion lock to block RAG queries during parsing
      const ingestionLock = this.config.ingestionLock;
      const opKey = ingestionLock?.acquire('watcher-batch', `orphan-dir-parse:${toParse.length}`, {
        description: `Parsing ${toParse.length} orphan files in ${absoluteDirPath}`,
        timeoutMs: Math.min(timeout, 120000), // Use remaining timeout, max 2 minutes
      });

      try {
        const parseStats = await this.processFilesForParsing(toParse);
        stats.parsed = parseStats.processed;
        stats.skipped += parseStats.skipped;
        stats.errors += parseStats.errors;
      } finally {
        if (opKey && ingestionLock) {
          ingestionLock.release(opKey);
        }
      }
    }

    // Check timeout
    if (Date.now() > deadline) {
      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Timeout reached after parsing`);
      }
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Phase 2: Embed linked files
    if (this.embeddingService) {
      const refreshedPending = await this.getPendingFilesInDirectory(absoluteDirPath);
      const toEmbed = refreshedPending.filter(f => f.state === 'linked');

      if (toEmbed.length > 0) {
        const embedStats = await this.processFilesForEmbedding(toEmbed);
        stats.embedded = embedStats.embedded;
        stats.errors += embedStats.errors;
      }
    }

    // Mark indexes as dirty if data was changed (Kuzu only - lazy rebuild before search)
    if (stats.parsed > 0 || stats.embedded > 0) {
      const client = this.neo4jClient as any;
      if (typeof client.markIndexesDirty === 'function') {
        client.markIndexesDirty();
      }
    }

    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  // ============================================
  // Phase 1: Parsing (discovered → linked)
  // ============================================

  /**
   * Process files for parsing using FileProcessor
   * Delegates to FileProcessor.processBatch() for batch optimizations
   */
  private async processFilesForParsing(files: OrphanFile[]): Promise<{ processed: number; skipped: number; deleted: number; errors: number }> {
    // Convert OrphanFile to FileInfo for FileProcessor
    const fileInfos: FileInfo[] = files.map(f => ({
      absolutePath: f.absolutePath,
      uuid: f.uuid,
      hash: f.hash,
      state: f.state,
      name: f.name,
      extension: f.extension,
    }));

    // Use FileProcessor for batch processing with UNWIND optimizations
    const result = await this.fileProcessor.processBatch(fileInfos);

    if (this.verbose && result.processed > 0) {
      console.log(`[TouchedFilesWatcher] Batch processed: ${result.processed} files, ${result.totalScopesCreated} scopes, ${result.totalRelationshipsCreated} rels (${result.durationMs}ms)`);
    }

    return {
      processed: result.processed,
      skipped: result.skipped,
      deleted: result.deleted,
      errors: result.errors,
    };
  }

  // ============================================
  // Phase 2: Embeddings (linked → embedded)
  // ============================================

  /**
   * Process files for embedding: linked → embedding → embedded
   *
   * Delegates to EmbeddingCoordinator which handles:
   * - Lock acquisition/release for embedding operations
   * - State transitions (linked → embedding → embedded)
   * - Error handling with retry support
   */
  private async processFilesForEmbedding(files: OrphanFile[]): Promise<{ embedded: number; errors: number }> {
    const coordinator = this.embeddingCoordinator;
    if (!coordinator) {
      // No embedding service available - files stay at 'linked' state
      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] No embedding service, ${files.length} files remain at 'linked'`);
      }
      return { embedded: 0, errors: 0 };
    }

    // Delegate to EmbeddingCoordinator
    const result = await coordinator.embedProject(this.projectId, {
      incrementalOnly: true,
      verbose: this.verbose,
    });

    if (this.verbose && result.filesProcessed > 0) {
      console.log(`[TouchedFilesWatcher] Embedded ${result.embeddingsGenerated} vectors for ${result.filesProcessed} files`);
    }

    return {
      embedded: result.filesProcessed,
      errors: result.errors,
    };
  }

  // ============================================
  // Query Helpers (using FileStateMachine)
  // ============================================

  /**
   * Get files needing parsing (discovered state)
   */
  async getFilesNeedingParsing(): Promise<OrphanFile[]> {
    const stateInfo = await this.stateMachine.getFilesInState(this.projectId, 'discovered');
    return this.convertStateInfoToOrphanFiles(stateInfo);
  }

  /**
   * Get files needing embedding (linked state)
   */
  async getFilesNeedingEmbedding(): Promise<OrphanFile[]> {
    const stateInfo = await this.stateMachine.getFilesInState(this.projectId, 'linked');
    return this.convertStateInfoToOrphanFiles(stateInfo);
  }

  /**
   * Get files by state using the state machine
   */
  async getFilesByState(state: FileState | FileState[]): Promise<OrphanFile[]> {
    const stateInfo = await this.stateMachine.getFilesInState(this.projectId, state);
    return this.convertStateInfoToOrphanFiles(stateInfo);
  }

  /**
   * Convert FileStateInfo to OrphanFile format
   */
  private async convertStateInfoToOrphanFiles(stateInfo: FileStateInfo[]): Promise<OrphanFile[]> {
    if (stateInfo.length === 0) return [];

    // Fetch additional file details from Neo4j
    const uuids = stateInfo.map(s => s.uuid);
    const result = await this.neo4jClient.run(
      `MATCH (f:File)
       WHERE f.uuid IN $uuids
       RETURN f.uuid AS uuid, f.absolutePath AS absolutePath, f.name AS name,
              f.extension AS extension, f.hash AS hash, f.state AS state`,
      { uuids }
    );

    const fileMap = new Map<string, OrphanFile>();
    for (const record of result.records) {
      fileMap.set(record.get('uuid'), {
        uuid: record.get('uuid'),
        absolutePath: record.get('absolutePath'),
        name: record.get('name'),
        extension: record.get('extension'),
        hash: record.get('hash'),
        state: record.get('state') || 'discovered',
      });
    }

    // Return in same order as stateInfo
    return stateInfo
      .map(s => fileMap.get(s.uuid))
      .filter((f): f is OrphanFile => f !== undefined);
  }

  /**
   * Get pending files in a directory (not 'embedded')
   */
  private async getPendingFilesInDirectory(dirPath: string): Promise<OrphanFile[]> {
    const result = await this.neo4jClient.run(
      `MATCH (f:File {projectId: $projectId})
       WHERE f.absolutePath STARTS WITH $dirPathPrefix
         AND f.state <> 'embedded'
       RETURN DISTINCT f.absolutePath AS absolutePath, f.state AS state, f.uuid AS uuid,
              f.name AS name, f.extension AS extension, f.hash AS hash`,
      {
        projectId: this.projectId,
        dirPathPrefix: dirPath + path.sep,
      }
    );

    return result.records.map(r => ({
      absolutePath: r.get('absolutePath'),
      state: r.get('state') || 'discovered',
      uuid: r.get('uuid'),
      name: r.get('name'),
      extension: r.get('extension'),
      hash: r.get('hash'),
    }));
  }
}
