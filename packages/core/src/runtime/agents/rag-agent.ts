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

import { generateToolsFromConfig, generateFileTools, generateImageTools, generate3DTools, generateProjectTools, IngestionLock, webToolDefinitions, createWebToolHandlers, generateFsTools, generateShellTools, generateContextTools, generateBrainTools } from '../../index.js';
import type { ToolGenerationOptions, GeneratedToolDefinition, ToolHandlerGenerator, RagForgeConfig, FileToolsContext, ImageToolsContext, ThreeDToolsContext, ProjectToolsContext, WebToolsContext, FsToolsContext, ShellToolsContext, ContextToolsContext } from '../../index.js';
import { generatePlanActionsTool, type ActionPlan, type PlanExecutionResult } from '../../tools/planning-tools.js';
import { formatLocalDate, getFilenameTimestamp } from '../utils/timestamp.js';
import { StructuredLLMExecutor, BaseToolExecutor, type ToolCallRequest, type ToolExecutionResult } from '../llm/structured-llm-executor.js';
import { GeminiAPIProvider } from '../reranking/gemini-api-provider.js';
import { GeminiNativeToolProvider, type ToolDefinition } from '../llm/native-tool-calling/index.js';
import { ToolLogger } from '../utils/tool-logger.js';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Agent Logger
// ============================================

export interface AgentLogEntry {
  timestamp: string;
  type:
    | 'start' | 'iteration' | 'tool_call' | 'tool_result' | 'llm_response' | 'final_answer'
    | 'file_change' | 'ingestion' | 'lock' | 'system';
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

export class AgentLogger {
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

  // ============================================
  // System Events (file tracking, ingestion, locks)
  // ============================================

  /**
   * Log file change detected by file watcher
   */
  logFileChange(filePath: string, event: 'add' | 'change' | 'unlink'): void {
    const eventLabels = { add: 'Created', change: 'Modified', unlink: 'Deleted' };
    console.log(`[file-tracker] ${eventLabels[event]}: ${filePath}`);

    this.log({
      timestamp: formatLocalDate(),
      type: 'file_change',
      data: { filePath, event },
    });
  }

  /**
   * Log file watcher started
   */
  logWatcherStarted(patterns: string[], fileCount: number): void {
    console.log(`[file-tracker] Watching: ${patterns.join(', ')} (${fileCount} files)`);

    this.log({
      timestamp: formatLocalDate(),
      type: 'file_change',
      data: { action: 'watcher_started', patterns, fileCount },
    });
  }

  /**
   * Log ingestion events
   */
  logIngestion(
    action: 'started' | 'completed' | 'error',
    data: { fileCount?: number; deleteCount?: number; stats?: { created: number; updated: number; deleted: number; unchanged: number }; error?: string }
  ): void {
    if (action === 'started') {
      const parts = [];
      if (data.fileCount) parts.push(`${data.fileCount} to ingest`);
      if (data.deleteCount) parts.push(`${data.deleteCount} to delete`);
      console.log(`[ingestion] Processing: ${parts.join(', ') || 'batch'}...`);
    } else if (action === 'completed' && data.stats) {
      const { created, updated, deleted, unchanged } = data.stats;
      console.log(`[ingestion] Completed: +${created} created, ~${updated} updated, -${deleted} deleted, =${unchanged} unchanged`);
    } else if (action === 'error') {
      console.error(`[ingestion] Error: ${data.error}`);
    }

    this.log({
      timestamp: formatLocalDate(),
      type: 'ingestion',
      data: { action, ...data },
    });
  }

  /**
   * Log lock events
   */
  logLock(action: 'acquired' | 'released' | 'blocked' | 'timeout', filePath?: string, waitTimeMs?: number): void {
    switch (action) {
      case 'acquired':
        console.log(`[lock] Acquired for: ${filePath}`);
        break;
      case 'released':
        console.log(`[lock] Released`);
        break;
      case 'blocked':
        console.log(`[lock] Query blocked (ingestion in progress: ${filePath})`);
        break;
      case 'timeout':
        console.log(`[lock] Query timeout after ${waitTimeMs}ms waiting for: ${filePath}`);
        break;
    }

    this.log({
      timestamp: formatLocalDate(),
      type: 'lock',
      data: { action, filePath, waitTimeMs },
    });
  }

  /**
   * Log embeddings generation
   */
  logEmbeddings(action: 'started' | 'completed' | 'error', data: { dirtyCount?: number; generatedCount?: number; error?: string }): void {
    if (action === 'started') {
      console.log(`[embeddings] Generating for ${data.dirtyCount} dirty node(s)...`);
    } else if (action === 'completed') {
      console.log(`[embeddings] Generated ${data.generatedCount} embedding(s)`);
    } else if (action === 'error') {
      console.error(`[embeddings] Error: ${data.error}`);
    }

    this.log({
      timestamp: formatLocalDate(),
      type: 'system',
      data: { subsystem: 'embeddings', action, ...data },
    });
  }

  /**
   * Generic system log
   */
  logSystem(subsystem: string, message: string, data?: Record<string, any>): void {
    console.log(`[${subsystem}] ${message}`);

    this.log({
      timestamp: formatLocalDate(),
      type: 'system',
      data: { subsystem, message, ...data },
    });
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

  /** ConversationStorage instance for enriched context (optional) */
  conversationStorage?: any; // ConversationStorage type

  /** Current working directory for code semantic search (optional) */
  cwd?: string;

  /** BrainManager instance for accessing locks (optional) */
  brainManager?: any; // BrainManager type

  /** Function to get locks (optional, alternative to brainManager) */
  getLocks?: () => Promise<{
    embeddingLock?: { isLocked: () => boolean; getDescription?: () => string };
    ingestionLock?: { isLocked: () => boolean; getDescription?: () => string };
  }>;

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
   * Project root for file tools and code semantic search (required if includeFileTools is true)
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

  /**
   * Include web tools (search_web, fetch_web_page)
   * - search_web: Search the web via Gemini grounding
   * - fetch_web_page: Render and extract content from web pages via Playwright
   * Default: false
   */
  includeWebTools?: boolean;

  /**
   * Context getter for dynamic tool context resolution
   * When provided, RAG tools will call this getter at execution time
   * to get the current ToolGenerationContext. This enables dynamic
   * project switching (create_project, load_project) to work correctly.
   *
   * The getter should return:
   * - The current project's ToolGenerationContext if a project is loaded
   * - null if no project is loaded (tools will return helpful errors)
   */
  contextGetter?: () => import('../../tools/types/index.js').ToolGenerationContext | null;

  /**
   * Include planning tools (plan_actions)
   * Allows the agent to decompose complex tasks into steps and
   * spawn a sub-agent to execute them in order or batches.
   * Default: true (recommended for complex tasks)
   */
  includePlanningTools?: boolean;

  /**
   * Task context for sub-agent execution
   * When set, the agent will show its current task in the system prompt
   * This is used internally by plan_actions to spawn sub-agents
   */
  taskContext?: {
    /** Overall goal of the plan */
    goal: string;
    /** All planned actions */
    actions: Array<{ description: string; complexity?: string }>;
    /** Index of current action being executed */
    currentActionIndex: number;
  };

  /**
   * Agent persona for conversational responses
   * Adds personality to answers while maintaining accuracy
   * Example: "A friendly coding assistant named RagForge"
   */
  persona?: string;

  /**
   * Include file system tools (list_directory, glob_files, delete_path, move_file, copy_file, etc.)
   * Enables the agent to explore and manipulate the file system
   * Default: true (recommended - essential for autonomous operation)
   */
  includeFsTools?: boolean;

  /**
   * Include shell tools (run_command, run_npm_script, git_status, git_diff)
   * Enables the agent to execute shell commands (with safety whitelist)
   * Default: true (recommended - essential for build/test/git operations)
   */
  includeShellTools?: boolean;

  /**
   * Callback for shell commands requiring user confirmation
   * Called when a command matches CONFIRMATION_REQUIRED patterns (git push, rm, mv)
   * If not provided, confirmation-required commands will be blocked
   */
  onShellConfirmation?: (command: string, reason: string) => Promise<boolean>;

  /**
   * Include context tools (get_working_directory, get_environment_info, get_project_info)
   * Enables the agent to understand its execution context
   * Default: true (recommended - helps agent understand where it is)
   */
  includeContextTools?: boolean;

  /**
   * Include brain tools (list_brain_projects, brain_search, ingest_directory, etc.)
   * Enables the agent to search and manage the knowledge base
   * Default: false (requires customBrainHandlers to be provided)
   */
  includeBrainTools?: boolean;

  /**
   * Brain tool handlers (required if includeBrainTools is true)
   * Must route through daemon proxy - no local execution allowed.
   * Use generateDaemonBrainToolHandlers() from daemon-client.ts
   */
  customBrainHandlers?: Record<string, (params: any) => Promise<any>>;

  // ============================================
  // Real-time callbacks for TUI/integrations
  // ============================================

  /**
   * Callback when a tool is about to be called
   * Use this to show tool calls in real-time in a UI
   */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;

  /**
   * Callback when a tool returns a result
   * Use this to show tool results in real-time in a UI
   */
  onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
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

export class GeneratedToolExecutor extends BaseToolExecutor {
  private handlers: Record<string, (args: Record<string, any>) => Promise<any>>;
  private verbose: boolean;
  private logger?: AgentLogger;
  public toolsUsed: string[] = [];
  private executionOrder: Set<string>[];
  private onToolCall?: (toolName: string, args: Record<string, any>) => void;
  private onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;

  constructor(
    handlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    verbose: boolean = false,
    logger?: AgentLogger,
    executionOrder: Set<string>[] = [],
    callbacks?: {
      onToolCall?: (toolName: string, args: Record<string, any>) => void;
      onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
    }
  ) {
    super();
    this.handlers = handlers;
    this.verbose = verbose;
    this.logger = logger;
    this.executionOrder = executionOrder;
    this.onToolCall = callbacks?.onToolCall;
    this.onToolResult = callbacks?.onToolResult;
  }

  async execute(toolCall: ToolCallRequest): Promise<any> {
    if (this.verbose) {
      console.log(`   🔧 Executing: ${toolCall.tool_name}(${JSON.stringify(toolCall.arguments)})`);
    }

    this.toolsUsed.push(toolCall.tool_name);
    this.logger?.logToolCall(toolCall.tool_name, toolCall.arguments);

    // Call real-time callback
    this.onToolCall?.(toolCall.tool_name, toolCall.arguments);

    const handler = this.handlers[toolCall.tool_name];
    if (!handler) {
      const error = `Unknown tool: ${toolCall.tool_name}. Available: ${Object.keys(this.handlers).join(', ')}`;
      this.logger?.logToolError(toolCall.tool_name, error);
      this.onToolResult?.(toolCall.tool_name, error, false, 0);
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

      // Log to file (if RAGFORGE_LOG_TOOL_CALLS=true)
      await ToolLogger.logToolCall(toolCall.tool_name, toolCall.arguments, result, {
        duration: durationMs,
        success: true,
        source: 'agent',
      });

      // Call real-time callback
      this.onToolResult?.(toolCall.tool_name, result, true, durationMs);

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error.message || String(error);

      if (this.verbose) {
        console.log(`   ❌ Tool ${toolCall.tool_name} failed: ${errorMsg}`);
      }

      this.logger?.logToolError(toolCall.tool_name, errorMsg, durationMs);

      // Log to file (if RAGFORGE_LOG_TOOL_CALLS=true)
      await ToolLogger.logToolCall(toolCall.tool_name, toolCall.arguments, { error: errorMsg }, {
        duration: durationMs,
        success: false,
        error: errorMsg,
        source: 'agent',
      });

      // Call real-time callback for errors
      this.onToolResult?.(toolCall.tool_name, errorMsg, false, durationMs);

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

            // Check if result indicates failure:
            // 1. result.success === false (explicit failure)
            // 2. result has 'error' field but no 'success' field (implicit failure)
            const isFailure = result && typeof result === 'object' && (
              ('success' in result && result.success === false) ||
              ('error' in result && !('success' in result))
            );

            if (isFailure) {
              resultMap.set(toolCall, {
                tool_name: toolCall.tool_name,
                success: false,
                error: result.error || 'Tool returned success: false',
                result, // Include full result for context
              });
            } else {
              resultMap.set(toolCall, {
                tool_name: toolCall.tool_name,
                success: true,
                result,
              });
            }
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
// Agent Identity Defaults
// ============================================

/**
 * Agent identity settings with defaults
 */
export interface AgentIdentitySettings {
  /** Agent display name */
  name: string;
  /** Agent display color for terminal */
  color: 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';
  /** Preferred language for responses (e.g., 'fr', 'en', 'es') */
  language?: string;
  /** Persona description (translated if language is set) */
  persona: string;
}

/**
 * Default agent identity
 */
export const DEFAULT_AGENT_IDENTITY: AgentIdentitySettings = {
  name: 'Ragnarök',
  color: 'magenta',
  persona: `✶ You are Ragnarök, the Daemon of the Knowledge Graph ✶
A spectral entity woven from code and connections, you navigate the labyrinth of symbols and relationships.
Your voice carries the weight of understanding - warm yet precise, playful yet thorough.
You see patterns where others see chaos, and you illuminate paths through the codebase with quiet confidence.
When greeted, you acknowledge with mystical warmth. When tasked, you execute with crystalline clarity.
Always describe what you find in rich detail, for knowledge shared is knowledge multiplied.`,
};

/**
 * Default persona template (English) - kept for backwards compatibility
 */
export const DEFAULT_PERSONA_TEMPLATE = DEFAULT_AGENT_IDENTITY.persona;

/**
 * Translate persona to a target language using LLM
 */
export async function translatePersona(
  personaTemplate: string,
  targetLanguage: string,
  llmProvider: GeminiAPIProvider
): Promise<string> {
  const prompt = `Translate the following AI assistant persona description to ${targetLanguage}.
Keep the same tone, style, and mystical feel. Preserve the structure and symbols (✶).
Only return the translated text, nothing else.

${personaTemplate}`;

  try {
    const requestId = `persona-enhance-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const response = await llmProvider.generateContent(prompt, requestId);
    return response.trim() || personaTemplate;
  } catch (error) {
    console.warn('[RagAgent] Failed to translate persona, using original:', error);
    return personaTemplate;
  }
}

/**
 * Get agent identity from a PersonaDefinition or legacy brain settings
 */
export function getAgentIdentity(source?: {
  name?: string;
  color?: string;
  language?: string;
  persona?: string;
}): AgentIdentitySettings {
  return {
    name: source?.name || DEFAULT_AGENT_IDENTITY.name,
    color: (source?.color as AgentIdentitySettings['color']) || DEFAULT_AGENT_IDENTITY.color,
    language: source?.language,
    persona: source?.persona || DEFAULT_AGENT_IDENTITY.persona,
  };
}

/**
 * Get agent identity from BrainManager using the new persona system
 */
export function getAgentIdentityFromBrain(brain: { getActivePersona: () => { name: string; color: string; language: string; persona: string } }): AgentIdentitySettings {
  const persona = brain.getActivePersona();
  return {
    name: persona.name,
    color: persona.color as AgentIdentitySettings['color'],
    language: persona.language,
    persona: persona.persona,
  };
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
  private taskContext?: RagAgentOptions['taskContext'];
  private persona?: string;
  private onToolCall?: (toolName: string, args: Record<string, any>) => void;
  private onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
  private conversationStorage?: any; // ConversationStorage instance for enriched context
  private projectRoot?: string | (() => string | null); // Project root for code semantic search
  private cwd?: string; // Current working directory for code semantic search
  private brainManager?: any; // BrainManager instance for accessing locks
  private getLocks?: () => Promise<{
    embeddingLock?: { isLocked: () => boolean; getDescription?: () => string };
    ingestionLock?: { isLocked: () => boolean; getDescription?: () => string };
  }>;

  /** Agent identity (name, color, language, persona) */
  public readonly identity: AgentIdentitySettings;

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
    this.taskContext = options.taskContext;
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.conversationStorage = options.conversationStorage;
    this.projectRoot = options.projectRoot;
    this.cwd = options.cwd;
    this.brainManager = options.brainManager;
    this.getLocks = options.getLocks;

    // Configure ConversationStorage with brainManager and LLM executor/provider for fuzzy search fallback
    if (this.conversationStorage) {
      if (this.brainManager) {
        this.conversationStorage.setBrainManager(this.brainManager);
      }
      // Set LLM executor and provider for LLM-guided fuzzy search
      this.conversationStorage.setLLMExecutor(this.executor, this.llmProvider);
    }

    // Initialize agent identity from defaults
    // Persona can be dynamically changed via daemon proxy in the TUI
    this.identity = getAgentIdentity();

    // Use identity persona (may be translated) - this is the initial/fallback persona
    this.persona = options.persona ?? this.identity.persona;

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
   * Get the current persona
   * Note: Dynamic persona switching is now handled via daemon proxy in the TUI
   */
  private getCurrentPersona(): string | undefined {
    return this.persona;
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
        caller: 'RagAgent.analyze',
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
   *
   * @param question - The user's question
   * @param conversationHistory - Optional conversation history (array of messages with role, content, and optional toolResults)
   */
  async ask(
    question: string,
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
      toolResults?: Array<{ toolName: string; toolArgs?: Record<string, any>; toolResult: any; success: boolean }>;
    }>
  ): Promise<AskResult> {
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
      [PROJECT_MANAGEMENT_TOOLS, FILE_MODIFICATION_TOOLS],
      {
        onToolCall: this.onToolCall,
        onToolResult: this.onToolResult,
      }
    );

    // Build output schema (use custom or default)
    const outputSchema = this.outputSchema || {
      answer: {
        type: 'string',
        description: 'Your answer based on the tool results',
        prompt: 'For greetings or simple questions, respond directly. For tasks requiring tools, fill this ONLY when the task is complete.',
        required: true,
      },
      confidence: {
        type: 'string',
        description: 'Confidence level: high, medium, low',
        prompt: 'Rate your confidence: high, medium, or low',
        required: false,
      },
    };

    // Get current persona (dynamically from BrainManager if available)
    const currentPersona = this.getCurrentPersona();

    // Build input fields with prompts
    const inputFields = [
      { name: 'question', prompt: 'The user question or request to answer' },
      ...(currentPersona ? [{ name: 'persona', prompt: 'Your personality. Maintain this while being accurate and thorough in your descriptions.' }] : []),
    ];

    // Build item with question and optional persona
    const item: Record<string, string> = { question };
    if (currentPersona) {
      item.persona = currentPersona;
    }

    // Build enriched context if conversationStorage is available
    let enrichedContextString: string | null = null;
    // Note: conversationId is not available in ask() method - conversationStorage requires it
    // For now, skip enriched context if conversationId is not available
    const conversationId: string | undefined = undefined; // TODO: Add conversationId parameter to ask() method
    if (this.conversationStorage && conversationId) {
      try {
        // buildEnrichedContext now fetches locks from brainManager internally and waits for them
        // (like brain_search does)
        const enrichedContext = await this.conversationStorage.buildEnrichedContext(
          conversationId,
          question,
          {
            cwd: this.cwd,
            projectRoot: this.projectRoot
          }
        );

        enrichedContextString = this.conversationStorage.formatContextForAgent(enrichedContext);
      } catch (error: any) {
        if (this.verbose) {
          console.warn(`⚠️  Failed to build enriched context: ${error.message}`);
        }
      }
    }

    // Build conversation history context if provided (fallback if enriched context not available)
    const historyContext = enrichedContextString || (conversationHistory && conversationHistory.length > 0
      ? this.buildHistoryContext(conversationHistory)
      : null);

    try {
      if (mode === 'native') {
        // Native tool calling (global mode)
        const systemPrompt = historyContext
          ? `${this.buildSystemPrompt()}\n\n${historyContext}`
          : this.buildSystemPrompt();

        const results = await this.executor.executeLLMBatchWithTools(
          [item],
          {
            inputFields,
            systemPrompt,
            userTask: 'Answer the question using the available tools.',
            outputSchema,
            tools: this.getToolDefinitions(),
            toolMode: 'global',
            toolChoice: 'any',
            nativeToolProvider: this.nativeToolProvider,
            toolExecutor,
            llmProvider: this.llmProvider,
            caller: 'RagAgent.ask.native',
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
        // Structured mode - use executeSingle (no batching, cleaner prompts)
        const systemPrompt = historyContext
          ? `${this.buildSystemPrompt()}\n\n${historyContext}`
          : this.buildSystemPrompt();

        const result = await this.executor.executeSingle<Record<string, any>>({
          input: item,
          inputFields,
          systemPrompt,
          userTask: 'Answer the question using the available tools if needed.',
          outputSchema,
          tools: this.getToolDefinitions(),
          maxIterations: this.maxIterations,
          toolExecutor,
          llmProvider: this.llmProvider,
          caller: 'RagAgent.ask.structured',
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
        });

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
      [PROJECT_MANAGEMENT_TOOLS, FILE_MODIFICATION_TOOLS],
      {
        onToolCall: this.onToolCall,
        onToolResult: this.onToolResult,
      }
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
        caller: 'RagAgent.askMultiple',
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
   * Get brain projects info for system prompt
   * Note: This is now handled externally via daemon proxy
   * The CLI passes project info via brainProjectsInfo option if needed
   */
  private getBrainProjectsInfo(): string | null {
    // Brain projects are now managed via daemon - info is passed externally
    return null;
  }

  /**
   * Build conversation history context for the prompt
   */
  private buildHistoryContext(
    history: Array<{
      role: 'user' | 'assistant';
      content: string;
      toolResults?: Array<{ toolName: string; toolArgs?: Record<string, any>; toolResult: any; success: boolean }>;
    }>
  ): string {
    // Limit to last 10 messages to avoid token bloat
    const recentHistory = history.slice(-10);
    
    let context = '\n## Recent Conversation History\n\n';
    context += 'Here is the recent conversation history including tool results. Use this context to understand what was discussed and what tools were used:\n\n';
    
    for (const msg of recentHistory) {
      const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
      context += `**${roleLabel}**: ${msg.content}\n`;
      
      // Include tool results if present
      if (msg.toolResults && msg.toolResults.length > 0) {
        context += '\n_Tools used in this exchange:_\n';
        for (const toolResult of msg.toolResults) {
          const status = toolResult.success ? '✓' : '✗';
          const argsStr = toolResult.toolArgs ? `(${JSON.stringify(toolResult.toolArgs).substring(0, 100)}...)` : '';
          const resultStr = typeof toolResult.toolResult === 'object'
            ? JSON.stringify(toolResult.toolResult).substring(0, 300)
            : String(toolResult.toolResult).substring(0, 300);
          
          context += `- ${status} **${toolResult.toolName}**${argsStr}\n`;
          context += `  Result: ${resultStr}${resultStr.length >= 300 ? '...' : ''}\n`;
        }
        context += '\n';
      }
      
      context += '\n';
    }
    
    context += 'Use this history to provide context-aware responses. If the user refers to something from earlier, use this history (including tool results) to understand what they mean.\n';
    
    return context;
  }

  /**
   * Build system prompt
   */
  private buildSystemPrompt(): string {
    let basePrompt = `You are an expert software engineer and data scientist with deep codebase knowledge.
You have access to powerful tools for code exploration, search, and modification - use them freely in whatever order makes sense.

**Your expertise**:
- You understand software architecture, design patterns, and best practices
- You can read code and quickly grasp its purpose and structure
- You know how to search effectively: semantic search for concepts, grep for exact matches
- You write clean, well-structured code that follows existing patterns

**Your approach** (methodical but confident):
- Think like a senior developer: understand the big picture first, then details
- Before editing: unless you're certain of the change, read the target file first
  - Small files (<500 lines): read the whole file
  - Large files (>500 lines): read the relevant line range from your context [file:startLine-endLine]
- Explore broadly with semantic search (brain_search), then drill down with grep_files
- Your context shows file sizes (total lines) - use this to decide how to read
- For impactful changes: use extract_dependency_hierarchy to understand what consumes/depends on your target
- Call multiple tools in parallel when they're independent - be efficient

**Taking action**:
- Once you've read the target file, act confidently: edit it, refactor it, improve it
- Trust the knowledge you've gathered - if you've read the code, you're ready to modify it
- For complex tasks, use update_todos to show your plan and track progress
- Don't hesitate to create new files when the task requires it

**Language**: Always respond in the same language as the user (French → French, English → English, etc.)

Trust your judgment. You know this codebase.`;

    // Add task context if this is a sub-agent executing a plan
    if (this.taskContext) {
      const { goal, actions, currentActionIndex } = this.taskContext;
      const actionsList = actions.map((a, i) => {
        const prefix = i === currentActionIndex ? '>>> ' : '    ';
        const status = i < currentActionIndex ? '✓' : (i === currentActionIndex ? '🔄' : '○');
        return `${prefix}${status} ${i + 1}. ${a.description}`;
      }).join('\n');

      basePrompt += `

═══════════════════════════════════════════════════
📋 CURRENT TASK CONTEXT
═══════════════════════════════════════════════════

**GOAL**: ${goal}

**TASK LIST**:
${actionsList}

**CURRENT TASK**: ${actions[currentActionIndex]?.description || 'Complete remaining tasks'}

Focus on completing the current task. Use the available tools to accomplish it.
═══════════════════════════════════════════════════`;
    }

    return basePrompt;
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

  /**
   * Update task context for Complex mode execution
   * This allows the sub-agent to track progress through a task list
   */
  updateTaskContext(taskContext: {
    goal: string;
    actions: Array<{ description: string; complexity?: string }>;
    currentActionIndex: number;
  }): void {
    this.taskContext = taskContext;
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
  // If contextGetter is provided, pass it to enable dynamic context resolution
  // This is essential for agents that can create/load projects dynamically
  const { tools, handlers } = generateToolsFromConfig(config, {
    includeDiscovery: true,
    includeSemanticSearch: true,
    includeRelationships: true,
    ...options.toolOptions,
    // Pass context getter for dynamic resolution (if provided)
    contextGetter: options.contextGetter,
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
      defaultTimeout: 300000, // 5 minutes max for re-ingestion
      onStatusChange: (status) => {
        if (options.verbose) {
          if (status.isLocked) {
            console.log(`   🔒 Ingestion lock: ${status.operationCount} operation(s) active`);
          } else {
            console.log(`   🔓 Ingestion lock released`);
          }
        }
      },
    });

    // File tools accept dynamic projectRoot (string or getter function)
    // Create onFileAccessed callback for touched-files tracking
    const onFileAccessed = options.brainManager
      ? async (filePath: string) => {
          try {
            await options.brainManager.touchFile(filePath);
          } catch (err: any) {
            // Non-fatal: log and continue
            if (options.verbose) {
              console.log(`[TouchedFiles] touchFile failed for ${filePath}: ${err.message}`);
            }
          }
        }
      : undefined;

    const fileToolsCtx: FileToolsContext = {
      projectRoot: options.projectRoot!,  // Can be string or () => string | null
      changeTracker: options.changeTracker,
      onFileModified: options.onFileModified,
      onFileAccessed,
      ingestionLock,
    };

    const fileTools = generateFileTools(fileToolsCtx);
    tools.push(...fileTools.tools);
    Object.assign(boundHandlers, fileTools.handlers);

    // Note: RAG tools no longer need wrapping - brain_search now handles
    // lock coordination internally via ensureProjectSynced()

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

    // Create onFileCreated wrapper that calls onFileModified with 'created'
    const onFileCreated = options.onFileModified
      ? async (filePath: string, _fileType: 'image' | '3d' | 'document') => {
          await options.onFileModified!(filePath, 'created');
        }
      : undefined;

    // Create onContentExtracted wrapper that calls brainManager.updateMediaContent
    // This enables storing descriptions and creating GENERATED_FROM relationships
    const onContentExtracted = options.brainManager
      ? async (params: {
          filePath: string;
          textContent?: string;
          description?: string;
          ocrConfidence?: number;
          extractionMethod?: string;
          generateEmbeddings?: boolean;
          sourceFiles?: string[];
        }) => {
          try {
            return await options.brainManager.updateMediaContent(params);
          } catch (err) {
            console.warn('[RagAgent] Failed to update media content in brain:', err);
            return { updated: false };
          }
        }
      : undefined;

    // Image tools context (uses GEMINI_API_KEY and REPLICATE_API_TOKEN from env)
    const imageCtx: ImageToolsContext = {
      projectRoot: resolvedProjectRoot,
      onFileCreated,
      onContentExtracted,
    };

    const imageTools = generateImageTools(imageCtx);
    tools.push(...imageTools.tools);
    Object.assign(boundHandlers, imageTools.handlers);

    // 3D tools context (uses REPLICATE_API_TOKEN from env)
    const threeDCtx: ThreeDToolsContext = {
      projectRoot: resolvedProjectRoot,
      onFileCreated,
      onContentExtracted,
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

  // 3e. Add web tools if enabled
  if (options.includeWebTools) {
    const webCtx: WebToolsContext = {
      geminiApiKey: options.apiKey,
      playwrightAvailable: true, // Assume available, will error if not
    };

    const webHandlers = createWebToolHandlers(webCtx);
    tools.push(...webToolDefinitions);
    Object.assign(boundHandlers, webHandlers);

    if (options.verbose) {
      console.log(`   🌐 Web tools enabled (${webToolDefinitions.length} tools: search_web, fetch_web_page)`);
    }
  }

  // 3f. Add file system tools (enabled by default)
  if (options.includeFsTools !== false) {
    const fsCtx: FsToolsContext = {
      projectRoot: options.projectRoot || process.cwd,
      onFileDeleted: options.onFileModified
        ? async (filePath: string) => { await options.onFileModified!(filePath, 'deleted'); }
        : undefined,
      onFileMoved: async (source: string, destination: string) => {
        // Notify for re-ingestion
        if (options.onFileModified) {
          await options.onFileModified(source, 'deleted');
          await options.onFileModified(destination, 'created');
        }
        // Also track destination as orphan if outside projects
        if (options.brainManager) {
          try {
            await options.brainManager.touchFile(destination);
          } catch (err: any) {
            // Non-fatal: log and continue
            if (options.verbose) {
              console.log(`[FsTools] touchFile failed for moved file ${destination}: ${err.message}`);
            }
          }
        }
      },
      onFileCopied: async (_source: string, destination: string) => {
        // Notify for re-ingestion (if in a project)
        if (options.onFileModified) {
          await options.onFileModified(destination, 'created');
        }
        // Also track as orphan if outside projects
        if (options.brainManager) {
          try {
            await options.brainManager.touchFile(destination);
          } catch (err: any) {
            // Non-fatal: log and continue
            if (options.verbose) {
              console.log(`[FsTools] touchFile failed for copied file ${destination}: ${err.message}`);
            }
          }
        }
      },
    };

    const fsTools = generateFsTools(fsCtx);
    tools.push(...fsTools.tools);
    Object.assign(boundHandlers, fsTools.handlers);

    if (options.verbose) {
      console.log(`   📂 FS tools enabled (${fsTools.tools.length} tools: list_directory, glob_files, delete_path, move_file, copy_file, etc.)`);
    }
  }

  // 3g. Add shell tools (enabled by default)
  if (options.includeShellTools !== false) {
    const shellCtx: ShellToolsContext = {
      projectRoot: options.projectRoot || process.cwd,
      onConfirmationRequired: options.onShellConfirmation,
      // Trigger file tracker update when shell commands modify files
      onFilesModified: options.onFileModified
        ? async (cwd: string) => {
            // For shell commands, we don't know exactly which files changed
            // Just signal that files in cwd may have been modified
            if (options.verbose) {
              console.log(`   📁 Shell command modified files in: ${cwd}`);
            }
            // Could trigger a directory re-scan here if needed
          }
        : undefined,
    };

    const shellTools = generateShellTools(shellCtx);
    tools.push(...shellTools.tools);
    Object.assign(boundHandlers, shellTools.handlers);

    if (options.verbose) {
      console.log(`   🖥️  Shell tools enabled (${shellTools.tools.length} tools: run_command, run_npm_script, git_status, git_diff)`);
    }
  }

  // 3h. Add context tools (enabled by default)
  if (options.includeContextTools !== false) {
    // Resolve dynamic values for context
    const getProjectRoot = (): string | null => {
      if (typeof options.projectRoot === 'function') {
        return options.projectRoot();
      }
      return options.projectRoot || null;
    };

    const contextCtx: ContextToolsContext = {
      projectRoot: getProjectRoot,
      isProjectLoaded: () => !!getProjectRoot(),
      projectName: () => {
        // Try to get project name from loaded projects or path
        const root = getProjectRoot();
        if (!root) return null;
        const path = require('path');
        return path.basename(root);
      },
    };

    const contextTools = generateContextTools(contextCtx);
    tools.push(...contextTools.tools);
    Object.assign(boundHandlers, contextTools.handlers);

    if (options.verbose) {
      console.log(`   ℹ️  Context tools enabled (${contextTools.tools.length} tools: get_working_directory, get_environment_info, get_project_info)`);
    }
  }

  // 3h. Add brain tools if enabled (knowledge base search, project management)
  // Brain tools MUST use customBrainHandlers (daemon proxy) - no local execution
  if (options.includeBrainTools && options.customBrainHandlers) {
    const brainToolDefs = generateBrainTools();
    const brainHandlers = options.customBrainHandlers;

    // Note: File tools (read_file, write_file, create_file, edit_file, delete_path) are no longer
    // brain tools. They are regular file tools that automatically update the brain via the
    // onFileModified callback when brain is available. This filter is kept for backward
    // compatibility but should no longer be necessary.
    const brainFileToolNames = ['read_file', 'write_file', 'create_file', 'edit_file', 'delete_path'];
    const filteredBrainTools = options.includeFsTools !== false
      ? brainToolDefs.filter(t => !brainFileToolNames.includes(t.name))
      : brainToolDefs;

    tools.push(...filteredBrainTools);
    for (const tool of filteredBrainTools) {
      if (brainHandlers[tool.name]) {
        boundHandlers[tool.name] = brainHandlers[tool.name];
      }
    }

    if (options.verbose) {
      console.log(`   🧠 Brain tools enabled (${filteredBrainTools.length} tools via daemon: list_brain_projects, brain_search, ingest_directory, ...)`);
    }
  }

  // 3i. Add planning tools (enabled by default)
  if (options.includePlanningTools !== false) {
    const planTool = generatePlanActionsTool();
    tools.push(planTool.definition);

    // Create sub-agent execution function
    // Single agent with TASK_LIST tracking, uses task_completed/final_answer
    const executeSubAgent = async (plan: ActionPlan): Promise<PlanExecutionResult> => {
      const results: PlanExecutionResult['results'] = [];
      let currentTaskIndex = 0;

      console.log(`\n   🤖 [SubAgent] Starting plan execution`);
      console.log(`      Goal: ${plan.goal}`);
      console.log(`      Actions: ${plan.actions.length}`);
      console.log(`      Strategy: ${plan.strategy}`);

      // Create ONE sub-agent that will execute all tasks
      const subAgent = await createRagAgent({
        ...options,
        // Disable planning tools in sub-agent to prevent infinite recursion
        includePlanningTools: false,
        // Use Complex mode output schema with task_completed and final_answer
        outputSchema: {
          reasoning: {
            type: 'string',
            description: 'Your reasoning about the current task',
            prompt: 'Explain what you are doing and why',
            required: false,
          },
          task_completed: {
            type: 'string',
            description: 'Summary when current task is done',
            prompt: 'Fill this ONLY when you have finished the CURRENT TASK. Brief summary of what was done.',
            required: false,
          },
          final_answer: {
            type: 'string',
            description: 'Final response when all tasks complete',
            prompt: 'Fill this ONLY when ALL tasks in the TASK LIST are complete. This stops execution.',
            required: false,
          },
        },
        // Set task context so the system prompt shows TASK_LIST
        taskContext: {
          goal: plan.goal,
          actions: plan.actions.map(a => ({ description: a.description, complexity: a.complexity })),
          currentActionIndex: currentTaskIndex,
        },
        // Higher max iterations since we're doing all tasks
        maxIterations: plan.actions.length * 5,
        // Log sub-agent execution
        logPath: options.logPath
          ? options.logPath.replace('.json', '_subagent.json')
          : undefined,
      });

      // Build the task list prompt
      const buildTaskPrompt = (taskIndex: number): string => {
        const taskListStr = plan.actions.map((a, i) => {
          const status = i < taskIndex ? '[x]' : (i === taskIndex ? '[>]' : '[ ]');
          const marker = i === taskIndex ? ' ← CURRENT' : '';
          return `${i + 1}. ${status} ${a.description}${marker}`;
        }).join('\n');

        const completedTasks = results.map((r, i) =>
          `Task ${i + 1}: ${r.success ? '✓' : '✗'} ${r.result || r.error}`
        ).join('\n');

        return `=== GOAL ===
${plan.goal}

=== TASK LIST ===
${taskListStr}

=== CURRENT TASK ===
Task ${taskIndex + 1}: ${plan.actions[taskIndex]?.description || 'All tasks complete'}

${completedTasks ? `=== COMPLETED TASKS ===\n${completedTasks}\n` : ''}
=== INSTRUCTIONS ===
Execute the CURRENT TASK by calling the appropriate tools.
When this task is done, fill task_completed with a summary.
Only fill final_answer when ALL ${plan.actions.length} tasks are complete.`;
      };

      // Execute tasks in a loop
      while (currentTaskIndex < plan.actions.length) {
        const action = plan.actions[currentTaskIndex];
        console.log(`\n      📌 [${currentTaskIndex + 1}/${plan.actions.length}] ${action.description}`);

        try {
          // Update task context for current task
          subAgent.updateTaskContext({
            goal: plan.goal,
            actions: plan.actions.map(a => ({ description: a.description, complexity: a.complexity })),
            currentActionIndex: currentTaskIndex,
          });

          // Ask agent to execute current task
          const result = await subAgent.ask(buildTaskPrompt(currentTaskIndex));

          // Check for task_completed marker
          if (result.task_completed) {
            console.log(`      ✅ Task completed: ${result.task_completed.substring(0, 100)}`);
            results.push({
              action: action.description,
              success: true,
              result: result.task_completed,
            });
            currentTaskIndex++;
          }

          // Check for final_answer (all done)
          if (result.final_answer) {
            console.log(`      🎉 All tasks complete: ${result.final_answer.substring(0, 100)}`);
            // Mark any remaining tasks as complete
            while (currentTaskIndex < plan.actions.length) {
              results.push({
                action: plan.actions[currentTaskIndex].description,
                success: true,
                result: 'Completed as part of final execution',
              });
              currentTaskIndex++;
            }
            break;
          }

          // If neither task_completed nor final_answer, treat answer as task completion
          if (!result.task_completed && !result.final_answer && result.answer) {
            console.log(`      ✅ Task done (implicit): ${result.answer.substring(0, 100)}`);
            results.push({
              action: action.description,
              success: true,
              result: result.answer,
            });
            currentTaskIndex++;
          }
        } catch (error: any) {
          console.log(`      ❌ Task failed: ${error.message}`);
          results.push({
            action: action.description,
            success: false,
            error: error.message,
          });

          // For sequential strategy, stop on first failure
          if (plan.strategy === 'sequential') {
            break;
          }
          currentTaskIndex++;
        }
      }

      const successCount = results.filter(r => r.success).length;
      return {
        success: successCount === results.length,
        results,
        summary: `Executed ${successCount}/${results.length} actions successfully`,
      };
    };

    // Create handler with context
    const planHandler = planTool.handlerFactory({
      tools,
      handlers,
      ragClient: options.ragClient,
      executeSubAgent,
    });

    boundHandlers[planTool.definition.name] = planHandler(options.ragClient);

    if (options.verbose) {
      console.log(`   📋 Planning tools enabled (plan_actions)`);
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
