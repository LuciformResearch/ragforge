/**
 * RagForge Agent Command
 *
 * Launches an agent with full RagForge capabilities:
 * - RAG tools for querying the knowledge graph
 * - File tools for reading/writing code
 * - Project tools for create, setup, ingest, embeddings
 *
 * Usage:
 *   ragforge agent [options]           # Interactive mode (future)
 *   ragforge agent --ask "question"    # Single question mode
 *   ragforge agent --script script.ts  # Run agent script
 *
 * @since 2025-12-06
 */

import path from 'path';
import process from 'process';
import { promises as fs, readFileSync } from 'fs';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import {
  createRagAgent,
  createClient,
  ConfigLoader,
  getFilenameTimestamp,
  FileWatcher,
  IncrementalIngestionManager,
  Neo4jClient,
  runEmbeddingPipelines,
  GeminiEmbeddingProvider,
  ProjectRegistry,
  BrainManager,
  type ProjectToolResult,
  type CreateProjectParams,
  type SetupProjectParams,
  type IngestCodeParams,
  type GenerateEmbeddingsParams,
  type ToolGenerationContext,
  type RagForgeConfig,
  type CodeSourceConfig,
  type AgentLogger,
  type LoadedProject,
} from '@luciformresearch/ragforge';
import { runCreate, type CreateOptions } from './create.js';
import { runQuickstart, type QuickstartOptions } from './quickstart.js';
import { runEmbeddingsIndex, runEmbeddingsGenerate, parseEmbeddingsOptions } from './embeddings.js';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { toRuntimeEmbeddingsConfig } from '../utils/embedding-transform.js';

// ============================================
// Types
// ============================================

export interface AgentOptions {
  /** Project path (default: current directory) */
  project?: string;

  /** Single question to ask (non-interactive mode) */
  ask?: string;

  /** Path to agent script to run */
  script?: string;

  /** Config file path */
  config?: string;

  /** Model to use */
  model?: string;

  /** Verbose output */
  verbose?: boolean;

  /** Development mode */
  dev?: boolean;

  /** Agent persona for conversational responses */
  persona?: string;

  /** Callback when a tool is about to be called (real-time updates for TUI) */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;

  /** Callback when a tool returns a result (real-time updates for TUI) */
  onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
}

/**
 * Mutable context shared between all tools
 * Allows dynamic project switching without recreating the agent
 *
 * Uses ProjectRegistry internally for multi-project support.
 * The context exposes the "active" project from the registry.
 */
export interface AgentProjectContext {
  /** Currently loaded project path (null if no project loaded) */
  currentProjectPath: string | null;

  /** Path to .ragforge/generated folder */
  generatedPath: string | null;

  /** Active RagClient connection */
  ragClient: ReturnType<typeof createClient> | null;

  /** Whether a project is currently loaded */
  isProjectLoaded: boolean;

  /** Dev mode flag */
  dev: boolean;

  /** Root directory for CLI */
  rootDir: string;

  /** API keys for embeddings and media generation */
  geminiKey?: string;
  replicateToken?: string;

  /** File watcher for auto-ingestion on file changes */
  fileWatcher?: FileWatcher;

  /** Incremental ingestion manager for the current project */
  incrementalManager?: IncrementalIngestionManager;

  /** Neo4j client for direct queries */
  neo4jClient?: Neo4jClient;

  /** Agent logger for structured logging */
  logger?: AgentLogger;

  /** Project registry for multi-project support */
  registry: ProjectRegistry;

  /** Brain manager for knowledge base operations */
  brainManager?: BrainManager;
}

// ============================================
// Context Management
// ============================================

/**
 * Load a project into the mutable context
 * This connects to Neo4j and enables file/RAG tools
 * Also registers the project in the registry for multi-project support
 */
async function loadProjectIntoContext(
  ctx: AgentProjectContext,
  projectPath: string
): Promise<{ success: boolean; message: string }> {
  const generatedPath = path.join(projectPath, '.ragforge', 'generated');

  // Check if project exists
  try {
    await fs.access(generatedPath);
  } catch {
    return {
      success: false,
      message: `Project not found at ${projectPath}. No .ragforge/generated folder.`,
    };
  }

  // Check if this project is already loaded in the registry
  const existingProject = ctx.registry.findByPath(projectPath);
  if (existingProject) {
    // Just switch to it instead of reloading
    ctx.registry.switch(existingProject.id);
    syncContextFromRegistry(ctx);
    return {
      success: true,
      message: `Switched to already-loaded project: ${projectPath}`,
    };
  }

  // Load project env and connect to Neo4j
  const envPath = path.join(generatedPath, '.env');
  const env = parseEnvFile(envPath);

  // Set API keys in process.env
  if (env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }
  if (env.REPLICATE_API_TOKEN) {
    process.env.REPLICATE_API_TOKEN = env.REPLICATE_API_TOKEN;
  }

  if (!env.NEO4J_URI || !env.NEO4J_USERNAME || !env.NEO4J_PASSWORD) {
    return {
      success: false,
      message: 'Neo4j credentials not found in project .env',
    };
  }

  try {
    const ragClient = createClient({
      neo4j: {
        uri: env.NEO4J_URI,
        username: env.NEO4J_USERNAME,
        password: env.NEO4J_PASSWORD,
        database: env.NEO4J_DATABASE,
      }
    });

    // Create Neo4j client for incremental ingestion
    const neo4jClient = new Neo4jClient({
      uri: env.NEO4J_URI,
      username: env.NEO4J_USERNAME,
      password: env.NEO4J_PASSWORD,
      database: env.NEO4J_DATABASE,
    });

    // Load project config
    const configPath = path.join(projectPath, 'ragforge.config.yaml');
    let config: RagForgeConfig;
    try {
      config = await ConfigLoader.load(configPath);
    } catch {
      // Try generated path as fallback
      const generatedConfigPath = path.join(generatedPath, 'ragforge.config.yaml');
      config = await ConfigLoader.load(generatedConfigPath);
    }

    // Generate project ID
    const projectId = ProjectRegistry.generateId(projectPath);

    // Create LoadedProject for the registry
    const loadedProject: LoadedProject = {
      id: projectId,
      path: projectPath,
      type: 'ragforge-project',
      config,
      neo4jClient,
      ragClient,
      status: 'active',
      lastAccessed: new Date(),
      logger: ctx.logger,
    };

    // Register the project (this will make it active)
    ctx.registry.register(loadedProject);

    // Sync context from registry
    syncContextFromRegistry(ctx);

    console.log(`   ✓ Loaded project: ${projectPath} (${projectId})`);
    console.log(`   ✓ Connected to Neo4j: ${env.NEO4J_URI}`);
    console.log(`   ✓ Projects loaded: ${ctx.registry.count}`);

    // Start file watcher for auto-ingestion
    await startFileWatcherForProject(ctx, projectPath, config);

    return {
      success: true,
      message: `Project loaded: ${projectPath}. File tools, RAG tools, and file watcher are now active.`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to connect to Neo4j: ${error.message}`,
    };
  }
}

/**
 * Sync the mutable context fields from the active project in the registry
 * Call this after any registry operation that might change the active project
 */
function syncContextFromRegistry(ctx: AgentProjectContext): void {
  const active = ctx.registry.getActive();

  if (active) {
    ctx.currentProjectPath = active.path;
    ctx.generatedPath = path.join(active.path, '.ragforge', 'generated');
    ctx.ragClient = active.ragClient;
    ctx.neo4jClient = active.neo4jClient;
    ctx.fileWatcher = active.fileWatcher;
    ctx.incrementalManager = active.incrementalManager;
    ctx.isProjectLoaded = true;
  } else {
    ctx.currentProjectPath = null;
    ctx.generatedPath = null;
    ctx.ragClient = null;
    ctx.neo4jClient = undefined;
    ctx.fileWatcher = undefined;
    ctx.incrementalManager = undefined;
    ctx.isProjectLoaded = false;
  }
}

/**
 * Start file watcher for a loaded project
 * Uses provided config to avoid reloading
 * Updates the registry's LoadedProject with watcher/manager references
 */
async function startFileWatcherForProject(
  ctx: AgentProjectContext,
  projectPath: string,
  providedConfig?: RagForgeConfig
): Promise<void> {
  if (!ctx.neo4jClient) {
    console.warn('   ⚠ Cannot start file watcher: no Neo4j client');
    return;
  }

  // Use provided config or load it
  let config: RagForgeConfig;
  if (providedConfig) {
    config = providedConfig;
  } else {
    const configPath = path.join(projectPath, 'ragforge.config.yaml');
    try {
      config = await ConfigLoader.load(configPath);
    } catch {
      console.warn(`   ⚠ Cannot start file watcher: config not found at ${configPath}`);
      return;
    }
  }

  // Find code source config
  const configSource = config.source;
  if (!configSource || configSource.type !== 'code') {
    console.warn('   ⚠ Cannot start file watcher: no code source in config');
    return;
  }

  // Create incremental ingestion manager
  const incrementalManager = new IncrementalIngestionManager(ctx.neo4jClient);
  ctx.incrementalManager = incrementalManager;

  // Create source config with absolute root
  const watcherSourceConfig: CodeSourceConfig = {
    ...(configSource as CodeSourceConfig),
    root: path.resolve(projectPath, configSource.root || '.'),
  };

  // Create afterIngestion callback to auto-generate embeddings
  const afterIngestion = async (stats: { created: number; updated: number }) => {
    if (stats.created + stats.updated === 0) return;

    // Check if embeddings config exists
    if (!config.embeddings?.entities || config.embeddings.entities.length === 0) {
      return;
    }

    // Check for Gemini API key
    const geminiKey = getEnv(['GEMINI_API_KEY'], true) || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      ctx.logger?.logSystem('embeddings', 'Skipping auto-embed: no GEMINI_API_KEY');
      return;
    }

    // Reuse existing Neo4j client from context
    if (!ctx.neo4jClient) {
      ctx.logger?.logSystem('embeddings', 'Skipping auto-embed: no Neo4j client');
      return;
    }

    try {
      // Convert config to runtime format
      const embeddingsConfig = toRuntimeEmbeddingsConfig(config.embeddings);
      if (!embeddingsConfig) {
        return;
      }

      // Create embedding provider
      const provider = new GeminiEmbeddingProvider({
        apiKey: geminiKey,
        model: embeddingsConfig.defaults?.model || 'gemini-embedding-001',
      });

      // Run embeddings for each entity (only dirty nodes)
      for (const entityConfig of embeddingsConfig.entities) {
        await runEmbeddingPipelines({
          neo4j: ctx.neo4jClient,
          entity: entityConfig,
          provider,
          defaults: embeddingsConfig.defaults,
          onlyDirty: true, // Only dirty nodes
        });
      }
    } catch (error: any) {
      // Don't fail, just log
      ctx.logger?.logSystem('embeddings', `Auto-embed failed: ${error.message}`);
    }
  };

  // Create and start file watcher
  const fileWatcher = new FileWatcher(incrementalManager, watcherSourceConfig, {
    logger: ctx.logger,
    verbose: false, // Use logger instead
    batchInterval: 1000, // 1 second batching
    afterIngestion,
  });

  try {
    await fileWatcher.start();
    ctx.fileWatcher = fileWatcher;

    // Update the registry's LoadedProject with watcher/manager references
    const activeProject = ctx.registry.getActive();
    if (activeProject) {
      activeProject.fileWatcher = fileWatcher;
      activeProject.incrementalManager = incrementalManager;
    }

    // Logger already logs via logWatcherStarted
  } catch (error: any) {
    console.warn(`   ⚠ Failed to start file watcher: ${error.message}`);
  }
}

// ============================================
// CLI Handler Implementations
// ============================================

/**
 * Create project handler - wraps runCreate and updates context
 */
function createProjectHandler(
  ctx: AgentProjectContext
): (params: CreateProjectParams) => Promise<ProjectToolResult> {
  return async (params: CreateProjectParams): Promise<ProjectToolResult> => {
    try {
      const targetPath = params.path || ctx.currentProjectPath || process.cwd();
      const createOptions: CreateOptions = {
        name: params.name,
        path: targetPath,
        dev: params.dev ?? ctx.dev,
        rag: params.rag !== false,
        geminiKey: ctx.geminiKey,
        replicateToken: ctx.replicateToken,
      };

      await runCreate(createOptions);

      const newProjectPath = path.join(targetPath, params.name);

      // Auto-load the created project into context
      const loadResult = await loadProjectIntoContext(ctx, newProjectPath);

      if (loadResult.success) {
        return {
          success: true,
          message: `Project ${params.name} created and loaded. File tools are now available.`,
          projectPath: newProjectPath,
        };
      } else {
        return {
          success: true,
          message: `Project ${params.name} created at ${newProjectPath}. Note: ${loadResult.message}`,
          projectPath: newProjectPath,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to create project: ${error.message}`,
        error: error.message,
      };
    }
  };
}

/**
 * Load project handler - loads an existing project into context
 */
function createLoadProjectHandler(
  ctx: AgentProjectContext
): (params: { path: string }) => Promise<ProjectToolResult> {
  return async (params: { path: string }): Promise<ProjectToolResult> => {
    const result = await loadProjectIntoContext(ctx, params.path);
    return {
      success: result.success,
      message: result.message,
      projectPath: result.success ? params.path : undefined,
    };
  };
}

/**
 * Setup project handler - wraps runQuickstart and updates context
 */
function createSetupHandler(
  ctx: AgentProjectContext
): (params: SetupProjectParams) => Promise<ProjectToolResult> {
  return async (params: SetupProjectParams): Promise<ProjectToolResult> => {
    try {
      const targetRoot = params.root || ctx.currentProjectPath || process.cwd();
      const quickstartOptions: QuickstartOptions = {
        sourceType: params.sourceType || 'code',
        language: params.language,
        root: targetRoot,
        ingest: params.ingest !== false,
        embeddings: params.embeddings !== false,
        force: params.force || false,
        rootDir: ctx.rootDir,
        dev: ctx.dev,
      };

      await runQuickstart(quickstartOptions);

      // Auto-load the project after setup
      const loadResult = await loadProjectIntoContext(ctx, targetRoot);

      return {
        success: true,
        message: loadResult.success
          ? 'Project setup complete and loaded. File tools are now available.'
          : `Project setup complete. Note: ${loadResult.message}`,
        stats: {
          filesProcessed: 0,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to setup project: ${error.message}`,
        error: error.message,
      };
    }
  };
}

/**
 * Ingest code handler - uses context for project path
 */
function createIngestHandler(
  ctx: AgentProjectContext
): (params: IngestCodeParams) => Promise<ProjectToolResult> {
  return async (params: IngestCodeParams): Promise<ProjectToolResult> => {
    if (!ctx.isProjectLoaded || !ctx.generatedPath) {
      return {
        success: false,
        message: 'No project loaded. Use create_project, setup_project, or load_project first.',
        error: 'No project loaded',
      };
    }

    try {
      const { execSync } = await import('child_process');

      // Run ingest command
      console.log('📦 Running code ingestion...');
      execSync('npm run ingest', {
        cwd: ctx.generatedPath,
        stdio: 'inherit',
      });

      return {
        success: true,
        message: 'Code ingestion complete',
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to ingest code: ${error.message}`,
        error: error.message,
      };
    }
  };
}

/**
 * Generate embeddings handler - uses context for project path
 */
function createEmbeddingsHandler(
  ctx: AgentProjectContext
): (params: GenerateEmbeddingsParams) => Promise<ProjectToolResult> {
  return async (params: GenerateEmbeddingsParams): Promise<ProjectToolResult> => {
    if (!ctx.isProjectLoaded || !ctx.generatedPath) {
      return {
        success: false,
        message: 'No project loaded. Use create_project, setup_project, or load_project first.',
        error: 'No project loaded',
      };
    }

    try {
      const { execSync } = await import('child_process');

      // Run embeddings commands
      if (params.indexOnly) {
        console.log('📊 Creating vector indexes...');
        execSync('npm run embeddings:index', {
          cwd: ctx.generatedPath,
          stdio: 'inherit',
        });
      } else {
        console.log('📊 Creating vector indexes...');
        execSync('npm run embeddings:index', {
          cwd: ctx.generatedPath,
          stdio: 'inherit',
        });

        console.log('🔢 Generating embeddings...');
        execSync('npm run embeddings:generate', {
          cwd: ctx.generatedPath,
          stdio: 'inherit',
        });
      }

      return {
        success: true,
        message: params.indexOnly ? 'Vector indexes created' : 'Embeddings generated',
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to generate embeddings: ${error.message}`,
        error: error.message,
      };
    }
  };
}

// ============================================
// Agent Creation
// ============================================

/**
 * Parse a .env file and return key-value pairs
 */
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return dotenv.parse(content);
  } catch {
    return {};
  }
}

/**
 * Load project environment and return parsed values
 */
function loadProjectEnv(generatedPath: string): Record<string, string> {
  const envPath = path.join(generatedPath, '.env');
  const env = parseEnvFile(envPath);

  // Also set these in process.env so that VectorSearch and other tools can use them
  if (env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }
  if (env.REPLICATE_API_TOKEN) {
    process.env.REPLICATE_API_TOKEN = env.REPLICATE_API_TOKEN;
  }

  return env;
}

/**
 * Create a RagClient by connecting directly to Neo4j using credentials from .env
 */
function createDirectRagClient(generatedPath: string): ReturnType<typeof createClient> | null {
  const env = loadProjectEnv(generatedPath);

  if (!env.NEO4J_URI || !env.NEO4J_USERNAME || !env.NEO4J_PASSWORD) {
    console.warn('⚠️  Neo4j credentials not found in .env');
    return null;
  }

  try {
    const client = createClient({
      neo4j: {
        uri: env.NEO4J_URI,
        username: env.NEO4J_USERNAME,
        password: env.NEO4J_PASSWORD,
        database: env.NEO4J_DATABASE,
      }
    });

    console.log(`   ✓ Connected to Neo4j: ${env.NEO4J_URI}`);
    return client;
  } catch (error: any) {
    console.warn(`⚠️  Failed to connect to Neo4j: ${error.message}`);
    return null;
  }
}

/**
 * Extract ToolGenerationContext from RagForgeConfig
 * This mirrors the logic in tool-generator.ts extractMetadata
 */
function extractToolContext(config: RagForgeConfig): ToolGenerationContext {
  const entities: ToolGenerationContext['entities'] = [];
  const allRelationships: ToolGenerationContext['relationships'] = [];
  const allVectorIndexes: ToolGenerationContext['vectorIndexes'] = [];

  for (const entityConfig of config.entities || []) {
    const uniqueField = entityConfig.unique_field || 'uuid';

    const searchableFields = (entityConfig.searchable_fields || []).map((f: any) => ({
      name: f.name,
      type: f.type,
      description: f.description,
      indexed: f.indexed,
      computed: false,
      values: f.values,
    }));

    const computedFields = (entityConfig.computed_fields || []).map((cf: any) => ({
      name: cf.name,
      type: cf.type,
      description: cf.description,
      expression: cf.expression,
      cypher: cf.cypher,
      materialized: cf.materialized,
    }));

    const vectorIndexes: ToolGenerationContext['vectorIndexes'] = [];
    if (entityConfig.vector_indexes) {
      for (const vi of entityConfig.vector_indexes) {
        vectorIndexes.push({
          name: vi.name,
          entityType: entityConfig.name,
          sourceField: vi.source_field,
          dimension: vi.dimension,
          provider: vi.provider,
          model: vi.model,
        });
      }
    } else if (entityConfig.vector_index) {
      const vi = entityConfig.vector_index;
      vectorIndexes.push({
        name: vi.name,
        entityType: entityConfig.name,
        sourceField: vi.source_field,
        dimension: vi.dimension,
        provider: vi.provider,
        model: vi.model,
      });
    }

    const relationships = (entityConfig.relationships || []).map((r: any) => ({
      type: r.type,
      sourceEntity: entityConfig.name,
      targetEntity: r.target,
      direction: r.direction,
      description: r.description,
    }));

    entities.push({
      name: entityConfig.name,
      description: entityConfig.description,
      uniqueField,
      displayNameField: entityConfig.display_name_field || 'name',
      queryField: entityConfig.query_field || 'name',
      contentField: entityConfig.content_field,
      exampleDisplayFields: entityConfig.example_display_fields,
      searchableFields,
      computedFields: computedFields.length > 0 ? computedFields : undefined,
      vectorIndexes,
      relationships,
      changeTracking: entityConfig.track_changes
        ? {
            enabled: true,
            contentField: entityConfig.change_tracking?.content_field || 'source',
          }
        : undefined,
      hierarchicalContent: entityConfig.hierarchical_content
        ? {
            childrenRelationship: entityConfig.hierarchical_content.children_relationship,
            includeChildren: entityConfig.hierarchical_content.include_children,
          }
        : undefined,
    });

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
 * Create a RagForge agent with all tools and mutable context
 */
export async function createRagForgeAgent(options: AgentOptions) {
  const initialProjectPath = options.project || process.cwd();
  const dev = options.dev || false;
  const verbose = options.verbose || false;
  const rootDir = ensureEnvLoaded(import.meta.url);

  // Get API keys for passing to sub-commands (create, quickstart, etc.)
  const geminiKey = getEnv(['GEMINI_API_KEY'], true) || process.env.GEMINI_API_KEY;
  const replicateToken = getEnv(['REPLICATE_API_TOKEN'], true) || process.env.REPLICATE_API_TOKEN;

  // Create project registry for multi-project support
  const registry = new ProjectRegistry({
    memoryPolicy: {
      maxLoadedProjects: 3,
      idleUnloadTimeout: 5 * 60 * 1000, // 5 minutes
    },
    onActiveProjectChanged: (projectId) => {
      if (verbose) {
        console.log(`   🔄 Active project: ${projectId || '(none)'}`);
      }
    },
  });

  // Initialize BrainManager for knowledge base operations
  let brainManager: BrainManager | undefined;
  try {
    if (verbose) {
      console.log('   🧠 Initializing BrainManager...');
    }
    brainManager = await BrainManager.getInstance();
    await brainManager.initialize();
    if (verbose) {
      console.log('   🧠 BrainManager initialized');
    }
  } catch (error: any) {
    if (verbose) {
      console.log(`   ⚠️  BrainManager init failed: ${error.message}`);
      console.log('   ⚠️  Brain tools will be disabled');
    }
  }

  // Create mutable context - this is shared by all tools
  const ctx: AgentProjectContext = {
    currentProjectPath: null,
    generatedPath: null,
    ragClient: null,
    isProjectLoaded: false,
    dev,
    rootDir,
    geminiKey,
    replicateToken,
    registry,
    brainManager,
  };

  // Cache for the current project config (updated when project changes)
  let cachedConfig: RagForgeConfig | null = null;
  let cachedContext: ToolGenerationContext | null = null;

  /**
   * Context getter for dynamic tool resolution
   * This is called by RAG tool handlers at execution time to get the current context
   * Returns null if no project is loaded, triggering helpful error messages
   */
  const getToolContext = (): ToolGenerationContext | null => {
    if (!ctx.isProjectLoaded || !ctx.currentProjectPath) {
      return null;
    }

    // Config is at .ragforge/ragforge.config.yaml (NOT in generated/)
    // Also check generated/ as fallback for compatibility
    const configPaths = [
      path.join(ctx.currentProjectPath, '.ragforge', 'ragforge.config.yaml'),
      path.join(ctx.currentProjectPath, '.ragforge', 'generated', 'ragforge.config.yaml'),
    ];

    // Try to load config synchronously (cached for performance)
    let configPath: string | null = null;
    for (const p of configPaths) {
      try {
        readFileSync(p, 'utf-8');
        configPath = p;
        break;
      } catch {
        // Try next path
      }
    }

    if (!configPath) {
      return null;
    }

    try {
      const configContent = readFileSync(configPath, 'utf-8');

      // Parse YAML config
      const config = yaml.load(configContent) as RagForgeConfig;

      // Only re-extract if config changed
      if (config !== cachedConfig) {
        cachedConfig = config;
        cachedContext = extractToolContext(config);
      }

      return cachedContext;
    } catch {
      return null;
    }
  };

  // Try to load initial project if it exists
  const configPath = options.config || path.join(initialProjectPath, '.ragforge', 'generated', 'ragforge.config.yaml');
  const generatedPath = path.join(initialProjectPath, '.ragforge', 'generated');

  let projectConfig: any = null;

  try {
    await fs.access(configPath);

    // Load config
    projectConfig = await ConfigLoader.load(configPath);

    // Load project into context
    await loadProjectIntoContext(ctx, initialProjectPath);

    // Pre-cache the initial context
    cachedConfig = projectConfig;
    cachedContext = extractToolContext(projectConfig);

  } catch {
    // No project loaded - will be shown in runAgent() output
  }

  // Get API key (check both local .env and environment variables)
  const apiKey = getEnv(['GEMINI_API_KEY'], true) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required. Set in .env or environment.');
  }

  // Minimal config for standalone mode
  const standaloneConfig = {
    name: 'ragforge-agent',
    version: '1.0.0',
    entities: [],
    neo4j: {
      uri: '${NEO4J_URI}',
      username: '${NEO4J_USERNAME}',
      password: '${NEO4J_PASSWORD}',
    },
  };

  // Create context-aware file tool handlers
  const contextAwareFileTools = createContextAwareFileTools(ctx);

  // Setup logging directory and path
  const logsDir = ctx.generatedPath
    ? path.join(ctx.generatedPath, 'logs')
    : path.join(initialProjectPath, '.ragforge-logs');
  await fs.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `agent-${getFilenameTimestamp()}.json`);

  // Create agent with all tools (file tools always available, context-aware)
  const agent = await createRagAgent({
    configPath: ctx.isProjectLoaded ? configPath : undefined,
    config: ctx.isProjectLoaded ? undefined : standaloneConfig,
    ragClient: ctx.ragClient || createDummyRagClient(ctx),
    apiKey,
    model: options.model || 'gemini-2.0-flash',
    verbose,
    logPath, // Enable logging to file

    // CRITICAL: Pass context getter for dynamic tool resolution
    // This enables RAG tools (get_schema, query_entities, etc.) to see
    // newly created/loaded projects instead of using stale static context
    contextGetter: getToolContext,

    // File tools always enabled, with dynamic projectRoot from context
    includeFileTools: true,
    projectRoot: () => ctx.currentProjectPath,  // Getter function for dynamic resolution

    // Project tools always available
    includeProjectTools: true,
    projectToolsContext: {
      currentProject: ctx.currentProjectPath || undefined,
      onCreate: createProjectHandler(ctx),
      onSetup: createSetupHandler(ctx),
      onIngest: createIngestHandler(ctx),
      onEmbeddings: createEmbeddingsHandler(ctx),
      onLoadProject: createLoadProjectHandler(ctx),
    },

    // Brain tools for knowledge base operations (if BrainManager is available)
    includeBrainTools: !!ctx.brainManager,
    brainToolsContext: ctx.brainManager ? { brain: ctx.brainManager } : undefined,

    // Agent persona for conversational responses
    persona: options.persona,

    // Real-time callbacks for TUI
    onToolCall: options.onToolCall,
    onToolResult: options.onToolResult,
  });

  return {
    agent,
    context: ctx,
    hasProject: ctx.isProjectLoaded,
    projectPath: ctx.currentProjectPath || initialProjectPath,
    generatedPath: ctx.generatedPath || generatedPath,
    logPath,
  };
}

/**
 * Create a dummy RagClient that uses the mutable context
 * This allows RAG tools to work once a project is loaded
 */
function createDummyRagClient(ctx: AgentProjectContext) {
  return {
    close: async () => {
      if (ctx.ragClient) {
        await ctx.ragClient.close();
      }
    },
    get: (entityType: string) => {
      if (!ctx.ragClient) {
        throw new Error('No project loaded. Use create_project, setup_project, or load_project first.');
      }
      return ctx.ragClient.get(entityType);
    },
    raw: (cypher: string, params?: Record<string, any>) => {
      if (!ctx.ragClient) {
        throw new Error('No project loaded. Use create_project, setup_project, or load_project first.');
      }
      return ctx.ragClient.raw(cypher, params);
    },
  };
}

/**
 * Create context-aware file tool wrappers
 * These check if a project is loaded before executing
 */
function createContextAwareFileTools(ctx: AgentProjectContext) {
  const checkProject = () => {
    if (!ctx.isProjectLoaded || !ctx.currentProjectPath) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'Use create_project to create a new project, or load_project to load an existing one.',
      };
    }
    return null;
  };

  return {
    getProjectRoot: () => ctx.currentProjectPath,
    checkProject,
  };
}

// ============================================
// Command Implementation
// ============================================

export function printAgentHelp(): void {
  console.log(`Usage:
  ragforge agent [options]

Description:
  Launch the RagForge agent with full capabilities:
  - RAG tools: Query the knowledge graph
  - File tools: Read, write, edit code files
  - Project tools: Create projects, setup Neo4j, ingest code, generate embeddings

  The agent can work in two modes:
  1. Project mode: When run in a RagForge project directory, all tools are available
  2. Standalone mode: Only project management tools (create, setup) are available

Options:
  --project <path>   Project directory (default: current directory)
  --ask <question>   Ask a single question and exit
  --model <model>    LLM model to use (default: gemini-2.0-flash)
  --config <path>    Path to ragforge.config.yaml
  --persona <text>   Agent personality (e.g., "A friendly assistant named RagForge")
  --verbose          Enable verbose output
  --dev              Development mode (use local dependencies)
  -h, --help         Show this help

Environment:
  GEMINI_API_KEY     Required for LLM operations

Examples:
  # Run agent in current project
  ragforge agent --ask "What functions handle authentication?"

  # Create a new project
  ragforge agent --ask "Create a new TypeScript project called my-api"

  # Verbose mode
  ragforge agent --verbose --ask "Show me the schema"
`);
}

export function parseAgentOptions(args: string[]): AgentOptions {
  const options: AgentOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--project':
        options.project = args[++i];
        break;
      case '--ask':
        options.ask = args[++i];
        break;
      case '--script':
        options.script = args[++i];
        break;
      case '--config':
        options.config = args[++i];
        break;
      case '--model':
        options.model = args[++i];
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--dev':
        options.dev = true;
        break;
      case '--persona':
        options.persona = args[++i];
        break;
      case '-h':
      case '--help':
        printAgentHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

export async function runAgent(options: AgentOptions): Promise<void> {
  // Create agent with mutable context (before header so we have log path)
  const { agent, context, hasProject, projectPath, logPath } = await createRagForgeAgent(options);

  // Log path FIRST - user only sees first 2 lines during execution
  console.log(`📝 Logs: ${logPath}`);
  console.log('🤖 RagForge Agent');
  console.log('═'.repeat(50));
  console.log(`📁 Project: ${hasProject ? projectPath : '(no project loaded)'}`);
  console.log(`🔧 Tools: ${agent.getTools().map(t => t.name).join(', ')}`);
  console.log('');

  try {
    if (options.ask) {
      // Single question mode
      console.log(`❓ Question: ${options.ask}`);
      console.log('');

      const result = await agent.ask(options.ask);

      console.log('═'.repeat(50));
      console.log('📤 Answer:');
      console.log(result.answer);

      if (result.toolsUsed && result.toolsUsed.length > 0) {
        console.log(`\n🔧 Tools used: ${result.toolsUsed.join(', ')}`);
      }

      // Show log path
      console.log(`\n📝 Session log: ${logPath}`);
    } else if (options.script) {
      // Script mode - run a TypeScript file that uses the agent
      console.log(`📜 Running script: ${options.script}`);
      const { execSync } = await import('child_process');
      execSync(`npx tsx ${options.script}`, {
        cwd: context.currentProjectPath || projectPath,
        stdio: 'inherit',
        env: { ...process.env, RAGFORGE_AGENT: 'true' },
      });
    } else {
      // Interactive mode (future)
      console.log('💡 Interactive mode not yet implemented.');
      console.log('   Use --ask "question" for single questions.');
      console.log('   Use --script script.ts to run agent scripts.');
    }
  } finally {
    // Dispose of all loaded projects (closes Neo4j connections, stops file watchers)
    await context.registry.dispose();
  }
}
