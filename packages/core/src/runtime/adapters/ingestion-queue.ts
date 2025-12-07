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
import type { IncrementalIngestionManager, IncrementalStats } from './incremental-ingestion.js';
import type { IngestionLock } from '../../index.js';
import type { AgentLogger } from '../agents/rag-agent.js';

export interface IngestionQueueConfig {
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
   */
  afterIngestion?: (stats: IncrementalStats) => Promise<void>;
}

export class IngestionQueue {
  private pendingFiles = new Set<string>();
  private pendingDeletes = new Set<string>();
  private batchTimer: NodeJS.Timeout | null = null;
  private isIngesting = false;
  private queuedBatch: Set<string> | null = null;
  private queuedDeletes: Set<string> | null = null;
  private config: Required<Omit<IngestionQueueConfig, 'ingestionLock' | 'logger' | 'afterIngestion'>> & { ingestionLock?: IngestionLock; afterIngestion?: (stats: IncrementalStats) => Promise<void> };
  private logger?: AgentLogger;

  constructor(
    private manager: IncrementalIngestionManager,
    private sourceConfig: CodeSourceConfig,
    config: IngestionQueueConfig = {}
  ) {
    this.config = {
      batchInterval: config.batchInterval ?? 1000,
      verbose: config.verbose ?? false,
      ingestionLock: config.ingestionLock,
      onBatchStart: config.onBatchStart ?? (() => {}),
      onBatchComplete: config.onBatchComplete ?? (() => {}),
      onBatchError: config.onBatchError ?? (() => {}),
      afterIngestion: config.afterIngestion
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
    const release = lock ? await lock.acquire(`batch:${totalFiles} files`) : null;

    if (this.config.verbose && release) {
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
      if (filesToProcess.length > 0) {
        const ingestionStats = await this.manager.ingestFromPaths(this.sourceConfig, {
          incremental: true,
          verbose: this.config.verbose
        });

        // Combine stats
        stats.unchanged = ingestionStats.unchanged;
        stats.updated = ingestionStats.updated;
        stats.created = ingestionStats.created;
        stats.deleted += ingestionStats.deleted; // Add to deletion count
      }

      // Log ingestion completed
      this.logger?.logIngestion('completed', { stats });

      // Run afterIngestion callback (e.g., embedding generation) while lock is still held
      // This ensures semantic queries wait until embeddings are ready
      if (this.config.afterIngestion && (stats.created + stats.updated) > 0) {
        if (this.config.verbose) {
          console.log(`   🧠 Triggering post-ingestion tasks (embeddings)...`);
        }
        this.logger?.logEmbeddings('started', { dirtyCount: stats.created + stats.updated });

        try {
          await this.config.afterIngestion(stats);
          this.logger?.logEmbeddings('completed', {});
        } catch (embeddingError) {
          // Log but don't fail the ingestion
          const errMsg = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
          console.warn(`   ⚠️ Embedding generation failed: ${errMsg}`);
          this.logger?.logEmbeddings('error', { error: errMsg });
        }
      }

      this.config.onBatchComplete(stats);

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
      if (release) {
        release();
        if (this.config.verbose) {
          console.log(`   🔓 Ingestion lock released`);
        }
      }
    }
  }
}
