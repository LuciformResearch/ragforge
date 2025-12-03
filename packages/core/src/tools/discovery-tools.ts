/**
 * Discovery Tools
 *
 * Tools for agents to discover the database schema.
 * 100% generic - works with any RagForge config (code, documents, products, etc.)
 */

import type {
  ToolGenerationContext,
  GeneratedToolDefinition,
  ToolHandlerGenerator,
  EntityMetadata,
} from './types/index.js';

/**
 * Schema representation returned by get_schema tool
 */
export interface SchemaInfo {
  /** List of entity names */
  entities: string[];

  /** Detailed info per entity */
  entity_details: Record<string, EntitySchemaInfo>;

  /** All relationships in the graph */
  relationships: RelationshipInfo[];

  /** Available semantic search indexes */
  semantic_indexes: SemanticIndexInfo[];

  /** Tips for the agent */
  usage_tips: string[];
}

export interface EntitySchemaInfo {
  name: string;
  description?: string;
  unique_field: string;
  display_name_field: string;
  query_field: string;
  content_field?: string;  // Field containing full content (use get_entities_by_ids to fetch)
  example_display_fields?: string[];
  fields: FieldInfo[];
  computed_fields?: FieldInfo[];
  has_semantic_search: boolean;
  semantic_indexes?: string[];
  outgoing_relationships: string[];
  incoming_relationships: string[];
}

export interface FieldInfo {
  name: string;
  type: string;
  description?: string;
  is_unique?: boolean;
  indexed?: boolean;
  values?: string[];  // For enum-type fields
}

export interface RelationshipInfo {
  type: string;
  from: string;
  to: string;
  description?: string;
}

export interface SemanticIndexInfo {
  name: string;
  entity: string;
  source_field: string;
  description: string;
}

/**
 * Generate discovery tools from context
 */
export function generateDiscoveryTools(
  context: ToolGenerationContext
): { tools: GeneratedToolDefinition[]; handlers: Record<string, ToolHandlerGenerator> } {
  const tools: GeneratedToolDefinition[] = [];
  const handlers: Record<string, ToolHandlerGenerator> = {};

  // 1. get_schema tool
  const getSchema = generateGetSchemaTool(context);
  tools.push(getSchema.definition);
  handlers[getSchema.definition.name] = getSchema.handler;

  // 2. describe_entity tool (optional, more detailed per-entity)
  const describeEntity = generateDescribeEntityTool(context);
  tools.push(describeEntity.definition);
  handlers[describeEntity.definition.name] = describeEntity.handler;

  return { tools, handlers };
}

/**
 * Generate get_schema tool
 */
function generateGetSchemaTool(context: ToolGenerationContext): {
  definition: GeneratedToolDefinition;
  handler: ToolHandlerGenerator;
} {
  const entityNames = context.entities.map(e => e.name);
  const hasSemanticSearch = context.vectorIndexes.length > 0;
  const hasRelationships = context.relationships.length > 0;

  const description = `Get the complete database schema to understand what data is available.

Returns:
- All entity types (${entityNames.join(', ')})
- Fields for each entity (with types)
- Relationships between entities
- Semantic search indexes (for natural language queries)
- Usage tips

Call this FIRST when you need to understand what data exists and how to query it.`;

  const definition: GeneratedToolDefinition = {
    name: 'get_schema',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        include_tips: {
          type: 'boolean',
          description: 'Include usage tips for querying (default: true)',
        },
      },
    },
  };

  // Handler returns the schema (doesn't need RagClient, just context)
  const handler: ToolHandlerGenerator = (_rag: any) => async (args: Record<string, any>) => {
    const includeTips = args.include_tips !== false;
    return buildSchemaInfo(context, includeTips);
  };

  return { definition, handler };
}

/**
 * Generate describe_entity tool
 */
function generateDescribeEntityTool(context: ToolGenerationContext): {
  definition: GeneratedToolDefinition;
  handler: ToolHandlerGenerator;
} {
  const entityNames = context.entities.map(e => e.name);

  const description = `Get detailed information about a specific entity type.

Available entities: ${entityNames.join(', ')}

Returns all fields, relationships, and semantic indexes for the requested entity.
Use this when you need detailed info about one entity after calling get_schema.`;

  const definition: GeneratedToolDefinition = {
    name: 'describe_entity',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        entity_name: {
          type: 'string',
          enum: entityNames,
          description: 'Name of the entity to describe',
        },
      },
      required: ['entity_name'],
    },
  };

  const handler: ToolHandlerGenerator = (_rag: any) => async (args: Record<string, any>) => {
    const { entity_name } = args;
    const entity = context.entities.find(e => e.name === entity_name);

    if (!entity) {
      return { error: `Unknown entity: ${entity_name}. Available: ${entityNames.join(', ')}` };
    }

    return buildEntitySchemaInfo(entity, context);
  };

  return { definition, handler };
}

/**
 * Build complete schema info from context
 */
function buildSchemaInfo(context: ToolGenerationContext, includeTips: boolean): SchemaInfo {
  const entities = context.entities.map(e => e.name);

  const entity_details: Record<string, EntitySchemaInfo> = {};
  for (const entity of context.entities) {
    entity_details[entity.name] = buildEntitySchemaInfo(entity, context);
  }

  const relationships: RelationshipInfo[] = context.relationships.map(r => ({
    type: r.type,
    from: r.sourceEntity,
    to: r.targetEntity,
    description: r.description,
  }));

  const semantic_indexes: SemanticIndexInfo[] = context.vectorIndexes.map(vi => ({
    name: vi.name,
    entity: vi.entityType,
    source_field: vi.sourceField,
    description: `Semantic search on ${vi.entityType}.${vi.sourceField}`,
  }));

  const usage_tips: string[] = includeTips ? generateUsageTips(context) : [];

  return {
    entities,
    entity_details,
    relationships,
    semantic_indexes,
    usage_tips,
  };
}

/**
 * Build entity schema info
 */
function buildEntitySchemaInfo(entity: EntityMetadata, context: ToolGenerationContext): EntitySchemaInfo {
  const fields: FieldInfo[] = entity.searchableFields.map(f => ({
    name: f.name,
    type: f.type,
    description: f.description,
    is_unique: f.name === entity.uniqueField,
    indexed: f.indexed,
    values: f.values,  // For enum-type fields
  }));

  const computed_fields: FieldInfo[] | undefined = entity.computedFields?.map(cf => ({
    name: cf.name,
    type: cf.type,
    description: cf.description,
  }));

  // Find relationships for this entity
  const outgoing = context.relationships
    .filter(r => r.sourceEntity === entity.name)
    .map(r => `${r.type} -> ${r.targetEntity}`);

  const incoming = context.relationships
    .filter(r => r.targetEntity === entity.name)
    .map(r => `${r.sourceEntity} -> ${r.type}`);

  // Find semantic indexes for this entity
  const entityIndexes = context.vectorIndexes
    .filter(vi => vi.entityType === entity.name)
    .map(vi => vi.name);

  return {
    name: entity.name,
    description: entity.description,
    unique_field: entity.uniqueField,
    display_name_field: entity.displayNameField,
    query_field: entity.queryField,
    content_field: entity.contentField,  // Field with full content (fetch with get_entities_by_ids)
    example_display_fields: entity.exampleDisplayFields?.length ? entity.exampleDisplayFields : undefined,
    fields,
    computed_fields: computed_fields?.length ? computed_fields : undefined,
    has_semantic_search: entityIndexes.length > 0,
    semantic_indexes: entityIndexes.length > 0 ? entityIndexes : undefined,
    outgoing_relationships: outgoing,
    incoming_relationships: incoming,
  };
}

/**
 * Generate contextual usage tips
 */
function generateUsageTips(context: ToolGenerationContext): string[] {
  const tips: string[] = [];

  // Basic tip
  tips.push('Use query_entities for structured queries with filters (=, CONTAINS, GLOB, REGEX, IN)');

  // Semantic search tip
  if (context.vectorIndexes.length > 0) {
    const indexes = context.vectorIndexes.map(vi => `${vi.entityType}.${vi.sourceField}`);
    tips.push(`Use semantic_search for natural language queries on: ${indexes.join(', ')}`);
    tips.push('IMPORTANT: semantic_search returns metadata + snippet only, NOT full content');
  }

  // Batch fetch tip (most important for agent workflow)
  const entitiesWithContent = context.entities.filter(e => e.contentField);
  if (entitiesWithContent.length > 0) {
    const contentFields = entitiesWithContent.map(e => `${e.name}.${e.contentField}`);
    tips.push(`Use get_entities_by_ids to fetch full content (${contentFields.join(', ')}) after semantic_search`);
    tips.push('Recommended workflow: semantic_search → get_entities_by_ids → answer with actual content');
  }

  // Relationship tip
  if (context.relationships.length > 0) {
    tips.push('Use explore_relationships to traverse connections between entities');
  }

  // ID lookup tip
  tips.push('Use get_entity_by_id for a single entity, get_entities_by_ids for multiple');

  return tips;
}
