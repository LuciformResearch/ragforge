/**
 * Interface for a generic LLM provider, abstracting different LLM implementations (e.g., Gemini, OpenAI).
 * This allows the core package to define modules that depend on LLM capabilities
 * without directly importing concrete implementations from the runtime package.
 */
export interface ILLMProvider {
  /**
   * Generates text based on a given prompt.
   * @param prompt The input prompt for the LLM.
   * @param options Optional configuration for text generation (e.g., model, temperature).
   * @returns A promise that resolves to the generated text.
   */
  generateText(prompt: string, options?: LLMGenerationOptions): Promise<string>;

  // Potentially more methods like generateChatCompletion, generateEmbeddings, etc.
  // For GraphRAG, `generateStructured` (via StructuredLLMExecutor) is more critical for extraction.
}

/**
 * Common options for LLM text generation.
 */
export interface LLMGenerationOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  // Add other common options as needed
}
