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
