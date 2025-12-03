/**
 * Tool Generation Types
 *
 * Type definitions for config-driven tool generation system
 */

/**
 * Options for generateToolsFromConfig
 */
export interface ToolGenerationOptions {
  /** Include discovery tools (get_schema, describe_entity) */
  includeDiscovery?: boolean; // default: true

  /** Include semantic search tools (requires vector_indexes in config) */
  includeSemanticSearch?: boolean; // default: true

  /** Include relationship traversal tools */
  includeRelationships?: boolean; // default: true

  /** Include specialized query tools (date ranges, numeric ranges, etc.) */
  includeSpecializedTools?: boolean; // default: false (Phase 4)

  /** Include aggregation tools (count, sum, avg, etc.) */
  includeAggregations?: boolean; // default: false (Phase 5)

  /** Include change tracking tools */
  includeChangeTracking?: boolean; // default: false (Phase 5)

  /** Custom tool templates (for extending/overriding defaults) */
  customTemplates?: ToolTemplate[];

  /** Expose raw Cypher execution (DANGER: use only in trusted environments) */
  allowRawCypher?: boolean; // default: false
}

/**
 * Tool template for custom tool generation
 */
export interface ToolTemplate {
  name: string;
  generator: (context: ToolGenerationContext) => GeneratedToolDefinition;
}

/**
 * Context passed to tool generators
 */
export interface ToolGenerationContext {
  entities: EntityMetadata[];
  relationships: RelationshipMetadata[];
  vectorIndexes: VectorIndexMetadata[];
}

/**
 * Metadata about an entity extracted from config
 */
export interface EntityMetadata {
  name: string;
  description?: string;
  uniqueField: string;
  displayNameField: string;
  queryField: string;
  contentField?: string;  // Field containing full content (e.g., 'source', 'body', 'content')
  exampleDisplayFields?: string[];
  searchableFields: FieldMetadata[];
  computedFields?: ComputedFieldMetadata[];
  vectorIndexes: VectorIndexMetadata[];
  relationships: RelationshipMetadata[];
  changeTracking?: {
    enabled: boolean;
    contentField: string;
  };
}

/**
 * Metadata about a searchable field
 */
export interface FieldMetadata {
  name: string;
  type: string;
  description?: string;
  indexed?: boolean;
  computed?: boolean;
  values?: string[];  // For enum-type fields
}

/**
 * Metadata about a computed field
 */
export interface ComputedFieldMetadata {
  name: string;
  type: string;
  description?: string;
  expression?: string;
  cypher?: string;
  materialized?: boolean;
}

/**
 * Metadata about a vector index
 */
export interface VectorIndexMetadata {
  name: string;
  entityType: string;
  sourceField: string;
  dimension: number;
  provider?: string;
  model?: string;
}

/**
 * Metadata about a relationship
 */
export interface RelationshipMetadata {
  type: string;
  sourceEntity: string;
  targetEntity: string;
  direction: 'outgoing' | 'incoming' | 'both';
  description?: string;
}

/**
 * Generated tool definition (before handler attachment)
 */
export interface GeneratedToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Generated tools with handlers
 */
export interface GeneratedTools {
  /** Tool definitions with inputSchema for ToolRegistry */
  tools: GeneratedToolDefinition[];

  /** Handler functions for each tool (to be attached with RagClient) */
  handlers: Record<string, ToolHandlerGenerator>;

  /** Metadata about what was generated */
  metadata: ToolGenerationMetadata;
}

/**
 * Handler generator - takes RagClient and returns handler function
 */
export type ToolHandlerGenerator = (rag: any) => (args: Record<string, any>) => Promise<any>;

/**
 * Metadata about generated tools
 */
export interface ToolGenerationMetadata {
  entityCount: number;
  toolCount: number;
  searchableFieldsCount: number;
  computedFieldsCount: number;
  generatedAt: Date;
  options: ToolGenerationOptions;
}
