/**
 * Brain Tools
 *
 * Tools for interacting with the agent's persistent brain:
 * - ingest_directory: Quick ingest any directory into the brain
 * - ingest_web_page: Ingest a web page into the brain
 * - brain_search: Search across all knowledge in the brain
 * - forget_path: Remove knowledge about a path from the brain
 *
 * @since 2025-12-07
 */

import { BrainManager, type QuickIngestOptions, type BrainSearchOptions, type QuickIngestResult, type UnifiedSearchResult } from '../brain/index.js';
import type { GeneratedToolDefinition } from './types/index.js';
import { getGlobalFetchCache, type CachedFetchResult } from './web-tools.js';
import { NODE_SCHEMAS, CONTENT_NODE_LABELS, type NodeTypeSchema } from '../utils/node-schema.js';
import { isDocumentFile, parseDocumentFile, type DocumentFileInfo } from '../runtime/adapters/document-file-parser.js';
import * as path from 'path';

// Image file extensions
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

/**
 * Gemini Vision fallback for low-confidence OCR
 * Used by parseDocumentFile when Tesseract OCR confidence is too low
 */
async function geminiVisionFallback(imageBuffer: Buffer, prompt: string): Promise<string> {
  const { getOCRService } = await import('../runtime/index.js');
  const ocrService = getOCRService({ primaryProvider: 'gemini' });

  if (!ocrService.isAvailable()) {
    throw new Error('Gemini Vision not available. Set GEMINI_API_KEY.');
  }

  // pdf-to-img outputs PNG images
  const result = await ocrService.extractTextFromData(imageBuffer, 'image/png', { prompt });
  if (result.error) {
    throw new Error(result.error);
  }

  return result.text || '';
}

/**
 * Context for brain tools
 */
export interface BrainToolsContext {
  brain: BrainManager;
}

// ============================================
// create_project
// ============================================

/**
 * Generate create_project tool definition
 */
export function generateCreateProjectTool(): GeneratedToolDefinition {
  return {
    name: 'create_project',
    description: `Create a new TypeScript project and register it in the brain.

Creates a minimal project structure:
- package.json (ESM, TypeScript, tsx)
- tsconfig.json
- src/index.ts
- .gitignore

The project is automatically ingested into the brain for RAG queries.

Parameters:
- name: Project name (kebab-case, e.g., "my-app")
- path: Parent directory (default: current directory)
- install_deps: Run npm install (default: false)
- ingest: Auto-ingest into brain (default: true)
- generate_embeddings: Generate embeddings for search (default: true)

Example: create_project({ name: "my-api" })
Example: create_project({ name: "my-app", path: "/projects", install_deps: true })`,
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
        install_deps: {
          type: 'boolean',
          description: 'Run npm install after creation (default: false)',
        },
        ingest: {
          type: 'boolean',
          description: 'Auto-ingest into brain after creation (default: true)',
        },
        generate_embeddings: {
          type: 'boolean',
          description: 'Generate embeddings for semantic search (default: true)',
        },
      },
      required: ['name'],
    },
  };
}

/**
 * Result type for create_project
 */
interface CreateProjectResult {
  success: boolean;
  projectPath: string;
  projectId?: string;
  filesCreated: string[];
  ingested: boolean;
  embeddingsGenerated: number;
  watching?: boolean;
  error?: string;
}

/**
 * Generate handler for create_project
 */
export function generateCreateProjectHandler(ctx: BrainToolsContext) {
  return async (params: {
    name: string;
    path?: string;
    install_deps?: boolean;
    ingest?: boolean;
    generate_embeddings?: boolean;
  }): Promise<CreateProjectResult> => {
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const { fileURLToPath } = await import('url');

    const {
      name,
      path: parentPath = process.cwd(),
      install_deps = false,
      ingest = true,
      generate_embeddings = true,
    } = params;

    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        success: false,
        projectPath: '',
        filesCreated: [],
        ingested: false,
        embeddingsGenerated: 0,
        error: 'Project name must be kebab-case (lowercase letters, numbers, hyphens)',
      };
    }

    const projectPath = pathModule.join(parentPath, name);
    const filesCreated: string[] = [];

    try {
      // Check if directory already exists
      try {
        await fs.access(projectPath);
        return {
          success: false,
          projectPath,
          filesCreated: [],
          ingested: false,
          embeddingsGenerated: 0,
          error: `Directory already exists: ${projectPath}`,
        };
      } catch {
        // Directory doesn't exist, good!
      }

      // Load templates
      const loadTemplate = async (templateName: string): Promise<string> => {
        // Find templates directory relative to this file
        const currentFile = fileURLToPath(import.meta.url);
        const currentDir = pathModule.dirname(currentFile);
        // Go up to src, then to templates (which is copied to dist/templates at build time)
        const templatesDir = pathModule.resolve(currentDir, '..', '..', 'templates', 'create-project');
        const templatePath = pathModule.join(templatesDir, templateName);
        const content = await fs.readFile(templatePath, 'utf-8');
        return content.replace(/\{\{PROJECT_NAME\}\}/g, name);
      };

      // Create directories
      await fs.mkdir(projectPath, { recursive: true });
      await fs.mkdir(pathModule.join(projectPath, 'src'), { recursive: true });

      // Write files
      const packageJson = await loadTemplate('package.json.template');
      await fs.writeFile(pathModule.join(projectPath, 'package.json'), packageJson);
      filesCreated.push('package.json');

      const tsconfig = await loadTemplate('tsconfig.json.template');
      await fs.writeFile(pathModule.join(projectPath, 'tsconfig.json'), tsconfig);
      filesCreated.push('tsconfig.json');

      const indexTs = await loadTemplate('index.ts.template');
      await fs.writeFile(pathModule.join(projectPath, 'src', 'index.ts'), indexTs);
      filesCreated.push('src/index.ts');

      const gitignore = await loadTemplate('gitignore.template');
      await fs.writeFile(pathModule.join(projectPath, '.gitignore'), gitignore);
      filesCreated.push('.gitignore');

      // Optional: npm install
      if (install_deps) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        try {
          await execAsync('npm install', { cwd: projectPath });
        } catch (e: any) {
          // Non-fatal, just warn
          console.warn(`npm install failed: ${e.message}`);
        }
      }

      // Ingest into brain
      let projectId: string | undefined;
      let embeddingsGenerated = 0;

      if (ingest) {
        const result = await ctx.brain.quickIngest(projectPath, {
          projectName: name,
        });
        projectId = result.projectId;
        embeddingsGenerated = result.stats?.embeddingsGenerated || 0;

        // Start file watcher for auto-ingestion on changes
        try {
          await ctx.brain.startWatching(projectPath, { verbose: false });
        } catch (e: any) {
          console.warn(`[create_project] Could not start file watcher: ${e.message}`);
        }
      }

      return {
        success: true,
        projectPath,
        projectId,
        filesCreated,
        ingested: ingest,
        embeddingsGenerated,
        watching: ingest, // file watcher started if ingested
      };

    } catch (error: any) {
      return {
        success: false,
        projectPath,
        filesCreated,
        ingested: false,
        embeddingsGenerated: 0,
        error: error.message,
      };
    }
  };
}

// ============================================
// ingest_directory
// ============================================

/**
 * Generate ingest_directory tool definition
 */
export function generateIngestDirectoryTool(): GeneratedToolDefinition {
  return {
    name: 'ingest_directory',
    description: `Ingest any directory into the agent's persistent brain.

This tool allows quick ingestion of code, documents, or any files into the knowledge base.
Files are automatically detected and parsed based on their extension:
- Code: TypeScript, JavaScript, Python, Vue, Svelte, HTML, CSS
- Documents: PDF, DOCX, XLSX, CSV
- Data: JSON, YAML, XML
- Media: Images (with OCR/description), 3D models
- Markdown files

After ingestion, you can search across all ingested content using brain_search.

Example usage:
- ingest_directory({ path: "/path/to/project" })
- ingest_directory({ path: "./docs", project_name: "my-docs" })
- ingest_directory({ path: "./images", analyze_images: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory to ingest (absolute or relative)',
        },
        project_name: {
          type: 'string',
          description: 'Optional custom name for this ingested content (default: auto-generated from path)',
        },
        include: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to include (default: auto-detect based on files present)',
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude (default: node_modules, .git, dist, etc.)',
        },
        analyze_images: {
          type: 'boolean',
          description: 'Analyze images with Gemini Vision to generate descriptions (default: false). Enables semantic search on images.',
        },
        analyze_3d: {
          type: 'boolean',
          description: 'Analyze 3D models (.glb, .gltf) by rendering and describing them (default: false). Slower but enables semantic search on 3D assets.',
        },
        ocr_documents: {
          type: 'boolean',
          description: 'Run OCR on scanned PDF documents (default: false). Useful for PDFs that are scanned images.',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate handler for ingest_directory
 */
export function generateIngestDirectoryHandler(ctx: BrainToolsContext) {
  return async (params: {
    path: string;
    project_name?: string;
    include?: string[];
    exclude?: string[];
    analyze_images?: boolean;
    analyze_3d?: boolean;
    ocr_documents?: boolean;
  }): Promise<QuickIngestResult> => {
    const options: QuickIngestOptions = {
      projectName: params.project_name,
      include: params.include,
      exclude: params.exclude,
      analyzeImages: params.analyze_images,
      analyze3d: params.analyze_3d,
      ocrDocuments: params.ocr_documents,
    };

    return ctx.brain.quickIngest(params.path, options);
  };
}

// ============================================
// brain_search
// ============================================

/**
 * Generate brain_search tool definition
 * Test edit 2
 */
export function generateBrainSearchTool(): GeneratedToolDefinition {
  return {
    name: 'brain_search',
    description: `Search across all knowledge in the agent's brain.

This searches everything the agent has ever explored:
- Code projects (RagForge projects)
- Quick-ingested directories
- Web pages crawled
- Documents analyzed

**RECOMMENDED: Use semantic=true for best results.**
Semantic search uses embeddings to find meaning, not just exact text matches.
It works across languages and finds conceptually related content.

For text search (semantic=false), uses exact text matching (CONTAINS).
For fuzzy search with typo tolerance on files, use search_files instead.

Example usage:
- brain_search({ query: "authentication logic", semantic: true, boost_keywords: ["AuthService", "login", "validateToken"] })
- brain_search({ query: "how to parse JSON", semantic: true, boost_keywords: ["parseJSON", "JSONParser", "deserialize"] })
- brain_search({ query: "API endpoints", semantic: true, boost_keywords: ["router", "endpoint", "handleRequest"] })

**Pro tip**: If you know (or can guess) function/class/variable names that would be relevant to the search, add them to boost_keywords. This prioritizes results containing those names - even fuzzy matches work.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for',
        },
        projects: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limit search to specific project IDs (default: all projects)',
        },
        types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limit to specific node types (lowercase): "function", "method", "class", "interface", "variable", "file" (default: all)',
        },
        semantic: {
          type: 'boolean',
          description: 'Use semantic/embedding-based search (default: false, uses text matching). **Recommended: true** for best results. Automatically combines vector similarity with BM25 keyword matching via RRF fusion.',
        },
        embedding_type: {
          type: 'string',
          enum: ['name', 'content', 'description', 'all'],
          description: `Which embedding to use for semantic search:
- "name": search by file names, function signatures (for "find the auth function")
- "content": search by code/text content (for "code that validates JWT")
- "description": search by docstrings, descriptions (for "documented as authentication")
- "all": search all embeddings and merge results (default)`,
        },
        glob: {
          type: 'string',
          optional: true,
          description: 'Filter results by file path glob pattern (e.g., "**/*.ts", "src/tools/*.ts"). Optional, no filtering by default.',
        },
        base_path: {
          type: 'string',
          optional: true,
          description: 'Filter results to only include files under this absolute path (e.g., "/home/user/project"). Useful for limiting search to a specific directory.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
        },
        use_reranking: {
          type: 'boolean',
          optional: true,
          description: `Use LLM reranking to improve result relevance using executeLLMBatch.
When true, results are reranked using StructuredLLMExecutor.executeReranking().
Requires GEMINI_API_KEY environment variable.`,
        },
        min_score: {
          type: 'number',
          optional: true,
          description: `Minimum similarity score threshold (0.0 to 1.0). Results below this score will be filtered out.
Default: 0.3 for semantic search (recommended range: 0.3-0.7), no filter for text search.
Lower values (0.1-0.3) return more results but may include less relevant matches.
Higher values (0.7-0.9) return fewer but more precise results.`,
        },
        boost_keywords: {
          type: 'array',
          items: { type: 'string' },
          optional: true,
          description: `Keywords to boost in results using fuzzy matching (Levenshtein distance).
Results containing these keywords (exact or fuzzy match) get a score boost.
Useful when you know specific function/class names that should be prioritized.
Example: ["buildEnrichedContext", "searchCode"] will boost results matching these names.`,
        },
        boost_weight: {
          type: 'number',
          optional: true,
          description: `Maximum score boost per keyword match (default: 0.15).
The actual boost is proportional to Levenshtein similarity:
- Exact match (1.0 similarity) → full boost_weight added
- Fuzzy match (0.8 similarity) → 80% of boost_weight added
- No match (< 0.6 similarity) → no boost`,
        },
        explore_depth: {
          type: 'number',
          optional: true,
          description: `Auto-discover and explore relationships for each result (0=disabled, 1-3=depth).
When enabled, each result will include a 'relationships' object showing what the node:
- CONSUMES (dependencies)
- CONSUMED_BY (consumers)
- INHERITS_FROM (inheritance)
- And any other relationships discovered automatically

This helps understand how search results connect to other parts of the codebase.
Default: 0 (disabled). Use 1 for direct relationships, 2-3 for deeper exploration.`,
        },
        summarize: {
          type: 'boolean',
          optional: true,
          description: `Summarize search results using LLM to extract relevant snippets with line numbers.
When enabled, returns a compact summary instead of full results, with:
- Relevant code/content snippets with exact line numbers
- Brief explanation of why each result is relevant
- Key findings synthesized from results

This reduces context size and focuses attention on the most relevant information.
Default: false. Requires GEMINI_API_KEY.`,
        },
        summarize_context: {
          type: 'string',
          optional: true,
          description: `Additional context for summarization (e.g., the agent's reasoning at the time of search).
Only used when summarize=true. Helps the LLM understand what information is being sought.`,
        },
        fuzzy_distance: {
          type: 'number',
          optional: true,
          description: `Fuzzy matching edit distance for BM25 text search (0, 1, or 2).
Only applies when semantic=false (BM25 mode).
- 0: Exact match only (no typo tolerance)
- 1: Allow 1 character difference (default, good for small typos)
- 2: Allow 2 character differences (more tolerant, may return less relevant results)`,
        },
      },
      required: ['query'],
    },
  };
}

/**
 * Generate handler for brain_search
 */
export function generateBrainSearchHandler(ctx: BrainToolsContext) {
  return async (params: {
    query: string;
    projects?: string[];
    types?: string[];
    semantic?: boolean;
    embedding_type?: 'name' | 'content' | 'description' | 'all';
    glob?: string;
    base_path?: string;
    limit?: number;
    use_reranking?: boolean;
    min_score?: number;
    boost_keywords?: string[];
    boost_weight?: number;
    explore_depth?: number;
    summarize?: boolean;
    summarize_context?: string;
    fuzzy_distance?: 0 | 1 | 2;
  }): Promise<UnifiedSearchResult & {
    waited_for_edits?: boolean;
    watchers_started?: string[];
    flushed_projects?: string[];
    reranked?: boolean;
    keyword_boosted?: boolean;
    relationships_explored?: boolean;
    summarized?: boolean;
    summary?: {
      snippets: Array<{
        uuid: string;
        file: string;
        lines: string;
        content: string;
        relevance: string;
      }>;
      findings: string;
      suggestions?: Array<{ type: string; target: string; reason: string }>;
    };
    graph?: {
      nodes: Array<{
        uuid: string;
        name: string;
        type: string;
        file?: string;
        score: number | null;
        isSearchResult: boolean;
      }>;
      edges: Array<{
        from: string;
        to: string;
        type: string;
      }>;
    };
  }> => {
    const { createLogger } = await import('../runtime/utils/logger.js');
    const log = createLogger('brain_search');
    
    const startTime = Date.now();
    log.info('START', { query: params.query, semantic: params.semantic ?? false });
    
    let waitedForSync = false;
    const watchersStarted: string[] = [];
    const flushedProjects: string[] = [];

    try {
      // Determine target projects (filter by params.projects if specified)
      log.debug('Step 1: Listing projects');
      const allProjects = ctx.brain.listProjects();
      log.debug(`Found ${allProjects.length} total projects`);

      const targetProjects = params.projects
        ? allProjects.filter(p => params.projects!.includes(p.id))
        : allProjects;

      // Include touched-files (orphan files) in search when user doesn't specify projects
      // Filter by cwd to only include relevant orphan files
      const includeTouchedFiles = !params.projects;
      const touchedFilesBasePath = includeTouchedFiles ? process.cwd() : undefined;
      log.debug(`Targeting ${targetProjects.length} projects`, {
        includeTouchedFiles,
        touchedFilesBasePath: touchedFilesBasePath ? touchedFilesBasePath.substring(0, 50) : undefined
      });

      // For each project, ensure it's synced before searching
      log.info('Step 2: Ensuring projects are synced', { projectCount: targetProjects.length });
      for (let i = 0; i < targetProjects.length; i++) {
        const project = targetProjects[i];
        log.debug(`Syncing project ${i + 1}/${targetProjects.length}`, { projectId: project.id, path: project.path });
        const syncStart = Date.now();
        const syncResult = await ensureProjectSynced(ctx.brain, project.path);
        const syncDuration = Date.now() - syncStart;
        log.debug(`Project synced`, { 
          projectId: project.id, 
          duration: syncDuration, 
          waited: syncResult.waited, 
          watcherStarted: syncResult.watcherStarted, 
          flushed: syncResult.flushed 
        });
        
        if (syncResult.waited) waitedForSync = true;
        if (syncResult.watcherStarted) watchersStarted.push(project.id);
        if (syncResult.flushed) flushedProjects.push(project.id);
      }
      log.info('Step 2 complete - all projects synced');

      // Also wait for agent edit queue (MCP tools use a separate queue)
      log.debug('Step 3: Checking for pending MCP edits');
      const hasPendingEdits = ctx.brain.hasPendingEdits();
      log.debug(`Has pending edits: ${hasPendingEdits}`);
      if (hasPendingEdits) {
        log.info('Waiting for pending MCP edits to flush...');
        const editWaitStart = Date.now();
        const flushed = await ctx.brain.waitForPendingEdits(300000); // 5 minutes
        const editWaitDuration = Date.now() - editWaitStart;
        log.info('MCP edits wait complete', { duration: editWaitDuration, flushed });
        waitedForSync = true;
        if (!flushed) {
          log.warn('Timeout waiting for MCP edits - proceeding with potentially stale data');
        }
      }

      // Final check: wait for locks (in case something started after our checks)
      log.info('Step 4: Checking locks', { semantic: params.semantic });
      const ingestionLock = ctx.brain.getIngestionLock();
      const isIngestionLocked = ingestionLock.isLocked();
      log.info(`Ingestion lock locked: ${isIngestionLocked}`);
      
      // Always wait for ingestion lock (data consistency)
      if (isIngestionLocked) {
        log.info('Waiting for ingestion lock...', { description: ingestionLock.getDescription() });
        const lockWaitStart = Date.now();
        const unlocked = await ingestionLock.waitForUnlock(300000); // 5 minutes
        const lockWaitDuration = Date.now() - lockWaitStart;
        log.info('Ingestion lock wait complete', { duration: lockWaitDuration, unlocked });
        waitedForSync = true;
        if (!unlocked) {
          log.warn('Timeout waiting for ingestion lock - proceeding with potentially stale data');
        }
      }

      // Only wait for embedding lock if semantic search is requested
      if (params.semantic) {
        const embeddingLock = ctx.brain.getEmbeddingLock();
        const isEmbeddingLocked = embeddingLock.isLocked();
        log.info(`Embedding lock locked: ${isEmbeddingLocked}`, { semantic: true });
        if (isEmbeddingLocked) {
          log.info('Waiting for embedding lock (semantic search requires embeddings)...', { description: embeddingLock.getDescription() });
          const embeddingLockWaitStart = Date.now();
          const embeddingUnlocked = await embeddingLock.waitForUnlock(300000); // 5 minutes
          const embeddingLockWaitDuration = Date.now() - embeddingLockWaitStart;
          log.info('Embedding lock wait complete', { duration: embeddingLockWaitDuration, unlocked: embeddingUnlocked });
          waitedForSync = true;
          if (!embeddingUnlocked) {
            log.warn('Timeout waiting for embedding lock - proceeding with potentially incomplete embeddings');
          }
        }
      } else {
        const embeddingLock = ctx.brain.getEmbeddingLock();
        const isEmbeddingLocked = embeddingLock.isLocked();
        log.info('Non-semantic search - skipping embedding lock wait', {
          embeddingLocked: isEmbeddingLocked,
          canProceedDuringEmbedding: true,
          description: isEmbeddingLocked ? embeddingLock.getDescription() : undefined
        });
      }

      // Step 4b: Process orphan files in cwd (touched-files outside projects)
      // Only for semantic search - text search doesn't need embeddings
      if (params.semantic) {
        const cwd = process.cwd();
        const pendingCount = await ctx.brain.countPendingOrphans(cwd);
        if (pendingCount > 0) {
          log.info('Processing orphan files in cwd', { cwd, pendingCount });
          const orphanStart = Date.now();
          const orphanStats = await ctx.brain.processOrphanFilesInDirectory(cwd, 30000);
          const orphanDuration = Date.now() - orphanStart;
          log.info('Orphan files processed', {
            duration: orphanDuration,
            parsed: orphanStats.parsed,
            embedded: orphanStats.embedded,
            errors: orphanStats.errors
          });
          if (orphanStats.parsed > 0 || orphanStats.embedded > 0) {
            waitedForSync = true;
          }
        }
      }

      log.info('Step 5: Executing search');
      // For reranking or keyword boosting with semantic search, we need more candidates
      // Minimum 100 results, then apply limit after reranking/boosting
      const originalLimit = params.limit || 20;
      const needsMoreCandidates = params.semantic && (params.use_reranking || (params.boost_keywords && params.boost_keywords.length > 0));
      const searchLimit = needsMoreCandidates
        ? Math.max(originalLimit, 100)
        : originalLimit;
      
      const options: BrainSearchOptions = {
        projects: params.projects,
        nodeTypes: params.types,
        semantic: params.semantic,
        // Automatically enable hybrid search (semantic + BM25 with RRF fusion) when semantic is true
        hybrid: params.semantic === true,
        embeddingType: params.embedding_type,
        glob: params.glob,
        basePath: params.base_path,
        limit: searchLimit,
        minScore: params.min_score,
        // Include orphan files under cwd when user doesn't specify projects
        touchedFilesBasePath,
        // Fuzzy distance for BM25 search (only applies when semantic=false)
        fuzzyDistance: params.fuzzy_distance,
      };
      const searchStart = Date.now();
      let result = await ctx.brain.search(params.query, options);
      const searchDuration = Date.now() - searchStart;
      log.info('Search complete', { 
        duration: searchDuration, 
        resultCount: result.totalCount,
        searchLimit,
        originalLimit,
        willRerank: params.use_reranking && params.semantic
      });

      // Apply reranking if requested
      let reranked = false;
      if (params.use_reranking && result.results && result.results.length > 0) {
        log.info('Step 6: Applying LLM reranking', { resultCount: result.results.length });
        const rerankStart = Date.now();
        
        try {
          const { LLMReranker } = await import('../runtime/reranking/llm-reranker.js');
          const { GeminiAPIProvider } = await import('../runtime/reranking/gemini-api-provider.js');
          // EntityContext is an interface, we'll define it inline for brain search
          
          // Get Gemini API key from BrainManager config (loaded from ~/.ragforge/.env)
          const geminiKey = ctx.brain.getGeminiKey() || process.env.GEMINI_API_KEY;
          if (!geminiKey) {
            log.warn('GEMINI_API_KEY not found in ~/.ragforge/.env or process.env, skipping reranking');
          } else {
            // Create provider with the key from BrainManager (not fromEnv which only checks process.env)
            const provider = new GeminiAPIProvider({
              apiKey: geminiKey,
              model: 'gemini-2.0-flash',
            });
            
            // Create a generic EntityContext for brain search results
            // Brain search returns various node types (Scope, File, MarkdownSection, etc.)
            // Using Gemini Flash 2.0 (1M tokens) - we can send much more context
            const entityContext = {
              type: 'BrainNode',
              displayName: 'search results',
              uniqueField: 'uuid',
              queryField: 'name',
              fields: [
                { name: 'uuid', label: 'ID', required: true },
                { name: 'name', label: 'Name', maxLength: 500 },
                { name: 'title', label: 'Title', maxLength: 500 },
                { name: 'file', label: 'File', maxLength: 500 },
                { name: 'path', label: 'Path', maxLength: 500 },
                { name: 'source', label: 'Source', maxLength: 20000 }, // Full source code
                { name: 'content', label: 'Content', maxLength: 20000 }, // Full content
                { name: 'ownContent', label: 'Own Content', maxLength: 20000 },
                { name: 'docstring', label: 'Documentation', maxLength: 5000 }, // Full docstrings
                { name: 'signature', label: 'Signature', maxLength: 1000 },
                { name: 'type', label: 'Type', maxLength: 100 },
                { name: 'rawText', label: 'Raw Text', maxLength: 20000 },
                { name: 'textContent', label: 'Text Content', maxLength: 20000 },
                { name: 'code', label: 'Code', maxLength: 20000 },
                { name: 'indexedAt', label: 'Indexed At', maxLength: 50 }, // Date when item was indexed (for recency preference)
              ],
              enrichments: [],
            };
            
            // Convert results to SearchResult format for reranking
            const searchResults = result.results.map(r => ({
              entity: r.node,
              score: r.score,
            }));
            
            // Create reranker with options optimized for Gemini Flash 2.0 (1M token context)
            // batchSize: 100 to match searchLimit (exactly 100 items per batch)
            // topK should be at least the searchLimit (we'll rerank all candidates, then apply limit)
            const reranker = new LLMReranker(provider, {
              batchSize: 100, // Exactly 100 items per batch (matches searchLimit)
              parallel: 5,
              minScore: 0.0,
              topK: searchLimit, // Rerank all candidates we retrieved
              scoreMerging: 'weighted',
              weights: { vector: 0.3, llm: 0.7 },
            }, entityContext);
            
            // Execute reranking
            const rerankResult = await reranker.rerank({
              userQuestion: params.query,
              results: searchResults,
              queryContext: `Search query: "${params.query}"\nSemantic: ${params.semantic || false}\nProjects: ${params.projects?.join(', ') || 'all'}`,
            });
            
            // Log complete LLM response for debugging
            log.info('Reranking complete LLM response', { 
              evaluationCount: rerankResult.evaluations.length,
              resultCount: searchResults.length,
              evaluations: rerankResult.evaluations.map(e => ({
                scopeId: e.scopeId,
                score: e.score,
                relevant: e.relevant,
                reasoning: e.reasoning?.substring(0, 100), // First 100 chars of reasoning
              })),
              queryFeedback: rerankResult.queryFeedback,
            });
            
            // Log UUID comparison for debugging
            const evaluationIds = rerankResult.evaluations.map(e => e.scopeId);
            const resultUuids = searchResults.map(r => r.entity.uuid);
            const matchingIds = evaluationIds.filter(id => resultUuids.includes(id));
            const missingInResults = evaluationIds.filter(id => !resultUuids.includes(id));
            const missingInEvaluations = resultUuids.filter(uuid => !evaluationIds.includes(uuid));
            
            log.info('UUID comparison', {
              totalEvaluations: evaluationIds.length,
              totalResults: resultUuids.length,
              matchingIds: matchingIds.length,
              missingInResults: missingInResults.slice(0, 10), // First 10 missing
              missingInEvaluations: missingInEvaluations.slice(0, 10), // First 10 missing
              sampleEvaluationIds: evaluationIds.slice(0, 5),
              sampleResultUuids: resultUuids.slice(0, 5),
            });
            
            // Warn if there's a significant mismatch
            if (matchingIds.length === 0 && evaluationIds.length > 0 && resultUuids.length > 0) {
              log.error('CRITICAL: No matching UUIDs between evaluations and results! This will cause empty results.', {
                evaluationIdsSample: evaluationIds.slice(0, 10),
                resultUuidsSample: resultUuids.slice(0, 10),
              });
            } else if (matchingIds.length < Math.min(evaluationIds.length, resultUuids.length) * 0.5) {
              log.warn('Significant UUID mismatch detected', {
                matchRatio: matchingIds.length / Math.min(evaluationIds.length, resultUuids.length),
                matchingIds: matchingIds.length,
                totalEvaluations: evaluationIds.length,
                totalResults: resultUuids.length,
              });
            }
            
            // Store original results before reranking as fallback
            const originalResultsBeforeReranking = [...result.results];
            
            if (rerankResult.evaluations.length === 0) {
              log.warn('No evaluations returned from reranking, keeping original results');
              // Keep original results if no evaluations - result.results already contains them
            } else {
              // Merge scores using reranker's mergeScores method
              const rerankedResults = reranker.mergeScores(
                searchResults,
                rerankResult.evaluations,
                'weighted',
                { vector: 0.3, llm: 0.7 }
              );
              
              log.info('Merged reranked results', { 
                mergedCount: rerankedResults.length,
                originalCount: searchResults.length,
                evaluationCount: rerankResult.evaluations.length
              });
              
              if (rerankedResults.length === 0) {
                log.warn('mergeScores returned empty array, keeping original results. This may indicate UUID mismatch between evaluations and results.');
                // Ensure we keep original results if mergeScores filtered everything out
                // Apply original limit to preserve expected behavior
                const limitedOriginalResults = originalResultsBeforeReranking.slice(0, originalLimit);
                result = {
                  ...result,
                  results: limitedOriginalResults,
                  totalCount: limitedOriginalResults.length,
                };
                log.info('Restored original results after empty mergeScores', {
                  restoredCount: limitedOriginalResults.length,
                  originalLimit,
                });
              } else {
                // Convert back to BrainSearchResult format
                const finalResults = rerankedResults.map(r => {
                  const originalResult = result.results.find(orig => orig.node.uuid === r.entity.uuid);
                  if (!originalResult) {
                    log.warn('Original result not found for UUID', { uuid: r.entity.uuid });
                    return null;
                  }
                  
                  return {
                    ...originalResult,
                    score: r.score,
                    // Add score breakdown if available
                    ...(r.scoreBreakdown && { scoreBreakdown: r.scoreBreakdown }),
                  };
                }).filter((r): r is typeof result.results[0] => r !== null);
                
                // Sort by score descending (highest scores first)
                finalResults.sort((a, b) => b.score - a.score);
                
                // If finalResults is empty after mapping (UUID mismatch), fall back to original results
                if (finalResults.length === 0) {
                  log.warn('finalResults is empty after mapping, falling back to original results');
                  const limitedOriginalResults = originalResultsBeforeReranking.slice(0, originalLimit);
                  result = {
                    ...result,
                    results: limitedOriginalResults,
                    totalCount: limitedOriginalResults.length,
                  };
                  log.info('Restored original results after empty finalResults', {
                    restoredCount: limitedOriginalResults.length,
                    originalLimit,
                  });
                } else {
                  // Check if boost_keywords will run after reranking
                  const willApplyBoost = params.boost_keywords && params.boost_keywords.length > 0;

                  if (willApplyBoost) {
                    // Don't apply limit yet - boost_keywords will operate on all reranked candidates
                    // and apply the limit at the end
                    result = {
                      ...result,
                      results: finalResults,
                      totalCount: finalResults.length,
                    };

                    log.info('Reranking done, deferring limit for keyword boost', {
                      resultCount: finalResults.length,
                      originalLimit,
                    });
                  } else {
                    // No boost_keywords, apply limit now
                    const limitedResults = finalResults.slice(0, originalLimit);

                    result = {
                      ...result,
                      results: limitedResults,
                      totalCount: limitedResults.length,
                    };

                    log.info('Applied limit after reranking', {
                      beforeLimit: finalResults.length,
                      afterLimit: limitedResults.length,
                      originalLimit,
                    });
                  }
                }
              }
            }
            
            reranked = true;
            const rerankDuration = Date.now() - rerankStart;
            log.info('Reranking complete', { 
              duration: rerankDuration, 
              resultCount: result.results.length,
              evaluations: rerankResult.evaluations.length,
            });
            
            // Log query feedback if available
            if (rerankResult.queryFeedback) {
              log.info('Query feedback', {
                quality: rerankResult.queryFeedback.quality,
                suggestions: rerankResult.queryFeedback.suggestions.length,
              });
            }
          }
        } catch (error: any) {
          log.error('Reranking failed', error);
          // Continue with original results if reranking fails
        }
      }

      // Apply keyword boosting with Levenshtein similarity
      let keywordBoosted = false;
      if (params.boost_keywords && params.boost_keywords.length > 0 && result.results.length > 0) {
        log.info('Applying keyword boost', {
          keywords: params.boost_keywords,
          weight: params.boost_weight ?? 0.15,
          resultCount: result.results.length
        });

        const { distance } = await import('fastest-levenshtein');
        const boostWeight = params.boost_weight ?? 0.15;
        const minSimilarity = 0.6; // Minimum similarity threshold for boost

        // Helper to calculate Levenshtein similarity (0-1 scale)
        const levenshteinSimilarity = (a: string, b: string): number => {
          if (!a || !b) return 0;
          const maxLen = Math.max(a.length, b.length);
          if (maxLen === 0) return 1;
          const dist = distance(a.toLowerCase(), b.toLowerCase());
          return 1 - dist / maxLen;
        };

        // Helper to find best keyword match in a text
        const findBestKeywordMatch = (text: string, keywords: string[]): { keyword: string; similarity: number } => {
          let bestMatch = { keyword: '', similarity: 0 };
          if (!text) return bestMatch;

          const textLower = text.toLowerCase();

          for (const keyword of keywords) {
            const keywordLower = keyword.toLowerCase();

            // Check for exact substring match first (highest priority)
            if (textLower.includes(keywordLower)) {
              return { keyword, similarity: 1.0 };
            }

            // Otherwise, check Levenshtein similarity with each word in text
            const words = text.split(/[\s\.\-_\/\\:,;()[\]{}]+/).filter(w => w.length > 2);
            for (const word of words) {
              const sim = levenshteinSimilarity(word, keyword);
              if (sim > bestMatch.similarity) {
                bestMatch = { keyword, similarity: sim };
              }
            }
          }

          return bestMatch;
        };

        // Apply boost to each result
        const boostedResults = result.results.map(r => {
          const node = r.node;

          // Check name, file, path, title for keyword matches
          const fieldsToCheck = [
            node.name,
            node.file,
            node.path,
            node.title,
            node.signature,
          ].filter(Boolean);

          let maxBoost = 0;
          let matchedKeyword = '';
          let matchSimilarity = 0;

          for (const field of fieldsToCheck) {
            const match = findBestKeywordMatch(field as string, params.boost_keywords!);
            if (match.similarity >= minSimilarity) {
              const boost = match.similarity * boostWeight;
              if (boost > maxBoost) {
                maxBoost = boost;
                matchedKeyword = match.keyword;
                matchSimilarity = match.similarity;
              }
            }
          }

          if (maxBoost > 0) {
            log.debug('Boosted result', {
              name: node.name,
              originalScore: r.score,
              boost: maxBoost,
              newScore: r.score + maxBoost,
              matchedKeyword,
              matchSimilarity
            });
          }

          return {
            ...r,
            score: r.score + maxBoost,
            ...(maxBoost > 0 && { keywordBoost: { keyword: matchedKeyword, similarity: matchSimilarity, boost: maxBoost } }),
          };
        });

        // Re-sort by score
        boostedResults.sort((a, b) => b.score - a.score);

        // Apply original limit after boosting (we fetched more candidates for better ranking)
        const limitedBoostedResults = boostedResults.slice(0, originalLimit);

        result = {
          ...result,
          results: limitedBoostedResults,
          totalCount: limitedBoostedResults.length,
        };

        keywordBoosted = true;
        log.info('Keyword boost complete', {
          boostedCount: limitedBoostedResults.filter(r => (r as any).keywordBoost).length,
          beforeLimit: boostedResults.length,
          afterLimit: limitedBoostedResults.length,
          originalLimit
        });
      }

      // Explore relationships if explore_depth > 0
      let relationshipsExplored = false;
      let graph: {
        nodes: Array<{
          uuid: string;
          name: string;
          type: string;
          file?: string;
          score: number | null;
          isSearchResult: boolean;
        }>;
        edges: Array<{
          from: string;
          to: string;
          type: string;
        }>;
      } | undefined = undefined;

      if (params.explore_depth && params.explore_depth > 0 && result.results.length > 0) {
        log.info('Exploring relationships for results', { explore_depth: params.explore_depth, resultCount: result.results.length });
        const exploreStart = Date.now();
        const clampedDepth = Math.min(Math.max(params.explore_depth, 1), 3);

        const neo4j = ctx.brain.getNeo4jClient();
        if (neo4j) {
          // Deduplicated graph structure
          const graphNodes = new Map<string, {
            uuid: string;
            name: string;
            type: string;
            file?: string;
            signature?: string;
            docstring?: string;
            startLine?: number;
            endLine?: number;
            absolutePath?: string;
            relativePath?: string;
            parentUuid?: string;
            parentLabel?: string;
            score: number | null;
            isSearchResult: boolean;
          }>();
          const graphEdges = new Map<string, { from: string; to: string; type: string }>();

          // Add search results as nodes first (they have scores)
          const maxToExplore = Math.min(result.results.length, 10);
          for (let i = 0; i < maxToExplore; i++) {
            const r = result.results[i];
            const nodeUuid = r.node?.uuid;
            if (!nodeUuid) continue;

            // Add this result to graph nodes
            graphNodes.set(nodeUuid, {
              uuid: nodeUuid,
              name: r.node?.name || r.node?.signature || 'unnamed',
              type: r.node?.type || 'unknown',
              file: r.node?.file || r.node?.absolutePath,
              score: r.score,
              isSearchResult: true,
            });
          }

          // Explore relationships for each search result
          const nodesToExplore: Array<{ uuid: string; currentDepth: number }> = [];
          for (const [uuid] of graphNodes) {
            nodesToExplore.push({ uuid, currentDepth: 0 });
          }
          const exploredUuids = new Set<string>();

          while (nodesToExplore.length > 0) {
            const { uuid: nodeUuid, currentDepth } = nodesToExplore.shift()!;

            if (exploredUuids.has(nodeUuid) || currentDepth >= clampedDepth) continue;
            exploredUuids.add(nodeUuid);

            try {
              // Query outgoing and incoming relationships with full node properties
              const queries = [
                {
                  query: `
                    MATCH (n {uuid: $uuid})-[rel]->(related)
                    RETURN type(rel) as relationType,
                           related.uuid as relatedUuid,
                           coalesce(related.name, related.title, related.signature) as relatedName,
                           coalesce(related.type, labels(related)[0]) as relatedType,
                           coalesce(related.file, related.absolutePath) as relatedFile,
                           related.signature as relatedSignature,
                           related.docstring as relatedDocstring,
                           related.startLine as relatedStartLine,
                           related.endLine as relatedEndLine,
                           related.absolutePath as relatedAbsolutePath,
                           related.relativePath as relatedRelativePath,
                           related.parentUuid as relatedParentUuid,
                           related.parentLabel as relatedParentLabel
                    LIMIT 15
                  `,
                  isOutgoing: true,
                },
                {
                  query: `
                    MATCH (n {uuid: $uuid})<-[rel]-(related)
                    RETURN type(rel) as relationType,
                           related.uuid as relatedUuid,
                           coalesce(related.name, related.title, related.signature) as relatedName,
                           coalesce(related.type, labels(related)[0]) as relatedType,
                           coalesce(related.file, related.absolutePath) as relatedFile,
                           related.signature as relatedSignature,
                           related.docstring as relatedDocstring,
                           related.startLine as relatedStartLine,
                           related.endLine as relatedEndLine,
                           related.absolutePath as relatedAbsolutePath,
                           related.relativePath as relatedRelativePath,
                           related.parentUuid as relatedParentUuid,
                           related.parentLabel as relatedParentLabel
                    LIMIT 15
                  `,
                  isOutgoing: false,
                },
              ];

              for (const { query, isOutgoing } of queries) {
                const relResult = await neo4j.run(query, { uuid: nodeUuid });
                for (const record of relResult.records) {
                  const relationType = record.get('relationType') as string;
                  const relatedUuid = record.get('relatedUuid') as string;
                  const relatedName = (record.get('relatedName') as string) || 'unnamed';
                  const relatedType = (record.get('relatedType') as string) || 'unknown';
                  const relatedFile = record.get('relatedFile') as string | undefined;
                  const relatedSignature = record.get('relatedSignature') as string | undefined;
                  const relatedDocstring = record.get('relatedDocstring') as string | undefined;
                  const relatedStartLine = record.get('relatedStartLine') as number | undefined;
                  const relatedEndLine = record.get('relatedEndLine') as number | undefined;
                  const relatedAbsolutePath = record.get('relatedAbsolutePath') as string | undefined;
                  const relatedRelativePath = record.get('relatedRelativePath') as string | undefined;
                  const relatedParentUuid = record.get('relatedParentUuid') as string | undefined;
                  const relatedParentLabel = record.get('relatedParentLabel') as string | undefined;

                  // Add related node if not already present (don't overwrite search results with scores)
                  if (!graphNodes.has(relatedUuid)) {
                    graphNodes.set(relatedUuid, {
                      uuid: relatedUuid,
                      name: relatedName,
                      type: relatedType,
                      file: relatedFile,
                      signature: relatedSignature,
                      docstring: relatedDocstring,
                      startLine: relatedStartLine,
                      endLine: relatedEndLine,
                      absolutePath: relatedAbsolutePath,
                      relativePath: relatedRelativePath,
                      parentUuid: relatedParentUuid,
                      parentLabel: relatedParentLabel,
                      score: null,
                      isSearchResult: false,
                    });
                  }

                  // Add edge (deduplicated by from+to+type)
                  const fromUuid = isOutgoing ? nodeUuid : relatedUuid;
                  const toUuid = isOutgoing ? relatedUuid : nodeUuid;
                  const edgeKey = `${fromUuid}|${toUuid}|${relationType}`;
                  if (!graphEdges.has(edgeKey)) {
                    graphEdges.set(edgeKey, {
                      from: fromUuid,
                      to: toUuid,
                      type: relationType,
                    });
                  }

                  // Queue for deeper exploration if needed
                  if (currentDepth + 1 < clampedDepth && !exploredUuids.has(relatedUuid)) {
                    nodesToExplore.push({ uuid: relatedUuid, currentDepth: currentDepth + 1 });
                  }
                }
              }
              relationshipsExplored = true;
            } catch (exploreErr: any) {
              log.warn('Failed to explore relationships for node', { uuid: nodeUuid, error: exploreErr.message });
            }
          }

          // Build final graph structure
          // Sort nodes: search results first (by score desc), then discovered nodes
          const sortedNodes = Array.from(graphNodes.values()).sort((a, b) => {
            if (a.isSearchResult && !b.isSearchResult) return -1;
            if (!a.isSearchResult && b.isSearchResult) return 1;
            if (a.score !== null && b.score !== null) return b.score - a.score;
            return 0;
          });

          // Remove undefined fields from nodes
          for (const node of sortedNodes) {
            for (const key of Object.keys(node)) {
              if ((node as any)[key] === undefined) {
                delete (node as any)[key];
              }
            }
          }

          graph = {
            nodes: sortedNodes,
            edges: Array.from(graphEdges.values()),
          };
        }

        const exploreDuration = Date.now() - exploreStart;
        log.info('Relationship exploration complete', {
          duration: exploreDuration,
          explored: relationshipsExplored,
          graphNodes: graph?.nodes.length,
          graphEdges: graph?.edges.length
        });
      }

      // Step 7: Summarize results if requested
      let summarized = false;
      let summary: {
        snippets: Array<{ uuid: string; file: string; lines: string; content: string; relevance: string }>;
        findings: string;
        suggestions?: Array<{ type: string; target: string; reason: string }>;
      } | undefined;

      if (params.summarize && result.results && result.results.length > 0) {
        log.info('Step 7: Summarizing results with LLM');
        const summarizeStart = Date.now();

        try {
          summary = await summarizeBrainSearchResults(
            params.query,
            result.results,
            params.summarize_context,
            ctx.brain.getGeminiKey() || process.env.GEMINI_API_KEY
          );
          summarized = true;

          const summarizeDuration = Date.now() - summarizeStart;
          log.info('Summarization complete', {
            duration: summarizeDuration,
            snippetCount: summary.snippets.length,
            findingsLength: summary.findings.length,
          });
        } catch (error: any) {
          log.error('Summarization failed', error);
          // Continue without summary if it fails
        }
      }

      const totalDuration = Date.now() - startTime;
      log.info('COMPLETE', { totalDuration, reranked, keywordBoosted, relationshipsExplored, summarized });

      // When summarized, return only the summary (not full results) to reduce context size
      if (summarized && summary) {
        return {
          results: [], // Empty to save context - use summary instead
          totalCount: result.totalCount,
          searchedProjects: result.searchedProjects,
          waited_for_edits: waitedForSync || undefined,
          watchers_started: watchersStarted.length > 0 ? watchersStarted : undefined,
          flushed_projects: flushedProjects.length > 0 ? flushedProjects : undefined,
          reranked: reranked || undefined,
          keyword_boosted: keywordBoosted || undefined,
          relationships_explored: relationshipsExplored || undefined,
          summarized: true,
          summary,
          graph,
        };
      }

      return {
        ...result,
        waited_for_edits: waitedForSync || undefined,
        watchers_started: watchersStarted.length > 0 ? watchersStarted : undefined,
        flushed_projects: flushedProjects.length > 0 ? flushedProjects : undefined,
        reranked: reranked || undefined,
        keyword_boosted: keywordBoosted || undefined,
        relationships_explored: relationshipsExplored || undefined,
        summarized: summarized || undefined,
        summary,
        graph,
      };
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      log.error('ERROR', error, { duration: totalDuration });
      throw error;
    }
  };
}

/**
 * Summarize brain_search results using LLM to extract relevant snippets with line numbers.
 * This reduces context size and focuses attention on the most relevant information.
 */
async function summarizeBrainSearchResults(
  query: string,
  results: Array<{
    node?: {
      uuid?: string;
      name?: string;
      type?: string;
      file?: string;
      absolutePath?: string;
      startLine?: number;
      endLine?: number;
      content?: string;
      source?: string;
      description?: string;
      docstring?: string;
    };
    score?: number;
    filePath?: string;
  }>,
  context?: string,
  apiKey?: string
): Promise<{
  snippets: Array<{ uuid: string; file: string; lines: string; content: string; relevance: string }>;
  findings: string;
  suggestions?: Array<{ type: string; target: string; reason: string }>;
}> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required for brain_search summarization');
  }

  const { StructuredLLMExecutor, GeminiAPIProvider } = await import('../runtime/index.js');

  const llmProvider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.3, // Low temperature for factual extraction
    maxOutputTokens: 32000, // Allow enough room for snippets + findings + suggestions
  });

  const executor = new StructuredLLMExecutor();

  // Format results for the LLM - use absolute paths
  const formattedResults = results.map((r, i) => {
    const node = r.node || {};
    const absolutePath = node.absolutePath || r.filePath || node.file || 'unknown';
    const lines = node.startLine && node.endLine
      ? `${node.startLine}-${node.endLine}`
      : node.startLine
        ? `${node.startLine}`
        : 'N/A';
    const content = node.source || node.content || '';
    const description = node.docstring || node.description || '';
    return `[${i + 1}] ${node.type || 'unknown'}: ${node.name || 'unnamed'}
uuid: ${node.uuid || 'unknown'}
file: ${absolutePath}
lines: ${lines}
score: ${(r.score || 0).toFixed(3)}
${description ? `description: ${description}` : ''}
${content ? `content:\n${content}` : ''}`;
  }).join('\n\n---\n\n');

  const { createLogger } = await import('../runtime/utils/logger.js');
  const log = createLogger('brain_search_summarize');

  let result: {
    snippets: Array<{ uuid: string; file: string; lines: string; content: string; relevance: string }>;
    findings: string;
    suggestions?: Array<{ type: string; target: string; reason: string }>;
  } | undefined;

  try {
    result = await executor.executeSingle<{
      snippets: Array<{ uuid: string; file: string; lines: string; content: string; relevance: string }>;
      findings: string;
      suggestions?: Array<{ type: string; target: string; reason: string }>;
    }>({
      input: { query, results: formattedResults, context: context || '' },
      inputFields: ['query', 'results', 'context'],
      llmProvider,
      outputFormat: 'json', // Use JSON format - Gemini follows this better than XML
      systemPrompt: `You are an expert code analyst. Your task is to extract the most relevant snippets from code search results and suggest actionable next steps.

GUIDELINES:
- Focus on code/content that DIRECTLY answers the query
- Include the UUID from each result for reference (can be used with explore_node tool)
- For line numbers: calculate ABSOLUTE line numbers from the result's startLine. If a result starts at line 630 and you want to cite lines 10-25 within it, output "640-655"
- Keep snippets CONCISE: max 20-30 lines per snippet. Include signature + key logic only
- Use "// ..." to indicate omitted code within a snippet
- PRIORITIZE findings and suggestions over code length - they are MORE IMPORTANT than full code
- Explain WHY each snippet is relevant to the query
- Synthesize findings across all results

FOR SUGGESTIONS - be specific and actionable:
- Look at function/class names CALLED or IMPORTED in the code and suggest searching for them
- Identify dependencies (what the code uses) and consumers (what uses this code)
- Suggest exploring specific UUIDs with explore_node to see relationships
- Propose searches for related patterns, interfaces, or types mentioned in the code
- If you see a class method, suggest finding the class definition or other methods
- Do NOT give generic suggestions like "search for authentication" - be SPECIFIC based on what you see in the results`,
    userTask: `Analyze these search results and extract the most relevant snippets.

QUERY: {query}

${context ? `CONTEXT (why this search was made): {context}` : ''}

SEARCH RESULTS:
{results}

Extract:
1. The most relevant code/content snippets with their UUID, ABSOLUTE file paths and line numbers
2. A synthesis of key findings
3. SPECIFIC suggestions based on what you found:
   - Function/class names to search for (that are called/imported in the results)
   - UUIDs worth exploring with explore_node to see dependencies/consumers
   - Related types, interfaces, or patterns mentioned in the code`,
    outputSchema: {
      snippets: {
        type: 'array',
        description: 'Most relevant snippets from the results',
        required: true,
        items: {
          type: 'object',
          description: 'A relevant code snippet',
          properties: {
            uuid: { type: 'string', description: 'UUID of the node (from the results, for explore_node)' },
            file: { type: 'string', description: 'Absolute file path (from the results)' },
            lines: { type: 'string', description: 'ABSOLUTE line numbers in the file (e.g., "640-655"). Calculate from result startLine + offset within snippet.' },
            content: { type: 'string', description: 'Concise code snippet (max 20-30 lines). Include signature + key logic. Use "// ..." to indicate omitted parts.' },
            relevance: { type: 'string', description: 'Why this snippet is relevant to the query' },
          },
        },
      },
      findings: {
        type: 'string',
        description: 'Key findings synthesized from all results (2-3 sentences)',
        required: true,
      },
      suggestions: {
        type: 'array',
        description: 'Specific actionable suggestions based on the results found',
        required: false,
        items: {
          type: 'object',
          description: 'A specific suggestion for follow-up',
          properties: {
            type: { type: 'string', description: 'Type: "search" (brain_search query), "explore" (explore_node UUID), or "read" (read_file path)' },
            target: { type: 'string', description: 'The search query, UUID, or file path depending on type' },
            reason: { type: 'string', description: 'Why this would be useful (be specific)' },
          },
        },
      },
    },
    caller: 'brain-tools.summarizeBrainSearchResults',
    maxIterations: 1, // Single pass, no tool calls
    });
  } catch (error: any) {
    // Log the error with as much detail as possible
    log.error('executeSingle failed', {
      error: error.message,
      query,
      resultCount: results.length,
      // If executeSingle throws with raw response info, try to extract it
      rawResponse: error.rawResponse?.substring?.(0, 2000) || error.response?.substring?.(0, 2000),
    });
    throw error;
  }

  if (!result?.snippets || !result?.findings) {
    log.error('LLM returned unexpected format', {
      hasSnippets: !!result?.snippets,
      hasFindings: !!result?.findings,
      resultKeys: result ? Object.keys(result) : [],
      resultPreview: result ? JSON.stringify(result).substring(0, 1000) : 'undefined',
    });
    throw new Error('LLM did not return expected output format');
  }

  log.info('Summarization successful', {
    snippetCount: result.snippets.length,
    findingsLength: result.findings.length,
    suggestionCount: result.suggestions?.length || 0,
  });

  return {
    snippets: result.snippets,
    findings: result.findings,
    suggestions: result.suggestions,
  };
}

/**
 * Ensure a project is synced before searching.
 * - Starts watcher if not active (with initial sync)
 * - Flushes pending queue if watcher is active
 * - Waits for any ongoing ingestion
 */
export async function ensureProjectSynced(
  brain: BrainManager,
  projectPath: string
): Promise<{ waited: boolean; watcherStarted: boolean; flushed: boolean }> {
  const { createLogger } = await import('../runtime/utils/logger.js');
  const log = createLogger('brain_search:ensureProjectSynced');
  
  let waited = false;
  let watcherStarted = false;
  let flushed = false;

  // 1. Check if watcher is active
  const isWatching = brain.isWatching(projectPath);
  log.debug('Checking watcher status', { projectPath, isWatching });
  
  if (!isWatching) {
    log.info('Starting watcher', { projectPath });

    try {
      // Start with initial sync to detect changes since last ingestion
      const watchStart = Date.now();
      log.info('Calling brain.startWatching', { projectPath });
      await brain.startWatching(projectPath, {
        skipInitialSync: false, // Do initial sync to catch external changes
        verbose: false,
      });
      const watchDuration = Date.now() - watchStart;
      log.info('brain.startWatching completed', { duration: watchDuration });
      watcherStarted = true;
      waited = true;

      // Wait for initial sync to complete (watcher flushes after scan)
      log.info('Getting watcher instance', { projectPath });
      const watcher = brain.getWatcher(projectPath);
      if (watcher) {
        log.info('Watcher instance obtained, checking queue');
        const queue = watcher.getQueue();
        const initialPending = queue.getPendingCount();
        const initialQueued = queue.getQueuedCount();
        log.info('Queue status before wait', { pending: initialPending, queued: initialQueued });
        
        log.info('Waiting for initial sync queue to empty');
        const queueWaitStart = Date.now();
        // Wait for both locks during initial sync (embeddings will be generated)
        await waitForQueueEmpty(queue, brain.getIngestionLock(), 300000, brain.getEmbeddingLock()); // 5 minutes
        const queueWaitDuration = Date.now() - queueWaitStart;
        log.info('Initial sync queue empty', { duration: queueWaitDuration });
      } else {
        log.warn('Watcher instance not found after startWatching', { projectPath });
      }
    } catch (err: any) {
      log.error('Failed to start watcher', err, { projectPath });
      // Continue anyway - search will still work, just without auto-ingestion
      // Don't re-throw to allow other projects to sync
    }
  } else {
    // 2. Watcher active - check for pending files in queue
    log.debug('Watcher already active, checking queue');
    const watcher = brain.getWatcher(projectPath);
    if (watcher) {
      const queue = watcher.getQueue();
      const pendingCount = queue.getPendingCount();
      const queuedCount = queue.getQueuedCount();
      const isProcessing = queue.isProcessing();

      log.debug('Queue status', { pendingCount, queuedCount, isProcessing });

      if (pendingCount > 0 || queuedCount > 0) {
        log.info('Flushing queue', { pendingCount, queuedCount });

        // Force immediate flush (don't wait for batch timer)
        const flushStart = Date.now();
        await queue.flush();
        const flushDuration = Date.now() - flushStart;
        log.debug('Queue flushed', { duration: flushDuration });
        flushed = true;
        waited = true;

        // Wait for queue to be completely empty AND ingestion lock released
        // Note: embedding lock is checked separately in brain_search handler based on semantic flag
        log.debug('Waiting for queue to be empty');
        const emptyWaitStart = Date.now();
        await waitForQueueEmpty(queue, brain.getIngestionLock(), 300000); // 5 minutes, no embedding lock here
        const emptyWaitDuration = Date.now() - emptyWaitStart;
        log.debug('Queue empty', { duration: emptyWaitDuration });
      }

      // 3. Check if ingestion is in progress
      if (isProcessing) {
        log.info('Waiting for watcher ingestion to complete');
        const processWaitStart = Date.now();
        await waitForQueueEmpty(queue, brain.getIngestionLock(), 300000); // 5 minutes, no embedding lock here
        const processWaitDuration = Date.now() - processWaitStart;
        log.debug('Ingestion complete', { duration: processWaitDuration });
        waited = true;
      }
    }
  }
  
  log.debug('Project sync complete', { waited, watcherStarted, flushed });

  return { waited, watcherStarted, flushed };
}

/**
 * Wait for the ingestion queue to be empty, not processing, AND locks released
 * For semantic search: waits for both ingestion and embedding locks
 * For non-semantic search: waits only for ingestion lock
 */
async function waitForQueueEmpty(
  queue: { getPendingCount: () => number; getQueuedCount: () => number; isProcessing: () => boolean },
  ingestionLock: { isLocked: () => boolean; getDescription: () => string },
  timeout: number,
  embeddingLock?: { isLocked: () => boolean; getDescription: () => string }
): Promise<boolean> {
  const { createLogger } = await import('../runtime/utils/logger.js');
  const log = createLogger('brain_search:waitForQueueEmpty');
  
  const startTime = Date.now();
  const checkInterval = 100; // Check every 100ms
  let lastLogTime = 0;
  const logInterval = 5000; // Log every 5 seconds

  const waitForEmbeddings = !!embeddingLock;
  log.info('Starting wait for queue empty', { timeout, waitForEmbeddings });

  while (Date.now() - startTime < timeout) {
    const pending = queue.getPendingCount();
    const queued = queue.getQueuedCount();
    const processing = queue.isProcessing();
    const ingestionLocked = ingestionLock.isLocked();
    const embeddingLocked = embeddingLock?.isLocked() ?? false;
    const elapsed = Date.now() - startTime;

    // Log progress every 5 seconds
    if (elapsed - lastLogTime >= logInterval) {
      log.info('Still waiting for queue', { 
        pending, 
        queued, 
        processing, 
        ingestionLocked, 
        embeddingLocked,
        waitForEmbeddings,
        elapsed, 
        ingestionDescription: ingestionLocked ? ingestionLock.getDescription() : undefined,
        embeddingDescription: embeddingLocked ? embeddingLock?.getDescription() : undefined
      });
      lastLogTime = elapsed;
    }

    // Queue is empty AND not processing AND ingestion lock released
    // AND embedding lock released (if waiting for embeddings)
    if (pending === 0 && queued === 0 && !processing && !ingestionLocked && (!waitForEmbeddings || !embeddingLocked)) {
      log.info('Queue empty and ready', { duration: elapsed, waitForEmbeddings });
      return true;
    }

    // Wait a bit before re-checking
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  const finalPending = queue.getPendingCount();
  const finalQueued = queue.getQueuedCount();
  const finalProcessing = queue.isProcessing();
  const finalIngestionLocked = ingestionLock.isLocked();
  const finalEmbeddingLocked = embeddingLock?.isLocked() ?? false;
  log.error('Timeout waiting for queue empty', { 
    timeout, 
    finalPending, 
    finalQueued, 
    finalProcessing,
    finalIngestionLocked,
    finalEmbeddingLocked,
    waitForEmbeddings,
    ingestionDescription: finalIngestionLocked ? ingestionLock.getDescription() : undefined,
    embeddingDescription: finalEmbeddingLocked ? embeddingLock?.getDescription() : undefined
  });
  return false;
}

// ============================================
// forget_path
// ============================================

/**
 * Generate forget_path tool definition
 */
export function generateForgetPathTool(): GeneratedToolDefinition {
  return {
    name: 'forget_path',
    description: `Remove knowledge about a path from the agent's brain.

This deletes all nodes and relationships associated with the given path.
Use this when you no longer need the information or want to clean up stale data.

Note: This cannot be undone. The data will need to be re-ingested if needed later.

Example: forget_path({ path: "/path/to/old/project" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to forget (the directory that was previously ingested)',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate handler for forget_path
 */
export function generateForgetPathHandler(ctx: BrainToolsContext) {
  return async (params: { path: string }): Promise<{ success: boolean; message: string }> => {
    await ctx.brain.forgetPath(params.path);
    return {
      success: true,
      message: `Forgot all knowledge about: ${params.path}`,
    };
  };
}

// ============================================
// ingest_web_page
// ============================================

/**
 * Generate ingest_web_page tool definition
 */
export function generateIngestWebPageTool(): GeneratedToolDefinition {
  return {
    name: 'ingest_web_page',
    description: `Ingest a web page into the agent's brain for long-term memory.

Use this after fetching a web page to save it permanently.
If the page was recently fetched, it will use the cached result.
Otherwise, it will fetch the page first.

Supports recursive crawling with depth parameter:
- depth=0 (default): ingest only this page
- depth=1: ingest this page + all linked pages
- depth=2+: follow links recursively

The page content is stored as a WebPage node in Neo4j with:
- URL, title, text content
- Raw HTML for future reference
- Links and headings extracted
- Embeddings for semantic search (if enabled)

Example usage:
- ingest_web_page({ url: "https://docs.example.com/api" })
- ingest_web_page({ url: "https://docs.example.com", depth: 2, max_pages: 20 })
- ingest_web_page({ url: "https://example.com", project_name: "research", force: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the page to ingest (uses cache if available)',
        },
        project_name: {
          type: 'string',
          description: 'Project to ingest into (default: current project or "web-pages")',
        },
        force: {
          type: 'boolean',
          description: 'Force re-fetch even if cached (default: false)',
        },
        generate_embeddings: {
          type: 'boolean',
          description: 'Generate embeddings for semantic search (default: false)',
        },
        depth: {
          type: 'number',
          description: 'Recursive crawl depth: 0=this page only, 1=follow links once, 2+=deeper (default: 0)',
        },
        max_pages: {
          type: 'number',
          description: 'Maximum pages to ingest when depth > 0 (default: 10)',
        },
        include_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only follow links matching these regex patterns',
        },
        exclude_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exclude links matching these regex patterns',
        },
      },
      required: ['url'],
    },
  };
}

/**
 * Result type for ingest_web_page
 */
interface IngestWebPageResult {
  success: boolean;
  url: string;
  title?: string;
  fromCache?: boolean;
  projectName: string;
  nodeId?: string;
  nodeType?: string;
  /** Number of pages ingested (when depth > 0) */
  pagesIngested?: number;
  /** Child pages ingested (when depth > 0) */
  children?: Array<{ url: string; title: string; nodeId?: string }>;
}

/**
 * Generate handler for ingest_web_page
 */
export function generateIngestWebPageHandler(ctx: BrainToolsContext) {
  return async (params: {
    url: string;
    project_name?: string;
    force?: boolean;
    generate_embeddings?: boolean;
    depth?: number;
    max_pages?: number;
    include_patterns?: string[];
    exclude_patterns?: string[];
  }): Promise<IngestWebPageResult> => {
    const {
      url,
      project_name,
      force = false,
      generate_embeddings = false,
      depth = 0,
      max_pages = 10,
      include_patterns,
      exclude_patterns,
    } = params;

    const cache = getGlobalFetchCache();
    const projectName = project_name || 'web-pages';

    // Detect format from URL before fetching
    const pathModule = await import('path');
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const ext = pathModule.extname(pathname).toLowerCase();
    const documentExts = ['.pdf', '.docx', '.xlsx', '.xls', '.csv'];
    const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.gltf', '.glb'];
    const isDocumentOrMedia = documentExts.includes(ext) || mediaExts.includes(ext);

    // For depth=0, simple single page ingest
    if (depth === 0) {
      // If it's a document or media file, ingest directly without Playwright
      if (isDocumentOrMedia) {
        const result = await ctx.brain.ingestWebPage({
          url,
          projectName,
          generateEmbeddings: generate_embeddings,
        });
        return {
          success: result.success,
          url,
          projectName,
          nodeId: result.nodeId,
          nodeType: result.nodeType,
        };
      }

      // Otherwise, use Playwright for HTML pages
      let cached: CachedFetchResult | undefined;
      let fromCache = false;

      // Check cache first
      if (!force && cache.has(url)) {
        cached = cache.get(url);
        fromCache = true;
      }

      // If not cached, fetch
      if (!cached) {
        const { chromium } = await import('playwright').catch(() => {
          throw new Error('Playwright not installed. Run: npm install playwright');
        });

        const browser = await chromium.launch({ headless: true });
        const browserContext = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        const page = await browserContext.newPage();

        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          const title = await page.title();
          const rawHtml = await page.content();
          const textContent = await page.evaluate('document.body.innerText') as string;

          cached = cache.set(url, {
            url,
            title,
            textContent,
            html: rawHtml,
            fetchedAt: new Date().toISOString(),
            renderTimeMs: 0,
          }, rawHtml);
        } finally {
          await browser.close();
        }
      }

      const result = await ctx.brain.ingestWebPage({
        url: cached.url,
        title: cached.title,
        textContent: cached.textContent || '',
        rawHtml: cached.rawHtml,
        projectName,
        generateEmbeddings: generate_embeddings,
      });

      return {
        success: result.success,
        url: cached.url,
        title: cached.title,
        fromCache,
        projectName,
        nodeId: result.nodeId,
        nodeType: result.nodeType,
      };
    }

    // For depth > 0, recursive crawl and ingest
    const { chromium } = await import('playwright').catch(() => {
      throw new Error('Playwright not installed. Run: npm install playwright');
    });

    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const visited = new Set<string>();
    const queue: Array<{ url: string; currentDepth: number }> = [{ url, currentDepth: 0 }];
    const ingestedPages: Array<{ url: string; title: string; nodeId?: string; depth: number }> = [];

    // Helper to normalize URL
    const normalizeUrl = (u: string): string => {
      try {
        const parsed = new URL(u);
        parsed.hash = '';
        let normalized = parsed.toString();
        if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
        return normalized;
      } catch {
        return u;
      }
    };

    // Helper to check patterns
    const matchesPatterns = (u: string): boolean => {
      if (exclude_patterns?.length) {
        for (const p of exclude_patterns) {
          try { if (new RegExp(p).test(u)) return false; } catch {}
        }
      }
      if (include_patterns?.length) {
        for (const p of include_patterns) {
          try { if (new RegExp(p).test(u)) return true; } catch {}
        }
        return false;
      }
      return true;
    };

    // Helper to check same domain
    const isSameDomain = (base: string, target: string): boolean => {
      try {
        return new URL(base).hostname === new URL(target).hostname;
      } catch {
        return false;
      }
    };

    try {
      while (queue.length > 0 && ingestedPages.length < max_pages) {
        const { url: currentUrl, currentDepth } = queue.shift()!;
        const normalizedUrl = normalizeUrl(currentUrl);

        if (visited.has(normalizedUrl)) continue;
        visited.add(normalizedUrl);
        if (currentDepth > depth) continue;
        if (currentDepth > 0 && !matchesPatterns(normalizedUrl)) continue;
        if (currentDepth > 0 && !isSameDomain(url, normalizedUrl)) continue;

        // Check cache
        let cached = !force && cache.has(normalizedUrl) ? cache.get(normalizedUrl) : undefined;
        let links: string[] = [];

        if (!cached) {
          try {
            console.log(`[ingest_web_page] Fetching ${normalizedUrl} (depth ${currentDepth})`);
            const page = await browserContext.newPage();

            await page.goto(normalizedUrl, { waitUntil: 'networkidle', timeout: 30000 });
            const title = await page.title();
            const rawHtml = await page.content();
            const textContent = await page.evaluate('document.body.innerText') as string;

            // Extract links for crawling
            if (currentDepth < depth) {
              links = await page.evaluate(`
                Array.from(document.querySelectorAll('a[href]'))
                  .map(a => a.href)
                  .filter(href => href.startsWith('http'))
              `) as string[];
            }

            await page.close();

            cached = cache.set(normalizedUrl, {
              url: normalizedUrl,
              title,
              textContent,
              html: rawHtml,
              fetchedAt: new Date().toISOString(),
              renderTimeMs: 0,
            }, rawHtml);
          } catch (err) {
            console.warn(`[ingest_web_page] Failed to fetch ${normalizedUrl}: ${err}`);
            continue;
          }
        }

        // Ingest to brain
        const result = await ctx.brain.ingestWebPage({
          url: cached.url,
          title: cached.title,
          textContent: cached.textContent || '',
          rawHtml: cached.rawHtml,
          projectName,
          generateEmbeddings: generate_embeddings,
        });

        ingestedPages.push({
          url: cached.url,
          title: cached.title,
          nodeId: result.nodeId,
          depth: currentDepth,
        });

        // Add links to queue
        for (const link of links) {
          const normalized = normalizeUrl(link);
          if (!visited.has(normalized)) {
            queue.push({ url: normalized, currentDepth: currentDepth + 1 });
          }
        }
      }

      console.log(`[ingest_web_page] Ingested ${ingestedPages.length} pages`);

      const rootPage = ingestedPages[0];
      return {
        success: true,
        url: rootPage?.url || url,
        title: rootPage?.title || '',
        fromCache: false,
        projectName,
        nodeId: rootPage?.nodeId,
        pagesIngested: ingestedPages.length,
        children: ingestedPages.slice(1).map(p => ({
          url: p.url,
          title: p.title,
          nodeId: p.nodeId,
        })),
      };

    } finally {
      await browser.close();
    }
  };
}

// ============================================
// list_brain_projects
// ============================================

/**
 * Generate list_brain_projects tool definition
 */
export function generateListBrainProjectsTool(): GeneratedToolDefinition {
  return {
    name: 'list_brain_projects',
    description: `List all projects registered in the agent's brain.

Shows all knowledge sources the agent knows about:
- RagForge projects (with full config)
- Quick-ingested directories
- Web crawls (when implemented)

Includes:
- Project ID and path
- Type (quick-ingest, touched-files, web-crawl)
- Last access time
- Node count

Use this to see what knowledge is available before searching.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };
}

/**
 * Generate handler for list_brain_projects
 */
export function generateListBrainProjectsHandler(ctx: BrainToolsContext) {
  return async (): Promise<{
    projects: Array<{
      id: string;
      path: string;
      type: string;
      lastAccessed: string;
      nodeCount: number;
      excluded: boolean;
    }>;
    count: number;
    excludedCount: number;
  }> => {
    // Use listProjectsWithCounts for real-time node counts from Neo4j
    const projectsWithCounts = await ctx.brain.listProjectsWithCounts();
    const projects = projectsWithCounts.map(p => ({
      id: p.id,
      path: p.path,
      type: p.type,
      lastAccessed: p.lastAccessed.toISOString(),
      nodeCount: p.nodeCount,
      excluded: p.excluded ?? false,
    }));

    return {
      projects,
      count: projects.length,
      excludedCount: projects.filter(p => p.excluded).length,
    };
  };
}

// ============================================
// Project Exclusion Tools
// ============================================

/**
 * Generate exclude_project tool definition
 */
export function generateExcludeProjectTool(): GeneratedToolDefinition {
  return {
    name: 'exclude_project',
    description: `Exclude a project from brain_search results.

Use this to temporarily hide a project from search results without deleting it.
Useful for:
- Reference projects you don't want cluttering results
- Noisy projects during focused work
- Temporarily disabling a project

The project data remains in the brain and can be included again later.
You can still search the excluded project explicitly by passing its ID in the 'projects' parameter.

Example: exclude_project({ project_id: "references-opencode-xyz" })`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID of the project to exclude from brain_search',
        },
      },
      required: ['project_id'],
    },
  };
}

/**
 * Generate handler for exclude_project
 */
export function generateExcludeProjectHandler(ctx: BrainToolsContext) {
  return async (params: { project_id: string }): Promise<{
    success: boolean;
    project_id: string;
    message: string;
  }> => {
    const { project_id } = params;
    const success = await ctx.brain.excludeProject(project_id);

    if (success) {
      return {
        success: true,
        project_id,
        message: `Project "${project_id}" excluded from brain_search. Use include_project to re-enable.`,
      };
    } else {
      return {
        success: false,
        project_id,
        message: `Project "${project_id}" not found. Use list_brain_projects to see available projects.`,
      };
    }
  };
}

/**
 * Generate include_project tool definition
 */
export function generateIncludeProjectTool(): GeneratedToolDefinition {
  return {
    name: 'include_project',
    description: `Include a previously excluded project back in brain_search results.

Use this to re-enable a project that was excluded with exclude_project.
The project will appear in brain_search results again.

Example: include_project({ project_id: "references-opencode-xyz" })`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID of the project to include back in brain_search',
        },
      },
      required: ['project_id'],
    },
  };
}

/**
 * Generate handler for include_project
 */
export function generateIncludeProjectHandler(ctx: BrainToolsContext) {
  return async (params: { project_id: string }): Promise<{
    success: boolean;
    project_id: string;
    message: string;
  }> => {
    const { project_id } = params;
    const success = await ctx.brain.includeProject(project_id);

    if (success) {
      return {
        success: true,
        project_id,
        message: `Project "${project_id}" included back in brain_search.`,
      };
    } else {
      return {
        success: false,
        project_id,
        message: `Project "${project_id}" not found. Use list_brain_projects to see available projects.`,
      };
    }
  };
}

// ============================================
// File Watcher Management Tools
// ============================================

/**
 * Generate list_watchers tool definition
 */
export function generateListWatchersTool(): GeneratedToolDefinition {
  return {
    name: 'list_watchers',
    description: `List all active file watchers.

Shows which projects have file watchers running for auto-ingestion.

Returns:
- watchers: Array of { projectId, projectPath, isWatching }
- count: Total number of active watchers

Example: list_watchers()`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };
}

/**
 * Generate handler for list_watchers
 */
export function generateListWatchersHandler(ctx: BrainToolsContext) {
  return async (): Promise<{
    watchers: Array<{ projectId: string; projectPath: string }>;
    count: number;
  }> => {
    const watchedIds = ctx.brain.getWatchedProjects();
    const projects = ctx.brain.listProjects();

    const watchers = watchedIds.map((projectId: string) => {
      const project = projects.find(p => p.id === projectId);
      return {
        projectId,
        projectPath: project?.path || 'unknown',
      };
    });

    return {
      watchers,
      count: watchers.length,
    };
  };
}

/**
 * Generate start_watcher tool definition
 */
export function generateStartWatcherTool(): GeneratedToolDefinition {
  return {
    name: 'start_watcher',
    description: `Start a file watcher for a project.

Starts monitoring a project directory for file changes.
When files are modified, they are automatically re-ingested into the brain.

Parameters:
- project_path: Path to the project directory (must be a registered project)
- verbose: Enable verbose logging (default: false)

Example: start_watcher({ project_path: "/path/to/project" })`,
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Path to the project directory',
        },
        verbose: {
          type: 'boolean',
          description: 'Enable verbose logging (default: false)',
        },
      },
      required: ['project_path'],
    },
  };
}

/**
 * Generate handler for start_watcher
 */
export function generateStartWatcherHandler(ctx: BrainToolsContext) {
  return async (params: { project_path: string; verbose?: boolean }): Promise<{
    success: boolean;
    projectId?: string;
    message: string;
  }> => {
    const { project_path, verbose = false } = params;
    const pathModule = await import('path');
    const absolutePath = pathModule.resolve(project_path);

    // Check if already watching
    if (ctx.brain.isWatching(absolutePath)) {
      return {
        success: false,
        message: `Already watching: ${absolutePath}`,
      };
    }

    try {
      // Force initial sync to catch any changes since last session
      await ctx.brain.startWatching(absolutePath, { skipInitialSync: false, verbose });
      const projects = ctx.brain.listProjects();
      const project = projects.find(p => p.path === absolutePath);

      return {
        success: true,
        projectId: project?.id,
        message: `File watcher started for ${project?.id || absolutePath}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to start watcher: ${err.message}`,
      };
    }
  };
}

/**
 * Generate stop_watcher tool definition
 */
export function generateStopWatcherTool(): GeneratedToolDefinition {
  return {
    name: 'stop_watcher',
    description: `Stop a file watcher for a project.

Stops monitoring a project directory for file changes.

Parameters:
- project_path: Path to the project directory

Example: stop_watcher({ project_path: "/path/to/project" })`,
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Path to the project directory',
        },
      },
      required: ['project_path'],
    },
  };
}

/**
 * Generate handler for stop_watcher
 */
export function generateStopWatcherHandler(ctx: BrainToolsContext) {
  return async (params: { project_path: string }): Promise<{
    success: boolean;
    message: string;
  }> => {
    const { project_path } = params;
    const pathModule = await import('path');
    const absolutePath = pathModule.resolve(project_path);

    // Check if watching
    if (!ctx.brain.isWatching(absolutePath)) {
      return {
        success: false,
        message: `Not watching: ${absolutePath}`,
      };
    }

    try {
      await ctx.brain.stopWatching(absolutePath);
      return {
        success: true,
        message: `File watcher stopped for ${absolutePath}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to stop watcher: ${err.message}`,
      };
    }
  };
}

// ============================================
// Mark File Dirty Tool
// ============================================

/**
 * Generate mark_file_dirty tool definition
 */
export function generateMarkFileDirtyTool(): GeneratedToolDefinition {
  return {
    name: 'mark_file_dirty',
    description: `Mark a file as "dirty" to force re-ingestion.

Marks all nodes associated with a file (Scope, File, MarkdownSection, CodeBlock, etc.)
as schemaDirty = true and embeddingsDirty = true. This ensures the file will be
re-ingested on the next ingestion cycle, even if its content hash hasn't changed.

Useful when:
- Files were modified outside the watcher's detection
- You want to force re-ingestion of specific files
- Files need to be re-indexed after schema changes

The file will be automatically re-ingested by the watcher on the next ingestion cycle,
or you can trigger immediate re-ingestion by setting queue_for_ingestion = true.

Parameters:
- file_path: Path to the file to mark as dirty (absolute or relative)
- queue_for_ingestion: If true, immediately queue the file for re-ingestion (default: false)
- project_path: Optional project path to find the file (default: searches all projects)

Example: mark_file_dirty({ file_path: "src/utils.ts", queue_for_ingestion: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to mark as dirty (absolute or relative)',
        },
        queue_for_ingestion: {
          type: 'boolean',
          description: 'If true, immediately queue the file for re-ingestion (default: false)',
        },
        project_path: {
          type: 'string',
          description: 'Optional project path to find the file (default: searches all projects)',
        },
      },
      required: ['file_path'],
    },
  };
}

/**
 * Generate handler for mark_file_dirty
 */
export function generateMarkFileDirtyHandler(ctx: BrainToolsContext) {
  return async (params: {
    file_path: string;
    queue_for_ingestion?: boolean;
    project_path?: string;
  }): Promise<{
    success: boolean;
    nodes_marked: number;
    file_path: string;
    relative_path?: string;
    project_id?: string;
    queued?: boolean;
    message?: string;
  }> => {
    const { file_path, queue_for_ingestion = false, project_path } = params;
    const pathModule = await import('path');

    // Resolve absolute path
    const absolutePath = pathModule.isAbsolute(file_path)
      ? file_path
      : project_path
        ? pathModule.resolve(project_path, file_path)
        : pathModule.resolve(process.cwd(), file_path);

    // Find project for this file
    const project = await findProjectForFile(ctx.brain, absolutePath);
    if (!project) {
      return {
        success: false,
        nodes_marked: 0,
        file_path: absolutePath,
        message: `File not found in any ingested project: ${absolutePath}`,
      };
    }

    // Calculate relative path from project root
    const relativePath = pathModule.relative(project.path, absolutePath);

    // Check Neo4j client availability
    const neo4jClient = ctx.brain.getNeo4jClient();
    if (!neo4jClient) {
      return {
        success: false,
        nodes_marked: 0,
        file_path: absolutePath,
        relative_path: relativePath,
        project_id: project.id,
        message: 'Neo4j client not available',
      };
    }

    try {
      // Mark all nodes associated with this file as dirty
      const result = await neo4jClient.run(
        `MATCH (n)
         WHERE n.file = $filePath AND n.projectId = $projectId
         SET n.schemaDirty = true, n.embeddingsDirty = true
         RETURN count(n) AS count`,
        { filePath: relativePath, projectId: project.id }
      );

      const nodesMarked = result.records.length > 0 ? (result.records[0]?.get('count')?.toNumber() || 0) : 0;

      let queued = false;
      if (queue_for_ingestion && nodesMarked > 0) {
        // Queue file for immediate re-ingestion
        ctx.brain.queueFileChange(absolutePath, 'updated');
        queued = true;
      }

      return {
        success: true,
        nodes_marked: nodesMarked,
        file_path: absolutePath,
        relative_path: relativePath,
        project_id: project.id,
        queued,
        message: queued
          ? `Marked ${nodesMarked} node(s) as dirty and queued for re-ingestion`
          : `Marked ${nodesMarked} node(s) as dirty (will be re-ingested on next cycle)`,
      };
    } catch (err: any) {
      return {
        success: false,
        nodes_marked: 0,
        file_path: absolutePath,
        relative_path: relativePath,
        project_id: project.id,
        message: `Failed to mark file as dirty: ${err.message}`,
      };
    }
  };
}

// ============================================
// Brain-Aware File Tools
// ============================================

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

/**
 * Helper: Find which project a file belongs to
 */
async function findProjectForFile(brain: BrainManager, absolutePath: string): Promise<{ id: string; path: string } | null> {
  const projects = brain.listProjects();
  const pathModule = await import('path');

  for (const project of projects) {
    if (absolutePath.startsWith(project.path + pathModule.sep) || absolutePath === project.path) {
      return { id: project.id, path: project.path };
    }
  }
  return null;
}

/**
 * Helper: Queue re-ingestion for a file's project (non-blocking)
 * Returns immediately after queuing - actual ingestion happens in background
 * brain_search will wait for pending edits via waitForPendingEdits()
 */
async function triggerReIngestion(
  brain: BrainManager,
  absolutePath: string,
  changeType: 'created' | 'updated' | 'deleted'
): Promise<{ projectId?: string; stats?: any; queued?: boolean } | null> {
  const pathModule = await import('path');
  const ext = pathModule.extname(absolutePath).toLowerCase();

  // Media files use updateMediaContent (still sync for now)
  const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.docx', '.xlsx', '.glb', '.gltf'];

  if (mediaExts.includes(ext) && changeType !== 'deleted') {
    try {
      await brain.updateMediaContent({
        filePath: absolutePath,
        extractionMethod: `file-tool-${changeType}`,
        generateEmbeddings: true,
      });
      return { projectId: 'media', stats: { mediaUpdated: true }, queued: false };
    } catch (e: any) {
      console.warn(`[file-tool] Media re-ingestion failed: ${e.message}`);
      return null;
    }
  }

  // Code files: queue for batched ingestion (non-blocking!)
  const project = await findProjectForFile(brain, absolutePath);
  if (project) {
    console.log(`[brain-tools] 🔄 Queuing ${absolutePath} for re-ingestion...`);
    brain.queueFileChange(absolutePath, changeType);
    const pendingCount = brain.getPendingEditCount();
    console.log(`[brain-tools] 📥 Queued! (${pendingCount} pending edits)`);

    return {
      projectId: project.id,
      queued: true,
      pendingCount,
      note: 'Ingestion queued. brain_search will wait for completion.',
    } as any;
  }

  // Orphan file (not in any project) - use touchFile for tracking
  if (changeType !== 'deleted') {
    try {
      console.log(`[brain-tools] 📁 Tracking orphan file: ${absolutePath}`);
      const result = await brain.touchFile(absolutePath);
      console.log(`[brain-tools] ✅ Orphan tracked: created=${result.created}, state=${result.newState}`);
      return {
        projectId: 'orphan',
        orphan: true,
        created: result.created,
        state: result.newState,
      } as any;
    } catch (e: any) {
      console.warn(`[brain-tools] Failed to track orphan file: ${e.message}`);
    }
  }

  return null;
}

/**
 * Generate read_file tool definition (brain-aware)
 */
export function generateBrainReadFileTool(): GeneratedToolDefinition {
  return {
    name: 'read_file',
    description: `Read file contents with line numbers.

**IMPORTANT: Use absolute paths from tool results (brain_search, grep_files, glob_files, list_directory), not relative paths.**

Returns file content with line numbers (format: "00001| content").
Supports pagination with offset and limit for large files.

**File type handling:**
- Text/code files: Read content with line numbers
- Images: Visual description (default) or OCR text extraction
- PDFs/Documents: OCR text extraction (default) or visual analysis
- 3D models (.glb, .gltf): Render and describe

Parameters:
- path: File path (use absolute paths from other tool results)
- offset: Start line (0-based, optional)
- limit: Max lines to read (default: 2000)
- ocr: For images/documents - use OCR text extraction (default: false for images, true for PDFs)

Long lines (>2000 chars) are truncated with "...".

Example: read_file({ path: "/home/user/project/src/index.ts" })  // Absolute path from brain_search/grep_files
Example: read_file({ path: "/home/user/project/screenshot.png" })  // Visual description`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to read (absolute or relative to project root)',
        },
        offset: {
          type: 'number',
          description: 'Start line (0-based). Use for pagination.',
        },
        limit: {
          type: 'number',
          description: 'Max lines to read (default: 2000)',
        },
        ocr: {
          type: 'boolean',
          description: 'For images/documents: use OCR text extraction. Default: false for images (visual description), true for PDFs (text extraction). Low confidence OCR automatically falls back to Gemini Vision.',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate write_file tool definition (brain-aware)
 */
export function generateBrainWriteFileTool(): GeneratedToolDefinition {
  return {
    name: 'write_file',
    description: `Write content to a file (overwrites if exists).

⚠️ WARNING: This will OVERWRITE existing files without confirmation!
Use create_file if you want to create a NEW file safely.

Creates parent directories if they don't exist.
Automatically updates the brain's knowledge graph after writing.

Parameters:
- path: Absolute or relative file path
- content: Full file content to write

Example: write_file({ path: "src/utils.ts", content: "export const foo = 1;" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to write (absolute or relative to project root)',
        },
        content: {
          type: 'string',
          description: 'Full file content to write',
        },
      },
      required: ['path', 'content'],
    },
  };
}

/**
 * Generate create_file tool definition (brain-aware)
 */
export function generateBrainCreateFileTool(): GeneratedToolDefinition {
  return {
    name: 'create_file',
    description: `Create a NEW file (fails if file already exists).

Use this when you want to create a new file and ensure you don't accidentally overwrite an existing one.
If you need to update an existing file, use write_file or edit_file instead.

Creates parent directories if they don't exist.
Automatically updates the brain's knowledge graph after creation.

Parameters:
- path: Absolute or relative file path
- content: Full file content to write

Example: create_file({ path: "src/new-component.ts", content: "export const Component = () => {};" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to create (absolute or relative to project root)',
        },
        content: {
          type: 'string',
          description: 'Full file content to write',
        },
      },
      required: ['path', 'content'],
    },
  };
}

/**
 * Generate edit_file tool definition (brain-aware)
 */
export function generateBrainEditFileTool(): GeneratedToolDefinition {
  return {
    name: 'edit_file',
    description: `Edit a file using search/replace OR line numbers.

**Method 1: Search/Replace**
- old_string: Text to find and replace (line number prefixes like "00001| " are auto-stripped)
- new_string: Replacement text

**Method 2: Line Numbers**
- start_line: First line to replace (1-based, from read_file output)
- end_line: Last line to replace (inclusive)
- new_string: New content for those lines

**Method 3: Append**
- append: true (adds new_string at the end of the file)
- new_string: Content to append

Automatically updates the brain's knowledge graph after editing.

Examples:
  edit_file({ path: "src/index.ts", old_string: "const x = 1;", new_string: "const x = 2;" })
  edit_file({ path: "src/index.ts", start_line: 5, end_line: 7, new_string: "// replaced" })
  edit_file({ path: "src/index.ts", append: true, new_string: "export function newFunc() {}" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to edit',
        },
        old_string: {
          type: 'string',
          description: 'Text to find and replace (line number prefixes auto-stripped)',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text (or content to append if append=true)',
        },
        start_line: {
          type: 'number',
          description: 'First line to replace (1-based). Use with end_line instead of old_string.',
        },
        end_line: {
          type: 'number',
          description: 'Last line to replace (1-based, inclusive).',
        },
        append: {
          type: 'boolean',
          description: 'If true, append new_string to end of file instead of replacing',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)',
        },
      },
      required: ['path', 'new_string'],
    },
  };
}

/**
 * Generate delete_path tool definition (brain-aware)
 */
export function generateBrainDeletePathTool(): GeneratedToolDefinition {
  return {
    name: 'delete_path',
    description: `Delete a file or directory.

By default, only deletes files and empty directories. Use recursive: true for non-empty directories.
Automatically removes the deleted content from the brain's knowledge graph.

Parameters:
- path: File or directory to delete
- recursive: Delete non-empty directories (default: false)

Example: delete_path({ path: "src/old-file.ts" })
Example: delete_path({ path: "temp", recursive: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to delete',
        },
        recursive: {
          type: 'boolean',
          description: 'Delete non-empty directories (default: false, DANGEROUS)',
        },
      },
      required: ['path'],
    },
  };
}

// ============================================
// Brain-Aware File Tool Handlers
// ============================================

/**
 * Check if a file is binary
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const fs = await import('fs/promises');
  try {
    const buffer = Buffer.alloc(512);
    const fd = await fs.open(filePath, 'r');
    const { bytesRead } = await fd.read(buffer, 0, 512, 0);
    await fd.close();

    // Check for null bytes (common in binary files)
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Strip line number prefixes from text (e.g., "00005| const x" -> "const x")
 */
function stripLineNumberPrefix(text: string): string {
  return text.replace(/^\s*\d+\|\s?/gm, '');
}

/**
 * Generate handler for read_file (brain-aware with caching)
 */
export function generateBrainReadFileHandler(ctx: BrainToolsContext) {
  return async (params: { path: string; offset?: number; limit?: number; ocr?: boolean }): Promise<any> => {
    const { path: filePath, offset = 0, limit = DEFAULT_READ_LIMIT, ocr } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const crypto = await import('crypto');

    // Resolve path (use cwd as fallback)
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.resolve(process.cwd(), filePath);

    // Check file exists and get stats
    let fileStats: import('fs').Stats;
    try {
      fileStats = await fs.stat(absolutePath);
      if (fileStats.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `File not found: ${absolutePath}` };
      }
      throw err;
    }

    // Check file type and delegate to appropriate parser
    const ext = pathModule.extname(absolutePath).toLowerCase();

    // Helper: compute file hash for cache validation
    const computeFileHash = async (): Promise<string> => {
      const fileBuffer = await fs.readFile(absolutePath);
      return crypto.createHash('sha256').update(fileBuffer).digest('hex').substring(0, 16);
    };

    // Helper: check cache in brain DB
    const checkCache = async (): Promise<{
      cached: boolean;
      textContent?: string;
      extractionMethod?: string;
      ocrConfidence?: number;
      storedHash?: string;
    }> => {
      const result = await ctx.brain.getCachedMediaContent(absolutePath);
      return {
        cached: result.cached,
        textContent: result.textContent,
        extractionMethod: result.extractionMethod,
        ocrConfidence: result.ocrConfidence,
        storedHash: result.hash,
      };
    };

    // Helper: store extracted content in brain DB
    const storeContent = async (content: string, hash: string, method: string, confidence?: number): Promise<void> => {
      try {
        await ctx.brain.updateMediaContent({
          filePath: absolutePath,
          textContent: content,
          extractionMethod: method,
          ocrConfidence: confidence,
        });
        // Update hash
        await ctx.brain.updateMediaHash(absolutePath, hash);
      } catch (err) {
        console.warn('[read_file] Failed to store content in cache:', err);
      }
    };

    // 1. Document files (PDF, DOCX, XLSX, etc.) - use document parser with cache
    if (isDocumentFile(absolutePath)) {
      try {
        // Check cache first
        const cache = await checkCache();
        const currentHash = await computeFileHash();

        let textContent: string;
        let extractionMethod: string;
        let ocrConfidence: number | undefined;
        let fromCache = false;

        if (cache.cached && cache.storedHash === currentHash && cache.textContent) {
          // Cache hit - file unchanged
          textContent = cache.textContent;
          extractionMethod = cache.extractionMethod || 'cached';
          ocrConfidence = cache.ocrConfidence;
          fromCache = true;
        } else {
          // Cache miss or file changed - extract content
          const docInfo = await parseDocumentFile(absolutePath, {
            extractText: true,
            useOcr: true,
            geminiVisionFallback, // Auto-fallback to Gemini Vision for low OCR confidence
          });

          if (!docInfo) {
            return { error: `Failed to parse document: ${absolutePath}` };
          }

          textContent = docInfo.textContent || '';
          extractionMethod = docInfo.extractionMethod || 'unknown';
          ocrConfidence = docInfo.ocrConfidence;

          // IMPORTANT: Store in cache SYNCHRONOUSLY to ensure File state is updated
          // before read_file returns. This prevents the watcher from re-parsing the file.
          try {
            await storeContent(textContent, currentHash, extractionMethod, ocrConfidence);
          } catch {
            // Cache storage failed - continue anyway
          }
        }

        const lines = textContent.split('\n');
        const totalLines = lines.length;
        const selectedLines = lines.slice(offset, offset + limit);

        const formattedLines = selectedLines.map((line, index) => {
          const lineNum = (index + offset + 1).toString().padStart(5, '0');
          const truncatedLine = line.length > MAX_LINE_LENGTH
            ? line.substring(0, MAX_LINE_LENGTH) + '...'
            : line;
          return `${lineNum}| ${truncatedLine}`;
        });

        const lastReadLine = offset + selectedLines.length;
        const hasMoreLines = totalLines > lastReadLine;

        let output = formattedLines.join('\n');
        if (hasMoreLines) {
          output += `\n\n(Document has more lines. Use offset=${lastReadLine} to continue. Total: ${totalLines} lines)`;
        } else {
          output += `\n\n(End of document - ${totalLines} lines)`;
        }

        // Track file access (async)
        // Only call touchFile if we got content from cache (storeContent already calls it for cache misses)
        if (fromCache) {
          ctx.brain.touchFile(absolutePath).catch(() => {});
        }
        ctx.brain.updateFileAccess(absolutePath).catch(() => {});

        return {
          path: filePath,
          absolute_path: absolutePath,
          file_type: ext.replace('.', ''),
          extraction_method: fromCache ? `${extractionMethod} (cached)` : extractionMethod,
          total_lines: totalLines,
          lines_read: selectedLines.length,
          offset,
          has_more: hasMoreLines,
          content: output,
        };
      } catch (err: any) {
        return { error: `Failed to parse document: ${err.message}` };
      }
    }

    // 2. Image files - visual description (default) or OCR
    // ocr defaults to false for images (visual description is more useful)
    const useOcrForImage = ocr === true; // Only use OCR if explicitly requested
    if (IMAGE_EXTENSIONS.has(ext)) {
      try {
        // Check cache first (cache key includes ocr mode)
        const cacheMode = useOcrForImage ? 'ocr' : 'vision';
        const cache = await checkCache();
        const currentHash = await computeFileHash();

        let textContent: string;
        let extractionMethod: string;
        let fromCache = false;

        // Check if cached content matches current mode
        const cacheValid = cache.cached &&
          cache.storedHash === currentHash &&
          cache.textContent &&
          (useOcrForImage ? cache.extractionMethod?.includes('ocr') : cache.extractionMethod?.includes('vision'));

        if (cacheValid) {
          // Cache hit - file unchanged and same mode
          textContent = cache.textContent!;
          extractionMethod = cache.extractionMethod || 'cached';
          fromCache = true;
        } else if (useOcrForImage) {
          // OCR mode - extract text with OCR, fallback to Gemini Vision if confidence is low
          const { generateReadImageHandler } = await import('./image-tools.js');
          const readImageHandler = generateReadImageHandler({
            projectRoot: process.cwd(),
            onContentExtracted: async () => ({ updated: false }),
          });
          const ocrResult = await readImageHandler({ path: absolutePath });

          if (ocrResult.error) {
            return { error: ocrResult.error };
          }

          // Check if OCR confidence is low and fallback to Gemini Vision
          const LOW_CONFIDENCE_THRESHOLD = 0.6;
          if (ocrResult.confidence !== undefined && ocrResult.confidence < LOW_CONFIDENCE_THRESHOLD) {
            // Fallback to Gemini Vision for better results
            const { generateDescribeImageHandler } = await import('./image-tools.js');
            const describeHandler = generateDescribeImageHandler({
              projectRoot: process.cwd(),
              onContentExtracted: async () => ({ updated: false }),
            });
            const visionResult = await describeHandler({
              path: absolutePath,
              prompt: 'Extract and transcribe all text visible in this image. If there is no text, describe what you see.',
            });

            if (!visionResult.error) {
              textContent = visionResult.description || '';
              extractionMethod = 'gemini-vision-ocr-fallback';
            } else {
              // Keep OCR result even if low confidence
              textContent = ocrResult.text || ocrResult.description || '';
              extractionMethod = `${ocrResult.provider || 'ocr'} (low-confidence: ${(ocrResult.confidence * 100).toFixed(0)}%)`;
            }
          } else {
            textContent = ocrResult.text || ocrResult.description || '';
            extractionMethod = ocrResult.provider || 'ocr';
          }

          // Store in cache
          try {
            await storeContent(textContent, currentHash, extractionMethod, ocrResult.confidence);
          } catch {
            // Cache storage failed - continue anyway
          }
        } else {
          // Vision mode (default) - visual description with Gemini Vision
          const { generateDescribeImageHandler } = await import('./image-tools.js');
          const describeHandler = generateDescribeImageHandler({
            projectRoot: process.cwd(),
            onContentExtracted: async () => ({ updated: false }),
          });
          const visionResult = await describeHandler({ path: absolutePath });

          if (visionResult.error) {
            return { error: visionResult.error };
          }

          textContent = visionResult.description || '';
          extractionMethod = 'gemini-vision';

          // Store in cache
          try {
            await storeContent(textContent, currentHash, extractionMethod);
          } catch {
            // Cache storage failed - continue anyway
          }
        }

        const lines = textContent.split('\n');

        // Track file access
        if (fromCache) {
          ctx.brain.touchFile(absolutePath).catch(() => {});
        }
        ctx.brain.updateFileAccess(absolutePath).catch(() => {});

        return {
          path: filePath,
          absolute_path: absolutePath,
          file_type: 'image',
          extraction_method: fromCache ? `${extractionMethod} (cached)` : extractionMethod,
          mode: useOcrForImage ? 'ocr' : 'vision',
          total_lines: lines.length,
          lines_read: lines.length,
          offset: 0,
          has_more: false,
          content: textContent,
        };
      } catch (err: any) {
        return { error: `Failed to read image: ${err.message}` };
      }
    }

    // 3. 3D model files (.glb, .gltf) - render and describe
    const THREED_EXTENSIONS = new Set(['.glb', '.gltf']);
    if (THREED_EXTENSIONS.has(ext)) {
      try {
        // Check cache first
        const cache = await checkCache();
        const currentHash = await computeFileHash();

        let description: string;
        let extractionMethod: string;
        let fromCache = false;

        if (cache.cached && cache.storedHash === currentHash && cache.textContent) {
          // Cache hit - file unchanged
          description = cache.textContent;
          extractionMethod = cache.extractionMethod || 'cached';
          fromCache = true;
        } else {
          // Cache miss - analyze 3D model (render + describe with Gemini Vision)
          const { generateAnalyze3DModelHandler } = await import('./threed-tools.js');

          // Create minimal context for analysis
          const analyzeCtx = {
            projectRoot: process.cwd(),
            onContentExtracted: async () => ({ updated: false }),
          };

          const analyze3DHandler = generateAnalyze3DModelHandler(analyzeCtx);
          const analyzeResult = await analyze3DHandler({
            model_path: absolutePath,
            views: ['perspective'], // Single view for quick analysis
          });

          if (analyzeResult.error) {
            return { error: `Failed to analyze 3D model: ${analyzeResult.error}` };
          }

          // Use the global description from analysis
          description = analyzeResult.global_description || analyzeResult.description || 'No description available';
          extractionMethod = '3d-render-describe';

          // Store in cache
          try {
            await storeContent(description, currentHash, extractionMethod);
          } catch {
            // Cache storage failed - continue anyway
          }
        }

        // Track file access
        if (fromCache) {
          ctx.brain.touchFile(absolutePath).catch(() => {});
        }
        ctx.brain.updateFileAccess(absolutePath).catch(() => {});

        return {
          path: filePath,
          absolute_path: absolutePath,
          file_type: '3d-model',
          format: ext.replace('.', ''),
          extraction_method: fromCache ? `${extractionMethod} (cached)` : extractionMethod,
          content: description,
          hint: 'Use analyze_3d_model for detailed multi-view analysis with rendered images.',
        };
      } catch (err: any) {
        return { error: `Failed to analyze 3D model: ${err.message}` };
      }
    }

    // 4. Check if binary (other file types)
    if (await isBinaryFile(absolutePath)) {
      return { error: `Cannot read binary file: ${absolutePath}. Use specific tools for this file type.` };
    }

    // 5. Text files - read normally
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    // Apply offset and limit
    const selectedLines = lines.slice(offset, offset + limit);
    const formattedLines = selectedLines.map((line, index) => {
      const lineNum = (index + offset + 1).toString().padStart(5, '0');
      const truncatedLine = line.length > MAX_LINE_LENGTH
        ? line.substring(0, MAX_LINE_LENGTH) + '...'
        : line;
      return `${lineNum}| ${truncatedLine}`;
    });

    const lastReadLine = offset + selectedLines.length;
    const hasMoreLines = totalLines > lastReadLine;

    let output = formattedLines.join('\n');
    if (hasMoreLines) {
      output += `\n\n(File has more lines. Use offset=${lastReadLine} to continue. Total: ${totalLines} lines)`;
    } else {
      output += `\n\n(End of file - ${totalLines} lines)`;
    }

    // Track file access for orphan files (fire and forget)
    ctx.brain.touchFile(absolutePath).catch((err: any) => {
      // Silently ignore - touchFile may fail for unsupported file types
      console.debug(`[brain-tools] touchFile skipped for ${absolutePath}: ${err.message}`);
    });

    // Update lastAccessed for all files (project and orphan) - for reranking
    ctx.brain.updateFileAccess(absolutePath).catch((err: any) => {
      console.debug(`[brain-tools] updateFileAccess skipped for ${absolutePath}: ${err.message}`);
    });

    return {
      path: filePath,
      absolute_path: absolutePath,
      total_lines: totalLines,
      lines_read: selectedLines.length,
      offset,
      has_more: hasMoreLines,
      content: output,
    };
  };
}

/**
 * Generate read_files tool definition (batch read multiple files)
 */
export function generateBrainReadFilesTool(): GeneratedToolDefinition {
  return {
    name: 'read_files',
    description: `Read multiple files at once (batch operation).

More efficient than calling read_file multiple times.
Reads all files in parallel and returns results for each.

Parameters:
- paths: Array of file paths (absolute or relative)
- limit: Max lines to read per file (default: 500 - lower than single read_file for batch)

Returns an array of results, one for each file.
Failed reads return an error object instead of content.

Example: read_files({ paths: ["src/index.ts", "src/utils.ts", "README.md"] })
Example: read_files({ paths: ["config.json", "package.json"], limit: 100 })`,
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read (absolute or relative to project root)',
        },
        limit: {
          type: 'number',
          description: 'Max lines to read per file (default: 500)',
        },
      },
      required: ['paths'],
    },
  };
}

/**
 * Generate handler for read_files (batch read, uses existing read_file handler)
 */
export function generateBrainReadFilesHandler(ctx: BrainToolsContext) {
  // Get the single file read handler
  const readFileHandler = generateBrainReadFileHandler(ctx);

  return async (params: { paths: string[]; limit?: number }): Promise<any> => {
    const { paths, limit = 500 } = params;

    if (!Array.isArray(paths) || paths.length === 0) {
      return { error: 'paths must be a non-empty array of file paths' };
    }

    // Limit batch size to prevent overwhelming the system
    const MAX_BATCH_SIZE = 20;
    if (paths.length > MAX_BATCH_SIZE) {
      return {
        error: `Too many files requested (${paths.length}). Maximum batch size is ${MAX_BATCH_SIZE}.`,
        suggestion: 'Split into multiple read_files calls',
      };
    }

    // Read all files in parallel
    const results = await Promise.all(
      paths.map(async (filePath) => {
        try {
          const result = await readFileHandler({ path: filePath, limit });
          return {
            path: filePath,
            ...result,
          };
        } catch (err: any) {
          return {
            path: filePath,
            error: err.message || String(err),
          };
        }
      })
    );

    // Summary stats
    const successful = results.filter((r) => !r.error).length;
    const failed = results.filter((r) => r.error).length;

    return {
      total: paths.length,
      successful,
      failed,
      results,
    };
  };
}

/**
 * Generate handler for write_file (brain-aware)
 */
export function generateBrainWriteFileHandler(ctx: BrainToolsContext) {
  return async (params: { path: string; content: string }): Promise<any> => {
    const { path: filePath, content } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const crypto = await import('crypto');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.resolve(process.cwd(), filePath);

    // Check if file exists (for change tracking)
    let oldContent: string | null = null;
    let changeType: 'created' | 'updated' = 'created';

    try {
      oldContent = await fs.readFile(absolutePath, 'utf-8');
      changeType = 'updated';
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Create parent directories if needed
    const parentDir = pathModule.dirname(absolutePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Write file
    await fs.writeFile(absolutePath, content, 'utf-8');
    const newHash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

    // Trigger re-ingestion
    const ingestionResult = await triggerReIngestion(ctx.brain, absolutePath, changeType);

    return {
      path: filePath,
      absolute_path: absolutePath,
      change_type: changeType,
      lines_written: content.split('\n').length,
      hash: newHash,
      rag_synced: !!ingestionResult,
      ingestion_stats: ingestionResult?.stats,
      project_id: ingestionResult?.projectId,
    };
  };
}

/**
 * Generate handler for create_file (brain-aware)
 */
export function generateBrainCreateFileHandler(ctx: BrainToolsContext) {
  return async (params: { path: string; content: string }): Promise<any> => {
    const { path: filePath, content } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.resolve(process.cwd(), filePath);

    // Check if file already exists
    try {
      await fs.access(absolutePath);
      return {
        error: `File already exists: ${filePath}. Use write_file to overwrite or edit_file to modify.`,
      };
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        return { error: `Access error: ${err.message}` };
      }
    }

    // Delegate to write_file handler
    const writeHandler = generateBrainWriteFileHandler(ctx);
    return writeHandler(params);
  };
}

/**
 * Generate handler for edit_file (brain-aware)
 */
export function generateBrainEditFileHandler(ctx: BrainToolsContext) {
  return async (params: {
    path: string;
    old_string?: string;
    new_string: string;
    start_line?: number;
    end_line?: number;
    append?: boolean;
    replace_all?: boolean;
  }): Promise<any> => {
    const { path: filePath, old_string, new_string, start_line, end_line, append, replace_all } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const crypto = await import('crypto');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.resolve(process.cwd(), filePath);

    // Read existing content
    let oldContent: string;
    try {
      oldContent = await fs.readFile(absolutePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `File not found: ${absolutePath}` };
      }
      throw err;
    }

    let newContent: string;

    // Method 3: Append
    if (append) {
      newContent = oldContent + (oldContent.endsWith('\n') ? '' : '\n') + new_string;
    }
    // Method 2: Line numbers
    else if (start_line !== undefined && end_line !== undefined) {
      const lines = oldContent.split('\n');
      const startIdx = start_line - 1; // Convert to 0-based
      const endIdx = end_line; // end_line is inclusive, but slice end is exclusive

      if (startIdx < 0 || endIdx > lines.length || startIdx >= endIdx) {
        return { error: `Invalid line range: ${start_line}-${end_line} (file has ${lines.length} lines)` };
      }

      const newLines = new_string.split('\n');
      lines.splice(startIdx, endIdx - startIdx, ...newLines);
      newContent = lines.join('\n');
    }
    // Method 1: Search/replace
    else if (old_string !== undefined) {
      // Strip line number prefixes from old_string
      const cleanOldString = stripLineNumberPrefix(old_string);

      if (!oldContent.includes(cleanOldString)) {
        return {
          error: `old_string not found in file. Make sure the text matches exactly.`,
          hint: 'Use read_file to see the current content.',
        };
      }

      if (replace_all) {
        newContent = oldContent.split(cleanOldString).join(new_string);
      } else {
        // Check for multiple occurrences
        const count = oldContent.split(cleanOldString).length - 1;
        if (count > 1) {
          return {
            error: `old_string appears ${count} times. Use replace_all: true or provide more context for unique match.`,
          };
        }
        newContent = oldContent.replace(cleanOldString, new_string);
      }
    } else {
      return { error: 'Must provide old_string, start_line/end_line, or append: true' };
    }

    // Write the modified content
    await fs.writeFile(absolutePath, newContent, 'utf-8');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex').substring(0, 16);

    // Queue re-ingestion (non-blocking)
    const ingestionResult = await triggerReIngestion(ctx.brain, absolutePath, 'updated');
    const wasQueued = ingestionResult?.queued === true;

    return {
      path: filePath,
      absolute_path: absolutePath,
      change_type: 'updated',
      lines_before: oldContent.split('\n').length,
      lines_after: newContent.split('\n').length,
      hash: newHash,
      rag_synced: !wasQueued && !!ingestionResult,
      rag_queued: wasQueued,
      ingestion_stats: ingestionResult,
      project_id: ingestionResult?.projectId,
      note: wasQueued
        ? '📥 RAG update queued. brain_search will wait for completion.'
        : '✅ RAG graph updated.',
    };
  };
}

/**
 * Generate handler for delete_path (brain-aware)
 */
export function generateBrainDeletePathHandler(ctx: BrainToolsContext) {
  return async (params: { path: string; recursive?: boolean }): Promise<any> => {
    const { path: filePath, recursive = false } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.resolve(process.cwd(), filePath);

    // Check if path exists
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Path not found: ${absolutePath}` };
      }
      throw err;
    }

    const isDirectory = stat.isDirectory();

    // Delete
    if (isDirectory) {
      if (recursive) {
        await fs.rm(absolutePath, { recursive: true });
      } else {
        try {
          await fs.rmdir(absolutePath);
        } catch (err: any) {
          if (err.code === 'ENOTEMPTY') {
            return { error: `Directory not empty. Use recursive: true to delete non-empty directories.` };
          }
          throw err;
        }
      }
    } else {
      await fs.unlink(absolutePath);
    }

    // Trigger re-ingestion (will handle deletion in the project)
    const ingestionResult = await triggerReIngestion(ctx.brain, absolutePath, 'deleted');

    return {
      path: filePath,
      absolute_path: absolutePath,
      deleted: true,
      was_directory: isDirectory,
      rag_synced: !!ingestionResult,
      project_id: ingestionResult?.projectId,
    };
  };
}

/**
 * Generate move_file tool definition (brain-aware)
 */
export function generateBrainMoveFileTool(): GeneratedToolDefinition {
  return {
    name: 'move_file',
    description: `Move or rename a file or directory.

Creates parent directories if needed.
Updates the knowledge graph to reflect the new path.

Parameters:
- source: Current path
- destination: New path

Example: move_file({ source: "src/utils.ts", destination: "src/lib/utils.ts" })
Example: move_file({ source: "old-name.ts", destination: "new-name.ts" })`,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Current file/directory path',
        },
        destination: {
          type: 'string',
          description: 'New path',
        },
      },
      required: ['source', 'destination'],
    },
  };
}

/**
 * Generate handler for move_file (brain-aware)
 */
export function generateBrainMoveFileHandler(ctx: BrainToolsContext) {
  return async (params: { source: string; destination: string }): Promise<any> => {
    const { source, destination } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve paths
    const absoluteSource = pathModule.isAbsolute(source)
      ? source
      : pathModule.resolve(process.cwd(), source);
    const absoluteDestination = pathModule.isAbsolute(destination)
      ? destination
      : pathModule.resolve(process.cwd(), destination);

    // Check source exists
    try {
      await fs.access(absoluteSource);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Source not found: ${absoluteSource}` };
      }
      throw err;
    }

    // Check destination doesn't exist
    try {
      await fs.access(absoluteDestination);
      return { error: `Destination already exists: ${absoluteDestination}` };
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Create parent directories if needed
    const parentDir = pathModule.dirname(absoluteDestination);
    await fs.mkdir(parentDir, { recursive: true });

    // Move the file
    await fs.rename(absoluteSource, absoluteDestination);

    // Track in brain: delete old, create new
    await triggerReIngestion(ctx.brain, absoluteSource, 'deleted');
    const ingestionResult = await triggerReIngestion(ctx.brain, absoluteDestination, 'created');

    return {
      source,
      destination,
      absolute_source: absoluteSource,
      absolute_destination: absoluteDestination,
      moved: true,
      rag_synced: !!ingestionResult,
      project_id: ingestionResult?.projectId,
    };
  };
}

/**
 * Generate copy_file tool definition (brain-aware)
 */
export function generateBrainCopyFileTool(): GeneratedToolDefinition {
  return {
    name: 'copy_file',
    description: `Copy a file or directory.

Creates parent directories if needed.
Directories are copied recursively by default.
Fails if destination already exists (use overwrite: true to replace).

Parameters:
- source: File/directory to copy
- destination: Destination path
- overwrite: Replace if destination exists (default: false)

Example: copy_file({ source: "template.ts", destination: "src/new-file.ts" })
Example: copy_file({ source: "src/components", destination: "src/components-backup" })`,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source path',
        },
        destination: {
          type: 'string',
          description: 'Destination path',
        },
        overwrite: {
          type: 'boolean',
          description: 'Replace if destination exists (default: false)',
        },
      },
      required: ['source', 'destination'],
    },
  };
}

/**
 * Generate handler for copy_file (brain-aware)
 */
export function generateBrainCopyFileHandler(ctx: BrainToolsContext) {
  return async (params: { source: string; destination: string; overwrite?: boolean }): Promise<any> => {
    const { source, destination, overwrite = false } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve paths
    const absoluteSource = pathModule.isAbsolute(source)
      ? source
      : pathModule.resolve(process.cwd(), source);
    const absoluteDestination = pathModule.isAbsolute(destination)
      ? destination
      : pathModule.resolve(process.cwd(), destination);

    // Check source exists
    let sourceStat;
    try {
      sourceStat = await fs.stat(absoluteSource);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Source not found: ${absoluteSource}` };
      }
      throw err;
    }

    // Check destination
    if (!overwrite) {
      try {
        await fs.access(absoluteDestination);
        return { error: `Destination already exists: ${absoluteDestination}. Use overwrite: true to replace.` };
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    // Create parent directories if needed
    const parentDir = pathModule.dirname(absoluteDestination);
    await fs.mkdir(parentDir, { recursive: true });

    // Copy
    if (sourceStat.isDirectory()) {
      await fs.cp(absoluteSource, absoluteDestination, { recursive: true });
    } else {
      await fs.copyFile(absoluteSource, absoluteDestination);
    }

    // Track in brain: create new file
    const ingestionResult = await triggerReIngestion(ctx.brain, absoluteDestination, 'created');

    return {
      source,
      destination,
      absolute_source: absoluteSource,
      absolute_destination: absoluteDestination,
      copied: true,
      is_directory: sourceStat.isDirectory(),
      rag_synced: !!ingestionResult,
      project_id: ingestionResult?.projectId,
    };
  };
}

// ============================================
// notify_user - Send intermediate messages to user
// ============================================

/**
 * Generate notify_user tool definition
 * Allows the agent to communicate with the user during long operations
 */
export function generateNotifyUserTool(): GeneratedToolDefinition {
  return {
    name: 'notify_user',
    description: `Send a message to the user during execution.

Use this tool to:
- Inform the user about long-running operations ("This will take a moment...")
- Explain what you're about to do before starting
- Give progress updates during complex tasks
- Warn about potential issues or ask for patience

The message appears immediately in the UI, even while other tools are running.

Example: notify_user({ message: "Indexing the project, this may take a minute..." })`,
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to display to the user',
        },
      },
      required: ['message'],
    },
  };
}

/**
 * Generate handler for notify_user
 * This is a no-op - the actual display is handled by the TUI via onToolCall callback
 */
export function generateNotifyUserHandler() {
  return async (params: { message: string }) => {
    // The TUI handles this via onToolCall callback
    // We just return success
    return { notified: true, message: params.message };
  };
}

// ============================================
// update_todos - Display and update a todo list
// ============================================

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/**
 * Generate update_todos tool definition
 * Allows the agent to display and update a todo list in the TUI
 */
export function generateUpdateTodosTool(): GeneratedToolDefinition {
  return {
    name: 'update_todos',
    description: `Display and update a todo list in the UI.

Use this for complex tasks that have multiple steps. The todo list appears in the UI
and helps the user track progress.

WHEN TO USE:
- Tasks with 3+ distinct steps
- Multi-file changes
- Complex operations that take time
- When you want to show the user your plan

HOW TO USE:
1. At start: Create todos with status "pending"
2. Before starting a task: Set its status to "in_progress"
3. After completing: Set status to "completed"

Only ONE todo should be "in_progress" at a time.

Example:
update_todos({ todos: [
  { content: "Search for authentication code", status: "completed" },
  { content: "Read and analyze auth files", status: "in_progress" },
  { content: "Implement the fix", status: "pending" },
  { content: "Test the changes", status: "pending" }
]})`,
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete todo list (replaces previous)',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Task description' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Task status'
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  };
}

/**
 * Generate handler for update_todos
 * This is a no-op - the actual display is handled by the TUI via onToolCall callback
 */
export function generateUpdateTodosHandler() {
  return async (params: { todos: TodoItem[] }) => {
    // The TUI handles this via onToolCall callback
    return { updated: true, count: params.todos.length };
  };
}

// ============================================
// call_research_agent
// ============================================

/**
 * Generate call_research_agent tool definition
 * Allows calling the research agent with a question and getting a structured response
 */
export function generateCallResearchAgentTool(): GeneratedToolDefinition {
  return {
    name: 'call_research_agent',
    description: `Call the Research Agent with a question and get a comprehensive answer.

The Research Agent is optimized for information gathering:
- Searches the knowledge base (brain_search)
- Reads files (code, images, PDFs, documents)
- Explores file systems and dependencies
- Produces comprehensive markdown reports

Returns:
- report: The markdown report/answer
- confidence: 'high', 'medium', or 'low'
- sourcesUsed: List of files/searches referenced
- toolsUsed: List of tool names called
- toolCallDetails: Detailed history of each tool call with arguments and results
- iterations: Number of research iterations

Parameters:
- question: The question or research task
- cwd: Optional working directory for file operations
- max_iterations: Optional max tool call rounds (default: 15, use lower values like 2-3 for debugging)
- summarize_tool_context: Enable summarization of tool context when it gets large (default: true)
- tool_context_summarization_threshold: Character threshold to trigger summarization (default: 40000)

Example: call_research_agent({ question: "How does authentication work in this project?" })
Example: call_research_agent({ question: "Find auth files", max_iterations: 2 })  // Debug mode
Example: call_research_agent({ question: "...", summarize_tool_context: false })  // Disable summarization`,
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question or research task for the agent',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for file operations',
        },
        max_iterations: {
          type: 'number',
          description: 'Max tool call rounds (default: 15, use 2-3 for debugging)',
        },
        summarize_tool_context: {
          type: 'boolean',
          description: 'Enable tool context summarization when context gets large (default: true). Set to false to see raw tool results.',
        },
        tool_context_summarization_threshold: {
          type: 'number',
          description: 'Character threshold to trigger tool context summarization (default: 40000, ~10k tokens)',
        },
        use_native_tool_calling: {
          type: 'boolean',
          description: 'Use native Gemini API tool calling instead of XML parsing (default: false). Useful for debugging agent behavior.',
        },
      },
      required: ['question'],
    },
  };
}

/**
 * Generate handler for call_research_agent
 * Creates agent directly with logging enabled
 */
export function generateCallResearchAgentHandler(ctx: BrainToolsContext) {
  return async (params: {
    question: string;
    cwd?: string;
    max_iterations?: number;
    summarize_tool_context?: boolean;
    tool_context_summarization_threshold?: number;
    use_native_tool_calling?: boolean;
  }): Promise<any> => {
    const { question, cwd, max_iterations, summarize_tool_context, tool_context_summarization_threshold, use_native_tool_calling } = params;
    const os = await import('os');
    const fsPromises = await import('fs/promises');
    const pathModule = await import('path');

    // Dynamically import ResearchAgent to avoid circular dependencies
    const { createResearchAgent } = await import('../runtime/agents/research-agent.js');

    // Setup logging
    const { getFilenameTimestamp } = await import('../runtime/utils/timestamp.js');
    const logDir = pathModule.default.join(os.default.homedir(), '.ragforge', 'logs', 'agent-sessions');
    await fsPromises.mkdir(logDir, { recursive: true });
    const timestamp = getFilenameTimestamp();
    const sessionName = `session-${timestamp}`;
    const logPath = pathModule.default.join(logDir, `${sessionName}.json`);
    const reportPath = pathModule.default.join(logDir, `report-${timestamp}.md`);
    const promptsDir = pathModule.default.join(logDir, sessionName, 'prompts');
    await fsPromises.mkdir(promptsDir, { recursive: true });

    const agent = await createResearchAgent({
      brainManager: ctx.brain,
      cwd: cwd || process.cwd(),
      verbose: true,
      maxIterations: max_iterations ?? 15,
      logPath,
      promptsDir,
      // Tool context summarization options (exposed via MCP)
      summarizeToolContext: summarize_tool_context,
      toolContextSummarizationThreshold: tool_context_summarization_threshold,
      // Native tool calling (uses Gemini API directly instead of XML parsing)
      useNativeToolCalling: use_native_tool_calling,
      onReportUpdate: async (report: string) => {
        try {
          await fsPromises.writeFile(reportPath, report, 'utf-8');
        } catch {
          // Ignore write errors
        }
      },
    });

    const result = await agent.research(question);

    // Write final report
    await fsPromises.writeFile(reportPath, result.report, 'utf-8');

    // Return a structured response with all details
    return {
      report: result.report,
      confidence: result.confidence,
      sourcesUsed: result.sourcesUsed,
      toolsUsed: result.toolsUsed,
      toolCallDetails: result.toolCallDetails.map(tc => ({
        tool: tc.tool_name,
        arguments: tc.arguments,
        success: tc.success,
        duration_ms: tc.duration_ms,
        // Don't include full result to avoid bloating response, just a summary
        result_preview: typeof tc.result === 'string'
          ? tc.result.slice(0, 500) + (tc.result.length > 500 ? '...' : '')
          : JSON.stringify(tc.result).slice(0, 500),
      })),
      turns: result.turns,
      iterations: result.iterations,
      logPath,
      reportPath,
    };
  };
}

// ============================================
// Export all tools
// ============================================

/**
 * Generate all brain tool definitions
 */
export function generateBrainTools(): GeneratedToolDefinition[] {
  return [
    // Project management
    generateCreateProjectTool(),
    generateIngestDirectoryTool(),
    generateIngestWebPageTool(),
    generateBrainSearchTool(),
    generateForgetPathTool(),
    generateListBrainProjectsTool(),
    // Project exclusion
    generateExcludeProjectTool(),
    generateIncludeProjectTool(),
    // File watcher management
    generateListWatchersTool(),
    generateStartWatcherTool(),
    generateStopWatcherTool(),
    // File dirty marking
    generateMarkFileDirtyTool(),
    // Brain-aware file tools - handle touchFile for orphan files
    // and triggerReIngestion for file modifications
    generateBrainReadFileTool(),
    generateBrainReadFilesTool(), // Batch read multiple files
    generateBrainWriteFileTool(),
    generateBrainCreateFileTool(),
    generateBrainEditFileTool(),
    generateBrainDeletePathTool(),
    generateBrainMoveFileTool(),
    generateBrainCopyFileTool(),
    // Advanced: schema and direct Cypher queries
    generateGetSchemaTool(),
    generateRunCypherTool(),
    // Dependency analysis
    generateExtractDependencyHierarchyTool(),
    // Node exploration (dynamic relationship discovery)
    generateExploreNodeTool(),
    // User communication
    generateNotifyUserTool(),
    generateUpdateTodosTool(),
    // Research agent
    generateCallResearchAgentTool(),
  ];
}

/**
 * Generate all brain tool handlers
 */
export function generateBrainToolHandlers(ctx: BrainToolsContext): Record<string, (params: any) => Promise<any>> {
  return {
    // Project management
    create_project: generateCreateProjectHandler(ctx),
    ingest_directory: generateIngestDirectoryHandler(ctx),
    ingest_web_page: generateIngestWebPageHandler(ctx),
    brain_search: generateBrainSearchHandler(ctx),
    forget_path: generateForgetPathHandler(ctx),
    list_brain_projects: generateListBrainProjectsHandler(ctx),
    // Project exclusion
    exclude_project: generateExcludeProjectHandler(ctx),
    include_project: generateIncludeProjectHandler(ctx),
    // File watcher management
    list_watchers: generateListWatchersHandler(ctx),
    start_watcher: generateStartWatcherHandler(ctx),
    stop_watcher: generateStopWatcherHandler(ctx),
    // File dirty marking
    mark_file_dirty: generateMarkFileDirtyHandler(ctx),
    // Brain-aware file tools - these handle touchFile for orphan files
    // and trigger re-ingestion on file modifications
    read_file: generateBrainReadFileHandler(ctx),
    read_files: generateBrainReadFilesHandler(ctx), // Batch read multiple files
    write_file: generateBrainWriteFileHandler(ctx),
    create_file: generateBrainCreateFileHandler(ctx),
    edit_file: generateBrainEditFileHandler(ctx),
    delete_path: generateBrainDeletePathHandler(ctx),
    move_file: generateBrainMoveFileHandler(ctx),
    copy_file: generateBrainCopyFileHandler(ctx),
    // Advanced: schema and direct Cypher queries
    get_schema: generateGetSchemaHandler(),
    run_cypher: generateRunCypherHandler(ctx),
    // Dependency analysis
    extract_dependency_hierarchy: generateExtractDependencyHierarchyHandler(ctx),
    // Node exploration (dynamic relationship discovery)
    explore_node: generateExploreNodeHandler(ctx),
    // User communication
    notify_user: generateNotifyUserHandler(),
    update_todos: generateUpdateTodosHandler(),
    // Research agent
    call_research_agent: generateCallResearchAgentHandler(ctx),
  };
}

// ============================================
// Setup Tools (for MCP users, not agents)
// ============================================

/**
 * Generate set_api_key tool definition
 * This tool is for MCP server users to configure their API keys.
 * Not intended for automated agents.
 */
export function generateSetApiKeyTool(): GeneratedToolDefinition {
  return {
    name: 'set_api_key',
    description: `Set an API key in the brain's configuration.

⚠️ THIS TOOL IS FOR USERS, NOT AUTOMATED AGENTS.

Use this to configure your API keys for various services:
- gemini: Required for embeddings, web search, image analysis
- replicate: Optional, for 3D model generation

The key is stored in ~/.ragforge/.env and persists across sessions.

Example:
  set_api_key({ key_name: "gemini", key_value: "AIza..." })
  set_api_key({ key_name: "replicate", key_value: "r8_..." })`,
    inputSchema: {
      type: 'object',
      properties: {
        key_name: {
          type: 'string',
          enum: ['gemini', 'replicate'],
          description: 'Which API key to set (gemini or replicate)',
        },
        key_value: {
          type: 'string',
          description: 'The API key value',
        },
      },
      required: ['key_name', 'key_value'],
    },
  };
}

/**
 * Generate handler for set_api_key
 */
export function generateSetApiKeyHandler(ctx: BrainToolsContext) {
  return async (params: {
    key_name: 'gemini' | 'replicate';
    key_value: string;
  }): Promise<{ success: boolean; message: string }> => {
    const { key_name, key_value } = params;

    // Map key names to env var names
    const envVarNames: Record<string, string> = {
      gemini: 'GEMINI_API_KEY',
      replicate: 'REPLICATE_API_TOKEN',
    };

    const envVarName = envVarNames[key_name];
    if (!envVarName) {
      return {
        success: false,
        message: `Unknown key name: ${key_name}. Use 'gemini' or 'replicate'.`,
      };
    }

    // Read current .env
    const fs = await import('fs/promises');
    const path = await import('path');
    const envPath = path.join(ctx.brain.getBrainPath(), '.env');

    let envContent: string;
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch {
      // .env doesn't exist, create it
      envContent = `# RagForge Brain Configuration\n\n`;
    }

    // Check if the key already exists
    const regex = new RegExp(`^${envVarName}=.*$`, 'm');
    const commentRegex = new RegExp(`^#\\s*${envVarName}=.*$`, 'm');

    if (regex.test(envContent)) {
      // Update existing key
      envContent = envContent.replace(regex, `${envVarName}=${key_value}`);
    } else if (commentRegex.test(envContent)) {
      // Replace commented key with actual value
      envContent = envContent.replace(commentRegex, `${envVarName}=${key_value}`);
    } else {
      // Add new key
      envContent = envContent.trimEnd() + `\n${envVarName}=${key_value}\n`;
    }

    // Write back
    await fs.writeFile(envPath, envContent, 'utf-8');

    // Update in-memory config
    const config = ctx.brain.getConfig();
    if (key_name === 'gemini') {
      config.apiKeys.gemini = key_value;
    } else if (key_name === 'replicate') {
      config.apiKeys.replicate = key_value;
    }

    return {
      success: true,
      message: `${envVarName} has been set in ~/.ragforge/.env`,
    };
  };
}

/**
 * Generate get_brain_status tool definition
 */
export function generateGetBrainStatusTool(): GeneratedToolDefinition {
  return {
    name: 'get_brain_status',
    description: `Get the current status of the brain configuration.

Shows:
- Neo4j connection status
- Configured API keys (masked)
- Brain path
- Container status

Use this to check if everything is configured correctly.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };
}

/**
 * Generate handler for get_brain_status
 */
export function generateGetBrainStatusHandler(ctx: BrainToolsContext) {
  return async (): Promise<{
    brainPath: string;
    neo4j: { connected: boolean; uri?: string };
    apiKeys: { gemini: boolean; replicate: boolean };
    projects: number;
  }> => {
    const config = ctx.brain.getConfig();
    const neo4jClient = ctx.brain.getNeo4jClient();

    return {
      brainPath: config.path,
      neo4j: {
        connected: neo4jClient !== null,
        uri: config.neo4j.uri,
      },
      apiKeys: {
        gemini: !!config.apiKeys.gemini,
        replicate: !!config.apiKeys.replicate,
      },
      projects: ctx.brain.listProjects().length,
    };
  };
}

/**
 * Generate cleanup_brain tool definition
 */
export function generateCleanupBrainTool(): GeneratedToolDefinition {
  return {
    name: 'cleanup_brain',
    description: `Clean up the brain's data and optionally reset everything.

⚠️ THIS TOOL IS DESTRUCTIVE - USE WITH CAUTION.

Options:
- data_only: Clear all Neo4j data (keeps config and credentials)
- project: Delete a specific project only (requires project_id)
- full: Remove everything including Docker container, volumes, and ~/.ragforge

After cleanup with 'full', you'll need to restart the MCP server to reinitialize.

Example:
  cleanup_brain({ mode: "data_only", confirm: true })  // Clear all data
  cleanup_brain({ mode: "project", project_id: "my-project", confirm: true })  // Delete one project
  cleanup_brain({ mode: "full", confirm: true })  // Complete reset`,
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['data_only', 'project', 'full'],
          description: 'Cleanup mode: data_only (clear all), project (delete specific project), full (remove everything)',
        },
        project_id: {
          type: 'string',
          description: 'Project ID to delete (required when mode is "project")',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to proceed with cleanup',
        },
      },
      required: ['mode', 'confirm'],
    },
  };
}

/**
 * Generate handler for cleanup_brain
 */
export function generateCleanupBrainHandler(ctx: BrainToolsContext) {
  return async (params: {
    mode: 'data_only' | 'project' | 'full';
    project_id?: string;
    confirm: boolean;
  }): Promise<{ success: boolean; message: string; details?: string[] }> => {
    const { mode, project_id, confirm } = params;

    if (!confirm) {
      return {
        success: false,
        message: 'Cleanup requires confirm: true to proceed.',
      };
    }

    const details: string[] = [];
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const fs = await import('fs/promises');
    const path = await import('path');

    const brainPath = ctx.brain.getBrainPath();

    // Mode: Delete a specific project
    if (mode === 'project') {
      if (!project_id) {
        return {
          success: false,
          message: 'project_id is required when mode is "project"',
        };
      }

      const neo4jClient = ctx.brain.getNeo4jClient();
      if (!neo4jClient) {
        return {
          success: false,
          message: 'Neo4j client not available',
        };
      }

      try {
        // Delete all nodes with this projectId
        const result = await neo4jClient.run(
          'MATCH (n {projectId: $projectId}) DETACH DELETE n RETURN count(n) as deleted',
          { projectId: project_id }
        );
        const deletedCount = result.records[0]?.get('deleted')?.toNumber() || 0;
        details.push(`Deleted ${deletedCount} nodes with projectId: ${project_id}`);

        // Also delete the Project node itself
        await neo4jClient.run(
          'MATCH (p:Project {projectId: $projectId}) DETACH DELETE p',
          { projectId: project_id }
        );

        // Stop watcher if active (so it can be restarted fresh on next ingest)
        const projects = await ctx.brain.listProjects();
        const project = projects.find(p => p.id === project_id);
        if (project?.path) {
          try {
            await ctx.brain.stopWatching(project.path);
            details.push(`Stopped watcher for: ${project.path}`);
          } catch (err: any) {
            // Watcher might not be active, ignore
          }
        }

        // Remove from registry
        try {
          await ctx.brain.unregisterProject(project_id);
          details.push(`Removed project from registry: ${project_id}`);
        } catch (err: any) {
          details.push(`Warning: Could not remove from registry: ${err.message}`);
        }

        return {
          success: true,
          message: `Project "${project_id}" deleted successfully.`,
          details,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to delete project: ${err.message}`,
        };
      }
    }

    if (mode === 'data_only') {
      // Just clear Neo4j data
      const neo4jClient = ctx.brain.getNeo4jClient();
      if (neo4jClient) {
        try {
          await neo4jClient.run('MATCH (n) DETACH DELETE n');
          details.push('Cleared all Neo4j nodes and relationships');
        } catch (err: any) {
          return {
            success: false,
            message: `Failed to clear Neo4j data: ${err.message}`,
          };
        }
      }

      // Clear projects registry (both file and in-memory)
      try {
        await ctx.brain.clearProjectsRegistry();
        details.push('Cleared projects registry');
      } catch (err: any) {
        details.push(`Warning: Could not clear projects registry: ${err.message}`);
      }

      return {
        success: true,
        message: 'Brain data cleared successfully. Config and credentials preserved.',
        details,
      };
    }

    // Full cleanup
    if (mode === 'full') {
      // Stop and remove Docker container
      try {
        await execAsync('docker compose down -v', { cwd: brainPath });
        details.push('Stopped Docker container and removed volumes');
      } catch {
        // Container might not be running
        try {
          await execAsync('docker rm -f ragforge-brain-neo4j');
          details.push('Removed Docker container');
        } catch {
          // Container might not exist
        }
      }

      // Remove Docker volumes
      try {
        await execAsync('docker volume rm ragforge_brain_data ragforge_brain_logs 2>/dev/null || true');
        details.push('Removed Docker volumes');
      } catch {
        // Volumes might not exist
      }

      // Remove ~/.ragforge directory
      try {
        await fs.rm(brainPath, { recursive: true, force: true });
        details.push(`Removed ${brainPath}`);
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to remove brain directory: ${err.message}`,
          details,
        };
      }

      // Reset the singleton and reinitialize fresh
      BrainManager.resetInstance();
      details.push('Reset BrainManager singleton');

      // Get a fresh instance and reinitialize
      try {
        const newBrain = await BrainManager.getInstance();
        await newBrain.initialize();
        // Update the context so all handlers use the new instance
        ctx.brain = newBrain;
        details.push('Reinitialized fresh BrainManager');
      } catch (err: any) {
        details.push(`Failed to reinitialize: ${err.message}`);
        return {
          success: true,
          message: 'Full cleanup complete but failed to reinitialize. Restart MCP server to fix.',
          details,
        };
      }

      return {
        success: true,
        message: 'Full cleanup complete. Brain has been reinitialized fresh.',
        details,
      };
    }

    return {
      success: false,
      message: `Unknown mode: ${mode}`,
    };
  };
}

// ============================================
// Get Schema Tool
// ============================================

/**
 * Generate get_schema tool definition
 * Returns the schema of indexed node types from NODE_SCHEMAS
 */
export function generateGetSchemaTool(): GeneratedToolDefinition {
  const nodeTypes = Object.keys(NODE_SCHEMAS).sort();

  return {
    name: 'get_schema',
    description: `Get the schema of indexed node types in the knowledge base.

Returns all node types and their required properties. Use this before writing Cypher queries with run_cypher.

**Available node types**: ${nodeTypes.join(', ')}

**Common relationships**:
- (Scope)-[:DEFINED_IN]->(File)
- (File)-[:IN_DIRECTORY]->(Directory)
- (MarkdownSection)-[:IN_DOCUMENT]->(MarkdownDocument)
- (CodeBlock)-[:IN_SECTION]->(MarkdownSection)`,
    inputSchema: {
      type: 'object',
      properties: {
        node_type: {
          type: 'string',
          description: 'Optional: get schema for a specific node type only',
          enum: nodeTypes,
        },
      },
    },
  };
}

/**
 * Schema info returned by get_schema
 */
interface SchemaInfo {
  required: string[];
  optional?: string[];
  description?: string;
}

/**
 * Generate handler for get_schema
 */
export function generateGetSchemaHandler() {
  return async (params: { node_type?: string }): Promise<{
    node_types: Record<string, SchemaInfo>;
    relationships: string[];
    tips: string[];
  }> => {
    const { node_type } = params;

    // Build node types response
    const node_types: Record<string, SchemaInfo> = {};

    if (node_type) {
      // Single node type
      const schema = NODE_SCHEMAS[node_type];
      if (!schema) {
        return {
          node_types: {},
          relationships: [],
          tips: [`Unknown node type: ${node_type}. Available: ${Object.keys(NODE_SCHEMAS).join(', ')}`],
        };
      }
      node_types[node_type] = {
        required: schema.required,
        optional: schema.optional,
        description: schema.description,
      };
    } else {
      // All node types
      for (const [name, schema] of Object.entries(NODE_SCHEMAS)) {
        node_types[name] = {
          required: schema.required,
          optional: schema.optional,
          description: schema.description,
        };
      }
    }

    // Common relationships
    const relationships = [
      '(Scope)-[:DEFINED_IN]->(File) - Code scopes belong to files',
      '(Scope)-[:HAS_PARENT]->(Scope) - Nested scopes',
      '(Scope)-[:INHERITS_FROM]->(Scope) - Class inheritance',
      '(Scope)-[:IMPLEMENTS]->(Scope) - Interface implementation',
      '(Scope)-[:USES_LIBRARY]->(ExternalLibrary) - Library usage',
      '(File)-[:IN_DIRECTORY]->(Directory) - Files are in directories',
      '(File)-[:BELONGS_TO]->(Project) - Files belong to projects',
      '(MarkdownDocument)-[:DEFINED_IN]->(File) - Markdown docs have source files',
      '(MarkdownSection)-[:HAS_SECTION]->(MarkdownDocument) - Sections in documents',
      '(MarkdownSection)-[:CHILD_OF]->(MarkdownSection) - Section hierarchy',
      '(CodeBlock)-[:CONTAINS_CODE]->(MarkdownDocument) - Code blocks in documents',
      '(WebPage)-[:LINKS_TO]->(WebPage) - Web page links',
      '(WebPage)-[:HAS_PAGE]->(Website) - Pages belong to websites',
    ];

    // Tips for Cypher queries
    const tips = [
      'Use MATCH (n:NodeType) to query specific node types',
      'Filter by project: WHERE n.projectId = "project-id"',
      'Search by name: WHERE n.name CONTAINS "search"',
      'Search by file: WHERE n.file CONTAINS "path/to/file"',
      'Get functions: MATCH (n:Scope) WHERE n.type = "function"',
      'Get classes with methods: MATCH (c:Scope)-[:HAS_PARENT]-(m:Scope) WHERE c.type = "class"',
      'Limit results: LIMIT 10',
    ];

    return { node_types, relationships, tips };
  };
}

// ============================================
// Run Cypher Tool
// ============================================

/**
 * Generate run_cypher tool definition
 */
export function generateRunCypherTool(): GeneratedToolDefinition {
  return {
    name: 'run_cypher',
    description: `Execute a Cypher query directly on the Neo4j database.

⚠️ USE WITH CAUTION - This tool can modify or delete data.

**IMPORTANT**: Before writing Cypher queries, call get_schema() first to understand:
- Available node types (Scope, File, MarkdownSection, etc.)
- Node properties for each type
- Relationships between nodes

Best for:
- Debugging and inspecting the knowledge graph
- Ad-hoc queries to understand data structure
- Checking node counts, properties, relationships

Examples:
  run_cypher({ query: "MATCH (n) RETURN labels(n)[0] as label, count(n) as cnt ORDER BY cnt DESC LIMIT 10" })
  run_cypher({ query: "MATCH (n) WHERE n.schemaDirty = true RETURN count(n)" })
  run_cypher({ query: "MATCH (n:Scope) RETURN n.name, n.file LIMIT 5" })

Parameters:
- query: The Cypher query to execute
- params: Optional parameters for the query (for parameterized queries)`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Cypher query to execute',
        },
        params: {
          type: 'object',
          description: 'Optional parameters for parameterized queries',
        },
      },
      required: ['query'],
    },
  };
}

/**
 * Generate handler for run_cypher
 */
export function generateRunCypherHandler(ctx: BrainToolsContext) {
  return async (params: { query: string; params?: Record<string, unknown> }): Promise<{
    success: boolean;
    records?: Array<Record<string, unknown>>;
    summary?: { counters: Record<string, number> };
    error?: string;
  }> => {
    // Delegate to BrainManager.runCypher which handles:
    // - Lock waiting
    // - Pending edits flush
    // - Query execution
    // - Result conversion
    return ctx.brain.runCypher(params.query, params.params || {});
  };
}

// ============================================
// Extract Dependency Hierarchy Tool
// ============================================

/**
 * Generate extract_dependency_hierarchy tool definition
 */
export function generateExtractDependencyHierarchyTool(): GeneratedToolDefinition {
  return {
    name: 'extract_dependency_hierarchy',
    section: 'rag_ops',
    description: `Extract dependency hierarchy (CONSUMES/CONSUMED_BY) from grep/fuzzy search results.

Takes grep/fuzzy search results (file + line) and builds a dependency graph showing:
- What the scope consumes (dependencies)
- What consumes the scope (consumers)
- Recursive traversal up to specified depth
- Relevant code snippets for each scope in the hierarchy

Can be used in two ways:
1. Single scope: Provide file + line directly
2. Batch from grep/fuzzy results: Provide results array from grep_files or search_files

Parameters:
- file: File path (relative to project root) - required if not using results
- line: Line number in the file - required if not using results
- results: Array of results from grep_files or search_files - alternative to file/line
- depth: Maximum depth for recursive traversal (default: 2)
- direction: 'both' (default), 'consumes' (dependencies), 'consumed_by' (consumers), or 'inherits' (inheritance hierarchy)
- include_inheritance: Include INHERITS_FROM relationships (default: false)
- max_nodes: Maximum number of nodes to return per scope (default: 50)
- include_code_snippets: Extract relevant code lines for each scope (default: true)
- code_snippet_lines: Number of lines to extract per scope (default: 10)
- max_scopes: Maximum number of scopes to process when using results (default: 10)

Returns a structured dependency graph with:
- root: The scope found at file:line (or array of roots if using results)
- dependencies: Scopes that root consumes (recursive)
- consumers: Scopes that consume root (recursive)
- graph: Full graph structure for visualization
- code_snippets: Relevant code snippets for each scope

Example (single): extract_dependency_hierarchy({ file: "src/auth.ts", line: 42, depth: 2 })
Example (batch): extract_dependency_hierarchy({ results: grepResults.matches, depth: 1 })`,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (relative to project root)',
        },
        line: {
          type: 'number',
          description: 'Line number in the file',
        },
        depth: {
          type: 'number',
          description: 'Maximum depth for recursive traversal (default: 2)',
          default: 2,
        },
        direction: {
          type: 'string',
          enum: ['both', 'consumes', 'consumed_by', 'inherits'],
          description: 'Direction of traversal: both (default), consumes (dependencies), consumed_by (consumers), or inherits (inheritance hierarchy)',
          default: 'both',
        },
        include_inheritance: {
          type: 'boolean',
          description: 'Include INHERITS_FROM relationships in addition to CONSUMES (default: false)',
          default: false,
        },
        max_nodes: {
          type: 'number',
          description: 'Maximum number of nodes to return (default: 50)',
          default: 50,
        },
        include_code_snippets: {
          type: 'boolean',
          description: 'Extract relevant code lines for each scope (default: true)',
          default: true,
        },
        code_snippet_lines: {
          type: 'number',
          description: 'Number of lines to extract per scope (default: 10)',
          default: 10,
        },
        results: {
          type: 'array',
          description: 'Array of results from grep_files or search_files (alternative to file/line)',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              content: { type: 'string' },
              match: { type: 'string' },
            },
          },
        },
        max_scopes: {
          type: 'number',
          description: 'Maximum number of scopes to process when using results (default: 10)',
          default: 10,
        },
      },
      // Either file+line OR results must be provided
    },
  };
}

/**
 * Helper: Extract relevant code lines from a scope
 */
async function extractCodeSnippet(
  neo4jClient: any,
  scopeUuid: string,
  snippetLines: number
): Promise<string | null> {
  try {
    // Get source from Neo4j
    const sourceResult = await neo4jClient.run(
      `MATCH (s:Scope {uuid: $uuid})
       RETURN s.source AS source`,
      { uuid: scopeUuid }
    );

    if (sourceResult.records.length > 0) {
      const source = sourceResult.records[0].get('source') as string | null;
      if (source) {
        // Extract first few lines from source (signature + beginning)
        const lines = source.split('\n');
        const snippet = lines.slice(0, Math.min(snippetLines, lines.length)).join('\n');
        return snippet;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Generate handler for extract_dependency_hierarchy
 */
export function generateExtractDependencyHierarchyHandler(ctx: BrainToolsContext) {
  return async (params: {
    file?: string;
    line?: number;
    results?: Array<{ file: string; line: number; content?: string; match?: string }>;
    depth?: number;
    direction?: 'both' | 'consumes' | 'consumed_by' | 'inherits';
    include_inheritance?: boolean;
    max_nodes?: number;
    include_code_snippets?: boolean;
    code_snippet_lines?: number;
    max_scopes?: number;
  }) => {
    const {
      file,
      line,
      results,
      depth = 2,
      direction = 'both',
      include_inheritance = false,
      max_nodes = 50,
      include_code_snippets = true,
      code_snippet_lines = 10,
      max_scopes = 10,
    } = params;

    // Validate input: either file+line OR results must be provided
    if (!results && (!file || line === undefined)) {
      return {
        error: 'Either file+line or results array must be provided',
        root: null,
        dependencies: [],
        consumers: [],
        graph: { nodes: [], edges: [] },
        code_snippets: {},
      };
    }

    // Ensure projects are synced before extraction (like brain_search does)
    // This starts watchers if not active and waits for ingestion to complete
    // Note: ensureProjectSynced may initialize the Neo4j connection, so call it first
    const projects = ctx.brain.listProjects();
    for (const project of projects) {
      try {
        await ensureProjectSynced(ctx.brain, project.path);
      } catch (err: any) {
        // Continue if sync fails - extraction can still work
      }
    }

    // Wait for ingestion lock if needed (for data consistency)
    const ingestionLock = ctx.brain.getIngestionLock();
    if (ingestionLock.isLocked()) {
      await ingestionLock.waitForUnlock(300000); // 5 minutes timeout
    }

    // Check Neo4j client availability after syncing (like brain_search pattern)
    const neo4j = ctx.brain.getNeo4jClient();
    if (!neo4j) {
      return {
        error: 'Neo4j client not available',
        root: null,
        dependencies: [],
        consumers: [],
        graph: { nodes: [], edges: [] },
        code_snippets: {},
      };
    }

    // If results provided, process batch
    if (results && results.length > 0) {
      return await processBatchResults(ctx, results, {
        depth,
        direction,
        include_inheritance,
        max_nodes,
        include_code_snippets,
        code_snippet_lines,
        max_scopes,
      });
    }

    // Otherwise, process single file+line
    return await processSingleScope(ctx, file!, line!, {
      depth,
      direction,
      include_inheritance,
      max_nodes,
      include_code_snippets,
      code_snippet_lines,
    });
  };
}

/**
 * Normalize file path to match Neo4j storage format
 * Tries multiple formats: with/without packages/, relative/absolute
 */
function normalizeFilePath(file: string, projectRoot?: string): string[] {
  const candidates: string[] = [];
  
  // Normalize the path (remove ./ and ../)
  const normalized = path.normalize(file).replace(/^\.\//, '');
  
  // Remove leading slash if present
  const withoutLeadingSlash = normalized.replace(/^\//, '');
  
  // Try different formats
  candidates.push(withoutLeadingSlash); // Most common: relative path without packages/
  
  // Try with packages/ prefix removed
  if (withoutLeadingSlash.startsWith('packages/')) {
    candidates.push(withoutLeadingSlash.replace(/^packages\//, ''));
  }
  
  // Try adding packages/ if not present
  if (!withoutLeadingSlash.startsWith('packages/')) {
    candidates.push(`packages/${withoutLeadingSlash}`);
  }
  
  // Try relative to project root if provided
  if (projectRoot) {
    try {
      const relativePath = path.relative(projectRoot, path.resolve(projectRoot, withoutLeadingSlash));
      if (relativePath && relativePath !== withoutLeadingSlash) {
        candidates.push(relativePath);
      }
    } catch {
      // Ignore errors in path resolution
    }
  }
  
  // Remove duplicates while preserving order
  return [...new Set(candidates)];
}

/**
 * Process single scope extraction
 */
async function processSingleScope(
  ctx: BrainToolsContext,
  file: string,
  line: number,
  options: {
    depth: number;
    direction: 'both' | 'consumes' | 'consumed_by' | 'inherits';
    include_inheritance: boolean;
    max_nodes: number;
    include_code_snippets: boolean;
    code_snippet_lines: number;
  }
) {
  const {
    depth,
    direction,
    include_inheritance,
    max_nodes,
    include_code_snippets,
    code_snippet_lines,
  } = options;

    const neo4j = ctx.brain.getNeo4jClient();
    if (!neo4j) {
      return {
        error: 'Neo4j client not available',
        root: null,
        dependencies: [],
        consumers: [],
        graph: { nodes: [], edges: [] },
        code_snippets: {},
      };
    }

    const neo4jDriver = await import('neo4j-driver');
    const toNumber = (value: any): number => {
      if (typeof value === 'number') return value;
      if (value?.toNumber) return value.toNumber();
      return 0;
    };

    try {
      // Normalize file path - try multiple formats
      const fileCandidates = normalizeFilePath(file);
      
      // 1. Trouver le scope correspondant à file:line (try multiple path formats)
      let scopeResult: any = null;
      for (const candidateFile of fileCandidates) {
        const result = await neo4j.run(
          `MATCH (s:Scope)
           WHERE s.file = $file
             AND s.startLine IS NOT NULL
             AND s.endLine IS NOT NULL
             AND s.startLine <= $line
             AND s.endLine >= $line
             AND NOT s:MarkdownSection
             AND NOT s:WebPage
             AND NOT s:DocumentFile
           RETURN s.uuid AS uuid, s.name AS name, s.type AS type, 
                  s.startLine AS startLine, s.endLine AS endLine,
                  s.file AS file, s.source AS source
           ORDER BY (s.endLine - s.startLine) ASC
           LIMIT 1`,
          { file: candidateFile, line: neo4jDriver.int(line) }
        );
        
        if (result.records.length > 0) {
          scopeResult = result;
          break; // Found a match, stop trying other formats
        }
      }

      if (!scopeResult || scopeResult.records.length === 0) {
        return {
          error: `No scope found at ${file}:${line}`,
          root: null,
          dependencies: [],
          consumers: [],
          graph: { nodes: [], edges: [] },
          code_snippets: {},
        };
      }

      const rootRecord = scopeResult.records[0];
      const rootUuid = rootRecord.get('uuid') as string;
      const rootName = rootRecord.get('name') as string;
      const rootType = rootRecord.get('type') as string;
      const rootStartLine = toNumber(rootRecord.get('startLine'));
      const rootEndLine = toNumber(rootRecord.get('endLine'));

      // 2. Construire la requête Cypher pour extraire la hiérarchie
      let cypher = '';
      const queryParams: Record<string, any> = {
        rootUuid,
        depth: neo4jDriver.int(depth),
        maxNodes: neo4jDriver.int(max_nodes),
      };

      if (direction === 'both' || direction === 'consumes') {
        // Dependencies: ce que le scope consomme (récursif)
        cypher += `
        // Dependencies (what root consumes)
        MATCH path = (root:Scope {uuid: $rootUuid})-[:CONSUMES*1..${depth}]->(dep:Scope)
        WHERE NOT dep.uuid = $rootUuid
        WITH root, dep, length(path) AS depth_level
        ORDER BY depth_level, dep.name
        LIMIT $maxNodes
        RETURN DISTINCT dep.uuid AS uuid, dep.name AS name, dep.type AS type,
               dep.file AS file, dep.startLine AS startLine, dep.endLine AS endLine,
               depth_level AS depth, 'CONSUMES' AS relationType
        `;
      }

      if (direction === 'both') {
        cypher += '\nUNION\n';
      }

      if (direction === 'both' || direction === 'consumed_by') {
        // Consumers: ce qui consomme le scope (récursif)
        cypher += `
        // Consumers (what consumes root)
        MATCH path = (consumer:Scope)-[:CONSUMES*1..${depth}]->(root:Scope {uuid: $rootUuid})
        WHERE NOT consumer.uuid = $rootUuid
        WITH root, consumer, length(path) AS depth_level
        ORDER BY depth_level, consumer.name
        LIMIT $maxNodes
        RETURN DISTINCT consumer.uuid AS uuid, consumer.name AS name, consumer.type AS type,
               consumer.file AS file, consumer.startLine AS startLine, consumer.endLine AS endLine,
               depth_level AS depth, 'CONSUMED_BY' AS relationType
        `;
      }

      // Si include_inheritance est activé, ajouter les relations INHERITS_FROM
      if (include_inheritance || direction === 'inherits') {
        if (cypher.length > 0) {
          cypher += '\nUNION\n';
        }
        cypher += `
        // Inheritance hierarchy (parents)
        MATCH path = (root:Scope {uuid: $rootUuid})-[:INHERITS_FROM*1..${depth}]->(parent:Scope)
        WHERE NOT parent.uuid = $rootUuid
        WITH root, parent, length(path) AS depth_level
        ORDER BY depth_level, parent.name
        LIMIT $maxNodes
        RETURN DISTINCT parent.uuid AS uuid, parent.name AS name, parent.type AS type,
               parent.file AS file, parent.startLine AS startLine, parent.endLine AS endLine,
               depth_level AS depth, 'INHERITS_FROM' AS relationType
        
        UNION
        
        // Inheritance hierarchy (children)
        MATCH path = (child:Scope)-[:INHERITS_FROM*1..${depth}]->(root:Scope {uuid: $rootUuid})
        WHERE NOT child.uuid = $rootUuid
        WITH root, child, length(path) AS depth_level
        ORDER BY depth_level, child.name
        LIMIT $maxNodes
        RETURN DISTINCT child.uuid AS uuid, child.name AS name, child.type AS type,
               child.file AS file, child.startLine AS startLine, child.endLine AS endLine,
               depth_level AS depth, 'INHERITED_BY' AS relationType
        `;
      }

      const hierarchyResult = await neo4j.run(cypher, queryParams);

      // 3. Construire le graphe structuré
      const dependencies: Array<{
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
        depth: number;
        relationType: string;
      }> = [];

      const consumers: Array<{
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
        depth: number;
        relationType: string;
      }> = [];

      const nodes = new Map<string, {
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
      }>();

      const edges: Array<{
        from: string;
        to: string;
        type: string;
        depth: number;
      }> = [];

      // Ajouter le root
      nodes.set(rootUuid, {
        uuid: rootUuid,
        name: rootName,
        type: rootType,
        file,
        startLine: rootStartLine,
        endLine: rootEndLine,
      });

      for (const record of hierarchyResult.records) {
        const uuid = record.get('uuid') as string;
        const name = record.get('name') as string;
        const type = record.get('type') as string;
        const file = record.get('file') as string;
        const startLine = toNumber(record.get('startLine'));
        const endLine = toNumber(record.get('endLine'));
        const depth = toNumber(record.get('depth'));
        const relationType = record.get('relationType') as string;

        if (uuid === rootUuid) {
          continue; // Skip root itself
        }

        nodes.set(uuid, { uuid, name, type, file, startLine, endLine });

        if (relationType === 'CONSUMES' || relationType === 'INHERITS_FROM') {
          dependencies.push({ uuid, name, type, file, startLine, endLine, depth, relationType });
          edges.push({ from: rootUuid, to: uuid, type: relationType, depth });
        } else if (relationType === 'CONSUMED_BY' || relationType === 'INHERITED_BY') {
          consumers.push({ uuid, name, type, file, startLine, endLine, depth, relationType });
          edges.push({ from: uuid, to: rootUuid, type: relationType, depth });
        }
      }

      // 4. Extraire les snippets de code si demandé
      const codeSnippets: Record<string, string> = {};
      if (include_code_snippets) {
        // Extract snippet for root
        const rootSnippet = await extractCodeSnippet(
          neo4j,
          rootUuid,
          code_snippet_lines
        );
        if (rootSnippet) {
          codeSnippets[rootUuid] = rootSnippet;
        }

        // Extract snippets for all nodes in hierarchy
        for (const node of nodes.values()) {
          if (node.uuid === rootUuid) continue; // Already done
          
          const snippet = await extractCodeSnippet(
            neo4j,
            node.uuid,
            code_snippet_lines
          );
          if (snippet) {
            codeSnippets[node.uuid] = snippet;
          }
        }
      }

      return {
        root: {
          uuid: rootUuid,
          name: rootName,
          type: rootType,
          file,
          startLine: rootStartLine,
          endLine: rootEndLine,
        },
        dependencies: dependencies.sort((a, b) => a.depth - b.depth),
        consumers: consumers.sort((a, b) => a.depth - b.depth),
        graph: {
          nodes: Array.from(nodes.values()),
          edges,
        },
        code_snippets: codeSnippets,
        stats: {
          total_nodes: nodes.size,
          dependencies_count: dependencies.length,
          consumers_count: consumers.length,
          max_depth_reached: Math.max(
            ...dependencies.map(d => d.depth),
            ...consumers.map(c => c.depth),
            0
          ),
        },
      };
    } catch (error: any) {
      return {
        error: error.message,
        root: null,
        dependencies: [],
        consumers: [],
        graph: { nodes: [], edges: [] },
        code_snippets: {},
      };
    }
}

/**
 * Process batch results from grep_files or search_files
 */
async function processBatchResults(
  ctx: BrainToolsContext,
  results: Array<{ file: string; line: number; content?: string; match?: string }>,
  options: {
    depth: number;
    direction: 'both' | 'consumes' | 'consumed_by' | 'inherits';
    include_inheritance: boolean;
    max_nodes: number;
    include_code_snippets: boolean;
    code_snippet_lines: number;
    max_scopes: number;
  }
) {
  const {
    depth,
    direction,
    include_inheritance,
    max_nodes,
    include_code_snippets,
    code_snippet_lines,
    max_scopes,
  } = options;

  const neo4j = ctx.brain.getNeo4jClient();
  if (!neo4j) {
    return {
      error: 'Neo4j client not available',
      roots: [],
      hierarchies: [],
      code_snippets: {},
    };
  }

  // Limit number of scopes to process
  const scopesToProcess = results.slice(0, max_scopes);
  const hierarchies: Array<{
    root: {
      uuid: string;
      name: string;
      type: string;
      file: string;
      startLine: number;
      endLine: number;
    } | null;
    dependencies: Array<any>;
    consumers: Array<any>;
    error?: string;
  }> = [];

  const allCodeSnippets: Record<string, string> = {};

  // Process each result in parallel (with limit)
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(5); // Process 5 scopes concurrently

  await Promise.all(
    scopesToProcess.map(result =>
      limit(async () => {
        const hierarchy = await processSingleScope(ctx, result.file, result.line, {
          depth,
          direction,
          include_inheritance,
          max_nodes,
          include_code_snippets,
          code_snippet_lines,
        });

        hierarchies.push({
          root: hierarchy.root,
          dependencies: hierarchy.dependencies || [],
          consumers: hierarchy.consumers || [],
          error: hierarchy.error,
        });

        if (hierarchy.code_snippets) {
          Object.assign(allCodeSnippets, hierarchy.code_snippets);
        }
      })
    )
  );

  // Filter out failed extractions
  const successfulHierarchies = hierarchies.filter(h => h.root !== null && !h.error);

  return {
    roots: successfulHierarchies.map(h => h.root!),
    hierarchies: successfulHierarchies,
    code_snippets: allCodeSnippets,
    stats: {
      total_results: results.length,
      processed: scopesToProcess.length,
      successful: successfulHierarchies.length,
      failed: hierarchies.length - successfulHierarchies.length,
    },
  };
}

// ============================================
// Explore Node Tool (Dynamic Relationship Discovery)
// ============================================

/**
 * Generate explore_node tool definition
 */
export function generateExploreNodeTool(): GeneratedToolDefinition {
  return {
    name: 'explore_node',
    section: 'rag_ops',
    description: `Explore all relationships of any node by UUID - automatically discovers relationship types.

This tool dynamically discovers what relationships a node has and explores them.
Works for any node type: Scope (functions, classes), WebPage, Document, MarkdownSection, CodeBlock, File, etc.

**Key Features:**
- Dynamic discovery: No need to specify relationship types - the tool finds them automatically
- Universal: Works with any node type in the knowledge graph
- Directional: Can explore outgoing, incoming, or both directions
- Depth control: Recursively explore related nodes up to specified depth

**Common Relationship Types (discovered automatically):**
- CONSUMES / CONSUMED_BY: Code dependencies
- INHERITS_FROM: Class/interface inheritance
- DEFINED_IN: Scope defined in file
- LINKS_TO: WebPage links
- IN_DOCUMENT / IN_SECTION: Document structure
- MENTIONS_FILE / MENTIONS_NODE: Summary references

Parameters:
- uuid: UUID of the node to explore (required)
- depth: How deep to explore relationships (default: 1, max: 3)
- direction: 'outgoing', 'incoming', or 'both' (default: 'both')
- include_content: Include source code or text content (default: false)
- max_nodes: Maximum related nodes to return per relationship type (default: 20)

Example: explore_node({ uuid: "scope:abc-123", depth: 2 })
Example: explore_node({ uuid: "webpage:xyz-456", direction: "outgoing" })`,
    inputSchema: {
      type: 'object',
      properties: {
        uuid: {
          type: 'string',
          description: 'UUID of the node to explore',
        },
        depth: {
          type: 'number',
          description: 'How deep to explore relationships (default: 1, max: 3)',
          default: 1,
        },
        direction: {
          type: 'string',
          enum: ['outgoing', 'incoming', 'both'],
          description: "Direction to explore: 'outgoing', 'incoming', or 'both' (default: 'both')",
          default: 'both',
        },
        include_content: {
          type: 'boolean',
          description: 'Include source code or text content for each node (default: false)',
          default: false,
        },
        max_nodes: {
          type: 'number',
          description: 'Maximum related nodes to return per relationship type (default: 20)',
          default: 20,
        },
      },
      required: ['uuid'],
    },
  };
}

/**
 * Generate handler for explore_node
 */
export function generateExploreNodeHandler(ctx: BrainToolsContext) {
  return async (params: {
    uuid: string;
    depth?: number;
    direction?: 'outgoing' | 'incoming' | 'both';
    include_content?: boolean;
    max_nodes?: number;
  }) => {
    const {
      uuid,
      depth = 1,
      direction = 'both',
      include_content = false,
      max_nodes = 20,
    } = params;

    if (!uuid || typeof uuid !== 'string' || uuid.trim().length === 0) {
      return {
        error: 'UUID is required',
        node: null,
        relationships: {},
      };
    }

    const neo4j = ctx.brain.getNeo4jClient();
    if (!neo4j) {
      return {
        error: 'Neo4j client not available',
        node: null,
        relationships: {},
      };
    }

    const clampedDepth = Math.min(Math.max(depth, 1), 3);

    try {
      // First, get the node itself
      const nodeResult = await neo4j.run(
        `MATCH (n {uuid: $uuid})
         RETURN n, labels(n) as labels`,
        { uuid: uuid.trim() }
      );

      if (nodeResult.records.length === 0) {
        return {
          error: `Node with UUID "${uuid}" not found`,
          node: null,
          relationships: {},
        };
      }

      const nodeRecord = nodeResult.records[0];
      const nodeProps = nodeRecord.get('n').properties;
      const nodeLabels = nodeRecord.get('labels') as string[];

      // Extract basic node info
      const nodeInfo = {
        uuid: nodeProps.uuid,
        name: nodeProps.name || nodeProps.title || nodeProps.signature || 'unnamed',
        type: nodeLabels[0] || 'unknown',
        labels: nodeLabels,
        file: nodeProps.file || nodeProps.absolutePath,
        url: nodeProps.url,
        startLine: nodeProps.startLine ? toNumber(nodeProps.startLine) : undefined,
        endLine: nodeProps.endLine ? toNumber(nodeProps.endLine) : undefined,
        ...(include_content && nodeProps.source ? { content: nodeProps.source.substring(0, 500) } : {}),
        ...(include_content && nodeProps.rawText ? { content: nodeProps.rawText.substring(0, 500) } : {}),
      };

      // Helper to convert Neo4j numbers
      function toNumber(value: any): number {
        if (typeof value === 'number') return value;
        if (value?.toNumber) return value.toNumber();
        if (value?.low !== undefined) return value.low;
        return 0;
      }

      // Discover and explore relationships
      const relationships: Record<string, Array<{
        uuid: string;
        name: string;
        type: string;
        file?: string;
        url?: string;
        startLine?: number;
        endLine?: number;
        depth: number;
        content?: string;
      }>> = {};

      // Build query based on direction
      const queries: Array<{ query: string; directionLabel: string }> = [];

      if (direction === 'both' || direction === 'outgoing') {
        queries.push({
          query: `
            MATCH (n {uuid: $uuid})-[r]->(related)
            RETURN type(r) as relationType, 'outgoing' as direction,
                   related.uuid as relatedUuid,
                   coalesce(related.name, related.title, related.signature) as relatedName,
                   labels(related)[0] as relatedType,
                   related.file as relatedFile,
                   related.absolutePath as relatedAbsolutePath,
                   related.url as relatedUrl,
                   related.startLine as startLine,
                   related.endLine as endLine,
                   related.source as source,
                   related.rawText as rawText
            LIMIT $limit
          `,
          directionLabel: 'outgoing',
        });
      }

      if (direction === 'both' || direction === 'incoming') {
        queries.push({
          query: `
            MATCH (n {uuid: $uuid})<-[r]-(related)
            RETURN type(r) as relationType, 'incoming' as direction,
                   related.uuid as relatedUuid,
                   coalesce(related.name, related.title, related.signature) as relatedName,
                   labels(related)[0] as relatedType,
                   related.file as relatedFile,
                   related.absolutePath as relatedAbsolutePath,
                   related.url as relatedUrl,
                   related.startLine as startLine,
                   related.endLine as endLine,
                   related.source as source,
                   related.rawText as rawText
            LIMIT $limit
          `,
          directionLabel: 'incoming',
        });
      }

      // Execute queries and collect results
      for (const { query, directionLabel } of queries) {
        const result = await neo4j.run(query, { uuid: uuid.trim(), limit: max_nodes });

        for (const record of result.records) {
          const relationType = record.get('relationType') as string;
          const dir = record.get('direction') as string;

          // Create key with direction suffix for clarity
          const key = dir === 'incoming' ? `${relationType}_BY` : relationType;

          if (!relationships[key]) {
            relationships[key] = [];
          }

          const relatedNode: any = {
            uuid: record.get('relatedUuid'),
            name: record.get('relatedName') || 'unnamed',
            type: record.get('relatedType') || 'unknown',
            file: record.get('relatedFile') || record.get('relatedAbsolutePath'),
            url: record.get('relatedUrl'),
            startLine: record.get('startLine') ? toNumber(record.get('startLine')) : undefined,
            endLine: record.get('endLine') ? toNumber(record.get('endLine')) : undefined,
            depth: 1,
          };

          if (include_content) {
            const source = record.get('source');
            const rawText = record.get('rawText');
            if (source) {
              relatedNode.content = source.substring(0, 300);
            } else if (rawText) {
              relatedNode.content = rawText.substring(0, 300);
            }
          }

          // Remove undefined fields
          Object.keys(relatedNode).forEach(k => {
            if (relatedNode[k] === undefined || relatedNode[k] === null) {
              delete relatedNode[k];
            }
          });

          relationships[key].push(relatedNode);
        }
      }

      // If depth > 1, recursively explore related nodes
      if (clampedDepth > 1) {
        const seenUuids = new Set<string>([uuid.trim()]);
        const nodesToExplore: Array<{ uuid: string; currentDepth: number }> = [];

        // Collect all UUIDs from depth 1
        for (const relType of Object.keys(relationships)) {
          for (const node of relationships[relType]) {
            if (node.uuid && !seenUuids.has(node.uuid)) {
              seenUuids.add(node.uuid);
              nodesToExplore.push({ uuid: node.uuid, currentDepth: 1 });
            }
          }
        }

        // Explore deeper levels
        for (const { uuid: nodeUuid, currentDepth } of nodesToExplore) {
          if (currentDepth >= clampedDepth) continue;

          // Query for this node's relationships
          for (const { query } of queries) {
            const result = await neo4j.run(query, { uuid: nodeUuid, limit: Math.floor(max_nodes / 2) });

            for (const record of result.records) {
              const relationType = record.get('relationType') as string;
              const dir = record.get('direction') as string;
              const relatedUuid = record.get('relatedUuid') as string;

              if (seenUuids.has(relatedUuid)) continue;
              seenUuids.add(relatedUuid);

              const key = dir === 'incoming' ? `${relationType}_BY` : relationType;

              if (!relationships[key]) {
                relationships[key] = [];
              }

              const relatedNode: any = {
                uuid: relatedUuid,
                name: record.get('relatedName') || 'unnamed',
                type: record.get('relatedType') || 'unknown',
                file: record.get('relatedFile') || record.get('relatedAbsolutePath'),
                url: record.get('relatedUrl'),
                startLine: record.get('startLine') ? toNumber(record.get('startLine')) : undefined,
                endLine: record.get('endLine') ? toNumber(record.get('endLine')) : undefined,
                depth: currentDepth + 1,
              };

              // Remove undefined fields
              Object.keys(relatedNode).forEach(k => {
                if (relatedNode[k] === undefined || relatedNode[k] === null) {
                  delete relatedNode[k];
                }
              });

              relationships[key].push(relatedNode);

              // Add to explore queue if we can go deeper
              if (currentDepth + 1 < clampedDepth) {
                nodesToExplore.push({ uuid: relatedUuid, currentDepth: currentDepth + 1 });
              }
            }
          }
        }
      }

      // Sort relationships by depth
      for (const key of Object.keys(relationships)) {
        relationships[key].sort((a, b) => a.depth - b.depth);
      }

      // Calculate stats
      const totalRelated = Object.values(relationships).reduce((sum, arr) => sum + arr.length, 0);
      const relationshipTypes = Object.keys(relationships);

      return {
        node: nodeInfo,
        relationships,
        stats: {
          relationship_types: relationshipTypes.length,
          total_related_nodes: totalRelated,
          max_depth_explored: clampedDepth,
          types_found: relationshipTypes,
        },
      };
    } catch (error: any) {
      return {
        error: error.message,
        node: null,
        relationships: {},
      };
    }
  };
}

// ============================================
// Setup Tools Export
// ============================================

/**
 * Generate all setup tool definitions (for MCP users, not agents)
 */
export function generateSetupTools(): GeneratedToolDefinition[] {
  return [
    generateSetApiKeyTool(),
    generateGetBrainStatusTool(),
    generateCleanupBrainTool(),
    generateRunCypherTool(),
  ];
}

/**
 * Generate all setup tool handlers
 */
export function generateSetupToolHandlers(ctx: BrainToolsContext): Record<string, (params: any) => Promise<any>> {
  return {
    set_api_key: generateSetApiKeyHandler(ctx),
    get_brain_status: generateGetBrainStatusHandler(ctx),
    cleanup_brain: generateCleanupBrainHandler(ctx),
    run_cypher: generateRunCypherHandler(ctx),
  };
}
