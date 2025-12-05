import type { ILLMProvider, LLMGenerationOptions } from './llm-provider';

/**
 * Interface for executing structured LLM calls, typically used for extracting structured data
 * (like entities and relationships) from unstructured text.
 * This abstracts the concrete implementation of structured LLM execution,
 * allowing core components to depend on this capability without knowing the specific LLM or executor.
 */
export interface IStructuredLLMExecutor {
  /**
   * Generates a structured output (e.g., JSON) based on a prompt and a defined schema.
   * This is crucial for tasks like entity and relationship extraction for GraphRAG.
   *
   * @param prompt The prompt to guide the LLM's structured generation.
   * @param schema The schema (e.g., Zod schema or JSON schema string) that defines the expected structure of the output.
   * @param options Optional configuration for LLM generation.
   * @returns A promise that resolves to the structured object.
   */
  generateStructured<T>(prompt: string, schema: any, options?: LLMGenerationOptions): Promise<T>;

  /**
   * Gets the underlying LLMProvider used by this executor.
   */
  getLLMProvider(): ILLMProvider;
}
