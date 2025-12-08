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
- ingest_directory({ path: "./docs", project_name: "my-docs", watch: true })`,
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
        watch: {
          type: 'boolean',
          description: 'Watch for file changes after ingestion (default: false)',
        },
        generate_embeddings: {
          type: 'boolean',
          description: 'Generate embeddings for semantic search (default: false)',
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
    watch?: boolean;
    generate_embeddings?: boolean;
  }): Promise<QuickIngestResult> => {
    const options: QuickIngestOptions = {
      projectName: params.project_name,
      include: params.include,
      exclude: params.exclude,
      watch: params.watch,
    };

    return ctx.brain.quickIngest(params.path, options);
  };
}

// ============================================
// brain_search
// ============================================

/**
 * Generate brain_search tool definition
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

For exact text/filename searches, prefer grep_files or glob_files instead.

Example usage:
- brain_search({ query: "authentication logic", semantic: true })
- brain_search({ query: "how to parse JSON", types: ["Function", "Class"], semantic: true })
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
          description: 'Limit to specific node types like "Function", "Class", "File" (default: all)',
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
  }): Promise<UnifiedSearchResult> => {
    const options: BrainSearchOptions = {
      projects: params.projects,
      nodeTypes: params.types,
      semantic: params.semantic,
      embeddingType: params.embedding_type,
      glob: params.glob,
      limit: params.limit,
    };

    return ctx.brain.search(params.query, options);
  };
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
  title: string;
  fromCache: boolean;
  projectName: string;
  nodeId?: string;
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

    // For depth=0, simple single page ingest
    if (depth === 0) {
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
        success: true,
        url: cached.url,
        title: cached.title,
        fromCache,
        projectName,
        nodeId: result.nodeId,
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
    }>;
    count: number;
  }> => {
    const projects = ctx.brain.listProjects().map(p => ({
      id: p.id,
      path: p.path,
      type: p.type,
      lastAccessed: p.lastAccessed.toISOString(),
      nodeCount: p.nodeCount,
    }));

    return {
      projects,
      count: projects.length,
    };
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
 * Helper: Trigger re-ingestion for a file's project
 */
async function triggerReIngestion(
  brain: BrainManager,
  absolutePath: string,
  changeType: 'created' | 'updated' | 'deleted'
): Promise<{ projectId?: string; stats?: any } | null> {
  const pathModule = await import('path');
  const ext = pathModule.extname(absolutePath).toLowerCase();

  // Media files use updateMediaContent
  const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.docx', '.xlsx', '.glb', '.gltf'];

  if (mediaExts.includes(ext) && changeType !== 'deleted') {
    try {
      await brain.updateMediaContent({
        filePath: absolutePath,
        extractionMethod: `file-tool-${changeType}`,
        generateEmbeddings: true,
      });
      return { projectId: 'media', stats: { mediaUpdated: true } };
    } catch (e: any) {
      console.warn(`[file-tool] Media re-ingestion failed: ${e.message}`);
      return null;
    }
  }

  // Code files use quickIngest on the project
  const project = await findProjectForFile(brain, absolutePath);
  if (project) {
    try {
      const result = await brain.quickIngest(project.path, {
        projectName: project.id,
      });
      return { projectId: project.id, stats: result.stats };
    } catch (e: any) {
      console.warn(`[file-tool] Code re-ingestion failed: ${e.message}`);
      return null;
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

    // Trigger re-ingestion
    const ingestionResult = await triggerReIngestion(ctx.brain, absolutePath, 'updated');

    return {
      path: filePath,
      absolute_path: absolutePath,
      change_type: 'updated',
      lines_before: oldContent.split('\n').length,
      lines_after: newContent.split('\n').length,
      hash: newHash,
      rag_synced: !!ingestionResult,
      ingestion_stats: ingestionResult?.stats,
      project_id: ingestionResult?.projectId,
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
    // File watcher management
    generateListWatchersTool(),
    generateStartWatcherTool(),
    generateStopWatcherTool(),
    // Brain-aware file tools
    generateBrainReadFileTool(),
    generateBrainWriteFileTool(),
    generateBrainCreateFileTool(),
    generateBrainEditFileTool(),
    generateBrainDeletePathTool(),
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
    // File watcher management
    list_watchers: generateListWatchersHandler(ctx),
    start_watcher: generateStartWatcherHandler(ctx),
    stop_watcher: generateStopWatcherHandler(ctx),
    // Brain-aware file tools
    read_file: generateBrainReadFileHandler(ctx),
    write_file: generateBrainWriteFileHandler(ctx),
    create_file: generateBrainCreateFileHandler(ctx),
    edit_file: generateBrainEditFileHandler(ctx),
    delete_path: generateBrainDeletePathHandler(ctx),
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
  };
}
