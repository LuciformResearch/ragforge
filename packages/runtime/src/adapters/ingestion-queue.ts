/**
 * Ingestion Queue
 *
 * Batches file changes for efficient incremental ingestion
 * - Collects changes for a configurable interval (default 1 second)
 * - Queues changes while ingestion is in progress
 * - Provides callbacks for ingestion events
 */

import type { CodeSourceConfig } from './code-source-adapter.js';
import type { IncrementalIngestionManager, IncrementalStats } from './incremental-ingestion.js';

export interface IngestionQueueConfig {
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
}

export class IngestionQueue {
  private pendingFiles = new Set<string>();
  private batchTimer: NodeJS.Timeout | null = null;
  private isIngesting = false;
  private queuedBatch: Set<string> | null = null;
  private config: Required<IngestionQueueConfig>;

  constructor(
    private manager: IncrementalIngestionManager,
    private sourceConfig: CodeSourceConfig,
    config: IngestionQueueConfig = {}
  ) {
    this.config = {
      batchInterval: config.batchInterval ?? 1000,
      verbose: config.verbose ?? false,
      onBatchStart: config.onBatchStart ?? (() => {}),
      onBatchComplete: config.onBatchComplete ?? (() => {}),
      onBatchError: config.onBatchError ?? (() => {})
    };
  }

  /**
   * Add a file to the ingestion queue
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

      if (this.config.verbose) {
        console.log(`📥 Added ${filePath} to batch (${this.pendingFiles.size} pending)`);
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

    if (this.pendingFiles.size === 0) {
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
    this.queuedBatch = null;
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
   * Process the current batch of files
   */
  private async processBatch(): Promise<IncrementalStats> {
    const filesToProcess = Array.from(this.pendingFiles);
    this.pendingFiles.clear();
    this.isIngesting = true;

    if (this.config.verbose) {
      console.log(`\n🚀 Processing batch of ${filesToProcess.length} file(s)...`);
    }

    try {
      this.config.onBatchStart(filesToProcess.length);

      // Run incremental ingestion
      const stats = await this.manager.ingestFromPaths(this.sourceConfig, {
        incremental: true,
        verbose: this.config.verbose
      });

      this.config.onBatchComplete(stats);

      // Process queued batch if any
      if (this.queuedBatch && this.queuedBatch.size > 0) {
        if (this.config.verbose) {
          console.log(`\n📦 Processing queued batch of ${this.queuedBatch.size} file(s)...`);
        }

        this.pendingFiles = this.queuedBatch;
        this.queuedBatch = null;
        this.isIngesting = false;

        // Start timer for queued batch
        this.resetBatchTimer();
      } else {
        this.isIngesting = false;
      }

      return stats;
    } catch (error) {
      this.isIngesting = false;
      throw error;
    }
  }
}
