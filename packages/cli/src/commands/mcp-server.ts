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
import { promises as fs, readFileSync } from 'fs';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { callToolViaDaemon, ensureDaemonRunning, isDaemonRunning, generateDaemonBrainToolHandlers } from './daemon-client.js';
import { getDaemonBrainProxy, type BrainProxy } from './daemon-brain-proxy.js';
import {
  createClient,
  ConfigLoader,
  generateToolsFromConfig,
  generateFileTools,
  generateFsTools,
  generateShellTools,
  generateContextTools,
  ProjectRegistry,
  // Discovery tools (get_schema)
  generateDiscoveryTools,
  // Brain tools (ingest, search)
  generateBrainTools,
  generateBrainToolHandlers,
  // Setup tools (set_api_key, get_brain_status)
  generateSetupTools,
  generateSetupToolHandlers,
  // Agent tools (call_agent, extract_agent_prompt, call_agent_steps, create_conversation, switch_conversation)
  generateAgentTools,
  // Debug tools (inspect/test conversation memory)
  generateAllDebugTools,
  // Web tools (search, fetch)
  webToolDefinitions,
  createWebToolHandlers,
  type WebToolsContext,
  // Image tools
  generateImageTools,
  type ImageToolsContext,
  // 3D tools
  generate3DTools,
  type ThreeDToolsContext,
  // Types
  type ToolGenerationContext,
  type RagForgeConfig,
  type GeneratedToolDefinition,
  type ToolSection,
} from '@luciformresearch/ragforge';
import { startMcpServer, type McpServerConfig } from '../mcp/server.js';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';

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
  generatedPath: string | null;
  ragClient: ReturnType<typeof createClient> | null;
  isProjectLoaded: boolean;
  registry: ProjectRegistry;
  /** Brain proxy - connects to daemon for all brain operations */
  brainProxy: BrainProxy | null;
}

// ============================================
// Implementation
// ============================================

/**
 * Extract ToolGenerationContext from RagForge config
 * Note: This is a simplified version that handles the most common cases
 */
function extractToolContext(config: RagForgeConfig): ToolGenerationContext {
  // Use type assertion to handle config shape differences
  const entities: ToolGenerationContext['entities'] = [];
  const allRelationships: ToolGenerationContext['relationships'] = [];
  const allVectorIndexes: ToolGenerationContext['vectorIndexes'] = [];

  for (const entityConfig of config.entities || []) {
    const entity = entityConfig as any;
    const uniqueField = entity.unique_field || 'name';

    // Extract searchable fields from schema_fields (new format) or fields (legacy)
    const fields = entity.schema_fields || entity.fields || {};
    const searchableFields = Object.entries(fields)
      .filter(([, f]) => (f as any).searchable)
      .map(([name, f]) => ({
        name,
        type: (f as any).type as string,
        description: (f as any).description,
      }));

    // Extract computed fields
    const computedFields = (entity.computed_fields || []).map((cf: any) => ({
      name: cf.name,
      type: cf.return_type || 'string',
      expression: cf.expression,
      returnType: cf.return_type,
      description: cf.description,
    }));

    // Extract vector indexes
    const vectorIndexes: ToolGenerationContext['vectorIndexes'] = [];
    if (entity.vector_indexes) {
      for (const vi of entity.vector_indexes) {
        vectorIndexes.push({
          name: vi.name,
          entityType: entity.name,
          sourceField: vi.source_field,
          dimension: vi.dimension,
          provider: vi.provider,
          model: vi.model,
        });
      }
    } else if (entity.vector_index) {
      const vi = entity.vector_index;
      vectorIndexes.push({
        name: vi.name,
        entityType: entity.name,
        sourceField: vi.source_field,
        dimension: vi.dimension,
        provider: vi.provider,
        model: vi.model,
      });
    }

    // Extract relationships
    const relationships = (entity.relationships || []).map((r: any) => ({
      type: r.type,
      sourceEntity: entity.name,
      targetEntity: r.target,
      direction: r.direction,
      description: r.description,
    }));

    entities.push({
      name: entity.name,
      description: entity.description,
      uniqueField,
      displayNameField: entity.display_name_field || 'name',
      queryField: entity.query_field || 'name',
      contentField: entity.content_field,
      exampleDisplayFields: entity.example_display_fields,
      searchableFields,
      computedFields: computedFields.length > 0 ? computedFields : undefined,
      vectorIndexes,
      relationships,
      changeTracking: entity.track_changes
        ? { enabled: true, contentField: entity.change_tracking?.content_field || 'source' }
        : undefined,
      hierarchicalContent: entity.hierarchical_content
        ? {
            childrenRelationship: entity.hierarchical_content.children_relationship,
            includeChildren: entity.hierarchical_content.include_children,
          }
        : undefined,
    } as any);

    allRelationships.push(...relationships);
    allVectorIndexes.push(...vectorIndexes);
  }

  return {
    entities,
    relationships: allRelationships,
    vectorIndexes: allVectorIndexes,
  };
}

/**
 * Load project and prepare tools for MCP
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
    currentProjectPath: null,
    generatedPath: null,
    ragClient: null,
    isProjectLoaded: false,
    registry: new ProjectRegistry({
      memoryPolicy: { maxLoadedProjects: 3, idleUnloadTimeout: 5 * 60 * 1000 },
    }),
    brainProxy: null,
  };

  // Initialize Brain Proxy (connects to daemon for all brain operations)
  // This ensures single point of access to Neo4j and file watchers
  try {
    log('info', 'Initializing Brain Proxy (daemon mode)...');
    ctx.brainProxy = await getDaemonBrainProxy();
    log('info', 'Brain Proxy initialized (connected to daemon)');
  } catch (error: any) {
    log('debug', `Brain Proxy init failed: ${error.message}`);
    log('debug', 'Brain tools will be disabled');
  }

  // Cached config for dynamic context
  let cachedConfig: RagForgeConfig | null = null;
  let cachedContext: ToolGenerationContext | null = null;

  const getToolContext = (): ToolGenerationContext | null => {
    if (!ctx.isProjectLoaded || !ctx.currentProjectPath) return null;

    const configPaths = [
      path.join(ctx.currentProjectPath, '.ragforge', 'ragforge.config.yaml'),
      path.join(ctx.currentProjectPath, '.ragforge', 'generated', 'ragforge.config.yaml'),
    ];

    let configPath: string | null = null;
    for (const p of configPaths) {
      try {
        readFileSync(p, 'utf-8');
        configPath = p;
        break;
      } catch {
        // Try next
      }
    }

    if (!configPath) return null;

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const config = yaml.load(configContent) as RagForgeConfig;

      if (config !== cachedConfig) {
        cachedConfig = config;
        cachedContext = extractToolContext(config);
      }

      return cachedContext;
    } catch {
      return null;
    }
  };

  // Try to load project
  const configPath = options.config || path.join(projectPath, '.ragforge', 'generated', 'ragforge.config.yaml');
  const generatedPath = path.join(projectPath, '.ragforge', 'generated');

  try {
    await fs.access(configPath);

    log('info', `Loading project from ${projectPath}`);

    // Load config
    const config = await ConfigLoader.load(configPath);

    // Create RagClient (auto-connects on first query)
    const ragClient = createClient(config as any);

    ctx.currentProjectPath = projectPath;
    ctx.generatedPath = generatedPath;
    ctx.ragClient = ragClient;
    ctx.isProjectLoaded = true;

    cachedConfig = config;
    cachedContext = extractToolContext(config);

    log('info', `Project loaded with ${config.entities?.length || 0} entities`);

    // Generate RAG tools from config
    const { tools: ragTools, handlers: ragHandlers } = generateToolsFromConfig(config, {
      includeDiscovery: true,
      includeSemanticSearch: true,
      includeRelationships: true,
      contextGetter: getToolContext,
    });

    allTools.push(...ragTools);

    // Bind RAG handlers
    for (const [name, handlerGen] of Object.entries(ragHandlers)) {
      allHandlers[name] = (handlerGen as any)(ragClient);
    }
  } catch (error: any) {
    log('info', `No project loaded: ${error.message}`);
    log('info', 'Running in standalone mode with limited tools');
  }

  // Add FS tools (list_directory, glob_files, etc.) - these run locally as they don't need brain
  const fsTools = generateFsTools({ projectRoot: () => ctx.currentProjectPath || process.cwd() });
  // Filter out tools that are routed via daemon for brain integration
  const daemonRoutedFsTools = new Set(['delete_path', 'move_file', 'copy_file']);
  const filteredFsTools = fsTools.tools.filter(t => !daemonRoutedFsTools.has(t.name));
  allTools.push(...filteredFsTools);
  for (const [name, handler] of Object.entries(fsTools.handlers)) {
    // Skip tools routed via daemon
    if (daemonRoutedFsTools.has(name)) continue;
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
    isProjectLoaded: () => ctx.isProjectLoaded,
    isNeo4jConnected: () => ctx.ragClient !== null,
  });
  allTools.push(...contextTools.tools);
  for (const [name, handler] of Object.entries(contextTools.handlers)) {
    allHandlers[name] = handler;
  }

  // Add brain tools via daemon (with auto-restart)
  // This ensures the daemon is always running when brain tools are called
  {
    const brainToolDefs = generateBrainTools();
    const setupToolDefs = generateSetupTools();

    // Create daemon proxy handlers - these auto-restart the daemon if needed
    const createDaemonProxyHandler = (toolName: string) => async (args: any) => {
      log('debug', `Calling ${toolName} via daemon (auto-restart enabled)`);
      const result = await callToolViaDaemon(toolName, args);
      if (!result.success) {
        throw new Error(result.error || `Tool ${toolName} failed`);
      }
      return result.result;
    };

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

  // Add discovery tools (get_schema) - uses cached context from loaded project
  if (cachedContext) {
    const discoveryTools = generateDiscoveryTools(cachedContext, getToolContext);
    allTools.push(...discoveryTools.tools);
    for (const [name, handlerGen] of Object.entries(discoveryTools.handlers)) {
      // Discovery handlers are generators that need the client
      allHandlers[name] = (handlerGen as any)(ctx.ragClient);
    }
    log('debug', 'Discovery tools enabled');
  } else {
    log('debug', 'Discovery tools disabled (no project loaded)');
  }

  // File, Web, Image, and 3D tools are routed via daemon (see daemon section below)
  // This ensures they benefit from daemon's brain integration and atomic ingestion
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

  // Add tools via daemon (with auto-restart)
  // This ensures the daemon is always running and handles brain integration atomically
  {
    // Create daemon proxy handlers - these auto-restart the daemon if needed
    const createDaemonProxyHandler = (toolName: string) => async (args: any) => {
      log('debug', `Calling ${toolName} via daemon (auto-restart enabled)`);
      const result = await callToolViaDaemon(toolName, args);
      if (!result.success) {
        throw new Error(result.error || `Tool ${toolName} failed`);
      }
      return result.result;
    };

    // Add file tools via daemon (for brain integration - touchFile on read, triggerReIngestion on modify)
    const fileTools = generateFileTools({ projectRoot: () => ctx.currentProjectPath || process.cwd() });
    allTools.push(...fileTools.tools);
    for (const toolDef of fileTools.tools) {
      allHandlers[toolDef.name] = createDaemonProxyHandler(toolDef.name);
    }
    log('debug', `File tools enabled (via daemon) - ${fileTools.tools.length} tools`);

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
  }

  log('debug', 'All tools prepared');

  return { tools: allTools, handlers: allHandlers, onBeforeToolCall };
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
