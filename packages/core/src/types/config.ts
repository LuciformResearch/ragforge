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
}

export interface Neo4jConfig {
  uri: string;
  database?: string;
  username?: string;
  password?: string;
}

export interface EntityConfig {
  name: string;
  description?: string;
  searchable_fields: FieldConfig[];
  vector_index?: VectorIndexConfig;  // Legacy - single index
  vector_indexes?: VectorIndexConfig[];  // New - multiple indexes
  relationships?: RelationshipConfig[];

  // Entity field mappings (optional, with smart defaults)
  display_name_field?: string;  // Field for displaying entity names (default: 'name')
  unique_field?: string;        // Field for deduplication (default: 'uuid')
  query_field?: string;         // Field used in WHERE clauses (default: 'name')
  example_display_fields?: string[];  // Additional fields to display in examples (default: [])
}

export interface FieldConfig {
  name: string;
  type: FieldType;
  indexed?: boolean;
  description?: string;
  values?: string[]; // For enum types
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
