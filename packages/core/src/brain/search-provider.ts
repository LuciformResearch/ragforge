/**
 * SearchProvider interface for database-agnostic search operations
 *
 * This abstraction allows brain-manager to work with different database backends
 * (Neo4j, Kuzu, SurrealDB, etc.) without knowing the implementation details.
 */

/**
 * Minimal client interface for search operations
 * Compatible with both Neo4jClient and KuzuClient
 */
interface SearchClient {
  run(cypher: string, params?: Record<string, any>): Promise<{
    records: Array<{
      get(key: string): any;
      toObject?(): Record<string, any>;
    }>;
  }>;
  /** Optional: Ensure FTS indexes are fresh (KuzuClient only) */
  ensureFtsIndexesFresh?(): Promise<void>;
  /** Optional: Ensure Vector indexes are fresh (KuzuClient only) */
  ensureVectorIndexesFresh?(): Promise<void>;
  /** Optional: Mark FTS indexes as dirty (KuzuClient only) */
  markFtsIndexesDirty?(): void;
  /** Optional: Mark Vector indexes as dirty (KuzuClient only) */
  markVectorIndexesDirty?(): void;
  /** Optional: Mark all indexes as dirty (KuzuClient only) */
  markIndexesDirty?(): void;
}

/**
 * Raw search result from the database (before project enrichment)
 */
export interface RawSearchResult {
  /** Node properties */
  node: Record<string, any>;
  /** Relevance score (0-1 for semantic, varies for BM25) */
  score: number;
  /** Node label (Scope, File, etc.) */
  label?: string;
}

/**
 * Options for text search
 */
export interface TextSearchOptions {
  /** Labels to search (e.g., ['Scope', 'File', 'MarkdownSection']) */
  labels: string[];
  /** Project filter clause (e.g., "AND n.projectId IN $projectIds") */
  projectFilter?: string;
  /** Node type filter clause */
  nodeTypeFilter?: string;
  /** Base path filter clause */
  basePathFilter?: string;
  /** Query parameters */
  params?: Record<string, any>;
  /** Maximum results */
  limit?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Fuzzy distance for text matching (0=exact, 1-2=fuzzy) */
  fuzzyDistance?: 0 | 1 | 2;
}

/**
 * Options for vector/semantic search
 */
export interface VectorSearchOptions {
  /** Labels to search */
  labels: string[];
  /** Embedding property to search (e.g., 'embedding_content', 'embedding_name') */
  embeddingProperty: string;
  /** Query embedding vector */
  queryEmbedding: number[];
  /** Project filter clause */
  projectFilter?: string;
  /** Node type filter clause */
  nodeTypeFilter?: string;
  /** Base path filter clause */
  basePathFilter?: string;
  /** Query parameters */
  params?: Record<string, any>;
  /** Maximum results */
  limit?: number;
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
}

/**
 * Abstract interface for search providers
 */
export interface SearchProvider {
  /**
   * Full-text/BM25 search across multiple labels
   */
  textSearch(query: string, options: TextSearchOptions): Promise<RawSearchResult[]>;

  /**
   * Vector similarity search using embeddings
   */
  vectorSearch(options: VectorSearchOptions): Promise<RawSearchResult[]>;

  /**
   * Get the provider name for logging
   */
  readonly name: string;
}

// ============================================================
// Neo4j Search Provider
// ============================================================

export class Neo4jSearchProvider implements SearchProvider {
  readonly name = 'neo4j';

  constructor(private client: SearchClient) {}

  async textSearch(query: string, options: TextSearchOptions): Promise<RawSearchResult[]> {
    const {
      labels,
      projectFilter = '',
      nodeTypeFilter = '',
      basePathFilter = '',
      params = {},
      limit = 50,
      minScore,
      fuzzyDistance = 1,
    } = options;

    // Escape special Lucene characters
    const escapedQuery = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');

    // Build Lucene query with fuzzy matching
    const words = escapedQuery.split(/\s+/).filter(w => w.length > 0);
    const luceneQuery = fuzzyDistance === 0
      ? words.join(' ')
      : words.map(w => `${w}~${fuzzyDistance}`).join(' ');

    // Map labels to fulltext index names
    const indexMap: Record<string, string> = {
      Scope: 'scope_fulltext',
      File: 'file_fulltext',
      DataFile: 'datafile_fulltext',
      DocumentFile: 'document_fulltext',
      MarkdownSection: 'markdown_fulltext',
      MediaFile: 'media_fulltext',
      WebPage: 'webpage_fulltext',
      CodeBlock: 'codeblock_fulltext',
    };

    const indexes = labels.map(l => indexMap[l]).filter(Boolean);
    if (indexes.length === 0) return [];

    // Build UNION ALL query for all indexes
    const unionClauses = indexes.map(indexName => `
      CALL db.index.fulltext.queryNodes('${indexName}', $luceneQuery)
      YIELD node AS n, score
      WHERE true ${projectFilter} ${nodeTypeFilter} ${basePathFilter}
      RETURN n, score
    `);

    const cypher = unionClauses.join('\nUNION ALL\n') + `
      ORDER BY score DESC
      LIMIT $limit
    `;

    try {
      const result = await this.client.run(cypher, {
        luceneQuery,
        ...params,
        limit,
      });

      const results: RawSearchResult[] = [];
      const seenUuids = new Set<string>();

      for (const record of result.records) {
        const node = record.get('n').properties;
        const uuid = node.uuid;
        const score = record.get('score');

        if (seenUuids.has(uuid)) continue;
        seenUuids.add(uuid);

        if (minScore !== undefined && score < minScore) continue;

        results.push({ node, score });
      }

      return results;
    } catch (err: any) {
      console.warn(`[Neo4jSearchProvider] Text search failed: ${err.message}`);
      return [];
    }
  }

  async vectorSearch(options: VectorSearchOptions): Promise<RawSearchResult[]> {
    const {
      labels,
      embeddingProperty,
      queryEmbedding,
      projectFilter = '',
      nodeTypeFilter = '',
      basePathFilter = '',
      params = {},
      limit = 50,
      minScore = 0.3,
    } = options;

    // Map labels to vector index names
    const getIndexName = (label: string, prop: string) => {
      const labelLower = label.toLowerCase();
      return `${labelLower}_${prop}_vector`;
    };

    const results: RawSearchResult[] = [];
    const seenUuids = new Set<string>();

    // Search each label
    for (const label of labels) {
      const indexName = getIndexName(label, embeddingProperty);

      const cypher = `
        CALL db.index.vector.queryNodes($indexName, $topK, $queryEmbedding)
        YIELD node AS n, score
        WHERE score >= $minScore ${projectFilter} ${nodeTypeFilter} ${basePathFilter}
        RETURN n, score
        ORDER BY score DESC
        LIMIT $limit
      `;

      try {
        const result = await this.client.run(cypher, {
          indexName,
          topK: limit * 2,
          queryEmbedding,
          minScore,
          ...params,
          limit,
        });

        for (const record of result.records) {
          const node = record.get('n').properties;
          const uuid = node.uuid;
          const score = record.get('score');

          if (seenUuids.has(uuid)) continue;
          seenUuids.add(uuid);

          results.push({ node, score, label });
        }
      } catch (err: any) {
        // Index might not exist, that's ok
        if (!err.message?.includes('does not exist')) {
          console.debug(`[Neo4jSearchProvider] Vector search failed for ${indexName}: ${err.message}`);
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}

// ============================================================
// Kuzu Search Provider
// ============================================================

import { FTS_INDEX_CONFIG, VECTOR_INDEX_CONFIG } from '../utils/node-schema.js';

export class KuzuSearchProvider implements SearchProvider {
  readonly name = 'kuzu';

  constructor(private client: SearchClient) {}

  async textSearch(query: string, options: TextSearchOptions): Promise<RawSearchResult[]> {
    const {
      labels,
      projectFilter = '',
      limit = 50,
      minScore,
    } = options;

    // Ensure FTS indexes are fresh before searching (lazy rebuild)
    if (this.client.ensureFtsIndexesFresh) {
      await this.client.ensureFtsIndexesFresh();
    }

    // Clean up query for FTS search
    const cleanedQuery = query
      .replace(/~\d+/g, '')  // Remove fuzzy markers
      .replace(/\*/g, '')
      .replace(/\+/g, ' ')
      .replace(/"/g, '')
      .trim();

    if (!cleanedQuery) return [];

    const results: RawSearchResult[] = [];
    const seenUuids = new Set<string>();

    // Try native FTS first for labels that have FTS indexes
    const ftsLabels = labels.filter(l => l in FTS_INDEX_CONFIG);
    const fallbackLabels = labels.filter(l => !(l in FTS_INDEX_CONFIG));

    // Use QUERY_FTS_INDEX for labels with FTS indexes
    for (const label of ftsLabels) {
      const indexName = `${label.toLowerCase()}_fts`;

      try {
        // QUERY_FTS_INDEX returns node and score with BM25 ranking
        // We need to filter by projectId after the FTS query
        const ftsQuery = projectFilter.includes('projectId')
          ? `
            CALL QUERY_FTS_INDEX('${label}', '${indexName}', $query)
            WITH node, score
            WHERE true ${projectFilter.replace(/\bn\./g, 'node.')}
            RETURN node, score
            ORDER BY score DESC
            LIMIT ${Math.ceil(limit / labels.length) * 2}
          `
          : `
            CALL QUERY_FTS_INDEX('${label}', '${indexName}', $query)
            RETURN node, score
            ORDER BY score DESC
            LIMIT ${Math.ceil(limit / labels.length) * 2}
          `;

        const result = await this.client.run(ftsQuery, { query: cleanedQuery });

        for (const record of result.records) {
          const rawNode = record.get('node');
          const node = rawNode?.properties || rawNode;
          const uuid = node?.uuid;
          const score = record.get('score') || 0;

          if (!uuid || seenUuids.has(uuid)) continue;
          seenUuids.add(uuid);

          if (minScore !== undefined && score < minScore) continue;

          results.push({ node, score, label });
        }
      } catch (err: any) {
        // FTS index might not exist yet, fall back to CONTAINS
        console.debug(`[KuzuSearchProvider] FTS search failed for ${label}, falling back to CONTAINS: ${err.message?.substring(0, 80)}`);
        fallbackLabels.push(label);
      }
    }

    // Fallback to CONTAINS for labels without FTS indexes
    if (fallbackLabels.length > 0) {
      const fallbackResults = await this.textSearchFallback(cleanedQuery, {
        ...options,
        labels: fallbackLabels,
        limit: Math.ceil(limit / labels.length) * 2,
      });

      for (const r of fallbackResults) {
        if (!seenUuids.has(r.node.uuid)) {
          seenUuids.add(r.node.uuid);
          results.push(r);
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Fallback text search using CONTAINS when FTS index is not available
   */
  private async textSearchFallback(query: string, options: TextSearchOptions): Promise<RawSearchResult[]> {
    const {
      labels,
      projectFilter = '',
      limit = 50,
      minScore,
    } = options;

    const searchTerms = query.split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) return [];

    // Search fields per label
    const searchFields: Record<string, string[]> = {
      Scope: ['name', 'signature', 'docstring', 'source'],
      File: ['name', 'path', 'source'],
      MarkdownSection: ['title', 'heading', 'content', 'ownContent'],
      MediaFile: ['name', 'description', 'textContent'],
      WebPage: ['title', 'textContent', 'description'],
      CodeBlock: ['code', 'language'],
      DataFile: ['name', 'preview', 'structure'],
      DocumentFile: ['name', 'title', 'extractedText', 'content'],
    };

    const results: RawSearchResult[] = [];
    const seenUuids = new Set<string>();

    for (const label of labels) {
      const fields = searchFields[label] || ['name'];

      // Build WHERE clause: any term in any field (OR logic)
      const conditions: string[] = [];
      for (const term of searchTerms.slice(0, 3)) {
        const termLower = term.toLowerCase();
        for (const field of fields) {
          conditions.push(`lower(n.${field}) CONTAINS '${termLower.replace(/'/g, "''")}'`);
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' OR ')}` : '';

      let kuzuProjectFilter = '';
      if (projectFilter.includes('projectId IN')) {
        kuzuProjectFilter = projectFilter.replace('AND n.', 'AND n.');
      }

      const cypher = `
        MATCH (n:${label})
        ${whereClause} ${kuzuProjectFilter}
        RETURN n, 0.5 AS score
        LIMIT ${Math.ceil(limit / labels.length) * 2}
      `;

      try {
        const result = await this.client.run(cypher, {});

        for (const record of result.records) {
          const rawNode = record.get('n');
          const node = rawNode?.properties || rawNode;
          const uuid = node?.uuid;
          const score = record.get('score') || 0.5;

          if (!uuid || seenUuids.has(uuid)) continue;
          seenUuids.add(uuid);

          if (minScore !== undefined && score < minScore) continue;

          results.push({ node, score, label });
        }
      } catch (err: any) {
        console.debug(`[KuzuSearchProvider] Fallback search failed for ${label}: ${err.message}`);
      }
    }

    return results;
  }

  async vectorSearch(options: VectorSearchOptions): Promise<RawSearchResult[]> {
    const {
      labels,
      embeddingProperty,
      queryEmbedding,
      projectFilter = '',
      limit = 50,
      minScore = 0.3,
    } = options;

    // Ensure Vector indexes are fresh before searching (lazy rebuild)
    if (this.client.ensureVectorIndexesFresh) {
      await this.client.ensureVectorIndexesFresh();
    }

    const results: RawSearchResult[] = [];
    const seenUuids = new Set<string>();

    // EmbeddingChunk only has embedding_content, skip for other properties
    const labelsToSearch = labels.filter(label => {
      if (label === 'EmbeddingChunk' && embeddingProperty !== 'embedding_content') {
        return false;
      }
      return true;
    });

    // Check if we have vector indexes configured
    const hasVectorIndex = (label: string, prop: string): boolean => {
      const config = VECTOR_INDEX_CONFIG[label];
      return config ? config.includes(prop) : false;
    };

    // Search each label using native QUERY_VECTOR_INDEX when available
    for (const label of labelsToSearch) {
      const indexName = `${label.toLowerCase()}_${embeddingProperty}_vec`;
      const useNativeIndex = hasVectorIndex(label, embeddingProperty);

      try {
        if (useNativeIndex) {
          // Use native HNSW vector index - much faster!
          // QUERY_VECTOR_INDEX returns node and distance (for cosine: distance = 1 - similarity)
          const vectorQuery = `
            CALL QUERY_VECTOR_INDEX('${label}', '${indexName}', $queryEmbedding, ${limit * 2})
            RETURN node, distance
            ORDER BY distance ASC
          `;

          const result = await this.client.run(vectorQuery, { queryEmbedding });

          for (const record of result.records) {
            const rawNode = record.get('node');
            const node = rawNode?.properties || rawNode;
            const uuid = node?.uuid;
            const distance = record.get('distance') || 0;

            if (!uuid || seenUuids.has(uuid)) continue;

            // Convert distance to similarity score (for cosine: score = 1 - distance)
            const score = 1 - distance;
            if (score < minScore) continue;

            // Apply project filter if needed
            if (projectFilter.includes('projectId')) {
              // TODO: Use projected graph for filtered vector search
              // For now, filter in-memory
            }

            seenUuids.add(uuid);
            results.push({ node, score, label });
          }
        } else {
          // Fallback to brute-force for labels without vector index
          let kuzuProjectFilter = '';
          if (projectFilter.includes('projectId IN')) {
            kuzuProjectFilter = projectFilter.replace('AND n.', 'AND n.');
          }

          const cypher = `
            MATCH (n:${label})
            WHERE n.${embeddingProperty} IS NOT NULL ${kuzuProjectFilter}
            RETURN n, n.${embeddingProperty} AS embedding
            LIMIT 1000
          `;

          const result = await this.client.run(cypher, {});

          for (const record of result.records) {
            const rawNode = record.get('n');
            const node = rawNode?.properties || rawNode;
            const uuid = node?.uuid;
            const embedding = record.get('embedding');

            if (!uuid || seenUuids.has(uuid)) continue;
            if (!embedding || !Array.isArray(embedding)) continue;

            const score = this.cosineSimilarity(queryEmbedding, embedding);
            if (score < minScore) continue;

            seenUuids.add(uuid);
            results.push({ node, score, label });
          }
        }
      } catch (err: any) {
        // If native index fails, fall back to brute-force
        if (useNativeIndex) {
          console.debug(`[KuzuSearchProvider] Vector index query failed for ${label}, falling back to brute-force: ${err.message?.substring(0, 60)}`);
          // Retry with brute-force
          try {
            const cypher = `
              MATCH (n:${label})
              WHERE n.${embeddingProperty} IS NOT NULL
              RETURN n, n.${embeddingProperty} AS embedding
              LIMIT 1000
            `;
            const result = await this.client.run(cypher, {});

            for (const record of result.records) {
              const rawNode = record.get('n');
              const node = rawNode?.properties || rawNode;
              const uuid = node?.uuid;
              const embedding = record.get('embedding');

              if (!uuid || seenUuids.has(uuid)) continue;
              if (!embedding || !Array.isArray(embedding)) continue;

              const score = this.cosineSimilarity(queryEmbedding, embedding);
              if (score < minScore) continue;

              seenUuids.add(uuid);
              results.push({ node, score, label });
            }
          } catch {
            // Ignore secondary failure
          }
        } else {
          console.debug(`[KuzuSearchProvider] Vector search failed for ${label}: ${err.message}`);
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a search provider for the given database client
 */
export function createSearchProvider(client: SearchClient, type: 'neo4j' | 'kuzu'): SearchProvider {
  switch (type) {
    case 'kuzu':
      return new KuzuSearchProvider(client);
    case 'neo4j':
    default:
      return new Neo4jSearchProvider(client);
  }
}
