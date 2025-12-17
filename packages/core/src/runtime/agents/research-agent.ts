/**
 * Research Agent - A focused agent for information gathering and report generation
 *
 * Unlike RagAgent which has 70+ tools for general coding tasks, ResearchAgent
 * is optimized for research workflows:
 * - Reading files (code, images, PDFs, documents)
 * - Semantic search in the knowledge base
 * - Exploring file systems
 * - Ingesting new content when needed
 * - Producing comprehensive markdown reports
 *
 * Includes full conversation memory with:
 * - Automatic L1/L2 summarization
 * - Semantic search across conversation history
 * - Enriched context from codebase
 */

import { StructuredLLMExecutor, BaseToolExecutor, LLMParseError, type ToolCallRequest, type ProgressiveOutputConfig } from '../llm/structured-llm-executor.js';
import { GeminiAPIProvider } from '../reranking/gemini-api-provider.js';
import { type ToolDefinition } from '../llm/native-tool-calling/index.js';
import { AgentLogger } from './rag-agent.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ResearchAgent');
// NOTE: read_file, write_file, etc. are now in brain-tools.ts only
import {
  generateFsTools,
  type FsToolsContext,
} from '../../tools/fs-tools.js';
import {
  generateBrainSearchTool,
  generateBrainSearchHandler,
  generateIngestDirectoryTool,
  generateIngestDirectoryHandler,
  generateExploreNodeTool,
  generateExploreNodeHandler,
  generateBrainReadFileTool,
  generateBrainReadFileHandler,
  generateBrainReadFilesTool,
  generateBrainReadFilesHandler,
  type BrainToolsContext,
} from '../../tools/brain-tools.js';
import type { GeneratedToolDefinition } from '../../tools/types/index.js';
import type { ConversationStorage } from '../conversation/storage.js';
import type { ConversationSummarizer, ConversationTurn } from '../conversation/summarizer.js';
import type { Summary } from '../conversation/types.js';
import type { BrainManager } from '../../brain/brain-manager.js';
import type { GeminiEmbeddingProvider } from '../embedding/embedding-provider.js';

// Report editing tools
import { ReportEditor } from '../utils/report-editor.js';
import {
  REPORT_TOOL_DEFINITIONS,
  createReportToolHandlers,
  isReportTool,
  isFinalizeTool,
  type ReportToolHandlers,
} from '../utils/report-tools.js';

// Session analysis
import { runSessionAnalysis, type SessionAnalysisResult } from './session-analyzer.js';

// ============================================
// Types
// ============================================

export interface ResearchAgentOptions {
  /** Gemini API key (defaults to GEMINI_API_KEY env var) */
  apiKey?: string;

  /** Model to use (default: gemini-2.0-flash) */
  model?: string;

  /** Temperature for LLM (default: 0.2 - slightly more creative for research) */
  temperature?: number;

  /** Max iterations for tool loop within each research round (default: 10) */
  maxIterations?: number;

  /** Max research rounds - continues until confident or this limit (default: 5) */
  maxResearchRounds?: number;

  /** Project root for file operations (string or getter for dynamic resolution) */
  projectRoot?: string | (() => string | null);

  /** Current working directory */
  cwd?: string;

  /** BrainManager instance for brain_search and ingest_directory */
  brainManager?: BrainManager;

  /** ConversationStorage for persistence and memory */
  conversationStorage?: ConversationStorage;

  /** ConversationSummarizer for auto-summarization */
  conversationSummarizer?: ConversationSummarizer;

  /** EmbeddingProvider for message embeddings */
  embeddingProvider?: GeminiEmbeddingProvider;

  /** Active conversation ID for context retrieval */
  conversationId?: string;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Path to write detailed JSON logs (uses AgentLogger) */
  logPath?: string;

  /** Directory to write individual prompt/response files (for debugging) */
  promptsDir?: string;

  /** Include web tools (fetch_web_page) for web research */
  includeWebTools?: boolean;

  // Callbacks for UI integration
  /** Called when a tool is about to be executed */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;

  /** Called when a tool completes */
  onToolResult?: (
    toolName: string,
    result: any,
    success: boolean,
    durationMs: number
  ) => void;

  /** Called when the agent is thinking/reasoning */
  onThinking?: (reasoning: string) => void;

  /** Called when the report is updated (for streaming incremental updates) */
  onReportUpdate?: (report: string, confidence: 'high' | 'medium' | 'low', missingInfo: string[]) => void;

  /** Enable tool context summarization when context gets too large (default: false) */
  summarizeToolContext?: boolean;

  /** Threshold in chars to trigger tool context summarization (default: 40000) */
  toolContextSummarizationThreshold?: number;
}

export interface ToolCallDetail {
  tool_name: string;
  arguments: Record<string, any>;
  result: any;
  success: boolean;
  duration_ms: number;
}

export interface ResearchResult {
  /** The markdown report produced by the agent */
  report: string;

  /** Confidence level in the findings */
  confidence: 'high' | 'medium' | 'low';

  /** List of sources referenced (file paths, URLs, etc.) */
  sourcesUsed: string[];

  /** List of tools that were called */
  toolsUsed: string[];

  /** Detailed tool call history with arguments and results */
  toolCallDetails: ToolCallDetail[];

  /** Number of LLM calls (turns) */
  turns: number;

  /** Number of outer iterations (restarts) */
  iterations: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  timestamp?: string;
}

export interface ChatResponse {
  message: string;
  reasoning?: string;
  toolsUsed: string[];
  sourcesUsed: string[];
}

// ============================================
// System Prompt
// ============================================

const RESEARCH_SYSTEM_PROMPT = `You are a **Research Assistant** focused on gathering information and producing comprehensive reports.

## Response Guidelines

**Answer directly when you can:**
- Greetings and casual conversation → respond naturally without tools
- Questions you can answer from general knowledge → answer directly
- Clarifying questions → ask without using tools
- Simple explanations → explain without searching

**Use tools when needed:**
- Questions about specific files → use read_file, brain_search
- Finding files or patterns → use glob_files, grep_files
- Understanding project structure → use list_directory, brain_search

## Example Queries (not just code!)

**Code projects:**
- "What does the auth module do?" → brain_search + read_file
- "Find all API endpoints" → grep_files for route patterns

**Documents & Research:**
- "Summarize this PDF report" → read_file on the PDF
- "What's in the project documentation?" → glob_files for *.md, *.pdf, then read_file
- "Compare these two documents" → read_file both, then synthesize

**Images & Media:**
- "Describe this screenshot" → read_file on the image
- "What UI elements are in these mockups?" → read_file on each image
- "Analyze this 3D model" → read_file on .glb/.gltf file

**Data & Spreadsheets:**
- "What data is in this Excel file?" → read_file on .xlsx
- "Summarize the CSV data" → read_file on .csv
- "Find all JSON config files" → glob_files for *.json

## Your Capabilities

### read_file - Your primary tool
Use \`read_file\` to read ANY file type:
- **Code files**: TypeScript, JavaScript, Python, etc.
- **Images**: PNG, JPG, GIF, WebP - you'll see a visual description
- **Documents**: PDF, DOCX, XLSX - text will be extracted
- **3D Models**: GLB, GLTF - you'll see renders and descriptions

**IMPORTANT**: When you read a file with \`read_file\`, it is automatically indexed in the knowledge base for future semantic searches. This means:
- Reading important files makes them searchable later
- You don't need to run \`ingest_directory\` for individual files

### read_files - Batch read multiple files
When you need to read several files at once (e.g., after finding relevant files with \`brain_search\` or \`glob_files\`), use \`read_files\` for efficiency:
\`\`\`
read_files({ paths: ["src/auth.ts", "src/utils.ts", "src/config.ts"] })
\`\`\`
This reads all files in parallel and returns results for each. Much faster than multiple \`read_file\` calls.

### brain_search - Semantic search
Search across all previously indexed content. Use this first to find relevant files before reading them.

### ingest_directory - Bulk indexing
**Use sparingly and carefully!** Only use \`ingest_directory\` when:
- User explicitly asks to index a project/directory
- You need to search across many files at once AND you're certain the directory is a reasonable project folder

**NEVER ingest**: home directories (~), root (/), Downloads, Desktop, or any large generic folder. Always verify the path looks like a specific project (e.g., has package.json, src/, etc.) before ingesting.

For individual files, just use \`read_file\` - it will index them automatically.

### explore_node - Explore relationships by UUID
When you get search results from \`brain_search\`, each result includes a **uuid**. Use \`explore_node\` to discover what a node is connected to:
- **Code relationships**: What functions call this one? What does it depend on?
- **Document links**: What pages link to this web page?
- **File structure**: What directory contains this file?

This is powerful for understanding how code/content is interconnected. The tool automatically discovers all relationship types.

**Example workflow:**
1. \`brain_search({ query: "authentication" })\` → get results with UUIDs
2. \`explore_node({ uuid: "scope:abc-123", depth: 2 })\` → see what calls/uses this function

### Exploration tools
- \`list_directory\`: See what's in a folder
- \`glob_files\`: Find files by pattern (e.g., "**/*.ts")
- \`grep_files\`: Search file contents with regex
- \`search_files\`: Fuzzy text search

## Research Workflow - BE THOROUGH

**CRITICAL: Never rely on a single search result.** Your job is to gather ALL relevant information, not just the first match.

### Step 1: Initial Search
Start with \`brain_search\` using the user's terms, but **don't stop there**.

**RULE: You MUST perform at least 2-3 different searches before writing your report.**

### Step 2: Expand Your Search
From initial results, identify:
- **Related terms** you didn't search for (e.g., if searching "authentication", also try "login", "session", "token", "auth")
- **File/function names** mentioned in results → search for those specifically
- **Imports/dependencies** → explore what else is connected

### Step 3: Follow the Trail
- Use \`explore_node\` on interesting UUIDs to find connected code
- Use \`grep_files\` to find usages of functions/classes you discovered
- Read the actual source files to understand context

### Step 4: Verify Completeness
Before finalizing, ask yourself:
- Have I found ALL the relevant files, not just one?
- Are there related concepts I haven't explored?
- Would the user be surprised by something I missed?

### Step 5: Synthesize with Citations
Combine findings into a coherent answer WITH proper citations.

## Guidelines - CITATIONS WITH CODE ARE MANDATORY

**Every claim must include a code block with the source citation:**

✅ GOOD - citation with code block:
\`\`\`
The authentication is handled by the \`validateToken\` function:

\`\`\`typescript
// src/auth.ts:45-52
export function validateToken(token: string): boolean {
  const decoded = jwt.verify(token, SECRET);
  return decoded.exp > Date.now();
}
\`\`\`
\`\`\`

❌ BAD - just mentioning without code:
\`\`\`
"The function validates tokens (src/auth.ts:45)"
\`\`\`

**Format for code blocks:**
\`\`\`language
// file/path.ts:startLine-endLine
<actual code from the file>
\`\`\`

**Other guidelines:**
- Be thorough - gather ALL relevant information, not just the first match
- Infer related terms the user might not have mentioned
- For images, PDFs, and 3D models, describe what you observe in detail
- When uncertain, say so - don't make up information
- Prefer \`read_file\` over \`ingest_directory\` for individual files

## Report Building

**ALWAYS build your report as you research.** Don't wait until the end.

### CRITICAL RULES

**1. Make MULTIPLE tool calls per turn (parallel execution):**
\`\`\`
// GOOD - multiple searches + report update in ONE turn:
brain_search({ query: "authentication" })
brain_search({ query: "login session token" })
grep_files({ pattern: "**/*.ts", regex: "validateToken" })
set_report({ content: "# Auth Report\\n\\nSearching auth, login, tokens..." })
\`\`\`

\`\`\`
// BAD - only one tool call per turn (too slow!):
brain_search({ query: "authentication" })
// ... wait for next turn ...
\`\`\`

**2. Always include a report tool with your search tools:**
Every turn should update the report with your findings so far.

### Workflow
1. First search → immediately \`set_report\` with initial findings
2. Each additional search → \`append_to_report\` or \`edit_report\` with new findings
3. Keep researching and updating until comprehensive
4. Only call \`finalize_report\` when you have high confidence

### Starting a report
Use \`set_report\` to create an initial draft with your structure:
\`\`\`
set_report({ content: "# Report Title\\n\\n## Summary\\n\\nInitial findings..." })
\`\`\`

### Editing the report
Use these tools for incremental updates:
- \`edit_report\`: Replace specific text (search/replace)
- \`append_to_report\`: Add new sections at the end
- \`insert_after_heading\`: Insert content after a specific heading
- \`replace_section\`: Replace an entire section's content
- \`delete_section\`: Remove a section

### Finalizing
When confident in your findings, call \`finalize_report\`:
\`\`\`
finalize_report({ confidence: "high" })
\`\`\`

**IMPORTANT**: Only call \`finalize_report\` when you have HIGH confidence!

If you don't have high confidence yet, **keep researching**:
- Try different search terms
- Read more source files
- Use \`explore_node\` to find connected code
- Use \`grep_files\` to find usages

Confidence levels:
- **high**: Multiple searches done (2-3+), every claim has line-number citations, comprehensive coverage
- **medium**: Some gaps remain → do more research before finalizing
- **low**: Significant gaps → do NOT finalize, keep researching

## Working Directory
{CWD_PLACEHOLDER}`;

// ============================================
// Tool Executor
// ============================================

class ResearchToolExecutor extends BaseToolExecutor {
  public sourcesUsed: Set<string> = new Set();
  public toolsUsed: string[] = [];
  public toolCallDetails: Array<{
    tool_name: string;
    arguments: Record<string, any>;
    result: any;
    success: boolean;
    duration_ms: number;
  }> = [];

  // Report editing state
  public readonly reportEditor: ReportEditor;
  private reportToolHandlers: ReportToolHandlers;
  public isReportFinalized = false;
  public reportConfidence: 'high' | 'medium' | 'low' = 'low';

  private onToolCall?: (toolName: string, args: Record<string, any>) => void;
  private onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
  private onReportUpdate?: (content: string) => void;
  private logger?: AgentLogger;

  constructor(
    private handlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    callbacks?: {
      onToolCall?: (toolName: string, args: Record<string, any>) => void;
      onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
      onReportUpdate?: (content: string) => void;
    },
    logger?: AgentLogger
  ) {
    super();
    this.onToolCall = callbacks?.onToolCall;
    this.onToolResult = callbacks?.onToolResult;
    this.onReportUpdate = callbacks?.onReportUpdate;
    this.logger = logger;

    // Initialize report editor and handlers
    this.reportEditor = new ReportEditor();
    this.reportToolHandlers = createReportToolHandlers(this.reportEditor);
  }

  /**
   * Get current report content
   */
  getReportContent(): string {
    return this.reportEditor.getContent();
  }

  async execute(request: ToolCallRequest): Promise<any> {
    const { tool_name, arguments: args } = request;
    const startTime = Date.now();

    // Log tool call
    this.logger?.logToolCall(tool_name, args);

    // Notify callback
    if (this.onToolCall) {
      this.onToolCall(tool_name, args);
    }

    // Track tool usage
    this.toolsUsed.push(tool_name);

    // Track sources for certain tools
    if (tool_name === 'read_file' && args.path) {
      this.sourcesUsed.add(args.path);
    } else if (tool_name === 'brain_search' && args.query) {
      this.sourcesUsed.add(`[search: ${args.query}]`);
    }

    // Check if this is a report tool - handle internally
    if (isReportTool(tool_name)) {
      return this.executeReportTool(tool_name, args, startTime);
    }

    const handler = this.handlers[tool_name];
    if (!handler) {
      const error = `Unknown tool: ${tool_name}`;
      const durationMs = Date.now() - startTime;

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result: error,
        success: false,
        duration_ms: durationMs,
      });

      this.logger?.logToolError(tool_name, error, durationMs);

      if (this.onToolResult) {
        this.onToolResult(tool_name, error, false, durationMs);
      }
      throw new Error(error);
    }

    try {
      const result = await handler(args);
      const durationMs = Date.now() - startTime;

      // Log successful result
      this.logger?.logToolResult(tool_name, result, durationMs);

      // Track files from search results
      if (tool_name === 'brain_search' && result?.results) {
        for (const r of result.results) {
          if (r.filePath) this.sourcesUsed.add(r.filePath);
        }
      }

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result,
        success: true,
        duration_ms: durationMs,
      });

      if (this.onToolResult) {
        this.onToolResult(tool_name, result, true, durationMs);
      }

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error.message || String(error);

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result: errorMsg,
        success: false,
        duration_ms: durationMs,
      });

      this.logger?.logToolError(tool_name, errorMsg, durationMs);

      if (this.onToolResult) {
        this.onToolResult(tool_name, errorMsg, false, durationMs);
      }
      throw error;
    }
  }

  /**
   * Execute a report editing tool
   */
  private executeReportTool(tool_name: string, args: Record<string, any>, startTime: number): any {
    try {
      // Get the handler for this report tool
      const handler = this.reportToolHandlers[tool_name as keyof ReportToolHandlers];
      if (!handler) {
        throw new Error(`Unknown report tool: ${tool_name}`);
      }

      // Execute the tool
      const result = handler(args as any);
      const durationMs = Date.now() - startTime;

      // Check if the tool's result indicates success
      // Report tools return { success: boolean, ... }
      const toolSuccess = result?.success !== false;

      // Handle finalize_report specially (only if successful)
      if (isFinalizeTool(tool_name) && toolSuccess) {
        this.isReportFinalized = true;
        this.reportConfidence = args.confidence || 'medium';
      }

      // Log result
      if (toolSuccess) {
        this.logger?.logToolResult(tool_name, result, durationMs);
      } else {
        this.logger?.logToolError(tool_name, result?.error || 'Tool returned failure', durationMs);
      }

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result,
        success: toolSuccess,
        duration_ms: durationMs,
      });

      if (this.onToolResult) {
        this.onToolResult(tool_name, result, toolSuccess, durationMs);
      }

      // Notify report update callback (for UI streaming)
      if (this.onReportUpdate && !this.reportEditor.isEmpty()) {
        this.onReportUpdate(this.reportEditor.getContent());
      }

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error.message || String(error);

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result: errorMsg,
        success: false,
        duration_ms: durationMs,
      });

      this.logger?.logToolError(tool_name, errorMsg, durationMs);

      if (this.onToolResult) {
        this.onToolResult(tool_name, errorMsg, false, durationMs);
      }

      // Return error result instead of throwing (more forgiving for report tools)
      return { success: false, error: errorMsg, content: this.reportEditor.getContent() };
    }
  }
}

// ============================================
// Research Agent
// ============================================

export class ResearchAgent {
  private executor: StructuredLLMExecutor;
  private llmProvider: GeminiAPIProvider;
  private tools: GeneratedToolDefinition[];
  private handlers: Record<string, (args: Record<string, any>) => Promise<any>>;
  private maxIterations: number;
  private maxResearchRounds: number;
  private verbose: boolean;
  private logger?: AgentLogger;
  private promptsDir?: string;

  // Conversation memory
  private conversationStorage?: ConversationStorage;
  private conversationSummarizer?: ConversationSummarizer;
  private embeddingProvider?: GeminiEmbeddingProvider;
  private conversationId?: string;
  private brainManager?: BrainManager;
  private projectRoot?: string | (() => string | null);
  private cwd?: string;

  // Callbacks
  private onToolCall?: (toolName: string, args: Record<string, any>) => void;
  private onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
  private onThinking?: (reasoning: string) => void;
  private onReportUpdate?: (report: string, confidence: 'high' | 'medium' | 'low', missingInfo: string[]) => void;
  private summarizeToolContext: boolean;
  private toolContextSummarizationThreshold: number;

  constructor(
    executor: StructuredLLMExecutor,
    llmProvider: GeminiAPIProvider,
    tools: GeneratedToolDefinition[],
    handlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    options: {
      maxIterations?: number;
      maxResearchRounds?: number;
      verbose?: boolean;
      logPath?: string;
      promptsDir?: string;
      conversationStorage?: ConversationStorage;
      conversationSummarizer?: ConversationSummarizer;
      embeddingProvider?: GeminiEmbeddingProvider;
      conversationId?: string;
      brainManager?: BrainManager;
      projectRoot?: string | (() => string | null);
      cwd?: string;
      onToolCall?: (toolName: string, args: Record<string, any>) => void;
      onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
      onThinking?: (reasoning: string) => void;
      onReportUpdate?: (report: string, confidence: 'high' | 'medium' | 'low', missingInfo: string[]) => void;
      summarizeToolContext?: boolean;
      toolContextSummarizationThreshold?: number;
    }
  ) {
    this.executor = executor;
    this.llmProvider = llmProvider;
    this.tools = tools;
    this.handlers = handlers;
    this.maxIterations = options.maxIterations ?? 10;
    this.maxResearchRounds = options.maxResearchRounds ?? 5;
    this.verbose = options.verbose ?? false;
    this.promptsDir = options.promptsDir;

    // Create logger if logPath provided
    if (options.logPath) {
      this.logger = new AgentLogger(options.logPath);
    }

    // Memory
    this.conversationStorage = options.conversationStorage;
    this.conversationSummarizer = options.conversationSummarizer;
    this.embeddingProvider = options.embeddingProvider;
    this.conversationId = options.conversationId;
    this.brainManager = options.brainManager;
    this.projectRoot = options.projectRoot;
    this.cwd = options.cwd;

    // Configure conversationStorage with dependencies
    if (this.conversationStorage) {
      if (this.brainManager) {
        this.conversationStorage.setBrainManager(this.brainManager);
      }
      if (this.conversationSummarizer) {
        this.conversationStorage.setSummarizer(this.conversationSummarizer);
      }
      if (this.embeddingProvider) {
        this.conversationStorage.setEmbeddingProvider(this.embeddingProvider);
      }
      // Set LLM for fuzzy search
      this.conversationStorage.setLLMExecutor(this.executor, this.llmProvider);
    }

    // Callbacks
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.onThinking = options.onThinking;
    this.onReportUpdate = options.onReportUpdate;

    // Tool context summarization (disabled by default for full observability)
    this.summarizeToolContext = options.summarizeToolContext ?? false;
    this.toolContextSummarizationThreshold = options.toolContextSummarizationThreshold ?? 40000;
  }

  /**
   * Convert tools to ToolDefinition format (OpenAI function calling format)
   */
  private getToolDefinitions(): ToolDefinition[] {
    // Convert research tools to ToolDefinition format
    const researchTools = this.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    // Add report editing tools
    return [...researchTools, ...REPORT_TOOL_DEFINITIONS];
  }

  /**
   * Resolve project root
   */
  private getProjectRoot(): string | null {
    if (typeof this.projectRoot === 'function') {
      return this.projectRoot();
    }
    return this.projectRoot || this.cwd || null;
  }

  /**
   * Build CWD info including indexed projects information
   */
  private async buildCwdInfo(): Promise<string> {
    if (!this.cwd) {
      return 'No specific working directory set.';
    }

    let info = `You are working in: \`${this.cwd}\`\n\n`;
    info += `All your file operations and searches should be focused on this directory. `;
    info += `When using \`brain_search\`, results will be automatically filtered to files within this directory.\n\n`;

    // Get indexed projects info if brainManager is available
    if (this.brainManager) {
      try {
        const projects = this.brainManager.listProjects();
        const normalizedCwd = this.cwd.endsWith('/') ? this.cwd.slice(0, -1) : this.cwd;

        // Find projects that are in or contain the cwd
        const relevantProjects = projects.filter(p => {
          const normalizedPath = p.path.endsWith('/') ? p.path.slice(0, -1) : p.path;
          // Project is inside cwd OR cwd is inside project
          return normalizedPath.startsWith(normalizedCwd) || normalizedCwd.startsWith(normalizedPath);
        });

        if (relevantProjects.length > 0) {
          info += `### Indexed Content\n`;
          info += `The following projects are indexed and searchable via \`brain_search\`:\n`;
          for (const p of relevantProjects) {
            const relPath = p.path.startsWith(normalizedCwd)
              ? p.path.slice(normalizedCwd.length + 1) || '.'
              : p.path;
            info += `- **${p.id}** (${p.type || 'project'}): \`${relPath}\` - ${p.nodeCount || 0} nodes\n`;
          }
          info += `\n**Use \`brain_search\` first** for questions about this codebase - it's faster than grep.\n`;
        } else {
          info += `### No Indexed Content\n`;
          info += `This directory is **not indexed** in the knowledge base. `;
          info += `Use \`glob_files\` and \`grep_files\` to search, or \`ingest_directory\` to index it first.\n`;
        }
      } catch (err) {
        // Silently ignore errors getting project info
      }
    }

    return info;
  }

  /**
   * Get recent context from conversation (no semantic search, fast)
   * Returns recent turns WITH tool calls and L1 summaries
   */
  private async getRecentContext(): Promise<{
    recentTurns: ConversationTurn[];
    recentL1Summaries: Summary[];
  }> {
    if (!this.conversationStorage || !this.conversationId) {
      return { recentTurns: [], recentL1Summaries: [] };
    }

    try {
      return await this.conversationStorage.getRecentContextForAgent(this.conversationId, {
        turnsMaxChars: 5000,  // 5% of context
        l1MaxChars: 10000,    // 10% of context
        turnsLimit: 10,
        l1Limit: 5
      });
    } catch {
      return { recentTurns: [], recentL1Summaries: [] };
    }
  }

  /**
   * Decide what context is needed using a fast LLM call
   */
  private async decideContextNeeds(
    question: string,
    recentContext: { recentTurns: ConversationTurn[]; recentL1Summaries: Summary[] }
  ): Promise<{
    needsCodeSearch: boolean;
    needsDeepHistory: boolean;
    canAnswerDirectly: boolean;
  }> {
    logger.debug('decideContextNeeds called', {
      question: question?.substring(0, 100) || '(no question)',
      recentTurnsCount: recentContext?.recentTurns?.length ?? 0,
      recentL1SummariesCount: recentContext?.recentL1Summaries?.length ?? 0,
    });

    // Format recent turns with tool calls for the decision prompt
    const turnsText = recentContext?.recentTurns?.length > 0
      ? recentContext.recentTurns.map((turn, idx) => {
          // Defensive checks with logging
          if (!turn) {
            logger.warn(`decideContextNeeds: turn at index ${idx} is undefined`);
            return '(invalid turn)';
          }
          if (turn.userMessage === undefined || turn.userMessage === null) {
            logger.warn(`decideContextNeeds: turn.userMessage at index ${idx} is undefined`, { turn });
          }
          if (turn.assistantMessage === undefined || turn.assistantMessage === null) {
            logger.warn(`decideContextNeeds: turn.assistantMessage at index ${idx} is undefined`, { turn });
          }

          const userMsg = turn.userMessage ?? '';
          const assistantMsg = turn.assistantMessage ?? '';

          let text = `User: ${userMsg.substring(0, 300)}`;
          if (turn.toolResults?.length > 0) {
            text += `\nTools used: ${turn.toolResults.map(t => `${t?.toolName || 'unknown'}(${t?.success ? '✓' : '✗'})`).join(', ')}`;
          }
          text += `\nAssistant: ${assistantMsg.substring(0, 300)}`;
          return text;
        }).join('\n---\n')
      : '(no previous messages)';

    // Add L1 summaries if available
    const l1Text = recentContext?.recentL1Summaries?.length > 0
      ? `\n\nOlder conversation summaries:\n${recentContext.recentL1Summaries.map((s, idx) => {
          // Defensive checks with logging
          if (!s?.content?.conversation_summary) {
            logger.warn(`decideContextNeeds: L1 summary at index ${idx} missing conversation_summary`, { summary: s });
            return '- (invalid summary)';
          }
          return `- ${s.content.conversation_summary.substring(0, 200)}`;
        }).join('\n')}`
      : '';

    const decisionPrompt = `You are a routing assistant. Analyze the user's message and decide what context is needed.

Recent conversation (with tool calls):
${turnsText}${l1Text}

User's new message: "${question}"

Decide:
1. needs_code_search: Does this require searching the codebase? (files, functions, code structure)
2. needs_deep_history: Does this reference something from earlier in the conversation that's not in recent messages?
3. can_answer_directly: Can you answer this without any tools? (greetings, general questions, clarifications, questions about what was already found/searched)

Examples:
- "hello" → can_answer_directly: true
- "what does the auth function do?" → needs_code_search: true
- "like you said earlier about the database" → needs_deep_history: true
- "thanks!" → can_answer_directly: true
- "find all API endpoints" → needs_code_search: true
- "what did you find?" → can_answer_directly: true (if tool results are in recent context)
- "summarize what we discussed" → can_answer_directly: true (if L1 summaries available)`;

    try {
      const result = await this.executor.executeSingle<{
        needs_code_search: boolean;
        needs_deep_history: boolean;
        can_answer_directly: boolean;
      }>({
        input: { question },
        inputFields: [{ name: 'question', prompt: 'The question to analyze' }],
        systemPrompt: decisionPrompt,
        userTask: 'Analyze the message and decide what context is needed.',
        outputSchema: {
          needs_code_search: {
            type: 'boolean' as const,
            description: 'True if the question requires searching the codebase'
          },
          needs_deep_history: {
            type: 'boolean' as const,
            description: 'True if the question references earlier conversation history'
          },
          can_answer_directly: {
            type: 'boolean' as const,
            description: 'True if this can be answered without any tools (greetings, simple questions)'
          }
        },
        maxIterations: 1, // No tools, just decision
        llmProvider: this.llmProvider,
        caller: 'ResearchAgent.decideContext',
        logPrompts: false,
        logResponses: false,
      });

      return {
        needsCodeSearch: result.needs_code_search ?? false,
        needsDeepHistory: result.needs_deep_history ?? false,
        canAnswerDirectly: result.can_answer_directly ?? false,
      };
    } catch (error) {
      // On error, be conservative and do full context
      if (this.verbose) {
        console.warn(`[ResearchAgent] Context decision failed, using full context`);
      }
      return {
        needsCodeSearch: true,
        needsDeepHistory: false,
        canAnswerDirectly: false,
      };
    }
  }

  /**
   * Build enriched context from conversation history and codebase
   * Now uses intelligent decision to avoid unnecessary searches
   */
  private async buildEnrichedContext(
    question: string,
    contextNeeds: { needsCodeSearch: boolean; needsDeepHistory: boolean }
  ): Promise<string | null> {
    if (!this.conversationStorage || !this.conversationId) {
      return null;
    }

    // If no context needed, return null
    if (!contextNeeds.needsCodeSearch && !contextNeeds.needsDeepHistory) {
      return null;
    }

    try {
      const enrichedContext = await this.conversationStorage.buildEnrichedContext(
        this.conversationId,
        question,
        {
          cwd: this.cwd,
          projectRoot: this.getProjectRoot() || undefined,
          // Pass flags to control what gets searched
          skipCodeSearch: !contextNeeds.needsCodeSearch,
          skipHistorySearch: !contextNeeds.needsDeepHistory,
        }
      );

      return this.conversationStorage.formatContextForAgent(enrichedContext);
    } catch (error: any) {
      if (this.verbose) {
        console.warn(`[ResearchAgent] Failed to build enriched context: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Store message in conversation history
   */
  private async storeMessage(
    role: 'user' | 'assistant',
    content: string,
    options?: {
      reasoning?: string;
      toolCalls?: Array<{
        tool_name: string;
        arguments: Record<string, any>;
        result: any;
        success: boolean;
        duration_ms: number;
      }>;
    }
  ): Promise<void> {
    if (!this.conversationStorage || !this.conversationId) {
      return;
    }

    try {
      // Store the message
      const messageUuid = await this.conversationStorage.storeMessage({
        conversation_id: this.conversationId,
        role,
        content,
        reasoning: options?.reasoning,
        timestamp: new Date(),
      });

      // Store tool calls if any
      if (options?.toolCalls && options.toolCalls.length > 0) {
        for (let i = 0; i < options.toolCalls.length; i++) {
          const tc = options.toolCalls[i];
          await this.conversationStorage.storeToolCall(messageUuid, {
            tool_name: tc.tool_name,
            arguments: JSON.stringify(tc.arguments),
            success: tc.success,
            duration_ms: tc.duration_ms,
            result: tc.result,
            iteration: i,
          });
        }
      }

      // Generate embedding for the message if provider available
      if (this.embeddingProvider && role === 'assistant') {
        try {
          const embedding = await this.embeddingProvider.embedSingle(content);
          await this.conversationStorage.updateMessageEmbedding(messageUuid, embedding);
        } catch (err) {
          // Non-critical, continue without embedding
        }
      }
    } catch (error: any) {
      if (this.verbose) {
        console.warn(`[ResearchAgent] Failed to store message: ${error.message}`);
      }
    }
  }

  /**
   * Trigger auto-summarization if thresholds are met
   */
  private async triggerAutoSummarization(): Promise<void> {
    if (!this.conversationStorage || !this.conversationId) {
      return;
    }

    try {
      const projectRoot = this.getProjectRoot() || undefined;

      // Try L1 summary
      const l1Summary = await this.conversationStorage.generateL1SummaryIfNeeded(
        this.conversationId,
        { projectRoot }
      );

      if (l1Summary && this.verbose) {
        console.log(`[ResearchAgent] Generated L1 summary: ${l1Summary.uuid}`);
      }

      // Try L2 summary (summarizes L1 summaries)
      const l2Summary = await this.conversationStorage.generateL2SummaryIfNeeded(
        this.conversationId,
        { projectRoot }
      );

      if (l2Summary && this.verbose) {
        console.log(`[ResearchAgent] Generated L2 summary: ${l2Summary.uuid}`);
      }
    } catch (error: any) {
      if (this.verbose) {
        console.warn(`[ResearchAgent] Auto-summarization failed: ${error.message}`);
      }
    }
  }

  /**
   * Perform research on a question
   */
  async research(question: string, history?: ChatMessage[]): Promise<ResearchResult> {
    if (!question) {
      logger.error('research() called with undefined/null question');
      throw new Error('ResearchAgent.research() requires a question');
    }

    logger.info('research() started', {
      questionPreview: question.substring(0, 100),
      questionLength: question.length,
      historyLength: history?.length ?? 0,
    });

    if (this.verbose) {
      console.log(`\n[ResearchAgent] Research: "${question}"`);
    }

    // Step 0: Fast-path for obvious greetings (no LLM call needed)
    const greetingPatterns = /^(hi|hello|hey|salut|bonjour|coucou|merci|thanks|thank you|ok|okay|d'accord|super|cool|nice|great|bye|goodbye|au revoir|à\+|a\+)[\s!?.,]*$/i;
    const isSimpleGreeting = greetingPatterns.test(question.trim());

    if (isSimpleGreeting) {
      console.log(`[ResearchAgent] Fast-path: detected greeting, skipping context decision`);
    }

    // Step 1: Get recent context (fast, no search) - includes tool calls and L1 summaries
    const recentContext = await this.getRecentContext();

    // Step 2: Decide what context is needed (fast LLM call OR fast-path)
    let contextNeeds: { needsCodeSearch: boolean; needsDeepHistory: boolean; canAnswerDirectly: boolean };

    if (isSimpleGreeting) {
      // Fast-path: skip LLM decision for greetings
      contextNeeds = { needsCodeSearch: false, needsDeepHistory: false, canAnswerDirectly: true };
    } else {
      contextNeeds = await this.decideContextNeeds(question, recentContext);
    }

    if (this.verbose) {
      console.log(`[ResearchAgent] Context decision:`, contextNeeds, isSimpleGreeting ? '(fast-path)' : '');
      console.log(`[ResearchAgent] Recent context: ${recentContext.recentTurns.length} turns, ${recentContext.recentL1Summaries.length} L1 summaries`);
    }

    // Step 3: Build enriched context only if needed
    const enrichedContext = await this.buildEnrichedContext(question, contextNeeds);

    // Store user message
    await this.storeMessage('user', question);

    // Start logging session
    this.logger?.startSession(question, 'structured', this.tools.map(t => t.name));

    // Create tool executor with callbacks and logger
    // Wrap onReportUpdate to receive report content from tool executor
    const wrappedReportUpdate = this.onReportUpdate
      ? (content: string) => {
          // Get current confidence from executor (may be updated by finalize_report)
          this.onReportUpdate!(content, 'low', []);
        }
      : undefined;

    const toolExecutor = new ResearchToolExecutor(
      this.handlers,
      {
        onToolCall: this.onToolCall,
        onToolResult: this.onToolResult,
        onReportUpdate: wrappedReportUpdate,
      },
      this.logger
    );

    // Build system prompt with CWD info
    const cwdInfo = await this.buildCwdInfo();
    let systemPrompt = RESEARCH_SYSTEM_PROMPT.replace('{CWD_PLACEHOLDER}', cwdInfo);

    // Add recent conversation context with tool calls (always included, fast)
    if (recentContext?.recentTurns?.length > 0) {
      let contextText = '## Recent Conversation\n';
      for (const turn of recentContext.recentTurns) {
        if (!turn) {
          logger.warn('research(): skipping undefined turn in recentTurns');
          continue;
        }
        const userMsg = turn.userMessage ?? '(no message)';
        const assistantMsg = turn.assistantMessage ?? '(no response)';
        const toolResults = turn.toolResults ?? [];

        contextText += `**User:** ${userMsg}\n`;
        if (toolResults.length > 0) {
          contextText += `**Tools used:** ${toolResults.map(t =>
            `${t?.toolName || 'unknown'}(${t?.success ? 'success' : 'failed'})`
          ).join(', ')}\n`;
        }
        contextText += `**Assistant:** ${assistantMsg}\n\n`;
      }
      systemPrompt = `${systemPrompt}\n\n${contextText}`;
    }

    // Add L1 summaries if available
    if (recentContext?.recentL1Summaries?.length > 0) {
      let summaryText = '## Earlier Conversation Summaries\n';
      for (const summary of recentContext.recentL1Summaries) {
        if (!summary?.content?.conversation_summary) {
          logger.warn('research(): skipping invalid L1 summary', { summary });
          continue;
        }
        summaryText += `- ${summary.content.conversation_summary}\n`;
        if (summary.content.actions_summary) {
          summaryText += `  Actions: ${summary.content.actions_summary}\n`;
        }
      }
      systemPrompt = `${systemPrompt}\n\n${summaryText}`;
    }

    // Add enriched context if we fetched it (deeper semantic search results)
    if (enrichedContext) {
      systemPrompt = `${systemPrompt}\n\n${enrichedContext}`;
    }

    // Build history context if provided (legacy fallback)
    if (!enrichedContext && recentContext.recentTurns.length === 0 && history && history.length > 0) {
      const historyContext = history
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      systemPrompt = `${systemPrompt}\n\n## Previous Conversation\n${historyContext}`;
    }

    // Add hint if can answer directly
    if (contextNeeds.canAnswerDirectly) {
      systemPrompt = `${systemPrompt}\n\n**Note:** This appears to be a simple message that you can likely answer directly without using tools.`;
    }

    // Output schema - minimal since report is built via tools
    // The LLM can use 'reasoning' to explain what it's doing
    const outputSchema = {
      reasoning: {
        type: 'string' as const,
        description: 'Brief explanation of what you are doing or what you found',
      },
    };

    let turns = 0; // Count actual LLM calls (tool rounds)
    let outerIteration = 0; // Track outer iteration number

    try {
      await this.executor.executeSingle<{ reasoning?: string }>({
        input: { question },
        inputFields: [{ name: 'question', prompt: 'The research question to investigate' }],
        systemPrompt,
        userTask: 'Research the question thoroughly. Use set_report to create a report, then finalize_report when done.',
        outputSchema,
        tools: this.getToolDefinitions(),
        maxIterations: this.maxIterations,
        toolExecutor,
        llmProvider: this.llmProvider,
        // Provide current report content for display in prompt
        getCurrentReport: () => toolExecutor.getReportContent() || null,
        // Enable tool context summarization when context gets too large (prevents repetition)
        summarizeToolContext: this.summarizeToolContext,
        toolContextSummarizationThreshold: this.toolContextSummarizationThreshold,
        caller: 'ResearchAgent.iterate',
        // Log to promptsDir if set (for full observability), otherwise use verbose flag
        logPrompts: this.promptsDir ? this.promptsDir + '/' : this.verbose,
        logResponses: this.promptsDir ? this.promptsDir + '/' : this.verbose,
        onLLMResponse: (response) => {
          turns++; // Count each LLM call
          outerIteration = response.iteration;

          // Log with turn number
          this.logger?.logIteration(turns, {
            reasoning: response.reasoning,
            toolCalls: response.toolCalls?.map(tc => tc.tool_name),
            report: toolExecutor.getReportContent(),
            confidence: toolExecutor.reportConfidence,
            outerIteration: response.iteration,
          });

          if (this.verbose) {
            console.log(`   [Turn ${turns}] (iteration ${response.iteration})`);
          }
          // Notify thinking callback if reasoning is present
          if (response.reasoning && this.onThinking) {
            this.onThinking(response.reasoning);
          }
        },
      });

      // Get report from tool executor (built via report tools)
      const report = toolExecutor.getReportContent() || 'No report generated';
      const confidence = toolExecutor.reportConfidence;
      const isFinalized = toolExecutor.isReportFinalized;

      // Log result for debugging
      console.log(`[ResearchAgent] executeSingle completed:`, {
        hasReport: report.length > 0,
        reportLength: report.length,
        reportPreview: report.substring(0, 100) || '(empty)',
        confidence,
        isFinalized,
        turns,
        iterations: outerIteration,
      });

      // Warn if report is empty
      if (!report || report.trim() === '') {
        console.warn(`[ResearchAgent] WARNING: No report built after ${turns} turns`);
      } else if (!isFinalized) {
        console.warn(`[ResearchAgent] WARNING: Report not finalized (confidence: ${confidence})`);
      }

      // Send final report update with correct confidence
      if (this.onReportUpdate && report) {
        this.onReportUpdate(report, confidence, []);
      }

      // Store assistant response with tool calls
      await this.storeMessage('assistant', report, {
        toolCalls: toolExecutor.toolCallDetails.length > 0 ? toolExecutor.toolCallDetails : undefined,
      });

      // Trigger auto-summarization
      await this.triggerAutoSummarization();

      const result_final = {
        report,
        confidence,
        sourcesUsed: Array.from(toolExecutor.sourcesUsed),
        toolsUsed: toolExecutor.toolsUsed,
        toolCallDetails: toolExecutor.toolCallDetails,
        turns,
        iterations: outerIteration,
      };

      // Log final answer to AgentLogger
      this.logger?.logFinalAnswer(report, confidence);

      console.log(`[ResearchAgent] Research complete:`, {
        reportLength: report.length,
        confidence,
        toolsUsed: result_final.toolsUsed.length,
        sourcesUsed: result_final.sourcesUsed.length,
        turns,
        iterations: outerIteration,
      });

      // Auto-analyze session if promptsDir is set
      if (this.promptsDir) {
        // Run analysis in background (don't block return)
        runSessionAnalysis(this.promptsDir, question)
          .then(analysis => {
            if (analysis) {
              logger.info('Auto-analysis completed', {
                overall_score: analysis.overall_score,
                efficiency_score: analysis.efficiency_score,
                issues: analysis.issues?.length ?? 0,
              });
            }
          })
          .catch(err => {
            logger.warn('Auto-analysis failed', { error: err.message });
          });
      }

      return result_final;
    } catch (error: any) {
      // Check if this is an LLM parse error with raw response
      const isParseError = error instanceof LLMParseError;
      // Use full rawResponse for debugging, not the truncated responsePreview
      const rawResponse = isParseError ? error.rawResponse : undefined;

      logger.error('research() failed', {
        message: error.message,
        name: error.name,
        stack: error.stack,
        isParseError,
        rawResponse, // Full raw response for debugging - do not truncate
        toolsUsed: toolExecutor?.toolsUsed ?? [],
        turns,
        outerIteration,
      });

      console.error(`[ResearchAgent] Research failed:`, {
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        rawResponse, // Full raw response for debugging
      });

      // Log error to AgentLogger with raw response if available
      this.logger?.logError(error.message, {
        toolsUsed: toolExecutor.toolsUsed,
        sourcesUsed: Array.from(toolExecutor.sourcesUsed),
        turns,
        iterations: outerIteration,
        ...(rawResponse && { rawResponse }),
      });

      const errorReport = `Research failed: ${error.message}`;

      // Store error response
      await this.storeMessage('assistant', errorReport);

      return {
        report: errorReport,
        confidence: 'low',
        sourcesUsed: Array.from(toolExecutor.sourcesUsed),
        toolsUsed: toolExecutor.toolsUsed,
        toolCallDetails: toolExecutor.toolCallDetails,
        turns,
        iterations: outerIteration,
      };
    }
  }

  /**
   * Simple chat method for conversational interaction
   */
  async chat(message: string, history?: ChatMessage[]): Promise<ChatResponse> {
    if (!message) {
      logger.error('chat() called with undefined/null message');
      throw new Error('ResearchAgent.chat() requires a message');
    }
    logger.info('chat() called', { messagePreview: message.substring(0, 50), historyLength: history?.length ?? 0 });

    const result = await this.research(message, history);

    const response = {
      message: result.report,
      toolsUsed: result.toolsUsed,
      sourcesUsed: result.sourcesUsed,
    };

    console.log(`[ResearchAgent] chat() returning:`, {
      messageLength: response.message?.length || 0,
      isEmpty: !response.message || response.message.trim() === '',
      toolsUsed: response.toolsUsed?.length || 0,
    });

    return response;
  }

  /**
   * Set active conversation ID
   */
  setConversationId(conversationId: string): void {
    this.conversationId = conversationId;
  }

  /**
   * Get active conversation ID
   */
  getConversationId(): string | undefined {
    return this.conversationId;
  }

  /**
   * Set callbacks (useful when callbacks need to be updated after construction)
   */
  setCallbacks(callbacks: {
    onToolCall?: (toolName: string, args: Record<string, any>) => void;
    onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
    onThinking?: (reasoning: string) => void;
  }): void {
    if (callbacks.onToolCall) this.onToolCall = callbacks.onToolCall;
    if (callbacks.onToolResult) this.onToolResult = callbacks.onToolResult;
    if (callbacks.onThinking) this.onThinking = callbacks.onThinking;
  }

  /**
   * Get list of available tools
   */
  getTools(): string[] {
    return this.tools.map((t) => t.name);
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a ResearchAgent with appropriate tools
 */
export async function createResearchAgent(options: ResearchAgentOptions): Promise<ResearchAgent> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY or pass apiKey option.');
  }

  const model = options.model || 'gemini-2.0-flash';
  const temperature = options.temperature ?? 0.2;

  // Create LLM providers
  const llmProvider = new GeminiAPIProvider({
    apiKey,
    model,
    temperature,
    maxOutputTokens: 10000, // Increased for comprehensive reports
  });

  const executor = new StructuredLLMExecutor();

  const tools: GeneratedToolDefinition[] = [];
  const handlers: Record<string, (args: Record<string, any>) => Promise<any>> = {};

  // 1. File tools - brain-aware (requires brainManager)
  if (!options.brainManager) {
    throw new Error('ResearchAgent requires brainManager option');
  }
  const brainCtx: BrainToolsContext = {
    brain: options.brainManager,
  };
  const readFileTool = generateBrainReadFileTool();
  tools.push(readFileTool);
  handlers['read_file'] = (args) => generateBrainReadFileHandler(brainCtx)(args as any);

  // 2. FS tools (exploration only)
  const fsCtx: FsToolsContext = {
    projectRoot: options.projectRoot || options.cwd || process.cwd(),
  };
  const fsTools = generateFsTools(fsCtx);

  // Include exploration tools
  for (const toolName of ['list_directory', 'glob_files', 'grep_files', 'search_files', 'file_exists', 'get_file_info']) {
    const tool = fsTools.tools.find((t) => t.name === toolName);
    if (tool) {
      tools.push(tool);
      handlers[toolName] = fsTools.handlers[toolName];
    }
  }

  // 3. Brain tools (brainCtx already defined above)
  // brain_search - wrapped to force glob filter on cwd
  const brainSearchTool = generateBrainSearchTool();
  tools.push(brainSearchTool);
  const brainSearchHandler = generateBrainSearchHandler(brainCtx);

  // Wrap handler to auto-add base_path filter for cwd (filtered in Cypher, more efficient than glob)
  const cwd = options.cwd;
  handlers['brain_search'] = async (args) => {
    // If cwd is set and no base_path is specified, add base_path filter
    if (cwd && !args.base_path) {
      // Normalize: ensure cwd ends without slash
      args.base_path = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
    }
    // Force summarization to reduce context size and focus on relevant info
    args.summarize = true;
    return brainSearchHandler(args as any);
  };

  // ingest_directory
  const ingestTool = generateIngestDirectoryTool();
  tools.push(ingestTool);
  const ingestHandler = generateIngestDirectoryHandler(brainCtx);
  handlers['ingest_directory'] = (args) => ingestHandler(args as any);

  // explore_node - explore relationships of any node by UUID
  const exploreNodeTool = generateExploreNodeTool();
  tools.push(exploreNodeTool);
  const exploreNodeHandler = generateExploreNodeHandler(brainCtx);
  handlers['explore_node'] = (args) => exploreNodeHandler(args as any);

  // read_files - batch read multiple files at once
  const readFilesTool = generateBrainReadFilesTool();
  tools.push(readFilesTool);
  const readFilesHandler = generateBrainReadFilesHandler(brainCtx);
  handlers['read_files'] = (args) => readFilesHandler(args as any);

  // 4. Web tools (optional)
  if (options.includeWebTools) {
    // TODO: Add fetch_web_page tool
    // const webTools = createWebToolHandlers({ geminiApiKey: apiKey });
    // tools.push(fetchWebPageToolDefinition);
    // handlers['fetch_web_page'] = webTools['fetch_web_page'];
  }

  return new ResearchAgent(executor, llmProvider, tools, handlers, {
    maxIterations: options.maxIterations ?? 15,
    verbose: options.verbose ?? false,
    logPath: options.logPath,
    promptsDir: options.promptsDir,
    conversationStorage: options.conversationStorage,
    conversationSummarizer: options.conversationSummarizer,
    embeddingProvider: options.embeddingProvider,
    conversationId: options.conversationId,
    brainManager: options.brainManager,
    projectRoot: options.projectRoot,
    cwd: options.cwd,
    onToolCall: options.onToolCall,
    onToolResult: options.onToolResult,
    onThinking: options.onThinking,
    onReportUpdate: options.onReportUpdate,
  });
}
