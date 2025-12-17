/**
 * RagForge MCP Server Command
 *
 * Exposes RagForge tools via Model Context Protocol.
 * Can be used with Claude Code or any MCP-compatible client.
 *
 * Usage:
 *   ragforge mcp-server [options]
 *
 * @since 2025-12-07
 */

import path from 'path';
import process from 'process';
import { callToolViaDaemon, ensureDaemonRunning } from './daemon-client.js';
import { getDaemonBrainProxy, type BrainProxy } from './daemon-brain-proxy.js';
import {
  generateFileTools,
  generateFsTools,
  generateShellTools,
  generateContextTools,
  ProjectRegistry,
  // Brain tools (ingest, search)
  generateBrainTools,
  // Setup tools (set_api_key, get_brain_status)
  generateSetupTools,
  // Agent tools (call_agent, extract_agent_prompt, call_agent_steps, create_conversation, switch_conversation)
  generateAgentTools,
  // Debug tools (inspect/test conversation memory)
  generateAllDebugTools,
  // Web tools (search, fetch)
  webToolDefinitions,
  // Image tools
  generateImageTools,
  type ImageToolsContext,
  // 3D tools
  generate3DTools,
  type ThreeDToolsContext,
  // Types
  type GeneratedToolDefinition,
  type ToolSection,
  // Tool Logging
  ToolLogger,
  withToolLogging,
} from '@luciformresearch/ragforge';
import { startMcpServer, type McpServerConfig } from '../mcp/server.js';
import { ensureEnvLoaded } from '../utils/env.js';

// ============================================
// Types
// ============================================

export interface McpServerOptions {
  /** Project path (default: current directory) */
  project?: string;
  // TEST...
  /** Config file path */
  config?: string;

  /** Sections to expose (all if not specified) */
  sections?: ToolSection[];

  /** Tools to exclude */
  exclude?: string[];

  /** Verbose output (to stderr, not stdout) */
  verbose?: boolean;
}

// ============================================
// Context for MCP tools
// ============================================

interface McpContext {
  currentProjectPath: string | null;
  registry: ProjectRegistry;
  /** Brain proxy - connects to daemon for all brain operations */
  brainProxy: BrainProxy | null;
}

// ============================================
// Implementation
// ============================================

/**
 * Prepare tools for MCP - all brain operations go through daemon
 */
async function prepareToolsForMcp(
  options: McpServerOptions,
  log: (level: 'info' | 'error' | 'debug', msg: string) => void
): Promise<{
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
  onBeforeToolCall: (toolName: string, args: any) => Promise<void>;
}> {
  const projectPath = options.project || process.cwd();
  const allTools: GeneratedToolDefinition[] = [];
  const allHandlers: Record<string, (args: any) => Promise<any>> = {};

  // Create context
  const ctx: McpContext = {
    currentProjectPath: projectPath,
    registry: new ProjectRegistry({
      memoryPolicy: { maxLoadedProjects: 3, idleUnloadTimeout: 5 * 60 * 1000 },
    }),
    brainProxy: null,
  };

  // Start daemon in background (don't block MCP server startup)
  // Tools will connect to daemon lazily via callToolViaDaemon() which has its own ensureDaemonRunning()
  // This prevents MCP timeout when daemon takes time to initialize (Neo4j, watchers, etc.)
  log('info', 'Starting daemon in background (non-blocking)...');
  ensureDaemonRunning(false).then(ready => {
    if (ready) {
      log('info', 'Daemon ready');
      // Pre-warm brain proxy for faster first tool call
      getDaemonBrainProxy()
        .then(proxy => {
          ctx.brainProxy = proxy;
          log('debug', 'Brain proxy pre-warmed');
        })
        .catch(() => {
          // Ignore - will be initialized lazily on first tool call
        });
    } else {
      log('debug', 'Daemon startup returned false (will retry on first tool call)');
    }
  }).catch(err => {
    log('debug', `Daemon background start failed: ${err.message} (will retry on first tool call)`);
  });

  // Add FS tools (list_directory, glob_files, etc.) - these run locally as they don't need brain
  // NOTE: delete_path, move_file, copy_file are now in brain-tools only
  const fsTools = generateFsTools({ projectRoot: () => ctx.currentProjectPath || process.cwd() });
  allTools.push(...fsTools.tools);
  for (const [name, handler] of Object.entries(fsTools.handlers)) {
    // Wrap handlers for grep_files and search_files to handle extract_hierarchy via daemon
    if (name === 'grep_files' || name === 'search_files') {
      allHandlers[name] = async (args: any) => {
        // Temporarily remove extract_hierarchy from args to let handler return matches only
        const extractHierarchy = args.extract_hierarchy;
        const handlerArgs = { ...args };
        delete handlerArgs.extract_hierarchy;

        // Call the handler first to get matches (without extract_hierarchy)
        const result = await handler(handlerArgs);

        // If extract_hierarchy is requested and we have matches, call extract_dependency_hierarchy via daemon
        if (extractHierarchy && result.matches && result.matches.length > 0) {
          try {
            // Use daemon proxy (same pattern as brain_search)
            const hierarchyResult = await callToolViaDaemon('extract_dependency_hierarchy', {
              results: result.matches,
              depth: 1,
              direction: 'both',
              max_scopes: Math.min(result.matches.length, 10),
            });

            if (hierarchyResult.success) {
              result.hierarchy = hierarchyResult.result;
            } else {
              result.hierarchy_error = hierarchyResult.error || 'Failed to extract hierarchy via daemon';
            }
          } catch (err: any) {
            result.hierarchy_error = err.message || 'Failed to extract hierarchy';
          }
        }

        return result;
      };
    } else {
      allHandlers[name] = handler;
    }
  }

  // Add shell tools (with default confirmation that always allows)
  const shellTools = generateShellTools({
    projectRoot: () => ctx.currentProjectPath || process.cwd(),
    onConfirmationRequired: async () => true, // Auto-confirm for MCP (client can handle security)
    // Trigger file tracker update when shell commands modify files
    onFilesModified: async (cwd: string) => {
      log('debug', `Shell command modified files in: ${cwd}`);
      // For now, just log - could trigger a directory re-scan if needed
    },
  });
  allTools.push(...shellTools.tools);
  for (const [name, handler] of Object.entries(shellTools.handlers)) {
    allHandlers[name] = handler;
  }

  // Add context tools
  const contextTools = generateContextTools({
    projectRoot: () => ctx.currentProjectPath,
    isProjectLoaded: () => ctx.brainProxy !== null,
    isNeo4jConnected: () => ctx.brainProxy !== null,
  });
  allTools.push(...contextTools.tools);
  for (const [name, handler] of Object.entries(contextTools.handlers)) {
    allHandlers[name] = handler;
  }

  // Create daemon proxy handler factory
  const createDaemonProxyHandler = (toolName: string) => async (args: any) => {
    log('debug', `Calling ${toolName} via daemon (auto-restart enabled)`);
    const result = await callToolViaDaemon(toolName, args);
    if (!result.success) {
      throw new Error(result.error || `Tool ${toolName} failed`);
    }
    return result.result;
  };

  // Add brain tools via daemon (with auto-restart)
  {
    const brainToolDefs = generateBrainTools();
    const setupToolDefs = generateSetupTools();

    // Add brain tool definitions with daemon proxy handlers
    allTools.push(...brainToolDefs);
    for (const toolDef of brainToolDefs) {
      allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
    }
    log('debug', 'Brain tools enabled (via daemon with auto-restart)');

    // Add setup tool definitions with daemon proxy handlers
    allTools.push(...setupToolDefs);
    for (const toolDef of setupToolDefs) {
      allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
    }
    log('debug', 'Setup tools enabled (via daemon with auto-restart)');
  }

  // File, Web, Image, and 3D tools are routed via daemon
  const projectRoot = ctx.currentProjectPath || process.cwd();

  log('info', `Prepared ${allTools.length} tools total`);

  // Create onBeforeToolCall callback for auto-init
  // Note: Auto-watcher logic moved to daemon.ts (ensureWatcherForFile)
  // This ensures both MCP and Agent benefit from the same behavior
  const onBeforeToolCall = async (toolName: string, args: any) => {
    // Auto-init brain proxy if not initialized
    if (!ctx.brainProxy) {
      try {
        log('debug', 'Auto-initializing brain proxy...');
        ctx.brainProxy = await getDaemonBrainProxy();
        log('info', 'Brain proxy auto-initialized');
      } catch (e: any) {
        log('debug', `Brain proxy auto-init failed: ${e.message}`);
      }
    }
  };

  // Add file tools that run locally (install_package, etc.)
  // NOTE: read_file, write_file, edit_file, etc. are now in brain-tools and routed via daemon above
  const fileTools = generateFileTools({ projectRoot: () => ctx.currentProjectPath || process.cwd() });
  allTools.push(...fileTools.tools);
  for (const [name, handler] of Object.entries(fileTools.handlers)) {
    allHandlers[name] = handler; // Run locally, no daemon needed
  }
  log('debug', `File tools enabled (local) - ${fileTools.tools.length} tools`);

  // Add web tools via daemon (for brain integration and web page ingestion)
  allTools.push(...webToolDefinitions);
  for (const toolDef of webToolDefinitions) {
    allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
  }
  log('debug', `Web tools enabled (via daemon) - ${webToolDefinitions.length} tools`);

  // Add image tools via daemon (for brain integration and atomic ingestion)
  const imageToolsCtx: ImageToolsContext = { projectRoot };
  const imageTools = generateImageTools(imageToolsCtx);
  allTools.push(...imageTools.tools);
  for (const toolDef of imageTools.tools) {
    allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
  }
  log('debug', `Image tools enabled (via daemon) - ${imageTools.tools.length} tools`);

  // Add 3D tools via daemon (for brain integration and atomic ingestion)
  const threeDToolsCtx: ThreeDToolsContext = { projectRoot };
  const threeDTools = generate3DTools(threeDToolsCtx);
  allTools.push(...threeDTools.tools);
  for (const toolDef of threeDTools.tools) {
    allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
  }
  log('debug', `3D tools enabled (via daemon) - ${threeDTools.tools.length} tools`);

  // Add agent tools via daemon
  const agentToolDefs = generateAgentTools();
  allTools.push(...agentToolDefs);
  for (const toolDef of agentToolDefs) {
    allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
  }
  log('debug', `Agent tools enabled (via daemon) - ${agentToolDefs.length} tools`);

  // Add debug tools via daemon (for conversation memory inspection/testing)
  const debugToolDefs = generateAllDebugTools();
  allTools.push(...debugToolDefs);
  for (const toolDef of debugToolDefs) {
    allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
  }
  log('debug', `Debug tools enabled (via daemon) - ${debugToolDefs.length} tools`);

  log('debug', 'All tools prepared');

  // Initialize tool logging
  ToolLogger.initialize();

  // Wrap all handlers with logging (if enabled via RAGFORGE_LOG_TOOL_CALLS=true)
  const wrappedHandlers: Record<string, (args: any) => Promise<any>> = {};
  for (const [name, handler] of Object.entries(allHandlers)) {
    wrappedHandlers[name] = withToolLogging(name, handler, 'mcp');
  }

  log('debug', `Tool logging ${ToolLogger.isEnabled() ? 'enabled' : 'disabled'}`);

  return { tools: allTools, handlers: wrappedHandlers, onBeforeToolCall };
}

// ============================================
// Command Implementation
// ============================================

export function printMcpServerHelp(): void {
  // Print to stderr to not interfere with MCP stdout
  console.error(`Usage:
  ragforge mcp-server [options]

Description:
  Start RagForge as an MCP server.
  All tools are exposed via Model Context Protocol.
  Use with Claude Code or any MCP-compatible client.

Options:
  --project <path>      Project directory (default: current directory)
  --config <path>       Path to ragforge.config.yaml
  --sections <list>     Comma-separated sections to expose (default: all)
                        Available: file_ops,shell_ops,rag_ops,project_ops,
                                   web_ops,media_ops,context_ops,planning_ops
  --exclude <list>      Comma-separated tool names to exclude
  --verbose             Enable verbose logging (to stderr)
  -h, --help            Show this help

Environment:
  NEO4J_URI             Neo4j connection URI
  NEO4J_USERNAME        Neo4j username
  NEO4J_PASSWORD        Neo4j password

Claude Desktop/Code config example (global install):
  {
    "mcpServers": {
      "ragforge": {
        "command": "ragforge",
        "args": ["mcp-server", "--project", "/path/to/project"]
      }
    }
  }

Claude Desktop/Code config example (local dev):
  {
    "mcpServers": {
      "ragforge": {
        "command": "node",
        "args": ["/path/to/ragforge/packages/cli/dist/esm/index.js",
                 "mcp-server", "--project", "/path/to/project", "--verbose"]
      }
    }
  }

Examples:
  # Start MCP server for current project (global)
  ragforge mcp-server

  # Start MCP server (local dev)
  node packages/cli/dist/esm/index.js mcp-server --verbose

  # Start with specific sections only
  ragforge mcp-server --sections file_ops,rag_ops

  # Exclude dangerous tools
  ragforge mcp-server --exclude delete_path,run_command
`);
}

export function parseMcpServerOptions(args: string[]): McpServerOptions {
  const options: McpServerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--project':
        options.project = args[++i];
        break;
      case '--config':
        options.config = args[++i];
        break;
      case '--sections':
        options.sections = args[++i].split(',') as ToolSection[];
        break;
      case '--exclude':
        options.exclude = args[++i].split(',');
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '-h':
      case '--help':
        printMcpServerHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

export async function runMcpServer(options: McpServerOptions): Promise<void> {
  // Log function - writes to stderr to not interfere with MCP protocol on stdout
  const log = (level: 'info' | 'error' | 'debug', message: string) => {
    if (options.verbose || level === 'error') {
      console.error(`[ragforge-mcp] [${level}] ${message}`);
    }
  };

  // Setup error handlers to prevent silent crashes
  process.on('uncaughtException', (error: any) => {
    // Ignore EPIPE errors - they happen when stdout/stderr is closed
    if (error?.code === 'EPIPE' || error?.message === 'write EPIPE') {
      return;
    }
    log('error', `Uncaught exception: ${error.message || error}`);
    if (error.stack) {
      log('error', error.stack);
    }
    // Don't exit - let MCP SDK handle it
  });

  process.on('unhandledRejection', (reason: any) => {
    log('error', `Unhandled rejection: ${reason?.message || String(reason)}`);
    if (reason?.stack) {
      log('error', reason.stack);
    }
    // Don't exit - let MCP SDK handle it
  });

  // Load .env
  ensureEnvLoaded(import.meta.url);

  log('info', 'Starting RagForge MCP Server...');

  try {
    // Prepare tools
    const { tools, handlers, onBeforeToolCall } = await prepareToolsForMcp(options, log);

    // Start MCP server
    const config: McpServerConfig = {
      name: 'ragforge',
      version: '0.3.0',
      tools,
      handlers,
      sections: options.sections,
      excludeTools: options.exclude,
      onLog: log,
      onBeforeToolCall,
    };

    await startMcpServer(config);

    // Server runs until stdin closes (handled by MCP SDK)
  } catch (error: any) {
    log('error', `Failed to start MCP server: ${error.message}`);
    if (error.stack) {
      log('error', error.stack);
    }
    process.exit(1);
  }
}
