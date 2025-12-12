/**
 * Ingestion Queue
 *
 * Batches file changes for efficient incremental ingestion
 * - Collects changes for a configurable interval (default 1 second)
 * - Queues changes while ingestion is in progress
 * - Provides callbacks for ingestion events
 * - Optionally uses IngestionLock to block RAG queries during ingestion
 */

import type { CodeSourceConfig } from './code-source-adapter.js';
import type { SourceConfig } from './types.js';
import type { IncrementalIngestionManager, IncrementalStats } from './incremental-ingestion.js';
import type { IngestionLock } from '../../index.js';
import type { AgentLogger } from '../agents/rag-agent.js';

export interface IngestionQueueConfig {
  /**
   * Project ID for incremental ingestion
   * Required for hash-based change detection
   */
  projectId?: string;
  /**
   * Optional AgentLogger for structured logging
   */
  logger?: AgentLogger;
  /**
   * Batch interval in milliseconds
   * Changes are collected for this duration before triggering ingestion
   * @default 1000 (1 second)
   */
  batchInterval?: number;

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;

  /**
   * Ingestion lock to coordinate with RAG queries
   * When provided, RAG queries will wait during ingestion
   */
  ingestionLock?: IngestionLock;

  /**
   * Embedding lock to coordinate with semantic RAG queries
   * When provided, semantic queries will wait during embedding generation
   * Non-semantic queries can proceed while embeddings are being generated
   */
  embeddingLock?: IngestionLock;

  /**
   * Callback when batch starts processing
   */
  onBatchStart?: (fileCount: number) => void;

  /**
   * Callback when batch completes
   */
  onBatchComplete?: (stats: IncrementalStats) => void;

  /**
   * Callback when batch fails
   */
  onBatchError?: (error: Error) => void;

  /**
   * Async callback after ingestion completes successfully
   * Use this to trigger embedding generation or other post-processing
   * Called with stats so you can decide whether to regenerate embeddings
   * Only called when stats.created + stats.updated > 0
   */
  afterIngestion?: (stats: IncrementalStats) => Promise<void>;

  /**
   * Async callback after each batch completes, even if no changes were made
   * Use this for tasks that should run periodically regardless of file changes
   * (e.g., processing dirty embeddings that were marked manually)
   * Called with stats (which may have all zeros if no files changed)
   */
  afterBatch?: (stats: IncrementalStats) => Promise<void>;
}

export class IngestionQueue {
  private pendingFiles = new Set<string>();
  private pendingDeletes = new Set<string>();
  private batchTimer: NodeJS.Timeout | null = null;
  private isIngesting = false;
  private queuedBatch: Set<string> | null = null;
  private queuedDeletes: Set<string> | null = null;
  private config: Required<Omit<IngestionQueueConfig, 'ingestionLock' | 'embeddingLock' | 'logger' | 'afterIngestion' | 'afterBatch' | 'projectId'>> & { projectId?: string; ingestionLock?: IngestionLock; embeddingLock?: IngestionLock; afterIngestion?: (stats: IncrementalStats) => Promise<void>; afterBatch?: (stats: IncrementalStats) => Promise<void> };
  private logger?: AgentLogger;

  constructor(
    private manager: IncrementalIngestionManager,
    private sourceConfig: CodeSourceConfig,
    config: IngestionQueueConfig = {}
  ) {
    this.config = {
      projectId: config.projectId,
      batchInterval: config.batchInterval ?? 1000,
      verbose: config.verbose ?? false,
      ingestionLock: config.ingestionLock,
      onBatchStart: config.onBatchStart ?? (() => {}),
      onBatchComplete: config.onBatchComplete ?? (() => {}),
      onBatchError: config.onBatchError ?? (() => {}),
      afterIngestion: config.afterIngestion,
      afterBatch: config.afterBatch
    };
    this.logger = config.logger;
  }

  /**
   * Set or update the logger
   */
  setLogger(logger: AgentLogger): void {
    this.logger = logger;
  }

  /**
   * Add a file to the ingestion queue (for add/change events)
   * The file will be batched with other changes
   */
  addFile(filePath: string): void {
    if (this.isIngesting) {
      // Ingestion in progress - queue for next batch
      if (!this.queuedBatch) {
        this.queuedBatch = new Set();
      }
      this.queuedBatch.add(filePath);

      if (this.config.verbose) {
        console.log(`📥 Queued ${filePath} (ingestion in progress)`);
      }
    } else {
      // Add to pending batch
      this.pendingFiles.add(filePath);
      // Remove from pending deletes if it was there (file recreated)
      this.pendingDeletes.delete(filePath);

      if (this.config.verbose) {
        console.log(`📥 Added ${filePath} to batch (${this.pendingFiles.size} pending)`);
      }

      // Reset batch timer
      this.resetBatchTimer();
    }
  }

  /**
   * Add a file deletion to the queue (for unlink events)
   * Nodes associated with this file will be deleted
   */
  addDeletedFile(filePath: string): void {
    if (this.isIngesting) {
      // Ingestion in progress - queue for next batch
      if (!this.queuedDeletes) {
        this.queuedDeletes = new Set();
      }
      this.queuedDeletes.add(filePath);

      if (this.config.verbose) {
        console.log(`🗑️ Queued deletion ${filePath} (ingestion in progress)`);
      }
    } else {
      // Add to pending deletes
      this.pendingDeletes.add(filePath);
      // Remove from pending adds if it was there
      this.pendingFiles.delete(filePath);

      if (this.config.verbose) {
        console.log(`🗑️ Added ${filePath} to delete batch (${this.pendingDeletes.size} pending)`);
      }

      // Reset batch timer
      this.resetBatchTimer();
    }
  }

  /**
   * Add multiple files to the queue
   */
  addFiles(filePaths: string[]): void {
    for (const file of filePaths) {
      this.addFile(file);
    }
  }

  /**
   * Flush the current batch immediately
   * Useful for testing or manual triggers
   */
  async flush(): Promise<IncrementalStats | null> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingFiles.size === 0 && this.pendingDeletes.size === 0) {
      return null;
    }

    return await this.processBatch();
  }

  /**
   * Get the number of pending files in the current batch
   */
  getPendingCount(): number {
    return this.pendingFiles.size;
  }

  /**
   * Get the number of files queued for the next batch
   */
  getQueuedCount(): number {
    return this.queuedBatch?.size ?? 0;
  }

  /**
   * Check if ingestion is currently in progress
   */
  isProcessing(): boolean {
    return this.isIngesting;
  }

  /**
   * Stop the queue and clear all pending batches
   */
  stop(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingFiles.clear();
    this.pendingDeletes.clear();
    this.queuedBatch = null;
    this.queuedDeletes = null;
  }

  /**
   * Reset the batch timer
   * Called whenever a new file is added
   */
  private resetBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch().catch(error => {
        this.config.onBatchError(error);
      });
    }, this.config.batchInterval);
  }

  /**
   * Process the current batch of files (adds, changes, and deletes)
   * Acquires ingestion lock if configured, blocking RAG queries during ingestion
   */
  private async processBatch(): Promise<IncrementalStats> {
    const filesToProcess = Array.from(this.pendingFiles);
    const filesToDelete = Array.from(this.pendingDeletes);
    this.pendingFiles.clear();
    this.pendingDeletes.clear();
    this.isIngesting = true;

    const totalFiles = filesToProcess.length + filesToDelete.length;

    if (this.config.verbose) {
      console.log(`\n🚀 Processing batch: ${filesToProcess.length} to ingest, ${filesToDelete.length} to delete`);
    }

    // Log ingestion started
    this.logger?.logIngestion('started', {
      fileCount: filesToProcess.length,
      deleteCount: filesToDelete.length
    });

    // Acquire lock to block RAG queries during ingestion
    const lock = this.config.ingestionLock;
    const opKey = lock?.acquire('watcher-batch', `batch:${totalFiles}`, {
      description: `Watcher batch: ${totalFiles} files`,
      timeoutMs: 120000, // 2 minutes for large batches
    });

    if (this.config.verbose && opKey) {
      console.log(`   🔒 Ingestion lock acquired (RAG queries will wait)`);
    }

    let stats: IncrementalStats = {
      unchanged: 0,
      updated: 0,
      created: 0,
      deleted: 0
    };

    try {
      this.config.onBatchStart(totalFiles);

      // 1. Process deletions first
      if (filesToDelete.length > 0) {
        if (this.config.verbose) {
          console.log(`\n🗑️  Deleting nodes for ${filesToDelete.length} file(s)...`);
        }
        const deletedCount = await this.manager.deleteNodesForFiles(filesToDelete);
        stats.deleted = deletedCount;
        if (this.config.verbose) {
          console.log(`   Deleted ${deletedCount} nodes`);
        }
      }

      // 2. Process ingestions (if any files to add/change)
      // Create a filtered config with only the changed files (not full glob patterns)
      if (filesToProcess.length > 0) {
        if (this.config.verbose) {
          console.log(`\n📝 Re-ingesting ${filesToProcess.length} changed file(s)...`);
        }

        // Convert absolute paths to relative paths for the include list
        const path = await import('path');
        const root = this.sourceConfig.root || '.';
        const relPaths = filesToProcess.map(f => path.relative(root, f));

        // Create a config with only the changed files
        const filteredConfig: SourceConfig = {
          type: 'files',
          root: this.sourceConfig.root,
          include: relPaths,
        };

        const ingestionStats = await this.manager.ingestFromPaths(filteredConfig, {
          projectId: this.config.projectId,
          incremental: 'content', // Skip file hash check (watcher knows), but compare scope hashes
          verbose: this.config.verbose
        });

        // Combine stats
        stats.unchanged = ingestionStats.unchanged;
        stats.updated = ingestionStats.updated;
        stats.created = ingestionStats.created;
        stats.deleted += ingestionStats.deleted;
      }

      // Log ingestion completed
      this.logger?.logIngestion('completed', { stats });

      // Run afterIngestion callback (e.g., embedding generation)
      // Use embeddingLock (separate from ingestionLock) so non-semantic queries can proceed
      if (this.config.afterIngestion && (stats.created + stats.updated) > 0) {
        if (this.config.verbose) {
          console.log(`   🧠 Triggering post-ingestion tasks (embeddings)...`);
        }
        this.logger?.logEmbeddings('started', { dirtyCount: stats.created + stats.updated });

        // Acquire embedding lock before generating embeddings
        // This allows non-semantic queries to proceed while embeddings are generated
        let embeddingOpKey: string | undefined;
        if (this.config.embeddingLock) {
          const nodeCount = stats.created + stats.updated;
          // Dynamic timeout: 2 minutes per batch of 500 nodes, minimum 10 minutes
          // This accounts for rate limiting which can add 60-70 seconds per batch
          const batchCount = Math.ceil(nodeCount / 500);
          const dynamicTimeout = Math.max(600000, batchCount * 120000); // min 10 min, 2 min per batch
          embeddingOpKey = this.config.embeddingLock.acquire('watcher-batch', `embeddings:${nodeCount}`, {
            description: `Generating embeddings: ${nodeCount} nodes`,
            timeoutMs: dynamicTimeout,
          });
          if (this.config.verbose) {
            console.log(`   🧠 Acquired embedding lock for ${nodeCount} nodes (timeout: ${Math.round(dynamicTimeout / 60000)} min)`);
          }
        }

        try {
          await this.config.afterIngestion(stats);
          this.logger?.logEmbeddings('completed', {});
        } catch (embeddingError) {
          // Log but don't fail the ingestion
          const errMsg = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
          console.warn(`   ⚠️ Embedding generation failed: ${errMsg}`);
          this.logger?.logEmbeddings('error', { error: errMsg });
        } finally {
          // Release embedding lock after generation completes
          if (embeddingOpKey && this.config.embeddingLock) {
            this.config.embeddingLock.release(embeddingOpKey);
          }
        }
      }

      this.config.onBatchComplete(stats);

      // Run afterBatch callback (regardless of whether files changed)
      // This is useful for processing dirty embeddings marked manually
      if (this.config.afterBatch) {
        try {
          await this.config.afterBatch(stats);
        } catch (afterBatchError) {
          // Log but don't fail the batch
          const errMsg = afterBatchError instanceof Error ? afterBatchError.message : String(afterBatchError);
          console.warn(`   ⚠️ afterBatch callback failed: ${errMsg}`);
        }
      }

      // Process queued batches if any
      const hasQueuedWork = (this.queuedBatch && this.queuedBatch.size > 0) ||
                            (this.queuedDeletes && this.queuedDeletes.size > 0);

      if (hasQueuedWork) {
        if (this.config.verbose) {
          const queuedCount = (this.queuedBatch?.size || 0) + (this.queuedDeletes?.size || 0);
          console.log(`\n📦 Processing queued batch of ${queuedCount} file(s)...`);
        }

        if (this.queuedBatch) {
          this.pendingFiles = this.queuedBatch;
          this.queuedBatch = null;
        }
        if (this.queuedDeletes) {
          this.pendingDeletes = this.queuedDeletes;
          this.queuedDeletes = null;
        }
        this.isIngesting = false;

        // Start timer for queued batch
        this.resetBatchTimer();
      } else {
        this.isIngesting = false;
      }

      return stats;
    } catch (error) {
      this.isIngesting = false;
      // Log ingestion error
      this.logger?.logIngestion('error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      // Release lock to allow RAG queries
      if (opKey && lock) {
        lock.release(opKey);
        if (this.config.verbose) {
          console.log(`   🔓 Ingestion lock released`);
        }
      }
    }
  }
}
