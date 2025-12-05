/**
 * Vertex AI Provider (Gemini-backed) for LLM Reranking
 *
 * Historically this wrapped Google Cloud Vertex AI, but to simplify
 * developer setup we now piggyback on the public Gemini API. The class
 * name stays the same for backward compatibility, yet we only require
 * a GEMINI_API_KEY (via @google/genai).
 */
import type { LLMProvider, LLMProviderConfig } from './llm-provider.js';
import { GeminiAPIProvider, type GeminiAPIConfig } from './gemini-api-provider.js';

export interface VertexAIConfig extends LLMProviderConfig {
  /**
   * Gemini API key. If omitted we will fall back to GEMINI_API_KEY env var.
   */
  apiKey?: string;
  /**
   * @deprecated Retained for backward compatibility. Ignored.
   */
  projectId?: string;
  /**
   * @deprecated Retained for backward compatibility. Ignored.
   */
  location?: string;
}

export class VertexAIProvider implements LLMProvider {
  private delegate: GeminiAPIProvider;

  constructor(config: VertexAIConfig) {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }

    const baseConfig: GeminiAPIConfig = {
      apiKey,
      model: config.model,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens
    };

    this.delegate = new GeminiAPIProvider(baseConfig);
  }

  async generateContent(prompt: string): Promise<string> {
    return this.delegate.generateContent(prompt);
  }

  async generateBatch(prompts: string[]): Promise<string[]> {
    if (typeof this.delegate.generateBatch === 'function') {
      return this.delegate.generateBatch(prompts);
    }
    return Promise.all(prompts.map(prompt => this.generateContent(prompt)));
  }

  async isAvailable(): Promise<boolean> {
    if (typeof this.delegate.isAvailable === 'function') {
      return this.delegate.isAvailable();
    }
    try {
      await this.generateContent('test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a default provider using GEMINI_API_KEY
   */
  static fromEnv(model: string = 'gemini-2.0-flash'): VertexAIProvider {
    return new VertexAIProvider({
      apiKey: process.env.GEMINI_API_KEY,
      model,
      temperature: 0.3,
      maxOutputTokens: 512
    });
  }
}
