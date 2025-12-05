/**
 * Embedding Provider - Native Gemini implementation
 *
 * Uses @google/genai directly instead of LlamaIndex for simpler dependencies.
 *
 * To restore multi-provider support via LlamaIndex, see embedding-provider.llamaindex.ts.bak
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Gemini embedding provider options
 */
export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  dimension?: number;
  batching?: {
    size?: number;
  };
}

/**
 * Native Gemini Embedding Provider using @google/genai
 *
 * @example
 * const provider = new GeminiEmbeddingProvider({
 *   apiKey: process.env.GEMINI_API_KEY!,
 *   model: 'text-embedding-004',
 *   dimension: 768
 * });
 *
 * const embeddings = await provider.embed(['hello world', 'foo bar']);
 */
export class GeminiEmbeddingProvider {
  private client: GoogleGenAI;
  private model: string;
  private dimension?: number;
  private batchSize: number;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model || 'text-embedding-004';
    this.dimension = options.dimension;
    this.batchSize = options.batching?.size ?? 16;
  }

  /**
   * Get provider name for logging
   */
  getProviderName(): string {
    return 'gemini';
  }

  /**
   * Get model name for logging
   */
  getModelName(): string {
    return this.model;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embed(
    texts: string[],
    overrides?: { model?: string; dimension?: number }
  ): Promise<number[][]> {
    const model = overrides?.model || this.model;
    const dimension = overrides?.dimension ?? this.dimension;

    const results: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      try {
        const response = await this.client.models.embedContent({
          model,
          contents: batch.map(text => ({ parts: [{ text }] })),
          config: dimension ? { outputDimensionality: dimension } : undefined,
        });

        // Extract embeddings from response
        if (response.embeddings) {
          for (const embedding of response.embeddings) {
            if (embedding.values) {
              results.push(embedding.values);
            }
          }
        }
      } catch (error: any) {
        // Fallback to individual requests if batch fails
        console.warn(`Batch embedding failed, falling back to individual: ${error.message}`);

        for (const text of batch) {
          const singleResponse = await this.client.models.embedContent({
            model,
            contents: [{ parts: [{ text }] }],
            config: dimension ? { outputDimensionality: dimension } : undefined,
          });

          if (singleResponse.embeddings?.[0]?.values) {
            results.push(singleResponse.embeddings[0].values);
          } else {
            throw new Error(`Failed to get embedding for text: ${text.substring(0, 50)}...`);
          }
        }
      }
    }

    return results;
  }

  /**
   * Generate embedding for a single text
   */
  async embedSingle(text: string, overrides?: { model?: string; dimension?: number }): Promise<number[]> {
    const embeddings = await this.embed([text], overrides);
    return embeddings[0];
  }
}

// Legacy exports for compatibility
export type EmbeddingProviderOptions = GeminiProviderOptions;
export const EmbeddingProvider = GeminiEmbeddingProvider;
export type EmbeddingProviderType = GeminiEmbeddingProvider;
