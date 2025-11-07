/**
 * @ragforge/runtime - Runtime library for executing RAG queries
 *
 * Provides query building, vector search, and reranking capabilities
 */

// Client
export { Neo4jClient } from './client/neo4j-client.js';

// Query
export { QueryBuilder } from './query/query-builder.js';

// Mutations
export { MutationBuilder } from './mutations/mutation-builder.js';
export type {
  EntityMutationConfig,
  AddRelationshipConfig,
  RemoveRelationshipConfig
} from './mutations/mutation-builder.js';

// Vector Search
export { VectorSearch } from './vector/vector-search.js';

// Reranking
export { LLMReranker } from './reranking/llm-reranker.js';
export { VertexAIProvider } from './reranking/vertex-ai-provider.js';
export { GeminiAPIProvider } from './reranking/gemini-api-provider.js';
export type {
  LLMProvider,
  LLMProviderConfig
} from './reranking/llm-provider.js';
export type {
  LLMRerankOptions,
  ScopeEvaluation,
  QuerySuggestion,
  QueryFeedback,
  LLMRerankResult,
  RerankInput
} from './reranking/llm-reranker.js';
export type { VertexAIConfig } from './reranking/vertex-ai-provider.js';
export type { GeminiAPIConfig } from './reranking/gemini-api-provider.js';

// Agents
export {
  IterativeCodeAgent,
  type AgentConfig,
  type AgentResult,
  type IterationStep,
  type IterationAnalysis
} from './agent/iterative-code-agent.js';

// Types
export * from './types/index.js';

// Embeddings
export type {
  GeneratedEmbeddingPipelineConfig,
  GeneratedEmbeddingEntityConfig,
  GeneratedEmbeddingsConfig,
  GeneratedEmbeddingRelationshipConfig
} from './embedding/types.js';
export { GeminiEmbeddingProvider } from './embedding/gemini-provider.js';
export { runEmbeddingPipelines } from './embedding/pipeline.js';

// Main factory function
import { Neo4jClient } from './client/neo4j-client.js';
import { QueryBuilder } from './query/query-builder.js';
import type { RuntimeConfig, RelationshipConfig } from './types/index.js';
import type { EntityContext } from './types/entity-context.js';

/**
 * Create a RAG client
 *
 * @example
 * const client = createClient({
 *   neo4j: {
 *     uri: 'bolt://localhost:7687',
 *     username: 'neo4j',
 *     password: 'password'
 *   }
 * });
 *
 * const results = await client.query('Scope')
 *   .where({ type: 'function' })
 *   .limit(10)
 *   .execute();
 */
export function createClient(config: RuntimeConfig) {
  const neo4jClient = new Neo4jClient(config.neo4j);

  return {
    /**
     * Create a query builder for an entity type
     */
    query<T = any>(entityType: string, options?: { enrichment?: RelationshipConfig[]; context?: EntityContext }): QueryBuilder<T> {
      return new QueryBuilder<T>(neo4jClient, entityType, options?.enrichment, options?.context);
    },

    /**
     * Execute raw Cypher query
     */
    async raw(cypher: string, params?: Record<string, any>) {
      return neo4jClient.run(cypher, params);
    },

    /**
     * Close connection
     */
    async close() {
      return neo4jClient.close();
    },

    /**
     * Verify connectivity
     */
    async ping() {
      return neo4jClient.verifyConnectivity();
    },

    /**
     * Get internal Neo4j client (for generated code)
     */
    _getClient() {
      return neo4jClient;
    }
  };
}

export type RagClient = ReturnType<typeof createClient>;
