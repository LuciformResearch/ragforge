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
import {
  createClient,
  ConfigLoader,
  generateToolsFromConfig,
  generateFileTools,
  generateFsTools,
  generateShellTools,
  generateContextTools,
  ProjectRegistry,
  generateProjectManagementTools,
  // Discovery tools (get_schema)
  generateDiscoveryTools,
  // Brain tools (ingest, search)
  BrainManager,
  generateBrainTools,
  generateBrainToolHandlers,
  // Setup tools (set_api_key, get_brain_status)
  generateSetupTools,
  generateSetupToolHandlers,
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
  brainManager: BrainManager | null;
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
    brainManager: null,
  };

  // Try to initialize BrainManager (for brain tools)
  // BrainManager handles its own Docker container and .env file in ~/.ragforge/
  try {
    log('info', 'Initializing BrainManager...');
    ctx.brainManager = await BrainManager.getInstance();
    await ctx.brainManager.initialize();
    log('info', 'BrainManager initialized (Docker container managed automatically)');
  } catch (error: any) {
    log('debug', `BrainManager init failed: ${error.message}`);
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

  // Add file tools (read, write, edit)
  // Note: These return ready handlers, not generators
  // Fallback to cwd for standalone mode (no project loaded)
  const fileTools = generateFileTools({
    projectRoot: () => ctx.currentProjectPath || process.cwd(),
    // Trigger re-ingestion when files are modified
    onFileModified: ctx.brainManager
      ? async (filePath: string, changeType: 'created' | 'updated' | 'deleted') => {
          log('debug', `File ${changeType}: ${filePath}`);
          // For media/document files, use updateMediaContent
          // For code files, the file watcher handles re-ingestion automatically
          if (changeType !== 'deleted' && ctx.brainManager) {
            const pathModule = await import('path');
            const ext = pathModule.extname(filePath).toLowerCase();
            const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.docx', '.xlsx', '.glb', '.gltf'];

            if (mediaExts.includes(ext)) {
              try {
                await ctx.brainManager.updateMediaContent({
                  filePath,
                  extractionMethod: `file-tool-${changeType}`,
                  generateEmbeddings: true,
                });
                log('debug', `Re-ingested media: ${filePath}`);
              } catch (e: any) {
                log('debug', `Re-ingestion failed: ${e.message}`);
              }
            } else {
              // Code files: find the project and trigger incremental re-ingestion
              const absoluteFilePath = pathModule.resolve(filePath);
              const projects = ctx.brainManager!.listProjects();
              const project = projects.find(p => absoluteFilePath.startsWith(p.path + pathModule.sep) || absoluteFilePath.startsWith(p.path));

              if (project) {
                try {
                  log('debug', `Re-ingesting code file in project ${project.id}: ${filePath}`);
                  await ctx.brainManager!.quickIngest(project.path, {
                    projectName: project.id,
                    generateEmbeddings: true,
                  });
                  log('debug', `Re-ingested project ${project.id}`);
                } catch (e: any) {
                  log('debug', `Code re-ingestion failed: ${e.message}`);
                }
              } else {
                log('debug', `Code file modified but no project found: ${filePath}`);
              }
            }
          }
        }
      : undefined,
  });
  allTools.push(...fileTools.tools);
  for (const [name, handler] of Object.entries(fileTools.handlers)) {
    allHandlers[name] = handler;
  }

  // Add FS tools (list_directory, glob_files, etc.)
  const fsTools = generateFsTools({ projectRoot: () => ctx.currentProjectPath || process.cwd() });
  allTools.push(...fsTools.tools);
  for (const [name, handler] of Object.entries(fsTools.handlers)) {
    allHandlers[name] = handler;
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

  // Add project management tools
  const pmContext = { registry: ctx.registry };
  const pmTools = generateProjectManagementTools(pmContext);
  allTools.push(...pmTools.tools);
  for (const [name, handler] of Object.entries(pmTools.handlers)) {
    allHandlers[name] = handler as any;
  }

  // Add brain tools (ingest, search, forget) - if BrainManager available
  if (ctx.brainManager) {
    const brainToolDefs = generateBrainTools();
    const brainHandlers = generateBrainToolHandlers({ brain: ctx.brainManager });
    allTools.push(...brainToolDefs);
    for (const [name, handler] of Object.entries(brainHandlers)) {
      allHandlers[name] = handler;
    }
    log('debug', 'Brain tools enabled');

    // Add setup tools (set_api_key, get_brain_status) - for MCP users
    const setupToolDefs = generateSetupTools();
    const setupHandlers = generateSetupToolHandlers({ brain: ctx.brainManager });
    allTools.push(...setupToolDefs);
    for (const [name, handler] of Object.entries(setupHandlers)) {
      allHandlers[name] = handler;
    }
    log('debug', 'Setup tools enabled');
  } else {
    log('debug', 'Brain tools disabled (BrainManager not initialized)');
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

  // Add web tools (search, fetch) - if Gemini API key available
  // Try BrainManager first, then fallback to env
  const webGeminiKey = ctx.brainManager?.getGeminiKey() || getEnv(['GEMINI_API_KEY']);
  if (webGeminiKey) {
    const webToolsCtx: WebToolsContext = {
      geminiApiKey: webGeminiKey,
      // Wire up web page ingestion to brain
      ingestWebPage: ctx.brainManager
        ? async (params) => {
            log('debug', `Ingesting web page: ${params.url}`);
            try {
              const result = await ctx.brainManager!.ingestWebPage({
                url: params.url,
                title: params.title,
                textContent: params.textContent,
                rawHtml: params.rawHtml,
                projectName: params.projectName,
                generateEmbeddings: true,
              });
              log('debug', `Web page ingested: ${params.url} → ${result.nodeId}`);
              return result;
            } catch (e: any) {
              log('debug', `Web ingestion failed: ${e.message}`);
              return { success: false };
            }
          }
        : undefined,
    };
    const webHandlers = createWebToolHandlers(webToolsCtx);
    allTools.push(...webToolDefinitions);
    for (const [name, handler] of Object.entries(webHandlers)) {
      allHandlers[name] = handler;
    }
    log('debug', 'Web tools enabled');
  } else {
    log('debug', 'Web tools disabled (no GEMINI_API_KEY in ~/.ragforge/.env)');
  }

  // Add image tools
  const projectRoot = ctx.currentProjectPath || process.cwd();
  const imageToolsCtx: ImageToolsContext = {
    projectRoot: projectRoot,
    // Auto-ingest generated/edited images
    onContentExtracted: ctx.brainManager
      ? async (params) => {
          log('debug', `Image content extracted: ${params.filePath}`);
          try {
            await ctx.brainManager!.updateMediaContent({
              filePath: params.filePath,
              textContent: params.textContent,
              description: params.description,
              ocrConfidence: params.ocrConfidence,
              extractionMethod: params.extractionMethod,
              generateEmbeddings: params.generateEmbeddings,
              sourceFiles: params.sourceFiles,
            });
            log('debug', `Image ingested: ${params.filePath}`);
            return { updated: true };
          } catch (e: any) {
            log('debug', `Image ingestion failed: ${e.message}`);
            return { updated: false };
          }
        }
      : undefined,
  };
  const imageTools = generateImageTools(imageToolsCtx);
  allTools.push(...imageTools.tools);
  for (const [name, handler] of Object.entries(imageTools.handlers)) {
    allHandlers[name] = handler;
  }
  log('debug', 'Image tools enabled');

  // Add 3D tools
  const threeDToolsCtx: ThreeDToolsContext = {
    projectRoot: projectRoot,
    // Auto-ingest generated 3D models
    onContentExtracted: ctx.brainManager
      ? async (params) => {
          log('debug', `3D content extracted: ${params.filePath}`);
          try {
            await ctx.brainManager!.updateMediaContent({
              filePath: params.filePath,
              textContent: params.textContent,
              description: params.description,
              extractionMethod: params.extractionMethod,
              generateEmbeddings: params.generateEmbeddings,
              sourceFiles: params.sourceFiles,
            });
            log('debug', `3D model ingested: ${params.filePath}`);
            return { updated: true };
          } catch (e: any) {
            log('debug', `3D ingestion failed: ${e.message}`);
            return { updated: false };
          }
        }
      : undefined,
  };
  const threeDTools = generate3DTools(threeDToolsCtx);
  allTools.push(...threeDTools.tools);
  for (const [name, handler] of Object.entries(threeDTools.handlers)) {
    allHandlers[name] = handler;
  }
  log('debug', '3D tools enabled');

  log('info', `Prepared ${allTools.length} tools total`);

  return { tools: allTools, handlers: allHandlers };
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

  // Load .env
  ensureEnvLoaded(import.meta.url);

  log('info', 'Starting RagForge MCP Server...');

  try {
    // Prepare tools
    const { tools, handlers } = await prepareToolsForMcp(options, log);

    // Start MCP server
    const config: McpServerConfig = {
      name: 'ragforge',
      version: '0.3.0',
      tools,
      handlers,
      sections: options.sections,
      excludeTools: options.exclude,
      onLog: log,
    };

    await startMcpServer(config);

    // Server runs until stdin closes (handled by MCP SDK)
  } catch (error: any) {
    log('error', `Failed to start MCP server: ${error.message}`);
    process.exit(1);
  }
}
