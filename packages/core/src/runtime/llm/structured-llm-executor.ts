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
import * as fs from 'fs';
import { LuciformXMLParser } from '@luciformresearch/xmlparser';
import type { EntityContext, EntityField } from '../types/entity-context.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { QueryFeedback } from '../reranking/llm-reranker.js';
import { getFilenameTimestamp, formatLocalDate } from '../utils/timestamp.js';
import { getRagforgeEnvPath } from '../../utils/path-utils.js';
import {
  GeminiNativeToolProvider,
  type ToolDefinition,
  type ToolCall,
  type Message as NativeMessage,
  type NativeToolCallingProvider,
} from './native-tool-calling/index.js';

// ===== CUSTOM ERRORS =====

/**
 * Error thrown when LLM response parsing fails
 * Includes the raw response for debugging
 */
export class LLMParseError extends Error {
  public rawResponse: string;
  public responsePreview: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = 'LLMParseError';
    this.rawResponse = rawResponse ?? '';
    this.responsePreview = (rawResponse ?? '').substring(0, 2000);
  }
}

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
  /** Request ID for tracing (auto-generated if not provided) */
  requestId?: string;
  /** Caller identifier for logging (e.g., "GenericSummarizer.summarize", "RagAgent.iterate") */
  caller: string;

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
  /** Reasoning from the LLM that led to this tool call (for context in subsequent iterations) */
  reasoning?: string;
}

// ===== TOOL CONTEXT SUMMARIZATION =====

/**
 * A file/resource mentioned in tool results
 */
export interface ToolContextResource {
  path: string;
  type: 'file' | 'url' | 'directory' | 'other';
  relevance: string;  // Why this resource matters
  keyExcerpts?: Array<{
    lines?: string;     // e.g., "42-58"
    content: string;    // Relevant snippet
  }>;
}

/**
 * A Neo4j node mentioned in tool results
 */
export interface ToolContextNode {
  uuid: string;
  name: string;
  type: 'scope' | 'file' | 'webpage' | 'document' | 'markdown_section' | 'codeblock' | 'other';
  subtype?: string;     // For scope: function, method, class, interface
  location?: string;    // File path or URL
  relevance: string;    // Why this node matters
  lines?: string;       // e.g., "10-25"
}

/**
 * Summarized tool context - replaces raw ToolExecutionResult[] when context gets too large
 */
export interface ToolContextSummary {
  /** Indicates this is a summarized context */
  isSummarized: true;

  /** Resources (files, URLs) referenced */
  resources: ToolContextResource[];

  /** Neo4j nodes mentioned (with UUIDs) */
  nodes: ToolContextNode[];

  /** Narrative summary of findings */
  findings: string;

  /** What remains to be explored */
  gaps?: string[];

  /** Suggested next steps (searches, reads, explores) */
  suggestions?: Array<{
    type: 'search' | 'explore' | 'read';
    target: string;
    reason: string;
  }>;

  /** Original tool count before summarization */
  originalToolCount: number;

  /** Character count before summarization */
  originalCharCount: number;
}

/**
 * Tool context can be either raw results or a summarized version
 */
export type ToolContext = ToolExecutionResult[] | ToolContextSummary;

/**
 * Check if tool context is summarized
 */
export function isToolContextSummary(ctx: ToolContext): ctx is ToolContextSummary {
  return (ctx as ToolContextSummary).isSummarized === true;
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

        // Check if result indicates failure:
        // 1. result.success === false (explicit failure)
        // 2. result has 'error' field but no 'success' field (implicit failure)
        const isFailure = result && typeof result === 'object' && (
          ('success' in result && result.success === false) ||
          ('error' in result && !('success' in result))
        );

        if (isFailure) {
          const errorMsg = result.error || 'Tool returned success: false';
          console.error(`   ❌ Tool ${toolCall.tool_name} failed:`, errorMsg);
          return {
            tool_name: toolCall.tool_name,
            success: false,
            error: errorMsg,
            result, // Include full result for context
          };
        }

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
  uuid: string;
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
 * Prompt sections that can be reordered in SingleLLMCallConfig
 * This allows customizing which sections appear and in what order
 */
export type PromptSection =
  | 'system_prompt'      // System prompt (persona, guidelines)
  | 'tool_descriptions'  // Available tools and their descriptions
  | 'current_report'     // Current report in progress (for report-building agents)
  | 'user_task'          // The user's task/question
  | 'context_data'       // Additional context data (JSON)
  | 'input_fields'       // Input fields with values
  | 'tool_results'       // Results from previous tool calls
  | 'previous_output'    // Previous output (for progressive mode)
  | 'output_format'      // Required output format instructions
  | 'instructions';      // Additional instructions

/**
 * Default prompt sequence - sections appear in this order
 */
export const DEFAULT_PROMPT_SEQUENCE: PromptSection[] = [
  'system_prompt',
  'tool_descriptions',
  'user_task',
  'context_data',
  'input_fields',
  'previous_output',   // Your previous reasoning, which led to...
  'tool_results',      // ...these tool results
  'current_report',    // Current report state (read carefully before appending!)
  'output_format',
  'instructions',
];

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
  /** Request ID for tracing (auto-generated if not provided) */
  requestId?: string;
  /** Caller identifier for logging (e.g., "ResearchAgent.iterate", "brain_search.summarize") */
  caller: string;

  // === TOOL CALLING ===
  /** Available tools */
  tools?: ToolDefinition[];
  /** Custom tool executor */
  toolExecutor?: ToolExecutor;
  /** Max tool call rounds (default: 10). This is the primary limit on how many times the LLM can call tools. */
  maxIterations?: number;
  /** Max tool call rounds within a single outer iteration (default: same as maxIterations) */
  maxToolCallRounds?: number;
  /** Callback to get current report content (displayed in prompt if report exists) */
  getCurrentReport?: () => string | null;
  /** Use native tool calling (Gemini API) instead of XML parsing (default: false for backwards compat) */
  useNativeToolCalling?: boolean;
  /** Native tool calling provider (required if useNativeToolCalling is true) */
  nativeToolProvider?: NativeToolCallingProvider;

  // === TOOL CONTEXT SUMMARIZATION ===
  /**
   * Summarize tool context when it exceeds a threshold (default: false)
   * When enabled, accumulated tool results are compressed into a structured summary
   * containing resources, Neo4j nodes, and key findings.
   */
  summarizeToolContext?: boolean;
  /** Character threshold to trigger summarization (default: 50000 ~= 12k tokens) */
  toolContextSummarizationThreshold?: number;

  /** Callback called with each LLM response */
  onLLMResponse?: (response: {
    iteration: number;
    reasoning?: string;
    toolCalls?: ToolCallRequest[];
    output?: TOutput;
  }) => void;

  /**
   * Required tools that MUST be called at least once.
   * If not called after `afterRounds` rounds, a warning is injected into tool context.
   * Example: { tools: ['set_report', 'append_to_report'], afterRounds: 1, warning: 'You MUST call a report tool!' }
   */
  requiredTools?: {
    /** Tool names (any of these must be called) */
    tools: string[];
    /** Inject warning after this many rounds without calling any of these tools */
    afterRounds: number;
    /** Warning message to inject */
    warning: string;
  };

  // === DEBUGGING ===
  logPrompts?: boolean | string;
  logResponses?: boolean | string;

  // === PROGRESSIVE OUTPUT ===
  /**
   * Progressive output mode: The LLM refines its output over multiple iterations.
   * Previous output is passed back to the LLM so it can improve/extend it.
   * Useful for building reports incrementally until confident.
   */
  progressiveOutput?: ProgressiveOutputConfig<TOutput>;

  // === PROMPT SEQUENCE ===
  /**
   * Custom prompt section sequence.
   * Controls the order of sections in the prompt.
   * Default: DEFAULT_PROMPT_SEQUENCE (system_prompt, tool_descriptions, current_report, user_task, etc.)
   *
   * Use this to:
   * - Move tool_results closer to the end to focus attention on recent findings
   * - Put current_report right before output_format to emphasize it
   * - Omit sections by not including them in the array
   *
   * Example: ['system_prompt', 'tool_descriptions', 'user_task', 'input_fields', 'tool_results', 'current_report', 'output_format', 'instructions']
   */
  promptSequence?: PromptSection[];
}

/**
 * Progressive output configuration
 */
export interface ProgressiveOutputConfig<TOutput = any> {
  /** Field name in output that indicates completion status (default: 'confidence') */
  completionField?: keyof TOutput | string;
  /** Value(s) that indicate completion (default: ['high', 'complete', 'done', true]) */
  completionValues?: any[];
  /** Callback called with each partial output for streaming to UI */
  onProgress?: (output: Partial<TOutput>, iteration: number, isComplete: boolean) => void;
}

/**
 * Unified executor for all LLM structured operations
 */
export class StructuredLLMExecutor {
  // LlamaIndex multi-provider support - DISABLED
  // private llmProviders: Map<string, LLMProviderAdapter> = new Map();
  // private embeddingProviders: Map<string, EmbeddingProviderAdapter> = new Map();
  private nativeToolProvider?: GeminiNativeToolProvider;

  // Global logging configuration (lazy initialized from ~/.ragforge/.env)
  private static _loggingEnabled: boolean | null = null;
  private static _analyzeEnabled: boolean | null = null;
  private static _logDir: string = process.env.RAGFORGE_LLM_LOG_DIR || '';

  /** Enable/disable global LLM call logging */
  static set loggingEnabled(value: boolean) {
    StructuredLLMExecutor._loggingEnabled = value;
  }
  static get loggingEnabled(): boolean {
    return StructuredLLMExecutor.isLoggingEnabled();
  }

  /** Set custom log directory (default: ~/.ragforge/logs/llm-calls) */
  static set logDir(value: string) {
    StructuredLLMExecutor._logDir = value;
  }
  static get logDir(): string {
    return StructuredLLMExecutor._logDir;
  }

  /** Read a boolean env var from process.env or ~/.ragforge/.env (sync version using imports at top) */
  private static readEnvBool(varName: string): boolean {
    // Check process.env first
    if (process.env[varName] === 'true') {
      return true;
    }
    // Check ~/.ragforge/.env using already-imported modules
    try {
      const envPath = getRagforgeEnvPath();
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const regex = new RegExp(`^${varName}\\s*=\\s*["']?true["']?\\s*$`, 'm');
        if (content.match(regex)) {
          return true;
        }
      }
    } catch {
      // Ignore errors
    }
    return false;
  }

  /** Check if LLM call logging is enabled (lazy init) */
  private static isLoggingEnabled(): boolean {
    if (this._loggingEnabled === null) {
      this._loggingEnabled = this.readEnvBool('RAGFORGE_LOG_LLM_CALLS');
      if (this._loggingEnabled) {
        console.log('[StructuredLLMExecutor] LLM call logging enabled');
      }
    }
    return this._loggingEnabled;
  }

  /** Check if LLM call analysis is enabled (lazy init) */
  private static isAnalyzeEnabled(): boolean {
    if (this._analyzeEnabled === null) {
      this._analyzeEnabled = this.readEnvBool('RAGFORGE_ANALYZE_LLM_CALLS');
      if (this._analyzeEnabled) {
        console.log('[StructuredLLMExecutor] LLM call analysis enabled');
      }
    }
    return this._analyzeEnabled;
  }

  constructor(
    private defaultLLMConfig?: LLMConfig,
    private defaultEmbeddingConfig?: { provider?: string; model?: string }
  ) {}

  /**
   * Log an LLM call (prompt + response) to disk for debugging.
   * Files are saved to: {logDir}/{caller}/{timestamp}/prompt.txt and response.txt
   *
   * @param caller - Explicit caller identifier (e.g., "ResearchAgent.iterate")
   * @param prompt - The prompt sent to the LLM
   * @param response - The LLM's response
   * @param requestId - Request ID for tracing
   * @param metadata - Additional metadata to log
   */
  private async logLLMCall(
    caller: string,
    prompt: string,
    response: string,
    requestId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!StructuredLLMExecutor.isLoggingEnabled()) return;

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      // Sanitize caller for use as folder name
      const safeCaller = caller.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';

      // Generate timestamp for this call (local timezone)
      const timestamp = getFilenameTimestamp();

      // Build log directory path
      const baseDir = StructuredLLMExecutor._logDir || path.join(os.homedir(), '.ragforge', 'logs', 'llm-calls');
      const callDir = path.join(baseDir, safeCaller, timestamp);

      await fs.mkdir(callDir, { recursive: true });

      // Write prompt
      await fs.writeFile(path.join(callDir, 'prompt.txt'), prompt, 'utf-8');

      // Write response
      await fs.writeFile(path.join(callDir, 'response.txt'), response, 'utf-8');

      // Write metadata
      const fullMetadata = {
        caller,
        requestId,
        timestamp: formatLocalDate(),
        ...metadata,
      };
      await fs.writeFile(
        path.join(callDir, 'metadata.json'),
        JSON.stringify(fullMetadata, null, 2),
        'utf-8'
      );

      // Auto-analyze if enabled (skip for analysis calls themselves to prevent recursion)
      if (StructuredLLMExecutor.isAnalyzeEnabled() && !caller.includes('LLMCallAnalyzer')) {
        // Fire and forget - don't block the main flow
        this.analyzeLLMCall(prompt, response, caller, callDir).catch(err => {
          console.warn('[StructuredLLMExecutor] LLM call analysis failed:', err.message);
        });
      }
    } catch (error) {
      // Don't fail the main operation if logging fails
      console.warn('[StructuredLLMExecutor] Failed to log LLM call:', error);
    }
  }

  /**
   * Analyze an LLM call (prompt + response) and write feedback to disk.
   * This helps identify issues with prompts and suggests improvements.
   */
  private async analyzeLLMCall(
    prompt: string,
    response: string,
    caller: string,
    callDir: string
  ): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) return;

    // Use clear delimiters to avoid confusion when prompt/response contain XML or code
    const analysisPrompt = `Tu es un expert en prompt engineering. Analyse cet appel LLM et fournis un feedback concis.

## Contexte
- Caller: ${caller}
- Prompt length: ${prompt.length} chars
- Response length: ${response.length} chars

IMPORTANT: Les données entre ===BEGIN_PROMPT=== / ===END_PROMPT=== et ===BEGIN_RESPONSE=== / ===END_RESPONSE=== sont les données à analyser. Elles peuvent contenir du XML, du code, etc. - c'est normal, c'est le contenu de l'appel LLM. Ne confonds pas ce contenu avec le format de TA réponse.

===BEGIN_PROMPT===
${prompt}
===END_PROMPT===

===BEGIN_RESPONSE===
${response}
===END_RESPONSE===

## Analyse demandée

Réponds en français avec ces sections (en texte simple, PAS en XML):

### 1. Validité de la réponse (score /10)
La réponse est-elle correcte et complète par rapport au prompt?

### 2. Problèmes détectés
Liste les problèmes (si présents):
- Instructions ambiguës
- Informations manquantes dans le prompt
- Réponse hors-sujet ou incomplète
- Format de sortie incorrect

### 3. Améliorations suggérées pour le prompt
Suggestions concrètes pour améliorer ce prompt:
- Clarifications à ajouter
- Exemples à inclure
- Structure à modifier

### 4. Score global (/10)
Note globale de la qualité de cet échange prompt/response.

Sois concis et actionnable.`;

    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const result = await model.generateContent(analysisPrompt);
      const analysis = result.response.text();

      // Write analysis to file
      await fs.writeFile(
        path.join(callDir, 'analysis.md'),
        `# Analyse automatique de l'appel LLM\n\n_Généré le ${formatLocalDate()}_\n\n${analysis}`,
        'utf-8'
      );
    } catch (error: any) {
      // Write error to file instead of failing silently
      await fs.writeFile(
        path.join(callDir, 'analysis-error.txt'),
        `Analysis failed: ${error.message}`,
        'utf-8'
      ).catch(() => {});
    }
  }

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

    // Generate base request ID for this batch operation
    const baseRequestId = config.requestId || `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 2. Pack items into optimal batches
    const batches = this.packBatches(items, config);
    console.log(
      `[StructuredLLMExecutor] 📦 Batching [${baseRequestId}]: ${items.length} items → ${batches.length} batch(es) | ` +
      `Items per batch: [${batches.map(b => b.items.length).join(', ')}] | ` +
      `Parallel: ${config.parallel || 5}`
    );

    // 3. Execute batches in parallel (pass baseRequestId)
    const responses = await this.executeParallelLLM(batches, config, baseRequestId);

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
    let summarizedToolContext: ToolContextSummary | null = null; // Cached summary when threshold is hit

    // Progressive output mode: track accumulated output across iterations
    let progressiveOutput: Partial<TOutput> | undefined = undefined;
    const progressiveConfig = config.progressiveOutput;
    const completionField = progressiveConfig?.completionField ?? 'confidence';
    const completionValues = progressiveConfig?.completionValues ?? ['high', 'complete', 'done', true];

    // Debug logging for fuzzy search decision
    if (config.requestId?.includes('fuzzy-search-decision')) {
      console.log(`[executeSingle] [${config.requestId}] Starting with maxIterations=${maxIterations}, config.maxIterations=${config.maxIterations}, hasTools=${!!(config.tools && config.tools.length > 0)}`);
    }

    // Generate request ID if not provided (for tracing)
    const baseRequestId = config.requestId || `llm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Allow multiple tool call rounds within a single iteration (for mini-agents like fuzzy search)
    // This is controlled by maxToolCallRounds (default: same as maxIterations for intuitive behavior)
    const maxToolCallRounds = config.maxToolCallRounds ?? maxIterations;
    let toolCallRound = 0;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // Reset tool call round counter for each iteration
      toolCallRound = 0;
      
      // Declare variables outside the while loop so they're accessible after it
      let parsed: TOutput | undefined;
      let requestId: string = baseRequestId;

      // Inner loop for multiple tool call rounds within a single iteration
      while (toolCallRound < maxToolCallRounds) {
        toolCallRound++;

        // Check if tool context summarization is needed
        let toolContextForPrompt: ToolContext = toolContext;
        if (config.summarizeToolContext && toolContext.length > 0) {
          const threshold = config.toolContextSummarizationThreshold ?? 50000;
          const currentSize = toolContext.reduce(
            (sum, r) => sum + JSON.stringify(r.result ?? r.error ?? '').length,
            0
          );

          if (currentSize > threshold) {
            // Summarize if we don't have a cached summary or if new results were added
            if (!summarizedToolContext || toolContext.length > summarizedToolContext.originalToolCount) {
              console.log(
                `[executeSingle] Tool context exceeds threshold (${currentSize} > ${threshold}), summarizing...`
              );
              summarizedToolContext = await this.summarizeToolContext(toolContext, config.llmProvider);
            }
            toolContextForPrompt = summarizedToolContext;
          }
        }

        // Generate request ID for this iteration/round
        requestId = iteration === 1 && toolCallRound === 1
          ? baseRequestId
          : `${baseRequestId}-iter${iteration}${toolCallRound > 1 ? `-round${toolCallRound}` : ''}`;

        // Variables for LLM response
        let response: string = '';
        let validToolCalls: ToolCallRequest[] = [];
        let llmTextContent: string = '';

        // === NATIVE TOOL CALLING MODE ===
        if (config.useNativeToolCalling && config.nativeToolProvider) {
          // Build messages for native tool calling
          const messages = this.buildMessagesForNativeToolCalling(
            config,
            toolContext,
            [], // No previous messages tracking for now (could be added)
            progressiveOutput
          );

          // Log prompt if requested
          if (config.logPrompts) {
            const messagesStr = messages.map(m => `[${m.role}]: ${m.content?.substring(0, 500)}...`).join('\n');
            await this.logContent(`PROMPT [${requestId}] [iter ${iteration}, round ${toolCallRound}] (native)`, messagesStr, config.logPrompts);
          }

          // Call native tool provider
          const nativeResponse = await config.nativeToolProvider.generateWithTools(
            messages,
            config.tools || [],
            { toolChoice: 'auto' }
          );

          // Extract response data
          llmTextContent = nativeResponse.content || '';
          response = llmTextContent; // For logging compatibility

          // Convert native tool calls to our format
          validToolCalls = this.convertNativeToolCallsToRequests(nativeResponse.toolCalls);

          // Log response if requested
          if (config.logResponses) {
            const responseStr = `Text: ${llmTextContent}\nTool calls: ${JSON.stringify(validToolCalls, null, 2)}`;
            await this.logContent(`RESPONSE [iter ${iteration}, round ${toolCallRound}] (native)`, responseStr, config.logResponses);
          }

          // Build parsed output from text content and tool calls
          // For native mode, we trust the LLM to have called tools, no XML parsing needed
          parsed = {
            answer: llmTextContent,
            reasoning: llmTextContent,
            tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
          } as TOutput;

          // Log for debugging
          if (requestId.includes('fuzzy-search-decision')) {
            console.log(`[executeSingle] [${requestId}] Native response [iter ${iteration}, round ${toolCallRound}]:`, {
              text: llmTextContent.substring(0, 500),
              toolCalls: validToolCalls,
            });
          }
        }
        // === TEXT-BASED TOOL CALLING MODE (XML/JSON parsing) ===
        else {
          // Build prompt (pass progressiveOutput for progressive mode)
          const prompt = this.buildSinglePrompt(config, toolContextForPrompt, progressiveOutput);

          // Log prompt if requested
          if (config.logPrompts) {
            await this.logContent(`PROMPT [${requestId}] [iter ${iteration}, round ${toolCallRound}]`, prompt, config.logPrompts);
          }

          // Call LLM with request ID
          response = await config.llmProvider.generateContent(prompt, requestId);

          // Global LLM call logging (if enabled)
          await this.logLLMCall(config.caller, prompt, response, requestId, {
            method: 'executeSingle',
            iteration,
            toolCallRound,
          });

          // Log raw response for fuzzy search decision debugging
          if (requestId.includes('fuzzy-search-decision')) {
            console.log(`[executeSingle] [${requestId}] Raw LLM response [iter ${iteration}, round ${toolCallRound}]:`, response.substring(0, 500));
          }

          // Log response if requested
          if (config.logResponses) {
            await this.logContent(`RESPONSE [iter ${iteration}, round ${toolCallRound}]`, response, config.logResponses);
          }

          // Parse response with error recovery
          const format = config.outputFormat || 'xml';
          let parseError: string | null = null;

          try {
            const parsedOrPromise = this.parseSingleResponse<TOutput>(response, config.outputSchema, format);
            parsed = parsedOrPromise instanceof Promise ? await parsedOrPromise : parsedOrPromise;
          } catch (error: any) {
            // Analyze the error programmatically
            parseError = this.analyzeParseError(response, config.outputSchema, format, error);
            console.error(`[executeSingle] Parse error at iter ${iteration}, round ${toolCallRound}: ${parseError}`);

            // Add parse error to tool context so LLM sees it in next iteration
            toolContext.push({
              tool_name: '_parse_error',
              success: false,
              error: parseError,
              result: null,
            });

            // Continue to next iteration (don't crash!)
            break; // Break from inner while loop, continue outer for loop
          }

          // Log parsed response for fuzzy search decision debugging
          if (requestId.includes('fuzzy-search-decision')) {
            console.log(`[executeSingle] [${requestId}] Parsed response [iter ${iteration}, round ${toolCallRound}]:`, JSON.stringify(parsed, null, 2));
          }

          // Extract tool_calls if present
          const toolCalls = (parsed as any).tool_calls as ToolCallRequest[] | undefined;
          validToolCalls = this.filterValidToolCalls(toolCalls);
        }

        // Call callback
        if (config.onLLMResponse) {
          config.onLLMResponse({
            iteration,
            reasoning: (parsed as any).answer || (parsed as any).reasoning,
            toolCalls: validToolCalls,
            output: parsed,
          });
        }

        // Progressive output mode: update accumulated output and check for completion
        if (progressiveConfig && parsed) {
          // Update progressive output (excluding tool_calls)
          const { tool_calls: _, ...outputWithoutTools } = parsed as any;
          const prevOutput = (progressiveOutput ?? {}) as Record<string, unknown>;
          progressiveOutput = { ...prevOutput, ...outputWithoutTools } as Partial<TOutput>;

          // Check if completion criteria is met
          const completionValue = (progressiveOutput as any)?.[completionField];
          const isComplete = completionValues.includes(completionValue);

          // Call progress callback
          if (progressiveConfig.onProgress && progressiveOutput) {
            progressiveConfig.onProgress(progressiveOutput, iteration, isComplete);
          }

          // If complete and no more tool calls, we can return early
          if (isComplete && validToolCalls.length === 0) {
            return progressiveOutput as TOutput;
          }
        }

        // If we have tool calls, execute them
        if (validToolCalls.length > 0 && config.toolExecutor) {
          const toolResults = await this.executeToolCalls(validToolCalls, config.toolExecutor);

          // Attach the reasoning that led to these tool calls (for context in subsequent iterations)
          const currentReasoning = (parsed as any).answer || (parsed as any).reasoning;
          if (currentReasoning && toolResults.length > 0) {
            // Only attach reasoning to the first tool result to avoid duplication
            toolResults[0].reasoning = currentReasoning;
          }

          toolContext.push(...toolResults);
          toolResults.forEach(r => {
            if (!toolsUsed.includes(r.tool_name)) {
              toolsUsed.push(r.tool_name);
            }
          });

          // Check for required tools warning
          if (config.requiredTools && toolCallRound >= config.requiredTools.afterRounds) {
            const hasRequiredTool = config.requiredTools.tools.some(t => toolsUsed.includes(t));
            if (!hasRequiredTool) {
              // Inject warning into tool context
              toolContext.push({
                tool_name: '_system_warning',
                success: false,
                error: `⚠️ ATTENTION: ${config.requiredTools.warning}\n` +
                  `You have completed ${toolCallRound} round(s) without calling any of: ${config.requiredTools.tools.join(', ')}.\n` +
                  `Your next response MUST include one of these tools!`,
                result: null,
              });
            }
          }

          // Special case: if maxIterations === 1 and maxToolCallRounds === 1,
          // return immediately after executing tools (no need for final LLM response)
          if (maxIterations === 1 && maxToolCallRounds === 1 && toolContext.length > 0) {
            // Return a minimal output indicating tools were executed
            return { done: true } as TOutput;
          }
          
          // Continue to next tool call round within the same iteration
          continue;
        }

        // No tool calls - check if we have valid output and break from inner loop
        break;
      }

      // After the while loop, parsed and requestId are available
      // Special case: if we executed tools and maxIterations === 1, return immediately
      if (maxIterations === 1 && toolContext.length > 0) {
        return { done: true } as TOutput;
      }
      
      if (!parsed) {
        throw new Error(`No valid output after iteration ${iteration}`);
      }

      // No tool calls - check if we have valid output
      const outputFields = Object.keys(config.outputSchema).filter(k => k !== 'tool_calls');
      const hasValidOutput = outputFields.some(k => {
        const value = (parsed as any)[k];
        return value !== undefined && value !== '' && value !== null;
      });

      // Be more conservative: only return if we have valid output AND:
      // 1. We've used at least one tool (to ensure we've searched), OR
      // 2. The output explicitly indicates completion (e.g., contains "complete", "done", etc.), OR
      // 3. We're at max iterations (to avoid infinite loops)
      const hasUsedTools = toolContext.length > 0;
      const outputText = JSON.stringify(parsed).toLowerCase();
      const indicatesCompletion = outputText.includes('complete') || 
                                  outputText.includes('done') || 
                                  outputText.includes('finished') ||
                                  outputText.includes('trouvé') ||
                                  outputText.includes('terminé');

      // If no tools are configured, return immediately when we have valid output
      const hasToolsConfigured = config.tools && config.tools.length > 0;
      
      // Debug logging for fuzzy search decision case
      if (requestId.includes('fuzzy-search-decision')) {
        console.log(`[executeSingle] [${requestId}] Debug:`, {
          hasValidOutput,
          hasToolsConfigured,
          hasUsedTools,
          indicatesCompletion,
          iteration,
          maxIterations,
          outputFields,
          parsedKeys: Object.keys(parsed as any),
          parsedValues: Object.fromEntries(outputFields.map(k => [k, (parsed as any)[k]]))
        });
      }
      
      if (hasValidOutput && (!hasToolsConfigured || hasUsedTools || indicatesCompletion || iteration >= maxIterations)) {
        // Remove tool_calls from output
        const { tool_calls: _, ...output } = parsed as any;
        if (requestId.includes('fuzzy-search-decision')) {
          console.log(`[executeSingle] [${requestId}] Returning output after iteration ${iteration}`);
        }
        return output as TOutput;
      }

      // If we have output but haven't used tools yet and tools are available, encourage tool usage
      if (hasValidOutput && !hasUsedTools && hasToolsConfigured && iteration < maxIterations) {
        // Don't return yet - we want the agent to use tools first
        // This ensures thorough investigation before answering
        // The prompt will remind the agent to use tools
        if (requestId.includes('fuzzy-search-decision')) {
          console.log(`[executeSingle] [${requestId}] Continuing iteration ${iteration} - waiting for tools`);
        }
        continue;
      }
      
      // If no valid output and not at max iterations, continue
      if (!hasValidOutput && iteration < maxIterations) {
        if (requestId.includes('fuzzy-search-decision')) {
          console.log(`[executeSingle] [${requestId}] No valid output at iteration ${iteration}, continuing...`);
        }
        continue;
      }

      // No tool calls and no valid output - error
      if (iteration === maxIterations) {
        // In progressive mode, return the accumulated output even if not complete
        if (progressiveConfig && progressiveOutput) {
          // Call progress callback with isComplete=false
          if (progressiveConfig.onProgress) {
            progressiveConfig.onProgress(progressiveOutput, iteration, false);
          }
          return progressiveOutput as TOutput;
        }
        throw new Error(`Max iterations (${maxIterations}) reached without valid output`);
      }
    }

    // In progressive mode, return the accumulated output
    if (progressiveConfig && progressiveOutput) {
      return progressiveOutput as TOutput;
    }

    throw new Error(`Max iterations (${maxIterations}) reached without valid output`);
  }

  /**
   * Build prompt for single call (no batching)
   * Uses configurable section sequence via config.promptSequence
   */
  private buildSinglePrompt<TOutput>(
    config: SingleLLMCallConfig<TOutput>,
    toolContext: ToolContext,
    previousOutput?: Partial<TOutput>
  ): string {
    // Use custom sequence or default
    const sequence = config.promptSequence ?? DEFAULT_PROMPT_SEQUENCE;

    // Build each section
    const sections: Record<PromptSection, string | null> = {
      system_prompt: this.buildSystemPromptSection(config),
      tool_descriptions: this.buildToolDescriptionsSection(config),
      current_report: this.buildCurrentReportSection(config),
      user_task: this.buildUserTaskSection(config),
      context_data: this.buildContextDataSection(config),
      input_fields: this.buildInputFieldsSection(config),
      tool_results: this.buildToolResultsSection(toolContext),
      previous_output: this.buildPreviousOutputSection(config, previousOutput),
      output_format: this.buildOutputFormatSection(config),
      instructions: this.buildInstructionsSection(config),
    };

    // Assemble in sequence order
    const parts: string[] = [];
    for (const section of sequence) {
      const content = sections[section];
      if (content) {
        parts.push(content);
      }
    }

    return parts.join('\n');
  }

  // ===== PROMPT SECTION BUILDERS =====

  private buildSystemPromptSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.systemPrompt) return null;
    return config.systemPrompt + '\n';
  }

  private buildToolDescriptionsSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.tools || config.tools.length === 0) return null;
    return this.buildSystemPromptWithTools(config.tools) + '\n';
  }

  private buildCurrentReportSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.getCurrentReport) return null;
    const currentReport = config.getCurrentReport();
    if (!currentReport || currentReport.trim().length === 0) return null;

    const lines: string[] = [
      '## Current Report (READ CAREFULLY)',
      '',
      '**IMPORTANT RULES:**',
      '- DO NOT add content that already exists in the report below',
      '- DO NOT repeat sections, code blocks, or explanations already present',
      '- ONLY append NEW information not already covered',
      '- When the report is COMPLETE and answers the question fully, call `finalize_report` immediately',
      '',
      'Your report in progress:',
      '```markdown',
      currentReport,
      '```',
      '',
    ];
    return lines.join('\n');
  }

  private buildUserTaskSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.userTask) return null;
    return `## Task\n${config.userTask}\n`;
  }

  private buildContextDataSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.contextData) return null;
    return `## Context\n${JSON.stringify(config.contextData, null, 2)}\n`;
  }

  private buildInputFieldsSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.inputFields || config.inputFields.length === 0) return null;

    const lines: string[] = ['## Input'];
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
          lines.push(`${fieldName} (${fieldConfig.prompt}):`);
        } else {
          lines.push(`${fieldName}:`);
        }
      } else {
        lines.push(`${fieldName}:`);
      }

      lines.push(this.formatValue(value));
      lines.push('');
    }
    return lines.join('\n');
  }

  private buildToolResultsSection(toolContext: ToolContext): string | null {
    if (isToolContextSummary(toolContext)) {
      // Summarized context
      const lines: string[] = [
        '## Tool Results Summary',
        `(Summarized from ${toolContext.originalToolCount} tool calls, ${toolContext.originalCharCount} chars)`,
        '',
      ];

      // Resources
      if (toolContext.resources.length > 0) {
        lines.push('### Resources Referenced');
        for (const res of toolContext.resources) {
          lines.push(`- **${res.path}** (${res.type}): ${res.relevance}`);
          if (res.keyExcerpts && res.keyExcerpts.length > 0) {
            for (const excerpt of res.keyExcerpts) {
              if (!excerpt?.content) continue; // Skip invalid excerpts
              const lineInfo = excerpt.lines ? ` [lines ${excerpt.lines}]` : '';
              const content = excerpt.content ?? '';
              lines.push(`  - Excerpt${lineInfo}: \`${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\``);
            }
          }
        }
        lines.push('');
      }

      // Neo4j Nodes
      if (toolContext.nodes.length > 0) {
        lines.push('### Nodes Discovered');
        for (const node of toolContext.nodes) {
          const location = node.location ? ` @ ${node.location}` : '';
          const nodeLines = node.lines ? `:${node.lines}` : '';
          const subtype = node.subtype ? ` (${node.subtype})` : '';
          lines.push(`- **[${node.type}:${node.uuid}]** ${node.name}${subtype}${location}${nodeLines}`);
          lines.push(`  → ${node.relevance}`);
        }
        lines.push('');
      }

      // Findings
      lines.push('### Key Findings');
      lines.push(toolContext.findings);
      lines.push('');

      // Suggestions
      if (toolContext.suggestions && toolContext.suggestions.length > 0) {
        lines.push('### Suggested Next Steps');
        for (const suggestion of toolContext.suggestions) {
          lines.push(`- **${suggestion.type}**: ${suggestion.target}`);
          lines.push(`  → ${suggestion.reason}`);
        }
        lines.push('');
      }

      // Gaps
      if (toolContext.gaps && toolContext.gaps.length > 0) {
        lines.push('### Remaining Gaps');
        for (const gap of toolContext.gaps) {
          lines.push(`- ${gap}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    } else if (toolContext.length > 0) {
      // Raw tool results with reasoning
      const lines: string[] = ['## Tool Results'];
      for (const result of toolContext) {
        // Show reasoning before tool result (if present - indicates start of a new reasoning round)
        if (result.reasoning) {
          lines.push('');
          lines.push('#### Your Previous Reasoning');
          lines.push(result.reasoning);
          lines.push('');
        }
        const status = result.success ? '✓ SUCCESS' : '✗ FAILED';
        const resultStr = typeof result.result === 'object'
          ? JSON.stringify(result.result, null, 2)
          : String(result.result ?? result.error);
        lines.push(`### ${result.tool_name} [${status}]`);
        lines.push(resultStr);
        lines.push('');
      }
      return lines.join('\n');
    }

    return null;
  }

  // ===== NATIVE TOOL CALLING HELPERS =====

  /**
   * Build messages array for native tool calling mode
   * Converts the prompt sections into a structured message array
   */
  private buildMessagesForNativeToolCalling<TOutput>(
    config: SingleLLMCallConfig<TOutput>,
    toolContext: ToolExecutionResult[],
    previousMessages: NativeMessage[],
    previousOutput?: Partial<TOutput>
  ): NativeMessage[] {
    const messages: NativeMessage[] = [];

    // System message (combines system prompt, current report, and instructions)
    const systemParts: string[] = [];
    if (config.systemPrompt) {
      systemParts.push(config.systemPrompt);
    }

    // Add current report if available
    if (config.getCurrentReport) {
      const currentReport = config.getCurrentReport();
      if (currentReport && currentReport.trim().length > 0) {
        systemParts.push('\n## Current Report (READ CAREFULLY)\n');
        systemParts.push('**IMPORTANT RULES:**');
        systemParts.push('- DO NOT add content that already exists in the report below');
        systemParts.push('- DO NOT repeat sections, code blocks, or explanations already present');
        systemParts.push('- ONLY append NEW information not already covered');
        systemParts.push('- When the report is COMPLETE and answers the question fully, call `finalize_report` immediately');
        systemParts.push('\nYour report in progress:');
        systemParts.push('```markdown');
        systemParts.push(currentReport);
        systemParts.push('```\n');
      }
    }

    if (config.instructions) {
      systemParts.push(`\n## Additional Instructions\n${config.instructions}`);
    }

    if (systemParts.length > 0) {
      messages.push({
        role: 'system',
        content: systemParts.join('\n'),
      });
    }

    // User message (combines task, context, input fields)
    const userParts: string[] = [];

    if (config.userTask) {
      userParts.push(`## Task\n${config.userTask}`);
    }

    if (config.contextData) {
      userParts.push(`## Context\n${JSON.stringify(config.contextData, null, 2)}`);
    }

    // Input fields
    if (config.inputFields && config.inputFields.length > 0) {
      userParts.push('## Input');
      for (const fieldConfig of config.inputFields) {
        const fieldName = typeof fieldConfig === 'string' ? fieldConfig : fieldConfig.name;
        let value = config.input[fieldName];

        if (typeof fieldConfig !== 'string') {
          if (fieldConfig.transform) {
            value = fieldConfig.transform(value);
          }
          if (fieldConfig.maxLength && typeof value === 'string') {
            value = this.truncate(value, fieldConfig.maxLength);
          }
          if (fieldConfig.prompt) {
            userParts.push(`${fieldName} (${fieldConfig.prompt}):`);
          } else {
            userParts.push(`${fieldName}:`);
          }
        } else {
          userParts.push(`${fieldName}:`);
        }
        userParts.push(this.formatValue(value));
      }
    }

    // Previous output (for progressive mode)
    if (previousOutput && config.progressiveOutput) {
      userParts.push('\n## Your Previous Output');
      userParts.push('Refine and improve based on new tool results:');
      userParts.push(JSON.stringify(previousOutput, null, 2));
    }

    if (userParts.length > 0) {
      messages.push({
        role: 'user',
        content: userParts.join('\n'),
      });
    }

    // Add previous conversation (agent responses and tool results)
    messages.push(...previousMessages);

    // Add latest tool results as tool messages
    for (const result of toolContext) {
      // Skip system warnings and parse errors
      if (result.tool_name.startsWith('_')) continue;

      messages.push({
        role: 'tool',
        name: result.tool_name,
        content: result.success
          ? JSON.stringify(result.result, null, 2)
          : `Error: ${result.error}`,
      });
    }

    return messages;
  }

  /**
   * Convert native ToolCall[] to ToolCallRequest[] format
   */
  private convertNativeToolCallsToRequests(toolCalls: ToolCall[] | undefined): ToolCallRequest[] {
    if (!toolCalls || toolCalls.length === 0) return [];

    return toolCalls.map(tc => ({
      tool_name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));
  }

  private buildPreviousOutputSection<TOutput>(
    config: SingleLLMCallConfig<TOutput>,
    previousOutput?: Partial<TOutput>
  ): string | null {
    if (!previousOutput || !config.progressiveOutput) return null;

    const lines: string[] = [
      '## Your Previous Output',
      'This is your output from the previous iteration. Refine and improve it based on new tool results.',
      'You should:',
      '- Keep what is correct',
      '- Add new information discovered',
      '- Correct any errors',
      '- Update confidence level based on completeness',
      '',
    ];

    const format = config.outputFormat || 'xml';
    if (format === 'xml') {
      lines.push('<previous_output>');
      for (const [key, value] of Object.entries(previousOutput)) {
        if (key !== 'tool_calls') {
          const formattedValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
          lines.push(`  <${key}>${formattedValue}</${key}>`);
        }
      }
      lines.push('</previous_output>');
    } else {
      lines.push('```' + format);
      lines.push(JSON.stringify(previousOutput, null, 2));
      lines.push('```');
    }
    lines.push('');

    return lines.join('\n');
  }

  private buildOutputFormatSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    const lines: string[] = [
      '## Required Output Format',
      this.generateSingleOutputInstructions(config.outputSchema, config.outputFormat || 'xml', !!config.tools),
      '',
    ];
    return lines.join('\n');
  }

  private buildInstructionsSection<TOutput>(config: SingleLLMCallConfig<TOutput>): string | null {
    if (!config.instructions) return null;
    return `## Additional Instructions\n${config.instructions}\n`;
  }

  /**
   * Summarize tool context when it exceeds the threshold
   * Extracts resources, Neo4j nodes, and key findings
   */
  private async summarizeToolContext(
    toolContext: ToolExecutionResult[],
    llmProvider: LLMProvider
  ): Promise<ToolContextSummary> {
    const originalCharCount = toolContext.reduce(
      (sum, r) => sum + JSON.stringify(r.result ?? r.error ?? '').length,
      0
    );

    console.log(`[StructuredLLMExecutor] 📦 Summarizing tool context: ${toolContext.length} tools, ${originalCharCount} chars`);

    // Format tool results for summarization (compact, no indentation)
    const formattedResults = toolContext.map((r, i) => {
      const status = r.success ? 'OK' : 'FAIL';
      const resultStr = typeof r.result === 'object'
        ? JSON.stringify(r.result)
        : String(r.result ?? r.error ?? '');
      // Truncate very long results for the summary prompt
      const truncated = resultStr.length > 2000
        ? resultStr.substring(0, 2000) + '... [truncated]'
        : resultStr;
      return `[${i + 1}] ${r.tool_name} [${status}]: ${truncated}`;
    }).join('\n\n');

    const result = await this.executeLLMBatch(
      [{ toolResults: formattedResults }],
      {
        inputFields: ['toolResults'],
        outputFormat: 'json', // Use JSON format - LLMs follow this better than XML
        systemPrompt: `You are summarizing tool execution results for an AI agent.
Extract and structure the key information so the agent can continue working efficiently.
Focus on extracting resources with their paths and key excerpts, and nodes with their UUIDs for future reference.`,
        userTask: `Analyze these tool results and create a structured summary:

1. **resources** - Files, URLs, directories that were accessed:
   - path and type (file/url/directory)
   - relevance: why it matters (1 sentence)
   - keyExcerpts: snippets with line numbers if available (keep brief, 1-2 per resource max)

2. **nodes** - Neo4j nodes discovered (look for UUIDs in format [type:UUID] or uuid fields):
   - uuid, name, type (scope/file/webpage/document/etc)
   - subtype if applicable (function, method, class, interface)
   - location (file path or URL) and lines if available
   - relevance: why it matters (1 sentence)

3. **findings** - Narrative summary of what was discovered (3-5 sentences)

4. **suggestions** - SPECIFIC actionable next steps based on the tool results:
   - Look at function/class names CALLED or IMPORTED and suggest searching for them
   - Suggest exploring specific UUIDs with explore_node to see relationships
   - Suggest reading specific files for more context
   - Do NOT give generic suggestions - be SPECIFIC based on what you found

5. **gaps** - What information is still missing or needs investigation (optional)

Be thorough with resources and nodes - these are critical for the agent's memory.
Keep excerpts brief but informative.`,
        outputSchema: {
          resources: {
            type: 'array' as const,
            description: 'Files, URLs, directories accessed',
            items: {
              type: 'object' as const,
              description: 'A resource that was accessed',
              properties: {
                path: { type: 'string' as const, description: 'Path or URL', required: true },
                type: { type: 'string' as const, description: 'Resource type', enum: ['file', 'url', 'directory', 'other'], required: true },
                relevance: { type: 'string' as const, description: 'Why this resource matters', required: true },
                keyExcerpts: {
                  type: 'array' as const,
                  description: 'Key snippets from this resource',
                  items: {
                    type: 'object' as const,
                    description: 'A key excerpt from the resource',
                    properties: {
                      lines: { type: 'string' as const, description: 'Line range e.g. "42-58"' },
                      content: { type: 'string' as const, description: 'The excerpt content', required: true },
                    },
                  },
                },
              },
            },
            required: true,
          },
          nodes: {
            type: 'array' as const,
            description: 'Neo4j nodes discovered with UUIDs',
            items: {
              type: 'object' as const,
              description: 'A Neo4j node mentioned in the results',
              properties: {
                uuid: { type: 'string' as const, description: 'Node UUID', required: true },
                name: { type: 'string' as const, description: 'Node name', required: true },
                type: { type: 'string' as const, description: 'Node type', enum: ['scope', 'file', 'webpage', 'document', 'markdown_section', 'codeblock', 'other'], required: true },
                subtype: { type: 'string' as const, description: 'For scope: function, method, class, interface' },
                location: { type: 'string' as const, description: 'File path or URL' },
                relevance: { type: 'string' as const, description: 'Why this node matters', required: true },
                lines: { type: 'string' as const, description: 'Line range e.g. "10-25"' },
              },
            },
            required: true,
          },
          findings: {
            type: 'string' as const,
            description: 'Narrative summary of discoveries (3-5 sentences)',
            required: true,
          },
          suggestions: {
            type: 'array' as const,
            description: 'Specific actionable suggestions for next steps',
            items: {
              type: 'object' as const,
              description: 'A specific suggestion for follow-up',
              properties: {
                type: { type: 'string' as const, description: 'Type: "search" (brain_search query), "explore" (explore_node UUID), or "read" (read_file path)', required: true },
                target: { type: 'string' as const, description: 'The search query, UUID, or file path depending on type', required: true },
                reason: { type: 'string' as const, description: 'Why this would be useful (be specific)', required: true },
              },
            },
          },
          gaps: {
            type: 'array' as const,
            description: 'What information is still missing',
            items: { type: 'string' as const, description: 'A gap or missing piece of information' },
          },
        },
        llmProvider,
        caller: 'StructuredLLMExecutor.summarizeToolContext',
        batchSize: 1,
        requestId: `tool-context-summary-${Date.now()}`,
      }
    );

    const rawResult: any = Array.isArray(result) ? result[0] : result;

    const summary: ToolContextSummary = {
      isSummarized: true,
      resources: Array.isArray(rawResult.resources) ? rawResult.resources : [],
      nodes: Array.isArray(rawResult.nodes) ? rawResult.nodes : [],
      findings: String(rawResult.findings || 'No findings extracted'),
      suggestions: Array.isArray(rawResult.suggestions) ? rawResult.suggestions : undefined,
      gaps: Array.isArray(rawResult.gaps) ? rawResult.gaps : undefined,
      originalToolCount: toolContext.length,
      originalCharCount,
    };

    console.log(
      `[StructuredLLMExecutor] ✅ Tool context summarized: ${summary.resources.length} resources, ${summary.nodes.length} nodes`
    );

    return summary;
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
        // Generate XML structure recursively for complex types
        const xmlLines = this.generateXMLSchemaExample(fieldName, fieldSchema, 1);
        instructions.push(...xmlLines);
        if (fieldSchema.prompt) {
          instructions.push(`  <!-- ${fieldSchema.prompt} -->`);
        }
        // Add required marker as comment if needed
        if (required) {
          instructions.push(`  <!-- ${fieldName} is REQUIRED -->`);
        }
      }

      // Add tool_calls if tools are available
      if (hasTools) {
        instructions.push('  <tool_calls>');
        instructions.push('    <!-- ALWAYS include tool_calls when calling tools -->');
        instructions.push('    <tool_call>');
        instructions.push('      <tool_name>name_of_tool</tool_name>');
        instructions.push('      <arguments>');
        instructions.push('        <param>value</param>');
        instructions.push('      </arguments>');
        instructions.push('    </tool_call>');
        instructions.push('  </tool_calls>');
      }

      instructions.push('</response>');
      instructions.push('');
      instructions.push('**CRITICAL FORMAT RULES:**');
      instructions.push('1. ALWAYS wrap your response in <response>...</response>');
      instructions.push('2. ALWAYS include ALL required fields (marked REQUIRED above)');
      instructions.push('3. Put <tool_calls> INSIDE <response>, NOT at root level');
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
        throw new LLMParseError(
          'Malformed LLM response: No XML root element found. Expected <response>...</response>',
          xmlText
        );
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

      // Check for required fields in schema
      const requiredFields = Object.entries(schema)
        .filter(([_, fieldSchema]) => (fieldSchema as any).required)
        .map(([name]) => name);

      // Special case: if root IS tool_calls, parse it directly BUT check for missing required fields
      if (root.name === 'tool_calls') {
        // If there are required fields (like reasoning), reject this format
        if (requiredFields.length > 0) {
          throw new LLMParseError(
            `Invalid response format: <tool_calls> at root level but missing required fields: ${requiredFields.join(', ')}. ` +
            `Wrap your response in <response> and include <${requiredFields[0]}> before <tool_calls>.`,
            xmlText
          );
        }
        const toolCallsSchema = extendedSchema.tool_calls as OutputFieldSchema;
        if (toolCallsSchema?.type === 'array' && toolCallsSchema.items) {
          output.tool_calls = this.parseArrayFromElement(root, toolCallsSchema.items);
        }
      } else {
        // Extract fields from root element's children
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
      }

      // Check for missing required fields (even if we have tool_calls)
      const missingRequired = requiredFields.filter(f => !output[f] || output[f] === '');
      if (missingRequired.length > 0) {
        throw new LLMParseError(
          `Missing required field(s): ${missingRequired.join(', ')}. ` +
          `Your response MUST include <${missingRequired[0]}> with content.`,
          xmlText
        );
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
      // Re-throw as LLMParseError if not already
      if (error instanceof LLMParseError) {
        throw error;
      }
      throw new LLMParseError(error.message || 'Failed to parse XML response', xmlText);
    }

    return output as TOutput;
  }

  /**
   * Analyze a parse error and return a human-readable explanation
   * This helps the LLM understand what went wrong so it can fix its response
   */
  private analyzeParseError<TOutput>(
    response: string,
    schema: OutputSchema<TOutput>,
    format: 'xml' | 'json' | 'yaml',
    error: any
  ): string {
    const issues: string[] = [];

    if (format === 'xml') {
      // Check for common XML issues
      const trimmed = response.trim();

      // Check if response is empty or too short
      if (trimmed.length < 10) {
        issues.push('Response is empty or too short');
      }

      // Check for wrong root element
      const rootMatch = trimmed.match(/^<(\w+)/);
      if (rootMatch) {
        const rootName = rootMatch[1];
        if (rootName !== 'response') {
          issues.push(`Wrong root element: <${rootName}> instead of <response>`);
        }
      } else if (!trimmed.startsWith('<')) {
        issues.push('Response does not start with XML - expected <response>');
      }

      // Check for missing required fields
      const requiredFields = Object.entries(schema)
        .filter(([_, fieldSchema]) => (fieldSchema as any).required)
        .map(([name]) => name);

      for (const field of requiredFields) {
        if (!response.includes(`<${field}>`)) {
          issues.push(`Missing required field: <${field}>`);
        }
      }

      // Check for unclosed tags (basic check)
      const openTags = response.match(/<(\w+)(?:\s[^>]*)?>/g) || [];
      const closeTags = response.match(/<\/(\w+)>/g) || [];
      if (openTags.length > closeTags.length + 5) {
        issues.push('Possible unclosed XML tags detected');
      }

      // Check if tool_calls is at root level without response wrapper
      if (trimmed.startsWith('<tool_calls>') && !trimmed.includes('<response>')) {
        issues.push('<tool_calls> should be wrapped inside <response>, not at root level');
      }
    }

    // Add the original error message
    if (error?.message && !issues.some(i => i.includes(error.message))) {
      issues.push(`Parser error: ${error.message}`);
    }

    if (issues.length === 0) {
      issues.push('Unknown parse error - please ensure your response follows the required XML format');
    }

    return `⚠️ YOUR PREVIOUS RESPONSE COULD NOT BE PARSED:\n${issues.map(i => `  - ${i}`).join('\n')}\n\nPlease fix these issues and respond again with valid XML format.`;
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
      uuidMap?: Map<string, string>; // Optional mapping from hash to original UUID
    }
  ): Promise<{ evaluations: ItemEvaluation[]; queryFeedback?: QueryFeedback }> {
    // Add reranking-specific prompts
    // Detect if query explicitly asks for integration/usage (vs implementation)
    const queryLower = config.userQuestion.toLowerCase();
    const asksForIntegration = /\b(integrat|usage|use|how to use|config|configuration|setup|example|tutorial)\b/.test(queryLower);
    const asksForImplementation = /\b(implement|code|source|class|function|method|definition|how it works|how does it work)\b/.test(queryLower);
    
    const implementationPreference = asksForIntegration 
      ? '' 
      : asksForImplementation 
        ? ' IMPORTANT: Prefer implementation details (actual code, classes, functions, source code) over integration/usage documentation, unless the query explicitly asks for integration/usage.'
        : ' IMPORTANT: Prefer implementation details (actual code, classes, functions, source code) over integration/usage documentation, unless the query explicitly asks for integration/usage.';
    
    const rerankConfig: LLMStructuredCallConfig<T, ItemEvaluation> = {
      ...config,
      caller: config.caller || 'StructuredLLMExecutor.executeReranking',
      systemPrompt: config.systemPrompt || `You are ranking ${config.entityContext?.displayName || 'items'} for relevance.${implementationPreference}`,
      userTask: `User question: "${config.userQuestion}"`,
      tokenBudget: config.tokenBudget || 6250, // ~25k chars ≈ 6250 tokens per batch (smaller batches for parallel processing)
      outputSchema: {
        uuid: {
          type: 'string',
          description: 'Item hash from the input (use the exact hash shown in [uuid]: "..." format in the item header, e.g., "a3f2b9c1", "d4e5f6a7", etc.). Copy ONLY the hash string inside the quotes (8 characters). Do NOT use numeric indices like "0" or "1" - use the exact hash shown.',
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

    // Log raw LLM response for debugging (using console.log for visibility in daemon logs)
    console.log('[executeReranking] Raw LLM response:', JSON.stringify({
      isArrayResult,
      itemResultsCount: itemResults.length,
      itemsCount: items.length,
      sampleItemResults: itemResults.slice(0, 3).map((r: any, i: number) => ({
        index: i,
        uuid: r.uuid,
        score: r.score,
        reasoning: r.reasoning?.substring(0, 100),
        relevant: r.relevant,
      })),
      sampleItemIds: items.slice(0, 3).map((item: any, index: number) => {
        const itemId = config.getItemId ? config.getItemId(item, index) : String(index);
        return { index, itemId, entityUuid: (item as any)?.uuid };
      }),
    }, null, 2));

    // Extract evaluations
    // IMPORTANT: If uuidMap is provided, map hash back to original UUID
    const evaluations: ItemEvaluation[] = itemResults.map((itemResult, index) => {
      // Get the UUID/hash returned by LLM
      const itemUuidOrHash = (itemResult as any).uuid;
      
      if (!itemUuidOrHash) {
        throw new Error(`LLM did not return uuid for item ${index}. Expected uuid attribute in XML <item> tag.`);
      }
      
      // Map hash to original UUID if uuidMap is provided
      let finalUuid = itemUuidOrHash;
      if (config.uuidMap) {
        const mappedUuid = config.uuidMap.get(itemUuidOrHash);
        if (mappedUuid) {
          finalUuid = mappedUuid;
        } else {
          // Hash not found in mapping - log warning but continue
          console.warn(`[executeReranking] Hash "${itemUuidOrHash}" not found in UUID mapping, using as-is`);
        }
      }
      
      // Log UUID mapping for debugging (first 3 items)
      if (index < 3) {
        const item = items[index] as any;
        const expectedUuid = config.getItemId ? config.getItemId(items[index], index) : null;
        console.log(`[executeReranking] Item ${index}: LLM returned uuid="${itemUuidOrHash}", mapped to="${finalUuid}", expected uuid="${expectedUuid}", entity.uuid=${item?.uuid}`);
      }
      
      return {
        uuid: finalUuid, // Use mapped UUID
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
    // Default token budget: 100k characters ≈ 25k tokens (Gemini Flash 2.0 supports 1M tokens context)
    // For reranking with large code contexts, we can use much more
    const tokenBudget = config.tokenBudget || 25000;
    const batchSize = config.batchSize || 20;
    const estimatedResponseTokens = this.estimateResponseSize(config.outputSchema);
    const baseOverhead = 1000; // System prompt, instructions, XML structure overhead

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
    config: LLMStructuredCallConfig<T, any>,
    baseRequestId: string
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
        batchGroup.map((batch, batchIndex) => {
          const batchRequestId = `${baseRequestId}-batch${i * parallel + batchIndex + 1}`;
          return this.executeSingleLLMBatch(batch, config, batchRequestId);
        })
      );

      results.push(...groupResults);
    }

    return results;
  }

  private async executeSingleLLMBatch<T>(
    batch: Batch<T>,
    config: LLMStructuredCallConfig<T, any>,
    requestId: string
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
      // Generate request ID for batch call (use config.requestId if available, otherwise generate)
      const requestId = (config as any).requestId || `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      response = await config.llmProvider.generateContent(prompt, requestId);

      // Global LLM call logging (if enabled)
      await this.logLLMCall(config.caller, prompt, response, requestId, {
        method: 'executeLLMBatch',
        itemCount: batch.items.length,
      });
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
   *
   * @param label - Label for the log entry (e.g., "PROMPT [req-123] [iter 1, round 2]")
   * @param content - The content to log
   * @param logTo - Where to log:
   *   - true: log to console
   *   - string ending with '/': directory mode - create individual files per call
   *   - string (file path): append to that file
   */
  private async logContent(label: string, content: string, logTo: boolean | string): Promise<void> {
    const timestamp = new Date().toISOString();
    const separator = '='.repeat(80);

    if (logTo === true) {
      // Log to console
      const logMessage = `\n${separator}\n${label} @ ${timestamp}\n${separator}\n${content}\n${separator}\n`;
      console.log(logMessage);
    } else if (typeof logTo === 'string') {
      const fs = await import('fs');
      const path = await import('path');

      if (logTo.endsWith('/')) {
        // Directory mode: create individual files per call
        // Parse label to create filename: "PROMPT [req-123] [iter 1, round 2]" -> "prompt-iter1-round2.txt"
        const isPrompt = label.toLowerCase().includes('prompt');
        const isResponse = label.toLowerCase().includes('response');
        const prefix = isPrompt ? 'prompt' : isResponse ? 'response' : 'log';

        // Extract iter and round from label
        const iterMatch = label.match(/iter\s*(\d+)/i);
        const roundMatch = label.match(/round\s*(\d+)/i);
        const iter = iterMatch ? iterMatch[1] : '0';
        const round = roundMatch ? roundMatch[1] : '1';

        const filename = `${prefix}-iter${iter}-round${round}.txt`;
        const filePath = path.join(logTo, filename);

        // Ensure directory exists
        if (!fs.existsSync(logTo)) {
          fs.mkdirSync(logTo, { recursive: true });
        }

        // Write individual file (overwrite if exists)
        const fileContent = `${label}\nTimestamp: ${timestamp}\n\n${content}`;
        fs.writeFileSync(filePath, fileContent);
      } else {
        // File mode: append to single file
        const logMessage = `\n${separator}\n${label} @ ${timestamp}\n${separator}\n${content}\n${separator}\n`;

        // Ensure directory exists
        const dir = path.dirname(logTo);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Append to file
        fs.appendFileSync(logTo, logMessage);
      }
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
      '<items>'
    ];

    // Check if schema has uuid field - if so, use it as attribute
    const hasUuidField = 'uuid' in schema;
    const uuidField = hasUuidField ? schema.uuid : null;
    
    if (hasUuidField && uuidField) {
      // uuid is an attribute, not an element
      instructions.push(`  <item uuid="UUID_VALUE">`);
    } else {
      instructions.push('  <item>');
    }

    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      // Skip uuid field if it's an attribute (already shown in opening tag)
      if (fieldName === 'uuid' && hasUuidField) {
        continue;
      }
      
      const required = fieldSchema.required ? ' (REQUIRED)' : '';
      instructions.push(`    <${fieldName}>${fieldSchema.description}${required}</${fieldName}>`);

      if (fieldSchema.prompt) {
        instructions.push(`    <!-- ${fieldSchema.prompt} -->`);
      }
    }

    instructions.push('  </item>');
    instructions.push('</items>');
    
    if (hasUuidField && uuidField) {
      instructions.push('');
      instructions.push(`IMPORTANT: Replace "UUID_VALUE" with the actual UUID from the input item (shown after "uuid: " in the item header).`);
    }

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

  /**
   * Generate XML schema example for a field (recursive for arrays/objects)
   */
  private generateXMLSchemaExample(
    fieldName: string,
    fieldSchema: OutputFieldSchema,
    indentLevel: number
  ): string[] {
    const indent = '  '.repeat(indentLevel);
    const lines: string[] = [];

    if (fieldSchema.type === 'array') {
      // Array: show wrapper with item examples
      lines.push(`${indent}<${fieldName}>`);

      if (fieldSchema.items) {
        // Singularize the field name for item tag
        const itemName = this.singularize(fieldName);

        if (fieldSchema.items.type === 'object' && fieldSchema.items.properties) {
          // Array of objects - show nested structure
          lines.push(`${indent}  <${itemName}>`);
          for (const [propName, propSchema] of Object.entries(fieldSchema.items.properties)) {
            const propLines = this.generateXMLSchemaExample(propName, propSchema, indentLevel + 2);
            lines.push(...propLines);
          }
          lines.push(`${indent}  </${itemName}>`);
          lines.push(`${indent}  <!-- more ${itemName} elements as needed -->`);
        } else {
          // Array of primitives
          const itemDesc = fieldSchema.items.description || 'value';
          lines.push(`${indent}  <${itemName}>${itemDesc}</${itemName}>`);
          lines.push(`${indent}  <!-- more ${itemName} elements as needed -->`);
        }
      } else {
        lines.push(`${indent}  <!-- items -->`);
      }

      lines.push(`${indent}</${fieldName}>`);
    } else if (fieldSchema.type === 'object' && fieldSchema.properties) {
      // Object with properties - show nested structure
      lines.push(`${indent}<${fieldName}>`);
      for (const [propName, propSchema] of Object.entries(fieldSchema.properties)) {
        const propLines = this.generateXMLSchemaExample(propName, propSchema, indentLevel + 1);
        lines.push(...propLines);
      }
      lines.push(`${indent}</${fieldName}>`);
    } else {
      // Simple type (string, number, boolean, or unstructured object)
      const desc = fieldSchema.description || fieldSchema.type;
      lines.push(`${indent}<${fieldName}>${desc}</${fieldName}>`);
    }

    return lines;
  }

  /**
   * Singularize a plural field name for array item tags
   */
  private singularize(name: string): string {
    // Simple heuristics for common patterns
    if (name.endsWith('ies')) {
      return name.slice(0, -3) + 'y'; // e.g., "entries" -> "entry"
    } else if (name.endsWith('es') && !name.endsWith('ses')) {
      return name.slice(0, -2); // e.g., "matches" -> "match"
    } else if (name.endsWith('s') && !name.endsWith('ss')) {
      return name.slice(0, -1); // e.g., "snippets" -> "snippet"
    }
    return name + '_item'; // Fallback: add _item suffix
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

        // Get item UUID from attributes
        const itemUuid = item.attributes?.get?.('uuid') || item.attributes?.uuid;
        
        if (!itemUuid) {
          console.warn('Item missing uuid attribute, skipping');
          continue;
        }

        // Get or create output for this UUID
        if (!itemsById.has(itemUuid)) {
          itemsById.set(itemUuid, {});
        }
        const output = itemsById.get(itemUuid);

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

      // Convert map to array, sorted by UUID (alphabetically)
      const sortedUuids = Array.from(itemsById.keys()).sort((a, b) => a.localeCompare(b));

      for (const uuid of sortedUuids) {
        results.push(itemsById.get(uuid) as TOutput);
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
   * Extract text content from XML element.
   * Handles both regular text nodes and CDATA sections.
   */
  private getTextContentFromElement(element: any): string {
    if (!element) return '';

    // If element has direct text children, concatenate them
    // Include both 'text' and 'cdata' node types (LuciformXMLParser creates separate nodes for CDATA)
    if (element.children) {
      return element.children
        .filter((c: any) => c.type === 'text' || c.type === 'cdata')
        .map((c: any) => c.content || '')
        .join('')
        .trim();
    }

    return '';
  }

  /**
   * Parse a dynamic object from XML element (no schema required).
   * Extracts ALL child elements as properties.
   * Used for tool arguments which have varying schemas per tool.
   *
   * Example input:
   * <arguments>
   *   <content>Some text content</content>
   *   <path>/some/path</path>
   *   <recursive>true</recursive>
   * </arguments>
   *
   * Returns: { content: "Some text content", path: "/some/path", recursive: true }
   */
  private parseDynamicObjectFromElement(element: any): Record<string, any> {
    const obj: Record<string, any> = {};

    if (!element || !element.children) {
      return obj;
    }

    // Extract all child elements as properties
    for (const child of element.children) {
      if (child.type !== 'element' || !child.name) continue;

      const propName = child.name;
      const textContent = this.getTextContentFromElement(child);

      // Check if it has nested elements (nested object or array)
      const nestedElements = child.children?.filter((c: any) => c.type === 'element') || [];

      if (nestedElements.length > 0 && !textContent) {
        // Has nested elements and no direct text content
        // Check if all nested elements have the same name (array) or different names (object)
        const names = new Set(nestedElements.map((e: any) => e.name));
        if (names.size === 1 && nestedElements.length > 1) {
          // Array of items with the same tag name
          obj[propName] = nestedElements.map((e: any) => {
            // Check if the array items themselves have nested elements
            const itemNestedElements = e.children?.filter((c: any) => c.type === 'element') || [];
            if (itemNestedElements.length > 0) {
              return this.parseDynamicObjectFromElement(e);
            }
            return this.inferPrimitiveType(this.getTextContentFromElement(e));
          });
        } else {
          // Nested object with different property names
          obj[propName] = this.parseDynamicObjectFromElement(child);
        }
      } else {
        // Primitive value (text content, possibly from CDATA)
        obj[propName] = this.inferPrimitiveType(textContent);
      }
    }

    return obj;
  }

  /**
   * Infer the type of a value from its string representation.
   * Returns the appropriately typed value (boolean, number, or string).
   */
  private inferPrimitiveType(value: string): boolean | number | string {
    if (value === '') return '';

    // Boolean
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true') return true;
    if (lowerValue === 'false') return false;

    // Number (integer or float)
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

    // Default: string
    return value;
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
          } else if (propSchema.type === 'object') {
            // Object type without predefined properties - parse dynamically
            // This is used for tool arguments which have varying schemas per tool
            value = this.parseDynamicObjectFromElement(childEl);
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
          } catch (parseError: any) {
            // Try to recover: sanitize ONLY actual newlines inside JSON strings
            // LLMs often output actual newlines instead of \n in JSON
            // But we must NOT double-escape already-escaped sequences like \n
            try {
              // Only replace actual newline/tab/return characters (not already escaped)
              // Use a regex that matches actual control characters, not escape sequences
              const sanitized = value
                .replace(/\r\n/g, '\\n')  // Windows newlines first
                .replace(/\r/g, '\\n')    // Mac classic newlines
                .replace(/\n/g, '\\n')    // Unix newlines
                .replace(/\t/g, '\\t');   // Tabs
              return JSON.parse(sanitized);
            } catch {
              // Sanitization didn't help - try removing literal backslash-n sequences
              // that might have been double-escaped by the LLM
              try {
                // Sometimes LLMs output \\n instead of \n, so try un-escaping
                const unescaped = value
                  .replace(/\\\\n/g, '\n')
                  .replace(/\\\\r/g, '\r')
                  .replace(/\\\\t/g, '\t');
                return JSON.parse(unescaped);
              } catch {
                // Still didn't help
              }
            }

            // Try to recover: if the string looks like JSON wrapped in extra quotes
            if (value.startsWith('"{') && value.endsWith('}"')) {
              try {
                const unescaped = JSON.parse(value);
                if (typeof unescaped === 'string') {
                  return JSON.parse(unescaped);
                }
              } catch {
                // Ignore recovery failure
              }
            }

            // Log the parsing error for debugging (only if all recovery failed)
            console.warn(`[convertValue] Failed to parse JSON for object type:`);
            console.warn(`  Value (first 200 chars): ${value.substring(0, 200)}`);
            console.warn(`  Error: ${(parseError as Error).message}`);

            // Return wrapped value as fallback
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
        caller: 'StructuredLLMExecutor.requestGlobalToolCalls',
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

When you need to use tools, include them in the \`<tool_calls>\` section. Each tool call must have:
- \`<tool_name>\`: The exact name of the tool
- \`<arguments>\`: XML elements for each parameter (use CDATA for long text with special characters)

### Single Tool Call Example:
\`\`\`xml
<tool_calls>
  <tool_call>
    <tool_name>${exampleTool1}</tool_name>
    <arguments>
      <param1>value1</param1>
    </arguments>
  </tool_call>
</tool_calls>
\`\`\`

### Multiple Parallel Tool Calls Example:
When tools don't depend on each other's results, call them all at once:
\`\`\`xml
<tool_calls>
  <tool_call>
    <tool_name>${exampleTool1}</tool_name>
    <arguments>
      <param1>value1</param1>
    </arguments>
  </tool_call>
  <tool_call>
    <tool_name>${exampleTool2}</tool_name>
    <arguments>
      <param2>value2</param2>
    </arguments>
  </tool_call>
</tool_calls>
\`\`\`

### Using CDATA for Long Text:
For content with special characters (\`<\`, \`>\`, \`&\`) or multi-line text, wrap in CDATA:
\`\`\`xml
<arguments>
  <content><![CDATA[
## My Report

This content has **markdown**, \`code\`, and special chars: < > &
  ]]></content>
</arguments>
\`\`\`

## Important Guidelines

1. **ALWAYS include tool_calls when action is needed** - Do NOT just explain what you will do. If the task requires action, CALL THE TOOLS immediately. You can explain your reasoning in the "answer" field while ALSO including tool_calls.
2. **Call multiple tools in parallel** when they don't depend on each other's results
3. **Provide all required parameters** - missing required parameters will cause errors
4. **Use exact tool names** - tool names are case-sensitive
5. **Return empty tool_calls ONLY** when you have completed the task and no more action is needed
6. **Sequential calls**: If tool B needs the result of tool A, call A first, wait for results, then call B

WRONG (just explaining without action):
<response>
  <reasoning>I will create the file...</reasoning>
  <tool_calls></tool_calls>
</response>

CORRECT (action + explanation):
<response>
  <reasoning>Creating the file now.</reasoning>
  <tool_calls>
    <tool_call>
      <tool_name>write_file</tool_name>
      <arguments>
        <path>/path/to/file</path>
        <content>file content</content>
      </arguments>
    </tool_call>
  </tool_calls>
</response>`;
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
