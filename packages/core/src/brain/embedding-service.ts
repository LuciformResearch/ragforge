/**
 * Embedding Service
 *
 * Reusable service for generating and caching embeddings.
 * Supports MULTIPLE embeddings per node:
 * - embedding_name: for searching by file names, function signatures
 * - embedding_content: for searching by actual content/source code
 * - embedding_description: for searching by docstrings, descriptions
 *
 * Used by:
 * - BrainManager.quickIngest (initial ingestion)
 * - IngestionQueue.afterIngestion (file watcher)
 * - MediaAnalyzer (image/3D descriptions)
 *
 * @since 2025-12-07 - Multi-embedding support added
 */

import * as crypto from 'crypto';
import neo4j from 'neo4j-driver';
import type { Neo4jClient } from '../runtime/client/neo4j-client.js';
import { GeminiEmbeddingProvider } from '../runtime/embedding/embedding-provider.js';

/**
 * Named embedding types for semantic search
 */
export type EmbeddingType = 'name' | 'content' | 'description' | 'all';

/**
 * Configuration for a single embedding field
 */
export interface EmbeddingFieldConfig {
  /** Embedding property name (e.g., 'embedding_name', 'embedding_content') */
  propertyName: string;
  /** Hash property for this embedding (e.g., 'embedding_name_hash') */
  hashProperty: string;
  /** Function to extract text from a record for this embedding */
  textExtractor: (record: any) => string;
}

/**
 * Configuration for a node type with multiple embeddings
 */
export interface MultiEmbedNodeTypeConfig {
  /** Label for logging */
  label: string;
  /** Cypher query to fetch nodes (must return uuid and all needed fields) */
  query: string;
  /** Multiple embedding configurations */
  embeddings: EmbeddingFieldConfig[];
  /** Maximum results to process (default: 2000) */
  limit?: number;
}

/**
 * Legacy configuration for a node type (single embedding)
 * @deprecated Use MultiEmbedNodeTypeConfig instead
 */
export interface EmbedNodeTypeConfig {
  /** Label for logging */
  label: string;
  /** Cypher query to fetch nodes (must return uuid, embedding_hash, and text fields) */
  query: string;
  /** Function to extract text from a record */
  textExtractor: (record: any) => string;
  /** Maximum results to process (default: 2000) */
  limit?: number;
}

/**
 * Result of embedding generation
 */
export interface EmbeddingResult {
  /** Total nodes processed */
  totalNodes: number;
  /** Nodes that were embedded (new or changed) */
  embeddedCount: number;
  /** Nodes skipped (cached) */
  skippedCount: number;
  /** Time taken in ms */
  durationMs: number;
}

/**
 * Options for embedding generation
 */
export interface GenerateEmbeddingsOptions {
  /** Project ID to filter nodes */
  projectId: string;
  /** Only embed nodes with embedding_hash mismatch (default: true) */
  incrementalOnly?: boolean;
  /** Node types to embed (default: all standard types) */
  nodeTypes?: EmbedNodeTypeConfig[];
  /** Maximum text length before truncation (default: 4000) */
  maxTextLength?: number;
  /** Batch size for Neo4j updates (default: 50) */
  batchSize?: number;
  /** Verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Options for multi-embedding generation
 */
export interface GenerateMultiEmbeddingsOptions {
  /** Project ID to filter nodes */
  projectId: string;
  /** Only embed nodes with embedding_hash mismatch (default: true) */
  incrementalOnly?: boolean;
  /** Node types to embed (default: MULTI_EMBED_CONFIGS) */
  nodeTypes?: MultiEmbedNodeTypeConfig[];
  /** Specific embedding types to generate (default: all) */
  embeddingTypes?: ('name' | 'content' | 'description')[];
  /** Maximum text length before truncation (default: 4000) */
  maxTextLength?: number;
  /** Batch size for Neo4j updates (default: 50) */
  batchSize?: number;
  /** Verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Result of multi-embedding generation
 */
export interface MultiEmbeddingResult {
  /** Total nodes processed */
  totalNodes: number;
  /** Embeddings generated per type */
  embeddedByType: {
    name: number;
    content: number;
    description: number;
  };
  /** Total embeddings generated */
  totalEmbedded: number;
  /** Embeddings skipped (cached) */
  skippedCount: number;
  /** Time taken in ms */
  durationMs: number;
}

/**
 * Hash content for change detection
 */
export function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}

/**
 * Multi-embedding configurations for all node types
 *
 * Each node type has up to 3 embeddings:
 * - embedding_name: file names, function names, signatures (for "find X")
 * - embedding_content: actual source code, text content (for "code that does X")
 * - embedding_description: docstrings, descriptions, metadata (for "documented as X")
 */
export const MULTI_EMBED_CONFIGS: MultiEmbedNodeTypeConfig[] = [
  {
    label: 'Scope',
    query: `MATCH (s:Scope {projectId: $projectId})
            RETURN s.uuid AS uuid, s.name AS name, s.signature AS signature,
                   s.source AS source, s.docstring AS docstring,
                   s.embedding_name_hash AS embedding_name_hash,
                   s.embedding_content_hash AS embedding_content_hash,
                   s.embedding_description_hash AS embedding_description_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => {
          const name = r.get('name') || '';
          const sig = r.get('signature') || '';
          return sig || name;
        },
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('source') || '',
      },
      {
        propertyName: 'embedding_description',
        hashProperty: 'embedding_description_hash',
        textExtractor: (r) => r.get('docstring') || '',
      },
    ],
    limit: 2000,
  },
  {
    label: 'File',
    query: `MATCH (f:File {projectId: $projectId})
            WHERE f.source IS NOT NULL AND size(f.source) < 10000
            RETURN f.uuid AS uuid, f.path AS path, f.source AS source,
                   f.embedding_name_hash AS embedding_name_hash,
                   f.embedding_content_hash AS embedding_content_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => r.get('path') || '',
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('source') || '',
      },
    ],
    limit: 500,
  },
  {
    label: 'MarkdownDocument',
    query: `MATCH (m:MarkdownDocument {projectId: $projectId})
            RETURN m.uuid AS uuid, m.file AS path, m.title AS title,
                   m.embedding_name_hash AS embedding_name_hash,
                   m.embedding_description_hash AS embedding_description_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => {
          const title = r.get('title') || '';
          const path = r.get('path') || '';
          return title || path;
        },
      },
      {
        propertyName: 'embedding_description',
        hashProperty: 'embedding_description_hash',
        textExtractor: (r) => r.get('title') || '',
      },
    ],
    limit: 500,
  },
  {
    label: 'MarkdownSection',
    query: `MATCH (s:MarkdownSection {projectId: $projectId})
            RETURN s.uuid AS uuid, s.title AS title, s.content AS content, s.ownContent AS ownContent,
                   s.embedding_name_hash AS embedding_name_hash,
                   s.embedding_content_hash AS embedding_content_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => r.get('title') || '',
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('ownContent') || r.get('content') || '',
      },
    ],
    limit: 2000,
  },
  {
    label: 'CodeBlock',
    query: `MATCH (c:CodeBlock {projectId: $projectId})
            WHERE c.code IS NOT NULL AND size(c.code) > 10
            RETURN c.uuid AS uuid, c.language AS language, c.code AS code,
                   c.embedding_name_hash AS embedding_name_hash,
                   c.embedding_content_hash AS embedding_content_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => {
          const lang = r.get('language') || 'code';
          return `${lang} code block`;
        },
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('code') || '',
      },
    ],
    limit: 2000,
  },
  {
    label: 'DataFile',
    query: `MATCH (d:DataFile {projectId: $projectId})
            RETURN d.uuid AS uuid, d.path AS path, d.rawContent AS rawContent,
                   d.embedding_name_hash AS embedding_name_hash,
                   d.embedding_content_hash AS embedding_content_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => r.get('path') || '',
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('rawContent') || '',
      },
    ],
    limit: 500,
  },
  {
    label: 'WebPage',
    query: `MATCH (w:WebPage {projectId: $projectId})
            RETURN w.uuid AS uuid, w.url AS url, w.title AS title, w.textContent AS textContent,
                   w.metaDescription AS metaDescription,
                   w.embedding_name_hash AS embedding_name_hash,
                   w.embedding_content_hash AS embedding_content_hash,
                   w.embedding_description_hash AS embedding_description_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => {
          const title = r.get('title') || '';
          const url = r.get('url') || '';
          return `${title} ${url}`;
        },
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('textContent') || '',
      },
      {
        propertyName: 'embedding_description',
        hashProperty: 'embedding_description_hash',
        textExtractor: (r) => r.get('metaDescription') || r.get('title') || '',
      },
    ],
    limit: 500,
  },
  {
    label: 'MediaFile',
    query: `MATCH (m:MediaFile {projectId: $projectId})
            WHERE m.description IS NOT NULL
            RETURN m.uuid AS uuid, m.path AS path, m.description AS description, m.ocrText AS ocrText,
                   m.embedding_name_hash AS embedding_name_hash,
                   m.embedding_content_hash AS embedding_content_hash,
                   m.embedding_description_hash AS embedding_description_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => r.get('path') || '',
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('ocrText') || '',
      },
      {
        propertyName: 'embedding_description',
        hashProperty: 'embedding_description_hash',
        textExtractor: (r) => r.get('description') || '',
      },
    ],
    limit: 500,
  },
  {
    label: 'ThreeDFile',
    query: `MATCH (t:ThreeDFile {projectId: $projectId})
            WHERE t.description IS NOT NULL
            RETURN t.uuid AS uuid, t.path AS path, t.description AS description,
                   t.embedding_name_hash AS embedding_name_hash,
                   t.embedding_description_hash AS embedding_description_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => r.get('path') || '',
      },
      {
        propertyName: 'embedding_description',
        hashProperty: 'embedding_description_hash',
        textExtractor: (r) => r.get('description') || '',
      },
    ],
    limit: 200,
  },
  {
    label: 'DocumentFile',
    query: `MATCH (d:DocumentFile {projectId: $projectId})
            WHERE d.textContent IS NOT NULL AND size(d.textContent) > 50
            RETURN d.uuid AS uuid, d.file AS file, d.format AS format,
                   d.textContent AS textContent, d.title AS title,
                   d.embedding_name_hash AS embedding_name_hash,
                   d.embedding_content_hash AS embedding_content_hash,
                   d.embedding_description_hash AS embedding_description_hash
            LIMIT $limit`,
    embeddings: [
      {
        propertyName: 'embedding_name',
        hashProperty: 'embedding_name_hash',
        textExtractor: (r) => {
          const file = r.get('file') || '';
          const title = r.get('title') || '';
          return title || file;
        },
      },
      {
        propertyName: 'embedding_content',
        hashProperty: 'embedding_content_hash',
        textExtractor: (r) => r.get('textContent') || '',
      },
      {
        propertyName: 'embedding_description',
        hashProperty: 'embedding_description_hash',
        textExtractor: (r) => r.get('title') || '',
      },
    ],
    limit: 500,
  },
];

/**
 * Legacy: Default node type configurations for embedding (single embedding per node)
 * @deprecated Use MULTI_EMBED_CONFIGS for multi-embedding support
 */
export const DEFAULT_EMBED_CONFIGS: EmbedNodeTypeConfig[] = [
  {
    label: 'Scope',
    query: `MATCH (s:Scope {projectId: $projectId})
            RETURN s.uuid AS uuid, s.name AS name, s.signature AS signature,
                   s.source AS source, s.docstring AS docstring, s.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const parts: string[] = [];
      const sig = r.get('signature');
      const doc = r.get('docstring');
      const src = r.get('source');
      if (sig) parts.push(`Signature: ${sig}`);
      if (doc) parts.push(`Docstring: ${doc}`);
      if (src) parts.push(`Source:\n${src}`);
      return parts.join('\n\n') || r.get('name') || '';
    },
    limit: 2000,
  },
  {
    label: 'File',
    query: `MATCH (f:File {projectId: $projectId})
            WHERE f.source IS NOT NULL AND size(f.source) < 10000
            RETURN f.uuid AS uuid, f.path AS path, f.source AS source, f.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const path = r.get('path') || '';
      const source = r.get('source') || '';
      return `File: ${path}\n\n${source}`;
    },
    limit: 500,
  },
  {
    label: 'MarkdownDocument',
    query: `MATCH (m:MarkdownDocument {projectId: $projectId})
            RETURN m.uuid AS uuid, m.path AS path, m.rawText AS rawText, m.title AS title, m.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const title = r.get('title') || '';
      const text = r.get('rawText') || '';
      return title ? `# ${title}\n\n${text}` : text;
    },
    limit: 500,
  },
  {
    label: 'DataFile',
    query: `MATCH (d:DataFile {projectId: $projectId})
            RETURN d.uuid AS uuid, d.path AS path, d.rawContent AS rawContent, d.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const path = r.get('path') || '';
      const content = r.get('rawContent') || '';
      return `Data file: ${path}\n\n${content}`;
    },
    limit: 500,
  },
  {
    label: 'WebPage',
    query: `MATCH (w:WebPage {projectId: $projectId})
            RETURN w.uuid AS uuid, w.url AS url, w.title AS title, w.textContent AS textContent, w.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const title = r.get('title') || '';
      const url = r.get('url') || '';
      const text = r.get('textContent') || '';
      return `${title}\nURL: ${url}\n\n${text}`;
    },
    limit: 500,
  },
  {
    label: 'MediaFile',
    query: `MATCH (m:MediaFile {projectId: $projectId})
            WHERE m.description IS NOT NULL
            RETURN m.uuid AS uuid, m.path AS path, m.description AS description, m.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const path = r.get('path') || '';
      const description = r.get('description') || '';
      return `Media: ${path}\n\n${description}`;
    },
    limit: 500,
  },
  {
    label: 'ThreeDFile',
    query: `MATCH (t:ThreeDFile {projectId: $projectId})
            WHERE t.description IS NOT NULL
            RETURN t.uuid AS uuid, t.path AS path, t.description AS description, t.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const path = r.get('path') || '';
      const description = r.get('description') || '';
      return `3D Model: ${path}\n\n${description}`;
    },
    limit: 200,
  },
  {
    label: 'DocumentFile',
    query: `MATCH (d:DocumentFile {projectId: $projectId})
            WHERE d.textContent IS NOT NULL AND size(d.textContent) > 50
            RETURN d.uuid AS uuid, d.file AS file, d.format AS format,
                   d.textContent AS textContent, d.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const file = r.get('file') || '';
      const format = r.get('format') || '';
      const text = r.get('textContent') || '';
      return `Document (${format}): ${file}\n\n${text}`;
    },
    limit: 500,
  },
];

/**
 * Embedding Service - generates and caches embeddings for Neo4j nodes
 */
export class EmbeddingService {
  private embeddingProvider: GeminiEmbeddingProvider | null = null;

  constructor(
    private neo4jClient: Neo4jClient,
    private geminiApiKey?: string
  ) {
    if (geminiApiKey) {
      this.embeddingProvider = new GeminiEmbeddingProvider({
        apiKey: geminiApiKey,
        dimension: 3072,
        // Use native 3072 dimensions for best quality
      });
    }
  }

  /**
   * Check if embeddings can be generated
   */
  canGenerateEmbeddings(): boolean {
    return this.embeddingProvider !== null;
  }

  /**
   * Generate embeddings for a project
   */
  async generateEmbeddings(options: GenerateEmbeddingsOptions): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const { projectId, verbose = false } = options;
    const incrementalOnly = options.incrementalOnly ?? true;
    const maxTextLength = options.maxTextLength ?? 4000;
    const batchSize = options.batchSize ?? 500; // Larger batches for Neo4j writes
    const nodeTypes = options.nodeTypes ?? DEFAULT_EMBED_CONFIGS;

    if (!this.embeddingProvider) {
      if (verbose) {
        console.warn('[EmbeddingService] No API key configured, skipping embeddings');
      }
      return {
        totalNodes: 0,
        embeddedCount: 0,
        skippedCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    if (verbose) {
      console.log(`[EmbeddingService] Generating embeddings for project: ${projectId}`);
      console.log(`[EmbeddingService]   Using ${this.embeddingProvider.getModelName()}`);
    }

    let totalNodes = 0;
    let embeddedCount = 0;
    let skippedCount = 0;

    for (const config of nodeTypes) {
      const result = await this.embedNodeType(config, {
        projectId,
        incrementalOnly,
        maxTextLength,
        batchSize,
        verbose,
      });

      totalNodes += result.totalNodes;
      embeddedCount += result.embeddedCount;
      skippedCount += result.skippedCount;
    }

    const durationMs = Date.now() - startTime;

    if (verbose) {
      console.log(`[EmbeddingService] Complete: ${embeddedCount} embedded, ${skippedCount} cached in ${durationMs}ms`);
    }

    return {
      totalNodes,
      embeddedCount,
      skippedCount,
      durationMs,
    };
  }

  /**
   * Generate embeddings for a specific node type
   */
  private async embedNodeType(
    config: EmbedNodeTypeConfig,
    options: {
      projectId: string;
      incrementalOnly: boolean;
      maxTextLength: number;
      batchSize: number;
      verbose: boolean;
    }
  ): Promise<{ totalNodes: number; embeddedCount: number; skippedCount: number }> {
    const { projectId, incrementalOnly, maxTextLength, batchSize, verbose } = options;
    const limit = neo4j.int(config.limit ?? 2000);

    // Fetch nodes
    const result = await this.neo4jClient.run(config.query, { projectId, limit });

    // Extract text and compute hash for each node
    const nodes = result.records.map(r => {
      const text = config.textExtractor(r);
      const truncated = text.length > maxTextLength ? text.substring(0, maxTextLength) + '...' : text;
      return {
        uuid: r.get('uuid'),
        text: truncated,
        newHash: hashContent(truncated),
        existingHash: r.get('embedding_hash') || null,
      };
    }).filter(n => n.text && n.text.length > 10); // Skip empty/tiny texts

    if (nodes.length === 0) {
      return { totalNodes: 0, embeddedCount: 0, skippedCount: 0 };
    }

    // Filter to only nodes that need embedding (no hash or hash changed)
    const nodesToEmbed = incrementalOnly
      ? nodes.filter(n => n.existingHash !== n.newHash)
      : nodes;

    const skipped = nodes.length - nodesToEmbed.length;

    if (nodesToEmbed.length === 0) {
      if (verbose) {
        console.log(`[EmbeddingService]   → ${config.label}: ${nodes.length} nodes (all cached, skipped)`);
      }
      return { totalNodes: nodes.length, embeddedCount: 0, skippedCount: skipped };
    }

    if (verbose) {
      console.log(`[EmbeddingService]   → ${config.label}: ${nodesToEmbed.length} to embed (${skipped} cached)`);
    }

    // Generate embeddings only for nodes that need it
    const embeddings = await this.embeddingProvider!.embed(nodesToEmbed.map(n => n.text));

    // Update nodes in batches with embedding + hash
    for (let i = 0; i < nodesToEmbed.length; i += batchSize) {
      const batch = nodesToEmbed.slice(i, i + batchSize).map((n, idx) => ({
        uuid: n.uuid,
        embedding: embeddings[i + idx],
        embedding_hash: n.newHash,
      }));

      await this.neo4jClient.run(
        `UNWIND $batch AS item
         MATCH (n {uuid: item.uuid})
         SET n.embedding = item.embedding, n.embedding_hash = item.embedding_hash`,
        { batch }
      );
    }

    return {
      totalNodes: nodes.length,
      embeddedCount: nodesToEmbed.length,
      skippedCount: skipped,
    };
  }

  /**
   * Generate embedding for a single text and store it on a node
   */
  async embedSingleNode(uuid: string, text: string): Promise<boolean> {
    if (!this.embeddingProvider) {
      return false;
    }

    const truncated = text.length > 4000 ? text.substring(0, 4000) + '...' : text;
    const hash = hashContent(truncated);

    const embedding = await this.embeddingProvider.embedSingle(truncated);

    await this.neo4jClient.run(
      `MATCH (n {uuid: $uuid})
       SET n.embedding = $embedding, n.embedding_hash = $hash`,
      { uuid, embedding, hash }
    );

    return true;
  }

  // ============================================
  // Multi-Embedding Support
  // ============================================

  /**
   * Generate MULTIPLE embeddings per node for targeted semantic search.
   *
   * Creates separate embeddings for:
   * - embedding_name: file/function names, signatures (for "find X")
   * - embedding_content: actual code/text content (for "code that does X")
   * - embedding_description: docstrings, descriptions (for "documented as X")
   *
   * This allows the agent to target searches more precisely.
   */
  async generateMultiEmbeddings(options: GenerateMultiEmbeddingsOptions): Promise<MultiEmbeddingResult> {
    const startTime = Date.now();
    const { projectId, verbose = false } = options;
    const incrementalOnly = options.incrementalOnly ?? true;
    const maxTextLength = options.maxTextLength ?? 4000;
    const batchSize = options.batchSize ?? 500; // Larger batches for Neo4j writes
    const nodeTypes = options.nodeTypes ?? MULTI_EMBED_CONFIGS;
    const embeddingTypes = options.embeddingTypes ?? ['name', 'content', 'description'];

    if (!this.embeddingProvider) {
      if (verbose) {
        console.warn('[EmbeddingService] No API key configured, skipping embeddings');
      }
      return {
        totalNodes: 0,
        embeddedByType: { name: 0, content: 0, description: 0 },
        totalEmbedded: 0,
        skippedCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    if (verbose) {
      console.log(`[EmbeddingService] Generating multi-embeddings for project: ${projectId}`);
      console.log(`[EmbeddingService]   Using ${this.embeddingProvider.getModelName()}`);
      console.log(`[EmbeddingService]   Embedding types: ${embeddingTypes.join(', ')}`);
    }

    let totalNodes = 0;
    let skippedCount = 0;
    const embeddedByType = { name: 0, content: 0, description: 0 };

    for (const config of nodeTypes) {
      const result = await this.embedNodeTypeMulti(config, {
        projectId,
        incrementalOnly,
        maxTextLength,
        batchSize,
        verbose,
        embeddingTypes,
      });

      totalNodes += result.totalNodes;
      skippedCount += result.skippedCount;
      embeddedByType.name += result.embeddedByType.name;
      embeddedByType.content += result.embeddedByType.content;
      embeddedByType.description += result.embeddedByType.description;
    }

    const durationMs = Date.now() - startTime;
    const totalEmbedded = embeddedByType.name + embeddedByType.content + embeddedByType.description;

    if (verbose) {
      console.log(`[EmbeddingService] Complete: ${totalEmbedded} embeddings generated in ${durationMs}ms`);
      console.log(`[EmbeddingService]   name: ${embeddedByType.name}, content: ${embeddedByType.content}, description: ${embeddedByType.description}`);
    }

    return {
      totalNodes,
      embeddedByType,
      totalEmbedded,
      skippedCount,
      durationMs,
    };
  }

  /**
   * Generate multiple embeddings for a specific node type
   */
  private async embedNodeTypeMulti(
    config: MultiEmbedNodeTypeConfig,
    options: {
      projectId: string;
      incrementalOnly: boolean;
      maxTextLength: number;
      batchSize: number;
      verbose: boolean;
      embeddingTypes: ('name' | 'content' | 'description')[];
    }
  ): Promise<{
    totalNodes: number;
    embeddedByType: { name: number; content: number; description: number };
    skippedCount: number;
  }> {
    const { projectId, incrementalOnly, maxTextLength, batchSize, verbose, embeddingTypes } = options;
    const limit = neo4j.int(config.limit ?? 2000);

    // Fetch nodes
    const result = await this.neo4jClient.run(config.query, { projectId, limit });

    if (result.records.length === 0) {
      return {
        totalNodes: 0,
        embeddedByType: { name: 0, content: 0, description: 0 },
        skippedCount: 0,
      };
    }

    const embeddedByType = { name: 0, content: 0, description: 0 };
    let skippedCount = 0;

    // Process each embedding field
    for (const embeddingConfig of config.embeddings) {
      // Check if this embedding type is requested
      const embeddingType = embeddingConfig.propertyName.replace('embedding_', '') as 'name' | 'content' | 'description';
      if (!embeddingTypes.includes(embeddingType)) {
        continue;
      }

      if (verbose) {
        console.log(`[EmbeddingService]   Preparing ${config.label}.${embeddingType} (${result.records.length} nodes)...`);
      }

      // Extract text and compute hash for each node
      // We always compute newHash (needed for storage), but only compare with existingHash in incremental mode
      const nodes = result.records.map(r => {
        const text = embeddingConfig.textExtractor(r);
        const truncated = text.length > maxTextLength ? text.substring(0, maxTextLength) + '...' : text;
        return {
          uuid: r.get('uuid'),
          text: truncated,
          newHash: truncated ? hashContent(truncated) : null,
          // Only fetch existing hash if we need to compare (incremental mode)
          existingHash: incrementalOnly ? (r.get(embeddingConfig.hashProperty) || null) : null,
        };
      }).filter(n => n.text && n.text.length > 5); // Skip empty/tiny texts

      if (nodes.length === 0) {
        continue;
      }

      // Filter to only nodes that need embedding
      const nodesToEmbed = incrementalOnly
        ? nodes.filter(n => n.newHash && n.existingHash !== n.newHash) // Incremental: only changed
        : nodes.filter(n => n.newHash); // Initial: embed all with valid hash

      const skipped = nodes.length - nodesToEmbed.length;
      skippedCount += skipped;

      if (nodesToEmbed.length === 0) {
        if (verbose) {
          console.log(`[EmbeddingService]   → ${config.label}.${embeddingType}: ${nodes.length} nodes (all cached)`);
        }
        continue;
      }

      if (verbose) {
        console.log(`[EmbeddingService]   → ${config.label}.${embeddingType}: ${nodesToEmbed.length} to embed (${skipped} cached)`);
      }

      // Generate embeddings
      const embeddings = await this.embeddingProvider!.embed(nodesToEmbed.map(n => n.text));

      if (verbose) {
        console.log(`[EmbeddingService]   Saving ${nodesToEmbed.length} embeddings to Neo4j...`);
      }

      // Update nodes in batches
      for (let i = 0; i < nodesToEmbed.length; i += batchSize) {
        const batch = nodesToEmbed.slice(i, i + batchSize).map((n, idx) => ({
          uuid: n.uuid,
          embedding: embeddings[i + idx],
          hash: n.newHash,
        }));

        // Use specific queries for each embedding type (Neo4j doesn't support dynamic property names)
        // Use label for indexed lookup (much faster than scanning all nodes!)
        const embeddingProp = embeddingConfig.propertyName;
        const label = config.label; // e.g. "Scope"

        let cypher: string;
        if (embeddingProp === 'embedding_name') {
          cypher = `UNWIND $batch AS item
           MATCH (n:${label} {uuid: item.uuid})
           SET n.embedding_name = item.embedding, n.embedding_name_hash = item.hash`;
        } else if (embeddingProp === 'embedding_content') {
          cypher = `UNWIND $batch AS item
           MATCH (n:${label} {uuid: item.uuid})
           SET n.embedding_content = item.embedding, n.embedding_content_hash = item.hash`;
        } else if (embeddingProp === 'embedding_description') {
          cypher = `UNWIND $batch AS item
           MATCH (n:${label} {uuid: item.uuid})
           SET n.embedding_description = item.embedding, n.embedding_description_hash = item.hash`;
        } else {
          // Fallback for legacy 'embedding' property
          cypher = `UNWIND $batch AS item
           MATCH (n:${label} {uuid: item.uuid})
           SET n.embedding = item.embedding, n.embedding_hash = item.hash`;
        }

        await this.neo4jClient.run(cypher, { batch });
      }

      embeddedByType[embeddingType] += nodesToEmbed.length;
    }

    return {
      totalNodes: result.records.length,
      embeddedByType,
      skippedCount,
    };
  }

  /**
   * Get embedding for a query to use in vector search
   */
  async getQueryEmbedding(query: string): Promise<number[] | null> {
    if (!this.embeddingProvider) {
      return null;
    }
    return this.embeddingProvider.embedSingle(query);
  }
}
