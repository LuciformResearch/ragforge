/**
 * Type definitions for RagForge configuration
 */

export interface RagForgeConfig {
  name: string;
  version: string;
  description?: string;
  neo4j: Neo4jConfig;
  entities: EntityConfig[];
  reranking?: RerankingConfig;
  mcp?: McpConfig;
  generation?: GenerationConfig;
  embeddings?: EmbeddingsConfig;
  summarization_strategies?: Record<string, SummarizationStrategyConfig>;
  summarization_llm?: SummarizationLLMConfig;
  source?: SourceConfig;
  watch?: WatchConfig;

  // Multi-provider LLM configuration (via LlamaIndex)
  llm?: LLMProviderConfig;

  // Multi-provider embedding configuration (via LlamaIndex)
  embedding?: EmbeddingProviderConfig;

  // Topic extraction and management (for Document RAG)
  topic_extraction?: TopicExtractionConfig;
  topic_merging?: TopicMergingConfig;
}

/**
 * Configuration for a summarization strategy
 */
export interface SummarizationStrategyConfig {
  /** Human-readable name */
  name?: string;

  /** Description of what this strategy does */
  description?: string;

  /** System prompt / context */
  system_prompt: string;

  /** Output schema definition */
  output_schema: {
    /** Root element name */
    root: string;

    /** Fields in the output */
    fields: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description: string;
      required?: boolean;
      nested?: any[]; // For nested objects
    }>;
  };

  /** Additional instructions (optional) */
  instructions?: string;
}

/**
 * LLM configuration for summarization (can differ from reranking LLM)
 */
export interface SummarizationLLMConfig {
  /** Provider (e.g., 'gemini', 'openai') */
  provider: string;

  /** Model ID */
  model: string;

  /** Temperature (default: 0.3 for more deterministic summaries) */
  temperature?: number;

  /** Max tokens for response */
  max_tokens?: number;

  /** API key (optional, can use env var) */
  api_key?: string;
}

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
  /** Max connections in pool (optional) */
  maxConnectionPoolSize?: number;
  /** Connection timeout in ms (optional) */
  connectionTimeout?: number;
}

export interface EntityConfig {
  name: string;
  description?: string;
  searchable_fields: FieldConfig[];
  computed_fields?: ComputedFieldConfig[];  // Computed fields (read-only, calculated at runtime)
  vector_index?: VectorIndexConfig;  // Legacy - single index
  vector_indexes?: VectorIndexConfig[];  // New - multiple indexes
  relationships?: RelationshipConfig[];

  // Entity field mappings (optional, with smart defaults)
  display_name_field?: string;  // Field for displaying entity names (default: 'name')
  unique_field?: string;        // Field for deduplication (default: 'uuid')
  query_field?: string;         // Field used in WHERE clauses (default: 'name')
  content_field?: string;       // Field containing the full content to read (e.g., 'source' for code, 'body' for documents)
  example_display_fields?: string[];  // Additional fields to display in examples (default: [])

  // Hierarchical content configuration (for entities where content is split across parent/children)
  hierarchical_content?: HierarchicalContentConfig;

  // Change tracking configuration
  track_changes?: boolean;      // Enable change tracking for this entity (default: false)
  change_tracking?: ChangeTrackingConfig;  // Change tracking configuration
}

/**
 * Configuration for entity-level change tracking
 */
export interface ChangeTrackingConfig {
  /** Field containing the content to track (e.g., 'source' for code, 'content' for documents) */
  content_field: string;

  /** Metadata fields to include in Change node (e.g., ['name', 'file'] for Scope) */
  metadata_fields?: string[];

  /** Field containing the content hash for change detection (default: 'hash') */
  hash_field?: string;
}

/**
 * Configuration for hierarchical content (entities where content is split across parent/children)
 * Example: A class entity only has its signature, methods are child entities linked via HAS_PARENT
 */
export interface HierarchicalContentConfig {
  /** Relationship type that links children to this entity (e.g., 'HAS_PARENT') */
  children_relationship: string;

  /** Whether to include children content when fetching this entity's full content */
  include_children: boolean;
}

export interface FieldConfig {
  name: string;
  type: FieldType;
  indexed?: boolean;
  description?: string;
  values?: string[]; // For enum types
  summarization?: FieldSummarizationConfig;
}

/**
 * Configuration for computed fields (read-only, calculated at runtime)
 */
export interface ComputedFieldConfig {
  /** Field name (used in queries and results) */
  name: string;

  /** Field type (allows FieldType or any string for flexibility) */
  type: FieldType | string;

  /** Human-readable description */
  description?: string;

  /** Simple expression for computation (e.g., "endLine - startLine") */
  expression?: string;

  /** Cypher query for complex computation (e.g., "OPTIONAL MATCH (n)-[:HAS_CHANGE]->...") */
  cypher?: string;

  /** Cache computed values in Neo4j (default: false) */
  materialized?: boolean;

  /** Neo4j property name for cached value (required if materialized=true) */
  cache_property?: string;
}

/**
 * Configuration for field-level summarization
 */
export interface FieldSummarizationConfig {
  /** Enable summarization for this field */
  enabled: boolean;

  /** Strategy ID to use (references summarization_strategies) */
  strategy: string;

  /** Minimum field length (chars) to trigger summarization */
  threshold: number;

  /** Cache summaries in Neo4j (default: true) */
  cache?: boolean;

  /** Generate on-demand vs pre-generation (default: false = pre-generate) */
  on_demand?: boolean;

  /** Custom prompt template path (relative to prompts/ dir) */
  prompt_template?: string;

  /** Output fields to extract and store (must match strategy schema) */
  output_fields: string[];

  /** How to use summaries in reranking (default: 'prefer_summary') */
  rerank_use?: 'always' | 'prefer_summary' | 'never';
}

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'enum'
  | 'array<string>'
  | 'array<number>';

export interface VectorIndexConfig {
  name: string;
  field: string;  // Neo4j property name for the embedding (e.g., 'embedding_signature')
  source_field: string;  // Neo4j property name for the text to embed (e.g., 'signature')
  dimension: number;
  similarity?: 'cosine' | 'euclidean' | 'dot';
  provider?: 'openai' | 'vertex' | 'gemini' | 'custom';
  model?: string;
  example_query?: string;  // Optional: example query for generated examples (otherwise generic)
}

export interface RelationshipConfig {
  type: string;
  direction: 'outgoing' | 'incoming' | 'both';
  target: string;
  description?: string;
  properties?: FieldConfig[];
  enrich?: boolean;           // NEW: Auto-enrich results with this relationship
  enrich_field?: string;      // NEW: Field name in results (default: type.toLowerCase())
  filters?: RelationshipFilterConfig[];
  example_target?: string;    // Optional: example target name for generated examples (otherwise found via introspection)
}

export interface RelationshipFilterConfig {
  name: string;
  direction: 'incoming' | 'outgoing';
  description?: string;
  parameter?: string;
}

export interface RerankingConfig {
  strategies: RerankingStrategy[];
  llm?: LLMRerankingConfig;
}

export interface LLMRerankingConfig {
  provider?: 'gemini';
  model?: string; // Default: 'gemma-3n-e2b-it'
}

export interface RerankingStrategy {
  name: string;
  description?: string;
  type: 'builtin' | 'custom';
  algorithm?: string; // For builtin: 'pagerank', 'betweenness_centrality', etc.
  scorer?: string; // For custom: JavaScript code as string
}

export interface McpConfig {
  server?: {
    name: string;
    version: string;
  };
  tools?: McpToolConfig[];
}

export interface McpToolConfig {
  name: string;
  description: string;
  expose: boolean;
}

export interface GenerationConfig {
  output_dir?: string;
  language?: 'typescript' | 'javascript';
  include_tests?: boolean;
  include_docs?: boolean;
  mcp_server?: boolean;
}

export interface EmbeddingsConfig {
  provider: 'gemini';
  defaults?: EmbeddingDefaults;
  entities: EmbeddingEntityConfig[];
}

export interface EmbeddingDefaults {
  model?: string;
  dimension?: number;
  similarity?: 'cosine' | 'dot' | 'euclidean';
}

export interface EmbeddingEntityConfig {
  entity: string;
  pipelines: EmbeddingPipelineConfig[];
}

export interface EmbeddingPipelineConfig {
  name: string;
  source: string;
  target_property: string;
  model?: string;
  dimension?: number;
  similarity?: 'cosine' | 'dot' | 'euclidean';
  preprocessors?: string[];
  include_fields?: string[];
  include_relationships?: EmbeddingRelationshipConfig[];
  batch_size?: number;
  concurrency?: number;
  throttle_ms?: number;
  max_retries?: number;
  retry_delay_ms?: number;
}

export interface EmbeddingRelationshipConfig {
  type: string;
  direction: 'outgoing' | 'incoming' | 'both';
  fields?: string[];
  depth?: number;
  max_items?: number;
}

/**
 * Configuration for source ingestion
 *
 * Supports multiple source types with auto-detection:
 * - 'files': Local files (code, documents, media) - parser auto-detected by extension
 * - 'database': Database (PostgreSQL, Neo4j, MongoDB, etc.)
 * - 'api': REST/GraphQL API
 * - 'web': Web pages (crawler)
 *
 * Legacy types 'code' and 'document' are mapped to 'files' for backward compatibility.
 */
export interface SourceConfig {
  /**
   * Type of source to ingest
   * - 'files': Local files with auto-detection (replaces 'code' and 'document')
   * - 'database': Database connection
   * - 'api': REST/GraphQL API
   * - 'web': Web crawler
   * - 'code': (deprecated) Maps to 'files'
   * - 'document': (deprecated) Maps to 'files'
   */
  type: 'files' | 'database' | 'api' | 'web' | 'code' | 'document';

  /**
   * @deprecated Adapter is now auto-detected based on file extension.
   * Kept for backward compatibility but ignored.
   */
  adapter?: 'typescript' | 'python' | 'tika' | string;

  // ============================================
  // Options for type: 'files' (or legacy 'code'/'document')
  // ============================================

  /** Base path for resolving relative paths (optional, defaults to project root) */
  root?: string;

  /** Glob patterns to include (relative to root). Auto-detected if omitted. */
  include?: string[];

  /** Glob patterns to exclude (optional) */
  exclude?: string[];

  /** Track changes and store diffs in Neo4j (default: false) */
  track_changes?: boolean;

  // ============================================
  // Options for type: 'database'
  // ============================================

  /** Database connection configuration */
  connection?: {
    /** Driver (auto-detected from URI if possible) */
    driver?: 'postgresql' | 'neo4j' | 'mysql' | 'mongodb' | 'sqlite';
    /** Connection URI */
    uri: string;
    /** Tables/collections to include (all if omitted) */
    tables?: string[];
    /** Tables/collections to exclude */
    excludeTables?: string[];
  };

  // ============================================
  // Options for type: 'api'
  // ============================================

  /** API configuration */
  api?: {
    /** Base URL */
    baseUrl: string;
    /** Endpoints to ingest */
    endpoints?: string[];
    /** Authentication headers */
    headers?: Record<string, string>;
    /** API format */
    format?: 'rest' | 'graphql' | 'openapi';
  };

  // ============================================
  // Options for type: 'web'
  // ============================================

  /** Web crawler configuration */
  web?: {
    /** Starting URL */
    url: string;
    /** Crawl depth (default: 1) */
    depth?: number;
    /** Maximum pages to crawl (default: 10) */
    maxPages?: number;
    /** URL patterns to include */
    includePatterns?: string[];
    /** URL patterns to exclude */
    excludePatterns?: string[];
  };

  /** Additional options passed to the adapter */
  options?: SourceAdapterOptions;
}

/**
 * Options for source adapters
 */
export interface SourceAdapterOptions {
  // Document chunking (for llamaindex adapter)
  chunk_size?: number;
  chunk_overlap?: number;
  chunking_strategy?: 'fixed_size' | 'semantic' | 'sentence' | 'paragraph';
  preserve_sentences?: boolean;

  // Other adapter-specific options
  [key: string]: any;
}

/**
 * Configuration for file watching and automatic incremental ingestion
 */
export interface WatchConfig {
  /** Enable file watching (default: false) */
  enabled: boolean;

  /** Batch interval in milliseconds - collect changes before processing (default: 1000) */
  batch_interval?: number;

  /** Enable verbose logging for watch events (default: false) */
  verbose?: boolean;

  /** Auto-generate embeddings after ingestion (default: false) */
  auto_embed?: boolean;
}

/**
 * Multi-provider LLM configuration (via LlamaIndex)
 */
export interface LLMProviderConfig {
  /** Provider name (gemini, openai, anthropic, ollama, etc.) */
  provider: string;

  /** Model name (e.g., "gemini-1.5-pro", "gpt-4", "claude-3-5-sonnet-20241022") */
  model?: string;

  /** API key (not needed for Ollama) */
  api_key?: string;

  /** Temperature for generation (0.0 to 1.0) */
  temperature?: number;

  /** Max tokens to generate */
  max_tokens?: number;

  /** Additional provider-specific options */
  options?: Record<string, any>;
}

/**
 * Multi-provider embedding configuration (via LlamaIndex)
 */
export interface EmbeddingProviderConfig {
  /** Provider name (gemini, openai, cohere, ollama, etc.) */
  provider: string;

  /** Model name (e.g., "text-embedding-004", "text-embedding-3-small") */
  model?: string;

  /** API key (not needed for Ollama) */
  api_key?: string;

  /** Embedding dimensions (if customizable) */
  dimensions?: number;

  /** Additional provider-specific options */
  options?: Record<string, any>;
}

/**
 * Configuration for LLM-based topic extraction from document chunks
 */
export interface TopicExtractionConfig {
  /** Enable topic extraction (default: false) */
  enabled: boolean;

  /** LLM configuration for extraction */
  llm: {
    /** Provider (e.g., 'gemini', 'openai') */
    provider: string;

    /** Model ID (e.g., 'gemini-1.5-flash' for speed) */
    model: string;

    /** Temperature (default: 0.3 for more deterministic extraction) */
    temperature?: number;

    /** API key (optional, can use env var) */
    api_key?: string;
  };

  /** Extraction parameters */
  extraction: {
    /** Minimum chunk length (chars) to trigger extraction (default: 100) */
    min_chunk_length?: number;

    /** Maximum topics per chunk (default: 3) */
    max_topics_per_chunk?: number;

    /** Minimum confidence score to keep topic (0-1, default: 0.6) */
    min_confidence?: number;

    /** Number of previous chunks to include for context (default: 2) */
    context_window?: number;
  };

  /** Topic similarity and deduplication */
  similarity: {
    /** Similarity threshold for merging similar topics (default: 0.85) */
    threshold?: number;

    /** Use embeddings for similarity (default: true) */
    use_embeddings?: boolean;
  };
}

/**
 * Configuration for LLM-based topic merging and consolidation
 */
export interface TopicMergingConfig {
  /** Enable topic merging (default: false) */
  enabled: boolean;

  /** LLM configuration for merge decisions */
  llm: {
    /** Provider (e.g., 'gemini', 'openai') */
    provider: string;

    /** Model ID (e.g., 'gemini-1.5-pro' for better reasoning) */
    model: string;

    /** Temperature (default: 0.2 for conservative decisions) */
    temperature?: number;

    /** API key (optional, can use env var) */
    api_key?: string;
  };

  /** Clustering parameters */
  clustering: {
    /** Similarity threshold for clustering topics (default: 0.85) */
    similarity_threshold?: number;

    /** Minimum cluster size to consider merging (default: 2) */
    min_cluster_size?: number;

    /** Maximum cluster size (default: 5, don't merge too many at once) */
    max_cluster_size?: number;
  };

  /** Merge decision criteria */
  merge_criteria?: {
    /** Minimum chunk overlap ratio to merge (0-1, default: 0.3) */
    min_chunk_overlap?: number;

    /** Require keyword overlap (default: true) */
    require_keyword_overlap?: boolean;
  };

  /** Scheduling configuration */
  schedule: {
    /** Trigger mode: 'manual', 'auto_after_ingestion', 'periodic' (default: 'manual') */
    trigger?: 'manual' | 'auto_after_ingestion' | 'periodic';

    /** Batch size - process N clusters at a time (default: 10) */
    batch_size?: number;
  };
}
