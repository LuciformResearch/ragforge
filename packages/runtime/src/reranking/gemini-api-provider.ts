/**
 * Gemini API Provider for LLM Reranking
 *
 * Uses Google's Gemini API (via @google/genai) for text generation.
 * Simpler than Vertex AI - just requires an API key.
 *
 * Advantages over Vertex AI:
 * - Simpler setup (just API key)
 * - All models available globally (no regional restrictions)
 * - Free tier available (60 req/min)
 * - Works with Gemma 3n E2B everywhere
 */

import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, LLMProviderConfig } from './llm-provider.js';
import { GlobalRateLimiter } from './rate-limiter.js';

export type RateLimitStrategy = 'proactive' | 'reactive' | 'none';

export interface GeminiAPIConfig extends LLMProviderConfig {
  apiKey: string;
  retryAttempts?: number; // Number of retry attempts for rate limits (default: 3)
  retryDelay?: number; // Initial retry delay in ms (default: 1000, will use exponential backoff)
  rateLimitStrategy?: RateLimitStrategy; // Rate limit handling strategy (default: 'reactive')
  // 'reactive' (default): Launch all requests, wait intelligently after 429 (model-agnostic)
  // 'proactive': Use sliding window to prevent rate limits before they happen
  // 'none': No rate limiting (let API handle everything)
}

export class GeminiAPIProvider implements LLMProvider {
  private client: GoogleGenAI;
  private modelName: string;
  private temperature: number;
  private maxOutputTokens: number;
  private retryAttempts: number;
  private retryDelay: number;
  private rateLimitStrategy: RateLimitStrategy;
  private requestTimestamps: number[] = []; // For reactive strategy

  constructor(config: GeminiAPIConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.modelName = config.model;
    this.temperature = config.temperature || 0.3;
    this.maxOutputTokens = config.maxOutputTokens || 512;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.rateLimitStrategy = config.rateLimitStrategy ?? 'reactive'; // Default to reactive (model-agnostic)
  }

  async generateContent(prompt: string): Promise<string> {
    const promptSize = prompt.length;
    console.log(`[GeminiAPIProvider] 📤 Sending request | Prompt: ${promptSize} chars | Model: ${this.modelName}`);

    const startTime = Date.now();

    // Add random jitter (1-2 seconds) to avoid thundering herd
    const jitter = 1000 + Math.random() * 1000; // Between 1000ms and 2000ms
    console.log(`[GeminiAPIProvider] ⏱️  Adding jitter: ${jitter.toFixed(0)}ms`);
    await this.sleep(jitter);

    // Apply proactive rate limiting if strategy is 'proactive'
    if (this.rateLimitStrategy === 'proactive') {
      const rateLimiter = GlobalRateLimiter.getForModel(this.modelName);
      await rateLimiter.acquireSlot();
    }

    // Track request timestamp for reactive strategy
    if (this.rateLimitStrategy === 'reactive') {
      this.requestTimestamps.push(Date.now());
      // DON'T clean up here - we'll clean up only on success or final failure
    }

    const result = await this.withRetry(async () => {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          temperature: this.temperature,
          maxOutputTokens: this.maxOutputTokens,
        }
      });

      const text = response.text;

      if (!text) {
        throw new Error('No text in response');
      }

      return text;
    });

    // Success! Clean up timestamps older than 30 seconds
    if (this.rateLimitStrategy === 'reactive') {
      const thirtySecondsAgo = Date.now() - 30000;
      const beforeCleanup = this.requestTimestamps.length;
      this.requestTimestamps = this.requestTimestamps.filter(ts => ts > thirtySecondsAgo);
      const afterCleanup = this.requestTimestamps.length;
      console.log(
        `[GeminiAPIProvider] 🧹 Success cleanup: kept last 30s timestamps (${beforeCleanup} → ${afterCleanup})`
      );
    }

    const duration = Date.now() - startTime;
    const responseSize = result.length;
    console.log(`[GeminiAPIProvider] 📥 Response received | Response: ${responseSize} chars | Duration: ${duration}ms`);

    return result;
  }


  /**
   * Execute a function with retry logic for rate limits
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: any;
    let consecutiveFullWaits = 0; // Track consecutive full-minute waits

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        // Add logging for each attempt
        if (attempt > 0) {
          console.log(`[GeminiAPIProvider] 🔄 Retry attempt ${attempt}/${this.retryAttempts}`);
        }
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Check if it's a rate limit error (429)
        const isRateLimit = error.message?.includes('429') ||
                           error.message?.includes('RESOURCE_EXHAUSTED') ||
                           error.message?.includes('quota');

        console.log(
          `[GeminiAPIProvider] ❌ Attempt ${attempt + 1}/${this.retryAttempts + 1} failed. ` +
          `Is rate limit: ${isRateLimit}, Error: ${error.message?.substring(0, 100)}`
        );

        if (!isRateLimit || attempt === this.retryAttempts) {
          // Not a rate limit or last attempt - throw immediately
          console.log(`[GeminiAPIProvider] 🛑 Giving up after ${attempt + 1} attempts`);

          // Final failure cleanup: clear all timestamps
          if (this.rateLimitStrategy === 'reactive') {
            const clearedCount = this.requestTimestamps.length;
            this.requestTimestamps = [];
            console.log(`[GeminiAPIProvider] 🧹 Final failure cleanup: cleared ${clearedCount} timestamps`);
          }

          throw new Error(`Gemini API generation failed: ${error.message}`);
        }

        // Calculate retry delay based on strategy
        let retryAfter: number;

        if (this.rateLimitStrategy === 'reactive') {
          // REACTIVE STRATEGY: Wait until the oldest request is >1 minute old
          retryAfter = this.calculateReactiveDelay();

          console.log(
            `[GeminiAPIProvider] 📊 State before decision: consecutiveFullWaits=${consecutiveFullWaits}, ` +
            `retryAfter=${retryAfter}ms, timestamps=${this.requestTimestamps.length}`
          );

          // Micro-retry logic: if we've waited ~60s at least once and would wait again,
          // use shorter waits to handle sliding window timing issues
          if (consecutiveFullWaits > 0 && retryAfter > 50000) {
            // We're stuck in the timing zone - use micro-retries instead
            // Clean timestamps older than 58 seconds to force a fresh calculation next time
            const now = Date.now();
            const cleanupThreshold = now - 58000; // 58 seconds ago
            const beforeCleanup = this.requestTimestamps.length;
            this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cleanupThreshold);
            const afterCleanup = this.requestTimestamps.length;

            // Use short micro-retry delays that increase with attempts
            const microRetryDelay = Math.min(5000 * consecutiveFullWaits, 15000);
            console.warn(
              `[GeminiAPIProvider] 🔬 MICRO-RETRY: Still rate limited after ${consecutiveFullWaits} full wait(s). ` +
              `Cleaned ${beforeCleanup - afterCleanup} old timestamps. ` +
              `Using micro-retry (${microRetryDelay}ms) instead of full wait.`
            );
            retryAfter = microRetryDelay;
            consecutiveFullWaits++; // Increment for next micro-retry if needed
          } else if (retryAfter > 50000) {
            // We're about to wait a full minute - count it
            consecutiveFullWaits++;
            console.warn(
              `[GeminiAPIProvider] ⏳ FULL WAIT #${consecutiveFullWaits}: Rate limit hit (reactive strategy). ` +
              `Waiting ${retryAfter}ms until oldest request expires from 1-minute window.`
            );
          } else {
            // Short wait or no wait - reset counter
            const wasNonZero = consecutiveFullWaits > 0;
            consecutiveFullWaits = 0;
            if (retryAfter > 0) {
              console.warn(
                `[GeminiAPIProvider] 🔄 SHORT WAIT: Rate limit hit (reactive strategy). ` +
                `Waiting ${retryAfter}ms${wasNonZero ? ' (reset counter)' : ''}.`
              );
            }
          }
        } else {
          // DEFAULT STRATEGY: Exponential backoff with API suggestions
          retryAfter = this.retryDelay * Math.pow(2, attempt);

          const retryMatch = error.message?.match(/retryDelay[\"']?\s*:\s*[\"']?(\d+)s/);
          if (retryMatch) {
            const suggestedDelay = parseInt(retryMatch[1], 10) * 1000;
            retryAfter = Math.min(suggestedDelay * 0.5, retryAfter);
          }

          // Cap at reasonable maximum (30s)
          retryAfter = Math.min(retryAfter, 30000);

          console.warn(
            `[GeminiAPIProvider] Rate limit hit (attempt ${attempt + 1}/${this.retryAttempts + 1}). ` +
            `Retrying in ${retryAfter}ms...`
          );
        }

        await this.sleep(retryAfter);
      }
    }

    throw new Error(`Gemini API generation failed after ${this.retryAttempts + 1} attempts: ${lastError.message}`);
  }

  /**
   * Calculate delay for reactive strategy
   * Wait until the oldest request in our tracking is >1 minute old
   *
   * NOTE: Does NOT clean up timestamps - cleanup happens only on success or final failure
   */
  private calculateReactiveDelay(addSafetyBuffer: boolean = true): number {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Count how many requests are in the last minute (without modifying the array)
    const recentRequests = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

    if (recentRequests.length === 0) {
      // No requests in last minute, proceed immediately
      console.log(`[GeminiAPIProvider] 📊 No requests in last 60s, proceeding immediately`);
      return 0;
    }

    // Find the oldest request timestamp in the last minute
    const oldestTimestamp = Math.min(...recentRequests);
    const age = now - oldestTimestamp;

    // If oldest request is already >1 minute old, proceed immediately
    if (age >= 60000) {
      console.log(`[GeminiAPIProvider] 📊 Oldest request is ${(age / 1000).toFixed(1)}s old (>60s), proceeding`);
      return 0;
    }

    // Wait until it will be 1 minute old + safety buffer
    // Safety buffer (2s) helps avoid edge cases with sliding window timing
    const safetyBufferMs = addSafetyBuffer ? 2000 : 0;
    const delay = 60000 - age + safetyBufferMs;

    console.log(
      `[GeminiAPIProvider] 📊 ${recentRequests.length} requests in last 60s (total tracked: ${this.requestTimestamps.length}). ` +
      `Oldest is ${(age / 1000).toFixed(1)}s old. Waiting ${(delay / 1000).toFixed(1)}s${addSafetyBuffer ? ' (+2s buffer)' : ''}.`
    );
    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async generateBatch(prompts: string[]): Promise<string[]> {
    // Gemini API supports parallel requests
    return Promise.all(prompts.map(p => this.generateContent(p)));
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple ping test
      await this.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a default provider using environment variables
   */
  static fromEnv(model: string = 'gemma-3n-e2b-it'): GeminiAPIProvider {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }

    return new GeminiAPIProvider({
      apiKey,
      model,
      temperature: 0.3,
      maxOutputTokens: 512
    });
  }
}
