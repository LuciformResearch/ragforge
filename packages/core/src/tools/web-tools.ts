/**
 * Web Tools - Search Web & Fetch Web Pages
 *
 * Tools for web interactions:
 * - search_web: Search the web via Gemini grounding
 * - fetch_web_page: Render and extract content from web pages via Playwright
 *
 * @since 2025-12-07
 */

import type { GeneratedToolDefinition, ToolHandlerGenerator } from './types/index.js';

// ============================================
// Types
// ============================================

export interface WebSearchParams {
  query: string;
  structured?: boolean;
  schema?: object;
}

export interface WebSearchResult {
  query: string;
  answer: string;
  sources: {
    title: string;
    url: string;
  }[];
  searchedAt: string;
}

export interface FetchWebPageParams {
  url: string;
  extractText?: boolean;
  extractLinks?: boolean;
  extractImages?: boolean;
  screenshot?: boolean;
  waitFor?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Force re-fetch even if cached (default: false) */
  force?: boolean;
  /** Ingest page to brain after fetching (default: false) */
  ingest?: boolean;
  /** Project name for ingestion (required if ingest=true) */
  projectName?: string;
  /** Depth of recursive crawling (0 = just this page, 1 = follow links once, etc.) */
  depth?: number;
  /** Maximum pages to fetch when depth > 0 (default: 10) */
  maxPages?: number;
  /** Only follow links matching these patterns (regex strings) */
  includePatterns?: string[];
  /** Exclude links matching these patterns (regex strings) */
  excludePatterns?: string[];
}

export interface FetchWebPageResult {
  url: string;
  title: string;
  textContent?: string;
  html?: string;
  links?: { text: string; href: string }[];
  images?: { src: string; alt: string }[];
  headings?: { level: number; text: string }[];
  metaTags?: Record<string, string>;
  screenshotBase64?: string;
  fetchedAt: string;
  renderTimeMs: number;
  /** Whether result came from cache */
  fromCache?: boolean;
  /** Whether page was ingested to brain */
  ingested?: boolean;
  /** Project name if ingested */
  ingestedTo?: string;
  /** Depth at which this page was fetched (0 = start page) */
  depth?: number;
  /** Child pages fetched recursively (when depth > 0) */
  children?: FetchWebPageResult[];
  /** Total pages fetched (including children) */
  totalPagesFetched?: number;
}

/** Function to ingest a web page to brain */
export type WebPageIngestFunction = (params: {
  url: string;
  title: string;
  textContent: string;
  rawHtml: string;
  projectName?: string;
}) => Promise<{ success: boolean; nodeId?: string }>;

export interface WebToolsContext {
  /** Gemini API key for web search */
  geminiApiKey?: string;
  /** Whether Playwright is available */
  playwrightAvailable?: boolean;
  /** LRU cache for recent fetches (auto-created if not provided) */
  fetchCache?: WebFetchCache;
  /** Function to ingest web pages to brain (injected by runtime) */
  ingestWebPage?: WebPageIngestFunction;
  /** Current project name for ingestion */
  currentProjectName?: string;
}

// ============================================
// Fetch Cache (LRU - last 6 pages)
// ============================================

const MAX_CACHE_SIZE = 6;

export interface CachedFetchResult extends FetchWebPageResult {
  /** Raw HTML content for long-term storage */
  rawHtml: string;
  /** Cache timestamp */
  cachedAt: string;
}

export class WebFetchCache {
  private cache: Map<string, CachedFetchResult> = new Map();
  private order: string[] = [];

  /** Get cached result for URL */
  get(url: string): CachedFetchResult | undefined {
    const normalized = this.normalizeUrl(url);
    return this.cache.get(normalized);
  }

  /** Store fetch result in cache */
  set(url: string, result: FetchWebPageResult, rawHtml: string): CachedFetchResult {
    const normalized = this.normalizeUrl(url);

    // Remove if already exists (will re-add at end)
    if (this.cache.has(normalized)) {
      this.order = this.order.filter(u => u !== normalized);
    }

    // Create cached result
    const cached: CachedFetchResult = {
      ...result,
      rawHtml,
      cachedAt: new Date().toISOString(),
    };

    // Add to cache
    this.cache.set(normalized, cached);
    this.order.push(normalized);

    // Evict oldest if over limit
    while (this.order.length > MAX_CACHE_SIZE) {
      const oldest = this.order.shift()!;
      this.cache.delete(oldest);
    }

    return cached;
  }

  /** Check if URL is in cache */
  has(url: string): boolean {
    return this.cache.has(this.normalizeUrl(url));
  }

  /** Get all cached URLs */
  getUrls(): string[] {
    return [...this.order];
  }

  /** Clear cache */
  clear(): void {
    this.cache.clear();
    this.order = [];
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      let normalized = parsed.toString();
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return url;
    }
  }
}

/** Global fetch cache instance */
let globalFetchCache: WebFetchCache | null = null;

export function getGlobalFetchCache(): WebFetchCache {
  if (!globalFetchCache) {
    globalFetchCache = new WebFetchCache();
  }
  return globalFetchCache;
}

export function getFetchCache(context: WebToolsContext): WebFetchCache {
  return context.fetchCache ?? getGlobalFetchCache();
}

// ============================================
// Tool Definitions
// ============================================

export const searchWebToolDefinition: GeneratedToolDefinition = {
  name: 'search_web',
  description: `Search the web for current information using Google Search.
Returns an answer synthesized from web results along with source URLs.
Use this tool when you need up-to-date information that may not be in the codebase.
You can call this tool multiple times with refined queries if the first results are not sufficient.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific and include relevant keywords.'
      }
    },
    required: ['query']
  }
};

export const fetchWebPageToolDefinition: GeneratedToolDefinition = {
  name: 'fetch_web_page',
  description: `Fetch and render a web page, extracting its content.
Uses a headless browser to render JavaScript and extract text, links, images, and metadata.
Use this when you have a specific URL and need to extract its content.
The page is fully rendered including dynamic JavaScript content.

Supports recursive crawling with depth parameter:
- depth=0 (default): fetch only this page
- depth=1: fetch this page + all linked pages
- depth=2+: follow links recursively

Results are cached (last 6 pages). Use force=true to re-fetch.
Use ingest=true to save fetched pages to your brain for long-term memory.`,
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL to fetch (must start with http:// or https://)'
      },
      extractText: {
        type: 'boolean',
        description: 'Extract the visible text content (default: true)'
      },
      extractLinks: {
        type: 'boolean',
        description: 'Extract all links from the page (default: false, auto-enabled when depth > 0)'
      },
      extractImages: {
        type: 'boolean',
        description: 'Extract all image sources (default: false)'
      },
      screenshot: {
        type: 'boolean',
        description: 'Take a screenshot of the page (default: false)'
      },
      waitFor: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle'],
        description: 'When to consider the page loaded (default: networkidle)'
      },
      force: {
        type: 'boolean',
        description: 'Force re-fetch even if page is cached (default: false)'
      },
      ingest: {
        type: 'boolean',
        description: 'Ingest all fetched pages to brain for long-term memory (default: false)'
      },
      projectName: {
        type: 'string',
        description: 'Project name for ingestion (uses current project if not specified)'
      },
      depth: {
        type: 'number',
        description: 'Recursive crawl depth: 0=this page only, 1=follow links once, 2+=deeper (default: 0)'
      },
      maxPages: {
        type: 'number',
        description: 'Maximum pages to fetch when depth > 0 (default: 10)'
      },
      includePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only follow links matching these regex patterns (e.g., ["/docs/.*", "/api/.*"])'
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude links matching these regex patterns (e.g., ["/login", "/signup"])'
      }
    },
    required: ['url']
  }
};

// ============================================
// URL Pattern Matching
// ============================================

/**
 * Normalize URL for comparison (remove fragment, trailing slash)
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let normalized = parsed.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Check if URL matches include/exclude patterns
 */
function matchesUrlPatterns(
  url: string,
  includePatterns?: string[],
  excludePatterns?: string[]
): boolean {
  // Check exclude patterns first (any match = excluded)
  if (excludePatterns && excludePatterns.length > 0) {
    for (const pattern of excludePatterns) {
      try {
        if (new RegExp(pattern).test(url)) {
          return false;
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  // Check include patterns (if specified, at least one must match)
  if (includePatterns && includePatterns.length > 0) {
    for (const pattern of includePatterns) {
      try {
        if (new RegExp(pattern).test(url)) {
          return true;
        }
      } catch {
        // Invalid regex, skip
      }
    }
    return false; // No include pattern matched
  }

  return true; // No include patterns = include all
}

/**
 * Check if URL is on the same domain (for safety)
 */
function isSameDomain(baseUrl: string, targetUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const target = new URL(targetUrl);
    return base.hostname === target.hostname;
  } catch {
    return false;
  }
}

// ============================================
// Tool Implementations
// ============================================

async function searchWebImpl(
  params: WebSearchParams,
  context: WebToolsContext
): Promise<WebSearchResult> {
  const { query } = params;

  if (!context.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required for web search');
  }

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(context.geminiApiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    tools: [{
      googleSearch: {}
    }] as any
  });

  const result = await model.generateContent(query);
  const response = result.response;
  const text = response.text();

  // Extract grounding sources
  const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
  const sources: WebSearchResult['sources'] = [];

  if (groundingMetadata?.groundingChunks) {
    for (const chunk of groundingMetadata.groundingChunks) {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || 'Unknown',
          url: chunk.web.uri || ''
        });
      }
    }
  }

  return {
    query,
    answer: text,
    sources,
    searchedAt: new Date().toISOString()
  };
}

/**
 * Fetch a single page (internal helper)
 */
async function fetchSinglePage(
  url: string,
  browserContext: any,
  options: {
    extractText: boolean;
    extractLinks: boolean;
    extractImages: boolean;
    screenshot: boolean;
    waitFor: 'load' | 'domcontentloaded' | 'networkidle';
  }
): Promise<{ result: FetchWebPageResult; rawHtml: string; links: string[] }> {
  const page = await browserContext.newPage();
  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: options.waitFor, timeout: 30000 });

    const title = await page.title();
    const rawHtml = await page.content();
    const textContent = await page.evaluate('document.body.innerText') as string;

    const result: FetchWebPageResult = {
      url,
      title,
      fetchedAt: new Date().toISOString(),
      renderTimeMs: 0,
      fromCache: false,
    };

    if (options.extractText) {
      result.textContent = textContent;
      result.html = rawHtml;
    }

    let extractedLinks: string[] = [];

    if (options.extractLinks || options.extractImages) {
      type ExtractedPageData = {
        links: { text: string; href: string }[];
        images: { src: string; alt: string }[];
        headings: { level: number; text: string }[];
        metaTags: Record<string, string>;
      };

      const data = await page.evaluate(`(() => {
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: a.textContent?.trim() || '',
          href: a.href
        })).filter(l => l.href && l.href.startsWith('http'));

        const images = Array.from(document.querySelectorAll('img')).map(img => ({
          src: img.src,
          alt: img.alt || ''
        })).filter(i => i.src);

        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
          level: parseInt(h.tagName[1]),
          text: h.textContent?.trim() || ''
        })).filter(h => h.text);

        const metaTags = {};
        document.querySelectorAll('meta[name], meta[property]').forEach(meta => {
          const name = meta.getAttribute('name') || meta.getAttribute('property');
          const content = meta.getAttribute('content');
          if (name && content) metaTags[name] = content;
        });

        return { links, images, headings, metaTags };
      })()`) as ExtractedPageData;

      if (options.extractLinks) {
        result.links = data.links;
        result.headings = data.headings;
        result.metaTags = data.metaTags;
      }
      if (options.extractImages) {
        result.images = data.images;
      }

      extractedLinks = data.links.map((l: { text: string; href: string }) => l.href);
    }

    if (options.screenshot) {
      const buffer = await page.screenshot({ fullPage: true });
      result.screenshotBase64 = buffer.toString('base64');
    }

    result.renderTimeMs = Date.now() - startTime;

    return { result, rawHtml, links: extractedLinks };

  } finally {
    await page.close();
  }
}

async function fetchWebPageImpl(
  params: FetchWebPageParams,
  context: WebToolsContext
): Promise<FetchWebPageResult> {
  const {
    url,
    extractText = true,
    extractLinks = false,
    extractImages = false,
    screenshot = false,
    waitFor = 'networkidle',
    force = false,
    ingest = false,
    projectName,
    depth = 0,
    maxPages = 10,
    includePatterns,
    excludePatterns,
  } = params;

  const cache = getFetchCache(context);

  // For depth > 0, we need extractLinks to be true
  const needLinks = extractLinks || depth > 0;

  // Track visited URLs and results
  const visited = new Set<string>();
  const allResults: FetchWebPageResult[] = [];

  // Queue: [url, currentDepth]
  const queue: Array<{ url: string; currentDepth: number }> = [{ url, currentDepth: 0 }];

  // Launch browser once for all pages
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  try {
    while (queue.length > 0 && allResults.length < maxPages) {
      const { url: currentUrl, currentDepth } = queue.shift()!;

      // Normalize and check if visited
      const normalizedUrl = normalizeUrl(currentUrl);
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      // Check depth limit
      if (currentDepth > depth) continue;

      // Check pattern matching (except for start URL)
      if (currentDepth > 0 && !matchesUrlPatterns(normalizedUrl, includePatterns, excludePatterns)) {
        continue;
      }

      // Only follow same-domain links (safety)
      if (currentDepth > 0 && !isSameDomain(url, normalizedUrl)) {
        continue;
      }

      // Check cache first (unless force=true)
      if (!force && cache.has(normalizedUrl)) {
        const cached = cache.get(normalizedUrl)!;
        console.log(`[fetch_web_page] Using cached result for ${normalizedUrl}`);

        const result: FetchWebPageResult = {
          ...cached,
          fromCache: true,
          depth: currentDepth,
        };

        // Handle ingest if requested
        if (ingest && context.ingestWebPage) {
          const targetProject = projectName || context.currentProjectName;
          const ingestResult = await context.ingestWebPage({
            url: cached.url,
            title: cached.title,
            textContent: cached.textContent || '',
            rawHtml: cached.rawHtml,
            projectName: targetProject,
          });
          result.ingested = ingestResult.success;
          result.ingestedTo = targetProject;
        }

        allResults.push(result);

        // Add links to queue if not at max depth
        if (currentDepth < depth && cached.links) {
          for (const link of cached.links) {
            const linkUrl = normalizeUrl(link.href);
            if (!visited.has(linkUrl)) {
              queue.push({ url: linkUrl, currentDepth: currentDepth + 1 });
            }
          }
        }
        continue;
      }

      // Fetch the page
      try {
        console.log(`[fetch_web_page] Fetching ${normalizedUrl} (depth ${currentDepth})`);

        const { result, rawHtml, links } = await fetchSinglePage(normalizedUrl, browserContext, {
          extractText,
          extractLinks: needLinks,
          extractImages,
          screenshot,
          waitFor,
        });

        result.depth = currentDepth;

        // Store in cache
        cache.set(normalizedUrl, result, rawHtml);

        // Handle ingest if requested
        if (ingest && context.ingestWebPage) {
          const targetProject = projectName || context.currentProjectName;
          const ingestResult = await context.ingestWebPage({
            url: normalizedUrl,
            title: result.title,
            textContent: result.textContent || '',
            rawHtml,
            projectName: targetProject,
          });
          result.ingested = ingestResult.success;
          result.ingestedTo = targetProject;
        }

        allResults.push(result);

        // Add links to queue if not at max depth
        if (currentDepth < depth) {
          for (const linkUrl of links) {
            const normalized = normalizeUrl(linkUrl);
            if (!visited.has(normalized)) {
              queue.push({ url: normalized, currentDepth: currentDepth + 1 });
            }
          }
        }

      } catch (err) {
        console.warn(`[fetch_web_page] Failed to fetch ${normalizedUrl}: ${err}`);
      }
    }

    // Build result tree
    const rootResult = allResults[0];
    if (!rootResult) {
      throw new Error(`Failed to fetch ${url}`);
    }

    // Add children if depth > 0
    if (depth > 0 && allResults.length > 1) {
      rootResult.children = allResults.slice(1);
      rootResult.totalPagesFetched = allResults.length;
    }

    console.log(`[fetch_web_page] Fetched ${allResults.length} pages (cache: ${cache.getUrls().length}/6)`);

    return rootResult;

  } finally {
    await browser.close();
  }
}

// ============================================
// Handler Generators
// ============================================

export function createSearchWebHandler(context: WebToolsContext): (args: WebSearchParams) => Promise<WebSearchResult> {
  return async (args: WebSearchParams) => {
    return searchWebImpl(args, context);
  };
}

export function createFetchWebPageHandler(context: WebToolsContext): (args: FetchWebPageParams) => Promise<FetchWebPageResult> {
  return async (args: FetchWebPageParams) => {
    return fetchWebPageImpl(args, context);
  };
}

// ============================================
// Export all definitions and handlers
// ============================================

export const webToolDefinitions: GeneratedToolDefinition[] = [
  searchWebToolDefinition,
  fetchWebPageToolDefinition
];

export function createWebToolHandlers(context: WebToolsContext): Record<string, (args: any) => Promise<any>> {
  return {
    search_web: createSearchWebHandler(context),
    fetch_web_page: createFetchWebPageHandler(context)
  };
}
