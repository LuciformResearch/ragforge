/**
 * Runtime Configuration Types
 */

// Import unified types from core
import type { Neo4jConfig, RelationshipConfig } from '../../types/config.js';
export type { Neo4jConfig, RelationshipConfig };

export interface RuntimeConfig {
  neo4j: Neo4jConfig;
  embeddings?: EmbeddingsConfig;
  reranking?: RerankingConfig;
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

// RelationshipConfig imported from core (unified)
