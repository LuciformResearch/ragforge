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
import type { AgentLogger } from '../agents/rag-agent.js';

export interface FileWatcherConfig extends IngestionQueueConfig {
  // projectId is inherited from IngestionQueueConfig
  /**
   * Optional AgentLogger for structured logging
   */
  logger?: AgentLogger;
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
  private logger?: AgentLogger;
  private paused = false;
  private pausedEvents: Array<{ path: string; type: 'add' | 'change' | 'unlink' }> = [];

  constructor(
    private manager: IncrementalIngestionManager,
    private sourceConfig: CodeSourceConfig,
    config: FileWatcherConfig = {}
  ) {
    this.config = config;
    this.logger = config.logger;
    this.queue = new IngestionQueue(manager, sourceConfig, { ...config, logger: this.logger });
  }

  /**
   * Set or update the logger
   */
  setLogger(logger: AgentLogger): void {
    this.logger = logger;
    this.queue.setLogger(logger);
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
        const watched = this.watcher!.getWatched();
        const paths = Object.keys(watched);
        const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0);

        if (this.config.verbose) {
          console.log('✅ File watcher ready\n');
        }

        // Log to AgentLogger
        this.logger?.logWatcherStarted(patterns, fileCount);

        if (this.config.onWatchStart) {
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
   * Check if watcher is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause the watcher - events are ignored (not queued)
   * Use this before agent-triggered file edits to prevent double ingestion
   */
  pause(): void {
    if (!this.watcher) {
      return;
    }
    this.paused = true;
    if (this.config.verbose) {
      console.log('⏸️ File watcher paused');
    }
  }

  /**
   * Resume the watcher - start processing events again
   * Does NOT replay events that occurred while paused (they're ignored, not queued)
   */
  resume(): void {
    if (!this.watcher) {
      return;
    }
    this.paused = false;
    if (this.config.verbose) {
      console.log('▶️ File watcher resumed');
    }
  }

  /**
   * Pause, execute a function, then resume
   * Useful for agent-triggered edits that should bypass the watcher
   */
  async withPause<T>(fn: () => Promise<T>): Promise<T> {
    this.pause();
    try {
      return await fn();
    } finally {
      this.resume();
    }
  }

  /**
   * Handle file system events
   */
  private handleFileEvent(filePath: string, eventType: 'add' | 'change' | 'unlink'): void {
    // Ignore events while paused (agent-triggered edits handle their own ingestion)
    if (this.paused) {
      if (this.config.verbose) {
        console.log(`⏸️ Ignoring ${eventType} (paused): ${filePath}`);
      }
      return;
    }

    if (this.config.verbose) {
      const emoji = eventType === 'add' ? '➕' : eventType === 'change' ? '✏️' : '➖';
      console.log(`${emoji} ${eventType.toUpperCase()}: ${filePath}`);
    }

    // Log to AgentLogger
    this.logger?.logFileChange(filePath, eventType);

    if (this.config.onFileChange) {
      this.config.onFileChange(filePath, eventType);
    }

    // Add to appropriate queue based on event type
    if (eventType === 'unlink') {
      // File deleted - queue for node deletion
      this.queue.addDeletedFile(filePath);
    } else {
      // File added or changed - queue for ingestion
      this.queue.addFile(filePath);
    }
  }
}
