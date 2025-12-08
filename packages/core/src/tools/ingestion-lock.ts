/**
 * Ingestion Lock - Coordinates file modifications with RAG queries
 *
 * When a file is being modified and re-ingested, RAG queries should wait
 * or be notified that data might be stale.
 */

import type { AgentLogger } from '../runtime/agents/rag-agent.js';

export interface IngestionStatus {
  isLocked: boolean;
  currentFile?: string;
  startedAt?: Date;
  pendingFiles: string[];
}

export interface IngestionLockOptions {
  /** Timeout in ms before auto-unlock (safety net). Default: 30000 */
  timeout?: number;
  /** Callback when lock state changes */
  onStatusChange?: (status: IngestionStatus) => void;
  /** Optional AgentLogger for structured logging */
  logger?: AgentLogger;
}

/**
 * Manages ingestion lock state
 *
 * Usage:
 * ```typescript
 * const lock = new IngestionLock();
 *
 * // In file tools
 * const release = await lock.acquire('src/utils.ts');
 * try {
 *   await reIngestFile(...);
 * } finally {
 *   release();
 * }
 *
 * // In RAG tools (wrapper)
 * if (lock.isLocked()) {
 *   return { error: 'Ingestion in progress...', status: lock.getStatus() };
 * }
 * ```
 */
export class IngestionLock {
  private locked: boolean = false;
  private currentFile?: string;
  private startedAt?: Date;
  private pendingFiles: string[] = [];
  private timeoutHandle?: NodeJS.Timeout;
  private waitingPromises: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private options: Omit<Required<IngestionLockOptions>, 'logger'>;
  private logger?: AgentLogger;

  constructor(options: IngestionLockOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30000,
      onStatusChange: options.onStatusChange ?? (() => {}),
    };
    this.logger = options.logger;
  }

  /**
   * Set or update the logger (useful when logger is created after lock)
   */
  setLogger(logger: AgentLogger): void {
    this.logger = logger;
  }

  /**
   * Check if ingestion is currently in progress
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get current status
   */
  getStatus(): IngestionStatus {
    return {
      isLocked: this.locked,
      currentFile: this.currentFile,
      startedAt: this.startedAt,
      pendingFiles: [...this.pendingFiles],
    };
  }

  /**
   * Acquire the lock for a file
   * Returns a release function to call when done
   * @param filePath - Identifier for the lock (usually file path or operation name)
   * @param timeoutMs - Optional timeout override. 0 = no timeout (for initial ingestions). Default uses constructor timeout.
   */
  async acquire(filePath: string, timeoutMs?: number): Promise<() => void> {
    // If already locked, add to pending and wait
    if (this.locked) {
      this.pendingFiles.push(filePath);
      this.notifyStatusChange();

      await new Promise<void>((resolve, reject) => {
        this.waitingPromises.push({ resolve, reject });
      });

      // Remove from pending when we get the lock
      const idx = this.pendingFiles.indexOf(filePath);
      if (idx >= 0) this.pendingFiles.splice(idx, 1);
    }

    // Acquire lock
    this.locked = true;
    this.currentFile = filePath;
    this.startedAt = new Date();
    this.notifyStatusChange();

    // Log acquisition
    this.logger?.logLock('acquired', filePath);

    // Safety timeout (0 = no timeout for long-running initial ingestions)
    const timeout = timeoutMs !== undefined ? timeoutMs : this.options.timeout;
    if (timeout > 0) {
      this.timeoutHandle = setTimeout(() => {
        console.warn(`[IngestionLock] Timeout reached for ${filePath}, force releasing`);
        this.logger?.logLock('timeout', filePath, timeout);
        this.release();
      }, timeout);
    }

    // Return release function
    return () => this.release();
  }

  /**
   * Release the lock
   */
  private release(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }

    // Log release
    this.logger?.logLock('released');

    this.locked = false;
    this.currentFile = undefined;
    this.startedAt = undefined;
    this.notifyStatusChange();

    // Wake up next waiting promise
    const next = this.waitingPromises.shift();
    if (next) {
      next.resolve();
    }
  }

  /**
   * Wait for the lock to be released
   * Useful for RAG tools that want to wait instead of failing
   */
  async waitForUnlock(timeoutMs: number = 5000): Promise<boolean> {
    if (!this.locked) return true;

    return new Promise<boolean>((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.locked) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve(true);
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, timeoutMs);
    });
  }

  /**
   * Get a user-friendly message about the current status
   */
  getBlockingMessage(): string {
    if (!this.locked) {
      return '';
    }

    const elapsed = this.startedAt
      ? Math.round((Date.now() - this.startedAt.getTime()) / 1000)
      : 0;

    let msg = `⏳ Ingestion in progress for "${this.currentFile}" (${elapsed}s)`;

    if (this.pendingFiles.length > 0) {
      msg += `\n   Pending: ${this.pendingFiles.join(', ')}`;
    }

    msg += '\n   RAG queries will return fresh data once complete.';
    msg += '\n   Please retry your query in a moment.';

    return msg;
  }

  private notifyStatusChange(): void {
    this.options.onStatusChange(this.getStatus());
  }
}

/**
 * Singleton instance for global lock coordination
 */
let globalLock: IngestionLock | null = null;

export function getGlobalIngestionLock(): IngestionLock {
  if (!globalLock) {
    globalLock = new IngestionLock({
      onStatusChange: (status) => {
        if (status.isLocked) {
          console.log(`🔒 Ingestion lock acquired: ${status.currentFile}`);
        } else {
          console.log(`🔓 Ingestion lock released`);
        }
      },
    });
  }
  return globalLock;
}

/**
 * Create a wrapper for RAG tool handlers that checks the lock
 */
export function withIngestionLock<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  lock: IngestionLock,
  options: {
    /** If true, wait for unlock instead of failing immediately */
    waitForUnlock?: boolean;
    /** Max wait time in ms */
    waitTimeout?: number;
    /** Optional logger for blocked queries */
    logger?: AgentLogger;
  } = {}
): T {
  return (async (...args: Parameters<T>) => {
    if (lock.isLocked()) {
      const status = lock.getStatus();

      // Log that query is blocked
      options.logger?.logLock('blocked', status.currentFile);

      if (options.waitForUnlock) {
        const waitStart = Date.now();
        const unlocked = await lock.waitForUnlock(options.waitTimeout ?? 5000);
        const waitTime = Date.now() - waitStart;

        if (!unlocked) {
          options.logger?.logLock('timeout', status.currentFile, waitTime);
          return {
            error: 'Ingestion timeout',
            message: lock.getBlockingMessage(),
            status: lock.getStatus(),
          };
        }
      } else {
        return {
          error: 'Ingestion in progress',
          message: lock.getBlockingMessage(),
          status: lock.getStatus(),
          retry_after_ms: 1000,
        };
      }
    }

    return handler(...args);
  }) as T;
}
