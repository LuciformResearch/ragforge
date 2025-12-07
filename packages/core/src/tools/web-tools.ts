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
}

export interface WebToolsContext {
  /** Gemini API key for web search */
  geminiApiKey?: string;
  /** Whether Playwright is available */
  playwrightAvailable?: boolean;
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
The page is fully rendered including dynamic JavaScript content.`,
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
        description: 'Extract all links from the page (default: false)'
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
      }
    },
    required: ['url']
  }
};

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

async function fetchWebPageImpl(
  params: FetchWebPageParams,
  _context: WebToolsContext
): Promise<FetchWebPageResult> {
  const {
    url,
    extractText = true,
    extractLinks = false,
    extractImages = false,
    screenshot = false,
    waitFor = 'networkidle'
  } = params;

  const { chromium } = await import('playwright');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: waitFor, timeout: 30000 });

    const title = await page.title();
    const result: FetchWebPageResult = {
      url,
      title,
      fetchedAt: new Date().toISOString(),
      renderTimeMs: 0
    };

    if (extractText) {
      result.textContent = await page.evaluate('document.body.innerText');
      result.html = await page.content();
    }

    if (extractLinks || extractImages) {
      // Type for data extracted from browser context
      type ExtractedPageData = {
        links: { text: string; href: string }[];
        images: { src: string; alt: string }[];
        headings: { level: number; text: string }[];
        metaTags: Record<string, string>;
      };

      // Execute in browser context - Playwright handles DOM types
      const data = await page.evaluate<ExtractedPageData>(`(() => {
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: a.textContent?.trim() || '',
          href: a.href
        })).filter(l => l.text && l.href);

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
      })()`);

      if (extractLinks) {
        result.links = data.links;
        result.headings = data.headings;
        result.metaTags = data.metaTags;
      }
      if (extractImages) {
        result.images = data.images;
      }
    }

    if (screenshot) {
      const buffer = await page.screenshot({ fullPage: true });
      result.screenshotBase64 = buffer.toString('base64');
    }

    result.renderTimeMs = Date.now() - startTime;
    return result;

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
