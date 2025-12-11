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
import * as path from 'path';

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
- ingest_directory({ path: "./docs", project_name: "my-docs" })`,
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
  }): Promise<QuickIngestResult> => {
    const options: QuickIngestOptions = {
      projectName: params.project_name,
      include: params.include,
      exclude: params.exclude,
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
- brain_search({ query: "authentication logic", semantic: true })
- brain_search({ query: "how to parse JSON", types: ["function", "class"], semantic: true })
- brain_search({ query: "API endpoints", projects: ["my-backend"], semantic: true })`,
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
          description: 'Use semantic/embedding-based search (default: false, uses text matching). **Recommended: true** for best results.',
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
    limit?: number;
    use_reranking?: boolean;
    min_score?: number;
  }): Promise<UnifiedSearchResult & { waited_for_edits?: boolean; watchers_started?: string[]; flushed_projects?: string[]; reranked?: boolean }> => {
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
      log.debug(`Targeting ${targetProjects.length} projects`);

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

      log.info('Step 5: Executing search');
      // For reranking with semantic search, we need more candidates to rerank
      // Minimum 100 results for reranking, then apply limit after reranking
      const originalLimit = params.limit || 20;
      const searchLimit = (params.use_reranking && params.semantic) 
        ? Math.max(originalLimit, 100) 
        : originalLimit;
      
      const options: BrainSearchOptions = {
        projects: params.projects,
        nodeTypes: params.types,
        semantic: params.semantic,
        embeddingType: params.embedding_type,
        glob: params.glob,
        limit: searchLimit,
        minScore: params.min_score,
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
                  // Apply original limit after reranking (reranking was done on more candidates)
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

      const totalDuration = Date.now() - startTime;
      log.info('COMPLETE', { totalDuration, reranked });

      return {
        ...result,
        waited_for_edits: waitedForSync || undefined,
        watchers_started: watchersStarted.length > 0 ? watchersStarted : undefined,
        flushed_projects: flushedProjects.length > 0 ? flushedProjects : undefined,
        reranked: reranked || undefined,
      };
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      log.error('ERROR', error, { duration: totalDuration });
      throw error;
    }
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
- Type (ragforge-project, quick-ingest, web-crawl)
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
      await ctx.brain.startWatching(absolutePath, { verbose });
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

  return null;
}

/**
 * Generate read_file tool definition (brain-aware)
 */
export function generateBrainReadFileTool(): GeneratedToolDefinition {
  return {
    name: 'read_file',
    description: `Read file contents with line numbers.

Returns file content with line numbers (format: "00001| content").
Supports pagination with offset and limit for large files.

Parameters:
- path: Absolute or relative file path
- offset: Start line (0-based, optional)
- limit: Max lines to read (default: 2000)

Long lines (>2000 chars) are truncated with "...".
Binary files cannot be read.

Example: read_file({ path: "src/index.ts" })`,
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
 * Generate handler for read_file (brain-aware)
 */
export function generateBrainReadFileHandler(ctx: BrainToolsContext) {
  return async (params: { path: string; offset?: number; limit?: number }): Promise<any> => {
    const { path: filePath, offset = 0, limit = DEFAULT_READ_LIMIT } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path (use cwd as fallback)
    const absolutePath = pathModule.isAbsolute(filePath)
      ? filePath
      : pathModule.resolve(process.cwd(), filePath);

    // Check file exists
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `File not found: ${absolutePath}` };
      }
      throw err;
    }

    // Check if binary
    if (await isBinaryFile(absolutePath)) {
      return { error: `Cannot read binary file: ${absolutePath}` };
    }

    // Read file
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
    // Note: Brain-aware file tools (read_file, write_file, create_file, edit_file, delete_path)
    // are no longer exposed as separate tools. They are automatically handled by the
    // regular file tools via the onFileModified callback when brain is available.
    // Advanced: schema and direct Cypher queries
    generateGetSchemaTool(),
    generateRunCypherTool(),
    // Dependency analysis
    generateExtractDependencyHierarchyTool(),
    // User communication
    generateNotifyUserTool(),
    generateUpdateTodosTool(),
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
    // Note: Brain-aware file tools (read_file, write_file, create_file, edit_file, delete_path)
    // are no longer exposed as separate handlers. They are automatically handled by the
    // regular file tools via the onFileModified callback when brain is available.
    // Advanced: schema and direct Cypher queries
    get_schema: generateGetSchemaHandler(),
    run_cypher: generateRunCypherHandler(ctx),
    // Dependency analysis
    extract_dependency_hierarchy: generateExtractDependencyHierarchyHandler(ctx),
    // User communication
    notify_user: generateNotifyUserHandler(),
    update_todos: generateUpdateTodosHandler(),
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
