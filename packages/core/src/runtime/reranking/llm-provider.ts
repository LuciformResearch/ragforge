/**
 * LLM Provider abstraction for reranking
 */

export interface LLMProvider {
  /**
   * Generate text completion
   * @param prompt - The prompt to send to the LLM
   * @param requestId - Unique identifier for this request (for tracing/debugging). Must be provided.
   */
  generateContent(prompt: string, requestId: string): Promise<string>;

  /**
   * Generate multiple completions in parallel
   * @param prompts - Array of prompts to send
   * @param requestId - Unique identifier for this batch request (for tracing/debugging). Must be provided.
   */
  generateBatch?(prompts: string[], requestId: string): Promise<string[]>;

  /**
   * Check if provider is available
   */
  isAvailable?(): Promise<boolean>;
}

export interface LLMProviderConfig {
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
}
