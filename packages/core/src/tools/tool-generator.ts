/**
 * Tool Generator
 *
 * Generates database query tools from RagForge config
 * Phase 1: Core tools (query_entities, semantic_search, explore_relationships, get_entity_by_id)
 */

import type { RagForgeConfig, EntityConfig } from '../types/config.js';
import type {
  ToolGenerationOptions,
  GeneratedTools,
  EntityMetadata,
  FieldMetadata,
  ComputedFieldMetadata,
  VectorIndexMetadata,
  RelationshipMetadata,
  GeneratedToolDefinition,
  ToolHandlerGenerator,
  ToolGenerationContext,
} from './types/index.js';
import { generateChangeTrackingTools, generateAggregationTools } from './advanced/index.js';
import { generateDiscoveryTools } from './discovery-tools.js';

/**
 * Generate database query tools from RagForge config
 *
 * @param config - RagForge configuration (parsed YAML or loaded config object)
 * @param options - Customization options
 * @returns Tool definitions and handlers ready for ToolRegistry
 */
export function generateToolsFromConfig(
  config: RagForgeConfig,
  options: ToolGenerationOptions = {}
): GeneratedTools {
  // Extract metadata from config first
  const context = extractMetadata(config);

  // Auto-detect change tracking (Phase 5)
  const hasChangeTracking = context.entities.some(e => e.changeTracking?.enabled);

  // Set defaults
  const opts: Required<ToolGenerationOptions> = {
    includeDiscovery: options.includeDiscovery ?? true,
    includeSemanticSearch: options.includeSemanticSearch ?? true,
    includeRelationships: options.includeRelationships ?? true,
    includeSpecializedTools: options.includeSpecializedTools ?? false,
    includeAggregations: options.includeAggregations ?? false,
    includeChangeTracking: options.includeChangeTracking ?? hasChangeTracking,
    customTemplates: options.customTemplates ?? [],
    allowRawCypher: options.allowRawCypher ?? false,
  };

  // Generate core tools
  const tools: GeneratedToolDefinition[] = [];
  const handlers: Record<string, ToolHandlerGenerator> = {};

  // 0. Discovery tools (get_schema, describe_entity) - always first so agent can discover the schema
  if (opts.includeDiscovery) {
    const discoveryTools = generateDiscoveryTools(context);
    tools.push(...discoveryTools.tools);
    Object.assign(handlers, discoveryTools.handlers);
  }

  // 1. query_entities (always included)
  const queryEntities = generateQueryEntitiesTool(context);
  tools.push(queryEntities);
  handlers[queryEntities.name] = generateQueryEntitiesHandler(context);

  // 2. semantic_search (if vector indexes exist)
  if (opts.includeSemanticSearch && context.vectorIndexes.length > 0) {
    const semanticSearch = generateSemanticSearchTool(context);
    tools.push(semanticSearch);
    handlers[semanticSearch.name] = generateSemanticSearchHandler(context);
  }

  // 3. explore_relationships (if relationships exist)
  if (opts.includeRelationships && context.relationships.length > 0) {
    const exploreRels = generateExploreRelationshipsTool(context);
    tools.push(exploreRels);
    handlers[exploreRels.name] = generateExploreRelationshipsHandler(context);
  }

  // 4. get_entity_by_id (always included)
  const getById = generateGetEntityByIdTool(context);
  tools.push(getById);
  handlers[getById.name] = generateGetEntityByIdHandler(context);

  // 4b. get_entities_by_ids (batch fetch - always included)
  const getByIds = generateGetEntitiesByIdsTool(context);
  tools.push(getByIds);
  handlers[getByIds.name] = generateGetEntitiesByIdsHandler(context);

  // 4c. glob_search (pattern matching on any field)
  const globSearch = generateGlobSearchTool(context);
  tools.push(globSearch);
  handlers[globSearch.name] = generateGlobSearchHandler(context);

  // 5. Change tracking tools (Phase 5 - if change tracking enabled)
  if (opts.includeChangeTracking) {
    const changeTools = generateChangeTrackingTools(context);
    tools.push(...changeTools.tools);
    Object.assign(handlers, changeTools.handlers);
  }

  // 6. Aggregation tools (Phase 5 - if enabled)
  if (opts.includeAggregations) {
    const aggTools = generateAggregationTools(context);
    tools.push(...aggTools.tools);
    Object.assign(handlers, aggTools.handlers);
  }

  // Count fields
  let searchableFieldsCount = 0;
  let computedFieldsCount = 0;
  for (const entity of context.entities) {
    searchableFieldsCount += entity.searchableFields.length;
    computedFieldsCount += entity.computedFields?.length ?? 0;
  }

  return {
    tools,
    handlers,
    metadata: {
      entityCount: context.entities.length,
      toolCount: tools.length,
      searchableFieldsCount,
      computedFieldsCount,
      generatedAt: new Date(),
      options: opts,
    },
  };
}

/**
 * Extract metadata from config
 */
function extractMetadata(config: RagForgeConfig): ToolGenerationContext {
  const entities: EntityMetadata[] = [];
  const allRelationships: RelationshipMetadata[] = [];
  const allVectorIndexes: VectorIndexMetadata[] = [];

  for (const entityConfig of config.entities) {
    const entityMeta = extractEntityMetadata(entityConfig);
    entities.push(entityMeta);

    // Collect all relationships
    for (const rel of entityMeta.relationships) {
      allRelationships.push(rel);
    }

    // Collect all vector indexes
    for (const vi of entityMeta.vectorIndexes) {
      allVectorIndexes.push(vi);
    }
  }

  return {
    entities,
    relationships: allRelationships,
    vectorIndexes: allVectorIndexes,
  };
}

/**
 * Extract entity metadata from entity config
 */
function extractEntityMetadata(entityConfig: EntityConfig): EntityMetadata {
  const uniqueField = entityConfig.unique_field || 'uuid';

  const searchableFields: FieldMetadata[] = entityConfig.searchable_fields.map(f => ({
    name: f.name,
    type: f.type,
    description: f.description,
    indexed: f.indexed,
    computed: false,
    values: f.values,  // For enum-type fields
  }));

  // Extract computed fields (Phase 3)
  const computedFields: ComputedFieldMetadata[] = (entityConfig.computed_fields || []).map(cf => ({
    name: cf.name,
    type: cf.type,
    description: cf.description,
    expression: cf.expression,
    cypher: cf.cypher,
    materialized: cf.materialized,
  }));

  // Extract vector indexes (support both legacy and new format)
  const vectorIndexes: VectorIndexMetadata[] = [];
  if (entityConfig.vector_indexes) {
    for (const vi of entityConfig.vector_indexes) {
      vectorIndexes.push({
        name: vi.name,
        entityType: entityConfig.name,
        sourceField: vi.source_field,
        dimension: vi.dimension,
        provider: vi.provider,
        model: vi.model,
      });
    }
  } else if (entityConfig.vector_index) {
    // Legacy single index
    const vi = entityConfig.vector_index;
    vectorIndexes.push({
      name: vi.name,
      entityType: entityConfig.name,
      sourceField: vi.source_field,
      dimension: vi.dimension,
      provider: vi.provider,
      model: vi.model,
    });
  }

  // Extract relationships
  const relationships: RelationshipMetadata[] = (entityConfig.relationships || []).map(r => ({
    type: r.type,
    sourceEntity: entityConfig.name,
    targetEntity: r.target,
    direction: r.direction,
    description: r.description,
  }));

  return {
    name: entityConfig.name,
    description: entityConfig.description,
    uniqueField,
    displayNameField: entityConfig.display_name_field || 'name',
    queryField: entityConfig.query_field || 'name',
    contentField: entityConfig.content_field,  // Full content field (e.g., 'source', 'body')
    exampleDisplayFields: entityConfig.example_display_fields,
    searchableFields,
    computedFields: computedFields.length > 0 ? computedFields : undefined,
    vectorIndexes,
    relationships,
    changeTracking: entityConfig.track_changes
      ? {
          enabled: true,
          contentField: entityConfig.change_tracking?.content_field || 'source',
        }
      : undefined,
    hierarchicalContent: entityConfig.hierarchical_content
      ? {
          childrenRelationship: entityConfig.hierarchical_content.children_relationship,
          includeChildren: entityConfig.hierarchical_content.include_children,
        }
      : undefined,
  };
}

// ============================================
// Tool Generators
// ============================================

/**
 * Generate query_entities tool with enhanced description
 */
function generateQueryEntitiesTool(context: ToolGenerationContext): GeneratedToolDefinition {
  const entityNames = context.entities.map(e => e.name);

  // Build field documentation per entity
  const fieldDocs = context.entities.map(entity => {
    const searchableFieldsStr = entity.searchableFields.map(field => {
      const uniqueTag = field.name === entity.uniqueField ? ' [UNIQUE FIELD]' : '';
      return `  * ${field.name} (${field.type}) - ${field.description || ''}${uniqueTag}`;
    }).join('\n');

    // Add computed fields if present (read-only, can be used in ORDER BY)
    const computedFieldsStr = entity.computedFields && entity.computedFields.length > 0
      ? '\n  Computed fields (read-only, can be used in ORDER BY):\n' +
        entity.computedFields.map(cf => {
          const materializedTag = cf.materialized ? ' [CACHED]' : '';
          return `  * ${cf.name} (${cf.type}) - ${cf.description || ''}${materializedTag}`;
        }).join('\n')
      : '';

    return `- ${entity.name}:\n${searchableFieldsStr}${computedFieldsStr}`;
  }).join('\n\n');

  // Build unique field documentation
  const uniqueFieldDocs = context.entities.map(e =>
    `- ${e.name}: ${e.uniqueField} (string)`
  ).join('\n');

  const description = `Query entities from the database with flexible conditions.

Available entities: ${entityNames.join(', ')}

Entity unique identifiers:
${uniqueFieldDocs}

Searchable/Orderable fields per entity:
${fieldDocs}

Operators:
- Comparison: =, !=, >, >=, <, <=
- String matching:
  * CONTAINS - Substring match (case-sensitive)
  * STARTS WITH - Prefix match
  * ENDS WITH - Suffix match
  * REGEX - Full regex pattern (e.g., ".*Service$", "^Auth.*")
  * GLOB - Shell-style wildcards (e.g., "*Service", "Auth*", "?ame")
    - * matches any sequence of characters
    - ? matches any single character
    - [abc] matches any character in brackets
- List: IN - Check if value is in list

Examples:
- Find classes: {field: "type", operator: "=", value: "class"}
- Find auth files: {field: "file", operator: "GLOB", value: "*auth*"}
- Find services: {field: "name", operator: "REGEX", value: ".*Service$"}
- Find specific scopes: {field: "name", operator: "IN", value: ["AuthService", "UserService"]}

You can ORDER BY any searchable field or computed field (ASC or DESC).`;

  return {
    name: 'query_entities',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: entityNames,
          description: 'Entity type to query',
        },
        conditions: {
          type: 'array',
          description: 'WHERE conditions to filter results',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Field name' },
              operator: {
                type: 'string',
                enum: ['=', '!=', '>', '>=', '<', '<=', 'CONTAINS', 'STARTS WITH', 'ENDS WITH', 'REGEX', 'GLOB', 'IN'],
                description: 'Comparison operator. Use REGEX for regex patterns, GLOB for shell-style wildcards (* and ?)',
              },
              value: { description: 'Value to compare' },
            },
            required: ['field', 'operator', 'value'],
          },
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10, max: 50)',
          default: 10,
        },
        order_by: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            direction: { type: 'string', enum: ['ASC', 'DESC'] },
          },
        },
      },
      required: ['entity_type'],
    },
  };
}

/**
 * Generate semantic_search tool with enhanced description
 */
function generateSemanticSearchTool(context: ToolGenerationContext): GeneratedToolDefinition {
  // Group vector indexes by entity
  const entitiesWithIndexes = new Set(context.vectorIndexes.map(vi => vi.entityType));
  const entityNames = Array.from(entitiesWithIndexes);

  // Build vector index documentation
  const indexDocs = context.entities
    .filter(e => e.vectorIndexes.length > 0)
    .map(entity => {
      const indexes = entity.vectorIndexes.map(vi =>
        `${vi.name} (field: ${vi.sourceField})`
      ).join(', ');
      return `- ${entity.name}: ${indexes}`;
    })
    .join('\n');

  // Build unique field documentation
  const uniqueFieldDocs = context.entities
    .filter(e => e.vectorIndexes.length > 0)
    .map(e => `- ${e.name}: ${e.uniqueField} (string)`)
    .join('\n');

  const description = `Semantic search using vector similarity.

IMPORTANT: Returns metadata + snippet only, NOT full content.
To get full content, use get_entities_by_ids with the returned IDs.

Available vector indexes:
${indexDocs}

Entity unique identifiers (for results):
${uniqueFieldDocs}

Results include:
- Unique identifier (use with get_entities_by_ids to fetch full content)
- Match score
- Short snippet (first 200 chars) from matched field

Workflow: semantic_search → get_entities_by_ids → answer with actual content`;

  return {
    name: 'semantic_search',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: entityNames,
          description: 'Entity type with vector index',
        },
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        top_k: { type: 'number', default: 5 },
        min_score: { type: 'number', default: 0.7 },
      },
      required: ['entity_type', 'query'],
    },
  };
}

/**
 * Generate explore_relationships tool with enhanced description
 */
function generateExploreRelationshipsTool(context: ToolGenerationContext): GeneratedToolDefinition {
  const entityNames = context.entities.map(e => e.name);
  const relationshipTypes = Array.from(new Set(context.relationships.map(r => r.type)));

  // Build relationship documentation (grouped by type)
  const relDocs: Record<string, string[]> = {};
  for (const rel of context.relationships) {
    if (!relDocs[rel.type]) {
      relDocs[rel.type] = [];
    }
    const dirSymbol = rel.direction === 'outgoing' ? '-->' : rel.direction === 'incoming' ? '<--' : '<-->';
    relDocs[rel.type].push(`  * ${rel.sourceEntity} ${dirSymbol}[${rel.type}]${dirSymbol} ${rel.targetEntity}`);
  }

  const relDocString = Object.entries(relDocs)
    .map(([type, lines]) => `- ${type}:\n${lines.join('\n')}`)
    .join('\n\n');

  // Build unique field documentation for all entities
  const uniqueFieldDocs = context.entities.map(e =>
    `- ${e.name}: ${e.uniqueField}`
  ).join('\n');

  const description = `Follow relationships between entities.

Available relationships (with directions and entity types):

${relDocString}

Entity unique identifiers:
${uniqueFieldDocs}

Navigate the graph to find connected entities.
Use 'outgoing' for forward direction, 'incoming' for reverse, 'both' for bidirectional.`;

  return {
    name: 'explore_relationships',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        start_entity_type: {
          type: 'string',
          enum: entityNames,
        },
        start_conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string' },
              value: {},
            },
          },
        },
        relationship_type: {
          type: 'string',
          enum: relationshipTypes,
        },
        direction: {
          type: 'string',
          enum: ['outgoing', 'incoming', 'both'],
          default: 'outgoing',
        },
        target_entity_type: {
          type: 'string',
          enum: entityNames,
        },
        limit: { type: 'number', default: 10 },
      },
      required: ['start_entity_type', 'relationship_type'],
    },
  };
}

/**
 * Generate get_entity_by_id tool with enhanced description
 */
function generateGetEntityByIdTool(context: ToolGenerationContext): GeneratedToolDefinition {
  const entityNames = context.entities.map(e => e.name);

  // Build unique field documentation with examples
  const uniqueFieldDocs = context.entities.map(e => {
    const examples: Record<string, string> = {
      uuid: 'UUID assigned during ingestion',
      path: 'Absolute file path',
      name: 'Entity name',
    };
    const exampleText = examples[e.uniqueField] || 'Unique identifier';
    return `- ${e.name}: ${e.uniqueField} (string) - ${exampleText}`;
  }).join('\n');

  const description = `Get full entity details by unique identifier.

Entity unique identifiers:
${uniqueFieldDocs}

Use this when you have a unique identifier from another query result.
Returns complete entity with all properties.`;

  return {
    name: 'get_entity_by_id',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: entityNames,
        },
        id_value: {
          type: 'string',
          description: 'Value of the unique identifier',
        },
      },
      required: ['entity_type', 'id_value'],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

/**
 * Generate handler for query_entities
 */
function generateQueryEntitiesHandler(context: ToolGenerationContext): ToolHandlerGenerator {
  return (rag: any) => async (params: any) => {
    const { entity_type, conditions = [], limit = 10, order_by } = params;

    const entityMeta = context.entities.find(e => e.name === entity_type);
    if (!entityMeta) {
      return { error: `Unknown entity: ${entity_type}` };
    }

    let query = rag.get(entity_type);

    // Apply WHERE conditions
    // Note: QueryBuilder should support these operators:
    // - Basic: =, !=, >, >=, <, <=
    // - String: CONTAINS, STARTS WITH, ENDS WITH
    // - Pattern: REGEX (Neo4j =~), GLOB (converted to regex)
    // - List: IN
    for (const condition of conditions) {
      query = query.where(condition.field, condition.operator, condition.value);
    }

    if (order_by) {
      query = query.orderBy(order_by.field, order_by.direction || 'ASC');
    }

    query = query.limit(Math.min(limit, 50));
    const results = await query.execute();

    return {
      entity_type,
      count: results.length,
      unique_field: entityMeta.uniqueField,
      results: results.map((r: any) => {
        const filtered: any = {};
        for (const [k, v] of Object.entries(r)) {
          if (!k.includes('embedding') && k !== 'source' && v !== undefined) {
            filtered[k] = v;
          }
        }
        return filtered;
      }),
    };
  };
}

/**
 * Generate handler for semantic_search
 */
function generateSemanticSearchHandler(context: ToolGenerationContext): ToolHandlerGenerator {
  return (rag: any) => async (params: any) => {
    const { entity_type, query, top_k = 5, min_score = 0.7 } = params;

    const entityMeta = context.entities.find(e => e.name === entity_type);
    if (!entityMeta) {
      return { error: `Unknown entity: ${entity_type}` };
    }

    const vectorIndex = entityMeta.vectorIndexes[0];
    if (!vectorIndex) {
      return { error: `No vector index for ${entity_type}` };
    }

    try {
      const queryBuilder = rag.get(entity_type).semanticSearch(vectorIndex.name, query, {
        topK: Math.min(top_k, 20),
        minScore: min_score,
      });

      const results = await queryBuilder.execute();

      return {
        entity_type,
        query,
        count: results.length,
        index_used: vectorIndex.name,
        unique_field: entityMeta.uniqueField,
        results: results.map((r: any) => ({
          [entityMeta.uniqueField]: r[entityMeta.uniqueField],
          name: r.name || r.path || 'N/A',
          type: r.type,
          file: r.file,
          score: r.score?.toFixed(3),
          snippet: r[vectorIndex.sourceField]?.substring(0, 200),
        })),
      };
    } catch (error: any) {
      // Detect missing vector index error and provide actionable guidance
      if (error.message?.includes('no such vector schema index') ||
          error.message?.includes('There is no such vector schema index')) {
        return {
          error: `Embeddings not found for index "${vectorIndex.name}". ` +
                 `Please use the "generate_embeddings" tool first to create vector indexes and generate embeddings for this project. ` +
                 `This only needs to be done once per project.`,
          suggestion: 'generate_embeddings',
          index_missing: vectorIndex.name,
        };
      }
      // Re-throw other errors
      throw error;
    }
  };
}

/**
 * Generate handler for explore_relationships
 */
function generateExploreRelationshipsHandler(context: ToolGenerationContext): ToolHandlerGenerator {
  return (rag: any) => async (params: any) => {
    const {
      start_entity_type,
      start_conditions = [],
      relationship_type,
      direction = 'outgoing',
      target_entity_type,
      limit = 10,
    } = params;

    const startMeta = context.entities.find(e => e.name === start_entity_type);
    if (!startMeta) {
      return { error: `Unknown entity: ${start_entity_type}` };
    }

    let query = rag.get(start_entity_type);

    for (const condition of start_conditions) {
      query = query.where(condition.field, condition.operator, condition.value);
    }

    query = query.getRelationship(relationship_type, direction, target_entity_type);
    query = query.limit(Math.min(limit, 50));

    const results = await query.execute();

    const targetMeta = target_entity_type
      ? context.entities.find(e => e.name === target_entity_type)
      : null;
    const targetUniqueField = targetMeta?.uniqueField || 'uuid';

    return {
      count: results.length,
      relationship: `${start_entity_type} -[${relationship_type}:${direction}]-> ${target_entity_type || 'Any'}`,
      target_unique_field: targetUniqueField,
      results: results.map((r: any) => {
        const filtered: any = {};
        for (const [k, v] of Object.entries(r)) {
          if (!k.includes('embedding') && k !== 'source' && v !== undefined) {
            filtered[k] = v;
          }
        }
        return filtered;
      }),
    };
  };
}

/**
 * Generate handler for get_entity_by_id
 */
function generateGetEntityByIdHandler(context: ToolGenerationContext): ToolHandlerGenerator {
  return (rag: any) => async (params: any) => {
    const { entity_type, id_value } = params;

    const entityMeta = context.entities.find(e => e.name === entity_type);
    if (!entityMeta) {
      return { error: `Unknown entity: ${entity_type}` };
    }

    const results = await rag
      .get(entity_type)
      .where(entityMeta.uniqueField, '=', id_value)
      .limit(1)
      .execute();

    if (results.length === 0) {
      return { error: `Not found: ${entity_type} with ${entityMeta.uniqueField}=${id_value}` };
    }

    const entity = results[0];
    const filtered: any = {};
    for (const [k, v] of Object.entries(entity)) {
      if (!k.includes('embedding')) {
        filtered[k] = v;
      }
    }

    return {
      entity_type,
      unique_field: entityMeta.uniqueField,
      ...filtered,
    };
  };
}

/**
 * Generate get_entities_by_ids tool (batch fetch)
 */
function generateGetEntitiesByIdsTool(context: ToolGenerationContext): GeneratedToolDefinition {
  const entityNames = context.entities.map(e => e.name);

  // Build field documentation per entity
  const fieldDocs = context.entities.map(entity => {
    const allFields = entity.searchableFields.map(f => f.name);
    const contentFieldNote = entity.contentField
      ? ` (content_field: ${entity.contentField})`
      : '';
    return `- ${entity.name}: ${allFields.join(', ')}${contentFieldNote}`;
  }).join('\n');

  // Build default fields documentation
  const defaultFieldsDocs = context.entities.map(entity => {
    const defaults = [entity.uniqueField, entity.displayNameField];
    if (entity.contentField) defaults.push(entity.contentField);
    return `- ${entity.name}: ${defaults.join(', ')}`;
  }).join('\n');

  // Build hierarchical content documentation
  const hierarchicalDocs = context.entities
    .filter(e => e.hierarchicalContent)
    .map(e => `- ${e.name}: use with_children=true to also fetch children (via ${e.hierarchicalContent!.childrenRelationship})`)
    .join('\n');

  let description = `Fetch multiple entities by their IDs in a single query.

Use this to get full content after semantic_search returns only snippets.

Available entities: ${entityNames.join(', ')}

Available fields per entity:
${fieldDocs}

Default fields returned (if 'fields' not specified):
${defaultFieldsDocs}`;

  if (hierarchicalDocs) {
    description += `

HIERARCHICAL CONTENT (use with_children=true for complete content):
${hierarchicalDocs}`;
  }

  description += `

Example workflow:
1. semantic_search → returns IDs + snippets
2. get_entities_by_ids with those IDs → returns full content
3. If content is short and entity has children, use with_children=true`;

  return {
    name: 'get_entities_by_ids',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: entityNames,
          description: 'Entity type to fetch',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of unique IDs to fetch (from previous query results)',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: specific fields to return. If omitted, returns unique_field + display_name_field + content_field',
        },
        with_children: {
          type: 'boolean',
          description: 'If true, also fetch children entities (for hierarchical content like classes with methods). Children content will be included in the response.',
        },
      },
      required: ['entity_type', 'ids'],
    },
  };
}

/**
 * Generate handler for get_entities_by_ids
 */
function generateGetEntitiesByIdsHandler(context: ToolGenerationContext): ToolHandlerGenerator {
  return (rag: any) => async (params: any) => {
    const { entity_type, ids, fields, with_children } = params;

    const entityMeta = context.entities.find(e => e.name === entity_type);
    if (!entityMeta) {
      return { error: `Unknown entity: ${entity_type}` };
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { error: 'ids must be a non-empty array' };
    }

    // Limit batch size
    const limitedIds = ids.slice(0, 20);

    // Execute query with IN operator
    const results = await rag
      .get(entity_type)
      .where(entityMeta.uniqueField, 'IN', limitedIds)
      .limit(limitedIds.length)
      .execute();

    // Determine which fields to return
    let requestedFields: string[];
    if (fields && Array.isArray(fields) && fields.length > 0) {
      // Always include unique field
      requestedFields = [entityMeta.uniqueField, ...fields.filter(f => f !== entityMeta.uniqueField)];
    } else {
      // Default: unique_field + display_name_field + content_field
      requestedFields = [entityMeta.uniqueField, entityMeta.displayNameField];
      if (entityMeta.contentField) {
        requestedFields.push(entityMeta.contentField);
      }
    }

    // Filter results to requested fields only
    const filteredResults = results.map((r: any) => {
      const filtered: any = {};
      for (const field of requestedFields) {
        if (r[field] !== undefined) {
          filtered[field] = r[field];
        }
      }
      return filtered;
    });

    // Fetch children if requested and hierarchical_content is configured
    let childrenByParent: Record<string, any[]> = {};
    if (with_children && entityMeta.hierarchicalContent) {
      const rel = entityMeta.hierarchicalContent.childrenRelationship;

      // Use Cypher to fetch children via relationship traversal
      // Children point TO parent via the relationship (e.g., method -[:HAS_PARENT]-> class)
      const cypher = `
        MATCH (child:${entity_type})-[:${rel}]->(parent:${entity_type})
        WHERE parent.${entityMeta.uniqueField} IN $parentIds
        RETURN child, parent.${entityMeta.uniqueField} as parentId
      `;

      try {
        const result = await rag.client.run(cypher, { parentIds: limitedIds });

        for (const record of result.records) {
          const child = record.get('child').properties;
          const parentId = record.get('parentId');

          // Filter child to requested fields
          const filtered: any = {};
          for (const field of requestedFields) {
            if (child[field] !== undefined) {
              filtered[field] = child[field];
            }
          }

          if (!childrenByParent[parentId]) {
            childrenByParent[parentId] = [];
          }
          childrenByParent[parentId].push(filtered);
        }
      } catch (error) {
        // If relationship query fails, just skip children
        console.error('Failed to fetch children:', error);
      }
    }

    // Check if content is short and hierarchical_content is available (hint for agent)
    let hint: string | undefined;
    if (!with_children && entityMeta.hierarchicalContent && entityMeta.contentField) {
      const shortContentThreshold = 100;
      const hasShortContent = filteredResults.some((r: any) => {
        const content = r[entityMeta.contentField!];
        return content && typeof content === 'string' && content.length < shortContentThreshold;
      });

      if (hasShortContent) {
        hint = `Some entities have very short content. This entity type has hierarchical content - use with_children=true to also fetch children (via ${entityMeta.hierarchicalContent.childrenRelationship}) for complete content.`;
      }
    }

    const response: any = {
      entity_type,
      unique_field: entityMeta.uniqueField,
      content_field: entityMeta.contentField,
      requested_ids: limitedIds.length,
      found: filteredResults.length,
      fields_returned: requestedFields,
      results: filteredResults,
    };

    // Add children to response if fetched
    if (with_children && Object.keys(childrenByParent).length > 0) {
      response.children_by_parent = childrenByParent;
      response.total_children = Object.values(childrenByParent).reduce((sum, arr) => sum + arr.length, 0);
    }

    // Add hint if applicable
    if (hint) {
      response.hint = hint;
    }

    return response;
  };
}

/**
 * Generate glob_search tool (pattern matching on any field)
 */
function generateGlobSearchTool(context: ToolGenerationContext): GeneratedToolDefinition {
  const entityNames = context.entities.map(e => e.name);

  // Build field documentation per entity
  const fieldDocs = context.entities.map(entity => {
    const stringFields = entity.searchableFields
      .filter(f => f.type === 'string')
      .map(f => f.name);
    return `- ${entity.name}: ${stringFields.join(', ')}`;
  }).join('\n');

  const description = `Search entities using glob/wildcard patterns on any string field.

Pattern syntax:
- * matches any sequence of characters
- ** matches any sequence including path separators (for file paths)
- ? matches any single character
- [abc] matches any character in brackets
- [a-z] matches character range

Examples:
- glob_search("Scope", "file", "**/chains/*.ts") - find scopes in chains directories
- glob_search("Scope", "name", "*Service") - find scopes ending with "Service"
- glob_search("Scope", "file", "libs/langchain-core/**") - find scopes in a specific package

Available entities and string fields:
${fieldDocs}

Use this for quick pattern-based filtering. Combine with semantic_search for best results.`;

  return {
    name: 'glob_search',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: entityNames,
          description: 'Entity type to search',
        },
        field: {
          type: 'string',
          description: 'String field to match against (e.g., "file", "name")',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to match (e.g., "**/chains/*.ts", "*Service")',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 50)',
          default: 20,
        },
      },
      required: ['entity_type', 'field', 'pattern'],
    },
  };
}

/**
 * Convert glob pattern to regex for Neo4j =~ operator
 */
function globToRegexSimple(pattern: string): string {
  // Escape regex special chars except glob chars
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')     // Temp placeholder for **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/<<<GLOBSTAR>>>/g, '.*')       // ** matches anything including /
    .replace(/\?/g, '.');                   // ? matches single char

  // Make it match the whole string
  return `(?i)${regex}`;  // (?i) for case-insensitive
}

/**
 * Generate handler for glob_search
 */
function generateGlobSearchHandler(context: ToolGenerationContext): ToolHandlerGenerator {
  return (rag: any) => async (params: any) => {
    const { entity_type, field, pattern, limit = 20 } = params;

    const entityMeta = context.entities.find(e => e.name === entity_type);
    if (!entityMeta) {
      return { error: `Unknown entity: ${entity_type}` };
    }

    // Validate field exists and is a string type
    const fieldMeta = entityMeta.searchableFields.find(f => f.name === field);
    if (!fieldMeta) {
      const validFields = entityMeta.searchableFields.map(f => f.name).join(', ');
      return { error: `Unknown field "${field}" for ${entity_type}. Valid fields: ${validFields}` };
    }
    if (fieldMeta.type !== 'string') {
      return { error: `Field "${field}" is not a string field. Glob patterns only work on string fields.` };
    }

    // Convert glob to regex
    const regexPattern = globToRegexSimple(pattern);

    // Execute raw Cypher query
    const cypher = `
      MATCH (n:${entity_type})
      WHERE n.${field} =~ $pattern
      RETURN n
      LIMIT $limit
    `;

    try {
      const result = await rag.raw(cypher, {
        pattern: regexPattern,
        limit: Math.min(limit, 50)
      });

      const results = result.records.map((record: any) => {
        const node = record.get('n');
        const filtered: any = {};
        for (const [k, v] of Object.entries(node.properties)) {
          if (!k.includes('embedding') && k !== 'source') {
            filtered[k] = v;
          }
        }
        return filtered;
      });

      return {
        entity_type,
        field,
        pattern,
        regex_used: regexPattern,
        count: results.length,
        unique_field: entityMeta.uniqueField,
        results,
      };
    } catch (err: any) {
      return { error: `Query failed: ${err.message}` };
    }
  };
}
