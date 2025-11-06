/**
 * Runtime Configuration Types
 */

export interface RuntimeConfig {
  neo4j: Neo4jConfig;
  embeddings?: EmbeddingsConfig;
  reranking?: RerankingConfig;
}

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
  maxConnectionPoolSize?: number;
  connectionTimeout?: number;
}

export interface EmbeddingsConfig {
  provider: 'openai' | 'vertex' | 'custom';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  dimension?: number;
}

export interface RerankingConfig {
  strategies: RerankingStrategyConfig[];
}

export interface RerankingStrategyConfig {
  name: string;
  type: 'builtin' | 'custom';
  algorithm?: 'pagerank' | 'bm25' | 'reciprocal-rank-fusion';
  scorer?: string; // Custom scorer function as string
  weight?: number;
}

/**
 * Relationship Configuration for Entity Enrichment
 * Used to auto-enrich query results with related entities
 */
export interface RelationshipConfig {
  type: string;                 // Relationship type (e.g., 'CONSUMES', 'PURCHASED_WITH')
  direction: 'outgoing' | 'incoming' | 'both';
  target: string;               // Target entity type
  description?: string;
  enrich?: boolean;             // Auto-enrich results with this relationship
  enrich_field?: string;        // Field name in results (default: type.toLowerCase())
}
