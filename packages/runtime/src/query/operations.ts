/**
 * Query Pipeline Operations
 *
 * Defines the operation types for the QueryBuilder pipeline.
 * Each operation transforms a set of results into a new set.
 */

import type { SearchResult } from '../types/index.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type { LLMRerankOptions } from '../reranking/llm-reranker.js';

/**
 * Base operation interface
 */
export interface Operation {
  type: 'fetch' | 'expand' | 'semantic' | 'llmRerank' | 'filter';
  config: any;
}

/**
 * FETCH: Retrieve initial results from Neo4j using Cypher
 */
export interface FetchOperation extends Operation {
  type: 'fetch';
  config: {
    mode: 'all' | 'uuid' | 'relationship' | 'filter';
    // For 'uuid' mode
    uuids?: string[];
    // For 'relationship' mode
    scopeName?: string;
    relationship?: string;
    direction?: 'incoming' | 'outgoing';
    targetType?: string;
    // For 'filter' mode
    filters?: Record<string, any>;
  };
}

/**
 * EXPAND: Expand results by following relationships
 */
export interface ExpandOperation extends Operation {
  type: 'expand';
  config: {
    relType: string;
    depth?: number;
    direction?: 'outgoing' | 'incoming' | 'both';
  };
}

/**
 * SEMANTIC: Filter/rerank results by semantic similarity
 */
export interface SemanticOperation extends Operation {
  type: 'semantic';
  config: {
    query: string;
    vectorIndex: string;
    topK: number;
    minScore: number;
    metadataOverride?: (results: any[], metadata: any) => any;
  };
}

/**
 * LLM_RERANK: Rerank results using an LLM
 */
export interface LLMRerankOperation extends Operation {
  type: 'llmRerank';
  config: {
    userQuestion: string;
    llmProvider: LLMProvider;
    options?: LLMRerankOptions;
  };
}

/**
 * FILTER: Filter results by field values (post-processing) or relationship constraints
 */
export interface FilterOperation extends Operation {
  type: 'filter';
  config: {
    filters: Record<string, any>;
    relationshipFilter?: {
      entityName: string;
      relationship: string;
      direction: 'incoming' | 'outgoing';
      targetType?: string;
    };
  };
}

/**
 * Union type of all operations
 */
export type PipelineOperation =
  | FetchOperation
  | ExpandOperation
  | SemanticOperation
  | LLMRerankOperation
  | FilterOperation;

/**
 * Operation execution context
 */
export interface ExecutionContext {
  currentResults: SearchResult[];
  entityType: string;
}
