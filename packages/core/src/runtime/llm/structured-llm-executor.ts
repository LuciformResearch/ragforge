/**
 * Unified Structured LLM Executor
 *
 * Provides a unified interface for all LLM structured generation:
 * - Reranking
 * - Summarization
 * - Custom structured outputs
 * - Embedding generation with graph context
 */

// LlamaIndex multi-provider support - DISABLED (using native @google/genai instead)
// To restore, uncomment and reinstall: npm i llamaindex @llamaindex/google @llamaindex/openai @llamaindex/anthropic @llamaindex/ollama
// import { LLMProviderAdapter, EmbeddingProviderAdapter } from './provider-adapter.js';
// import type { LLM, BaseEmbedding } from 'llamaindex';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import type { EntityContext, EntityField } from '../types/entity-context.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { QueryFeedback } from '../reranking/llm-reranker.js';
import {
  GeminiNativeToolProvider,
  type ToolDefinition,
  type ToolCall,
  type Message as NativeMessage,
  type NativeToolCallingProvider,
} from './native-tool-calling/index.js';

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
  nested?: Record<string, OutputFieldSchema>; // For nested objects in globalSchema
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
  inputFields?: (string | InputFieldConfig)[]; // Optional if entityContext is provided
  entityContext?: EntityContext; // Use entity schema for automatic field formatting
  inputContext?: InputContextConfig;
  contextData?: Record<string, any>;

  // === PROMPTS ===
  systemPrompt?: string;
  userTask?: string;
  examples?: string;
  instructions?: string;

  // === OUTPUT ===
  outputSchema: OutputSchema<TOutput>;
  globalSchema?: OutputSchema<any>; // Global metadata fields (not per-item)
  outputFormat?: 'json' | 'xml' | 'yaml' | 'auto'; // Format for items
  globalMetadataFormat?: 'json' | 'xml' | 'yaml'; // Format for metadata (defaults to outputFormat)
  mergeStrategy?: 'append' | 'replace' | 'custom';
  customMerge?: (entity: TInput, generated: TOutput) => TInput & TOutput;

  // === LLM ===
  llm?: LLMConfig;
  llmProvider?: LLMProvider; // Alternative: use existing LLMProvider instance (for backward compat)
  fallback?: FallbackConfig;

  // === PERFORMANCE ===
  batchSize?: number;
  parallel?: number;
  tokenBudget?: number;
  onOverflow?: 'truncate' | 'split' | 'error';
  cache?: boolean | CacheConfig;

  // === TOOL CALLING (NEW) ===
  tools?: ToolDefinition[];
  toolMode?: 'global' | 'per-item'; // Default: 'global'
  maxIterationsPerItem?: number; // For per-item mode, default: 3
  toolChoice?: 'auto' | 'any' | 'none'; // Default: 'auto'
  useNativeToolCalling?: boolean; // Default: true
  nativeToolProvider?: NativeToolCallingProvider; // Provider for native tool calling (global mode only)
  toolExecutor?: ToolExecutor; // Custom tool executor

  /** Callback called with each LLM response (for logging reasoning, tool calls, etc.) */
  onLLMResponse?: (response: {
    iteration: number;
    reasoning?: string;
    toolCalls?: ToolCallRequest[];
    output?: any;
  }) => void;

  // === DEBUGGING ===
  logPrompts?: boolean | string; // true = console, string = file path
  logResponses?: boolean | string; // true = console, string = file path
}

/**
 * Tool call request
 */
export interface ToolCallRequest {
  tool_name: string;
  arguments: Record<string, any>;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  tool_name: string;
  success: boolean;
  result?: any;
  error?: string;
}

/**
 * Tool executor interface
 */
export interface ToolExecutor {
  execute(toolCall: ToolCallRequest): Promise<any>;
  executeBatch(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]>;
}

/**
 * Base tool executor with parallel execution support.
 * Extend this class and implement the `execute` method for each tool.
 * By default, `executeBatch` runs all tools in parallel using Promise.all().
 */
export abstract class BaseToolExecutor implements ToolExecutor {
  /**
   * Execute a single tool call. Implement this in subclasses.
   */
  abstract execute(toolCall: ToolCallRequest): Promise<any>;

  /**
   * Execute multiple tool calls in parallel.
   * Override this method if you need sequential execution for specific tools.
   */
  async executeBatch(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    const promises = toolCalls.map(async (toolCall) => {
      try {
        const result = await this.execute(toolCall);
        return {
          tool_name: toolCall.tool_name,
          success: true,
          result,
        };
      } catch (error: any) {
        console.error(`   ❌ Tool ${toolCall.tool_name} failed:`, error.message);
        return {
          tool_name: toolCall.tool_name,
          success: false,
          error: error.message,
        };
      }
    });

    return Promise.all(promises);
  }
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

// ===== RERANKING TYPES =====

/**
 * Evaluation result for a single item (used in reranking)
 */
export interface ItemEvaluation {
  id: string;
  score: number;
  reasoning: string;
  relevant?: boolean;
}

// QueryFeedback is imported from llm-reranker.js (reusing existing type)

// ===== INTERNAL TYPES =====

interface Batch<T> {
  items: T[];
  tokenEstimate: number;
}

interface LLMResponse {
  text: string;
  format: 'json' | 'xml' | 'yaml';
}

/**
 * Result from executeLLMBatch with optional global metadata
 */
export interface LLMBatchResult<TInput, TOutput, TGlobal = any> {
  items: (TInput & TOutput)[];
  globalMetadata?: TGlobal;
}

// ===== SINGLE CALL TYPES =====

/**
 * Configuration for single structured LLM call (no batching)
 * Same abstractions as LLMStructuredCallConfig but for a single call
 */
export interface SingleLLMCallConfig<TOutput = any> {
  // === INPUTS ===
  /** Input fields to include in prompt (with optional prompts/transforms) */
  inputFields?: (string | InputFieldConfig)[];
  /** Input data object */
  input: Record<string, any>;
  /** Additional context data */
  contextData?: Record<string, any>;

  // === PROMPTS ===
  /** System prompt */
  systemPrompt?: string;
  /** User task/question */
  userTask?: string;
  /** Additional instructions */
  instructions?: string;

  // === OUTPUT ===
  /** Output schema (same format as batch version) */
  outputSchema: OutputSchema<TOutput>;
  /** Output format (default: xml) */
  outputFormat?: 'json' | 'xml' | 'yaml';

  // === LLM ===
  /** LLM provider instance */
  llmProvider: LLMProvider;

  // === TOOL CALLING ===
  /** Available tools */
  tools?: ToolDefinition[];
  /** Custom tool executor */
  toolExecutor?: ToolExecutor;
  /** Max iterations for tool loop (default: 10) */
  maxIterations?: number;

  /** Callback called with each LLM response */
  onLLMResponse?: (response: {
    iteration: number;
    reasoning?: string;
    toolCalls?: ToolCallRequest[];
    output?: TOutput;
  }) => void;

  // === DEBUGGING ===
  logPrompts?: boolean | string;
  logResponses?: boolean | string;
}

/**
 * Unified executor for all LLM structured operations
 */
export class StructuredLLMExecutor {
  // LlamaIndex multi-provider support - DISABLED
  // private llmProviders: Map<string, LLMProviderAdapter> = new Map();
  // private embeddingProviders: Map<string, EmbeddingProviderAdapter> = new Map();
  private nativeToolProvider?: GeminiNativeToolProvider;

  constructor(
    private defaultLLMConfig?: LLMConfig,
    private defaultEmbeddingConfig?: { provider?: string; model?: string }
  ) {}

  /**
   * Execute structured LLM generation on batch of items
   *
   * Returns items directly if no globalSchema is provided (backward compatible)
   * Returns LLMBatchResult with items and globalMetadata if globalSchema is provided
   */
  async executeLLMBatch<TInput, TOutput, TGlobal = any>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[] | LLMBatchResult<TInput, TOutput, TGlobal>> {
    // 1. Validate config
    this.validateLLMConfig(config);

    // Warn about less permissive formats
    if (config.outputFormat === 'json' || config.outputFormat === 'yaml') {
      console.warn(
        `[StructuredLLMExecutor] Warning: Using ${config.outputFormat.toUpperCase()} format for structured generation. ` +
        `This format is less permissive than XML and may fail more often if the LLM doesn't follow the exact format. ` +
        `Consider using 'xml' (default) for more robust parsing.`
      );
    }
    if (config.globalMetadataFormat === 'json' || config.globalMetadataFormat === 'yaml') {
      console.warn(
        `[StructuredLLMExecutor] Warning: Using ${config.globalMetadataFormat.toUpperCase()} format for global metadata. ` +
        `This format is less permissive than XML and may fail more often if the LLM doesn't follow the exact format. ` +
        `Consider using 'xml' (default) for more robust parsing.`
      );
    }

    // 2. Pack items into optimal batches
    const batches = this.packBatches(items, config);
    console.log(
      `[StructuredLLMExecutor] 📦 Batching: ${items.length} items → ${batches.length} batch(es) | ` +
      `Items per batch: [${batches.map(b => b.items.length).join(', ')}] | ` +
      `Parallel: ${config.parallel || 5}`
    );

    // 3. Execute batches in parallel
    const responses = await this.executeParallelLLM(batches, config);

    // 4. Parse outputs
    const { items: parsedItems, globalMetadata } = await this.parseOutputs(
      responses,
      config.outputSchema,
      config.globalSchema,
      config.globalMetadataFormat
    );

    // 5. Merge with inputs
    const mergedItems = this.mergeResults(items, parsedItems, config);

    // 6. Return based on whether globalSchema was requested
    if (config.globalSchema && globalMetadata !== undefined) {
      return { items: mergedItems, globalMetadata } as LLMBatchResult<TInput, TOutput, TGlobal>;
    }

    // Backward compatible: return items directly if no globalSchema
    return mergedItems as (TInput & TOutput)[];
  }

  /**
   * Execute single structured LLM call (no batching)
   *
   * Same abstractions as executeLLMBatch but for a single call:
   * - inputFields with prompts/transforms
   * - outputSchema with field descriptions
   * - Tool calling support with iterations
   *
   * No [Item 0], [Item 1] formatting - just direct input → output
   */
  async executeSingle<TOutput>(
    config: SingleLLMCallConfig<TOutput>
  ): Promise<TOutput> {
    const maxIterations = config.maxIterations ?? 10;
    const toolsUsed: string[] = [];
    let toolContext: ToolExecutionResult[] = [];

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // Build prompt
      const prompt = this.buildSinglePrompt(config, toolContext);

      // Log prompt if requested
      if (config.logPrompts) {
        await this.logContent(`PROMPT [iter ${iteration}]`, prompt, config.logPrompts);
      }

      // Call LLM
      const response = await config.llmProvider.generateContent(prompt);

      // Log response if requested
      if (config.logResponses) {
        await this.logContent(`RESPONSE [iter ${iteration}]`, response, config.logResponses);
      }

      // Parse response
      const format = config.outputFormat || 'xml';
      const parsedOrPromise = this.parseSingleResponse<TOutput>(response, config.outputSchema, format);
      const parsed = parsedOrPromise instanceof Promise ? await parsedOrPromise : parsedOrPromise;

      // Extract tool_calls if present
      const toolCalls = (parsed as any).tool_calls as ToolCallRequest[] | undefined;
      const validToolCalls = this.filterValidToolCalls(toolCalls);

      // Call callback
      if (config.onLLMResponse) {
        config.onLLMResponse({
          iteration,
          reasoning: (parsed as any).answer || (parsed as any).reasoning,
          toolCalls: validToolCalls,
          output: parsed,
        });
      }

      // If we have tool calls, execute them and continue
      if (validToolCalls.length > 0 && config.toolExecutor) {
        const toolResults = await this.executeToolCalls(validToolCalls, config.toolExecutor);
        toolContext.push(...toolResults);
        toolResults.forEach(r => {
          if (!toolsUsed.includes(r.tool_name)) {
            toolsUsed.push(r.tool_name);
          }
        });
        continue;
      }

      // No tool calls - check if we have valid output
      const outputFields = Object.keys(config.outputSchema).filter(k => k !== 'tool_calls');
      const hasValidOutput = outputFields.some(k => {
        const value = (parsed as any)[k];
        return value !== undefined && value !== '' && value !== null;
      });

      if (hasValidOutput) {
        // Remove tool_calls from output
        const { tool_calls: _, ...output } = parsed as any;
        return output as TOutput;
      }

      // No tool calls and no valid output - error
      if (iteration === maxIterations) {
        throw new Error(`Max iterations (${maxIterations}) reached without valid output`);
      }
    }

    throw new Error(`Max iterations (${maxIterations}) reached without valid output`);
  }

  /**
   * Build prompt for single call (no batching)
   */
  private buildSinglePrompt<TOutput>(
    config: SingleLLMCallConfig<TOutput>,
    toolContext: ToolExecutionResult[]
  ): string {
    const parts: string[] = [];

    // System prompt
    if (config.systemPrompt) {
      parts.push(config.systemPrompt);
      parts.push('');
    }

    // Tool descriptions (if tools provided)
    if (config.tools && config.tools.length > 0) {
      parts.push(this.buildSystemPromptWithTools(config.tools));
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

    // Input fields
    if (config.inputFields && config.inputFields.length > 0) {
      parts.push('## Input');
      for (const fieldConfig of config.inputFields) {
        const fieldName = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.name;
        let value = config.input[fieldName];

        // Apply transformations
        if (typeof fieldConfig !== 'string') {
          if (fieldConfig.transform) {
            value = fieldConfig.transform(value);
          }
          if (fieldConfig.maxLength && typeof value === 'string') {
            value = this.truncate(value, fieldConfig.maxLength);
          }
          if (fieldConfig.prompt) {
            parts.push(`${fieldName} (${fieldConfig.prompt}):`);
          } else {
            parts.push(`${fieldName}:`);
          }
        } else {
          parts.push(`${fieldName}:`);
        }

        parts.push(this.formatValue(value));
        parts.push('');
      }
    }

    // Tool results context (if any)
    if (toolContext.length > 0) {
      parts.push('## Tool Results');
      for (const result of toolContext) {
        const status = result.success ? '✓ SUCCESS' : '✗ FAILED';
        const resultStr = typeof result.result === 'object'
          ? JSON.stringify(result.result, null, 2)
          : String(result.result ?? result.error);
        parts.push(`### ${result.tool_name} [${status}]`);
        parts.push(resultStr);
        parts.push('');
      }
    }

    // Output instructions
    parts.push('## Required Output Format');
    parts.push(this.generateSingleOutputInstructions(config.outputSchema, config.outputFormat || 'xml', !!config.tools));
    parts.push('');

    // Additional instructions
    if (config.instructions) {
      parts.push('## Additional Instructions');
      parts.push(config.instructions);
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Generate output instructions for single call (no items wrapper)
   */
  private generateSingleOutputInstructions(
    schema: OutputSchema<any>,
    format: 'xml' | 'json' | 'yaml',
    hasTools: boolean
  ): string {
    const instructions: string[] = [];

    if (format === 'xml') {
      instructions.push('You MUST respond with structured XML in the following format:');
      instructions.push('');
      instructions.push('<response>');

      for (const [fieldName, fieldSchema] of Object.entries(schema)) {
        const required = fieldSchema.required ? ' (REQUIRED)' : '';
        instructions.push(`  <${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);
        if (fieldSchema.prompt) {
          instructions.push(`  <!-- ${fieldSchema.prompt} -->`);
        }
      }

      // Add tool_calls if tools are available
      if (hasTools) {
        instructions.push('  <tool_calls>');
        instructions.push('    <!-- If you need to call tools, include them here -->');
        instructions.push('    <tool_call>');
        instructions.push('      <tool_name>name_of_tool</tool_name>');
        instructions.push('      <arguments>{"param": "value"}</arguments>');
        instructions.push('    </tool_call>');
        instructions.push('  </tool_calls>');
      }

      instructions.push('</response>');
    } else if (format === 'yaml') {
      instructions.push('You MUST respond with structured YAML in the following format:');
      instructions.push('');
      instructions.push('```yaml');

      for (const [fieldName, fieldSchema] of Object.entries(schema)) {
        const required = fieldSchema.required ? ' (REQUIRED)' : '';
        instructions.push(`${fieldName}: ${this.describeYAMLType(fieldSchema)}${required}`);
        if (fieldSchema.prompt) {
          instructions.push(`# ${fieldSchema.prompt}`);
        }
      }

      if (hasTools) {
        instructions.push('tool_calls:');
        instructions.push('  - tool_name: "name_of_tool"');
        instructions.push('    arguments:');
        instructions.push('      param: "value"');
      }

      instructions.push('```');
    } else {
      instructions.push('You MUST respond with structured JSON in the following format:');
      instructions.push('');
      instructions.push('```json');
      instructions.push('{');

      const entries = Object.entries(schema);
      entries.forEach(([fieldName, fieldSchema], index) => {
        const required = fieldSchema.required ? ' (REQUIRED)' : '';
        const comma = index < entries.length - 1 || hasTools ? ',' : '';
        instructions.push(`  "${fieldName}": ${this.describeJSONType(fieldSchema)}${required}${comma}`);
      });

      if (hasTools) {
        instructions.push('  "tool_calls": [{"tool_name": "...", "arguments": {...}}]');
      }

      instructions.push('}');
      instructions.push('```');
    }

    return instructions.join('\n');
  }

  /**
   * Parse single response (no items wrapper)
   */
  private parseSingleResponse<TOutput>(
    text: string,
    schema: OutputSchema<TOutput>,
    format: 'xml' | 'json' | 'yaml'
  ): TOutput | Promise<TOutput> {
    if (format === 'json') {
      return this.parseSingleJSONResponse(text, schema);
    } else if (format === 'yaml') {
      return this.parseSingleYAMLResponse(text, schema);
    } else {
      return this.parseSingleXMLResponse(text, schema);
    }
  }

  /**
   * Parse single XML response (looks for <response> wrapper)
   */
  private parseSingleXMLResponse<TOutput>(
    xmlText: string,
    schema: OutputSchema<TOutput>
  ): TOutput {
    const output: any = {};

    try {
      const parser = new LuciformXMLParser(xmlText, { mode: 'luciform-permissive' });
      const parseResult = parser.parse();

      if (!parseResult.document?.root) {
        console.error('[parseSingleXMLResponse] No XML root element found in response:');
        console.error(xmlText.substring(0, 500));
        throw new Error('Malformed LLM response: No XML root element found. Expected <response>...</response>');
      }

      const root = parseResult.document.root;

      // Extended schema with tool_calls
      const extendedSchema: OutputSchema<any> = {
        ...schema,
        tool_calls: {
          type: 'array',
          description: 'Tool calls',
          required: false,
          items: {
            type: 'object',
            description: 'Tool call',
            properties: {
              tool_name: { type: 'string', description: 'Tool name', required: true },
              arguments: { type: 'object', description: 'Arguments', required: true },
            },
          },
        },
      };

      // Extract fields from root element
      for (const [fieldName, fieldSchema] of Object.entries(extendedSchema) as [string, OutputFieldSchema][]) {
        // Try child element
        if (root.children) {
          const childEl = root.children.find((c: any) => c.type === 'element' && c.name === fieldName);
          if (childEl) {
            // Handle arrays of objects recursively
            if (fieldSchema.type === 'array' && fieldSchema.items) {
              output[fieldName] = this.parseArrayFromElement(childEl, fieldSchema.items);
            }
            // Handle nested objects recursively
            else if (fieldSchema.type === 'object' && fieldSchema.properties) {
              output[fieldName] = this.parseObjectFromElement(childEl, fieldSchema.properties);
            }
            // Simple types: extract text
            else {
              const value = this.getTextContentFromElement(childEl);
              if (value) {
                output[fieldName] = this.convertValue(value, fieldSchema);
              }
            }
          }
        }

        // Apply defaults
        if (output[fieldName] === undefined && fieldSchema.default !== undefined) {
          output[fieldName] = fieldSchema.default;
        }
      }

      // Check if we got any meaningful output
      const outputFields = Object.keys(schema);
      const hasAnyOutput = outputFields.some(k => output[k] !== undefined && output[k] !== '');
      const hasToolCalls = output.tool_calls && Array.isArray(output.tool_calls) && output.tool_calls.length > 0;

      if (!hasAnyOutput && !hasToolCalls) {
        console.error('[parseSingleXMLResponse] No fields extracted from XML. Root element:', root.name);
        console.error('[parseSingleXMLResponse] Expected fields:', outputFields.join(', '));
        console.error('[parseSingleXMLResponse] Raw response (first 800 chars):', xmlText.substring(0, 800));
      }
    } catch (error: any) {
      console.error('[parseSingleXMLResponse] Failed to parse XML response:', error.message);
      console.error('[parseSingleXMLResponse] Raw response (first 500 chars):', xmlText.substring(0, 500));
      throw error; // Re-throw to let caller handle it
    }

    return output as TOutput;
  }

  /**
   * Parse single JSON response
   */
  private parseSingleJSONResponse<TOutput>(
    jsonText: string,
    schema: OutputSchema<TOutput>
  ): TOutput {
    const output: any = {};

    try {
      // Try to extract JSON from markdown code blocks
      let cleanedText = jsonText.trim();
      const jsonMatch = cleanedText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanedText = jsonMatch[1];
      }

      const parsed = JSON.parse(cleanedText);

      // Extended schema with tool_calls
      const extendedSchema: OutputSchema<any> = {
        ...schema,
        tool_calls: {
          type: 'array',
          description: 'Tool calls',
          required: false,
        },
      };

      for (const [fieldName, fieldSchema] of Object.entries(extendedSchema) as [string, OutputFieldSchema][]) {
        const value = parsed[fieldName];

        if (value !== undefined) {
          output[fieldName] = this.convertValue(value, fieldSchema);
        } else if (fieldSchema.default !== undefined) {
          output[fieldName] = fieldSchema.default;
        }
      }

      // Check if we got any meaningful output
      const outputFields = Object.keys(schema);
      const hasAnyOutput = outputFields.some(k => output[k] !== undefined && output[k] !== '');
      const hasToolCalls = output.tool_calls && Array.isArray(output.tool_calls) && output.tool_calls.length > 0;

      if (!hasAnyOutput && !hasToolCalls) {
        console.error('[parseSingleJSONResponse] No fields extracted from JSON.');
        console.error('[parseSingleJSONResponse] Expected fields:', outputFields.join(', '));
        console.error('[parseSingleJSONResponse] Parsed object keys:', Object.keys(parsed).join(', '));
        console.error('[parseSingleJSONResponse] Raw response (first 800 chars):', jsonText.substring(0, 800));
      }
    } catch (error: any) {
      console.error('[parseSingleJSONResponse] Failed to parse JSON response:', error.message);
      console.error('[parseSingleJSONResponse] Raw response (first 500 chars):', jsonText.substring(0, 500));
      throw error; // Re-throw to let caller handle it
    }

    return output as TOutput;
  }

  /**
   * Parse single YAML response
   */
  private async parseSingleYAMLResponse<TOutput>(
    yamlText: string,
    schema: OutputSchema<TOutput>
  ): Promise<TOutput> {
    const output: any = {};

    try {
      const yaml = await import('js-yaml');

      // Try to extract YAML from markdown code blocks
      let cleanedText = yamlText.trim();
      const yamlMatch = cleanedText.match(/```(?:yaml|yml)\s*([\s\S]*?)\s*```/);
      if (yamlMatch) {
        cleanedText = yamlMatch[1];
      }

      const parsed = yaml.load(cleanedText) as any;

      // Extended schema with tool_calls
      const extendedSchema: OutputSchema<any> = {
        ...schema,
        tool_calls: {
          type: 'array',
          description: 'Tool calls',
          required: false,
        },
      };

      for (const [fieldName, fieldSchema] of Object.entries(extendedSchema) as [string, OutputFieldSchema][]) {
        const value = parsed[fieldName];

        if (value !== undefined) {
          output[fieldName] = this.convertValue(value, fieldSchema);
        } else if (fieldSchema.default !== undefined) {
          output[fieldName] = fieldSchema.default;
        }
      }

      // Check if we got any meaningful output
      const outputFields = Object.keys(schema);
      const hasAnyOutput = outputFields.some(k => output[k] !== undefined && output[k] !== '');
      const hasToolCalls = output.tool_calls && Array.isArray(output.tool_calls) && output.tool_calls.length > 0;

      if (!hasAnyOutput && !hasToolCalls) {
        console.error('[parseSingleYAMLResponse] No fields extracted from YAML.');
        console.error('[parseSingleYAMLResponse] Expected fields:', outputFields.join(', '));
        console.error('[parseSingleYAMLResponse] Parsed object keys:', Object.keys(parsed || {}).join(', '));
        console.error('[parseSingleYAMLResponse] Raw response (first 800 chars):', yamlText.substring(0, 800));
      }
    } catch (error: any) {
      console.error('[parseSingleYAMLResponse] Failed to parse YAML response:', error.message);
      console.error('[parseSingleYAMLResponse] Raw response (first 500 chars):', yamlText.substring(0, 500));
      throw error;
    }

    return output as TOutput;
  }

  /**
   * Filter and validate tool calls
   */
  private filterValidToolCalls(toolCalls: any[] | undefined): ToolCallRequest[] {
    if (!toolCalls || !Array.isArray(toolCalls)) {
      return [];
    }

    return toolCalls.filter((tc): tc is ToolCallRequest => {
      // Skip empty strings (can happen with malformed XML parsing)
      if (typeof tc === 'string') {
        return false;
      }
      // Valid tool call must have tool_name and arguments
      return typeof tc === 'object' && tc !== null && tc.tool_name && tc.arguments;
    });
  }

  /**
   * Execute reranking with LLM evaluations
   * Special case that returns evaluations + optional query feedback
   */
  async executeReranking<T>(
    items: T[],
    config: Partial<LLMStructuredCallConfig<T, ItemEvaluation>> & {
      userQuestion: string;
      withFeedback?: boolean;
      getItemId?: (item: T, index: number) => string;
    }
  ): Promise<{ evaluations: ItemEvaluation[]; queryFeedback?: QueryFeedback }> {
    // Add reranking-specific prompts
    const rerankConfig: LLMStructuredCallConfig<T, ItemEvaluation> = {
      ...config,
      systemPrompt: config.systemPrompt || `You are ranking ${config.entityContext?.displayName || 'items'} for relevance.`,
      userTask: `User question: "${config.userQuestion}"`,
      outputSchema: {
        id: {
          type: 'string',
          description: 'Item ID from the input',
          required: true
        },
        score: {
          type: 'number',
          description: 'Relevance score from 0.0 to 1.0',
          required: true,
          min: 0,
          max: 1
        },
        reasoning: {
          type: 'string',
          description: 'Specific explanation referencing both the question and item details',
          required: true
        },
        relevant: {
          type: 'boolean',
          description: 'Whether the item is relevant to the question',
          default: true
        }
      },
      outputFormat: 'xml'
    };

    // Add globalSchema for feedback if requested
    if (config.withFeedback) {
      rerankConfig.globalSchema = {
        feedback: {
          type: 'object',
          description: 'Query quality feedback and suggestions',
          required: false,
          nested: {
            quality: {
              type: 'string',
              description: 'Query quality: excellent, good, insufficient, or poor',
              required: true
            },
            suggestions: {
              type: 'array',
              description: 'Array of suggestion objects with type and description',
              required: false
            }
          }
        }
      };
    }

    // Execute LLM batch
    const result = await this.executeLLMBatch<T, ItemEvaluation, { feedback?: QueryFeedback }>(items, rerankConfig);

    // Handle both return formats (backward compat)
    const isArrayResult = Array.isArray(result);
    const itemResults = isArrayResult ? result : result.items;
    const globalMetadata = isArrayResult ? undefined : result.globalMetadata;

    // Extract evaluations
    const evaluations: ItemEvaluation[] = itemResults.map((itemResult, index) => {
      const itemId = config.getItemId ? config.getItemId(items[index], index) : String(index);
      return {
        id: itemResult.id || itemId,
        score: itemResult.score,
        reasoning: itemResult.reasoning,
        relevant: itemResult.relevant
      };
    });

    // Extract query feedback from global metadata
    const queryFeedback = globalMetadata?.feedback as QueryFeedback | undefined;

    return { evaluations, queryFeedback };
  }

  /**
   * Generate embeddings for batch of items
   *
   * NOTE: LlamaIndex multi-provider support disabled.
   * Use GeminiEmbeddingProvider directly or via runEmbeddingPipelines() instead.
   */
  async generateEmbeddings<T>(
    items: T[],
    config: EmbeddingGenerationConfig
  ): Promise<(T & { [key: string]: number[] })[]> {
    // LlamaIndex multi-provider support - DISABLED
    // To restore, uncomment provider-adapter.ts and getEmbeddingProvider method
    throw new Error(
      'generateEmbeddings() is disabled (LlamaIndex removed). ' +
      'Use GeminiEmbeddingProvider directly: new GeminiEmbeddingProvider({ apiKey }).embed(texts)'
    );

    /* Original implementation - kept for reference
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
    */
  }

  /**
   * Estimate token cost for LLM batch operation
   * Useful for budget planning before executing
   *
   * @param items - Items to process
   * @param config - LLM configuration (same as executeLLMBatch)
   * @returns Token estimates and cost breakdown by provider
   */
  estimateTokens<T>(
    items: T[],
    config: LLMStructuredCallConfig<T, any>
  ): {
    totalPromptTokens: number;
    totalResponseTokens: number;
    estimatedCostUSD: number;
    batchCount: number;
    itemsPerBatch: number[];
    provider: string;
    model?: string;
  } {
    // Validate config first
    this.validateLLMConfig(config);

    // Pack items into batches (same logic as actual execution)
    const batches = this.packBatches(items, config);

    let totalPromptTokens = 0;
    let totalResponseTokens = 0;

    // Estimate tokens for each batch
    for (const batch of batches) {
      // Build actual prompt to get accurate estimate
      const prompt = this.buildPrompt(batch.items, config);

      // Estimate prompt tokens: 1 token ≈ 4 characters (rough heuristic)
      const promptTokens = Math.ceil(prompt.length / 4);
      totalPromptTokens += promptTokens;

      // Estimate response tokens based on output schema
      const responseTokens = this.estimateResponseTokensForBatch(
        batch.items.length,
        config.outputSchema,
        config.globalSchema
      );
      totalResponseTokens += responseTokens;
    }

    // Get provider info
    const provider = config.llm?.provider || this.defaultLLMConfig?.provider || 'unknown';
    const model = config.llm?.model || this.defaultLLMConfig?.model;

    // Estimate cost based on provider/model
    const estimatedCostUSD = this.estimateCost(
      totalPromptTokens,
      totalResponseTokens,
      provider,
      model
    );

    return {
      totalPromptTokens,
      totalResponseTokens,
      estimatedCostUSD,
      batchCount: batches.length,
      itemsPerBatch: batches.map(b => b.items.length),
      provider,
      model
    };
  }

  // ===== PRIVATE METHODS =====

  private validateLLMConfig<T>(config: LLMStructuredCallConfig<T, any>): void {
    if (!config.inputFields && !config.entityContext) {
      throw new Error('Either inputFields or entityContext is required');
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

    // If using EntityContext, estimate based on entity fields
    if (config.entityContext) {
      for (const field of config.entityContext.fields) {
        const value = (item as any)[field.name];
        if (typeof value === 'string') {
          tokens += Math.ceil(value.length / 4);
        } else if (value) {
          tokens += 50;
        }
      }
      return tokens;
    }

    // Otherwise use inputFields
    if (!config.inputFields) return 100; // Default estimate

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

      console.log(
        `[StructuredLLMExecutor] 🚀 Launching ${batchGroup.length} requests in parallel ` +
        `(batch group ${Math.floor(i / parallel) + 1}/${Math.ceil(batches.length / parallel)})`
      );

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

    // Log prompt if requested
    if (config.logPrompts) {
      await this.logContent('PROMPT', prompt, config.logPrompts);
    }

    let response: string;

    // Use LLMProvider (required - LlamaIndex multi-provider support disabled)
    if (config.llmProvider) {
      response = await config.llmProvider.generateContent(prompt);
    } else {
      // LlamaIndex multi-provider fallback - DISABLED
      // To restore, uncomment provider-adapter.ts imports and getLLMProvider method
      throw new Error(
        'llmProvider is required. Pass a GeminiAPIProvider instance in config.llmProvider. ' +
        'Example: new GeminiAPIProvider({ apiKey, model: "gemini-1.5-flash" })'
      );
    }

    // Log response if requested
    if (config.logResponses) {
      await this.logContent('RESPONSE', response, config.logResponses);
    }

    // Determine response format
    let format: 'json' | 'xml' | 'yaml' = 'xml';
    if (config.outputFormat === 'json') {
      format = 'json';
    } else if (config.outputFormat === 'yaml') {
      format = 'yaml';
    }

    return {
      text: response,
      format
    };
  }

  /**
   * Log content to console or file
   */
  private async logContent(label: string, content: string, logTo: boolean | string): Promise<void> {
    const timestamp = new Date().toISOString();
    const separator = '='.repeat(80);
    const logMessage = `\n${separator}\n${label} @ ${timestamp}\n${separator}\n${content}\n${separator}\n`;

    if (logTo === true) {
      // Log to console
      console.log(logMessage);
    } else if (typeof logTo === 'string') {
      // Log to file
      const fs = await import('fs');
      const path = await import('path');

      // Ensure directory exists
      const dir = path.dirname(logTo);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Append to file
      fs.appendFileSync(logTo, logMessage);
    }
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
    parts.push(this.generateOutputInstructions(
      config.outputSchema,
      config.globalSchema,
      config.outputFormat || 'xml',
      config.globalMetadataFormat
    ));
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
    // Use EntityContext formatting if provided (same as LLMReranker)
    if (config.entityContext) {
      return this.formatItemsWithEntityContext(items, config.entityContext);
    }

    // Fall back to manual field config
    if (!config.inputFields) {
      throw new Error('Either entityContext or inputFields must be provided');
    }

    return items.map((item, index) => {
      const lines: string[] = [`[Item ${index}]`];

      for (const fieldConfig of config.inputFields!) {
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

  /**
   * Format items using EntityContext (same logic as LLMReranker)
   */
  private formatItemsWithEntityContext<T>(
    items: T[],
    entityContext: EntityContext
  ): string {
    const DEFAULT_FIELD_MAX = 2500;
    const DEFAULT_HEADER_MAX = 120;

    return items.map((item, index) => {
      const entity = item as any;
      const lines: string[] = [];

      // Render required fields in header
      const requiredFields = entityContext.fields.filter(f => f.required);
      const headerParts = requiredFields.map(field => {
        const rawValue = entity[field.name];
        if (this.shouldSkipField(field.name, rawValue)) {
          return field.name;
        }
        const headerValue = this.formatValueWithLength(rawValue, DEFAULT_HEADER_MAX);
        return headerValue ?? field.name;
      });
      lines.push(`[${index}] ${headerParts.join(' - ')}`);

      // Render optional fields
      const optionalFields = entityContext.fields.filter(f => !f.required);
      for (const field of optionalFields) {
        const value = this.getFieldValue(entity, field);
        if (!value || this.shouldSkipField(field.name, value)) {
          continue;
        }

        const label = field.label || field.name;
        const printable = this.formatArrayOrValue(value, field, DEFAULT_FIELD_MAX);
        if (printable) {
          lines.push(`${label}: ${printable}`);
        }
      }

      // Render enrichment fields (relationships)
      for (const enrichment of entityContext.enrichments) {
        const value = entity[enrichment.fieldName];
        if (value && Array.isArray(value) && value.length > 0) {
          const maxItems = enrichment.maxItems || 10;
          const items = value.slice(0, maxItems);
          lines.push(`${enrichment.label}: ${items.join(', ')}`);
        }
      }

      lines.push(''); // Empty line between items
      return lines.join('\n');
    }).join('\n');
  }

  private getFieldValue(entity: any, field: EntityField): unknown {
    // Prefer summary if configured
    if (field.preferSummary) {
      const prefix = `${field.name}_summary_`;
      const summaryFields = Object.keys(entity).filter(k => k.startsWith(prefix));

      if (summaryFields.length > 0) {
        const summary: any = {};
        for (const key of summaryFields) {
          const fieldName = key.substring(prefix.length);
          if (fieldName === 'hash' || fieldName.endsWith('_at')) continue;

          const value = entity[key];
          if (typeof value === 'string' && value.includes(',')) {
            summary[fieldName] = value.split(',').map(s => s.trim());
          } else {
            summary[fieldName] = value;
          }
        }

        if (Object.keys(summary).length > 0) return summary;
      }
    }

    return entity[field.name];
  }

  private shouldSkipField(fieldName: string, value: unknown): boolean {
    const lower = fieldName.toLowerCase();
    if (lower.includes('embedding') || lower.includes('vector')) return true;

    if (Array.isArray(value)) {
      if (value.length === 0) return false;
      return value.every(item => typeof item === 'number');
    }

    return false;
  }

  private formatValueWithLength(value: any, maxLength: number): string {
    if (typeof value === 'string') {
      return this.truncate(value, maxLength);
    }
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private formatArrayOrValue(value: any, field: EntityField, maxLength: number): string | null {
    if (Array.isArray(value)) {
      const items = value.slice(0, 5); // Limit array items
      return items.map(v => this.formatValueWithLength(v, maxLength)).join(', ');
    }

    if (typeof value === 'object' && value !== null) {
      // Handle structured summaries
      return this.formatStructuredSummary(value);
    }

    return this.formatValueWithLength(value, maxLength);
  }

  private formatStructuredSummary(summary: any): string {
    const parts: string[] = [];

    if (summary.purpose) parts.push(`Purpose: ${summary.purpose}`);
    if (summary.operation && Array.isArray(summary.operation)) {
      parts.push(`Operations: ${summary.operation.join('; ')}`);
    }
    if (summary.dependency && Array.isArray(summary.dependency)) {
      parts.push(`Dependencies: ${summary.dependency.join(', ')}`);
    }
    if (summary.concept && Array.isArray(summary.concept)) {
      parts.push(`Concepts: ${summary.concept.join(', ')}`);
    }
    if (summary.complexity) parts.push(`Complexity: ${summary.complexity}`);

    return parts.join('\n');
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

  private generateOutputInstructions(
    schema: OutputSchema<any>,
    globalSchema?: OutputSchema<any>,
    format: 'xml' | 'json' | 'yaml' | 'auto' = 'xml',
    globalMetadataFormat?: 'xml' | 'json' | 'yaml'
  ): string {
    // Determine actual format to use
    const itemsFormat = format === 'auto' ? 'xml' : format;
    const metadataFormat = globalMetadataFormat || itemsFormat;

    if (itemsFormat === 'json') {
      return this.generateJSONInstructions(schema, globalSchema, metadataFormat);
    } else if (itemsFormat === 'yaml') {
      return this.generateYAMLInstructions(schema, globalSchema, metadataFormat);
    } else {
      return this.generateXMLInstructions(schema, globalSchema, metadataFormat);
    }
  }

  private generateXMLInstructions(
    schema: OutputSchema<any>,
    globalSchema?: OutputSchema<any>,
    globalFormat: 'xml' | 'json' | 'yaml' = 'xml'
  ): string {
    const instructions: string[] = [
      'You MUST respond with structured XML in the following format:',
      '',
      '<items>',
      '  <item id="INDEX">'
    ];

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const required = fieldSchema.required ? ' (REQUIRED)' : '';
      instructions.push(`    <${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);

      if (fieldSchema.prompt) {
        instructions.push(`    <!-- ${fieldSchema.prompt} -->`);
      }
    }

    instructions.push('  </item>');
    instructions.push('</items>');

    // Add global metadata instructions if provided
    if (globalSchema) {
      instructions.push('');
      if (globalFormat === 'json') {
        instructions.push('Additionally, include global metadata as JSON at the end:');
        instructions.push('```json');
        instructions.push('{');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`  "${fieldName}": ${this.describeJSONType(fieldSchema)}${required}`);
        }
        instructions.push('}');
        instructions.push('```');
      } else if (globalFormat === 'yaml') {
        instructions.push('Additionally, include global metadata as YAML at the end:');
        instructions.push('```yaml');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`${fieldName}: ${this.describeYAMLType(fieldSchema)}${required}`);
        }
        instructions.push('```');
      } else {
        instructions.push('');
        instructions.push('Additionally, include these global metadata fields as sibling elements to <items>:');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`<${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);
        }
      }
    }

    // Note: INDEX is already filled in by the item template, no need to ask LLM to replace it

    return instructions.join('\n');
  }

  private generateJSONInstructions(
    schema: OutputSchema<any>,
    globalSchema?: OutputSchema<any>,
    globalFormat: 'xml' | 'json' | 'yaml' = 'json'
  ): string {
    const instructions: string[] = [
      'You MUST respond with structured JSON in the following format:',
      '',
      '```json',
      '{'
    ];

    if (globalSchema && globalFormat === 'json') {
      // Include global metadata at root level
      for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
        const required = fieldSchema.required ? ' (REQUIRED)' : '';
        instructions.push(`  "${fieldName}": ${this.describeJSONType(fieldSchema)}${required},`);
      }
    }

    instructions.push('  "items": [');
    instructions.push('    {');

    const schemaEntries = Object.entries(schema);
    schemaEntries.forEach(([fieldName, fieldSchema], index) => {
      const required = fieldSchema.required ? ' (REQUIRED)' : '';
      const comma = index < schemaEntries.length - 1 ? ',' : '';
      instructions.push(`      "${fieldName}": ${this.describeJSONType(fieldSchema)}${required}${comma}`);

      if (fieldSchema.prompt) {
        instructions.push(`      // ${fieldSchema.prompt}`);
      }
    });

    instructions.push('    }');
    instructions.push('  ]');
    instructions.push('}');
    instructions.push('```');

    if (globalSchema && globalFormat !== 'json') {
      instructions.push('');
      if (globalFormat === 'xml') {
        instructions.push('Additionally, include global metadata as XML:');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`<${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);
        }
      } else {
        instructions.push('Additionally, include global metadata as YAML:');
        instructions.push('```yaml');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`${fieldName}: ${this.describeYAMLType(fieldSchema)}${required}`);
        }
        instructions.push('```');
      }
    }

    return instructions.join('\n');
  }

  private generateYAMLInstructions(
    schema: OutputSchema<any>,
    globalSchema?: OutputSchema<any>,
    globalFormat: 'xml' | 'json' | 'yaml' = 'yaml'
  ): string {
    const instructions: string[] = [
      'You MUST respond with structured YAML in the following format:',
      '',
      '```yaml'
    ];

    if (globalSchema && globalFormat === 'yaml') {
      // Include global metadata at root level
      for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
        const required = fieldSchema.required ? ' (REQUIRED)' : '';
        instructions.push(`${fieldName}: ${this.describeYAMLType(fieldSchema)}${required}`);
      }
      instructions.push('');
    }

    instructions.push('items:');
    instructions.push('  - # First item');

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const required = fieldSchema.required ? ' (REQUIRED)' : '';
      instructions.push(`    ${fieldName}: ${this.describeYAMLType(fieldSchema)}${required}`);

      if (fieldSchema.prompt) {
        instructions.push(`    # ${fieldSchema.prompt}`);
      }
    }

    instructions.push('  - # Second item');
    instructions.push('    ...');
    instructions.push('```');

    if (globalSchema && globalFormat !== 'yaml') {
      instructions.push('');
      if (globalFormat === 'xml') {
        instructions.push('Additionally, include global metadata as XML:');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`<${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);
        }
      } else {
        instructions.push('Additionally, include global metadata as JSON:');
        instructions.push('```json');
        instructions.push('{');
        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          const required = fieldSchema.required ? ' (REQUIRED)' : '';
          instructions.push(`  "${fieldName}": ${this.describeJSONType(fieldSchema)}${required}`);
        }
        instructions.push('}');
        instructions.push('```');
      }
    }

    return instructions.join('\n');
  }

  private describeJSONType(fieldSchema: OutputFieldSchema): string {
    switch (fieldSchema.type) {
      case 'string':
        return '"string value"';
      case 'number':
        return '123';
      case 'boolean':
        return 'true';
      case 'array':
        return '[]';
      case 'object':
        if (fieldSchema.nested) {
          const nestedFields = Object.entries(fieldSchema.nested)
            .map(([key, val]) => `"${key}": ${this.describeJSONType(val)}`)
            .join(', ');
          return `{ ${nestedFields} }`;
        }
        return '{}';
      default:
        return '"value"';
    }
  }

  private describeYAMLType(fieldSchema: OutputFieldSchema): string {
    switch (fieldSchema.type) {
      case 'string':
        return '"string value"';
      case 'number':
        return '123';
      case 'boolean':
        return 'true';
      case 'array':
        return '[]';
      case 'object':
        if (fieldSchema.nested) {
          return '{ nested object }';
        }
        return '{}';
      default:
        return '"value"';
    }
  }

  private async parseOutputs<TOutput>(
    responses: LLMResponse[],
    schema: OutputSchema<TOutput>,
    globalSchema?: OutputSchema<any>,
    globalMetadataFormat?: 'json' | 'xml' | 'yaml'
  ): Promise<{ items: TOutput[]; globalMetadata?: any }> {
    const results: TOutput[] = [];
    let globalMetadata: any = undefined;

    for (const response of responses) {
      if (response.format === 'json') {
        // Parse JSON responses
        // Only try to extract JSON global metadata if format matches or is unspecified
        const shouldExtractJSONMetadata = !globalMetadataFormat || globalMetadataFormat === 'json';
        const parsed = this.parseJSONResponse(
          response.text,
          schema,
          shouldExtractJSONMetadata ? globalSchema : undefined
        );
        results.push(...parsed.items);
        // Take first non-empty globalMetadata
        if (!globalMetadata && parsed.globalMetadata) {
          globalMetadata = parsed.globalMetadata;
        }
      } else if (response.format === 'yaml') {
        // Parse YAML responses
        // Only try to extract YAML global metadata if format matches or is unspecified
        const shouldExtractYAMLMetadata = !globalMetadataFormat || globalMetadataFormat === 'yaml';
        const parsed = await this.parseYAMLResponse(
          response.text,
          schema,
          shouldExtractYAMLMetadata ? globalSchema : undefined
        );
        results.push(...parsed.items);
        // Take first non-empty globalMetadata
        if (!globalMetadata && parsed.globalMetadata) {
          globalMetadata = parsed.globalMetadata;
        }
      } else {
        // Parse XML responses (default)
        // Only try to extract XML global metadata if format matches or is unspecified
        const shouldExtractXMLMetadata = !globalMetadataFormat || globalMetadataFormat === 'xml';
        const parsed = this.parseXMLResponse(
          response.text,
          schema,
          shouldExtractXMLMetadata ? globalSchema : undefined
        );
        results.push(...parsed.items);
        // Take first non-empty globalMetadata
        if (!globalMetadata && parsed.globalMetadata) {
          globalMetadata = parsed.globalMetadata;
        }
      }

      // If globalSchema is provided and format differs from response format, try parsing global metadata separately
      if (globalSchema && !globalMetadata && globalMetadataFormat && globalMetadataFormat !== response.format) {
        if (globalMetadataFormat === 'json') {
          // Try to extract JSON metadata from mixed response
          const jsonMetadata = this.extractJSONMetadata(response.text, globalSchema);
          if (jsonMetadata) {
            globalMetadata = jsonMetadata;
          }
        } else if (globalMetadataFormat === 'yaml') {
          // Try to extract YAML metadata from mixed response
          const yamlMetadata = await this.extractYAMLMetadata(response.text, globalSchema);
          if (yamlMetadata) {
            globalMetadata = yamlMetadata;
          }
        }
      }
    }

    return { items: results, globalMetadata };
  }

  /**
   * Extract JSON metadata from a mixed-format response
   */
  private extractJSONMetadata(text: string, globalSchema: OutputSchema<any>): any | null {
    try {
      // Look for JSON code block - specifically marked as json
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        const metadata: any = {};

        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          if (parsed[fieldName] !== undefined) {
            if (fieldSchema.type === 'object' && fieldSchema.nested) {
              metadata[fieldName] = {};
              for (const [nestedName, nestedSchema] of Object.entries(fieldSchema.nested)) {
                if (parsed[fieldName][nestedName] !== undefined) {
                  metadata[fieldName][nestedName] = this.convertValue(parsed[fieldName][nestedName], nestedSchema);
                }
              }
            } else {
              metadata[fieldName] = this.convertValue(parsed[fieldName], fieldSchema);
            }
          }
        }

        return Object.keys(metadata).length > 0 ? metadata : null;
      }
    } catch (err) {
      console.warn('Failed to extract JSON metadata:', err);
    }
    return null;
  }

  /**
   * Extract YAML metadata from a mixed-format response
   */
  private async extractYAMLMetadata(text: string, globalSchema: OutputSchema<any>): Promise<any | null> {
    try {
      const yaml = await import('js-yaml');

      // Look for YAML code block
      const yamlMatch = text.match(/```(?:yaml|yml)\s*([\s\S]*?)\s*```/);
      if (yamlMatch) {
        const parsed = yaml.load(yamlMatch[1]) as any;
        const metadata: any = {};

        for (const [fieldName, fieldSchema] of Object.entries(globalSchema)) {
          if (parsed[fieldName] !== undefined) {
            if (fieldSchema.type === 'object' && fieldSchema.nested) {
              metadata[fieldName] = {};
              for (const [nestedName, nestedSchema] of Object.entries(fieldSchema.nested)) {
                if (parsed[fieldName][nestedName] !== undefined) {
                  metadata[fieldName][nestedName] = this.convertValue(parsed[fieldName][nestedName], nestedSchema);
                }
              }
            } else {
              metadata[fieldName] = this.convertValue(parsed[fieldName], fieldSchema);
            }
          }
        }

        return Object.keys(metadata).length > 0 ? metadata : null;
      }
    } catch (err) {
      console.warn('Failed to extract YAML metadata:', err);
    }
    return null;
  }

  /**
   * Parse XML response into structured outputs
   * Returns both items and optional global metadata
   */
  private parseXMLResponse<TOutput>(
    xmlText: string,
    schema: OutputSchema<TOutput>,
    globalSchema?: OutputSchema<any>
  ): { items: TOutput[]; globalMetadata?: any } {
    const results: TOutput[] = [];
    let globalMetadata: any = undefined;

    // Debug logging
    if (process.env.DEBUG_XML === 'true') {
      console.log('\n=== RAW XML RESPONSE ===');
      console.log(xmlText.substring(0, 2000));
      console.log('========================\n');
    }

    try {
      const parser = new LuciformXMLParser(xmlText, { mode: 'luciform-permissive' });
      const parseResult = parser.parse();

      if (!parseResult.document?.root) {
        console.warn('No XML root element found');
        return { items: [], globalMetadata: undefined };
      }

      const root = parseResult.document.root;

      // Extract items from <items> or <evaluations> root
      const itemElements = root.children?.filter(
        (child: any) => child.type === 'element' && child.name === 'item'
      ) || [];

      if (itemElements.length === 0) {
        console.warn('No <item> elements found in XML response');
        return { items: [], globalMetadata: undefined };
      }

      // Group items by ID (Gemini sometimes generates multiple <item> elements with same ID)
      const itemsById = new Map<string, any>();

      for (const itemEl of itemElements) {
        const item = itemEl as any; // Cast to any for XML node access

        // Get item ID from attributes
        const itemId = item.attributes?.get?.('id') || item.attributes?.id || '0';

        // Get or create output for this ID
        if (!itemsById.has(itemId)) {
          itemsById.set(itemId, {});
        }
        const output = itemsById.get(itemId);

        // Map XML attributes/elements to output schema
        for (const [fieldName, fieldSchema] of Object.entries(schema) as [string, OutputFieldSchema][]) {
          // Skip if already extracted
          if (output[fieldName] !== undefined) continue;

          // Try attribute first, then child element
          let value = item.attributes?.get?.(fieldName) || item.attributes?.[fieldName];

          if (value === undefined && item.children) {
            const childEl = item.children.find((c: any) => c.type === 'element' && c.name === fieldName);
            if (childEl) {
              // Handle arrays of objects recursively
              if (fieldSchema.type === 'array' && fieldSchema.items) {
                value = this.parseArrayFromElement(childEl, fieldSchema.items);
              }
              // Handle nested objects recursively
              else if (fieldSchema.type === 'object' && fieldSchema.properties) {
                value = this.parseObjectFromElement(childEl, fieldSchema.properties);
              }
              // Simple types: extract text
              else {
                value = this.getTextContentFromElement(childEl);
              }
            }
          }

          if (value !== undefined) {
            // Type conversion based on schema
            output[fieldName] = this.convertValue(value, fieldSchema);
          } else if (fieldSchema.default !== undefined) {
            output[fieldName] = fieldSchema.default;
          } else if (fieldSchema.required) {
            console.warn(`Required field "${fieldName}" missing in XML response`);
          }
        }
      }

      // Convert map to array, sorted by ID
      const sortedIds = Array.from(itemsById.keys()).sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        return isNaN(numA) || isNaN(numB) ? a.localeCompare(b) : numA - numB;
      });

      for (const id of sortedIds) {
        results.push(itemsById.get(id) as TOutput);
      }

      // Parse global metadata if globalSchema is provided
      if (globalSchema && root.children) {
        globalMetadata = {};

        for (const [fieldName, fieldSchema] of Object.entries(globalSchema) as [string, OutputFieldSchema][]) {
          // Look for child element with this name (not an <item>)
          const globalEl = root.children.find(
            (c: any) => c.type === 'element' && c.name === fieldName && c.name !== 'item'
          );

          if (globalEl) {
            // Handle arrays of objects recursively
            if (fieldSchema.type === 'array' && fieldSchema.items) {
              globalMetadata[fieldName] = this.parseArrayFromElement(globalEl, fieldSchema.items);
            }
            // Handle nested objects recursively
            else if (fieldSchema.type === 'object' && fieldSchema.properties) {
              globalMetadata[fieldName] = this.parseObjectFromElement(globalEl, fieldSchema.properties);
            }
            // Simple types: extract text and convert
            else {
              const value = this.getTextContentFromElement(globalEl);
              if (value) {
                globalMetadata[fieldName] = this.convertValue(value, fieldSchema);
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to parse XML response:', error.message);
      console.error('XML text:', xmlText);
    }

    return { items: results, globalMetadata };
  }

  /**
   * Extract text content from XML element
   */
  private getTextContentFromElement(element: any): string {
    if (!element) return '';

    // If element has direct text children, concatenate them
    if (element.children) {
      return element.children
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.content || '')
        .join('')
        .trim();
    }

    return '';
  }

  /**
   * Parse array field from XML element
   * Handles nested structures like:
   * <tool_calls>
   *   <tool_call>
   *     <tool_name>query_entities</tool_name>
   *     <arguments>{"limit": 10}</arguments>
   *   </tool_call>
   * </tool_calls>
   */
  private parseArrayFromElement(
    element: any,
    itemSchema: OutputFieldSchema
  ): any[] {
    if (!element || !element.children) return [];

    // Find all child elements (excluding text nodes)
    const childElements = element.children.filter(
      (c: any) => c.type === 'element'
    );

    if (childElements.length === 0) {
      // No nested elements, try parsing as JSON string or comma-separated
      const textContent = this.getTextContentFromElement(element);
      if (!textContent) return [];

      try {
        return JSON.parse(textContent);
      } catch {
        return textContent.split(',').map(s => s.trim());
      }
    }

    // Parse each child element based on itemSchema
    return childElements.map((childEl: any) => {
      if (itemSchema.type === 'object' && itemSchema.properties) {
        // Parse object recursively
        return this.parseObjectFromElement(childEl, itemSchema.properties);
      } else if (itemSchema.type === 'string') {
        return this.getTextContentFromElement(childEl);
      } else if (itemSchema.type === 'number') {
        return parseFloat(this.getTextContentFromElement(childEl));
      } else if (itemSchema.type === 'boolean') {
        const text = this.getTextContentFromElement(childEl).toLowerCase();
        return text === 'true' || text === '1';
      } else {
        // Unknown type, return text content
        return this.getTextContentFromElement(childEl);
      }
    });
  }

  /**
   * Parse object from XML element
   * Extracts properties based on schema
   */
  private parseObjectFromElement(
    element: any,
    properties: Record<string, OutputFieldSchema>
  ): any {
    const obj: any = {};

    for (const [propName, propSchema] of Object.entries(properties)) {
      // Try attribute first
      let value = element.attributes?.get?.(propName) || element.attributes?.[propName];

      // Then try child element
      if (value === undefined && element.children) {
        const childEl = element.children.find(
          (c: any) => c.type === 'element' && c.name === propName
        );

        if (childEl) {
          if (propSchema.type === 'array' && propSchema.items) {
            value = this.parseArrayFromElement(childEl, propSchema.items);
          } else if (propSchema.type === 'object' && propSchema.properties) {
            value = this.parseObjectFromElement(childEl, propSchema.properties);
          } else {
            value = this.getTextContentFromElement(childEl);
          }
        }
      }

      if (value !== undefined) {
        obj[propName] = this.convertValue(value, propSchema);
      } else if (propSchema.default !== undefined) {
        obj[propName] = propSchema.default;
      } else if (propSchema.required) {
        console.warn(`Required property "${propName}" missing in nested object`);
      }
    }

    return obj;
  }

  /**
   * Parse JSON response into structured outputs
   */
  private parseJSONResponse<TOutput>(
    jsonText: string,
    schema: OutputSchema<TOutput>,
    globalSchema?: OutputSchema<any>
  ): { items: TOutput[]; globalMetadata?: any } {
    const results: TOutput[] = [];
    let globalMetadata: any = undefined;

    try {
      // Try to extract JSON from markdown code blocks
      let cleanedText = jsonText.trim();
      const jsonMatch = cleanedText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanedText = jsonMatch[1];
      }

      const parsed = JSON.parse(cleanedText);
      const items = Array.isArray(parsed) ? parsed : (parsed.items || [parsed]);

      for (const item of items) {
        const output: any = {};

        for (const [fieldName, fieldSchema] of Object.entries(schema) as [string, OutputFieldSchema][]) {
          let value = item[fieldName];

          if (value !== undefined) {
            output[fieldName] = this.convertValue(value, fieldSchema);
          } else if (fieldSchema.default !== undefined) {
            output[fieldName] = fieldSchema.default;
          } else if (fieldSchema.required) {
            console.warn(`Required field "${fieldName}" missing in JSON response`);
          }
        }

        results.push(output as TOutput);
      }

      // Parse global metadata if globalSchema provided
      if (globalSchema && !Array.isArray(parsed)) {
        globalMetadata = {};

        for (const [fieldName, fieldSchema] of Object.entries(globalSchema) as [string, OutputFieldSchema][]) {
          // Look for top-level field (not in items array)
          const value = parsed[fieldName];

          if (value !== undefined) {
            if (fieldSchema.type === 'object' && fieldSchema.nested) {
              // Parse nested object
              globalMetadata[fieldName] = {};
              for (const [nestedName, nestedSchema] of Object.entries(fieldSchema.nested) as [string, OutputFieldSchema][]) {
                if (value[nestedName] !== undefined) {
                  globalMetadata[fieldName][nestedName] = this.convertValue(value[nestedName], nestedSchema);
                }
              }
            } else {
              globalMetadata[fieldName] = this.convertValue(value, fieldSchema);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to parse JSON response:', error.message);
      console.error('JSON text:', jsonText);
    }

    return { items: results, globalMetadata };
  }

  /**
   * Parse YAML response into structured outputs
   */
  private async parseYAMLResponse<TOutput>(
    yamlText: string,
    schema: OutputSchema<TOutput>,
    globalSchema?: OutputSchema<any>
  ): Promise<{ items: TOutput[]; globalMetadata?: any }> {
    const results: TOutput[] = [];
    let globalMetadata: any = undefined;

    try {
      // Import yaml dynamically
      const yaml = await import('js-yaml');

      // Try to extract YAML from markdown code blocks
      let cleanedText = yamlText.trim();
      const yamlMatch = cleanedText.match(/```(?:yaml|yml)\s*([\s\S]*?)\s*```/);
      if (yamlMatch) {
        cleanedText = yamlMatch[1];
      }

      const parsed = yaml.load(cleanedText) as any;

      // Extract items array
      const items = Array.isArray(parsed) ? parsed : (parsed.items || [parsed]);

      // Parse items
      for (const item of items) {
        const output: any = {};

        for (const [fieldName, fieldSchema] of Object.entries(schema) as [string, OutputFieldSchema][]) {
          const value = item[fieldName];

          if (value !== undefined) {
            output[fieldName] = this.convertValue(value, fieldSchema);
          } else if (fieldSchema.default !== undefined) {
            output[fieldName] = fieldSchema.default;
          } else if (fieldSchema.required) {
            console.warn(`Required field "${fieldName}" missing in YAML response`);
          }
        }

        results.push(output as TOutput);
      }

      // Parse global metadata if globalSchema provided
      if (globalSchema && !Array.isArray(parsed)) {
        globalMetadata = {};

        for (const [fieldName, fieldSchema] of Object.entries(globalSchema) as [string, OutputFieldSchema][]) {
          const value = parsed[fieldName];

          if (value !== undefined) {
            if (fieldSchema.type === 'object' && fieldSchema.nested) {
              // Parse nested object
              globalMetadata[fieldName] = {};
              for (const [nestedName, nestedSchema] of Object.entries(fieldSchema.nested) as [string, OutputFieldSchema][]) {
                if (value[nestedName] !== undefined) {
                  globalMetadata[fieldName][nestedName] = this.convertValue(value[nestedName], nestedSchema);
                }
              }
            } else {
              globalMetadata[fieldName] = this.convertValue(value, fieldSchema);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Failed to parse YAML response:', error.message);
      console.error('YAML text:', yamlText);
    }

    return { items: results, globalMetadata };
  }

  /**
   * Convert value to expected type based on schema
   */
  private convertValue(value: any, schema: OutputFieldSchema): any {
    switch (schema.type) {
      case 'number':
        return typeof value === 'number' ? value : parseFloat(value);

      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1';
        }
        return Boolean(value);

      case 'array':
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          // Try to parse as JSON array or split by comma
          try {
            return JSON.parse(value);
          } catch {
            return value.split(',').map(s => s.trim());
          }
        }
        return [value];

      case 'object':
        if (typeof value === 'object') return value;
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return { value };
          }
        }
        return value;

      case 'string':
      default:
        return String(value);
    }
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

  // LlamaIndex multi-provider support - DISABLED
  // To restore, uncomment imports at top of file and these methods:
  /*
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
  */

  // ===== TOOL CALLING SUPPORT =====

  /**
   * Execute LLM batch with tool calling support
   *
   * Supports two modes:
   * - 'global' (default): Tool calls once for entire batch, then batch process
   * - 'per-item': Each item gets its own mini-loop with tool calls
   */
  async executeLLMBatchWithTools<TInput, TOutput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[] | LLMBatchResult<TInput, TOutput, any>> {
    // If no tools provided, fallback to regular batch execution
    if (!config.tools || config.tools.length === 0) {
      return this.executeLLMBatch(items, config);
    }

    const toolMode = config.toolMode ?? 'global';

    console.log(`\n🔧 [StructuredLLMExecutor] Tool calling enabled (${toolMode} mode)`);
    console.log(`   Tools: ${config.tools.map(t => t.function.name).join(', ')}`);

    if (toolMode === 'global') {
      return this.executeBatchWithGlobalTools(items, config);
    } else {
      return this.executeBatchWithPerItemTools(items, config);
    }
  }

  /**
   * Global tool calling mode:
   * 1. LLM sees all items
   * 2. Makes global tool calls
   * 3. Batch process with tool results
   */
  private async executeBatchWithGlobalTools<TInput, TOutput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[] | LLMBatchResult<TInput, TOutput, any>> {
    console.log(`\n📊 Global tool calling: Analyzing ${items.length} items...`);

    // 1. Request global tool calls
    const toolCallsResponse = await this.requestGlobalToolCalls(items, config);

    // 2. Execute tools if requested
    let toolResults: ToolExecutionResult[] = [];
    if (toolCallsResponse.tool_calls && toolCallsResponse.tool_calls.length > 0) {
      console.log(`   🔧 Executing ${toolCallsResponse.tool_calls.length} tool(s)...`);
      toolResults = await this.executeToolCalls(
        toolCallsResponse.tool_calls,
        config.toolExecutor
      );

      const successful = toolResults.filter(r => r.success).length;
      console.log(`   ✅ Tools executed: ${successful}/${toolResults.length} successful`);
    } else {
      console.log(`   ℹ️  No tool calls needed`);
    }

    // 3. Batch process with tool results
    console.log(`\n📦 Batch processing ${items.length} items with tool context...`);
    return this.batchProcessWithToolResults(items, toolResults, config);
  }

  /**
   * Per-item tool calling mode:
   * Each item gets its own mini-loop
   */
  private async executeBatchWithPerItemTools<TInput, TOutput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[] | LLMBatchResult<TInput, TOutput, any>> {
    const maxIterations = config.maxIterationsPerItem ?? 3;
    console.log(`\n🔁 Per-item tool calling: Processing ${items.length} items (max ${maxIterations} iterations each)...`);

    const results: (TInput & TOutput)[] = [];

    for (let i = 0; i < items.length; i++) {
      console.log(`\n   Item ${i + 1}/${items.length}:`);
      const result = await this.processItemWithTools(items[i], config, maxIterations);
      results.push(result);
    }

    console.log(`\n✅ All items processed`);

    // Return in same format as executeLLMBatch
    if (config.globalSchema) {
      return {
        items: results,
        globalMetadata: undefined, // No global metadata in per-item mode
      };
    }

    return results;
  }

  /**
   * Process single item with tool loop
   */
  private async processItemWithTools<TInput, TOutput>(
    item: TInput,
    config: LLMStructuredCallConfig<TInput, TOutput>,
    maxIterations: number
  ): Promise<TInput & TOutput> {
    let iteration = 0;
    let toolContext: ToolExecutionResult[] = [];

    while (iteration < maxIterations) {
      iteration++;
      console.log(`      Iteration ${iteration}...`);

      // Call LLM with item + tool context
      const response = await this.callLLMForItemWithTools(item, toolContext, config);

      // Check if we should return output or continue with tools
      // Priority: if we have successful tool results AND output, return output (task is done)
      const hasSuccessfulToolResults = toolContext.some(r => r.success);
      const output = response.output as Record<string, any> | undefined;
      const hasOutput = output && Object.keys(output).some(k =>
        k !== 'tool_calls' && output[k] !== undefined && output[k] !== ''
      );
      const toolCalls = response.tool_calls;
      const hasToolCalls = toolCalls && toolCalls.length > 0;

      // Call callback with LLM response (for logging)
      if (config.onLLMResponse) {
        config.onLLMResponse({
          iteration,
          reasoning: output?.answer || output?.reasoning,
          toolCalls: toolCalls,
          output: output,
        });
      }

      // Priority: if LLM wants to call tools, let it (even if previous tools succeeded)
      if (hasToolCalls) {
        console.log(`      → ${toolCalls.length} tool call(s)`);

        // Execute tools
        const toolResults = await this.executeToolCalls(
          toolCalls,
          config.toolExecutor
        );

        toolContext.push(...toolResults);
      } else if (hasOutput) {
        // We have final output
        console.log(`      → Final output`);
        return { ...item, ...output } as TInput & TOutput;
      } else {
        throw new Error(`Item iteration ${iteration}: LLM returned neither tool_calls nor output`);
      }
    }

    throw new Error(`Max iterations (${maxIterations}) reached without final output`);
  }

  /**
   * Request global tool calls for entire batch
   */
  private async requestGlobalToolCalls<TInput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, any>
  ): Promise<{ tool_calls?: ToolCallRequest[] }> {
    // Build prompt with all items
    const prompt = this.buildGlobalToolCallPrompt(items, config);
    const systemPrompt = this.buildSystemPromptWithTools(config.tools!);

    // Use native tool calling if available (preferred)
    const useNative = config.useNativeToolCalling !== false; // Default: true
    if (useNative && config.nativeToolProvider) {
      console.log('🔧 Using native tool calling (global mode)');
      return await this.requestGlobalToolCallsNative(
        items,
        config,
        systemPrompt,
        prompt
      );
    }

    // Fallback to XML-based tool calling
    console.log('🔧 Using XML-based tool calling (global mode)');
    const result = await this.executeLLMBatch<any, { tool_calls?: ToolCallRequest[] }>(
      [{ items }],
      {
        inputFields: ['items'],
        systemPrompt,
        userTask: prompt,
        outputSchema: {
          tool_calls: {
            type: 'array',
            description: 'Tools to call before processing batch (leave empty if you have enough information)',
            required: false,
            items: {
              type: 'object',
              description: 'Tool call',
              properties: {
                tool_name: {
                  type: 'string',
                  description: 'Name of the tool to call',
                  required: true,
                },
                arguments: {
                  type: 'object',
                  description: 'Tool arguments as key-value pairs',
                  required: true,
                },
              },
            },
          },
        },
        outputFormat: 'xml',
        llmProvider: config.llmProvider,
        batchSize: 1,
      }
    );

    const response = Array.isArray(result) ? result[0] : result.items[0];
    return response || { tool_calls: [] };
  }

  /**
   * Request global tool calls using native tool calling
   */
  private async requestGlobalToolCallsNative<TInput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, any>,
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ tool_calls?: ToolCallRequest[] }> {
    const messages: NativeMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await config.nativeToolProvider!.generateWithTools(
      messages,
      config.tools!,
      {
        toolChoice: config.toolChoice as any,
        temperature: 0.1,
      }
    );

    // Convert native ToolCall[] to our ToolCallRequest[] format
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCalls: ToolCallRequest[] = response.toolCalls.map((tc: ToolCall) => ({
        tool_name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
      return { tool_calls: toolCalls };
    }

    return { tool_calls: [] };
  }

  /**
   * Build prompt for global tool call request
   */
  private buildGlobalToolCallPrompt<TInput>(
    items: TInput[],
    config: LLMStructuredCallConfig<TInput, any>
  ): string {
    const inputFields = config.inputFields || [];

    const itemsStr = items
      .map((item, i) => {
        const fields = inputFields
          .map(field => {
            const fieldName = typeof field === 'string' ? field : field.name;
            const value = (item as any)[fieldName];
            return `  ${fieldName}: ${this.formatValue(value)}`;
          })
          .join('\n');
        return `Item ${i + 1}:\n${fields}`;
      })
      .join('\n\n');

    return `${config.userTask || 'Analyze the following items'}

Items to process (${items.length} total):
${itemsStr}

Look at ALL items and decide if you need to call any tools to gather additional information before processing them.
If you need tools, return the tool_calls array with the tools you want to call.
If you already have enough information to process all items, return an empty tool_calls array.`;
  }

  /**
   * Build system prompt with tool descriptions
   * Inspired by Anthropic's legacy XML tool calling format for better multi-tool support
   */
  private buildSystemPromptWithTools(tools: ToolDefinition[]): string {
    const toolsDesc = tools
      .map(t => {
        const params = t.function.parameters;
        const required = params.required || [];
        const properties = params.properties || {};

        const paramsList = Object.entries(properties)
          .map(([name, schema]: [string, any]) => {
            const isRequired = required.includes(name);
            return `    - ${name} (${schema.type}${isRequired ? ', required' : ', optional'}): ${schema.description || ''}`;
          })
          .join('\n');

        return `### ${t.function.name}
${t.function.description}

Parameters:
${paramsList}`;
      })
      .join('\n\n');

    // Get tool names for examples
    const toolNames = tools.map(t => t.function.name);
    const exampleTool1 = toolNames[0] || 'tool_name';
    const exampleTool2 = toolNames[1] || toolNames[0] || 'other_tool';

    return `You are an AI assistant with access to tools. You can call multiple tools simultaneously when they are independent.

## Available Tools

${toolsDesc}

## How to Call Tools

When you need to use tools, include them in the \`tool_calls\` array. Each tool call must have:
- \`tool_name\`: The exact name of the tool
- \`arguments\`: An object with the required parameters

### Single Tool Call Example:
\`\`\`json
{
  "tool_calls": [
    {
      "tool_name": "${exampleTool1}",
      "arguments": { "param1": "value1" }
    }
  ]
}
\`\`\`

### Multiple Parallel Tool Calls Example:
When tools don't depend on each other's results, call them all at once:
\`\`\`json
{
  "tool_calls": [
    {
      "tool_name": "${exampleTool1}",
      "arguments": { "param1": "value1" }
    },
    {
      "tool_name": "${exampleTool2}",
      "arguments": { "param2": "value2" }
    }
  ]
}
\`\`\`

## Important Guidelines

1. **ALWAYS include tool_calls when action is needed** - Do NOT just explain what you will do. If the task requires action, CALL THE TOOLS immediately. You can explain your reasoning in the "answer" field while ALSO including tool_calls.
2. **Call multiple tools in parallel** when they don't depend on each other's results
3. **Provide all required parameters** - missing required parameters will cause errors
4. **Use exact tool names** - tool names are case-sensitive
5. **Return empty tool_calls ONLY** when you have completed the task and no more action is needed
6. **Sequential calls**: If tool B needs the result of tool A, call A first, wait for results, then call B

WRONG (just explaining):
{ "answer": "I will create the file...", "tool_calls": [] }

CORRECT (action + explanation):
{ "answer": "Creating the file now.", "tool_calls": [{"tool_name": "write_file", "arguments": {...}}] }`;
  }

  /**
   * Call LLM for single item with tool context
   */
  private async callLLMForItemWithTools<TInput, TOutput>(
    item: TInput,
    toolContext: ToolExecutionResult[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<{ output?: TOutput; tool_calls?: ToolCallRequest[] }> {
    // Build task with tool context
    const taskWithContext = toolContext.length > 0
      ? this.buildTaskWithToolResults(config.userTask ?? '', toolContext)
      : config.userTask ?? '';

    // Create combined schema: either output OR tool_calls
    const combinedSchema: any = {
      ...config.outputSchema,
      tool_calls: {
        type: 'array',
        description: 'Tools to call if you need more information. Leave an empty array if you can provide the final output.',
        required: false,
        items: {
          type: 'object',
          properties: {
            tool_name: { type: 'string', required: true },
            arguments: { type: 'object', required: true },
          },
        },
      },
    };

    // Call LLM
    const { customMerge, tools, toolMode, maxIterationsPerItem, toolChoice, useNativeToolCalling, nativeToolProvider, toolExecutor, ...restConfig } = config;
    const result = await this.executeLLMBatch<TInput, TOutput & { tool_calls?: ToolCallRequest[] }>(
      [item],
      {
        ...restConfig,
        userTask: taskWithContext,
        outputSchema: combinedSchema,
        systemPrompt: config.tools && config.tools.length > 0
          ? this.buildSystemPromptWithTools(config.tools)
          : config.systemPrompt,
      }
    );

    const response = Array.isArray(result) ? result[0] : result.items[0];

    // Debug logging
    console.log('      [DEBUG] Raw response:', JSON.stringify(response, null, 2).substring(0, 500));

    // Separate output from tool_calls
    const { tool_calls, ...output } = response as any;

    // Filter and validate tool_calls
    const validToolCalls: ToolCallRequest[] = [];
    if (tool_calls && Array.isArray(tool_calls)) {
      for (const tc of tool_calls) {
        // Skip empty strings or invalid objects
        if (typeof tc === 'string' && tc.trim() === '') {
          continue;
        }
        if (typeof tc === 'object' && tc.tool_name && tc.arguments) {
          validToolCalls.push(tc);
        }
      }
    }

    // Return both output and tool_calls (if any)
    // This allows the caller to access reasoning even when tools are called
    if (validToolCalls.length > 0) {
      console.log('      [DEBUG] Returning tool calls:', validToolCalls);
      return { output: output as TOutput, tool_calls: validToolCalls };
    }

    // No tool_calls, just return output
    console.log('      [DEBUG] Returning output (no valid tool calls)');
    return { output: output as TOutput };
  }

  /**
   * Execute tool calls
   */
  private async executeToolCalls(
    toolCalls: ToolCallRequest[],
    toolExecutor?: ToolExecutor
  ): Promise<ToolExecutionResult[]> {
    if (toolExecutor) {
      return toolExecutor.executeBatch(toolCalls);
    }

    // Default: mock execution
    console.warn('   ⚠️  No toolExecutor provided, using mock execution');
    return toolCalls.map(tc => ({
      tool_name: tc.tool_name,
      success: true,
      result: { mock: true, tool: tc.tool_name, arguments: tc.arguments },
    }));
  }

  /**
   * Batch process items with tool results
   */
  private async batchProcessWithToolResults<TInput, TOutput>(
    items: TInput[],
    toolResults: ToolExecutionResult[],
    config: LLMStructuredCallConfig<TInput, TOutput>
  ): Promise<(TInput & TOutput)[] | LLMBatchResult<TInput, TOutput, any>> {
    // Build enhanced user task with tool results
    const enhancedTask = this.buildTaskWithToolResults(config.userTask ?? '', toolResults);

    // Execute regular batch with enhanced context
    return this.executeLLMBatch(items, {
      ...config,
      userTask: enhancedTask,
    });
  }

  /**
   * Build task with tool results context
   */
  private buildTaskWithToolResults(originalTask: string, toolResults: ToolExecutionResult[]): string {
    if (toolResults.length === 0) {
      return originalTask;
    }

    const resultsStr = toolResults
      .map((r, i) => {
        const status = r.success ? '✓ SUCCESS' : '✗ FAILED';
        const resultStr = typeof r.result === 'object'
          ? JSON.stringify(r.result, null, 2)
          : String(r.result);
        return `Tool ${i + 1}: ${r.tool_name} [${status}]\nResult: ${resultStr}`;
      })
      .join('\n\n');

    const successCount = toolResults.filter(r => r.success).length;
    const failCount = toolResults.filter(r => !r.success).length;

    return `=== TASK ===
${originalTask}

=== TOOL RESULTS ===
${successCount} succeeded, ${failCount} failed

${resultsStr}

Continue executing tools until the task is fully complete.`;
  }

  /**
   * Estimate response tokens for a batch based on output schema
   */
  private estimateResponseTokensForBatch(
    itemCount: number,
    outputSchema: OutputSchema<any>,
    globalSchema?: OutputSchema<any>
  ): number {
    // Estimate tokens per item based on schema fields
    const fieldsPerItem = Object.keys(outputSchema).length;
    const tokensPerField = 50; // Average tokens per field
    const tokensPerItem = fieldsPerItem * tokensPerField;

    // Add global schema if present
    const globalTokens = globalSchema ? Object.keys(globalSchema).length * tokensPerField : 0;

    // Total: items + global + XML overhead
    return (itemCount * tokensPerItem) + globalTokens + 100;
  }

  /**
   * Estimate cost based on provider/model token pricing
   */
  private estimateCost(
    promptTokens: number,
    responseTokens: number,
    provider: string,
    model?: string
  ): number {
    // Simplified cost estimation (USD per 1M tokens)
    // These are rough estimates - actual pricing varies
    const pricing: Record<string, { input: number; output: number }> = {
      'gemini': { input: 0.35, output: 1.05 }, // Gemini 1.5 Pro
      'openai': { input: 10, output: 30 }, // GPT-4 Turbo
      'anthropic': { input: 3, output: 15 }, // Claude 3.5 Sonnet
      'ollama': { input: 0, output: 0 }, // Local, free
    };

    const rates = pricing[provider.toLowerCase()] || { input: 1, output: 3 };

    const inputCost = (promptTokens / 1_000_000) * rates.input;
    const outputCost = (responseTokens / 1_000_000) * rates.output;

    return inputCost + outputCost;
  }
}
