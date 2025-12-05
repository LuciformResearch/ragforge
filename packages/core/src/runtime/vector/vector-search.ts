/**
 * Vector Search Module
 *
 * Handles semantic search using Gemini embeddings and Neo4j vector indexes
 */

import neo4j from 'neo4j-driver';
import type { Neo4jClient } from '../client/neo4j-client.js';
import { GeminiEmbeddingProvider, type GeminiProviderOptions as EmbeddingProviderOptions } from '../embedding/embedding-provider.js';

export interface VectorSearchOptions {
  /** Vector index name to query */
  indexName: string;
  /** Number of results to return */
  topK?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
  /** Filter results to only these UUIDs (for pipeline filtering) */
  filterUuids?: string[];
  /** Field filter conditions (WHERE clauses and params) */
  fieldFilterConditions?: {
    conditions: string[];
    params: Record<string, any>;
  };
}

export interface VectorSearchResult {
  nodeId: string;
  score: number;
  properties: Record<string, any>;
}

/**
 * Index configuration - now supports multi-provider!
 */
export interface IndexConfig {
  /** Provider name (gemini, openai, ollama, etc.) */
  provider?: string;
  /** Model name (provider-specific) */
  model: string;
  /** Embedding dimensions */
  dimension?: number;
  /** API key (optional, can use env vars) */
  apiKey?: string;
  /** Additional provider options */
  options?: Record<string, any>;
}

export class VectorSearch {
  private static defaultConfig: IndexConfig = {
    provider: 'gemini',
    model: 'text-embedding-004'
  };
  private static indexRegistry = new Map<string, IndexConfig>();

  static setDefaultConfig(config: IndexConfig) {
    this.defaultConfig = config;
  }

  static registerIndex(indexName: string, config: IndexConfig) {
    this.indexRegistry.set(indexName, config);
  }

  private embeddingProviders = new Map<string, GeminiEmbeddingProvider>();

  constructor(
    private neo4jClient: Neo4jClient,
    private options: {
      /** Legacy: API key for Gemini (backward compat) */
      apiKey?: string;
      /** Modern: Embedding provider options */
      embeddingProvider?: EmbeddingProviderOptions;
    } = {}
  ) {}

  private resolveIndexConfig(indexName: string): IndexConfig {
    return VectorSearch.indexRegistry.get(indexName) ?? VectorSearch.defaultConfig;
  }

  /**
   * Get or create embedding provider for a given config
   */
  private getEmbeddingProvider(config: IndexConfig): GeminiEmbeddingProvider {
    const provider = config.provider || 'gemini';
    const cacheKey = `${provider}:${config.model}:${config.apiKey || ''}`;

    let embeddingProvider = this.embeddingProviders.get(cacheKey);
    if (!embeddingProvider) {
      const apiKey = config.apiKey || this.options.apiKey;
      if (!apiKey) {
        throw new Error('API key is required for embedding provider. Set it in config or pass apiKey option.');
      }
      // Create provider from config
      embeddingProvider = new GeminiEmbeddingProvider({
        model: config.model,
        apiKey,
        dimension: config.dimension,
      });

      this.embeddingProviders.set(cacheKey, embeddingProvider);

      console.log(
        `[VectorSearch] Created embedding provider: ${embeddingProvider.getProviderName()} / ${embeddingProvider.getModelName()}`
      );
    }

    return embeddingProvider;
  }

  private async generateEmbedding(text: string, config: IndexConfig): Promise<number[]> {
    const provider = this.getEmbeddingProvider(config);

    // Generate embedding using multi-provider
    const embedding = await provider.embedSingle(text);

    console.log(
      `[VectorSearch] Generated embedding using ${provider.getProviderName()}/${provider.getModelName()} dimension=${embedding.length}`
    );

    return embedding;
  }

  /**
   * Search Neo4j vector index
   */
  async search(
    query: string,
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    const {
      indexName,
      topK = 10,
      minScore = 0.0,
      filterUuids,
      fieldFilterConditions
    } = options;

    const indexConfig = this.resolveIndexConfig(indexName);

    // 1. Generate embedding for query
    const queryEmbedding = await this.generateEmbedding(query, indexConfig);

    // 2. Query Neo4j vector index
    // If filterUuids or fieldFilters are provided, we need to request more results and filter
    // Ensure topK is an integer for Neo4j
    const topKInt = Math.floor(topK);
    const needsFiltering = filterUuids || (fieldFilterConditions && fieldFilterConditions.conditions.length > 0);
    const requestTopK = needsFiltering ? Math.max(topKInt * 3, 100) : topKInt;

    let cypher = `
      CALL db.index.vector.queryNodes($indexName, $requestTopK, $embedding)
      YIELD node, score
      WHERE score >= $minScore
    `;

    // Add UUID filter if provided
    if (filterUuids && filterUuids.length > 0) {
      cypher += ` AND node.uuid IN $filterUuids`;
    }

    // Add field filter conditions if provided
    if (fieldFilterConditions && fieldFilterConditions.conditions.length > 0) {
      cypher += ' AND ' + fieldFilterConditions.conditions.join(' AND ');
    }

    // Add CONSUMES relationships for context enrichment
    cypher += `
      WITH node, score
      OPTIONAL MATCH (node)-[:CONSUMES]->(dep)
      WITH node, score, collect(DISTINCT dep.name) AS consumes
      RETURN elementId(node) AS nodeId, score, node, consumes
      ORDER BY score DESC
      LIMIT $topK
    `;

    const params: Record<string, any> = {
      indexName,
      requestTopK: neo4j.int(requestTopK),  // Ensure Neo4j receives as integer
      topK: neo4j.int(topKInt),             // Ensure Neo4j receives as integer
      embedding: queryEmbedding,
      minScore
    };

    if (filterUuids && filterUuids.length > 0) {
      params.filterUuids = filterUuids;
    }

    // Add field filter params
    if (fieldFilterConditions && fieldFilterConditions.params) {
      Object.assign(params, fieldFilterConditions.params);
    }

    const result = await this.neo4jClient.run(cypher, params);

    // 3. Parse results and add consumes to properties
    return result.records.map(record => {
      const properties = record.get('node').properties;
      const consumes = record.get('consumes');

      // Add consumes to properties for context enrichment
      if (consumes && consumes.length > 0) {
        properties.consumes = consumes;
      }

      return {
        nodeId: record.get('nodeId'),
        score: record.get('score'),
        properties
      };
    });
  }

  /**
   * Batch generate embeddings for multiple texts
   */
  async generateEmbeddings(texts: string[], indexName: string): Promise<number[][]> {
    const config = this.resolveIndexConfig(indexName);
    const provider = this.getEmbeddingProvider(config);

    // Use batch embedding for efficiency
    return await provider.embed(texts);
  }

  /**
   * Get embedding model info
   */
  getModelInfo() {
    return {
      provider: VectorSearch.defaultConfig.provider || 'gemini',
      model: VectorSearch.defaultConfig.model,
      dimension: VectorSearch.defaultConfig.dimension ?? 768
    };
  }
}
