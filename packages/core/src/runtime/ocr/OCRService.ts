/**
 * OCR Service
 *
 * Unified service for OCR extraction with multiple provider support
 * Handles fallback, batch processing, and caching
 *
 * @since 2025-12-05
 */

import type { OCRProvider, OCRResult, OCROptions, BatchOCRResult, OCRProviderType } from './types.js';
import { GeminiOCRProvider } from './GeminiOCRProvider.js';
import { ReplicateOCRProvider } from './ReplicateOCRProvider.js';

export interface OCRServiceOptions {
  /** Primary provider to use */
  primaryProvider?: OCRProviderType;

  /** Enable fallback to other providers on failure */
  enableFallback?: boolean;

  /** Concurrency limit for batch processing */
  concurrency?: number;
}

/**
 * Unified OCR Service
 */
export class OCRService {
  private providers: Map<OCRProviderType, OCRProvider> = new Map();
  private primaryProvider: OCRProviderType;
  private enableFallback: boolean;
  private concurrency: number;

  constructor(options: OCRServiceOptions = {}) {
    this.primaryProvider = options.primaryProvider || 'gemini';
    this.enableFallback = options.enableFallback ?? true;
    this.concurrency = options.concurrency || 3;

    // Initialize providers
    this.providers.set('gemini', new GeminiOCRProvider());
    this.providers.set('replicate-deepseek', new ReplicateOCRProvider());
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): OCRProviderType[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.isAvailable())
      .map(([type]) => type);
  }

  /**
   * Check if any OCR provider is available
   */
  isAvailable(): boolean {
    return this.getAvailableProviders().length > 0;
  }

  /**
   * Get the primary provider (or first available)
   */
  private getPrimaryProvider(): OCRProvider | null {
    // Try primary first
    const primary = this.providers.get(this.primaryProvider);
    if (primary?.isAvailable()) {
      return primary;
    }

    // Fallback to any available
    if (this.enableFallback) {
      for (const provider of this.providers.values()) {
        if (provider.isAvailable()) {
          return provider;
        }
      }
    }

    return null;
  }

  /**
   * Get fallback providers (excluding the one that failed)
   */
  private getFallbackProviders(excludeType: OCRProviderType): OCRProvider[] {
    if (!this.enableFallback) return [];

    return Array.from(this.providers.values())
      .filter(p => p.type !== excludeType && p.isAvailable());
  }

  /**
   * Extract text from an image file
   */
  async extractText(imagePath: string, options?: OCROptions): Promise<OCRResult> {
    const provider = this.getPrimaryProvider();
    if (!provider) {
      return {
        imagePath,
        text: '',
        provider: this.primaryProvider,
        error: 'No OCR provider available. Set GEMINI_API_KEY or REPLICATE_API_TOKEN.',
      };
    }

    // Try primary provider
    let result = await provider.extractText(imagePath, options);

    // Try fallbacks if primary failed
    if (result.error && this.enableFallback) {
      const fallbacks = this.getFallbackProviders(provider.type);
      for (const fallback of fallbacks) {
        console.warn(`OCR: ${provider.name} failed, trying ${fallback.name}...`);
        result = await fallback.extractText(imagePath, options);
        if (!result.error) {
          break;
        }
      }
    }

    return result;
  }

  /**
   * Extract text from image data
   */
  async extractTextFromData(
    imageData: string | Buffer,
    mimeType: string,
    options?: OCROptions
  ): Promise<OCRResult> {
    const provider = this.getPrimaryProvider();
    if (!provider) {
      return {
        imagePath: 'inline-image',
        text: '',
        provider: this.primaryProvider,
        error: 'No OCR provider available. Set GEMINI_API_KEY or REPLICATE_API_TOKEN.',
      };
    }

    // Try primary provider
    let result = await provider.extractTextFromData(imageData, mimeType, options);

    // Try fallbacks if primary failed
    if (result.error && this.enableFallback) {
      const fallbacks = this.getFallbackProviders(provider.type);
      for (const fallback of fallbacks) {
        console.warn(`OCR: ${provider.name} failed, trying ${fallback.name}...`);
        result = await fallback.extractTextFromData(imageData, mimeType, options);
        if (!result.error) {
          break;
        }
      }
    }

    return result;
  }

  /**
   * Extract text from multiple images (batch processing)
   */
  async extractTextBatch(
    imagePaths: string[],
    options?: OCROptions
  ): Promise<BatchOCRResult> {
    const startTime = Date.now();
    const results: OCRResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Process in batches based on concurrency
    for (let i = 0; i < imagePaths.length; i += this.concurrency) {
      const batch = imagePaths.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(
        batch.map(path => this.extractText(path, options))
      );

      for (const result of batchResults) {
        results.push(result);
        if (result.error) {
          errorCount++;
        } else {
          successCount++;
        }
      }
    }

    return {
      results,
      totalProcessingTimeMs: Date.now() - startTime,
      successCount,
      errorCount,
    };
  }

  /**
   * Set the primary provider
   */
  setPrimaryProvider(type: OCRProviderType): void {
    this.primaryProvider = type;
  }

  /**
   * Enable or disable fallback
   */
  setFallbackEnabled(enabled: boolean): void {
    this.enableFallback = enabled;
  }
}

// Default singleton instance
let defaultService: OCRService | null = null;

/**
 * Get the default OCR service instance
 */
export function getOCRService(options?: OCRServiceOptions): OCRService {
  if (!defaultService) {
    defaultService = new OCRService(options);
  }
  return defaultService;
}
