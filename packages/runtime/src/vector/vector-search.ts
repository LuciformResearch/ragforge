/**
 * Vector Search Module
 *
 * Handles semantic search using Google Gemini embeddings and Neo4j vector indexes
 */

import { GoogleGenAI } from '@google/genai';
import neo4j from 'neo4j-driver';
import type { Neo4jClient } from '../client/neo4j-client.js';

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

export interface IndexConfig {
  model: string;
  dimension?: number;
  apiKey?: string;
}

export class VectorSearch {
  private static defaultConfig: IndexConfig = { model: 'gemini-embedding-001' };
  private static indexRegistry = new Map<string, IndexConfig>();

  static setDefaultConfig(config: IndexConfig) {
    this.defaultConfig = config;
  }

  static registerIndex(indexName: string, config: IndexConfig) {
    this.indexRegistry.set(indexName, config);
  }

  private genAIClients = new Map<string, GoogleGenAI>();

  constructor(
    private neo4jClient: Neo4jClient,
    private options: {
      apiKey?: string;
    } = {}
  ) {}

  private resolveIndexConfig(indexName: string): IndexConfig {
    return VectorSearch.indexRegistry.get(indexName) ?? VectorSearch.defaultConfig;
  }

  private getClient(apiKey?: string): GoogleGenAI {
    const key = apiKey || this.options.apiKey || VectorSearch.defaultConfig.apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }

    let client = this.genAIClients.get(key);
    if (!client) {
      client = new GoogleGenAI({ apiKey: key });
      this.genAIClients.set(key, client);
    }

    return client;
  }

  private async generateEmbedding(text: string, config: IndexConfig): Promise<number[]> {
    const client = this.getClient(config.apiKey);

    const request: any = {
      model: config.model,
      contents: [
        {
          role: 'user',
          parts: [{ text }]
        }
      ]
    };

    if (config.dimension) {
      request.config = {
        ...(request.config ?? {}),
        outputDimensionality: config.dimension
      };
    }

    const response = await client.models.embedContent(request);

    const embedding = response.embeddings?.[0]?.values;
    if (!Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from Google GenAI');
    }

    const dimension = embedding.length;
    console.log(
      `[VectorSearch] Generated embedding for index using model=${config.model ?? 'default'} dimension=${dimension}`
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
    return Promise.all(texts.map(text => this.generateEmbedding(text, config)));
  }

  /**
   * Get embedding model info
   */
  getModelInfo() {
    return {
      model: VectorSearch.defaultConfig.model,
      dimension: VectorSearch.defaultConfig.dimension ?? 768,
      provider: 'gemini'
    };
  }
}
