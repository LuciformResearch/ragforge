/**
 * RagAgent - Generic Agent from Config
 *
 * Creates a ready-to-use agent from any RagForge config.
 * Uses StructuredLLMExecutor and BaseToolExecutor patterns.
 *
 * @example
 * ```typescript
 * import { createRagAgent } from '@luciformresearch/ragforge';
 * import { createRagClient } from './client.js';
 *
 * const rag = createRagClient();
 * const agent = await createRagAgent({
 *   configPath: './ragforge.config.yaml',
 *   ragClient: rag,
 *   apiKey: process.env.GEMINI_API_KEY,
 * });
 *
 * const { answer } = await agent.ask('What functions handle authentication?');
 * console.log(answer);
 * ```
 */

import { generateToolsFromConfig, generateFileTools, generateImageTools, generate3DTools, generateProjectTools, IngestionLock, withIngestionLock } from '../../index.js';
import type { ToolGenerationOptions, GeneratedToolDefinition, ToolHandlerGenerator, RagForgeConfig, FileToolsContext, ImageToolsContext, ThreeDToolsContext, ProjectToolsContext } from '../../index.js';
import { formatLocalDate, getFilenameTimestamp } from '../utils/timestamp.js';
import { StructuredLLMExecutor, BaseToolExecutor, type ToolCallRequest, type ToolExecutionResult } from '../llm/structured-llm-executor.js';
import { GeminiAPIProvider } from '../reranking/gemini-api-provider.js';
import { GeminiNativeToolProvider, type ToolDefinition } from '../llm/native-tool-calling/index.js';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Agent Logger
// ============================================

export interface AgentLogEntry {
  timestamp: string;
  type: 'start' | 'iteration' | 'tool_call' | 'tool_result' | 'llm_response' | 'final_answer';
  iteration?: number;
  data: any;
}

export interface AgentSessionLog {
  sessionId: string;
  question: string;
  startTime: string;
  endTime?: string;
  mode: 'native' | 'structured';
  tools: string[];
  entries: AgentLogEntry[];
  finalAnswer?: string;
  toolsUsed: string[];
  totalIterations: number;
}

class AgentLogger {
  private logPath?: string;
  private currentSession?: AgentSessionLog;

  constructor(logPath?: string) {
    this.logPath = logPath;
  }

  startSession(question: string, mode: 'native' | 'structured', tools: string[]): void {
    this.currentSession = {
      sessionId: `session_${Date.now()}`,
      question,
      startTime: formatLocalDate(),
      mode,
      tools,
      entries: [],
      toolsUsed: [],
      totalIterations: 0,
    };

    this.log({
      timestamp: formatLocalDate(),
      type: 'start',
      data: { question, mode, tools },
    });
  }

  logIteration(iteration: number, llmResponse: any): void {
    if (!this.currentSession) return;
    this.currentSession.totalIterations = iteration;

    this.log({
      timestamp: formatLocalDate(),
      type: 'iteration',
      iteration,
      data: { llmResponse },
    });
  }

  logToolCall(toolName: string, args: any, reasoning?: string): void {
    if (!this.currentSession) return;
    if (!this.currentSession.toolsUsed.includes(toolName)) {
      this.currentSession.toolsUsed.push(toolName);
    }

    this.log({
      timestamp: formatLocalDate(),
      type: 'tool_call',
      data: { toolName, arguments: args, reasoning },
    });
  }

  logToolResult(toolName: string, result: any, durationMs: number): void {
    this.log({
      timestamp: formatLocalDate(),
      type: 'tool_result',
      data: { toolName, result, durationMs },
    });
  }

  logFinalAnswer(answer: string, confidence?: string): void {
    if (!this.currentSession) return;
    this.currentSession.finalAnswer = answer;
    this.currentSession.endTime = formatLocalDate();

    this.log({
      timestamp: formatLocalDate(),
      type: 'final_answer',
      data: { answer, confidence },
    });

    // Write to file
    this.writeSessionToFile();
  }

  logToolError(toolName: string, error: string, durationMs?: number): void {
    if (!this.currentSession) return;

    this.log({
      timestamp: formatLocalDate(),
      type: 'tool_result',
      data: { toolName, error, durationMs, success: false },
    });

    // Write immediately on errors so we don't lose data
    this.writeSessionToFile();
  }

  logError(error: string, context?: Record<string, any>): void {
    if (!this.currentSession) return;
    this.currentSession.endTime = formatLocalDate();

    this.log({
      timestamp: formatLocalDate(),
      type: 'final_answer',
      data: { error, context, success: false },
    });

    // Always write on error
    this.writeSessionToFile();
  }

  private log(entry: AgentLogEntry): void {
    if (!this.currentSession) return;
    this.currentSession.entries.push(entry);
    // Write incrementally so logs are available even if agent crashes/is interrupted
    this.writeSessionToFile();
  }

  private writeSessionToFile(): void {
    if (!this.logPath || !this.currentSession) return;

    try {
      // Ensure directory exists
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Overwrite log file with current session only
      fs.writeFileSync(this.logPath, JSON.stringify(this.currentSession, null, 2));
    } catch (error) {
      console.error('Failed to write agent log:', error);
    }
  }

  getSession(): AgentSessionLog | undefined {
    return this.currentSession;
  }

  /** Force write the current session (call on error/abort) */
  flush(): void {
    this.writeSessionToFile();
  }
}

// ============================================
// Types
// ============================================

export interface RagAgentOptions {
  /** Path to ragforge.config.yaml */
  configPath?: string;

  /** Or provide config object directly */
  config?: RagForgeConfig;

  /** RagClient instance (required for tool execution) */
  ragClient: any;

  /** API key for the LLM provider */
  apiKey?: string;

  /** Model to use (default: gemini-2.0-flash) */
  model?: string;

  /** Temperature for LLM (default: 0.1) */
  temperature?: number;

  /** Max iterations for tool loop (default: 10) */
  maxIterations?: number;

  /** Tool generation options */
  toolOptions?: ToolGenerationOptions;

  /**
   * Use native tool calling (Gemini native API) vs XML-based
   * - 'native': Use Gemini's native function calling (faster, global mode)
   * - 'structured': Use XML-based StructuredLLMExecutor (per-item mode, more control)
   * - 'auto': Use native for batch, structured for single questions
   * Default: 'auto'
   */
  toolCallMode?: 'native' | 'structured' | 'auto';

  /**
   * Include batch_analyze meta-tool
   * Allows the agent to call executeLLMBatch on items for structured analysis
   * Default: true
   */
  includeBatchAnalyze?: boolean;

  /**
   * Custom output schema for structured responses
   * If provided, the agent will return structured data matching this schema
   */
  outputSchema?: Record<string, any>;

  /** Verbose logging to console */
  verbose?: boolean;

  /**
   * Path to write detailed JSON logs
   * Each session is logged with full tool calls, results, and LLM responses
   * Useful for debugging agent behavior
   */
  logPath?: string;

  /**
   * Include file tools (read_file, write_file, edit_file)
   * Enables the agent to read, create, and modify files
   * Default: false
   */
  includeFileTools?: boolean;

  /**
   * Project root for file tools (required if includeFileTools is true)
   * File paths will be resolved relative to this directory
   * Can be a string or a getter function for dynamic resolution
   */
  projectRoot?: string | (() => string | null);

  /**
   * ChangeTracker instance for tracking file modifications
   * Optional: if provided, file changes will be tracked in Neo4j
   */
  changeTracker?: any;

  /**
   * Callback when a file is modified
   * Use this to trigger re-ingestion of the file into the code graph
   */
  onFileModified?: (filePath: string, changeType: 'created' | 'updated' | 'deleted') => Promise<void>;

  /**
   * Include media tools (image and 3D)
   * - Image: read_image (OCR), describe_image, list_images
   * - 3D: render_3d_asset, generate_3d_from_image, generate_3d_from_text
   * Requires GEMINI_API_KEY and optionally REPLICATE_API_TOKEN
   * Default: false
   */
  includeMediaTools?: boolean;

  /**
   * Replicate API token for 3D generation tools
   * Required if includeMediaTools is true and you want to use:
   * - generate_3d_from_image (Trellis)
   * - generate_3d_from_text (MVDream)
   */
  replicateApiToken?: string;

  /**
   * Include project management tools (create_project, setup_project, ingest_code, generate_embeddings)
   * Enables the agent to create and manage RagForge projects
   * Default: false
   */
  includeProjectTools?: boolean;

  /**
   * Context for project tools (callbacks for CLI operations)
   * Required if includeProjectTools is true
   */
  projectToolsContext?: Omit<ProjectToolsContext, 'workingDirectory' | 'verbose'>;
}

export interface AskResult {
  answer: string;
  confidence?: string;
  /** Custom fields from outputSchema */
  [key: string]: any;
  iterations?: number;
  toolsUsed?: string[];
}

// ============================================
// Generic Tool Executor
// ============================================

/**
 * Tool Executor that uses generated handlers
 * Extends BaseToolExecutor for automatic parallel execution
 */
// File tools that modify content (need to run before RAG queries)
const FILE_MODIFICATION_TOOLS = new Set(['write_file', 'edit_file']);

const PROJECT_MANAGEMENT_TOOLS = new Set(['create_project', 'setup_project', 'load_project']);

class GeneratedToolExecutor extends BaseToolExecutor {
  private handlers: Record<string, (args: Record<string, any>) => Promise<any>>;
  private verbose: boolean;
  private logger?: AgentLogger;
  public toolsUsed: string[] = [];
  private executionOrder: Set<string>[];

  constructor(
    handlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    verbose: boolean = false,
    logger?: AgentLogger,
    executionOrder: Set<string>[] = []
  ) {
    super();
    this.handlers = handlers;
    this.verbose = verbose;
    this.logger = logger;
    this.executionOrder = executionOrder;
  }

  async execute(toolCall: ToolCallRequest): Promise<any> {
    if (this.verbose) {
      console.log(`   🔧 Executing: ${toolCall.tool_name}(${JSON.stringify(toolCall.arguments)})`);
    }

    this.toolsUsed.push(toolCall.tool_name);
    this.logger?.logToolCall(toolCall.tool_name, toolCall.arguments);

    const handler = this.handlers[toolCall.tool_name];
    if (!handler) {
      const error = `Unknown tool: ${toolCall.tool_name}. Available: ${Object.keys(this.handlers).join(', ')}`;
      this.logger?.logToolError(toolCall.tool_name, error);
      throw new Error(error);
    }

    const startTime = Date.now();
    try {
      const result = await handler(toolCall.arguments);
      const durationMs = Date.now() - startTime;

      if (this.verbose) {
        console.log(`   📤 Result (${durationMs}ms):`, JSON.stringify(result).substring(0, 200));
      }

      this.logger?.logToolResult(toolCall.tool_name, result, durationMs);

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error.message || String(error);

      if (this.verbose) {
        console.log(`   ❌ Tool ${toolCall.tool_name} failed: ${errorMsg}`);
      }

      this.logger?.logToolError(toolCall.tool_name, errorMsg, durationMs);

      // Re-throw to let the executor handle it
      throw error;
    }
  }

  /**
   * Override executeBatch to ensure file modification tools run BEFORE other tools.
   * This prevents race conditions where RAG queries return stale data because
   * they execute in parallel with file modifications.
   *
   * Order of execution:
   * 1. File modification tools (write_file, edit_file) - sequential
   * 2. Other tools (RAG queries, read_file, etc.) - parallel
   */
  async executeBatch(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    const resultMap = new Map<ToolCallRequest, ToolExecutionResult>();
    let remainingToolCalls = [...toolCalls];

    // Execute tools in stages based on the configured execution order
    for (const stage of this.executionOrder) {
      const stageTools: ToolCallRequest[] = [];
      const nextStageTools: ToolCallRequest[] = [];

      for (const toolCall of remainingToolCalls) {
        if (stage.has(toolCall.tool_name)) {
          stageTools.push(toolCall);
        } else {
          nextStageTools.push(toolCall);
        }
      }

      if (stageTools.length > 0) {
        if (this.verbose) {
          console.log(`   ⏱️  Executing stage with ${stageTools.length} tool(s): ${stageTools.map(t => t.tool_name).join(', ')}`);
        }
        // Execute tools in a stage sequentially to ensure dependencies are met
        for (const toolCall of stageTools) {
          try {
            const result = await this.execute(toolCall);
            resultMap.set(toolCall, {
              tool_name: toolCall.tool_name,
              success: true,
              result,
            });
          } catch (error: any) {
            resultMap.set(toolCall, {
              tool_name: toolCall.tool_name,
              success: false,
              error: error.message,
            });
          }
        }
      }

      remainingToolCalls = nextStageTools;
    }

    // Execute any remaining tools (not in any defined stage) in parallel
    if (remainingToolCalls.length > 0) {
      if (this.verbose) {
        console.log(`   ⏱️  Executing ${remainingToolCalls.length} remaining tool(s) in parallel: ${remainingToolCalls.map(t => t.tool_name).join(', ')}`);
      }
      const results = await super.executeBatch(remainingToolCalls);
      remainingToolCalls.forEach((tc, i) => resultMap.set(tc, results[i]));
    }

    // Return results in the original order
    return toolCalls.map(tc => resultMap.get(tc)!);
  }
}

// ============================================
// RagAgent Class
// ============================================

export class RagAgent {
  private config: RagForgeConfig;
  private tools: GeneratedToolDefinition[];
  private boundHandlers: Record<string, (args: Record<string, any>) => Promise<any>>;
  private executor: StructuredLLMExecutor;
  private llmProvider: GeminiAPIProvider;
  private nativeToolProvider: GeminiNativeToolProvider;
  private maxIterations: number;
  private verbose: boolean;
  private toolCallMode: 'native' | 'structured' | 'auto';
  private outputSchema?: Record<string, any>;
  private logger?: AgentLogger;

  constructor(
    config: RagForgeConfig,
    tools: GeneratedToolDefinition[],
    boundHandlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    llmProvider: GeminiAPIProvider,
    nativeToolProvider: GeminiNativeToolProvider,
    options: RagAgentOptions
  ) {
    this.config = config;
    this.tools = tools;
    this.boundHandlers = boundHandlers;
    this.executor = new StructuredLLMExecutor();
    this.llmProvider = llmProvider;
    this.nativeToolProvider = nativeToolProvider;
    this.maxIterations = options.maxIterations ?? 10;
    this.verbose = options.verbose ?? false;
    this.toolCallMode = options.toolCallMode ?? 'auto';
    this.outputSchema = options.outputSchema;

    // Create logger if logPath provided
    if (options.logPath) {
      this.logger = new AgentLogger(options.logPath);
    }

    // Add batch_analyze handler if enabled
    if (options.includeBatchAnalyze !== false) {
      this.addBatchAnalyzeTool();
    }
  }

  /**
   * Add the batch_analyze meta-tool
   * Allows the agent to run LLM analysis on a list of items
   */
  private addBatchAnalyzeTool(): void {
    // Add tool definition
    this.tools.push({
      name: 'batch_analyze',
      description: `Analyze a list of items using LLM with structured output.
This is a meta-tool that lets you apply LLM reasoning to results from other tools.

Use cases:
- Analyze search results to extract insights
- Categorize or summarize items
- Generate suggestions for each item
- Extract specific information from each item

Example: After getting search results, use this to analyze each result with a custom task.`,
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of items to analyze (typically from a previous tool call)',
            items: { type: 'object' },
          },
          task: {
            type: 'string',
            description: 'What to do with each item. Examples: "summarize the purpose", "extract key concepts", "suggest improvements"',
          },
          output_fields: {
            type: 'object',
            description: 'Fields to extract per item. Example: {"summary": "string", "category": "string", "importance": "number"}',
          },
        },
        required: ['items', 'task', 'output_fields'],
      },
    });

    // Add handler
    this.boundHandlers['batch_analyze'] = async (args: Record<string, any>) => {
      const { items, task, output_fields } = args;

      if (!items || items.length === 0) {
        return { results: [], count: 0 };
      }

      if (this.verbose) {
        console.log(`   🧠 batch_analyze: Analyzing ${items.length} items with task: "${task}"`);
      }

      // Convert output_fields to outputSchema format
      const outputSchema: Record<string, any> = {};
      for (const [field, type] of Object.entries(output_fields)) {
        outputSchema[field] = {
          type: type as string,
          description: `${field} for this item`,
          required: true,
        };
      }

      // Determine input fields from first item
      const inputFields = Object.keys(items[0]);

      // Execute batch LLM analysis
      const results = await this.executor.executeLLMBatch(items, {
        inputFields,
        userTask: task,
        outputSchema,
        llmProvider: this.llmProvider,
        batchSize: 5,
      });

      const resultItems = Array.isArray(results) ? results : (results as any).items;
      return { results: resultItems, count: resultItems.length };
    };
  }

  /**
   * Ask a question
   *
   * Mode depends on toolCallMode option:
   * - 'structured': Uses XML-based StructuredLLMExecutor (per-item mode)
   * - 'native': Uses Gemini native tool calling (global mode)
   * - 'auto': Uses structured for single questions
   */
  async ask(question: string): Promise<AskResult> {
    const mode = this.toolCallMode === 'auto' ? 'structured' : this.toolCallMode;

    // Start logging session
    this.logger?.startSession(question, mode, this.tools.map(t => t.name));

    if (this.verbose) {
      console.log(`\n🤖 Agent starting (mode: ${mode})`);
      console.log(`   Question: "${question}"`);
      console.log(`   Available tools: ${this.tools.map(t => t.name).join(', ')}\n`);
    }

    const toolExecutor = new GeneratedToolExecutor(
      this.boundHandlers,
      this.verbose,
      this.logger,
      [PROJECT_MANAGEMENT_TOOLS, FILE_MODIFICATION_TOOLS]
    );

    // Build output schema (use custom or default)
    const outputSchema = this.outputSchema || {
      answer: {
        type: 'string',
        description: 'Your answer based on the tool results',
        required: true,
      },
      confidence: {
        type: 'string',
        description: 'Confidence level: high, medium, low',
        required: false,
      },
    };

    try {
      if (mode === 'native') {
        // Native tool calling (global mode)
        const results = await this.executor.executeLLMBatchWithTools(
          [{ question }],
          {
            inputFields: ['question'],
            systemPrompt: this.buildSystemPrompt(),
            userTask: 'Answer the question by using the available tools. Start by calling get_schema() to understand what data is available.',
            outputSchema,
            tools: this.getToolDefinitions(),
            toolMode: 'global',
            toolChoice: 'any',
            nativeToolProvider: this.nativeToolProvider,
            toolExecutor,
            llmProvider: this.llmProvider,
          }
        );

        const items = Array.isArray(results) ? results : (results as any).items;
        const result = items[0] as Record<string, any>;

        // Log final answer
        this.logger?.logFinalAnswer(result.answer || 'No answer generated', result.confidence);

        return {
          answer: result.answer || 'No answer generated',
          confidence: result.confidence,
          toolsUsed: [...new Set(toolExecutor.toolsUsed)],
          ...this.extractCustomFields(result),
        };
      } else {
        // Structured mode (per-item, XML-based)
        const results = await this.executor.executeLLMBatchWithTools(
          [{ question }],
          {
            inputFields: ['question'],
            systemPrompt: this.buildSystemPrompt(),
            userTask: 'Answer the question by using the available tools. Start by calling get_schema() to understand what data is available.',
            outputSchema,
            tools: this.getToolDefinitions(),
            toolMode: 'per-item',
            maxIterationsPerItem: this.maxIterations,
            toolExecutor,
            llmProvider: this.llmProvider,
            // Log prompts/responses when verbose
            logPrompts: this.verbose,
            logResponses: this.verbose,
            // Log each LLM response with reasoning
            onLLMResponse: (response) => {
              this.logger?.logIteration(response.iteration, {
                reasoning: response.reasoning,
                toolCalls: response.toolCalls?.map(tc => tc.tool_name),
                hasOutput: !!response.output,
              });
            },
          }
        );

        const items = Array.isArray(results) ? results : (results as any).items;
        const result = items[0] as Record<string, any>;

        // Log final answer
        this.logger?.logFinalAnswer(result.answer || 'No answer generated', result.confidence);

        return {
          answer: result.answer || 'No answer generated',
          confidence: result.confidence,
          toolsUsed: [...new Set(toolExecutor.toolsUsed)],
          ...this.extractCustomFields(result),
        };
      }
    } catch (error: any) {
      // Log the error and ensure the session is written
      const errorMsg = error.message || String(error);
      this.logger?.logError(errorMsg, {
        toolsUsed: [...new Set(toolExecutor.toolsUsed)],
        mode,
      });

      // Re-throw the error
      throw error;
    }
  }

  /**
   * Get the last session log (useful for debugging)
   */
  getLastSessionLog(): AgentSessionLog | undefined {
    return this.logger?.getSession();
  }

  /**
   * Extract custom fields from result (if using custom outputSchema)
   */
  private extractCustomFields(result: Record<string, any>): Record<string, any> {
    if (!this.outputSchema) return {};

    const custom: Record<string, any> = {};
    for (const key of Object.keys(this.outputSchema)) {
      if (key !== 'answer' && key !== 'confidence' && result[key] !== undefined) {
        custom[key] = result[key];
      }
    }
    return custom;
  }

  /**
   * Ask multiple questions in batch (global tool mode)
   */
  async askBatch(questions: string[]): Promise<AskResult[]> {
    if (this.verbose) {
      console.log(`\n🤖 Agent starting batch (${questions.length} questions)`);
      console.log(`   Available tools: ${this.tools.map(t => t.name).join(', ')}\n`);
    }

    const toolExecutor = new GeneratedToolExecutor(
      this.boundHandlers,
      this.verbose,
      this.logger,
      [PROJECT_MANAGEMENT_TOOLS, FILE_MODIFICATION_TOOLS]
    );

    const results = await this.executor.executeLLMBatchWithTools(
      questions.map(q => ({ question: q })),
      {
        inputFields: ['question'],
        systemPrompt: this.buildSystemPrompt(),
        userTask: 'Answer each question by using the available tools.',
        outputSchema: {
          answer: {
            type: 'string',
            description: 'Your answer based on the tool results',
            required: true,
          },
          confidence: {
            type: 'string',
            description: 'Confidence level: high, medium, low',
            required: false,
          },
        },
        tools: this.getToolDefinitions(),
        toolMode: 'global',
        toolChoice: 'any',
        nativeToolProvider: this.nativeToolProvider,
        toolExecutor,
        llmProvider: this.llmProvider,
        batchSize: 10,
      }
    );

    const items = Array.isArray(results) ? results : (results as any).items;
    return items.map((r: { answer?: string; confidence?: string }) => ({
      answer: r.answer || 'No answer generated',
      confidence: r.confidence,
      toolsUsed: [...new Set(toolExecutor.toolsUsed)],
    }));
  }

  /**
   * Build system prompt
   */
  private buildSystemPrompt(): string {
    return `You are a helpful assistant with access to a database.

Available tools will help you query the database. Use them to find information and answer questions.

**IMPORTANT**:
1. Start by calling get_schema() to understand what entities and fields are available
2. Use the schema information to construct proper queries
3. Be precise with field names and entity types`;
  }

  /**
   * Convert tools to ToolDefinition format
   */
  private getToolDefinitions(): ToolDefinition[] {
    return this.tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Get list of available tools
   */
  getTools(): GeneratedToolDefinition[] {
    return this.tools;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a RagAgent from config
 */
export async function createRagAgent(options: RagAgentOptions): Promise<RagAgent> {
  // 1. Load config
  let config: RagForgeConfig;
  if (options.config) {
    config = options.config;
  } else if (options.configPath) {
    const content = fs.readFileSync(options.configPath, 'utf-8');
    config = yaml.load(content) as RagForgeConfig;
  } else {
    throw new Error('Either config or configPath must be provided');
  }

  // 2. Generate tools from config
  const { tools, handlers } = generateToolsFromConfig(config, {
    includeDiscovery: true,
    includeSemanticSearch: true,
    includeRelationships: true,
    ...options.toolOptions,
  });

  // 3. Bind handlers with RagClient
  const boundHandlers: Record<string, (args: Record<string, any>) => Promise<any>> = {};
  for (const [name, handlerGen] of Object.entries(handlers)) {
    boundHandlers[name] = (handlerGen as (rag: any) => (args: Record<string, any>) => Promise<any>)(options.ragClient);
  }

  // 3b. Add file tools if enabled
  let ingestionLock: IngestionLock | undefined;

  if (options.includeFileTools) {
    if (!options.projectRoot) {
      throw new Error('projectRoot is required when includeFileTools is true');
    }

    // Create ingestion lock for coordinating file tools with RAG queries
    ingestionLock = new IngestionLock({
      timeout: 60000, // 60s max for re-ingestion
      onStatusChange: (status) => {
        if (options.verbose) {
          if (status.isLocked) {
            console.log(`   🔒 Ingestion lock: ${status.currentFile}`);
          } else {
            console.log(`   🔓 Ingestion lock released`);
          }
        }
      },
    });

    // File tools accept dynamic projectRoot (string or getter function)
    const fileToolsCtx: FileToolsContext = {
      projectRoot: options.projectRoot!,  // Can be string or () => string | null
      changeTracker: options.changeTracker,
      onFileModified: options.onFileModified,
      ingestionLock,
    };

    const fileTools = generateFileTools(fileToolsCtx);
    tools.push(...fileTools.tools);
    Object.assign(boundHandlers, fileTools.handlers);

    // Wrap RAG tool handlers with ingestion lock check
    const ragToolNames = Object.keys(handlers);
    for (const toolName of ragToolNames) {
      const originalHandler = boundHandlers[toolName];
      if (originalHandler) {
        boundHandlers[toolName] = withIngestionLock(originalHandler, ingestionLock, {
          waitForUnlock: true,  // Wait up to 5s for ingestion to complete
          waitTimeout: 5000,
        });
      }
    }

    if (options.verbose) {
      console.log(`   📁 File tools enabled (projectRoot: ${options.projectRoot})`);
    }
  }

  // 3c. Add media tools if enabled
  if (options.includeMediaTools) {
    if (!options.projectRoot) {
      throw new Error('projectRoot is required when includeMediaTools is true');
    }

    // Resolve projectRoot to string for media tools (they don't support dynamic resolution)
    const resolvedProjectRoot = typeof options.projectRoot === 'function'
      ? options.projectRoot() || process.cwd()
      : options.projectRoot || process.cwd();

    // Image tools context (uses GEMINI_API_KEY and REPLICATE_API_TOKEN from env)
    const imageCtx: ImageToolsContext = {
      projectRoot: resolvedProjectRoot,
    };

    const imageTools = generateImageTools(imageCtx);
    tools.push(...imageTools.tools);
    Object.assign(boundHandlers, imageTools.handlers);

    // 3D tools context (uses REPLICATE_API_TOKEN from env)
    const threeDCtx: ThreeDToolsContext = {
      projectRoot: resolvedProjectRoot,
    };

    const threeDTools = generate3DTools(threeDCtx);
    tools.push(...threeDTools.tools);
    Object.assign(boundHandlers, threeDTools.handlers);

    if (options.verbose) {
      console.log(`   🎨 Media tools enabled (image: ${imageTools.tools.length}, 3D: ${threeDTools.tools.length})`);
    }
  }

  // 3d. Add project tools if enabled
  if (options.includeProjectTools) {
    // Resolve projectRoot to string for project tools context
    const workingDir = typeof options.projectRoot === 'function'
      ? options.projectRoot() || process.cwd()
      : options.projectRoot || process.cwd();

    const projectCtx: ProjectToolsContext = {
      workingDirectory: workingDir,
      verbose: options.verbose,
      ...options.projectToolsContext,
    };

    const projectTools = generateProjectTools(projectCtx);
    tools.push(...projectTools.tools);
    Object.assign(boundHandlers, projectTools.handlers);

    if (options.verbose) {
      console.log(`   🚀 Project tools enabled (${projectTools.tools.length} tools)`);
    }
  }

  // 4. Create LLM providers
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('API key required (provide apiKey option or set GEMINI_API_KEY env var)');
  }

  const model = options.model ?? 'gemini-2.0-flash';

  const llmProvider = new GeminiAPIProvider({
    apiKey,
    model,
    temperature: options.temperature ?? 0.1,
  });

  const nativeToolProvider = new GeminiNativeToolProvider({
    apiKey,
    model,
    temperature: options.temperature ?? 0.1,
  });

  // 5. Create agent
  return new RagAgent(
    config,
    tools,
    boundHandlers,
    llmProvider,
    nativeToolProvider,
    options
  );
}
