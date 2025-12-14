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
import { chunkText, needsChunking, type TextChunk } from '../runtime/embedding/text-chunker.js';

/**
 * Threshold for chunking large content (in characters)
 * Content larger than this will be split into overlapping chunks
 */
const CHUNKING_THRESHOLD = 3000;

/**
 * Chunk size for embeddings (target size per chunk)
 */
const EMBEDDING_CHUNK_SIZE = 2000;

/**
 * Overlap between chunks for context continuity
 */
const EMBEDDING_CHUNK_OVERLAP = 200;

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
 * Represents a single embedding task to be batched
 * Used internally for collecting all tasks before batch embedding
 */
interface EmbeddingTask {
  /** Type of task: 'small' for direct embed, 'chunk' for chunked content */
  type: 'small' | 'chunk';
  /** Node UUID */
  uuid: string;
  /** Text to embed */
  text: string;
  /** Hash of the text for caching */
  hash: string;
  /** Node label (Scope, File, etc.) */
  label: string;
  /** Embedding property name (embedding_name, embedding_content, embedding_description) */
  embeddingProp: string;
  /** Embedding type (name, content, description) */
  embeddingType: 'name' | 'content' | 'description';
  /** For chunks: parent node UUID */
  parentUuid?: string;
  /** For chunks: chunk index */
  chunkIndex?: number;
  /** For chunks: position info */
  startChar?: number;
  endChar?: number;
  startLine?: number;
  endLine?: number;
  /** Embedding result (filled after embedding) */
  embedding?: number[];
}

/**
 * Nodes that need their dirty flag cleared after embedding
 */
interface NodeToMarkDone {
  uuid: string;
  label: string;
  /** For chunked nodes: number of chunks created */
  chunkCount?: number;
  /** For chunked nodes: hash of the full content (for incremental skip detection) */
  contentHash?: string;
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
                   s.embedding_description_hash AS embedding_description_hash,
                   s.embeddingsDirty AS embeddingsDirty
            ORDER BY s.file, s.startLine`,
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
    // No limit - process all scopes (including global file_scope modules)
    // Memory is managed by batch processing in embedNodeTypeMulti
  },
  {
    label: 'File',
    query: `MATCH (f:File {projectId: $projectId})
            WHERE f.source IS NOT NULL
            RETURN f.uuid AS uuid, f.path AS path, f.source AS source,
                   f.embedding_name_hash AS embedding_name_hash,
                   f.embedding_content_hash AS embedding_content_hash,
                   f.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'MarkdownDocument',
    query: `MATCH (m:MarkdownDocument {projectId: $projectId})
            RETURN m.uuid AS uuid, m.file AS path, m.title AS title,
                   m.embedding_name_hash AS embedding_name_hash,
                   m.embedding_description_hash AS embedding_description_hash,
                   m.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'MarkdownSection',
    query: `MATCH (s:MarkdownSection {projectId: $projectId})
            RETURN s.uuid AS uuid, s.title AS title, s.content AS content, s.ownContent AS ownContent,
                   s.embedding_name_hash AS embedding_name_hash,
                   s.embedding_content_hash AS embedding_content_hash,
                   s.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'CodeBlock',
    query: `MATCH (c:CodeBlock {projectId: $projectId})
            WHERE c.code IS NOT NULL AND size(c.code) > 10
            RETURN c.uuid AS uuid, c.language AS language, c.code AS code,
                   c.embedding_name_hash AS embedding_name_hash,
                   c.embedding_content_hash AS embedding_content_hash,
                   c.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'DataFile',
    query: `MATCH (d:DataFile {projectId: $projectId})
            RETURN d.uuid AS uuid, d.path AS path, d.rawContent AS rawContent,
                   d.embedding_name_hash AS embedding_name_hash,
                   d.embedding_content_hash AS embedding_content_hash,
                   d.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'WebPage',
    query: `MATCH (w:WebPage {projectId: $projectId})
            RETURN w.uuid AS uuid, w.url AS url, w.title AS title, w.textContent AS textContent,
                   w.metaDescription AS metaDescription,
                   w.embedding_name_hash AS embedding_name_hash,
                   w.embedding_content_hash AS embedding_content_hash,
                   w.embedding_description_hash AS embedding_description_hash,
                   w.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'MediaFile',
    query: `MATCH (m:MediaFile {projectId: $projectId})
            WHERE m.textContent IS NOT NULL OR m.description IS NOT NULL
            RETURN m.uuid AS uuid, m.path AS path,
                   COALESCE(m.textContent, m.description) AS description,
                   m.extractionMethod AS extractionMethod,
                   m.embedding_name_hash AS embedding_name_hash,
                   m.embedding_content_hash AS embedding_content_hash,
                   m.embedding_description_hash AS embedding_description_hash,
                   m.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'ThreeDFile',
    query: `MATCH (t:ThreeDFile {projectId: $projectId})
            WHERE t.textContent IS NOT NULL OR t.description IS NOT NULL
            RETURN t.uuid AS uuid, t.path AS path,
                   COALESCE(t.textContent, t.description) AS description,
                   t.embedding_name_hash AS embedding_name_hash,
                   t.embedding_description_hash AS embedding_description_hash,
                   t.embeddingsDirty AS embeddingsDirty`,
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
  },
  {
    label: 'DocumentFile',
    query: `MATCH (d:DocumentFile {projectId: $projectId})
            WHERE d.textContent IS NOT NULL
            RETURN d.uuid AS uuid, d.file AS file, d.path AS path, d.format AS format,
                   d.textContent AS textContent, d.title AS title,
                   d.embedding_name_hash AS embedding_name_hash,
                   d.embedding_content_hash AS embedding_content_hash,
                   d.embedding_description_hash AS embedding_description_hash,
                   d.embeddingsDirty AS embeddingsDirty`,
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
            WHERE m.textContent IS NOT NULL OR m.description IS NOT NULL
            RETURN m.uuid AS uuid, m.path AS path,
                   COALESCE(m.textContent, m.description) AS description,
                   m.embedding_hash AS embedding_hash
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
            WHERE t.textContent IS NOT NULL OR t.description IS NOT NULL
            RETURN t.uuid AS uuid, t.path AS path,
                   COALESCE(t.textContent, t.description) AS description,
                   t.embedding_hash AS embedding_hash
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
            WHERE d.textContent IS NOT NULL
            RETURN d.uuid AS uuid, d.file AS file, d.path AS path, d.format AS format,
                   d.textContent AS textContent, d.embedding_hash AS embedding_hash
            LIMIT $limit`,
    textExtractor: (r) => {
      const file = r.get('file') || r.get('path') || '';
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
   * OPTIMIZED: Collects ALL tasks from ALL node types first, then batches
   * embedding calls together (500 at a time) for maximum API efficiency.
   * TEST WATCHER: This comment was added to test incremental ingestion.
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
    const batchSize = options.batchSize ?? 500;
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

    // ========================================
    // PHASE 1: Collect ALL embedding tasks
    // ========================================
    const allTasks: EmbeddingTask[] = [];
    const nodesToMarkDone: NodeToMarkDone[] = [];
    const chunkedNodeUuids: Set<string> = new Set(); // Track nodes that use chunks
    let totalNodes = 0;
    let skippedCount = 0;
    const embeddedByType = { name: 0, content: 0, description: 0 };

    if (verbose) {
      console.log(`[EmbeddingService] Phase 1: Collecting tasks from ${nodeTypes.length} node types...`);
    }

    for (const config of nodeTypes) {
      const collected = await this.collectEmbeddingTasks(config, {
        projectId,
        incrementalOnly,
        maxTextLength,
        embeddingTypes,
        verbose,
      });

      totalNodes += collected.totalNodes;
      skippedCount += collected.skippedCount;
      allTasks.push(...collected.tasks);
      nodesToMarkDone.push(...collected.nodesToMarkDone);
      collected.chunkedNodeUuids.forEach(uuid => chunkedNodeUuids.add(uuid));
    }

    if (allTasks.length === 0) {
      if (verbose) {
        console.log(`[EmbeddingService] No tasks to process (all cached)`);
      }
      return {
        totalNodes,
        embeddedByType,
        totalEmbedded: 0,
        skippedCount,
        durationMs: Date.now() - startTime,
      };
    }

    if (verbose) {
      console.log(`[EmbeddingService]   Collected ${allTasks.length} tasks (${allTasks.filter(t => t.type === 'small').length} small, ${allTasks.filter(t => t.type === 'chunk').length} chunks)`);
    }

    // ========================================
    // PHASE 2: Delete existing chunks for nodes that will be re-chunked
    // ========================================
    if (chunkedNodeUuids.size > 0) {
      if (verbose) {
        console.log(`[EmbeddingService] Phase 2: Deleting existing chunks for ${chunkedNodeUuids.size} nodes...`);
      }
      // Group by label for efficient deletion
      const labelToUuids = new Map<string, string[]>();
      for (const task of allTasks) {
        if (task.type === 'chunk' && task.parentUuid) {
          const label = task.label;
          if (!labelToUuids.has(label)) {
            labelToUuids.set(label, []);
          }
          const uuids = labelToUuids.get(label)!;
          if (!uuids.includes(task.parentUuid)) {
            uuids.push(task.parentUuid);
          }
        }
      }
      for (const [label, uuids] of labelToUuids) {
        await this.neo4jClient.run(
          `MATCH (n:${label})-[:HAS_EMBEDDING_CHUNK]->(c:EmbeddingChunk)
           WHERE n.uuid IN $uuids
           DETACH DELETE c`,
          { uuids }
        );
      }
    }

    // ========================================
    // PHASE 3: Batch embed ALL tasks together
    // ========================================
    if (verbose) {
      console.log(`[EmbeddingService] Phase 3: Embedding ${allTasks.length} texts in batches of ${batchSize}...`);
    }

    for (let i = 0; i < allTasks.length; i += batchSize) {
      const batch = allTasks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(allTasks.length / batchSize);

      if (verbose) {
        console.log(`[EmbeddingService]   Batch ${batchNum}/${totalBatches}: ${batch.length} texts`);
      }

      // Generate embeddings for this batch
      const texts = batch.map(t => t.text);
      const embeddings = await this.embeddingProvider!.embed(texts);

      // Store embeddings on tasks
      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = embeddings[j];
      }

      // ========================================
      // PHASE 4: Save this batch to Neo4j and mark nodes done
      // ========================================
      // Group tasks by (label, embeddingProp, type) for efficient Cypher
      const smallTasksByKey = new Map<string, EmbeddingTask[]>();
      const chunkTasksByLabel = new Map<string, EmbeddingTask[]>();

      for (const task of batch) {
        if (task.type === 'small') {
          const key = `${task.label}:${task.embeddingProp}`;
          if (!smallTasksByKey.has(key)) {
            smallTasksByKey.set(key, []);
          }
          smallTasksByKey.get(key)!.push(task);
        } else {
          // Chunks go into EmbeddingChunk nodes
          if (!chunkTasksByLabel.has(task.label)) {
            chunkTasksByLabel.set(task.label, []);
          }
          chunkTasksByLabel.get(task.label)!.push(task);
        }
      }

      // Save small node embeddings
      for (const [key, tasks] of smallTasksByKey) {
        const [label, embeddingProp] = key.split(':');
        const saveData = tasks.map(t => ({
          uuid: t.uuid,
          embedding: t.embedding,
          hash: t.hash,
        }));

        const cypher = this.buildEmbeddingSaveCypher(embeddingProp, label);
        await this.neo4jClient.run(cypher, { batch: saveData });

        // Count by type
        const embType = tasks[0].embeddingType;
        embeddedByType[embType] += tasks.length;
      }

      // Save chunk embeddings
      for (const [label, tasks] of chunkTasksByLabel) {
        const chunkData = tasks.map(t => ({
          uuid: `${t.parentUuid}_chunk_${t.chunkIndex}`,
          parentUuid: t.parentUuid,
          projectId,
          chunkIndex: t.chunkIndex,
          text: t.text,
          startChar: t.startChar,
          endChar: t.endChar,
          startLine: t.startLine,
          endLine: t.endLine,
          embedding: t.embedding,
          hash: t.hash,
        }));

        await this.neo4jClient.run(
          `UNWIND $chunks AS chunk
           MATCH (parent:${label} {uuid: chunk.parentUuid})
           CREATE (c:EmbeddingChunk {
             uuid: chunk.uuid,
             projectId: chunk.projectId,
             parentUuid: chunk.parentUuid,
             parentLabel: $parentLabel,
             chunkIndex: chunk.chunkIndex,
             text: chunk.text,
             startChar: chunk.startChar,
             endChar: chunk.endChar,
             startLine: chunk.startLine,
             endLine: chunk.endLine,
             embedding_content: chunk.embedding,
             embedding_content_hash: chunk.hash,
             embeddingsDirty: false
           })
           CREATE (parent)-[:HAS_EMBEDDING_CHUNK]->(c)`,
          { chunks: chunkData, parentLabel: label }
        );

        embeddedByType.content += tasks.length;
      }

      // Mark nodes in this batch as done (embeddingsDirty = false)
      // Collect unique nodes that were in this batch
      const processedUuids = new Set<string>();
      for (const task of batch) {
        const uuid = task.type === 'chunk' ? task.parentUuid! : task.uuid;
        processedUuids.add(uuid);
      }

      // Find which nodesToMarkDone were processed in this batch and mark them
      const nodesInThisBatch = nodesToMarkDone.filter(n => processedUuids.has(n.uuid));

      // Group by label for efficient updates
      const markDoneByLabel = new Map<string, NodeToMarkDone[]>();
      for (const node of nodesInThisBatch) {
        if (!markDoneByLabel.has(node.label)) {
          markDoneByLabel.set(node.label, []);
        }
        markDoneByLabel.get(node.label)!.push(node);
      }

      for (const [label, nodes] of markDoneByLabel) {
        // Separate chunked nodes from regular nodes
        const chunkedNodes = nodes.filter(n => n.chunkCount !== undefined);
        const regularNodes = nodes.filter(n => n.chunkCount === undefined);

        if (regularNodes.length > 0) {
          await this.neo4jClient.run(
            `UNWIND $uuids AS uuid
             MATCH (n:${label} {uuid: uuid})
             SET n.embeddingsDirty = false`,
            { uuids: regularNodes.map(n => n.uuid) }
          );
        }

        if (chunkedNodes.length > 0) {
          const chunkData = chunkedNodes.map(n => ({
            uuid: n.uuid,
            chunkCount: neo4j.int(n.chunkCount!),
            contentHash: n.contentHash || null,
          }));
          await this.neo4jClient.run(
            `UNWIND $nodes AS node
             MATCH (n:${label} {uuid: node.uuid})
             SET n.embeddingsDirty = false, n.usesChunks = true, n.chunkCount = node.chunkCount,
                 n.embedding_content_hash = node.contentHash`,
            { nodes: chunkData }
          );
        }
      }

      // Remove marked nodes from the list to avoid re-marking
      for (const uuid of processedUuids) {
        const idx = nodesToMarkDone.findIndex(n => n.uuid === uuid);
        if (idx !== -1) {
          nodesToMarkDone.splice(idx, 1);
        }
      }

      if (verbose) {
        console.log(`[EmbeddingService]   ✓ Batch ${batchNum} complete, ${nodesInThisBatch.length} nodes marked done`);
      }
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
   * Collect embedding tasks from a node type (without embedding)
   * Returns tasks ready for batched embedding
   */
  private async collectEmbeddingTasks(
    config: MultiEmbedNodeTypeConfig,
    options: {
      projectId: string;
      incrementalOnly: boolean;
      maxTextLength: number;
      embeddingTypes: ('name' | 'content' | 'description')[];
      verbose: boolean;
    }
  ): Promise<{
    tasks: EmbeddingTask[];
    nodesToMarkDone: NodeToMarkDone[];
    chunkedNodeUuids: Set<string>;
    totalNodes: number;
    skippedCount: number;
  }> {
    const { projectId, incrementalOnly, maxTextLength, embeddingTypes, verbose } = options;

    // Build query parameters
    const params: Record<string, any> = { projectId };
    if (config.limit) {
      params.limit = neo4j.int(config.limit);
    }

    // Fetch nodes
    const result = await this.neo4jClient.run(config.query, params);

    if (result.records.length === 0) {
      return {
        tasks: [],
        nodesToMarkDone: [],
        chunkedNodeUuids: new Set(),
        totalNodes: 0,
        skippedCount: 0,
      };
    }

    const tasks: EmbeddingTask[] = [];
    const nodesToMarkDone: NodeToMarkDone[] = [];
    const chunkedNodeUuids = new Set<string>();
    let skippedCount = 0;
    const label = config.label;

    // Track which nodes need marking done (accumulate across embedding types)
    const nodeNeedsMarking = new Map<string, { needsMarking: boolean; chunkCount?: number; contentHash?: string }>();

    for (const embeddingConfig of config.embeddings) {
      const embeddingType = embeddingConfig.propertyName.replace('embedding_', '') as 'name' | 'content' | 'description';
      if (!embeddingTypes.includes(embeddingType)) {
        continue;
      }

      const isContentEmbedding = embeddingType === 'content';

      // Process each record
      for (const record of result.records) {
        const uuid = record.get('uuid');
        const rawText = embeddingConfig.textExtractor(record);
        const existingHash = incrementalOnly ? (record.get(embeddingConfig.hashProperty) || null) : null;
        const embeddingsDirty = record.get('embeddingsDirty') === true;

        // Skip empty/tiny texts
        if (!rawText || rawText.length < 5) {
          continue;
        }

        // For content: check if needs chunking
        if (isContentEmbedding && needsChunking(rawText, CHUNKING_THRESHOLD)) {
          // Large content - create chunk tasks
          const text = rawText; // Don't truncate for chunking
          const hash = hashContent(text);

          // Check if needs embedding
          const needsEmbed = incrementalOnly
            ? (embeddingsDirty || existingHash === null || existingHash !== hash)
            : true;

          if (!needsEmbed) {
            skippedCount++;
            continue;
          }

          // Create chunks
          const chunks = chunkText(rawText, {
            chunkSize: EMBEDDING_CHUNK_SIZE,
            overlap: EMBEDDING_CHUNK_OVERLAP,
            strategy: 'paragraph',
          });

          chunkedNodeUuids.add(uuid);

          for (const chunk of chunks) {
            tasks.push({
              type: 'chunk',
              uuid: `${uuid}_chunk_${chunk.index}`,
              parentUuid: uuid,
              text: chunk.text,
              hash: hashContent(chunk.text),
              label,
              embeddingProp: embeddingConfig.propertyName,
              embeddingType,
              chunkIndex: chunk.index,
              startChar: chunk.startChar,
              endChar: chunk.endChar,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
            });
          }

          // Mark this node for done status with chunk count and content hash
          nodeNeedsMarking.set(uuid, { needsMarking: true, chunkCount: chunks.length, contentHash: hash });
        } else {
          // Small content - direct embed
          const text = rawText.length > maxTextLength
            ? rawText.substring(0, maxTextLength) + '...'
            : rawText;
          const hash = hashContent(text);

          // Check if needs embedding
          const needsEmbed = incrementalOnly
            ? (embeddingsDirty || existingHash === null || existingHash !== hash)
            : true;

          if (!needsEmbed) {
            skippedCount++;
            continue;
          }

          tasks.push({
            type: 'small',
            uuid,
            text,
            hash,
            label,
            embeddingProp: embeddingConfig.propertyName,
            embeddingType,
          });

          // Mark this node for done status (if not already marked with chunks)
          if (!nodeNeedsMarking.has(uuid)) {
            nodeNeedsMarking.set(uuid, { needsMarking: true });
          }
        }
      }
    }

    // Convert nodeNeedsMarking to nodesToMarkDone array
    for (const [uuid, info] of nodeNeedsMarking) {
      if (info.needsMarking) {
        nodesToMarkDone.push({
          uuid,
          label,
          chunkCount: info.chunkCount,
          contentHash: info.contentHash,
        });
      }
    }

    if (verbose && tasks.length > 0) {
      console.log(`[EmbeddingService]   ${label}: ${tasks.length} tasks (${result.records.length} nodes, ${skippedCount} cached)`);
    }

    return {
      tasks,
      nodesToMarkDone,
      chunkedNodeUuids,
      totalNodes: result.records.length,
      skippedCount,
    };
  }
  /**
   * Build Cypher query for saving embeddings to a node
   */
  private buildEmbeddingSaveCypher(embeddingProp: string, label: string): string {
    if (embeddingProp === 'embedding_name') {
      return `UNWIND $batch AS item
              MATCH (n:${label} {uuid: item.uuid})
              SET n.embedding_name = item.embedding, n.embedding_name_hash = item.hash, n.embeddingsDirty = false`;
    } else if (embeddingProp === 'embedding_content') {
      return `UNWIND $batch AS item
              MATCH (n:${label} {uuid: item.uuid})
              SET n.embedding_content = item.embedding, n.embedding_content_hash = item.hash, n.embeddingsDirty = false`;
    } else if (embeddingProp === 'embedding_description') {
      return `UNWIND $batch AS item
              MATCH (n:${label} {uuid: item.uuid})
              SET n.embedding_description = item.embedding, n.embedding_description_hash = item.hash, n.embeddingsDirty = false`;
    } else {
      // Fallback for legacy 'embedding' property
      return `UNWIND $batch AS item
              MATCH (n:${label} {uuid: item.uuid})
              SET n.embedding = item.embedding, n.embedding_hash = item.hash, n.embeddingsDirty = false`;
    }
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
