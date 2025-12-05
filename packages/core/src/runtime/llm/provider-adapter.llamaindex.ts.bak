/**
 * Provider Adapter - Wraps LlamaIndex providers with a unified interface
 *
 * This allows RagForge to support 15+ LLM providers and 12+ embedding providers
 * without writing provider-specific code. Configuration is done via ragforge.config.yaml.
 */

import { Settings } from 'llamaindex';
import type { LLM, BaseEmbedding } from 'llamaindex';

// Import providers from their respective packages
import { Gemini, GeminiEmbedding } from '@llamaindex/google';
import { OpenAI, OpenAIEmbedding } from '@llamaindex/openai';
import { Anthropic } from '@llamaindex/anthropic';
import { Ollama, OllamaEmbedding } from '@llamaindex/ollama';

/**
 * Generic LLM provider configuration
 */
export interface LLMProviderConfig {
  /** Provider name (gemini, openai, anthropic, ollama, etc.) */
  provider: string;

  /** Model name (e.g., "gemini-1.5-pro", "gpt-4", "claude-3-5-sonnet-20241022") */
  model?: string;

  /** API key (not needed for Ollama) */
  apiKey?: string;

  /** Temperature for generation (0.0 to 1.0) */
  temperature?: number;

  /** Max tokens to generate */
  maxTokens?: number;

  /** Additional provider-specific options */
  options?: Record<string, any>;
}

/**
 * Generic embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  /** Provider name (gemini, openai, cohere, ollama, etc.) */
  provider: string;

  /** Model name (e.g., "text-embedding-004", "text-embedding-3-small") */
  model?: string;

  /** API key (not needed for Ollama) */
  apiKey?: string;

  /** Embedding dimensions (if customizable) */
  dimensions?: number;

  /** Additional provider-specific options */
  options?: Record<string, any>;
}

/**
 * Default model names for each provider
 */
const DEFAULT_LLM_MODELS: Record<string, string> = {
  gemini: 'models/gemini-1.5-pro',
  openai: 'gpt-4-turbo-preview',
  anthropic: 'claude-3-5-sonnet-20241022',
  ollama: 'llama3.1:8b',
  groq: 'mixtral-8x7b-32768',
  'together-ai': 'mistralai/Mixtral-8x7B-Instruct-v0.1',
};

const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  gemini: 'models/text-embedding-004',
  openai: 'text-embedding-3-small',
  cohere: 'embed-english-v3.0',
  ollama: 'nomic-embed-text',
  'together-ai': 'togethercomputer/m2-bert-80M-8k-retrieval',
};

/**
 * LLM Provider Adapter - Automatically creates the right LlamaIndex LLM instance
 */
export class LLMProviderAdapter {
  private llm: LLM;

  constructor(config: LLMProviderConfig) {
    this.llm = this.createLLM(config);
  }

  /**
   * Get the underlying LlamaIndex LLM instance
   */
  getInstance(): LLM {
    return this.llm;
  }

  /**
   * Generate text using the LLM
   * Automatically calculates maxTokens based on prompt size if not configured
   */
  async generate(prompt: string, options?: { maxTokens?: number }): Promise<string> {
    // Estimate prompt tokens (rough heuristic: 1 token ≈ 4 characters)
    const promptTokens = Math.ceil(prompt.length / 4);

    // Calculate maxTokens for output if not provided
    // Use a ratio of prompt size (default: 1x prompt length)
    // This ensures the model has enough space to respond proportionally
    const maxTokens = options?.maxTokens || Math.max(
      promptTokens, // At least as much as the prompt
      2048 // Minimum reasonable response size
    );

    const response = await this.llm.complete({
      prompt,
      // Note: LlamaIndex uses different param names per provider
      // Gemini: maxTokens, OpenAI: maxTokens, Anthropic: maxTokens
      ...(maxTokens && { maxTokens })
    });
    return response.text;
  }

  /**
   * Chat completion (for multi-turn conversations)
   */
  async chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string> {
    const response = await this.llm.chat({ messages });
    // Handle MessageContent which can be string or MessageContentDetail[]
    const content = response.message.content;
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  /**
   * Factory method - creates the appropriate LlamaIndex LLM based on provider
   */
  private createLLM(config: LLMProviderConfig): LLM {
    const provider = config.provider.toLowerCase();
    const model = config.model || DEFAULT_LLM_MODELS[provider];

    if (!model) {
      throw new Error(
        `No default model found for provider "${provider}". ` +
        `Please specify a model in your config. Supported providers: ${Object.keys(DEFAULT_LLM_MODELS).join(', ')}`
      );
    }

    // Common options
    const baseOptions = {
      model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      ...config.options,
    };

    switch (provider) {
      case 'gemini':
        return new Gemini({
          apiKey: config.apiKey || process.env.GEMINI_API_KEY,
          model: model as any, // Allow any model string, not just enum
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          ...config.options,
        });

      case 'openai':
        return new OpenAI({
          apiKey: config.apiKey || process.env.OPENAI_API_KEY,
          ...baseOptions,
        });

      case 'anthropic':
        return new Anthropic({
          apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
          ...baseOptions,
        });

      case 'ollama':
        // Ollama runs locally, no API key needed
        return new Ollama({
          ...baseOptions, // baseOptions already contains model
        });

      // Add more providers as needed
      // LlamaIndex supports: Azure, Cohere, Groq, Hugging Face, Mistral, Perplexity, Together.ai, etc.

      default:
        throw new Error(
          `Unsupported LLM provider: "${provider}". ` +
          `Supported providers: ${Object.keys(DEFAULT_LLM_MODELS).join(', ')}. ` +
          `To add support for this provider, update LLMProviderAdapter.createLLM()`
        );
    }
  }
}

/**
 * Embedding Provider Adapter - Automatically creates the right LlamaIndex embedding instance
 */
export class EmbeddingProviderAdapter {
  private embedModel: BaseEmbedding;

  constructor(config: EmbeddingProviderConfig) {
    this.embedModel = this.createEmbedding(config);
  }

  /**
   * Get the underlying LlamaIndex embedding instance
   */
  getInstance(): BaseEmbedding {
    return this.embedModel;
  }

  /**
   * Generate embeddings for text
   */
  async embed(text: string): Promise<number[]> {
    return await this.embedModel.getTextEmbedding(text);
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return await this.embedModel.getTextEmbeddingsBatch(texts);
  }

  /**
   * Factory method - creates the appropriate LlamaIndex embedding based on provider
   */
  private createEmbedding(config: EmbeddingProviderConfig): BaseEmbedding {
    const provider = config.provider.toLowerCase();
    const model = config.model || DEFAULT_EMBEDDING_MODELS[provider];

    if (!model) {
      throw new Error(
        `No default model found for embedding provider "${provider}". ` +
        `Please specify a model in your config. Supported providers: ${Object.keys(DEFAULT_EMBEDDING_MODELS).join(', ')}`
      );
    }

    // Create the appropriate embedding provider
    switch (provider) {
      case 'gemini':
      case 'google':
        return new GeminiEmbedding({
          apiKey: config.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
          model: model as any, // Allow any model string, not just enum
          ...config.options,
        });

      case 'openai':
        return new OpenAIEmbedding({
          apiKey: config.apiKey || process.env.OPENAI_API_KEY,
          model,
          dimensions: config.dimensions,
          ...config.options,
        });

      case 'ollama':
        return new OllamaEmbedding({
          model,
          ...config.options,
        });

      // Note: Cohere and other providers would need their respective packages installed
      // case 'cohere':
      //   const { CohereEmbedding } = require('@llamaindex/cohere');
      //   return new CohereEmbedding({ ... });

      default:
        throw new Error(
          `Unsupported embedding provider: "${provider}". ` +
          `Supported providers: ${Object.keys(DEFAULT_EMBEDDING_MODELS).join(', ')}. ` +
          `To add support for this provider, install the package (@llamaindex/${provider}) ` +
          `and update EmbeddingProviderAdapter.createEmbedding()`
        );
    }
  }
}

/**
 * Global provider registry - manages LLM and embedding instances
 * Uses LlamaIndex Settings for global configuration
 */
export class ProviderRegistry {
  private static llmAdapter: LLMProviderAdapter | null = null;
  private static embeddingAdapter: EmbeddingProviderAdapter | null = null;

  /**
   * Initialize LLM provider globally (sets LlamaIndex Settings.llm)
   */
  static initLLM(config: LLMProviderConfig): void {
    this.llmAdapter = new LLMProviderAdapter(config);
    Settings.llm = this.llmAdapter.getInstance();
  }

  /**
   * Initialize embedding provider globally (sets LlamaIndex Settings.embedModel)
   */
  static initEmbedding(config: EmbeddingProviderConfig): void {
    this.embeddingAdapter = new EmbeddingProviderAdapter(config);
    Settings.embedModel = this.embeddingAdapter.getInstance();
  }

  /**
   * Get the current LLM adapter
   */
  static getLLM(): LLMProviderAdapter {
    if (!this.llmAdapter) {
      throw new Error('LLM provider not initialized. Call ProviderRegistry.initLLM() first.');
    }
    return this.llmAdapter;
  }

  /**
   * Get the current embedding adapter
   */
  static getEmbedding(): EmbeddingProviderAdapter {
    if (!this.embeddingAdapter) {
      throw new Error('Embedding provider not initialized. Call ProviderRegistry.initEmbedding() first.');
    }
    return this.embeddingAdapter;
  }

  /**
   * Initialize both providers from config
   */
  static init(config: {
    llm?: LLMProviderConfig;
    embedding?: EmbeddingProviderConfig;
  }): void {
    if (config.llm) {
      this.initLLM(config.llm);
    }
    if (config.embedding) {
      this.initEmbedding(config.embedding);
    }
  }
}
