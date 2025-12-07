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

import type { BrainManager, QuickIngestOptions, BrainSearchOptions, QuickIngestResult, UnifiedSearchResult } from '../brain/index.js';
import type { GeneratedToolDefinition } from './types/index.js';
import { getGlobalFetchCache, type CachedFetchResult } from './web-tools.js';

/**
 * Context for brain tools
 */
export interface BrainToolsContext {
  brain: BrainManager;
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
      generateEmbeddings: params.generate_embeddings,
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
- Web pages crawled (when implemented)
- Documents analyzed

The search can be:
- Text-based: matches content and names
- Semantic: uses embeddings for meaning-based search (if embeddings generated)

Returns results from all known sources, sorted by relevance.

Example usage:
- brain_search({ query: "authentication logic" })
- brain_search({ query: "how to parse JSON", types: ["Function", "Class"] })
- brain_search({ query: "API endpoints", projects: ["my-backend"] })`,
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
          description: 'Use semantic/embedding-based search (default: false, uses text matching)',
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
    limit?: number;
  }): Promise<UnifiedSearchResult> => {
    const options: BrainSearchOptions = {
      projects: params.projects,
      nodeTypes: params.types,
      semantic: params.semantic,
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
// Export all tools
// ============================================

/**
 * Generate all brain tool definitions
 */
export function generateBrainTools(): GeneratedToolDefinition[] {
  return [
    generateIngestDirectoryTool(),
    generateIngestWebPageTool(),
    generateBrainSearchTool(),
    generateForgetPathTool(),
    generateListBrainProjectsTool(),
  ];
}

/**
 * Generate all brain tool handlers
 */
export function generateBrainToolHandlers(ctx: BrainToolsContext): Record<string, (params: any) => Promise<any>> {
  return {
    ingest_directory: generateIngestDirectoryHandler(ctx),
    ingest_web_page: generateIngestWebPageHandler(ctx),
    brain_search: generateBrainSearchHandler(ctx),
    forget_path: generateForgetPathHandler(ctx),
    list_brain_projects: generateListBrainProjectsHandler(ctx),
  };
}
