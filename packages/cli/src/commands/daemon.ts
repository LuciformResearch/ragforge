/**
 * Brain Daemon Server
 *
 * HTTP API server that keeps BrainManager alive between tool calls.
 * Provides persistent file watchers and faster tool execution.
 *
 * Port: 6969 (configurable via RAGFORGE_DAEMON_PORT)
 * Logs: ~/.ragforge/logs/daemon.log
 *
 * @since 2025-12-08
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { access } from 'fs/promises';
import {
  BrainManager,
  generateBrainToolHandlers,
  generateSetupToolHandlers,
  generateImageTools,
  generate3DTools,
  generateAgentToolHandlers,
  generateAllDebugHandlers,
  createWebToolHandlers,
  getLocalTimestamp,
  getFilenameTimestamp,
  createRagAgent,
  createResearchAgent,
  createClient,
  ConversationStorage,
  GeminiEmbeddingProvider,
  StructuredLLMExecutor,
  GeminiAPIProvider,
  type BrainToolsContext,
  type ImageToolsContext,
  type ThreeDToolsContext,
  type AgentToolsContext,
  type DebugToolsContext,
  type WebToolsContext,
  type RagAgentOptions,
  type ResearchAgent,
} from '@luciformresearch/ragforge';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PORT = 6969;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const LOG_DIR = path.join(os.homedir(), '.ragforge', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'daemon.log');
const PID_FILE = path.join(os.homedir(), '.ragforge', 'daemon.pid');

// ============================================================================
// Logger
// ============================================================================

type LogSubscriber = (line: string) => void;

class DaemonLogger {
  private logStream: fs.FileHandle | null = null;
  private buffer: string[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;

  // SSE subscribers for real-time log streaming
  private subscribers: Set<LogSubscriber> = new Set();

  constructor() {
    // Save original console methods
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
  }

  /**
   * Subscribe to log events (for SSE streaming)
   */
  subscribe(callback: LogSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of a new log line
   */
  private notifySubscribers(line: string): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(line);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  async initialize(): Promise<void> {
    await fs.mkdir(LOG_DIR, { recursive: true });
    this.logStream = await fs.open(LOG_FILE, 'a');

    // Intercept all console output and redirect to log file
    this.interceptConsole();

    // Flush buffer every second
    this.flushInterval = setInterval(() => this.flush(), 1000);

    this.info('='.repeat(60));
    this.info('Brain Daemon starting...');
    this.info(`PID: ${process.pid}`);
    this.info(`Log file: ${LOG_FILE}`);
  }

  /**
   * Safely write to original console, ignoring EPIPE errors
   * (happens when stdout/stderr is closed, e.g. parent terminal closed)
   */
  private safeConsoleWrite(fn: (...args: any[]) => void, ...args: any[]): void {
    try {
      fn(...args);
    } catch (err: any) {
      // Ignore EPIPE errors - stdout/stderr is closed
      if (err?.code !== 'EPIPE' && err?.message !== 'write EPIPE') {
        // Re-throw other errors
        throw err;
      }
    }
  }

  /**
   * Serialize an argument for logging, handling Errors specially
   */
  private serializeArg(a: any): string {
    if (typeof a === 'string') return a;
    if (a instanceof Error) {
      // Errors don't serialize with JSON.stringify, handle them specially
      return a.stack || `${a.name}: ${a.message}`;
    }
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }

  /**
   * Intercept console.log/error/warn and redirect to log file
   * This captures all output from BrainManager and other modules
   */
  private interceptConsole(): void {
    const self = this;

    console.log = (...args: any[]) => {
      const message = args.map(a => self.serializeArg(a)).join(' ');
      self.writeRaw(message);
      // Force flush for important debug logs (extract_agent_prompt, ConversationStorage, etc.)
      if (message.includes('[extract_agent_prompt]') || message.includes('[ConversationStorage]') || message.includes('buildEnrichedContext')) {
        self.flush();
      }
      // Also write to stdout in verbose mode
      if (process.env.RAGFORGE_DAEMON_VERBOSE) {
        self.safeConsoleWrite(self.originalConsoleLog, ...args);
      }
    };

    console.error = (...args: any[]) => {
      const message = args.map(a => self.serializeArg(a)).join(' ');
      self.writeRaw(`[ERROR] ${message}`);
      // Always write errors to stderr (but ignore EPIPE)
      self.safeConsoleWrite(self.originalConsoleError, ...args);
    };

    console.warn = (...args: any[]) => {
      const message = args.map(a => self.serializeArg(a)).join(' ');
      self.writeRaw(`[WARN] ${message}`);
      if (process.env.RAGFORGE_DAEMON_VERBOSE) {
        self.safeConsoleWrite(self.originalConsoleWarn, ...args);
      }
    };
  }

  /**
   * Write raw message (from intercepted console) with timestamp
   */
  private writeRaw(message: string): void {
    const timestamp = getLocalTimestamp();
    const formatted = `[${timestamp}] ${message}\n`;
    this.buffer.push(formatted);
    // Notify SSE subscribers
    this.notifySubscribers(formatted);
    // Force flush for important debug logs (extract_agent_prompt, ConversationStorage, etc.)
    if (message.includes('[extract_agent_prompt]') || message.includes('[ConversationStorage]') || message.includes('buildEnrichedContext') || message.includes('searchCodeFuzzyWithLLM')) {
      this.flush();
    }
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = getLocalTimestamp();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
  }

  private write(level: string, message: string, meta?: any): void {
    const formatted = this.formatMessage(level, message, meta);
    this.buffer.push(formatted);
    // Notify SSE subscribers
    this.notifySubscribers(formatted);
    // Force flush for important logs (errors, warnings, tool calls)
    if (level === 'ERROR' || level === 'WARN' || message.includes('Tool call:') || (message.includes('Tool ') && message.includes('completed'))) {
      this.flush();
    }

    // Also write to console in dev mode
    if (process.env.RAGFORGE_DAEMON_VERBOSE) {
      this.safeConsoleWrite(this.originalConsoleLog, formatted.trim());
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.logStream) return;

    const content = this.buffer.join('');
    this.buffer = [];
    await this.logStream.write(content);
  }

  info(message: string, meta?: any): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: any): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: any): void {
    this.write('error', message, meta);
    // Flush immediately on error
    this.flush();
  }

  debug(message: string, meta?: any): void {
    if (process.env.RAGFORGE_DAEMON_DEBUG) {
      this.write('debug', message, meta);
    }
  }

  async close(): Promise<void> {
    // Restore original console methods
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    if (this.logStream) {
      await this.logStream.close();
    }
  }
}

// ============================================================================
// Daemon Server
// ============================================================================

class BrainDaemon {
  private server: FastifyInstance;
  private brain: BrainManager | null = null;
  private toolHandlers: Record<string, (params: any) => Promise<any>> = {};
  private logger: DaemonLogger;
  private idleTimer: NodeJS.Timeout | null = null;
  private startTime: Date;
  private requestCount: number = 0;
  private lastActivity: Date;
  // Agent conversation state (shared across all agent tool calls)
  private currentConversationId: string | undefined = undefined;
  // Research Agent for chat interface
  private researchAgent: ResearchAgent | null = null;
  private researchAgentConversationId: string | undefined = undefined;

  /**
   * Sanitize tool arguments for logging:
   * - Hide sensitive fields (apiKey, password, token, secret, etc.)
   * - Truncate long strings/arrays
   * - Limit object depth
   */
  private sanitizeToolArgs(args: any, maxDepth: number = 3, maxStringLength: number = 200, maxArrayLength: number = 10): any {
    if (maxDepth <= 0) {
      return '[Max depth reached]';
    }

    if (args === null || args === undefined) {
      return args;
    }

    if (typeof args === 'string') {
      // Check for sensitive patterns
      if (/(password|api[_-]?key|token|secret|auth|credential)/i.test(args)) {
        return '[REDACTED]';
      }
      return args.length > maxStringLength ? args.substring(0, maxStringLength) + '...' : args;
    }

    if (typeof args === 'number' || typeof args === 'boolean') {
      return args;
    }

    if (Array.isArray(args)) {
      if (args.length > maxArrayLength) {
        return [
          ...args.slice(0, maxArrayLength).map(item => this.sanitizeToolArgs(item, maxDepth - 1, maxStringLength, maxArrayLength)),
          `[${args.length - maxArrayLength} more items]`
        ];
      }
      return args.map(item => this.sanitizeToolArgs(item, maxDepth - 1, maxStringLength, maxArrayLength));
    }

    if (typeof args === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(args)) {
        // Hide sensitive keys
        if (/(password|api[_-]?key|token|secret|auth|credential|private)/i.test(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitizeToolArgs(value, maxDepth - 1, maxStringLength, maxArrayLength);
        }
      }
      return sanitized;
    }

    return String(args);
  }

  /**
   * Write brain_search results as raw JSON - exact output the agent receives
   */
  private async writeBrainSearchDetails(query: string, args: any, result: any): Promise<string> {
    const timestamp = getFilenameTimestamp();
    const filename = `brain_search_${timestamp}.json`;
    const filepath = path.join(LOG_DIR, filename);

    // Write exact raw JSON output - what the agent sees
    const output = {
      timestamp: getLocalTimestamp(),
      args,
      result,
    };

    await fs.writeFile(filepath, JSON.stringify(output, null, 2), 'utf-8');
    return filepath;
  }

  /**
   * Create a readable summary of tool results for logging
   */
  private summarizeResult(toolName: string, result: any): Record<string, any> {
    if (!result || typeof result !== 'object') {
      return { result_preview: result };
    }

    // brain_search specific summary - now just a quick overview
    // Full details are in separate log file
    if (toolName === 'brain_search' && result.results) {
      const summaryList = result.results.slice(0, 5).map((r: any, i: number) => {
        const node = r.node || {};
        const name = node.name || node.title || '?';
        const type = node.type || (node.level !== undefined ? 'sec' : node.code !== undefined ? 'code' : 'file');
        const score = r.score?.toFixed(2) ?? '?';
        const hasContent = !!(node.content || node.code || node.text);
        return `${i + 1}.[${score}] ${name} (${type})${hasContent ? ' ✓' : ' ✗'}`;
      });
      if (result.results.length > 5) {
        summaryList.push(`... +${result.results.length - 5} more`);
      }
      return {
        count: result.totalCount || result.results.length,
        results: summaryList,
        detail_log: '(see brain_search_*.log)',
      };
    }

    // read_file specific summary
    if (toolName === 'read_file' && typeof result.content === 'string') {
      return {
        lines: result.content.split('\n').length,
        size: result.content.length,
      };
    }

    // ingest_directory summary
    if (toolName === 'ingest_directory' && result.stats) {
      return {
        files: result.stats.filesProcessed,
        scopes: result.stats.scopesCreated,
        duration_ms: result.stats.duration,
      };
    }

    // Default: use sanitized preview with more depth
    return { result_preview: this.sanitizeToolArgs(result, 3, 100, 3) };
  }

  constructor() {
    this.logger = new DaemonLogger();
    this.startTime = new Date();
    this.lastActivity = new Date();

    this.server = Fastify({
      logger: false, // We use our own logger
    });
  }

  async initialize(): Promise<void> {
    await this.logger.initialize();

    // Register CORS for dashboard access
    await this.server.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'DELETE'],
    });

    // Setup routes
    this.setupRoutes();

    // Setup error handlers
    this.setupErrorHandlers();

    // Initialize BrainManager (this will load ~/.ragforge/.env)
    await this.initializeBrain();

    // Reset idle timer on each request
    this.server.addHook('onRequest', async () => {
      this.resetIdleTimer();
      this.requestCount++;
      this.lastActivity = new Date();
    });

    this.logger.info('Daemon initialized successfully');
  }

  private async initializeBrain(): Promise<void> {
    try {
      this.logger.info('Initializing BrainManager...');
      this.brain = await BrainManager.getInstance();
      await this.brain.initialize();
      this.logger.info('BrainManager ready');

      // Generate tool handlers
      this.logger.info('Generating tool handlers...');
      const brainCtx: BrainToolsContext = { brain: this.brain };
      const imageCtx: ImageToolsContext = {
        projectRoot: process.cwd(),
        onContentExtracted: async (params) => {
          return await this.brain!.updateMediaContent(params);
        },
      };
      const threeDCtx: ThreeDToolsContext = {
        projectRoot: process.cwd(),
        onContentExtracted: async (params) => {
          return await this.brain!.updateMediaContent(params);
        },
      };

      const brainHandlers = generateBrainToolHandlers(brainCtx);
      const setupHandlers = generateSetupToolHandlers(brainCtx);
      const imageTools = generateImageTools(imageCtx);
      const threeDTools = generate3DTools(threeDCtx);

      // Generate agent tool handlers
      // Create local brain handlers for agent (direct calls to daemon's brain handlers)
      const localBrainHandlers: Record<string, (params: any) => Promise<any>> = {};
      for (const [toolName, handler] of Object.entries(brainHandlers)) {
        localBrainHandlers[toolName] = handler;
      }
      for (const [toolName, handler] of Object.entries(setupHandlers)) {
        localBrainHandlers[toolName] = handler;
      }

      // Try to find config file in current working directory
      const cwd = process.cwd();
      const possibleConfigPaths = [
        path.join(cwd, '.ragforge', 'ragforge.config.yaml'),
        path.join(cwd, 'ragforge.config.yaml'),
      ];
      let configPath: string | undefined = undefined;
      for (const possiblePath of possibleConfigPaths) {
        try {
          await access(possiblePath);
          configPath = possiblePath;
          break;
        } catch {
          // File doesn't exist, try next
        }
      }

      // Create minimal config for standalone mode if no config found
      // This allows agent tools to work even without a project-specific config
      const standaloneConfig = configPath ? undefined : {
        name: 'ragforge-daemon',
        version: '1.0.0',
        entities: [],
        neo4j: {
          uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
          username: process.env.NEO4J_USERNAME || 'neo4j',
          password: process.env.NEO4J_PASSWORD || 'password',
          database: process.env.NEO4J_DATABASE || 'neo4j',
        },
      };

      // Create minimal RagClient for standalone mode
      const standaloneRagClient = configPath ? undefined : createClient({
        neo4j: {
          uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
          username: process.env.NEO4J_USERNAME || 'neo4j',
          password: process.env.NEO4J_PASSWORD || 'password',
          database: process.env.NEO4J_DATABASE || 'neo4j',
        },
      });

      // Create ConversationStorage for enriched context (fuzzy search)
      // This enables fuzzy search in extract_agent_prompt
      const neo4jClient = this.brain.getNeo4jClient();
      
      // Create embedding provider for conversation memory (semantic search)
      // Get API key from BrainManager config (loaded from ~/.ragforge/.env) or process.env
      const brainConfig = this.brain.getConfig();
      const geminiApiKey = process.env.GEMINI_API_KEY || brainConfig.apiKeys.gemini;
      
      // Set in process.env if not already set (for other parts of the code that use process.env)
      if (brainConfig.apiKeys.gemini && !process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = brainConfig.apiKeys.gemini;
        this.logger.debug('Loaded GEMINI_API_KEY from BrainManager config');
      }
      
      let embeddingProvider: GeminiEmbeddingProvider | undefined;
      if (geminiApiKey && neo4jClient) {
        try {
          embeddingProvider = new GeminiEmbeddingProvider({
            apiKey: geminiApiKey,
            model: 'gemini-embedding-001',
            dimension: 3072, // Native dimension for gemini-embedding-001 (best quality)
          });
          this.logger.info('Embedding provider configured for conversation memory');
        } catch (error: any) {
          this.logger.warn(`Failed to create embedding provider: ${error.message}`);
        }
      } else {
        this.logger.warn('GEMINI_API_KEY not set - conversation semantic search will be disabled');
      }
      
      const conversationStorage = neo4jClient
        ? new ConversationStorage(neo4jClient, undefined, embeddingProvider)
        : undefined;

      // Set BrainManager for semantic search (isProjectKnown, getProjectsInCwd, locks)
      if (conversationStorage && this.brain) {
        conversationStorage.setBrainManager(this.brain);
      }

      // Set LLMExecutor and LLMProvider for fuzzy search fallback (needed for debug_context and buildEnrichedContext)
      if (conversationStorage && geminiApiKey) {
        const llmExecutor = new StructuredLLMExecutor();
        const llmProvider = new GeminiAPIProvider({
          apiKey: geminiApiKey,
          model: 'gemini-2.0-flash',
          temperature: 0.1,
        });
        conversationStorage.setLLMExecutor(llmExecutor, llmProvider);
        this.logger.debug('ConversationStorage configured with LLMExecutor for fuzzy search');
      }

      const self = this; // Capture 'this' for use in closures
      const agentCtx: AgentToolsContext = {
        createAgent: async (options: RagAgentOptions) => {
          // Create agent with default options, using local brain handlers
          return await createRagAgent({
            ...options,
            // Use provided configPath, or found configPath, or standalone config
            configPath: options.configPath || configPath,
            config: options.config || (configPath ? undefined : standaloneConfig),
            ragClient: options.ragClient || standaloneRagClient,
            includeBrainTools: true,
            customBrainHandlers: localBrainHandlers,
            // Add ConversationStorage for enriched context (fuzzy search)
            conversationStorage: options.conversationStorage || conversationStorage,
            // Add BrainManager for locks
            brainManager: options.brainManager || self.brain,
            // Use current working directory as project root
            projectRoot: () => process.cwd(),
          });
        },
        // Use function to always read current value (not captured at creation time)
        currentConversationId: () => {
          const id = self.currentConversationId;
          self.logger.debug(`Reading currentConversationId: ${id || 'undefined'}`);
          return id;
        },
        setConversationId: (id: string | undefined) => {
          self.currentConversationId = id;
          self.logger.info(`Conversation ID updated: ${id || 'undefined'}`);
        },
        defaultAgentOptions: {
          configPath,
          config: standaloneConfig,
          ragClient: standaloneRagClient,
          conversationStorage,
          brainManager: this.brain,
          apiKey: process.env.GEMINI_API_KEY || brainConfig.apiKeys.gemini,
          model: 'gemini-2.0-flash',
          verbose: false,
          includeFileTools: true,
          includeProjectTools: true,
          includeBrainTools: true,
          customBrainHandlers: localBrainHandlers,
          includeFsTools: true,
          includeShellTools: true,
          includeContextTools: true,
          includeWebTools: !!process.env.GEMINI_API_KEY,
          projectRoot: () => process.cwd(),
        },
      };
      const agentHandlers = generateAgentToolHandlers(agentCtx);

      // Generate debug tools handlers (for conversation memory debugging)
      // Note: locks are now fetched from brainManager internally by buildEnrichedContext
      const debugCtx: DebugToolsContext = {
        conversationStorage: conversationStorage!,
        cwd: () => process.cwd(),
        projectRoot: () => process.cwd(),
      };
      const debugHandlers = conversationStorage
        ? generateAllDebugHandlers(debugCtx)
        : {};

      // Generate web tools handlers (search_web, fetch_web_page)
      const webToolsCtx: WebToolsContext = {
        geminiApiKey: process.env.GEMINI_API_KEY,
        playwrightAvailable: true,
        ingestWebPage: async (params) => {
          if (!this.brain) return { success: false };
          try {
            await this.brain.ingestWebPage({
              url: params.url,
              title: params.title,
              textContent: params.textContent,
              rawHtml: params.rawHtml,
              projectName: params.projectName,
            });
            return { success: true };
          } catch (err) {
            return { success: false };
          }
        },
      };
      const webToolHandlers = createWebToolHandlers(webToolsCtx);

      this.toolHandlers = {
        ...brainHandlers,
        ...setupHandlers,
        ...imageTools.handlers,
        ...threeDTools.handlers,
        ...agentHandlers,
        ...debugHandlers,
        ...webToolHandlers,
      };

      this.logger.info(`${Object.keys(this.toolHandlers).length} tools ready (including ${Object.keys(debugHandlers).length} debug tools)`);

      // Auto-start watchers for projects related to cwd
      await this.autoStartWatchersForCwd();
    } catch (error: any) {
      this.logger.error('Failed to initialize BrainManager', { error: error.message });
      throw error;
    }
  }

  /**
   * Auto-start watchers for projects related to the current working directory.
   * This includes:
   * - Projects where cwd is inside the project path
   * - Projects where the project path is inside cwd
   * - Projects where cwd exactly matches the project path
   */
  private async autoStartWatchersForCwd(): Promise<void> {
    if (!this.brain) return;

    const cwd = process.cwd();
    const projects = await this.brain.listProjects();

    const matchingProjects: Array<{ id: string; path: string }> = [];

    for (const project of projects) {
      if (!project.path) continue;

      // Normalize paths for comparison
      const projectPath = path.resolve(project.path);
      const cwdPath = path.resolve(cwd);

      // Check if cwd is inside project, project is inside cwd, or exact match
      const cwdInProject = cwdPath.startsWith(projectPath + path.sep) || cwdPath === projectPath;
      const projectInCwd = projectPath.startsWith(cwdPath + path.sep);
      const exactMatch = cwdPath === projectPath;

      if (cwdInProject || projectInCwd || exactMatch) {
        matchingProjects.push({ id: project.id, path: project.path });
      }
    }

    if (matchingProjects.length === 0) {
      this.logger.debug(`No projects match cwd: ${cwd}`);
      return;
    }

    this.logger.info(`Auto-starting watchers for ${matchingProjects.length} project(s) related to cwd`);

    for (const project of matchingProjects) {
      try {
        await this.brain.startWatching(project.path);
        this.logger.info(`  ✓ Started watcher for: ${project.id}`);
      } catch (error: any) {
        this.logger.warn(`  ✗ Failed to start watcher for ${project.id}: ${error.message}`);
      }
    }
  }

  /**
   * Ensure BrainManager is initialized - auto-init if needed
   * Call this at the start of any endpoint that needs the brain
   */
  private async ensureBrain(): Promise<BrainManager> {
    if (!this.brain) {
      this.logger.info('Brain not initialized, initializing now...');
      await this.initializeBrain();
    }
    return this.brain!;
  }

  /**
   * Ensure watcher is running for a file's project (fire-and-forget)
   * Called before tool execution to auto-start watchers for known projects
   */
  private ensureWatcherForFile(args: Record<string, any>): void {
    if (!this.brain) return;

    // Extract file path from common arg names
    const filePath = args?.path || args?.file_path || args?.image_path || args?.model_path;
    if (!filePath || typeof filePath !== 'string') return;

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    // Find project for this path
    const project = this.brain.findProjectForFile(absolutePath);
    if (!project) return;

    // Check if watcher is already running
    if (this.brain.isWatching(project.path)) return;

    // Start watcher (fire-and-forget)
    this.brain.startWatching(project.path)
      .then(() => {
        this.logger.info(`Auto-started watcher for project: ${project.id}`);
      })
      .catch((err: any) => {
        this.logger.debug(`Auto-watcher failed for ${project.id}: ${err.message}`);
      });
  }

  private setupRoutes(): void {
    // Health check
    this.server.get('/health', async () => {
      return { status: 'ok', timestamp: getLocalTimestamp() };
    });

    // Daemon status (enriched for DaemonBrainProxy cache)
    this.server.get('/status', async () => {
      const brain = await this.ensureBrain();
      const uptime = Date.now() - this.startTime.getTime();
      const watchers = brain.getWatchedProjects();
      const projects = brain.listProjects();
      const ingestionLock = brain.getIngestionLock();
      const embeddingLock = brain.getEmbeddingLock();
      const ingestionStatus = ingestionLock.getStatus();
      const embeddingStatus = embeddingLock.getStatus();
      const pendingEdits = brain.getPendingEditCount();
      const brainPath = brain.getBrainPath();
      const config = brain.getConfig();

      return {
        status: 'running',
        pid: process.pid,
        port: DEFAULT_PORT,
        uptime_ms: uptime,
        uptime_human: this.formatUptime(uptime),
        started_at: getLocalTimestamp(this.startTime),
        last_activity: getLocalTimestamp(this.lastActivity),
        request_count: this.requestCount,
        idle_timeout_ms: IDLE_TIMEOUT_MS,
        brain: {
          connected: !!this.brain,
          projects,
          watchers,
          ingestion_status: ingestionStatus,
          embedding_status: embeddingStatus,
          pending_edits: pendingEdits,
          brain_path: brainPath,
          config,
        },
        tools: {
          count: Object.keys(this.toolHandlers).length,
        },
        memory: {
          rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
      };
    });

    // List projects
    this.server.get('/projects', async () => {
      const brain = await this.ensureBrain();
      return { projects: brain.listProjects() };
    });

    // List watchers
    this.server.get('/watchers', async () => {
      const brain = await this.ensureBrain();
      return { watchers: brain.getWatchedProjects() };
    });

    // List available tools
    this.server.get('/tools', async () => {
      await this.ensureBrain(); // Ensure handlers are generated
      return {
        tools: Object.keys(this.toolHandlers).sort(),
        count: Object.keys(this.toolHandlers).length,
      };
    });

    // Call a tool
    this.server.post<{
      Params: { toolName: string };
      Body: Record<string, any>;
    }>('/tool/:toolName', async (request, reply) => {
      const { toolName } = request.params;
      const args = request.body || {};

      // Log tool call with sanitized arguments (hide sensitive data, truncate long values)
      const sanitizedArgs = this.sanitizeToolArgs(args);
      this.logger.info(`Tool call: ${toolName}`, { args: sanitizedArgs });

      try {
        // Ensure brain and handlers are ready
        await this.ensureBrain();

        const handler = this.toolHandlers[toolName];
        if (!handler) {
          this.logger.warn(`Unknown tool: ${toolName}`);
          reply.status(404);
          return {
            success: false,
            error: `Unknown tool: ${toolName}`,
            available_tools: Object.keys(this.toolHandlers).sort(),
          };
        }

        // Auto-start watcher for file's project (fire-and-forget, non-blocking)
        this.ensureWatcherForFile(args);

        const startTime = Date.now();
        const result = await handler(args);
        const duration = Date.now() - startTime;

        // Write detailed brain_search log (fire-and-forget)
        if (toolName === 'brain_search' && result?.results) {
          this.writeBrainSearchDetails(args.query, args, result)
            .then(filepath => this.logger.debug(`brain_search details: ${filepath}`))
            .catch(err => this.logger.warn(`Failed to write brain_search details: ${err.message}`));
        }

        // Log completion with result summary
        const resultSummary = this.summarizeResult(toolName, result);
        this.logger.info(`Tool ${toolName} completed in ${duration}ms`, {
          result_size: typeof result === 'string' ? result.length : JSON.stringify(result).length,
          ...resultSummary
        });
        return { success: true, result, duration_ms: duration };
      } catch (error: any) {
        this.logger.error(`Tool ${toolName} failed`, {
          error: error.message,
          stack: error.stack,
        });
        reply.status(500);
        return { success: false, error: error.message };
      }
    });

    // Graceful shutdown
    this.server.post('/shutdown', async () => {
      this.logger.info('Shutdown requested via API');

      // Schedule shutdown after response
      setTimeout(() => this.shutdown(), 100);

      return { status: 'shutting_down' };
    });

    // Queue file change (for agent processes to notify daemon)
    this.server.post<{
      Body: { path: string; change_type: 'created' | 'updated' | 'deleted' };
    }>('/queue-file-change', async (request, reply) => {
      const { path: filePath, change_type } = request.body || {};

      if (!filePath || !change_type) {
        reply.status(400);
        return { success: false, error: 'Missing path or change_type' };
      }

      const brain = await this.ensureBrain();
      this.logger.debug(`Queue file change: ${change_type} ${filePath}`);
      brain.queueFileChange(filePath, change_type);
      return { success: true };
    });

    // ============================================
    // Brain Callback Endpoints (for MCP server proxy)
    // ============================================

    // Ingest web page content
    this.server.post<{
      Body: {
        url: string;
        title?: string;
        textContent?: string;
        rawHtml?: string;
        projectName?: string;
        generateEmbeddings?: boolean;
      };
    }>('/brain/ingest-web-page', async (request, reply) => {
      const { url, title, textContent, rawHtml, projectName, generateEmbeddings } = request.body || {};

      if (!url) {
        reply.status(400);
        return { success: false, error: 'Missing url' };
      }

      const brain = await this.ensureBrain();
      this.logger.debug(`Ingest web page: ${url}`);

      try {
        const result = await brain.ingestWebPage({
          url,
          title: title || url,
          textContent: textContent || '',
          rawHtml: rawHtml || '',
          projectName,
          generateEmbeddings: generateEmbeddings ?? true,
        });
        return { success: true, nodeId: result.nodeId };
      } catch (err: any) {
        this.logger.error(`Web page ingestion failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Update media content (images, 3D models, documents)
    this.server.post<{
      Body: {
        filePath: string;
        textContent?: string;
        description?: string;
        ocrConfidence?: number;
        extractionMethod?: string;
        generateEmbeddings?: boolean;
        sourceFiles?: string[];
      };
    }>('/brain/update-media-content', async (request, reply) => {
      const { filePath, textContent, description, ocrConfidence, extractionMethod, generateEmbeddings, sourceFiles } = request.body || {};

      if (!filePath) {
        reply.status(400);
        return { success: false, error: 'Missing filePath' };
      }

      const brain = await this.ensureBrain();
      this.logger.debug(`Update media content: ${filePath}`);

      try {
        await brain.updateMediaContent({
          filePath,
          textContent,
          description,
          ocrConfidence,
          extractionMethod,
          generateEmbeddings: generateEmbeddings ?? true,
          sourceFiles,
        });
        return { success: true, updated: true };
      } catch (err: any) {
        this.logger.error(`Media content update failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // ============================================
    // Persona Management Endpoints
    // ============================================

    // Get active persona
    this.server.get('/persona/active', async () => {
      const brain = await this.ensureBrain();
      return brain.getActivePersona();
    });

    // List all personas
    this.server.get('/persona/list', async () => {
      const brain = await this.ensureBrain();
      return { personas: brain.listPersonas() };
    });

    // Set active persona
    this.server.post<{
      Body: { identifier: string | number };
    }>('/persona/set', async (request, reply) => {
      const brain = await this.ensureBrain();
      const { identifier } = request.body || {};
      if (identifier === undefined) {
        reply.status(400);
        return { error: 'Missing identifier (name, id, or index)' };
      }
      try {
        const persona = await brain.setActivePersona(identifier);
        return persona;
      } catch (err: any) {
        reply.status(400);
        return { error: err.message };
      }
    });

    // Create enhanced persona
    this.server.post<{
      Body: { name: string; color: string; language: string; description: string };
    }>('/persona/create', async (request, reply) => {
      const brain = await this.ensureBrain();
      const { name, color, language, description } = request.body || {};
      if (!name || !color || !language || !description) {
        reply.status(400);
        return { error: 'Missing required fields: name, color, language, description' };
      }
      try {
        const persona = await brain.createEnhancedPersona({
          name,
          color: color as any,
          language,
          description,
        });
        return persona;
      } catch (err: any) {
        reply.status(400);
        return { error: err.message };
      }
    });

    // Delete persona
    this.server.post<{
      Body: { name: string };
    }>('/persona/delete', async (request, reply) => {
      const brain = await this.ensureBrain();
      const { name } = request.body || {};
      if (!name) {
        reply.status(400);
        return { error: 'Missing name' };
      }
      try {
        await brain.deletePersona(name);
        return { success: true };
      } catch (err: any) {
        reply.status(400);
        return { error: err.message };
      }
    });

    // View recent logs
    this.server.get<{
      Querystring: { lines?: string };
    }>('/logs', async (request) => {
      const lines = parseInt(request.query.lines || '100', 10);

      try {
        const content = await fs.readFile(LOG_FILE, 'utf-8');
        const allLines = content.trim().split('\n');
        const recentLines = allLines.slice(-lines);
        return {
          log_file: LOG_FILE,
          total_lines: allLines.length,
          returned_lines: recentLines.length,
          logs: recentLines
        };
      } catch {
        return { logs: [], error: 'Could not read log file' };
      }
    });

    // Stream logs via SSE (Server-Sent Events)
    this.server.get<{
      Querystring: { tail?: string };
    }>('/logs/stream', async (request, reply) => {
      const tailLines = parseInt(request.query.tail || '50', 10);

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Send initial tail of existing logs
      try {
        const content = await fs.readFile(LOG_FILE, 'utf-8');
        const allLines = content.trim().split('\n');
        const recentLines = allLines.slice(-tailLines);
        for (const line of recentLines) {
          reply.raw.write(`data: ${line}\n\n`);
        }
      } catch {
        // Ignore if file doesn't exist yet
      }

      // Subscribe to new log lines
      const unsubscribe = this.logger.subscribe((line) => {
        try {
          // SSE format: data: <content>\n\n
          reply.raw.write(`data: ${line.trim()}\n\n`);
        } catch {
          // Client disconnected
          unsubscribe();
        }
      });

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat\n\n`);
        } catch {
          // Client disconnected
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15000);

      // Cleanup on client disconnect
      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        this.logger.debug('SSE client disconnected');
      });

      // Don't end the response - keep it open for streaming
      // Fastify will handle this with the raw response
    });

    // ============================================
    // Research Agent Chat Endpoint (SSE streaming)
    // ============================================

    // Chat with Research Agent
    this.server.post<{
      Body: { message: string; conversationId?: string; cwd?: string };
    }>('/agent/chat', async (request, reply) => {
      const { message, conversationId, cwd } = request.body || {};

      if (!message) {
        reply.status(400);
        return { success: false, error: 'Missing message' };
      }

      // Use provided cwd or fallback to process.cwd()
      const workingDir = cwd || process.cwd();

      this.logger.info(`Agent chat: ${message.substring(0, 100)}...`, {
        conversationId: conversationId || 'new',
        cwd: workingDir,
      });

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      try {
        // Ensure brain is initialized
        const brain = await this.ensureBrain();

        // Create or reuse ResearchAgent
        if (!this.researchAgent || (conversationId && conversationId !== this.researchAgentConversationId)) {
          // Get API key
          const brainConfig = brain.getConfig();
          const apiKey = process.env.GEMINI_API_KEY || brainConfig.apiKeys.gemini;

          if (!apiKey) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: 'GEMINI_API_KEY not configured' })}\n\n`);
            reply.raw.end();
            return;
          }

          // Generate log path for agent session
          const agentLogDir = path.join(LOG_DIR, 'agent-sessions');
          await fs.mkdir(agentLogDir, { recursive: true });
          const agentLogPath = path.join(agentLogDir, `session-${getFilenameTimestamp()}.json`);

          this.researchAgent = await createResearchAgent({
            apiKey,
            model: 'gemini-2.0-flash',
            conversationId: conversationId || undefined,
            brainManager: brain,
            cwd: workingDir,
            verbose: !!process.env.RAGFORGE_DAEMON_VERBOSE,
            logPath: agentLogPath,
            onToolCall: (name, args) => {
              this.logger.debug(`Agent tool call: ${name}`);
              try {
                reply.raw.write(`data: ${JSON.stringify({ type: 'tool_call', name, args: this.sanitizeToolArgs(args) })}\n\n`);
              } catch {}
            },
            onToolResult: (name, result, success, duration) => {
              this.logger.debug(`Agent tool result: ${name} (${duration}ms)`);
              const summary = this.summarizeResult(name, result);
              try {
                reply.raw.write(`data: ${JSON.stringify({ type: 'tool_result', name, success, duration, summary })}\n\n`);
              } catch {}
            },
            onThinking: (thought) => {
              if (thought) {
                try {
                  reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: thought.substring(0, 500) })}\n\n`);
                } catch {}
              }
            },
            onReportUpdate: (report, confidence, missingInfo) => {
              try {
                reply.raw.write(`data: ${JSON.stringify({ type: 'report_update', report, confidence, missingInfo })}\n\n`);
              } catch {}
            },
          });

          this.researchAgentConversationId = this.researchAgent.getConversationId();
          this.logger.info(`Created ResearchAgent with conversation: ${this.researchAgentConversationId}`);
        }

        // Send message to agent
        const chatStartTime = Date.now();
        this.logger.info(`[Agent] Starting chat...`);

        const response = await this.researchAgent.chat(message);

        const chatDuration = Date.now() - chatStartTime;
        const responseLength = response.message?.length || 0;
        const isEmpty = !response.message || response.message.trim() === '' || response.message === 'No report generated';

        this.logger.info(`[Agent] Chat completed`, {
          duration: `${chatDuration}ms`,
          responseLength,
          isEmpty,
          toolsUsed: response.toolsUsed?.length || 0,
          sourcesUsed: response.sourcesUsed?.length || 0,
          preview: response.message?.substring(0, 100) || '(empty)',
        });

        // Warn if response is empty
        if (isEmpty) {
          this.logger.warn(`[Agent] Empty or default response received`, {
            fullMessage: response.message,
          });
        }

        // Send final response
        reply.raw.write(`data: ${JSON.stringify({
          type: 'response',
          conversationId: this.researchAgentConversationId,
          content: response.message,
          toolsUsed: response.toolsUsed || [],
          sourcesUsed: response.sourcesUsed || [],
        })}\n\n`);

        // Send done event
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        reply.raw.end();

        this.logger.info(`[Agent] Response sent to client`);

      } catch (error: any) {
        this.logger.error(`[Agent] Chat error: ${error.message}`, {
          stack: error.stack,
          errorName: error.name,
          errorCode: error.code,
        });
        try {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          reply.raw.end();
        } catch (writeError: any) {
          this.logger.error(`[Agent] Failed to send error to client: ${writeError.message}`);
        }
      }
    });

    // List conversations
    this.server.get('/agent/conversations', async () => {
      const brain = await this.ensureBrain();
      const neo4jClient = brain.getNeo4jClient();

      if (!neo4jClient) {
        return { conversations: [] };
      }

      try {
        // Query conversations from Neo4j
        const result = await neo4jClient.run(`
          MATCH (c:Conversation)
          RETURN c.id as id, c.title as title, c.updatedAt as updatedAt
          ORDER BY c.updatedAt DESC
          LIMIT 50
        `);

        const conversations = result.records.map((record: any) => ({
          id: record.get('id'),
          title: record.get('title') || 'Untitled',
          updatedAt: record.get('updatedAt'),
        }));

        return { conversations };
      } catch (err: any) {
        this.logger.warn(`Failed to list conversations: ${err.message}`);
        return { conversations: [] };
      }
    });

    // Get current research report (for debugging - shows report being built)
    this.server.get('/agent/report', async () => {
      if (!this.researchAgent) {
        return {
          hasAgent: false,
          report: null,
          conversationId: null,
        };
      }

      // Get the report content from the agent's internal state
      // Note: This requires the agent to expose report state, which we'll need to add
      return {
        hasAgent: true,
        conversationId: this.researchAgentConversationId,
        // The ResearchAgent uses a ReportEditor internally via ResearchToolExecutor
        // We need to expose this - for now return what we know
        message: 'Use /agent/chat SSE stream for real-time report updates',
      };
    });

    // Start a research task in background (returns immediately, check logs for progress)
    this.server.post<{
      Body: { message: string; conversationId?: string; cwd?: string };
    }>('/agent/research', async (request, reply) => {
      const { message, conversationId, cwd } = request.body || {};

      if (!message) {
        reply.status(400);
        return { success: false, error: 'Missing message' };
      }

      // Use provided cwd or fallback to process.cwd()
      const workingDir = cwd || process.cwd();

      this.logger.info(`Agent research (background): ${message.substring(0, 100)}...`, {
        conversationId: conversationId || 'new',
        cwd: workingDir,
      });

      try {
        // Ensure brain is initialized
        const brain = await this.ensureBrain();

        // Get API key
        const brainConfig = brain.getConfig();
        const apiKey = process.env.GEMINI_API_KEY || brainConfig.apiKeys.gemini;

        if (!apiKey) {
          reply.status(500);
          return { success: false, error: 'GEMINI_API_KEY not configured' };
        }

        // Generate log path for agent session
        const agentLogDir = path.join(LOG_DIR, 'agent-sessions');
        await fs.mkdir(agentLogDir, { recursive: true });
        const timestamp = getFilenameTimestamp();
        const agentLogPath = path.join(agentLogDir, `session-${timestamp}.json`);
        const reportPath = path.join(agentLogDir, `report-${timestamp}.md`);

        // Create agent
        const agent = await createResearchAgent({
          apiKey,
          model: 'gemini-2.0-flash',
          conversationId: conversationId || undefined,
          brainManager: brain,
          cwd: workingDir,
          verbose: true,
          logPath: agentLogPath,
          onReportUpdate: async (report, confidence, missingInfo) => {
            // Write report to file for progressive checking
            try {
              await fs.writeFile(reportPath, report, 'utf-8');
              this.logger.debug(`Report updated: ${report.length} chars, confidence: ${confidence}`);
            } catch (err: any) {
              this.logger.warn(`Failed to write report: ${err.message}`);
            }
          },
        });

        const agentConversationId = agent.getConversationId();

        // Run research in background (fire and forget)
        (async () => {
          try {
            this.logger.info(`[Background Research] Starting...`);
            const result = await agent.research(message);
            this.logger.info(`[Background Research] Complete`, {
              confidence: result.confidence,
              reportLength: result.report.length,
              iterations: result.iterations,
            });
            // Write final report
            await fs.writeFile(reportPath, result.report, 'utf-8');
          } catch (err: any) {
            this.logger.error(`[Background Research] Failed: ${err.message}`);
          }
        })();

        // Return immediately with paths to check
        return {
          success: true,
          message: 'Research started in background',
          conversationId: agentConversationId,
          logPath: agentLogPath,
          reportPath: reportPath,
          checkWith: `cat ${reportPath}`,
          streamLogsWith: `tail -f ${agentLogPath}`,
        };

      } catch (error: any) {
        this.logger.error(`Agent research error: ${error.message}`);
        reply.status(500);
        return { success: false, error: error.message };
      }
    });

    // Get conversation messages
    this.server.get<{
      Params: { conversationId: string };
    }>('/agent/conversations/:conversationId', async (request) => {
      const { conversationId } = request.params;
      const brain = await this.ensureBrain();
      const neo4jClient = brain.getNeo4jClient();

      if (!neo4jClient) {
        return { messages: [] };
      }

      try {
        const result = await neo4jClient.run(`
          MATCH (c:Conversation {id: $conversationId})-[:HAS_MESSAGE]->(m:Message)
          RETURN m.role as role, m.content as content, m.timestamp as timestamp, m.toolCalls as toolCalls
          ORDER BY m.timestamp ASC
        `, { conversationId });

        const messages = result.records.map((record: any) => ({
          role: record.get('role'),
          content: record.get('content'),
          timestamp: record.get('timestamp'),
          toolCalls: record.get('toolCalls'),
        }));

        return { messages };
      } catch (err: any) {
        this.logger.warn(`Failed to get conversation: ${err.message}`);
        return { messages: [] };
      }
    });
  }

  private setupErrorHandlers(): void {
    // Uncaught exceptions
    process.on('uncaughtException', (error: any) => {
      // Ignore EPIPE errors - they happen when stdout/stderr is closed
      // (e.g. parent terminal closed while daemon is running in verbose mode)
      if (error?.code === 'EPIPE' || error?.message === 'write EPIPE') {
        return;
      }
      this.logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
      });
    });

    // Unhandled rejections
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', { reason: String(reason) });
    });

    // Graceful shutdown signals
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM');
      this.shutdown();
    });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.logger.info(`Idle timeout reached (${IDLE_TIMEOUT_MS / 1000}s), shutting down...`);
      this.shutdown();
    }, IDLE_TIMEOUT_MS);
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async start(): Promise<void> {
    const port = parseInt(process.env.RAGFORGE_DAEMON_PORT || String(DEFAULT_PORT), 10);

    try {
      await this.server.listen({ port, host: '127.0.0.1' });

      // Write PID file
      await fs.mkdir(path.dirname(PID_FILE), { recursive: true });
      await fs.writeFile(PID_FILE, String(process.pid));

      this.logger.info(`Daemon listening on http://127.0.0.1:${port}`);
      this.logger.info(`Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);

      // Start idle timer
      this.resetIdleTimer();

      console.log(`🧠 Brain Daemon running on http://127.0.0.1:${port}`);
      console.log(`📝 Logs: ${LOG_FILE}`);
      console.log(`⏰ Auto-shutdown after ${IDLE_TIMEOUT_MS / 1000}s of inactivity`);
    } catch (error: any) {
      this.logger.error('Failed to start server', { error: error.message });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down daemon...');

    // Clear idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    // Wait for locks to be released before shutdown
    if (this.brain) {
      const ingestionLock = this.brain.getIngestionLock();
      const embeddingLock = this.brain.getEmbeddingLock();

      // Wait for ingestion lock
      if (ingestionLock.isLocked()) {
        this.logger.info('Waiting for ingestion operations to complete before shutdown...');
        const ingestionUnlocked = await ingestionLock.waitForUnlock(1200000); // 20 minutes max
        if (!ingestionUnlocked) {
          this.logger.warn('Ingestion lock timeout, proceeding with shutdown anyway');
        } else {
          this.logger.info('Ingestion operations complete');
        }
      }

      // Wait for embedding lock
      if (embeddingLock.isLocked()) {
        this.logger.info('Waiting for embedding operations to complete before shutdown...');
        const embeddingUnlocked = await embeddingLock.waitForUnlock(1200000); // 20 minutes max
        if (!embeddingUnlocked) {
          this.logger.warn('Embedding lock timeout, proceeding with shutdown anyway');
        } else {
          this.logger.info('Embedding operations complete');
        }
      }
    }

    // Shutdown BrainManager (stops watchers, closes connections)
    if (this.brain) {
      try {
        await this.brain.shutdown();
        this.logger.info('BrainManager shutdown complete');
      } catch (error: any) {
        this.logger.error('Error during BrainManager shutdown', { error: error.message });
      }
    }

    // Remove PID file
    try {
      await fs.unlink(PID_FILE);
    } catch {
      // Ignore if doesn't exist
    }

    // Close server
    await this.server.close();

    this.logger.info('Daemon shutdown complete');
    await this.logger.close();

    process.exit(0);
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

export async function startDaemon(options: { detached?: boolean; verbose?: boolean } = {}): Promise<void> {
  if (options.verbose) {
    process.env.RAGFORGE_DAEMON_VERBOSE = '1';
  }

  if (options.detached) {
    // Spawn detached process
    const { spawn } = await import('child_process');
    const child = spawn(process.execPath, [process.argv[1], 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`🧠 Brain Daemon started in background (PID: ${child.pid})`);
    return;
  }

  const daemon = new BrainDaemon();
  await daemon.initialize();
  await daemon.start();
}

export async function stopDaemon(): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/shutdown`, {
      method: 'POST',
    });

    if (response.ok) {
      console.log('🛑 Daemon shutdown initiated');
    } else {
      console.log('❌ Failed to stop daemon');
    }
  } catch {
    console.log('ℹ️  Daemon is not running');
  }
}

interface DaemonStatusResponse {
  status: string;
  pid: number;
  port: number;
  uptime_human: string;
  request_count: number;
  last_activity: string;
  memory: { heap_used_mb: number; rss_mb: number };
  brain: {
    connected: boolean;
    projects: Array<{ id: string; path: string; nodeCount: number; displayName?: string }>;
    watchers: string[];
  };
}

export async function getDaemonStatus(): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/status`);

    if (response.ok) {
      const status = await response.json() as DaemonStatusResponse;
      console.log('🧠 Brain Daemon Status');
      console.log('─'.repeat(40));
      console.log(`Status: ${status.status}`);
      console.log(`PID: ${status.pid}`);
      console.log(`Port: ${status.port}`);
      console.log(`Uptime: ${status.uptime_human}`);
      console.log(`Requests: ${status.request_count}`);
      console.log(`Last activity: ${status.last_activity}`);
      console.log(`Memory: ${status.memory.heap_used_mb}MB heap / ${status.memory.rss_mb}MB RSS`);
      console.log('─'.repeat(40));
      console.log(`Projects: ${status.brain.projects.length}`);
      for (const p of status.brain.projects) {
        const name = p.displayName || p.id;
        console.log(`  • ${name}: ${p.nodeCount} nodes`);
      }
      console.log(`Active watchers: ${status.brain.watchers.length}`);
      if (status.brain.watchers.length > 0) {
        console.log(`Watched: ${status.brain.watchers.join(', ')}`);
      }
    } else {
      console.log('❌ Daemon returned error');
    }
  } catch {
    console.log('ℹ️  Daemon is not running');
  }
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Stream daemon logs to console (SSE client)
 */
export async function streamDaemonLogs(options: { tail?: number; follow?: boolean } = {}): Promise<void> {
  const { tail = 50, follow = true } = options;

  // Check if daemon is running
  const running = await isDaemonRunning();
  if (!running) {
    console.log('ℹ️  Daemon is not running. Start it with: ragforge daemon start');
    return;
  }

  if (!follow) {
    // Just fetch recent logs and exit
    try {
      const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/logs?lines=${tail}`);
      if (response.ok) {
        const data = await response.json() as { logs: string[] };
        for (const line of data.logs) {
          console.log(line);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch logs:', err.message);
    }
    return;
  }

  // Stream logs via SSE using native http (no buffering issues)
  console.log(`📜 Streaming daemon logs (tail=${tail}, Ctrl+C to stop)...\n`);

  const http = await import('http');

  return new Promise<void>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: DEFAULT_PORT,
        path: `/logs/stream?tail=${tail}`,
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          console.error(`Failed to connect to log stream: ${res.statusCode}`);
          resolve();
          return;
        }

        let buffer = '';

        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;

          // Parse SSE messages
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              console.log(data);
            }
            // Ignore heartbeat comments (lines starting with :) and empty lines
          }
        });

        res.on('end', () => {
          console.log('\n✓ Log stream ended');
          resolve();
        });

        res.on('error', (err) => {
          console.error('Stream error:', err.message);
          resolve();
        });
      }
    );

    req.on('error', (err) => {
      console.error('Connection error:', err.message);
      resolve();
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log('\n✓ Log stream stopped');
      req.destroy();
      resolve();
      process.exit(0);
    });

    req.end();
  });
}

// Export port for client usage
export const DAEMON_PORT = DEFAULT_PORT;

// ============================================================================
// Entry Point (when run directly)
// ============================================================================

// Check if this file is being run directly (not imported)
const isMainModule = process.argv[1]?.includes('daemon');

if (isMainModule) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start':
      startDaemon({
        verbose: args.includes('-v') || args.includes('--verbose'),
      }).catch((error) => {
        console.error('Failed to start daemon:', error);
        process.exit(1);
      });
      break;

    case 'stop':
      stopDaemon().then(() => process.exit(0));
      break;

    case 'status':
      getDaemonStatus().then(() => process.exit(0));
      break;

    case 'logs':
      streamDaemonLogs({
        tail: parseInt(args.find(a => a.startsWith('--tail='))?.split('=')[1] || '50', 10),
        follow: !args.includes('--no-follow'),
      }).then(() => process.exit(0));
      break;

    default:
      console.log(`
Brain Daemon - Keeps BrainManager alive for fast tool execution

Usage:
  daemon start [-v]    Start the daemon (verbose mode with -v)
  daemon stop          Stop the daemon
  daemon status        Show daemon status
  daemon logs          Stream logs in real-time (Ctrl+C to stop)
    --tail=N           Show last N lines (default: 50)
    --no-follow        Show logs and exit (don't stream)
`);
      process.exit(0);
  }
}
