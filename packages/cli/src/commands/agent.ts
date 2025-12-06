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
import {
  createRagAgent,
  createClient,
  ConfigLoader,
  getFilenameTimestamp,
  type ProjectToolResult,
  type CreateProjectParams,
  type SetupProjectParams,
  type IngestCodeParams,
  type GenerateEmbeddingsParams,
} from '@luciformresearch/ragforge';
import { runCreate, type CreateOptions } from './create.js';
import { runQuickstart, type QuickstartOptions } from './quickstart.js';
import { runEmbeddingsIndex, runEmbeddingsGenerate, parseEmbeddingsOptions } from './embeddings.js';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';

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
}

/**
 * Mutable context shared between all tools
 * Allows dynamic project switching without recreating the agent
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
}

// ============================================
// Context Management
// ============================================

/**
 * Load a project into the mutable context
 * This connects to Neo4j and enables file/RAG tools
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

  // Close existing connection if any
  if (ctx.ragClient) {
    try {
      await ctx.ragClient.close();
    } catch {
      // Ignore close errors
    }
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
    const client = createClient({
      neo4j: {
        uri: env.NEO4J_URI,
        username: env.NEO4J_USERNAME,
        password: env.NEO4J_PASSWORD,
        database: env.NEO4J_DATABASE,
      }
    });

    // Update context
    ctx.currentProjectPath = projectPath;
    ctx.generatedPath = generatedPath;
    ctx.ragClient = client;
    ctx.isProjectLoaded = true;

    console.log(`   ✓ Loaded project: ${projectPath}`);
    console.log(`   ✓ Connected to Neo4j: ${env.NEO4J_URI}`);

    return {
      success: true,
      message: `Project loaded: ${projectPath}. File tools and RAG tools are now available.`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to connect to Neo4j: ${error.message}`,
    };
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
 * Create a RagForge agent with all tools and mutable context
 */
export async function createRagForgeAgent(options: AgentOptions) {
  const initialProjectPath = options.project || process.cwd();
  const dev = options.dev || false;
  const verbose = options.verbose || false;
  const rootDir = ensureEnvLoaded(import.meta.url);

  // Create mutable context - this is shared by all tools
  const ctx: AgentProjectContext = {
    currentProjectPath: null,
    generatedPath: null,
    ragClient: null,
    isProjectLoaded: false,
    dev,
    rootDir,
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

  } catch {
    console.log('📋 No project loaded. Project management and file tools available.');
    console.log('   Use create_project or load_project to start working on a project.');
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

  if (verbose) {
    console.log(`   📝 Agent logs: ${logPath}`);
  }

  // Create agent with all tools (file tools always available, context-aware)
  const agent = await createRagAgent({
    configPath: ctx.isProjectLoaded ? configPath : undefined,
    config: ctx.isProjectLoaded ? undefined : standaloneConfig,
    ragClient: ctx.ragClient || createDummyRagClient(ctx),
    apiKey,
    model: options.model || 'gemini-2.0-flash',
    verbose,
    logPath, // Enable logging to file

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
  console.log('🤖 RagForge Agent');
  console.log('═'.repeat(50));

  // Create agent with mutable context
  const { agent, context, hasProject, projectPath, logPath } = await createRagForgeAgent(options);

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
    // Close the context's ragClient if it exists
    if (context.ragClient) {
      await context.ragClient.close();
    }
  }
}
