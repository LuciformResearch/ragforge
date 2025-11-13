/**
 * Sliding Window Rate Limiter for LLM API calls
 *
 * Tracks requests within a 1-minute sliding window to respect
 * API rate limits (RPM - Requests Per Minute).
 *
 * Features:
 * - Sliding window (not fixed time buckets)
 * - Async queue management
 * - Automatic cleanup of old timestamps
 * - Per-model rate limit configuration
 */

export interface RateLimiterConfig {
  maxRequestsPerMinute: number;
  windowMs?: number; // Default: 60000 (1 minute)
}

export class RateLimiter {
  private requestTimestamps: number[] = [];
  private maxRequestsPerMinute: number;
  private windowMs: number;

  constructor(config: RateLimiterConfig) {
    this.maxRequestsPerMinute = config.maxRequestsPerMinute;
    this.windowMs = config.windowMs || 60000; // Default: 1 minute
  }

  /**
   * Wait until a slot is available within the rate limit window
   * Uses sliding window algorithm for accurate rate limiting
   */
  async acquireSlot(): Promise<void> {
    const now = Date.now();

    // Remove timestamps outside the current window
    this.cleanupOldTimestamps(now);

    // If we're under the limit, proceed immediately
    if (this.requestTimestamps.length < this.maxRequestsPerMinute) {
      this.requestTimestamps.push(now);
      return;
    }

    // We're at the limit - calculate how long to wait
    // Wait until the oldest request in the window expires
    const oldestTimestamp = this.requestTimestamps[0];
    const waitTime = oldestTimestamp + this.windowMs - now;

    if (waitTime > 0) {
      console.log(
        `[RateLimiter] Rate limit reached (${this.maxRequestsPerMinute} RPM). ` +
        `Waiting ${waitTime}ms until oldest request expires from window.`
      );
      await this.sleep(waitTime);
    }

    // Clean up again after waiting
    this.cleanupOldTimestamps(Date.now());

    // Add current timestamp and proceed
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Remove timestamps that are outside the current sliding window
   */
  private cleanupOldTimestamps(now: number): void {
    const cutoffTime = now - this.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoffTime);
  }

  /**
   * Get current number of requests in the window
   */
  getCurrentLoad(): number {
    this.cleanupOldTimestamps(Date.now());
    return this.requestTimestamps.length;
  }

  /**
   * Get remaining capacity in current window
   */
  getRemainingCapacity(): number {
    return Math.max(0, this.maxRequestsPerMinute - this.getCurrentLoad());
  }

  /**
   * Reset the rate limiter (useful for testing)
   */
  reset(): void {
    this.requestTimestamps = [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Global singleton rate limiter for shared use across tests/application
 * Automatically configured based on model
 */
export class GlobalRateLimiter {
  private static instances: Map<string, RateLimiter> = new Map();

  /**
   * Get or create a rate limiter for a specific model
   */
  static getForModel(model: string): RateLimiter {
    if (!this.instances.has(model)) {
      const config = this.getConfigForModel(model);
      this.instances.set(model, new RateLimiter(config));
    }
    return this.instances.get(model)!;
  }

  /**
   * Get rate limit configuration for a specific model
   * Based on empirical testing results
   */
  private static getConfigForModel(model: string): RateLimiterConfig {
    // Empirical results from diagnostic testing:
    // - gemma-3n-e2b-it: 15 RPM works perfectly
    // - gemini-2.0-flash-exp: 10 RPM (rate limits at 15)
    // - Default: Conservative 10 RPM

    if (model.includes('gemma-3n')) {
      return { maxRequestsPerMinute: 15 };
    } else if (model.includes('gemini-2.0-flash')) {
      return { maxRequestsPerMinute: 10 };
    } else if (model.includes('gemini') || model.includes('gemma')) {
      // Conservative default for other Gemini/Gemma models
      return { maxRequestsPerMinute: 10 };
    }

    // Very conservative default for unknown models
    return { maxRequestsPerMinute: 5 };
  }

  /**
   * Reset all rate limiters (useful for testing)
   */
  static resetAll(): void {
    this.instances.clear();
  }

  /**
   * Get statistics about current rate limiter state
   */
  static getStats(): Record<string, { current: number; max: number; remaining: number }> {
    const stats: Record<string, { current: number; max: number; remaining: number }> = {};

    for (const [model, limiter] of this.instances.entries()) {
      stats[model] = {
        current: limiter.getCurrentLoad(),
        max: (limiter as any).maxRequestsPerMinute,
        remaining: limiter.getRemainingCapacity(),
      };
    }

    return stats;
  }
}
