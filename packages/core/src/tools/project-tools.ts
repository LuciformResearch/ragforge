/**
 * Project Tools - Create, Setup, Ingest, Embeddings
 *
 * Wraps RagForge CLI commands as agent tools.
 * These tools allow an agent to manage RagForge projects programmatically.
 *
 * @since 2025-12-06
 */

import type { GeneratedToolDefinition } from './types/index.js';

// ============================================
// Types
// ============================================

/**
 * Options for creating a project
 */
export interface CreateProjectParams {
  name: string;
  path?: string;
  language?: 'typescript' | 'python';
  template?: 'minimal' | 'express' | 'fastapi';
  dev?: boolean;
  rag?: boolean;
}

/**
 * Options for setting up a project (quickstart)
 */
export interface SetupProjectParams {
  sourceType?: 'code' | 'documents';
  language?: string;
  root?: string;
  ingest?: boolean;
  embeddings?: boolean;
  force?: boolean;
}

/**
 * Options for code ingestion
 */
export interface IngestCodeParams {
  files?: string[];
  incremental?: boolean;
}

/**
 * Options for embeddings generation
 */
export interface GenerateEmbeddingsParams {
  entity?: string;
  force?: boolean;
  indexOnly?: boolean;
}

/**
 * Options for loading an existing project
 */
export interface LoadProjectParams {
  path: string;
}

/**
 * Result from a project tool operation
 */
export interface ProjectToolResult {
  success: boolean;
  message: string;
  projectPath?: string;
  stats?: {
    filesProcessed?: number;
    nodesCreated?: number;
    relationshipsCreated?: number;
    embeddingsGenerated?: number;
  };
  error?: string;
}

/**
 * Context for project tools - includes callbacks for CLI operations
 *
 * This allows the tools to be defined in core while the actual
 * CLI execution happens in the CLI package (avoiding circular deps).
 */
export interface ProjectToolsContext {
  /** Current working directory */
  workingDirectory: string;

  /** Current project path (if loaded) */
  currentProject?: string;

  /** Callback to create a new project */
  onCreate?: (params: CreateProjectParams) => Promise<ProjectToolResult>;

  /** Callback to setup/quickstart a project */
  onSetup?: (params: SetupProjectParams) => Promise<ProjectToolResult>;

  /** Callback to ingest code */
  onIngest?: (params: IngestCodeParams) => Promise<ProjectToolResult>;

  /** Callback to generate embeddings */
  onEmbeddings?: (params: GenerateEmbeddingsParams) => Promise<ProjectToolResult>;

  /** Callback to load an existing project */
  onLoadProject?: (params: LoadProjectParams) => Promise<ProjectToolResult>;

  /** Verbose logging */
  verbose?: boolean;
}

// ============================================
// Tool Definitions
// ============================================

/**
 * Generate create_project tool definition
 */
export function generateCreateProjectTool(): GeneratedToolDefinition {
  return {
    name: 'create_project',
    description: `Create a new RagForge project with TypeScript structure and RAG capabilities.

Creates a complete project with:
- package.json (ESM, TypeScript)
- tsconfig.json
- src/index.ts entry point
- .ragforge/ workspace with Neo4j and generated client

Parameters:
- name: Project name (kebab-case, e.g., "my-api")
- path: Parent directory (default: current directory)
- language: Project language (default: typescript)
- template: Project template (default: minimal)
- rag: Include RAG setup (default: true)

Example: create_project({ name: "my-api" })`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name (kebab-case, lowercase letters, numbers, hyphens)',
        },
        path: {
          type: 'string',
          description: 'Parent directory for the project (default: current directory)',
        },
        language: {
          type: 'string',
          enum: ['typescript', 'python'],
          description: 'Programming language (default: typescript)',
        },
        template: {
          type: 'string',
          enum: ['minimal', 'express', 'fastapi'],
          description: 'Project template (default: minimal)',
        },
        rag: {
          type: 'boolean',
          description: 'Include RAG setup with Neo4j (default: true)',
        },
      },
      required: ['name'],
    },
  };
}

/**
 * Generate setup_project tool definition
 */
export function generateSetupProjectTool(): GeneratedToolDefinition {
  return {
    name: 'setup_project',
    description: `Setup Neo4j and run initial code ingestion for a RagForge project.

This is equivalent to running "ragforge quickstart". It will:
1. Auto-detect project type (TypeScript, Python, etc.)
2. Create or expand ragforge.config.yaml
3. Start Neo4j with Docker Compose
4. Parse and ingest code into the knowledge graph
5. Optionally generate embeddings for semantic search

Parameters:
- sourceType: Type of source (code, documents)
- language: Force language detection (typescript, python, etc.)
- root: Source code directory to analyze
- ingest: Run code ingestion (default: true)
- embeddings: Generate embeddings (default: true)
- force: Overwrite existing configuration

Example: setup_project({ embeddings: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceType: {
          type: 'string',
          enum: ['code', 'documents'],
          description: 'Type of source to analyze (default: code)',
        },
        language: {
          type: 'string',
          description: 'Force language: typescript, python, javascript (auto-detected if omitted)',
        },
        root: {
          type: 'string',
          description: 'Source code directory to analyze (default: current directory)',
        },
        ingest: {
          type: 'boolean',
          description: 'Run code ingestion (default: true)',
        },
        embeddings: {
          type: 'boolean',
          description: 'Generate embeddings after ingestion (default: true)',
        },
        force: {
          type: 'boolean',
          description: 'Overwrite existing configuration (default: false)',
        },
      },
    },
  };
}

/**
 * Generate ingest_code tool definition
 */
export function generateIngestCodeTool(): GeneratedToolDefinition {
  return {
    name: 'ingest_code',
    description: `Re-ingest code into the Neo4j knowledge graph.

Use this after making changes to the codebase to update the graph.
Supports incremental ingestion (only changed files) or full re-ingestion.

Parameters:
- files: Specific files to ingest (optional, all if omitted)
- incremental: Use incremental ingestion (default: true)

Example: ingest_code({ incremental: true })
Example: ingest_code({ files: ["src/index.ts", "src/utils.ts"] })`,
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to ingest (optional)',
        },
        incremental: {
          type: 'boolean',
          description: 'Use incremental ingestion for changed files only (default: true)',
        },
      },
    },
  };
}

/**
 * Generate generate_embeddings tool definition
 */
export function generateEmbeddingsTool(): GeneratedToolDefinition {
  return {
    name: 'generate_embeddings',
    description: `Generate vector embeddings for semantic search.

Embeddings enable semantic similarity search on the knowledge graph.
Uses Gemini text-embedding-004 model by default.

Parameters:
- entity: Entity type to embed (default: Scope)
- force: Regenerate all embeddings (default: false, only new)
- indexOnly: Only create vector indexes, don't generate embeddings

Example: generate_embeddings({ force: false })`,
    inputSchema: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity type to generate embeddings for (default: Scope)',
        },
        force: {
          type: 'boolean',
          description: 'Regenerate all embeddings, not just missing ones (default: false)',
        },
        indexOnly: {
          type: 'boolean',
          description: 'Only create vector indexes without generating embeddings',
        },
      },
    },
  };
}

/**
 * Generate load_project tool definition
 */
export function generateLoadProjectTool(): GeneratedToolDefinition {
  return {
    name: 'load_project',
    description: `Load an existing RagForge project to work on it.

This connects to the project's Neo4j database and enables all tools:
- File tools (read_file, write_file, edit_file) become active
- RAG tools (semantic_search, query_entities) connect to the project's graph
- Project tools (ingest_code, generate_embeddings) work on this project

Use this to switch between multiple RagForge projects or to load a project
after the agent starts without one.

Parameters:
- path: Full path to the project root (where .ragforge/ folder is located)

Example: load_project({ path: "/home/user/my-project" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Full path to the project root directory',
        },
      },
      required: ['path'],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

/**
 * Generate handler for create_project
 */
export function generateCreateProjectHandler(
  ctx: ProjectToolsContext
): (args: CreateProjectParams) => Promise<ProjectToolResult> {
  return async (params: CreateProjectParams) => {
    if (!ctx.onCreate) {
      return {
        success: false,
        message: 'create_project is not available (no handler configured)',
        error: 'Handler not configured',
      };
    }

    if (ctx.verbose) {
      console.log(`🚀 Creating project: ${params.name}`);
    }

    try {
      const result = await ctx.onCreate({
        ...params,
        path: params.path || ctx.workingDirectory,
      });

      return result;
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
 * Generate handler for setup_project
 */
export function generateSetupProjectHandler(
  ctx: ProjectToolsContext
): (args: SetupProjectParams) => Promise<ProjectToolResult> {
  return async (params: SetupProjectParams) => {
    if (!ctx.onSetup) {
      return {
        success: false,
        message: 'setup_project is not available (no handler configured)',
        error: 'Handler not configured',
      };
    }

    if (ctx.verbose) {
      console.log(`🔧 Setting up project...`);
    }

    try {
      const result = await ctx.onSetup({
        ...params,
        root: params.root || ctx.currentProject || ctx.workingDirectory,
      });

      return result;
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
 * Generate handler for ingest_code
 */
export function generateIngestCodeHandler(
  ctx: ProjectToolsContext
): (args: IngestCodeParams) => Promise<ProjectToolResult> {
  return async (params: IngestCodeParams) => {
    if (!ctx.onIngest) {
      return {
        success: false,
        message: 'ingest_code is not available (no handler configured)',
        error: 'Handler not configured',
      };
    }

    if (ctx.verbose) {
      console.log(`📦 Ingesting code...`);
    }

    try {
      const result = await ctx.onIngest({
        ...params,
        incremental: params.incremental ?? true,
      });

      return result;
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
 * Generate handler for generate_embeddings
 */
export function generateEmbeddingsHandler(
  ctx: ProjectToolsContext
): (args: GenerateEmbeddingsParams) => Promise<ProjectToolResult> {
  return async (params: GenerateEmbeddingsParams) => {
    if (!ctx.onEmbeddings) {
      return {
        success: false,
        message: 'generate_embeddings is not available (no handler configured)',
        error: 'Handler not configured',
      };
    }

    if (ctx.verbose) {
      console.log(`🔢 Generating embeddings...`);
    }

    try {
      const result = await ctx.onEmbeddings({
        ...params,
        entity: params.entity || 'Scope',
      });

      return result;
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to generate embeddings: ${error.message}`,
        error: error.message,
      };
    }
  };
}

/**
 * Generate handler for load_project
 */
export function generateLoadProjectHandler(
  ctx: ProjectToolsContext
): (args: LoadProjectParams) => Promise<ProjectToolResult> {
  return async (params: LoadProjectParams) => {
    if (!ctx.onLoadProject) {
      return {
        success: false,
        message: 'load_project is not available (no handler configured)',
        error: 'Handler not configured',
      };
    }

    if (ctx.verbose) {
      console.log(`📂 Loading project: ${params.path}`);
    }

    try {
      const result = await ctx.onLoadProject(params);
      return result;
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to load project: ${error.message}`,
        error: error.message,
      };
    }
  };
}

// ============================================
// Export All Project Tools
// ============================================

export interface ProjectToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<ProjectToolResult>>;
}

/**
 * Generate all project tools with handlers
 *
 * @param ctx Context with callbacks for CLI operations
 * @returns Tools and handlers for project management
 *
 * @example
 * ```typescript
 * const projectTools = generateProjectTools({
 *   workingDirectory: process.cwd(),
 *   onCreate: async (params) => {
 *     await runCreate({ name: params.name, path: params.path, dev: true, rag: true });
 *     return { success: true, message: `Project ${params.name} created` };
 *   },
 *   onSetup: async (params) => {
 *     await runQuickstart({ ...params, rootDir: process.cwd() });
 *     return { success: true, message: 'Project setup complete' };
 *   },
 * });
 *
 * // Add to agent
 * tools.push(...projectTools.tools);
 * Object.assign(handlers, projectTools.handlers);
 * ```
 */
export function generateProjectTools(ctx: ProjectToolsContext): ProjectToolsResult {
  const tools: GeneratedToolDefinition[] = [];
  const handlers: Record<string, (args: any) => Promise<ProjectToolResult>> = {};

  // Only include tools that have handlers configured
  if (ctx.onCreate) {
    tools.push(generateCreateProjectTool());
    handlers['create_project'] = generateCreateProjectHandler(ctx);
  }

  if (ctx.onSetup) {
    tools.push(generateSetupProjectTool());
    handlers['setup_project'] = generateSetupProjectHandler(ctx);
  }

  if (ctx.onIngest) {
    tools.push(generateIngestCodeTool());
    handlers['ingest_code'] = generateIngestCodeHandler(ctx);
  }

  if (ctx.onEmbeddings) {
    tools.push(generateEmbeddingsTool());
    handlers['generate_embeddings'] = generateEmbeddingsHandler(ctx);
  }

  if (ctx.onLoadProject) {
    tools.push(generateLoadProjectTool());
    handlers['load_project'] = generateLoadProjectHandler(ctx);
  }

  return { tools, handlers };
}
