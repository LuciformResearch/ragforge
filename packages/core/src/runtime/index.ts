/**
 * @ragforge/runtime - Runtime library for executing RAG queries
 *
 * Provides query building, vector search, and reranking capabilities
 */

// Client
export { Neo4jClient } from './client/neo4j-client.js';

// Re-export neo4j driver for scripts that need neo4j.int(), etc.
export { default as neo4j } from 'neo4j-driver';
import neo4jDriver from 'neo4j-driver';

// Query
export { QueryBuilder } from './query/query-builder.js';

// Generic Query Builder (for agent tools)
export { GenericQueryBuilder, QueryClient } from './query/generic-query-builder.js';
export { QueryPlan } from './query/query-plan.js';
export { QueryExecutor, type FilterRegistry } from './query/query-executor.js';
export type {
  RelationshipDirection,
  FilterOperation,
  RelationshipStep,
  SemanticSearchStep,
  TextSearchStep,
  WhereCondition
} from './query/query-plan.js';
export type {
  GenericQueryBuilderOptions,
  SemanticSearchOptions
} from './query/generic-query-builder.js';

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
export { RateLimiter, GlobalRateLimiter } from './reranking/rate-limiter.js';
export type {
  LLMProvider,
  LLMProviderConfig as RerankingLLMProviderConfig
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
export type { GeminiAPIConfig, RateLimitStrategy } from './reranking/gemini-api-provider.js';
export type { RateLimiterConfig } from './reranking/rate-limiter.js';

// Structured Prompts & LLM
export { StructuredPromptBuilder } from './llm/structured-prompt-builder.js';
export type {
  PromptField,
  StructuredPromptConfig
} from './llm/structured-prompt-builder.js';

// Unified Structured LLM Executor
export { StructuredLLMExecutor, BaseToolExecutor } from './llm/structured-llm-executor.js';
export type {
  LLMStructuredCallConfig,
  LLMBatchResult,
  EmbeddingGenerationConfig,
  InputFieldConfig,
  RelationshipConfig as LLMRelationshipConfig,
  InputContextConfig,
  OutputFieldSchema,
  OutputSchema,
  LLMConfig,
  FallbackConfig,
  CacheConfig,
  ItemEvaluation,
  ToolCallRequest,
  ToolExecutionResult,
  ToolExecutor,
  SingleLLMCallConfig
  // Note: QueryFeedback is already exported from llm-reranker
} from './llm/structured-llm-executor.js';

// Multi-Provider Adapters (LlamaIndex) - DISABLED: Using native @google/genai instead
// To re-enable, uncomment and reinstall: npm i llamaindex @llamaindex/google @llamaindex/openai @llamaindex/anthropic @llamaindex/ollama
// export {
//   LLMProviderAdapter,
//   EmbeddingProviderAdapter,
//   ProviderRegistry
// } from './llm/provider-adapter.js';
// export type {
//   LLMProviderConfig as LlamaIndexLLMConfig,
//   EmbeddingProviderConfig as LlamaIndexEmbeddingConfig
// } from './llm/provider-adapter.js';

// Native Tool Calling
export * from './llm/native-tool-calling/index.js';

// Summarization
export { GenericSummarizer } from './summarization/generic-summarizer.js';
export {
  getDefaultStrategies,
  getStrategy,
  listStrategyIds,
  CODE_ANALYSIS_STRATEGY,
  TEXT_EXTRACTION_STRATEGY,
  DOCUMENT_SUMMARY_STRATEGY,
  PRODUCT_FEATURES_STRATEGY
} from './summarization/default-strategies.js';
export { SummaryStorage } from './summarization/summary-storage.js';
export type { SummaryStrategy } from './summarization/default-strategies.js';
export type {
  SummarizationConfig,
  FieldSummary,
  SummarizeInput
} from './summarization/generic-summarizer.js';
export type {
  CachedSummary,
  SummaryStorageOptions
} from './summarization/summary-storage.js';

// RagAgent - Main agent implementation
export {
  RagAgent,
  createRagAgent,
  AgentLogger,
  getAgentIdentity,
  getAgentIdentityFromBrain,
  DEFAULT_AGENT_IDENTITY,
  DEFAULT_PERSONA_TEMPLATE,
  translatePersona,
  type RagAgentOptions,
  type AskResult,
  type AgentSessionLog,
  type AgentLogEntry,
  type AgentIdentitySettings,
} from './agents/rag-agent.js';

// Legacy Agent Runtime (kept for reference, not exported)
// export { AgentRuntime } from './agents/agent-runtime.js';
// export { ToolRegistry } from './agents/tools/tool-registry.js';
// export type {
//   AgentConfig as ToolAgentConfig,
//   AgentDebugConfig,
//   ToolFeedback,
//   ToolUsageInfo,
//   ToolConsideredInfo,
//   ToolLimitation,
//   ToolSuggestion,
//   AlternativeApproach,
//   AnswerQuality
// } from './types/chat.js';

// Conversational Agent with Memory
export { ConversationAgent } from './conversation/agent.js';
export { Conversation } from './conversation/conversation.js';
export { ConversationStorage } from './conversation/storage.js';
export { ConversationExporter } from './conversation/exporter.js';
export type {
  ConversationConfig,
  ConversationAgentOptions,
  ConversationMetadata,
  Message,
  ToolCall,
  ToolResult,
  Summary,
  SummaryContent,
  AssistantResponse,
  ConversationContext,
  RecentContext,
  RAGContext,
  ConversationFullData,
  ListConversationsOptions,
  GetMessagesOptions,
  StoreMessageOptions,
  SummarizationTrigger
} from './conversation/types.js';

// Chat Session Manager (legacy, kept for reference)
// export { ChatSessionManager } from './chat/session-manager.js';
// export type { CreateSessionOptions } from './chat/session-manager.js';

// Types
export * from './types/index.js';

// Embeddings
export type {
  GeneratedEmbeddingPipelineConfig,
  GeneratedEmbeddingEntityConfig,
  GeneratedEmbeddingsConfig,
  GeneratedEmbeddingRelationshipConfig
} from './embedding/types.js';
// Native Gemini Embedding Provider (no LlamaIndex)
export {
  GeminiEmbeddingProvider,
  EmbeddingProvider, // Alias for GeminiEmbeddingProvider
  type GeminiProviderOptions,
  type EmbeddingProviderOptions,
} from './embedding/embedding-provider.js';
export { runEmbeddingPipelines } from './embedding/pipeline.js';

// Source Adapters
export * from './adapters/index.js';

// OCR (Optical Character Recognition)
export * from './ocr/index.js';

// Multi-Project Support
export * from './projects/index.js';

// Pattern Matching (for GLOB/REGEX operators in queries)
export {
  globToRegex,
  matchesGlob,
  isValidRegex,
  convertPatternOperator
} from './utils/pattern-matching.js';

// Main factory function
import { Neo4jClient } from './client/neo4j-client.js';
import { QueryBuilder } from './query/query-builder.js';
import { GenericQueryBuilder, QueryClient } from './query/generic-query-builder.js';
import type { RuntimeConfig, RuntimeRelationshipConfig as RelationshipConfig } from './types/index.js';
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
 * // Legacy query API (for generated code)
 * const results = await client.query('Scope')
 *   .where({ type: 'function' })
 *   .limit(10)
 *   .execute();
 *
 * // Generic query API (for agent tools)
 * const results = await client.get('Scope')
 *   .where('complexity', '>', 5)
 *   .semanticSearch('code_embeddings', 'authentication logic')
 *   .limit(10)
 *   .execute();
 */
export function createClient(config: RuntimeConfig) {
  const neo4jClient = new Neo4jClient(config.neo4j);

  // Create QueryClient for generic queries
  const queryClient = new QueryClient({
    neo4j: neo4jClient,
    filterRegistry: {}
  });

  return {
    /**
     * Create a query builder for an entity type (legacy API for generated code)
     */
    query<T = any>(entityType: string, options?: { enrichment?: RelationshipConfig[]; context?: EntityContext }): QueryBuilder<T> {
      return new QueryBuilder<T>(neo4jClient, entityType, options?.enrichment, options?.context);
    },

    /**
     * Create a generic query for an entity type (new API for agent tools)
     *
     * @example
     * const results = await client.get('Scope')
     *   .getRelationship('DEPENDS_ON')
     *   .filter('complexityGt5')
     *   .semanticSearch('code_embeddings', 'authentication logic')
     *   .limit(10)
     *   .execute();
     */
    get<T = any>(entity: string): GenericQueryBuilder<T> {
      return queryClient.get<T>(entity);
    },

    /**
     * Register a custom filter for use with .filter()
     *
     * @example
     * client.registerFilter('complexityGt5', 'n.complexity > 5');
     * client.registerFilter('modifiedAfter', 'n.last_modified > $afterDate', ['afterDate']);
     */
    registerFilter(name: string, cypherCondition: string, paramNames?: string[]): void {
      queryClient.registerFilter(name, cypherCondition, paramNames);
    },

    /**
     * Get all registered filters
     */
    getFilters() {
      return queryClient.getFilters();
    },

    /**
     * Execute raw Cypher query
     * Auto-converts whole numbers to neo4j.int() for LIMIT, SKIP, etc.
     */
    async raw(cypher: string, params?: Record<string, any>) {
      const convertedParams = params ? Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
          key,
          typeof value === 'number' && Number.isInteger(value)
            ? neo4jDriver.int(value)
            : value
        ])
      ) : undefined;
      return neo4jClient.run(cypher, convertedParams);
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
