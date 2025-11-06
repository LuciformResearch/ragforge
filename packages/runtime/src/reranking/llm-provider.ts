/**
 * LLM Provider abstraction for reranking
 */

export interface LLMProvider {
  /**
   * Generate text completion
   */
  generateContent(prompt: string): Promise<string>;

  /**
   * Generate multiple completions in parallel
   */
  generateBatch?(prompts: string[]): Promise<string[]>;

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
