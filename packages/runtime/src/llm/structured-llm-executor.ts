/**
 * Unified Structured LLM Executor
 *
 * Provides a unified interface for all LLM structured generation:
 * - Reranking
 * - Summarization
 * - Custom structured outputs
 * - Embedding generation with graph context
 */

import { LLMProviderAdapter, EmbeddingProviderAdapter } from './provider-adapter.js';
import type { LLM, BaseEmbedding } from 'llamaindex';

// ===== CORE INTERFACES =====

/**
 * Input field configuration
 */
export interface InputFieldConfig {
  name: string;
  maxLength?: number;
  preferSummary?: boolean;
  prompt?: string;
  transform?: (value: any) => string;
}

/**
 * Relationship configuration for context enrichment
 */
export interface RelationshipConfig {
  type: string;
  direction?: 'outgoing' | 'incoming' | 'both';
  maxItems?: number;
  fields?: string[];
}

/**
 * Input context configuration
 */
export interface InputContextConfig {
  relationships?: string[] | RelationshipConfig[];
  summaries?: boolean | string[];
  contextQuery?: string;
}

/**
 * Output field schema
 */
export interface OutputFieldSchema<T = any> {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  prompt?: string;
  required?: boolean;
  default?: T;
  enum?: string[];
  min?: number;
  max?: number;
  properties?: Record<string, OutputFieldSchema>;
  items?: OutputFieldSchema;
  validate?: (value: T) => boolean | string;
}

/**
 * Output schema
 */
export type OutputSchema<T = any> = {
  [K in keyof T]: OutputFieldSchema<T[K]>;
};

/**
 * LLM configuration
 */
export interface LLMConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  providers: string[];
  retries: number;
  backoff: 'exponential' | 'linear';
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  ttl?: number;
  key?: (input: any) => string;
}

/**
 * Main configuration for structured LLM calls
 */
export interface LLMStructuredCallConfig<TInput = any, TOutput = any> {
  // === INPUTS ===
  inputFields: (string | InputFieldConfig)[];
  inputContext?: InputContextConfig;
  contextData?: Record<string, any>;

  // === PROMPTS ===
  systemPrompt?: string;
  userTask?: string;
  examples?: string;
  instructions?: string;

  // === OUTPUT ===
  outputSchema: OutputSchema<TOutput>;
  outputFormat?: 'json' | 'xml' | 'auto';
  mergeStrategy?: 'append' | 'replace' | 'custom';
  customMerge?: (entity: TInput, generated: TOutput) => TInput & TOutput;

  // === LLM ===
  llm?: LLMConfig;
  fallback?: FallbackConfig;

  // === PERFORMANCE ===
  batchSize?: number;
  parallel?: number;
  tokenBudget?: number;
  onOverflow?: 'truncate' | 'split' | 'error';
  cache?: boolean | CacheConfig;
}

/**
 * Embedding generation configuration
 */
export interface EmbeddingGenerationConfig {
  sourceFields: string[];
  targetField?: string;
  provider?: {
    provider?: string;
    model?: string;
    dimensions?: number;
  };
  combineStrategy?: 'concat' | 'weighted' | 'separate';
  weights?: Record<string, number>;
  includeRelationships?: string[] | RelationshipConfig[];
  relationshipFormat?: 'text' | 'structured';
  persistToNeo4j?: boolean;
  batchSize?: number;
}

// ===== INTERNAL TYPES =====

interface Batch<T> {
  items: T[];
  tokenEstimate: number;
}

interface LLMResponse {
  text: string;
  format: 'json' | 'xml';
}

/**
 * Unified executor for all LLM structured operations
 */
export class StructuredLLMExecutor {
  private llmProviders: Map<string, LLMProviderAdapter> = new Map();
  private embeddingProviders: Map<string, EmbeddingProviderAdapter> = new Map();

  constructor(
    private defaultLLMConfig?: LLMConfig,
    private defaultEmbeddingConfig?: { provider?: string; model?: string }
  ) {}

  /**
   * Execute structured LLM generation on batch of items
   */
  async executeLLMBatch<TInput, TOutput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[]> {
    // 1. Validate config
    this.validateLLMConfig(config);

    // 2. Pack items into optimal batches
    const batches = this.packBatches(items, config);

    // 3. Execute batches in parallel
    const results = await this.executeParallelLLM(batches, config);

    // 4. Parse outputs
    const parsed = this.parseOutputs(results, config.outputSchema);

    // 5. Merge with inputs
    return this.mergeResults(items, parsed, config);
  }

  /**
   * Generate embeddings for batch of items
   */
  async generateEmbeddings<T>(
    items: T[],
    config: EmbeddingGenerationConfig
  ): Promise<(T & { [key: string]: number[] })[]> {
    const targetField = config.targetField || 'generated_embedding';

    // Get embedding provider
    const provider = this.getEmbeddingProvider(config.provider);

    // Build texts to embed
    const texts = items.map(item => this.buildEmbeddingText(item, config));

    // Generate embeddings in batches
    const batchSize = config.batchSize || 20;
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await provider.embedBatch(batch);
      embeddings.push(...batchEmbeddings);
    }

    // Merge embeddings with items
    return items.map((item, index) => ({
      ...item,
      [targetField]: embeddings[index]
    })) as any;
  }

  // ===== PRIVATE METHODS =====

  private validateLLMConfig<T>(config: LLMStructuredCallConfig<T, any>): void {
    if (!config.inputFields || config.inputFields.length === 0) {
      throw new Error('inputFields is required and must not be empty');
    }

    if (!config.outputSchema || Object.keys(config.outputSchema).length === 0) {
      throw new Error('outputSchema is required and must not be empty');
    }

    // Validate output schema
    for (const [fieldName, fieldSchema] of Object.entries(config.outputSchema)) {
      if (!fieldSchema.type) {
        throw new Error(`Field ${fieldName} must have a type`);
      }
      if (!fieldSchema.description) {
        throw new Error(`Field ${fieldName} must have a description`);
      }
    }
  }

  private packBatches<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): Batch<T>[] {
    const tokenBudget = config.tokenBudget || 8000;
    const batchSize = config.batchSize || 20;
    const estimatedResponseTokens = this.estimateResponseSize(config.outputSchema);
    const baseOverhead = 500; // System prompt, instructions, etc.

    const batches: Batch<T>[] = [];
    let currentBatch: T[] = [];
    let currentTokens = baseOverhead;

    for (const item of items) {
      const itemTokens = this.estimateItemTokens(item, config);
      const wouldExceed = currentTokens + itemTokens + estimatedResponseTokens > tokenBudget;

      if (wouldExceed && currentBatch.length > 0) {
        batches.push({ items: currentBatch, tokenEstimate: currentTokens });
        currentBatch = [];
        currentTokens = baseOverhead;
      }

      currentBatch.push(item);
      currentTokens += itemTokens;

      if (currentBatch.length >= batchSize) {
        batches.push({ items: currentBatch, tokenEstimate: currentTokens });
        currentBatch = [];
        currentTokens = baseOverhead;
      }
    }

    if (currentBatch.length > 0) {
      batches.push({ items: currentBatch, tokenEstimate: currentTokens });
    }

    return batches;
  }

  private estimateResponseSize(schema: OutputSchema<any>): number {
    // Rough estimate: 100 tokens per field
    return Object.keys(schema).length * 100;
  }

  private estimateItemTokens<T>(
    item: T,
    config: LLMStructuredCallConfig<T, any>
  ): number {
    let tokens = 0;

    for (const fieldConfig of config.inputFields) {
      const fieldName = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.name;
      const value = (item as any)[fieldName];

      if (typeof value === 'string') {
        tokens += Math.ceil(value.length / 4); // Rough estimate: 4 chars per token
      } else if (value) {
        tokens += 50; // Other types
      }
    }

    return tokens;
  }

  private async executeParallelLLM<T>(
    batches: Batch<T>[],
    config: LLMStructuredCallConfig<T, any>
  ): Promise<LLMResponse[]> {
    const parallel = config.parallel || 5;
    const results: LLMResponse[] = [];

    for (let i = 0; i < batches.length; i += parallel) {
      const batchGroup = batches.slice(i, i + parallel);

      const groupResults = await Promise.all(
        batchGroup.map(batch => this.executeSingleLLMBatch(batch, config))
      );

      results.push(...groupResults);
    }

    return results;
  }

  private async executeSingleLLMBatch<T>(
    batch: Batch<T>,
    config: LLMStructuredCallConfig<T, any>
  ): Promise<LLMResponse> {
    // Build prompt
    const prompt = this.buildPrompt(batch.items, config);

    // Get LLM provider
    const provider = this.getLLMProvider(config.llm);

    // Call LLM
    const response = await provider.generate(prompt);

    return {
      text: response,
      format: config.outputFormat === 'json' ? 'json' : 'xml'
    };
  }

  private buildPrompt<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): string {
    const parts: string[] = [];

    // System context
    if (config.systemPrompt) {
      parts.push(config.systemPrompt);
      parts.push('');
    }

    // User task
    if (config.userTask) {
      parts.push('## Task');
      parts.push(config.userTask);
      parts.push('');
    }

    // Context data
    if (config.contextData) {
      parts.push('## Context');
      parts.push(JSON.stringify(config.contextData, null, 2));
      parts.push('');
    }

    // Items to analyze
    parts.push(`## Items to Analyze (${items.length} total)`);
    parts.push('');
    parts.push(this.formatItems(items, config));
    parts.push('');

    // Output instructions
    parts.push('## Required Output Format');
    parts.push(this.generateOutputInstructions(config.outputSchema));
    parts.push('');

    // Additional instructions
    if (config.instructions) {
      parts.push('## Additional Instructions');
      parts.push(config.instructions);
      parts.push('');
    }

    return parts.join('\n');
  }

  private formatItems<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): string {
    return items.map((item, index) => {
      const lines: string[] = [`[Item ${index}]`];

      for (const fieldConfig of config.inputFields) {
        const fieldName = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.name;
        let value = (item as any)[fieldName];

        // Apply transformations
        if (typeof fieldConfig !== 'string') {
          if (fieldConfig.transform) {
            value = fieldConfig.transform(value);
          }

          if (fieldConfig.maxLength && typeof value === 'string') {
            value = this.truncate(value, fieldConfig.maxLength);
          }

          if (fieldConfig.prompt) {
            lines.push(`${fieldName} (${fieldConfig.prompt}):`);
          } else {
            lines.push(`${fieldName}:`);
          }
        } else {
          lines.push(`${fieldName}:`);
        }

        lines.push(this.formatValue(value));
      }

      return lines.join('\n');
    }).join('\n\n');
  }

  private formatValue(value: any): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  }

  private truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 3) + '...';
  }

  private generateOutputInstructions(schema: OutputSchema<any>): string {
    const instructions: string[] = [
      'You MUST respond with structured XML in the following format:',
      '',
      '<items>'
    ];

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const required = fieldSchema.required ? ' (REQUIRED)' : '';
      instructions.push(`  <item id="INDEX">`);
      instructions.push(`    <${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);

      if (fieldSchema.prompt) {
        instructions.push(`    <!-- ${fieldSchema.prompt} -->`);
      }

      instructions.push(`  </item>`);
    }

    instructions.push('</items>');
    instructions.push('');
    instructions.push('Replace INDEX with 0, 1, 2, etc. for each item.');

    return instructions.join('\n');
  }

  private parseOutputs<TOutput>(
    responses: LLMResponse[],
    schema: OutputSchema<TOutput>
  ): TOutput[] {
    const results: TOutput[] = [];

    for (const response of responses) {
      // TODO: Implement XML/JSON parsing with schema validation
      // For now, placeholder
      results.push({} as TOutput);
    }

    return results;
  }

  private mergeResults<TInput, TOutput>(
    inputs: TInput[],
    outputs: TOutput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): (TInput & TOutput)[] {
    if (config.customMerge) {
      return inputs.map((input, index) => config.customMerge!(input, outputs[index]));
    }

    switch (config.mergeStrategy) {
      case 'replace':
        return inputs.map((input, index) => ({ ...outputs[index], ...input } as any));
      case 'append':
      default:
        return inputs.map((input, index) => ({ ...input, ...outputs[index] } as any));
    }
  }

  private buildEmbeddingText<T>(item: T, config: EmbeddingGenerationConfig): string {
    const parts: string[] = [];

    // Add source fields
    for (const fieldName of config.sourceFields) {
      const value = (item as any)[fieldName];
      if (value) {
        parts.push(this.formatValue(value));
      }
    }

    // Add relationship context if configured
    if (config.includeRelationships) {
      // TODO: Format relationships
      // For now, placeholder
    }

    // Combine based on strategy
    switch (config.combineStrategy) {
      case 'weighted':
        // TODO: Apply weights
        return parts.join(' ');

      case 'separate':
        // TODO: Return separate embeddings per field
        return parts.join(' ');

      case 'concat':
      default:
        return parts.join(' ');
    }
  }

  private getLLMProvider(config?: LLMConfig): LLMProviderAdapter {
    const provider = config?.provider || this.defaultLLMConfig?.provider || 'gemini';
    const cacheKey = `${provider}:${config?.model || ''}`;

    if (!this.llmProviders.has(cacheKey)) {
      this.llmProviders.set(
        cacheKey,
        new LLMProviderAdapter({
          provider,
          model: config?.model,
          temperature: config?.temperature,
          maxTokens: config?.maxTokens
        })
      );
    }

    return this.llmProviders.get(cacheKey)!;
  }

  private getEmbeddingProvider(config?: { provider?: string; model?: string }): EmbeddingProviderAdapter {
    const provider = config?.provider || this.defaultEmbeddingConfig?.provider || 'gemini';
    const cacheKey = `${provider}:${config?.model || ''}`;

    if (!this.embeddingProviders.has(cacheKey)) {
      this.embeddingProviders.set(
        cacheKey,
        new EmbeddingProviderAdapter({
          provider,
          model: config?.model
        })
      );
    }

    return this.embeddingProviders.get(cacheKey)!;
  }
}
