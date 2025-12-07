/**
 * Web Adapter
 *
 * Crawls web pages and ingests them into Neo4j graph structure.
 * Uses Playwright for JavaScript-rendered content extraction.
 *
 * Creates nodes:
 * - Website: root node for the crawled domain
 * - WebPage: individual pages with content
 *
 * Creates relationships:
 * - HAS_PAGE: Website -> WebPage
 * - LINKS_TO: WebPage -> WebPage
 *
 * @since 2025-12-07
 */

import { v4 as uuidv4 } from 'uuid';
import {
  type SourceConfig,
  type ParseOptions,
  type ParseResult,
  type ParsedNode,
  type ParsedRelationship,
  type ParsedGraph,
  type ValidationResult,
} from './types.js';

// ============================================
// Types
// ============================================

export interface CrawledPage {
  url: string;
  title: string;
  textContent: string;
  links: string[];
  headings: { level: number; text: string }[];
  metaTags: Record<string, string>;
  depth: number;
  fetchedAt: string;
}

export interface CrawlOptions {
  startUrl: string;
  depth?: number;
  maxPages?: number;
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
  waitFor?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

// ============================================
// Web Adapter
// ============================================

/**
 * Web Adapter
 *
 * Crawls websites and creates graph nodes for pages.
 */
export class WebAdapter {
  /**
   * Crawl and parse website into Neo4j graph structure
   */
  async parse(options: ParseOptions): Promise<ParseResult> {
    const config = options.source;

    if (!config.web?.url) {
      throw new Error('Web URL is required for web crawling');
    }

    const crawlOptions: CrawlOptions = {
      startUrl: config.web.url,
      depth: config.web.depth ?? 2,
      maxPages: config.web.maxPages ?? 50,
      includePatterns: config.web.includePatterns?.map(p => new RegExp(p)),
      excludePatterns: config.web.excludePatterns?.map(p => new RegExp(p)),
    };

    console.log(`[WebAdapter] Starting crawl from ${crawlOptions.startUrl}`);
    console.log(`[WebAdapter] Max depth: ${crawlOptions.depth}, Max pages: ${crawlOptions.maxPages}`);

    const pages = await this.crawl(crawlOptions);
    const graph = this.pagesToGraph(pages, crawlOptions.startUrl);

    console.log(`[WebAdapter] Crawled ${pages.length} pages`);

    return {
      graph,
      isIncremental: false,
    };
  }

  /**
   * Validate web configuration
   */
  async validate(config: SourceConfig): Promise<ValidationResult> {
    if (!config.web?.url) {
      return { valid: false, errors: ['Web URL is required'] };
    }

    try {
      new URL(config.web.url);
    } catch {
      return { valid: false, errors: ['Invalid URL format'] };
    }

    return { valid: true };
  }

  /**
   * Crawl website starting from URL
   */
  private async crawl(options: CrawlOptions): Promise<CrawledPage[]> {
    const { chromium } = await import('playwright').catch(() => {
      throw new Error('Playwright not installed. Run: npm install playwright');
    });

    const visited = new Set<string>();
    const queue: { url: string; depth: number }[] = [{ url: options.startUrl, depth: 0 }];
    const pages: CrawledPage[] = [];

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'RagForge Web Crawler (https://github.com/luciformresearch/ragforge)',
    });

    try {
      while (queue.length > 0 && pages.length < (options.maxPages ?? 50)) {
        const { url, depth } = queue.shift()!;

        // Normalize URL
        const normalizedUrl = this.normalizeUrl(url);
        if (visited.has(normalizedUrl)) continue;
        visited.add(normalizedUrl);

        // Check depth
        if (depth > (options.depth ?? 2)) continue;

        // Check patterns
        if (!this.matchesPatterns(normalizedUrl, options)) continue;

        try {
          const page = await context.newPage();
          await page.goto(normalizedUrl, {
            waitUntil: options.waitFor ?? 'networkidle',
            timeout: options.timeout ?? 30000,
          });

          const title = await page.title();
          const textContent = await page.evaluate('document.body.innerText') as string;

          // Extract data in browser context
          type ExtractedData = {
            links: string[];
            headings: { level: number; text: string }[];
            metaTags: Record<string, string>;
          };

          const data = await page.evaluate<ExtractedData>(`(() => {
            const links = Array.from(document.querySelectorAll('a[href]'))
              .map(a => a.href)
              .filter(href => href.startsWith('http'));

            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
              .map(h => ({
                level: parseInt(h.tagName[1]),
                text: h.textContent?.trim() || ''
              }))
              .filter(h => h.text);

            const metaTags = {};
            document.querySelectorAll('meta[name], meta[property]').forEach(meta => {
              const name = meta.getAttribute('name') || meta.getAttribute('property');
              const content = meta.getAttribute('content');
              if (name && content) metaTags[name] = content;
            });

            return { links, headings, metaTags };
          })()`);

          await page.close();

          // Store page
          pages.push({
            url: normalizedUrl,
            title,
            textContent: textContent.slice(0, 50000), // Limit content size
            links: data.links,
            headings: data.headings,
            metaTags: data.metaTags,
            depth,
            fetchedAt: new Date().toISOString(),
          });

          console.log(`[WebAdapter] Crawled: ${normalizedUrl} (depth ${depth})`);

          // Add links to queue
          for (const link of data.links) {
            const normalizedLink = this.normalizeUrl(link);
            if (!visited.has(normalizedLink)) {
              queue.push({ url: normalizedLink, depth: depth + 1 });
            }
          }

        } catch (err) {
          console.warn(`[WebAdapter] Failed to crawl ${normalizedUrl}: ${err}`);
        }
      }

      return pages;

    } finally {
      await browser.close();
    }
  }

  /**
   * Normalize URL (remove fragments, trailing slashes)
   */
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

  /**
   * Check if URL matches include/exclude patterns
   */
  private matchesPatterns(url: string, options: CrawlOptions): boolean {
    // Check exclude patterns first
    if (options.excludePatterns) {
      for (const pattern of options.excludePatterns) {
        if (pattern.test(url)) return false;
      }
    }

    // Check include patterns (if any specified, at least one must match)
    if (options.includePatterns && options.includePatterns.length > 0) {
      for (const pattern of options.includePatterns) {
        if (pattern.test(url)) return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Convert crawled pages to graph structure
   */
  private pagesToGraph(pages: CrawledPage[], startUrl: string): ParsedGraph {
    const nodes: ParsedNode[] = [];
    const relationships: ParsedRelationship[] = [];

    // Extract domain for Website node
    const startUrlParsed = new URL(startUrl);
    const domain = startUrlParsed.hostname;

    // Create Website node
    const websiteId = uuidv4();
    nodes.push({
      labels: ['Website'],
      id: websiteId,
      properties: {
        uuid: websiteId,
        domain,
        startUrl,
        pageCount: pages.length,
        crawledAt: new Date().toISOString(),
      },
    });

    // Track page IDs for link relationships
    const pageIdMap = new Map<string, string>();

    // Create WebPage nodes
    for (const page of pages) {
      const pageId = uuidv4();
      pageIdMap.set(page.url, pageId);

      // Extract description from meta tags
      const description = page.metaTags['description'] ||
                          page.metaTags['og:description'] ||
                          page.textContent.slice(0, 200);

      nodes.push({
        labels: ['WebPage'],
        id: pageId,
        properties: {
          uuid: pageId,
          url: page.url,
          title: page.title,
          description,
          textContent: page.textContent,
          headingCount: page.headings.length,
          linkCount: page.links.length,
          depth: page.depth,
          crawledAt: page.fetchedAt,
          // Store headings as JSON string for vector search
          headingsJson: JSON.stringify(page.headings),
        },
      });

      // Website -> WebPage relationship
      relationships.push({
        type: 'HAS_PAGE',
        from: websiteId,
        to: pageId,
        properties: {
          depth: page.depth,
        },
      });
    }

    // Create LINKS_TO relationships
    for (const page of pages) {
      const fromId = pageIdMap.get(page.url);
      if (!fromId) continue;

      for (const link of page.links) {
        const toId = pageIdMap.get(this.normalizeUrl(link));
        if (toId && fromId !== toId) {
          relationships.push({
            type: 'LINKS_TO',
            from: fromId,
            to: toId,
          });
        }
      }
    }

    return {
      nodes,
      relationships,
      metadata: {
        filesProcessed: pages.length,
        nodesGenerated: nodes.length,
        relationshipsGenerated: relationships.length,
        parseTimeMs: 0,
      },
    };
  }
}

/**
 * Create a web adapter instance
 */
export function createWebAdapter(): WebAdapter {
  return new WebAdapter();
}
