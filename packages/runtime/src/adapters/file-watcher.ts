/**
 * File Watcher for Incremental Ingestion
 *
 * Monitors source code files for changes and triggers incremental ingestion
 * Uses chokidar for efficient file watching
 */

import chokidar from 'chokidar';
import type { CodeSourceConfig } from './code-source-adapter.js';
import type { IncrementalIngestionManager } from './incremental-ingestion.js';
import { IngestionQueue, type IngestionQueueConfig } from './ingestion-queue.js';

export interface FileWatcherConfig extends IngestionQueueConfig {
  /**
   * Chokidar options for file watching
   * See: https://github.com/paulmillr/chokidar#api
   */
  watchOptions?: chokidar.WatchOptions;

  /**
   * Callback when watcher starts
   */
  onWatchStart?: (paths: string[]) => void;

  /**
   * Callback when file changes are detected
   */
  onFileChange?: (filePath: string, eventType: 'add' | 'change' | 'unlink') => void;
}

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private queue: IngestionQueue;
  private config: FileWatcherConfig;

  constructor(
    private manager: IncrementalIngestionManager,
    private sourceConfig: CodeSourceConfig,
    config: FileWatcherConfig = {}
  ) {
    this.config = config;
    this.queue = new IngestionQueue(manager, sourceConfig, config);
  }

  /**
   * Start watching files for changes
   */
  async start(): Promise<void> {
    if (this.watcher) {
      throw new Error('Watcher already started');
    }

    const { root = '.', include, exclude = [] } = this.sourceConfig;

    if (!include || include.length === 0) {
      throw new Error('No include patterns specified in source config');
    }

    // Convert glob patterns to absolute paths
    const patterns = include.map(pattern => `${root}/${pattern}`);

    if (this.config.verbose) {
      console.log('\n👀 Starting file watcher...');
      console.log(`   Watching patterns: ${patterns.join(', ')}`);
      if (exclude.length > 0) {
        console.log(`   Ignoring patterns: ${exclude.join(', ')}`);
      }
    }

    // Create chokidar watcher
    this.watcher = chokidar.watch(patterns, {
      ignored: exclude,
      persistent: true,
      ignoreInitial: true, // Don't trigger on startup
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait 300ms for file writes to finish
        pollInterval: 100
      },
      ...this.config.watchOptions
    });

    // Set up event handlers
    this.watcher
      .on('add', (path) => this.handleFileEvent(path, 'add'))
      .on('change', (path) => this.handleFileEvent(path, 'change'))
      .on('unlink', (path) => this.handleFileEvent(path, 'unlink'))
      .on('error', (error) => {
        console.error('❌ Watcher error:', error);
      });

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', () => {
        if (this.config.verbose) {
          console.log('✅ File watcher ready\n');
        }
        if (this.config.onWatchStart) {
          const watched = this.watcher!.getWatched();
          const paths = Object.keys(watched);
          this.config.onWatchStart(paths);
        }
        resolve();
      });
    });
  }

  /**
   * Stop watching files and flush any pending changes
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    if (this.config.verbose) {
      console.log('\n🛑 Stopping file watcher...');
    }

    // Flush pending changes
    await this.queue.flush();

    // Close watcher
    await this.watcher.close();
    this.watcher = null;

    // Stop queue
    this.queue.stop();

    if (this.config.verbose) {
      console.log('✅ Watcher stopped\n');
    }
  }

  /**
   * Get the ingestion queue
   * Useful for manual control or inspection
   */
  getQueue(): IngestionQueue {
    return this.queue;
  }

  /**
   * Check if watcher is running
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Handle file system events
   */
  private handleFileEvent(filePath: string, eventType: 'add' | 'change' | 'unlink'): void {
    if (this.config.verbose) {
      const emoji = eventType === 'add' ? '➕' : eventType === 'change' ? '✏️' : '➖';
      console.log(`${emoji} ${eventType.toUpperCase()}: ${filePath}`);
    }

    if (this.config.onFileChange) {
      this.config.onFileChange(filePath, eventType);
    }

    // Add to ingestion queue
    this.queue.addFile(filePath);
  }
}
