/**
 * Code Generator
 *
 * Generates TypeScript client code from RagForge config and Neo4j schema
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RagForgeConfig,
  EntityConfig,
  EmbeddingsConfig
} from '../types/config.js';
import type { GraphSchema } from '../types/schema.js';
import { generateToolsFromConfig } from '../tools/tool-generator.js';

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../templates'
);

const TEMPLATE_CACHE = new Map<string, string>();

function loadTemplate(relativePath: string): string {
  const fullPath = path.join(TEMPLATE_DIR, relativePath);
  const cached = TEMPLATE_CACHE.get(fullPath);
  if (cached) {
    return cached;
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load template "${relativePath}" from ${fullPath}: ${message}`);
  }

  TEMPLATE_CACHE.set(fullPath, content);
  return content;
}

export interface GeneratedCode {
  queries: Map<string, string>;  // entity name -> query builder code
  mutations: Map<string, string>; // entity name -> mutation builder code (NEW)
  client: string;                // main client code
  index: string;                 // index.ts exports
  agent: string;                 // iterative agent wrapper
  configLoader: string;          // Generic config loader for scripts
  entityContexts: string;        // EntityContext definitions for all entities
  patterns: string;              // Common query patterns for better DX
  quickstart: string;            // QUICKSTART.md guide for developers
  agentDocumentation: {
    markdown: string;            // Simplified markdown for agent prompt
    module: string;              // TypeScript module exporting agent documentation string
  };
  developerDocumentation: {
    markdown: string;            // Complete markdown for developers
  };
  embeddings?: {
    loader: string;
    createIndexesScript: string;
    generateEmbeddingsScript: string;
  };
  summarization?: {
    prompts: Map<string, string>; // template name -> template content
    generateSummariesScript: string;
  };
  scripts?: {
    ingestFromSource?: string;   // Script to ingest code from source paths
    setup?: string;               // Orchestrator script: ingest → indexes → embeddings → summaries
    cleanDb?: string;             // Script to clean the database
    watch?: string;               // Script to watch files and auto-ingest changes
    changeStats?: string;         // Script to analyze change history statistics
  };
  examples: Map<string, string>; // example name -> TypeScript example code
  rebuildAgentScript: string;    // Script to rebuild agent documentation
  tools?: {
    databaseTools: string;       // Auto-generated tools (DO NOT EDIT marker)
    customTools: string;         // User-editable tools (preserved across regeneration)
    index: string;               // Combines both and exports setupToolRegistry
  };
  text2cypher: string;           // Natural language to Cypher query script
}

export class CodeGenerator {
  /**
   * Get entity field mappings with smart defaults
   */
  private static getDisplayNameField(entity: EntityConfig): string {
    return entity.display_name_field || 'name';
  }

  private static getUniqueField(entity: EntityConfig): string {
    return entity.unique_field || 'uuid';
  }

  private static getQueryField(entity: EntityConfig): string {
    return entity.query_field || 'name';
  }

  private static getExampleDisplayFields(entity: EntityConfig): string[] {
    return entity.example_display_fields || [];
  }

  /**
   * Build display code for examples (entity display with optional fields)
   * @param entity - Entity config
   * @param includeScore - Whether to include score in display (default: false)
   * @returns JavaScript code string for displaying entity
   */
  private static buildEntityDisplayCode(entity: EntityConfig, includeScore: boolean = false): string {
    const displayNameField = this.getDisplayNameField(entity);
    const displayFields = this.getExampleDisplayFields(entity);

    // Build parts array for concatenation
    const parts: string[] = [`'  - ' + entity.${displayNameField}`];

    for (const field of displayFields) {
      parts.push(`(entity.${field} ? ' (in ' + entity.${field} + ')' : '')`);
    }

    if (includeScore) {
      parts.push(`': ' + r.score.toFixed(3)`);
    }

    return `console.log(${parts.join(' + ')});`;
  }

  /**
   * Generate complete client code from config and schema
   */
  static generate(config: RagForgeConfig, schema: GraphSchema): GeneratedCode {
    const queries = new Map<string, string>();
    const mutations = new Map<string, string>();

    // Generate query builder and mutation builder for each entity
    for (const entity of config.entities) {
      const queryCode = this.generateQueryBuilder(entity, config);
      queries.set(entity.name.toLowerCase(), queryCode);

      const mutationCode = this.generateMutationBuilder(entity, config);
      mutations.set(entity.name.toLowerCase(), mutationCode);
    }

    // Generate main client
    const client = this.generateClient(config, schema);

    // Generate index exports
    const index = this.generateIndex(config);

    // Generate entity contexts module
    const entityContexts = this.generateEntityContextsModule(config, schema);

    // Generate common patterns module
    const patterns = this.generatePatternsModule(config, schema);

    // Generate quickstart guide
    const quickstart = this.generateQuickstart(config, schema);

    // Generate examples
    const { examples, exampleSummaries } = this.generateExamples(config, schema);

    // Generate two documentations
    const agentMarkdown = this.generateAgentDocumentation(config, schema, exampleSummaries);
    const agentModule = this.generateDocumentationModule(agentMarkdown);
    const developerMarkdown = this.generateDeveloperDocumentation(config, schema, exampleSummaries);

    const agent = this.generateAgent(config);
    const embeddingsArtifacts = this.generateEmbeddingsArtifacts(config.embeddings);
    const summarizationArtifacts = this.generateSummarizationArtifacts(config);
    const sourceScripts = this.generateSourceScripts(config);

    // Load templates
    const rebuildAgentScript = loadTemplate('rebuild-agent.ts');
    const configLoader = loadTemplate('load-config.ts');

    // Generate tools (Phase 2: Tool Generation)
    const tools = this.generateToolsArtifacts(config);

    // Generate text2cypher script
    const text2cypher = this.generateText2Cypher(config, schema);

    return {
      queries,
      mutations,
      client,
      index,
      agent,
      configLoader,
      entityContexts,
      patterns,
      quickstart,
      agentDocumentation: {
        markdown: agentMarkdown,
        module: agentModule
      },
      developerDocumentation: {
        markdown: developerMarkdown
      },
      embeddings: embeddingsArtifacts,
      summarization: summarizationArtifacts,
      scripts: sourceScripts,
      examples,
      rebuildAgentScript,
      tools,
      text2cypher
    };
  }

  /**
   * Generate query builder class for an entity
   */
  private static generateQueryBuilder(entity: EntityConfig, config: RagForgeConfig): string {
    const lines: string[] = [];

    // Imports
    lines.push(`import { QueryBuilder } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import type { ${entity.name}, ${entity.name}Filter } from '../types.js';`);
    lines.push(``);

    // Class declaration
    lines.push(`/**`);
    lines.push(` * Query builder for ${entity.name} entities`);
    if (entity.description) {
      lines.push(` * ${entity.description}`);
    }
    lines.push(` */`);
    lines.push(`export class ${entity.name}Query extends QueryBuilder<${entity.name}> {`);

    // Override where() with typed filter
    lines.push(`  /**`);
    lines.push(`   * Filter ${entity.name} entities by field values`);
    lines.push(`   */`);
    lines.push(`  where(filter: ${entity.name}Filter): this {`);
    lines.push(`    return super.where(filter);`);
    lines.push(`  }`);
    lines.push(``);

    // Generate convenience methods for each searchable field
    for (const field of entity.searchable_fields) {
      lines.push(...this.generateFieldMethod(entity.name, field));
    }

    // Generate semantic search methods for vector indexes
    const vectorIndexes = entity.vector_indexes || (entity.vector_index ? [entity.vector_index] : []);

    for (const vectorIndex of vectorIndexes) {
      lines.push(...this.generateSemanticSearchMethod(entity.name, vectorIndex));
    }

    // Generate relationship methods
    if (entity.relationships) {
      for (const rel of entity.relationships) {
        lines.push(...this.generateRelationshipMethod(rel));
        // Generate inverse method if relationship is directional
        if (rel.direction !== 'both') {
          lines.push(...this.generateInverseRelationshipMethod(rel));
        }
      }
    }

    // Generate reranking methods
    if (config.reranking?.strategies) {
      for (const strategy of config.reranking.strategies) {
        lines.push(...this.generateRerankMethod(strategy));
      }
    }

    // Generate temporal filtering methods (if change tracking enabled)
    if (entity.track_changes || config.source?.track_changes) {
      lines.push(...this.generateTemporalMethods(entity.name));
    }

    // Generate helper methods for better DX
    lines.push(`  /**`);
    lines.push(`   * Get the first result or undefined`);
    lines.push(`   * @example`);
    lines.push(`   * const result = await query.first();`);
    lines.push(`   */`);
    lines.push(`  async first(): Promise<import('@luciformresearch/ragforge-runtime').SearchResult<${entity.name}> | undefined> {`);
    lines.push(`    const results = await this.limit(1).execute();`);
    lines.push(`    return results[0];`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`  /**`);
    lines.push(`   * Extract a single field from all results`);
    lines.push(`   * @example`);
    lines.push(`   * const names = await query.pluck('${this.getDisplayNameField(entity)}');`);
    lines.push(`   */`);
    lines.push(`  async pluck<K extends keyof ${entity.name}>(field: K): Promise<${entity.name}[K][]> {`);
    lines.push(`    const results = await this.execute();`);
    lines.push(`    return results.map(r => r.entity[field]);`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`  /**`);
    lines.push(`   * Count the total number of results`);
    lines.push(`   * @example`);
    lines.push(`   * const total = await query.count();`);
    lines.push(`   */`);
    lines.push(`  async count(): Promise<number> {`);
    lines.push(`    const results = await this.execute();`);
    lines.push(`    return results.length;`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`  /**`);
    lines.push(`   * Show the generated Cypher query for debugging`);
    lines.push(`   * @example`);
    lines.push(`   * console.log(query.debug());`);
    lines.push(`   */`);
    lines.push(`  debug(): string {`);
    lines.push(`    const built = this.buildCypher();`);
    lines.push(`    return \`Cypher Query:\\n\${built.query}\\n\\nParameters:\\n\${JSON.stringify(built.params, null, 2)}\`;`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Generate mutation builder class for an entity
   */
  private static generateMutationBuilder(entity: EntityConfig, config: RagForgeConfig): string {
    const lines: string[] = [];
    const className = `${entity.name}Mutations`;
    const uniqueField = entity.unique_field || 'uuid';
    const displayNameField = entity.display_name_field || 'name';

    // Imports
    lines.push(`import { MutationBuilder } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import type { ${entity.name}, ${entity.name}Create, ${entity.name}Update } from '../types.js';`);
    lines.push(``);

    // Class declaration
    lines.push(`/**`);
    lines.push(` * Mutation operations for ${entity.name} entities`);
    if (entity.description) {
      lines.push(` * ${entity.description}`);
    }
    lines.push(` */`);
    lines.push(`export class ${className} extends MutationBuilder<${entity.name}> {`);
    lines.push(``);

    // Override create() with entity-specific types
    lines.push(`  /**`);
    lines.push(`   * Create a new ${entity.name}`);
    lines.push(`   * @param data - ${entity.name} data (must include ${uniqueField})`);
    lines.push(`   * @returns The created ${entity.name}`);
    lines.push(`   */`);
    lines.push(`  async create(data: ${entity.name}Create): Promise<${entity.name}> {`);
    lines.push(`    return super.create(data);`);
    lines.push(`  }`);
    lines.push(``);

    // Override createBatch()
    lines.push(`  /**`);
    lines.push(`   * Create multiple ${entity.name} entities in a single transaction`);
    lines.push(`   * @param items - Array of ${entity.name} data`);
    lines.push(`   * @returns Array of created ${entity.name} entities`);
    lines.push(`   */`);
    lines.push(`  async createBatch(items: ${entity.name}Create[]): Promise<${entity.name}[]> {`);
    lines.push(`    return super.createBatch(items);`);
    lines.push(`  }`);
    lines.push(``);

    // Override update()
    lines.push(`  /**`);
    lines.push(`   * Update an existing ${entity.name}`);
    lines.push(`   * @param ${uniqueField} - Unique identifier`);
    lines.push(`   * @param data - Fields to update`);
    lines.push(`   * @returns The updated ${entity.name}`);
    lines.push(`   */`);
    lines.push(`  async update(${uniqueField}: string, data: ${entity.name}Update): Promise<${entity.name}> {`);
    lines.push(`    return super.update(${uniqueField}, data);`);
    lines.push(`  }`);
    lines.push(``);

    // Override delete()
    lines.push(`  /**`);
    lines.push(`   * Delete a ${entity.name} by ${uniqueField}`);
    lines.push(`   * @param ${uniqueField} - Unique identifier`);
    lines.push(`   */`);
    lines.push(`  async delete(${uniqueField}: string): Promise<void> {`);
    lines.push(`    return super.delete(${uniqueField});`);
    lines.push(`  }`);
    lines.push(``);

    // Generate typed relationship methods
    if (entity.relationships && entity.relationships.length > 0) {
      for (const rel of entity.relationships) {
        const methodName = this.camelCase(`add_${rel.type}`);
        const removeMethodName = this.camelCase(`remove_${rel.type}`);
        const targetType = rel.target;
        const targetUniqueField = 'uuid'; // Default, could be made configurable per relationship

        // Add relationship method
        lines.push(`  /**`);
        lines.push(`   * Add ${rel.type} relationship to ${targetType}`);
        if (rel.description) {
          lines.push(`   * ${rel.description}`);
        }
        lines.push(`   * @param ${uniqueField} - Source ${entity.name} unique identifier`);
        lines.push(`   * @param target${targetType}${this.capitalize(targetUniqueField)} - Target ${targetType} unique identifier`);
        if (rel.properties && rel.properties.length > 0) {
          lines.push(`   * @param properties - Relationship properties`);
        }
        lines.push(`   */`);

        const hasProperties = rel.properties && rel.properties.length > 0;
        const propertiesParam = hasProperties ? `, properties?: Record<string, any>` : '';

        lines.push(`  async ${methodName}(${uniqueField}: string, target${targetType}${this.capitalize(targetUniqueField)}: string${propertiesParam}): Promise<void> {`);
        lines.push(`    return this.addRelationship(${uniqueField}, {`);
        lines.push(`      type: '${rel.type}',`);
        lines.push(`      target: target${targetType}${this.capitalize(targetUniqueField)},`);

        // Only add targetLabel if different from source entity
        if (targetType !== entity.name) {
          lines.push(`      targetLabel: '${targetType}',`);
        }

        if (hasProperties) {
          lines.push(`      properties`);
        }
        lines.push(`    });`);
        lines.push(`  }`);
        lines.push(``);

        // Remove relationship method
        lines.push(`  /**`);
        lines.push(`   * Remove ${rel.type} relationship to ${targetType}`);
        lines.push(`   * @param ${uniqueField} - Source ${entity.name} unique identifier`);
        lines.push(`   * @param target${targetType}${this.capitalize(targetUniqueField)} - Target ${targetType} unique identifier`);
        lines.push(`   */`);
        lines.push(`  async ${removeMethodName}(${uniqueField}: string, target${targetType}${this.capitalize(targetUniqueField)}: string): Promise<void> {`);
        lines.push(`    return this.removeRelationship(${uniqueField}, {`);
        lines.push(`      type: '${rel.type}',`);
        lines.push(`      target: target${targetType}${this.capitalize(targetUniqueField)}${targetType !== entity.name ? `,\n      targetLabel: '${targetType}'` : ''}`);
        lines.push(`    });`);
        lines.push(`  }`);
        lines.push(``);
      }
    }

    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Generate convenience method for a field
   */
  private static generateFieldMethod(entityName: string, field: any): string[] {
    const lines: string[] = [];
    const methodName = `where${this.capitalize(field.name)}`;
    const methodNameIn = `where${this.capitalize(field.name)}In`;

    // Generate single value method
    lines.push(`  /**`);
    lines.push(`   * Filter by ${field.name}`);
    if (field.description) {
      lines.push(`   * ${field.description}`);
    }
    lines.push(`   */`);

    if (field.type === 'string') {
      // String field with operators
      lines.push(`  ${methodName}(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {`);
      lines.push(`    return this.where({ ${field.name}: value } as any);`);
    } else if (field.type === 'number') {
      // Number field with operators
      lines.push(`  ${methodName}(value: number | { gt?: number; gte?: number; lt?: number; lte?: number }): this {`);
      lines.push(`    return this.where({ ${field.name}: value } as any);`);
    } else if (field.type === 'enum' && field.values) {
      // Enum field with specific values
      const enumType = field.values.map((v: string) => `'${v}'`).join(' | ');
      lines.push(`  ${methodName}(value: ${enumType}): this {`);
      lines.push(`    return this.where({ ${field.name}: value } as any);`);
    } else {
      // Generic field
      lines.push(`  ${methodName}(value: any): this {`);
      lines.push(`    return this.where({ ${field.name}: value } as any);`);
    }

    lines.push(`  }`);
    lines.push(``);

    // Generate batch method (whereIn) - completely generic
    lines.push(`  /**`);
    lines.push(`   * Filter by ${field.name} matching any value in the array (batch query)`);
    lines.push(`   * @example`);
    lines.push(`   * .${methodNameIn}(['value1', 'value2', 'value3'])`);
    lines.push(`   */`);

    if (field.type === 'string') {
      lines.push(`  ${methodNameIn}(values: string[]): this {`);
    } else if (field.type === 'number') {
      lines.push(`  ${methodNameIn}(values: number[]): this {`);
    } else if (field.type === 'enum' && field.values) {
      const enumType = field.values.map((v: string) => `'${v}'`).join(' | ');
      lines.push(`  ${methodNameIn}(values: (${enumType})[]): this {`);
    } else {
      lines.push(`  ${methodNameIn}(values: any[]): this {`);
    }

    lines.push(`    return this.whereIn('${field.name}', values);`);
    lines.push(`  }`);
    lines.push(``);

    return lines;
  }

  /**
   * Generate method for relationship traversal
   */
  private static generateRelationshipMethod(rel: any): string[] {
    const lines: string[] = [];
    const methodName = this.camelCase(`with_${rel.type}`);

    lines.push(`  /**`);
    lines.push(`   * Include related entities via ${rel.type} (${rel.direction})`);
    if (rel.description) {
      lines.push(`   * ${rel.description}`);
    }
    lines.push(`   */`);
    lines.push(`  ${methodName}(depth: number = 1): this {`);
    lines.push(`    return this.expand('${rel.type}', { depth });`);
    lines.push(`  }`);
    lines.push(``);

    if (rel.filters?.length) {
      for (const filter of rel.filters) {
        lines.push(...this.generateRelationshipFilterMethod(rel, filter));
      }
    }

    return lines;
  }

  /**
   * Generate inverse relationship method (traversal in opposite direction)
   * Completely generic - works for any relationship type
   */
  private static generateInverseRelationshipMethod(rel: any): string[] {
    const lines: string[] = [];
    const inverseMethodName = this.camelCase(`reversed_${rel.type}`);
    const inverseDirection = rel.direction === 'outgoing' ? 'incoming' : 'outgoing';

    lines.push(`  /**`);
    lines.push(`   * Include related entities via ${rel.type} in reverse direction (${inverseDirection})`);
    lines.push(`   * This traverses the relationship in the opposite direction from ${rel.direction}`);
    if (rel.description) {
      lines.push(`   * Inverse of: ${rel.description}`);
    }
    lines.push(`   * @example`);
    lines.push(`   * // Find entities that have this relationship TO the current entity`);
    lines.push(`   * .${inverseMethodName}(1)`);
    lines.push(`   */`);
    lines.push(`  ${inverseMethodName}(depth: number = 1): this {`);
    lines.push(`    return this.expand('${rel.type}', { depth, direction: '${inverseDirection}' });`);
    lines.push(`  }`);
    lines.push(``);

    return lines;
  }

  private static generateRelationshipFilterMethod(rel: any, filter: any): string[] {
    const lines: string[] = [];
    const methodName = filter.name;
    const paramName = filter.parameter || 'entityName';
    const direction = filter.direction || 'outgoing';
    const targetType = rel.target || '';

    lines.push(`  /**`);
    if (filter.description) {
      lines.push(`   * ${filter.description}`);
    } else {
      const readableDirection = direction === 'incoming' ? 'incoming' : 'outgoing';
      lines.push(`   * Filter by ${rel.type} relationship (${readableDirection})`);
    }
    lines.push(`   */`);
    lines.push(`  ${methodName}(${paramName}: string): this {`);
    lines.push(`    return this.whereRelatedBy(${paramName}, '${rel.type}', '${direction}', '${targetType}');`);
    lines.push(`  }`);
    lines.push(``);

    return lines;
  }

  /**
   * Generate method for reranking strategy
   */
  private static generateRerankMethod(strategy: any): string[] {
    const lines: string[] = [];
    const methodName = this.camelCase(`rerank_by_${strategy.name}`);

    lines.push(`  /**`);
    lines.push(`   * Apply ${strategy.name} reranking strategy`);
    if (strategy.description) {
      lines.push(`   * ${strategy.description}`);
    }
    lines.push(`   */`);
    lines.push(`  ${methodName}(): this {`);
    lines.push(`    return this.rerank('${strategy.name}');`);
    lines.push(`  }`);
    lines.push(``);

    return lines;
  }

  /**
   * Generate temporal filtering methods for entities with change tracking
   */
  private static generateTemporalMethods(entityName: string): string[] {
    const lines: string[] = [];

    // modifiedSince method
    lines.push(`  /**`);
    lines.push(`   * Filter ${entityName} entities modified since a specific date`);
    lines.push(`   * Requires change tracking to be enabled`);
    lines.push(`   * @param date - Date to filter from`);
    lines.push(`   * @example`);
    lines.push(`   * const recent = await query.modifiedSince(new Date('2024-11-01')).execute();`);
    lines.push(`   */`);
    lines.push(`  modifiedSince(date: Date): this {`);
    lines.push(`    return this.clientFilter(result => {`);
    lines.push(`      if (!result.changeInfo?.lastModified) return false;`);
    lines.push(`      return result.changeInfo.lastModified >= date;`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push(``);

    // recentlyModified method
    lines.push(`  /**`);
    lines.push(`   * Filter ${entityName} entities modified in the last N days`);
    lines.push(`   * Requires change tracking to be enabled`);
    lines.push(`   * @param days - Number of days to look back`);
    lines.push(`   * @example`);
    lines.push(`   * const thisWeek = await query.recentlyModified(7).execute();`);
    lines.push(`   */`);
    lines.push(`  recentlyModified(days: number): this {`);
    lines.push(`    const cutoffDate = new Date();`);
    lines.push(`    cutoffDate.setDate(cutoffDate.getDate() - days);`);
    lines.push(`    return this.modifiedSince(cutoffDate);`);
    lines.push(`  }`);
    lines.push(``);

    // modifiedBetween method
    lines.push(`  /**`);
    lines.push(`   * Filter ${entityName} entities modified between two dates`);
    lines.push(`   * Requires change tracking to be enabled`);
    lines.push(`   * @param startDate - Start date`);
    lines.push(`   * @param endDate - End date`);
    lines.push(`   * @example`);
    lines.push(`   * const november = await query.modifiedBetween(`);
    lines.push(`   *   new Date('2024-11-01'),`);
    lines.push(`   *   new Date('2024-11-30')`);
    lines.push(`   * ).execute();`);
    lines.push(`   */`);
    lines.push(`  modifiedBetween(startDate: Date, endDate: Date): this {`);
    lines.push(`    return this.clientFilter(result => {`);
    lines.push(`      if (!result.changeInfo?.lastModified) return false;`);
    lines.push(`      return result.changeInfo.lastModified >= startDate && `);
    lines.push(`             result.changeInfo.lastModified <= endDate;`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push(``);

    // withChangeInfo method
    lines.push(`  /**`);
    lines.push(`   * Enrich results with change information`);
    lines.push(`   * Adds changeInfo to each result with lastModified, changeType, etc.`);
    lines.push(`   * Requires change tracking to be enabled`);
    lines.push(`   * @example`);
    lines.push(`   * const results = await query.withChangeInfo().execute();`);
    lines.push(`   * results.forEach(r => console.log(r.changeInfo?.lastModified));`);
    lines.push(`   */`);
    lines.push(`  withChangeInfo(): this {`);
    lines.push(`    // This will be handled automatically by the query execution`);
    lines.push(`    // The changeInfo is fetched from the most recent Change node`);
    lines.push(`    return this;`);
    lines.push(`  }`);
    lines.push(``);

    return lines;
  }

  /**
   * Generate semantic search method for a vector index
   */
  private static generateSemanticSearchMethod(entityName: string, vectorIndex: any): string[] {
    const lines: string[] = [];

    // Extract the search type from source_field (e.g., 'signature' or 'source')
    const searchType = vectorIndex.source_field || 'embedding';
    const methodName = `semanticSearchBy${this.capitalize(searchType)}`;

    lines.push(`  /**`);
    lines.push(`   * Semantic search using ${vectorIndex.name}`);
    const modelLabel = vectorIndex.model ? `model=${vectorIndex.model}` : 'model=default';
    const dimensionLabel = vectorIndex.dimension ? `dimension=${vectorIndex.dimension}` : 'dimension=default';
    lines.push(`   * Searches by ${searchType} embeddings (${modelLabel}, ${dimensionLabel})`);
    lines.push(`   */`);
    lines.push(`  ${methodName}(query: string, options?: { topK?: number; minScore?: number }): this {`);
    lines.push(`    return this.semantic(query, {`);
    lines.push(`      ...options,`);
    lines.push(`      vectorIndex: '${vectorIndex.name}'`);
    lines.push(`    });`);
    lines.push(`  }`);
    lines.push(``);

    return lines;
  }

  /**
   * Generate main client class
   */
  private static generateClient(config: RagForgeConfig, schema: GraphSchema): string {
    const lines: string[] = [];

    // Imports with dotenv override for local development
    lines.push(`import dotenv from 'dotenv';`);
    lines.push(`import path from 'path';`);
    lines.push(`import { fileURLToPath } from 'url';`);
    lines.push(``);
    lines.push(`// Load .env with override to ensure local config takes precedence`);
    lines.push(`const __filename = fileURLToPath(import.meta.url);`);
    lines.push(`const __dirname = path.dirname(__filename);`);
    lines.push(`dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });`);
    lines.push(``);
    const hasEmbeddings = Boolean(config.embeddings && config.embeddings.entities && config.embeddings.entities.length);
    if (hasEmbeddings) {
      lines.push(`import { createClient, VectorSearch, LLMReranker, GeminiAPIProvider } from '@luciformresearch/ragforge-runtime';`);
    } else {
      lines.push(`import { createClient } from '@luciformresearch/ragforge-runtime';`);
    }
    lines.push(`import type { RuntimeConfig } from '@luciformresearch/ragforge-runtime';`);

    if (hasEmbeddings) {
      lines.push(`import { EMBEDDINGS_CONFIG } from './embeddings/load-config.ts';`);
    }

    // Import query builders
    for (const entity of config.entities) {
      const fileName = entity.name.toLowerCase();
      lines.push(`import { ${entity.name}Query } from './queries/${fileName}.js';`);
    }
    lines.push(``);

    // Import mutation builders
    for (const entity of config.entities) {
      const fileName = entity.name.toLowerCase();
      lines.push(`import { ${entity.name}Mutations } from './mutations/${fileName}.js';`);
    }

    lines.push(``);

    // Import entity contexts
    const contextImports = config.entities.map(e => `${e.name.toUpperCase()}_CONTEXT`).join(', ');
    lines.push(`import { ${contextImports} } from './entity-contexts.js';`);
    lines.push(``);

    // Class declaration
    lines.push(`/**`);
    lines.push(` * ${config.name} RAG Client`);
    if (config.description) {
      lines.push(` * ${config.description}`);
    }
    lines.push(` */`);
    lines.push(`export class RagClient {`);
    lines.push(`  private runtime: ReturnType<typeof createClient>;`);
    lines.push(`  private neo4jClient: any;`);
    lines.push(``);

    // Generate enrichment configs and entity contexts for each entity
    for (const entity of config.entities) {
      const enrichmentConfig = this.generateEnrichmentConfig(entity);
      if (enrichmentConfig.length > 0) {
        lines.push(`  // Enrichment configuration for ${entity.name} entity`);
        lines.push(`  private ${this.camelCase(entity.name)}EnrichmentConfig = ${enrichmentConfig};`);
        lines.push(``);
      }

      // Import EntityContext from generated entity-contexts.ts instead of defining inline
      const constantName = `${entity.name.toUpperCase()}_CONTEXT`;
      lines.push(`  // Entity context for LLM reranker (imported from entity-contexts.ts)`);
      lines.push(`  private ${this.camelCase(entity.name)}EntityContext = ${constantName};`);
      lines.push(``);
    }

    lines.push(`  constructor(config: RuntimeConfig) {`);
    lines.push(`    this.runtime = createClient(config);`);
    lines.push(`    this.neo4jClient = this.runtime._getClient();`);
    if (hasEmbeddings) {
      lines.push(`    const defaultModel = EMBEDDINGS_CONFIG.defaults?.model || 'gemini-embedding-001';`);
      lines.push(`    VectorSearch.setDefaultConfig({`);
      lines.push(`      model: defaultModel,`);
      lines.push(`      dimension: EMBEDDINGS_CONFIG.defaults?.dimension`);
      lines.push(`    });`);
      lines.push(``);
      lines.push(`    for (const entity of EMBEDDINGS_CONFIG.entities) {`);
      lines.push(`      for (const pipeline of entity.pipelines) {`);
      lines.push(`        VectorSearch.registerIndex(pipeline.name, {`);
      lines.push(`          model: pipeline.model || defaultModel,`);
      lines.push(`          dimension: pipeline.dimension ?? EMBEDDINGS_CONFIG.defaults?.dimension`);
      lines.push(`        });`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(``);
      lines.push(`    // Configure default LLM provider for reranking`);

      // Get LLM model from config, default to 'gemma-3n-e2b-it'
      const llmModel = config.reranking?.llm?.model || 'gemma-3n-e2b-it';

      lines.push(`    if (process.env.GEMINI_API_KEY) {`);
      lines.push(`      try {`);
      lines.push(`        const defaultLLMProvider = GeminiAPIProvider.fromEnv('${llmModel}');`);
      lines.push(`        LLMReranker.setDefaultProvider(defaultLLMProvider);`);
      lines.push(`      } catch (error) {`);
      lines.push(`        // Ignore if GEMINI_API_KEY is not set or invalid`);
      lines.push(`      }`);
      lines.push(`    }`);
    }
    lines.push(`  }`);
    lines.push(``);

    // Public getter for Neo4j client (needed for IncrementalIngestionManager)
    lines.push(`  /**`);
    lines.push(`   * Get the underlying Neo4j client`);
    lines.push(`   * Used by utilities like IncrementalIngestionManager`);
    lines.push(`   */`);
    lines.push(`  get client() {`);
    lines.push(`    return this.neo4jClient;`);
    lines.push(`  }`);
    lines.push(``);

    // Generate query method for each entity
    for (const entity of config.entities) {
      const hasEnrichment = entity.relationships?.some(r => r.enrich);

      lines.push(`  /**`);
      lines.push(`   * Query ${entity.name} entities`);
      if (entity.description) {
        lines.push(`   * ${entity.description}`);
      }
      lines.push(`   */`);
      lines.push(`  ${this.camelCase(entity.name)}(): ${entity.name}Query {`);

      if (hasEnrichment) {
        lines.push(`    return new ${entity.name}Query(this.neo4jClient, '${entity.name}', this.${this.camelCase(entity.name)}EnrichmentConfig, this.${this.camelCase(entity.name)}EntityContext);`);
      } else {
        lines.push(`    return new ${entity.name}Query(this.neo4jClient, '${entity.name}', undefined, this.${this.camelCase(entity.name)}EntityContext);`);
      }

      lines.push(`  }`);
      lines.push(``);
    }

    // Generate mutation method for each entity
    for (const entity of config.entities) {
      const uniqueField = entity.unique_field || 'uuid';
      const displayNameField = entity.display_name_field || 'name';

      lines.push(`  /**`);
      lines.push(`   * Perform mutations (create, update, delete) on ${entity.name} entities`);
      if (entity.description) {
        lines.push(`   * ${entity.description}`);
      }
      lines.push(`   */`);
      lines.push(`  ${this.camelCase(entity.name)}Mutations(): ${entity.name}Mutations {`);
      lines.push(`    return new ${entity.name}Mutations(this.neo4jClient, {`);
      lines.push(`      name: '${entity.name}',`);
      lines.push(`      uniqueField: '${uniqueField}',`);
      lines.push(`      displayNameField: '${displayNameField}'`);
      lines.push(`    });`);
      lines.push(`  }`);
      lines.push(``);
    }

    // Add getEntityContext method
    lines.push(`  /**`);
    lines.push(`   * Get entity context for LLM reranker`);
    lines.push(`   * @param entityType - Entity type name (e.g., "Scope", "Product", "User")`);
    lines.push(`   */`);
    lines.push(`  getEntityContext(entityType: string) {`);
    lines.push(`    switch (entityType) {`);

    for (const entity of config.entities) {
      lines.push(`      case '${entity.name}':`);
      lines.push(`        return this.${this.camelCase(entity.name)}EntityContext;`);
    }

    lines.push(`      default:`);
    lines.push(`        return undefined;`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(``);

    // Add generic query API methods
    lines.push(`  /**`);
    lines.push(`   * Generic query API - Start a query for any entity type`);
    lines.push(`   *`);
    lines.push(`   * @example`);
    lines.push(`   * const results = await client.get('Scope')`);
    lines.push(`   *   .where('complexity', '>', 5)`);
    lines.push(`   *   .semanticSearch('code_embeddings', 'authentication logic')`);
    lines.push(`   *   .limit(10)`);
    lines.push(`   *   .execute();`);
    lines.push(`   */`);
    lines.push(`  get<T = any>(entity: string) {`);
    lines.push(`    return this.runtime.get<T>(entity);`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`  /**`);
    lines.push(`   * Register a custom filter for use with .filter()`);
    lines.push(`   *`);
    lines.push(`   * @example`);
    lines.push(`   * client.registerFilter('complexityGt5', 'n.complexity > 5');`);
    lines.push(`   */`);
    lines.push(`  registerFilter(name: string, cypherCondition: string, paramNames?: string[]) {`);
    lines.push(`    return this.runtime.registerFilter(name, cypherCondition, paramNames);`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`  /**`);
    lines.push(`   * Get all registered filters`);
    lines.push(`   */`);
    lines.push(`  getFilters() {`);
    lines.push(`    return this.runtime.getFilters();`);
    lines.push(`  }`);
    lines.push(``);

    // Add close method
    lines.push(`  /**`);
    lines.push(`   * Close database connection`);
    lines.push(`   */`);
    lines.push(`  async close(): Promise<void> {`);
    lines.push(`    await this.runtime.close();`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(``);

    // Factory function
    lines.push(`/**`);
    lines.push(` * Create ${config.name} client`);
    lines.push(` * @param config Optional config. If omitted, uses environment variables (NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE)`);
    lines.push(` */`);
    lines.push(`export function createRagClient(config?: Partial<RuntimeConfig>): RagClient {`);
    lines.push(`  const finalConfig: RuntimeConfig = {`);
    lines.push(`    neo4j: {`);
    lines.push(`      uri: config?.neo4j?.uri || process.env.NEO4J_URI!,`);
    lines.push(`      username: config?.neo4j?.username || process.env.NEO4J_USERNAME!,`);
    lines.push(`      password: config?.neo4j?.password || process.env.NEO4J_PASSWORD!,`);
    lines.push(`      database: config?.neo4j?.database || process.env.NEO4J_DATABASE`);
    lines.push(`    }`);
    lines.push(`  };`);
    lines.push(`  return new RagClient(finalConfig);`);
    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Generate index.ts exports
   */
  private static generateIndex(config: RagForgeConfig): string {
    const lines: string[] = [];

    lines.push(`/**`);
    lines.push(` * ${config.name} - Generated RAG Client`);
    lines.push(` * Generated by RagForge - DO NOT EDIT`);
    lines.push(` */`);
    lines.push(``);

    // Export client
    lines.push(`export { RagClient, createRagClient } from './client.js';`);
    lines.push(``);

    // Export query builders
    for (const entity of config.entities) {
      const fileName = entity.name.toLowerCase();
      lines.push(`export { ${entity.name}Query } from './queries/${fileName}.js';`);
    }
    lines.push(``);

    // Export mutation builders
    for (const entity of config.entities) {
      const fileName = entity.name.toLowerCase();
      lines.push(`export { ${entity.name}Mutations } from './mutations/${fileName}.js';`);
    }
    lines.push(``);

    // Export types
    lines.push(`export * from './types.js';`);
    lines.push(``);

    // Export entity contexts
    lines.push(`export * from './entity-contexts.js';`);
    lines.push(``);

    // Export docs + agent
    lines.push(`export { CLIENT_DOCUMENTATION } from './documentation.js';`);
    lines.push(`export { createIterativeAgent, type GeneratedAgentConfig } from './agent.js';`);

    return lines.join('\n');
  }

  /**
   * Generate entity-contexts.ts module with EntityContext for all entities
   * This replaces the hard-coded DEFAULT_SCOPE_CONTEXT fallback
   */
  private static generateEntityContextsModule(config: RagForgeConfig, schema: GraphSchema): string {
    const lines: string[] = [];

    lines.push(`/**`);
    lines.push(` * Entity Contexts - Generated from RagForge config`);
    lines.push(` * `);
    lines.push(` * These EntityContext objects define how entities are presented to LLM rerankers.`);
    lines.push(` * They are automatically generated from your ragforge.config.yaml.`);
    lines.push(` * `);
    lines.push(` * DO NOT EDIT - regenerate with: ragforge generate`);
    lines.push(` */`);
    lines.push(``);

    // Import EntityContext type
    lines.push(`import type { EntityContext } from '@luciformresearch/ragforge-runtime';`);
    lines.push(``);

    // Generate a constant for each entity
    for (const entity of config.entities) {
      const entityContext = this.generateEntityContext(entity, schema);
      const constantName = `${entity.name.toUpperCase()}_CONTEXT`;

      lines.push(`/**`);
      lines.push(` * EntityContext for ${entity.name} entities`);
      if (entity.description) {
        lines.push(` * ${entity.description}`);
      }
      lines.push(` */`);
      lines.push(`export const ${constantName}: EntityContext = ${entityContext};`);
      lines.push(``);
    }

    // Export a map for easy lookup by entity type
    lines.push(`/**`);
    lines.push(` * Map of entity type to EntityContext`);
    lines.push(` */`);
    lines.push(`export const ENTITY_CONTEXTS: Record<string, EntityContext> = {`);
    for (const entity of config.entities) {
      const constantName = `${entity.name.toUpperCase()}_CONTEXT`;
      lines.push(`  '${entity.name}': ${constantName},`);
    }
    lines.push(`};`);
    lines.push(``);

    // Export a helper to get context by entity type
    lines.push(`/**`);
    lines.push(` * Get EntityContext for a given entity type`);
    lines.push(` * @throws Error if entity type is not found`);
    lines.push(` */`);
    lines.push(`export function getEntityContext(entityType: string): EntityContext {`);
    lines.push(`  const context = ENTITY_CONTEXTS[entityType];`);
    lines.push(`  if (!context) {`);
    lines.push(`    throw new Error(\`No EntityContext found for entity type: \${entityType}. Available types: \${Object.keys(ENTITY_CONTEXTS).join(', ')}\`);`);
    lines.push(`  }`);
    lines.push(`  return context;`);
    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Generate patterns.ts module with common query patterns for better DX
   * Completely generic - based only on config, not code-specific
   */
  private static generatePatternsModule(config: RagForgeConfig, schema: GraphSchema): string {
    const lines: string[] = [];

    lines.push(`/**`);
    lines.push(` * Common Query Patterns - Generated from RagForge config`);
    lines.push(` * `);
    lines.push(` * Pre-built query patterns for common use cases to improve developer experience.`);
    lines.push(` * These patterns provide a more intuitive API and reduce the learning curve.`);
    lines.push(` * `);
    lines.push(` * DO NOT EDIT - regenerate with: ragforge generate`);
    lines.push(` */`);
    lines.push(``);

    // Import the client type (always RagClient)
    const clientTypeName = 'RagClient';
    lines.push(`import type { ${clientTypeName} } from './client.js';`);
    lines.push(``);

    // Generate patterns object with methods for each entity
    lines.push(`/**`);
    lines.push(` * Create common query patterns for easier discovery and use`);
    lines.push(` */`);
    lines.push(`export function createCommonPatterns(client: ${clientTypeName}) {`);
    lines.push(`  return {`);

    // For each entity, generate common patterns
    for (const entity of config.entities) {
      const entityMethodName = entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
      const queryField = this.getQueryField(entity);

      lines.push(``);
      lines.push(`    // ========== ${entity.name} Patterns ==========`);
      lines.push(``);

      // Pattern 1: Find by query field prefix
      lines.push(`    /**`);
      lines.push(`     * Find ${entity.name} entities where ${queryField} starts with a prefix`);
      lines.push(`     * @example`);
      lines.push(`     * const results = await patterns.find${entity.name}ByPrefix('example').execute();`);
      lines.push(`     */`);
      lines.push(`    find${entity.name}ByPrefix(prefix: string) {`);
      lines.push(`      return client.${entityMethodName}().whereName({ startsWith: prefix });`);
      lines.push(`    },`);
      lines.push(``);

      // Pattern 2: Find by query field containing
      lines.push(`    /**`);
      lines.push(`     * Find ${entity.name} entities where ${queryField} contains text`);
      lines.push(`     * @example`);
      lines.push(`     * const results = await patterns.find${entity.name}ByContaining('builder').execute();`);
      lines.push(`     */`);
      lines.push(`    find${entity.name}ByContaining(text: string) {`);
      lines.push(`      return client.${entityMethodName}().whereName({ contains: text });`);
      lines.push(`    },`);
      lines.push(``);

      // Pattern 3: Find by exact query field value
      lines.push(`    /**`);
      lines.push(`     * Find ${entity.name} by exact ${queryField}`);
      lines.push(`     * @example`);
      lines.push(`     * const result = await patterns.find${entity.name}ByExact('MyEntity').first();`);
      lines.push(`     */`);
      lines.push(`    find${entity.name}ByExact(value: string) {`);
      lines.push(`      return client.${entityMethodName}().whereName(value);`);
      lines.push(`    },`);

      // Pattern 4: For each searchable_field in config, generate a search pattern
      for (const field of entity.searchable_fields) {
        const fieldMethodName = field.name.charAt(0).toUpperCase() + field.name.slice(1);
        const whereMethod = `where${fieldMethodName}`;

        lines.push(``);
        lines.push(`    /**`);
        lines.push(`     * Find ${entity.name} entities where ${field.name} contains text`);
        lines.push(`     * @example`);
        lines.push(`     * const results = await patterns.find${entity.name}By${fieldMethodName}('text').execute();`);
        lines.push(`     */`);
        lines.push(`    find${entity.name}By${fieldMethodName}(text: string) {`);
        lines.push(`      return client.${entityMethodName}().${whereMethod}({ contains: text });`);
        lines.push(`    },`);
      }

      // Pattern 5: Find with specific relationship expanded (based on config relationships)
      if (entity.relationships && entity.relationships.length > 0) {
        for (const rel of entity.relationships.slice(0, 3)) { // Limit to first 3 relationships
          const relType = rel.type;
          lines.push(``);
          lines.push(`    /**`);
          lines.push(`     * Find ${entity.name} entities with ${relType} relationship expanded`);
          lines.push(`     * @example`);
          lines.push(`     * const results = await patterns.find${entity.name}With${relType}(2).execute();`);
          lines.push(`     */`);
          lines.push(`    find${entity.name}With${relType}(depth: number = 1) {`);
          lines.push(`      return client.${entityMethodName}().with${relType}(depth);`);
          lines.push(`    },`);
        }
      }

      // Pattern 6: Temporal patterns (if change tracking enabled)
      if (entity.track_changes || config.source?.track_changes) {
        lines.push(``);
        lines.push(`    // ===== Temporal Patterns (Change Tracking) =====`);
        lines.push(``);

        // Pattern: Find recently modified
        lines.push(`    /**`);
        lines.push(`     * Find ${entity.name} entities modified in the last N days`);
        lines.push(`     * @example`);
        lines.push(`     * const results = await patterns.findRecentlyModified${entity.name}(7).execute();`);
        lines.push(`     */`);
        lines.push(`    findRecentlyModified${entity.name}(days: number = 7) {`);
        lines.push(`      return client.${entityMethodName}().recentlyModified(days);`);
        lines.push(`    },`);
        lines.push(``);

        // Pattern: Find modified since date
        lines.push(`    /**`);
        lines.push(`     * Find ${entity.name} entities modified since a specific date`);
        lines.push(`     * @example`);
        lines.push(`     * const results = await patterns.find${entity.name}ModifiedSince(new Date('2025-01-01')).execute();`);
        lines.push(`     */`);
        lines.push(`    find${entity.name}ModifiedSince(date: Date) {`);
        lines.push(`      return client.${entityMethodName}().modifiedSince(date);`);
        lines.push(`    },`);
        lines.push(``);

        // Pattern: Find modified between dates
        lines.push(`    /**`);
        lines.push(`     * Find ${entity.name} entities modified within a date range`);
        lines.push(`     * @example`);
        lines.push(`     * const results = await patterns.find${entity.name}ModifiedBetween(new Date('2025-01-01'), new Date('2025-01-31')).execute();`);
        lines.push(`     */`);
        lines.push(`    find${entity.name}ModifiedBetween(startDate: Date, endDate: Date) {`);
        lines.push(`      return client.${entityMethodName}().modifiedBetween(startDate, endDate);`);
        lines.push(`    },`);
        lines.push(``);

        // Pattern: Find with change history
        lines.push(`    /**`);
        lines.push(`     * Find ${entity.name} entities with change history information`);
        lines.push(`     * @example`);
        lines.push(`     * const results = await patterns.find${entity.name}WithChangeHistory().execute();`);
        lines.push(`     */`);
        lines.push(`    find${entity.name}WithChangeHistory() {`);
        lines.push(`      return client.${entityMethodName}().withChangeInfo();`);
        lines.push(`    },`);
      }
    }

    // Close the patterns object
    lines.push(`  };`);
    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Generate QUICKSTART.md guide for developers
   */
  private static generateQuickstart(config: RagForgeConfig, schema: GraphSchema): string {
    const lines: string[] = [];
    // Sanitize client variable name (remove hyphens, spaces, etc.)
    const clientVarName = config.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .replace(/^[0-9]/, 'rag') || 'rag';
    const entityExample = config.entities[0]; // Use first entity as example
    const entityMethodName = entityExample.name.charAt(0).toLowerCase() + entityExample.name.slice(1);
    const queryField = this.getQueryField(entityExample);
    const displayNameField = this.getDisplayNameField(entityExample);
    const hasSourceConfig = !!config.source;
    const hasVectorIndexes = config.entities.some(e => e.vector_indexes && e.vector_indexes.length > 0);

    lines.push(`# ${config.name} RAG Client - Quick Start Guide`);
    lines.push('');
    lines.push(`> Get started with the ${config.name} RAG framework in under 2 minutes`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 📦 Installation');
    lines.push('');
    lines.push('```bash');
    lines.push('npm install');
    lines.push('```');
    lines.push('');

    // Add Database Setup section if source config exists
    if (hasSourceConfig) {
      lines.push('## 🗄️ Database Setup');
      lines.push('');
      lines.push('### First-time setup');
      lines.push('');
      lines.push('If this is a new project with code to ingest:');
      lines.push('');
      lines.push('```bash');
      lines.push('npm run setup');
      lines.push('```');
      lines.push('');
      lines.push('This will:');
      lines.push('1. ✅ Parse your source code (configured in `ragforge.config.yaml`)');
      lines.push('2. ✅ Ingest code into Neo4j (incremental - only changed files)');
      if (hasVectorIndexes) {
        lines.push('3. ✅ Create vector indexes');
        lines.push('4. ✅ Generate embeddings');
      }
      lines.push('');
      lines.push('### Subsequent updates');
      lines.push('');
      lines.push('When your code changes, just run:');
      lines.push('');
      lines.push('```bash');
      lines.push('npm run ingest');
      lines.push('```');
      lines.push('');
      lines.push('This uses **incremental ingestion** - only re-processes files that changed!');
      lines.push('');

      // Add watch mode section if watch is enabled
      if (config.watch?.enabled) {
        lines.push('### Watch mode (automatic ingestion)');
        lines.push('');
        lines.push('For automatic ingestion as you code:');
        lines.push('');
        lines.push('```bash');
        lines.push('npm run watch');
        lines.push('```');
        lines.push('');
        lines.push('This watches your source files and automatically ingests changes:');
        lines.push(`- 🔄 Batches changes every ${config.watch.batch_interval ?? 1000}ms`);
        lines.push('- ⚡ Only processes modified files (incremental)');
        if (config.watch.auto_embed) {
          lines.push('- 🔢 Auto-generates embeddings after each batch');
        }
        lines.push('- ⚠️  Marks changed scopes with dirty embeddings flag');
        lines.push('');
        lines.push('Press Ctrl+C to stop watching.');
        lines.push('');
      }

      lines.push('### Clean slate');
      lines.push('');
      lines.push('To wipe the database and start fresh:');
      lines.push('');
      lines.push('```bash');
      lines.push('npm run clean:db  # Removes all data');
      lines.push('npm run setup     # Re-ingest everything');
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    lines.push('');
    lines.push('## 🚀 Basic Usage');
    lines.push('');
    lines.push('### 1. Create a client');
    lines.push('');
    lines.push('```typescript');
    lines.push(`import { createRagClient } from './client.js';`);
    lines.push('');
    lines.push(`const ${clientVarName} = createRagClient();`);
    lines.push('```');
    lines.push('');
    lines.push('### 2. Query entities');
    lines.push('');
    lines.push('```typescript');
    lines.push(`// Find ${entityExample.name} by exact ${queryField}`);
    lines.push(`const result = await ${clientVarName}.${entityMethodName}()`);
    lines.push(`  .whereName('example')`);
    lines.push(`  .first();`);
    lines.push('');
    lines.push(`console.log(result?.entity.${displayNameField});`);
    lines.push('```');
    lines.push('');
    lines.push('### 3. Use helper methods');
    lines.push('');
    lines.push('```typescript');
    lines.push(`// Get first result`);
    lines.push(`const first = await ${clientVarName}.${entityMethodName}().whereName('example').first();`);
    lines.push('');
    lines.push(`// Extract single field`);
    lines.push(`const names = await ${clientVarName}.${entityMethodName}().limit(10).pluck('${displayNameField}');`);
    lines.push('');
    lines.push(`// Count results`);
    lines.push(`const total = await ${clientVarName}.${entityMethodName}().count();`);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');

    // Add Understanding Results section
    lines.push('## 📦 Understanding Results');
    lines.push('');
    lines.push('**Important**: Query results have a specific structure:');
    lines.push('');
    lines.push('```typescript');
    lines.push('{');
    lines.push('  entity: {');
    lines.push('    // All node properties here');
    lines.push(`    ${displayNameField}: "value",`);
    lines.push(`    ${queryField}: "example",`);
    lines.push('    // ... other properties');
    lines.push('  },');
    lines.push('  score?: number,  // Relevance score (only for semantic/vector search)');
    lines.push('  // ... other metadata');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('**Always access node properties via `.entity`**:');
    lines.push('');
    lines.push('```typescript');
    lines.push(`const results = await ${clientVarName}.${entityMethodName}().whereName('example').execute();`);
    lines.push('');
    lines.push('// ✅ Correct');
    lines.push(`console.log(results[0].entity.${displayNameField});`);
    lines.push(`console.log(results[0].entity.${queryField});`);
    lines.push('');
    lines.push('// ❌ Wrong - returns undefined!');
    lines.push(`console.log(results[0].${displayNameField});`);
    lines.push(`console.log(results[0].${queryField});`);
    lines.push('```');
    lines.push('');

    // Add semantic search example if vector indexes exist
    if (hasVectorIndexes) {
      const vectorEntity = config.entities.find(e => e.vector_indexes && e.vector_indexes.length > 0);
      if (vectorEntity && vectorEntity.vector_indexes) {
        const firstIndex = vectorEntity.vector_indexes[0];
        const semanticMethodName = `semanticSearchBy${firstIndex.source_field.charAt(0).toUpperCase() + firstIndex.source_field.slice(1)}`;
        const entityMethod = vectorEntity.name.charAt(0).toLowerCase() + vectorEntity.name.slice(1);

        lines.push('For semantic searches, you also get a relevance score:');
        lines.push('');
        lines.push('```typescript');
        lines.push(`const results = await ${clientVarName}.${entityMethod}()`);
        lines.push(`  .${semanticMethodName}("your search query")`);
        lines.push(`  .limit(5)`);
        lines.push(`  .execute();`);
        lines.push('');
        lines.push('results.forEach(r => {');
        lines.push(`  console.log(\`\${r.entity.${displayNameField}}: \${r.score?.toFixed(2)}\`);`);
        lines.push('});');
        lines.push('```');
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
    lines.push('## 🎯 Common Patterns');
    lines.push('');
    lines.push('Use the patterns module for common queries:');
    lines.push('');
    lines.push('```typescript');
    lines.push(`import { createCommonPatterns } from './patterns.js';`);
    lines.push('');
    lines.push(`const patterns = createCommonPatterns(${clientVarName});`);
    lines.push('');
    lines.push(`// Find by prefix`);
    lines.push(`const results = await patterns.find${entityExample.name}ByPrefix('example').execute();`);
    lines.push('');
    lines.push(`// Find by containing`);
    lines.push(`const results2 = await patterns.find${entityExample.name}ByContaining('text').execute();`);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 📋 Available Entities');
    lines.push('');

    for (const entity of config.entities) {
      const methodName = entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
      lines.push(`### ${entity.name}`);
      if (entity.description) {
        lines.push(`> ${entity.description}`);
      }
      lines.push('');
      lines.push('```typescript');
      lines.push(`${clientVarName}.${methodName}()`);
      lines.push(`  .whereName('value')`);
      lines.push(`  .execute();`);
      lines.push('```');
      lines.push('');

      // Show available filters
      if (entity.searchable_fields.length > 0) {
        lines.push('**Available filters:**');
        for (const field of entity.searchable_fields) {
          const methodName = `where${field.name.charAt(0).toUpperCase() + field.name.slice(1)}`;
          lines.push(`- \`.${methodName}({ contains: 'text' })\` - Filter by ${field.name}`);
        }
        lines.push('');
      }

      // Show available relationships
      if (entity.relationships && entity.relationships.length > 0) {
        lines.push('**Available relationships:**');
        for (const rel of entity.relationships) {
          const methodName = `with${rel.type}`;
          lines.push(`- \`.${methodName}(depth)\` - Expand ${rel.type} relationship`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
    lines.push('## 🔍 Query Methods');
    lines.push('');
    lines.push('All query builders support these methods:');
    lines.push('');
    lines.push('### Filtering');
    lines.push('- `.where(filter)` - Filter by field values');
    lines.push('- `.whereName(value)` - Filter by name (exact or pattern)');
    lines.push('- `.limit(n)` - Limit results');
    lines.push('- `.offset(n)` - Skip results');
    lines.push('');
    lines.push('### Execution');
    lines.push('- `.execute()` - Get all results');
    lines.push('- `.first()` - Get first result or undefined');
    lines.push('- `.count()` - Count total results');
    lines.push('- `.pluck(field)` - Extract single field from all results');
    lines.push('');
    lines.push('### Debugging');
    lines.push('- `.debug()` - Show generated Cypher query');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 📚 More Examples');
    lines.push('');
    lines.push('Check out the `examples/` directory for more detailed examples:');
    lines.push('');
    lines.push('```bash');
    if (hasVectorIndexes) {
      lines.push('npm run examples:01-semantic-search-source');
    }
    if (entityExample.relationships && entityExample.relationships.length > 0) {
      lines.push('npm run examples:02-relationship-defined_in');
    }
    lines.push('npm run examples:07-llm-reranking');
    lines.push('npm run examples:09-complex-pipeline');
    lines.push('```');
    lines.push('');
    lines.push('> See all examples: `ls examples/` or check `package.json` scripts');
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 🔗 Next Steps');
    lines.push('');
    lines.push('- Read the [Client Reference](./docs/client-reference.md) for complete API documentation');
    lines.push('- Explore [Common Patterns](./patterns.ts) for reusable queries');
    lines.push('- Check [Agent Reference](./docs/agent-reference.md) for LLM agent integration');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate iterative agent wrapper that injects generated documentation
   */
  private static generateAgent(config: RagForgeConfig): string {
    const lines: string[] = [];

    lines.push(`import { IterativeCodeAgent, type AgentConfig } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import { CLIENT_DOCUMENTATION } from './documentation.js';`);
    lines.push(``);
    lines.push(`/**`);
    lines.push(` * Configuration for the generated iterative agent.`);
    lines.push(` * Accepts the same parameters as AgentConfig, but wraps ragClientPath and documentation.`);
    lines.push(` */`);
    lines.push(`export interface GeneratedAgentConfig extends Omit<AgentConfig, 'ragClientPath' | 'frameworkDocs'> {`);
    lines.push(`  /** Optional override for the path to the generated client (default: './client.js') */`);
    lines.push(`  ragClientPath?: string;`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`/**`);
    lines.push(` * Create an IterativeCodeAgent pre-configured with generated documentation.`);
    lines.push(` */`);
    lines.push(`export function createIterativeAgent(config: GeneratedAgentConfig): IterativeCodeAgent {`);
    lines.push(`  const agentConfig: AgentConfig = {`);
    lines.push(`    ...config,`);
    lines.push(`    ragClientPath: config.ragClientPath || './client.js',`);
    lines.push(`    frameworkDocs: CLIENT_DOCUMENTATION`);
    lines.push(`  };`);
    lines.push(``);
    lines.push(`  return new IterativeCodeAgent(agentConfig);`);
    lines.push(`}`);

    return lines.join('\n');
  }

  /**
   * Generate simplified Markdown documentation for Agent prompt
   */
  private static generateAgentDocumentation(config: RagForgeConfig, schema: GraphSchema, exampleSummaries: string[] = []): string {
    const lines: string[] = [];

    lines.push(`# ${config.name} RAG Client - Agent Reference`);
    lines.push('');
    lines.push('Simplified reference for LLM agent usage.');
    lines.push('');

    // Custom Methods (YAML-generated)
    lines.push('## ⭐ Custom Methods');
    lines.push('');

    // Collect custom methods from first entity (usually the main one)
    const firstEntity = config.entities[0];
    if (firstEntity) {
      // Semantic search methods
      const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        lines.push('### Semantic Search');
        lines.push('');
        for (const index of vectorIndexes) {
          const sourceField = index.source_field || index.field;
          const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
          lines.push(`- **\`${this.camelCase(firstEntity.name)}().${methodName}(query, { topK?, minScore? })\`**`);
        }
        lines.push('');
      }

      // Relationship methods
      const relationships = firstEntity.relationships || [];
      if (relationships.length > 0) {
        lines.push('### Relationships');
        lines.push('');
        for (const rel of relationships) {
          const entityMethod = this.camelCase(firstEntity.name);
          const withMethod = this.camelCase(`with_${rel.type}`);

          // Filter methods
          if (rel.filters && rel.filters.length > 0) {
            for (const filter of rel.filters) {
              lines.push(`- **\`${entityMethod}().${filter.name}(targetName)\`** - ${filter.description || `Filter by ${rel.type}`}`);
            }
          }

          // Expand method
          lines.push(`- **\`${entityMethod}().${withMethod}(depth?)\`** - Expand ${rel.type} relationships`);
        }
        lines.push('');
      }
    }

    // Advanced methods
    lines.push('### Advanced');
    lines.push('');
    lines.push('- **`.llmRerank(question, { topK?, minScore? })`** - Rerank results using LLM reasoning');
    lines.push('- **`.executeWithMetadata()`** - Get pipeline execution details');
    if (config.reranking?.strategies) {
      for (const strategy of config.reranking.strategies) {
        const methodName = this.camelCase(`rerank_by_${strategy.name}`);
        lines.push(`- **\`.${methodName}()\`** - ${strategy.description || strategy.name}`);
      }
    }
    lines.push('');

    // Core Query Methods (universal)
    lines.push('## 🔧 Core Query Methods');
    lines.push('');
    lines.push('Available on ALL entity builders:');
    lines.push('');
    lines.push('### Filtering');
    lines.push('- **`.where(filter: EntityFilter)`** - Complex filter with AND/OR logic');
    lines.push('- **`.limit(n: number)`** - Limit results to n items');
    lines.push('- **`.offset(n: number)`** - Skip first n items');
    lines.push('- **`.orderBy(field: string, direction: \'asc\' | \'desc\')`** - Sort results');
    lines.push('');
    lines.push('### Relationship Expansion');
    lines.push('- **`.expand(relType: string, { depth?, direction? })`** - Generic relationship traversal');
    lines.push('- **`.withXxx(depth?: number)`** - Expand specific relationships (auto-generated)');
    lines.push('');
    lines.push('### Execution');
    lines.push('- **`.execute()`** - Execute query and return SearchResult[]');
    lines.push('- **`.executeWithMetadata()`** - Execute with detailed pipeline information');
    lines.push('');

    // Result Structure
    lines.push('## 📦 Result Structure');
    lines.push('');
    lines.push('All queries return `SearchResult<T>[]`:');
    lines.push('');
    lines.push('```typescript');
    lines.push('interface SearchResult<T> {');
    lines.push('  entity: T;              // The entity object');
    lines.push('  score: number;          // Relevance score (0-1)');
    lines.push('  scoreBreakdown?: {');
    lines.push('    semantic?: number;    // Semantic similarity score');
    lines.push('    llm?: number;         // LLM reranking score');
    lines.push('    llmReasoning?: string; // Why this result is relevant');
    lines.push('  };');
    lines.push('  context?: {');
    lines.push('    related?: RelatedEntity[]; // Connected nodes from withXxx() expansion');
    lines.push('  };');
    lines.push('}');
    lines.push('');
    lines.push('interface RelatedEntity {');
    lines.push('  entity: T;');
    lines.push('  relationshipType: string;  // e.g., "CONSUMES", "DEFINED_IN"');
    lines.push('  depth: number;             // How many hops away');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('**Accessing results:**');
    lines.push('```typescript');
    // Use first entity dynamically
    if (firstEntity) {
      const entityMethod = this.camelCase(firstEntity.name);
      const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
      const firstVectorIndex = vectorIndexes[0];
      if (firstVectorIndex) {
        const sourceField = firstVectorIndex.source_field || firstVectorIndex.field || 'embedding';
        const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
        lines.push(`const results = await rag.${entityMethod}()`);
        lines.push(`  .${methodName}('query', { topK: 10 })`);
      } else {
        lines.push(`const results = await rag.${entityMethod}()`);
        lines.push(`  .semantic('query', { topK: 10 })`);
      }
      const firstRel = (firstEntity.relationships || [])[0];
      if (firstRel) {
        const withMethod = this.camelCase(`with_${firstRel.type}`);
        lines.push(`  .${withMethod}(1)`);
      }
      lines.push('  .execute();');
      lines.push('');
      lines.push('results.forEach(r => {');
      lines.push(`  console.log(r.entity.name);          // ${firstEntity.name} name`);
      // Show first searchable field
      if (firstEntity.searchable_fields.length > 0) {
        const field = firstEntity.searchable_fields[0];
        lines.push(`  console.log(r.entity.${field.name});        // ${field.description || field.name}`);
      }
      lines.push('  console.log(r.score);                // Relevance score');
      if (firstRel) {
        lines.push('');
        lines.push('  // Access related entities from expansion');
        lines.push('  const related = r.context?.related?.filter(rel =>');
        lines.push(`    rel.relationshipType === '${firstRel.type}'`);
        lines.push('  );');
      }
      lines.push('});');
    }
    lines.push('```');
    lines.push('');

    // Entity Reference (enhanced with available fields)
    lines.push('## 📚 Entity Reference');
    lines.push('');
    for (const entity of config.entities) {
      const entityMethod = this.camelCase(entity.name);
      const entityNode = schema.nodes.find(n => n.label === entity.name);
      const count = entityNode?.count || 0;

      lines.push(`### ${entity.name}${count > 0 ? ` (${count} nodes)` : ''}`);
      lines.push(`**Usage:** \`rag.${entityMethod}()\``);
      lines.push('');

      // Available Fields (all searchable fields with descriptions)
      if (entity.searchable_fields.length > 0) {
        lines.push('**Available Fields:**');
        for (const field of entity.searchable_fields) {
          const desc = field.description ? ` - ${field.description}` : '';
          const values = field.values && field.values.length ? ` (values: ${field.values.slice(0, 3).join(', ')}${field.values.length > 3 ? '...' : ''})` : '';
          lines.push(`- \`${field.name}: ${field.type}\`${desc}${values}`);
        }
        lines.push('');
      }

      // Key Filters (concise)
      const hasWhereMethod = entity.searchable_fields.length > 0;
      if (hasWhereMethod) {
        lines.push('**Key Filters:**');
        for (const field of entity.searchable_fields.slice(0, 3)) {
          lines.push(`- \`where${this.capitalize(field.name)}(value)\``);
        }
      }

      // Semantic Search
      const vectorIndexes = entity.vector_indexes || (entity.vector_index ? [entity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        if (!hasWhereMethod) {
          lines.push('**Key Methods:**');
        }
        for (const index of vectorIndexes) {
          const sourceField = index.source_field || index.field || 'embedding';
          const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
          lines.push(`- \`${methodName}(query, options)\` - Search by ${sourceField}`);
        }
      }

      // Relationships
      const relationships = entity.relationships || [];
      if (relationships.length > 0) {
        if (!hasWhereMethod && vectorIndexes.length === 0) {
          lines.push('**Key Methods:**');
        }
        for (const rel of relationships.slice(0, 3)) {
          const withMethod = this.camelCase(`with_${rel.type}`);
          lines.push(`- \`${withMethod}(depth?)\` - Expand ${rel.type} relationships`);
        }
      }

      lines.push('');
    }

    // Pipeline Patterns (concise decision guidelines)
    lines.push('## 🎨 Pipeline Patterns');
    lines.push('');
    lines.push('### Pattern 1: Broad → Narrow (Recommended)');
    lines.push('Start with high topK, progressively filter and rerank:');
    lines.push('```typescript');
    if (firstEntity) {
      const entityMethod = this.camelCase(firstEntity.name);
      const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        const sourceField = vectorIndexes[0].source_field || vectorIndexes[0].field || 'embedding';
        const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
        lines.push(`await rag.${entityMethod}()`);
        lines.push(`  .${methodName}('query', { topK: 100 })  // Cast wide net`);
        if (firstEntity.searchable_fields.length > 0) {
          const field = firstEntity.searchable_fields[0];
          lines.push(`  .where${this.capitalize(field.name)}('value')      // Focus`);
        }
        lines.push(`  .llmRerank('specific question', { topK: 10 })  // Quality`);
        if ((firstEntity.relationships || []).length > 0) {
          const rel = firstEntity.relationships![0];
          const withMethod = this.camelCase(`with_${rel.type}`);
          lines.push(`  .${withMethod}(1)                            // Context`);
        }
        lines.push('  .execute();');
      }
    }
    lines.push('```');
    lines.push('');
    lines.push('### Pattern 2: Known Entry → Expand');
    lines.push('Start with exact match, explore relationships:');
    lines.push('```typescript');
    if (firstEntity && (firstEntity.relationships || []).length > 0) {
      const entityMethod = this.camelCase(firstEntity.name);
      const rels = firstEntity.relationships!;
      lines.push(`// Find specific entity`);
      lines.push(`await rag.${entityMethod}().whereName('TargetName').execute();`);
      lines.push('');
      lines.push(`// Map relationships`);
      if (rels.length >= 2) {
        const rel1 = rels[0];
        const rel2 = rels[1];
        const with1 = this.camelCase(`with_${rel1.type}`);
        const with2 = this.camelCase(`with_${rel2.type}`);
        lines.push(`await rag.${entityMethod}()`);
        lines.push(`  .whereName('TargetName')`);
        lines.push(`  .${with1}(2)  // Get ${rel1.type} (2 levels)`);
        lines.push(`  .${with2}(1)  // Get ${rel2.type} (1 level)`);
        lines.push('  .execute();');
      }
    }
    lines.push('```');
    lines.push('');
    lines.push('### Decision Guidelines');
    lines.push('');
    lines.push('**When to stop:**');
    lines.push('- ✅ Found 5-10 high-quality results (score > 0.8)');
    lines.push('- ✅ Results directly answer the question');
    lines.push('- ✅ Expanding more yields diminishing returns');
    lines.push('');
    lines.push('**When to continue:**');
    lines.push('- 🔄 Results on-topic but incomplete');
    lines.push('- 🔄 Scores mediocre (0.5-0.7) - try different query');
    lines.push('- 🔄 Only 1-2 results - query too narrow');
    lines.push('');
    lines.push('**When to pivot:**');
    lines.push('- 🔀 No results → Broaden query or use relationships');
    lines.push('- 🔀 Too many (>50) → Add filters or llmRerank');
    lines.push('- 🔀 Wrong results → Different query or entity type');
    lines.push('');

    // Generated Examples
    if (exampleSummaries.length > 0) {
      lines.push('## 📚 Generated Examples');
      lines.push('');
      for (const summary of exampleSummaries) {
        lines.push(summary);
      }
    }

    // Best Practices
    lines.push('## Best Practices');
    lines.push('');
    lines.push('- Start broad with semantic search (topK: 50-100), then filter or rerank to top 5-10');
    lines.push('- Use `.llmRerank()` for complex reasoning queries');
    lines.push('- Chain operations: semantic → filter → llmRerank → expand');
    lines.push('- Use `.executeWithMetadata()` to debug pipeline performance');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate complete Markdown documentation for developers
   */
  private static generateDeveloperDocumentation(config: RagForgeConfig, schema: GraphSchema, exampleSummaries: string[] = []): string {
    const lines: string[] = [];

    lines.push(`# ${config.name} RAG Client`);
    lines.push('');
    lines.push(`Version: ${config.version}`);
    if (config.description) {
      lines.push('');
      lines.push(config.description);
    }
    lines.push('');
    lines.push('Generated by RagForge – use this reference to drive both LLM agents and manual usage of the query builders.');
    lines.push('');

    // Quickstart
    lines.push('## Quickstart');
    lines.push('');
    lines.push('```typescript');
    lines.push(`import { createRagClient } from './client.js';`);
    lines.push('');
    lines.push(`const rag = createRagClient({`);
    lines.push(`  neo4j: {`);
    lines.push(`    uri: process.env.NEO4J_URI!,`);
    lines.push(`    username: process.env.NEO4J_USERNAME!,`);
    lines.push(`    password: process.env.NEO4J_PASSWORD!`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
    lines.push(`const results = await rag.${this.camelCase(config.entities[0]?.name || 'Entity')}()`);
    lines.push(`  .semantic('search text', { topK: 20 })`);
    lines.push(`  .limit(10)`);
    lines.push(`  .execute();`);
    lines.push('```');
    lines.push('');
    lines.push('> Embeddings use Google Gemini (`@google/genai`) and require `GEMINI_API_KEY` in your environment.');
    lines.push('');

    // Add Project Scripts section if source config exists
    if (config.source) {
      const hasVectorIndexes = config.entities.some(e => e.vector_indexes && e.vector_indexes.length > 0);
      lines.push('## 📜 Available Scripts');
      lines.push('');
      lines.push('This project includes auto-generated scripts for database management:');
      lines.push('');

      lines.push('### `npm run setup`');
      lines.push('**Complete setup workflow** - Run this for first-time setup:');
      lines.push('1. Parses code from configured source paths');
      lines.push('2. Ingests into Neo4j (creates Scope, File nodes)');
      if (hasVectorIndexes) {
        lines.push('3. Creates vector indexes');
        lines.push('4. Generates embeddings');
      }
      lines.push('');
      lines.push('**When to use**: New project, or when you want a clean slate');
      lines.push('');

      lines.push('### `npm run ingest`');
      lines.push('**Incremental code ingestion** - Only re-processes changed files:');
      lines.push('- Detects file changes using content hashing');
      lines.push('- Only updates modified scopes');
      lines.push('- Much faster than full re-ingestion');
      lines.push('');
      lines.push('**When to use**: After code changes, for quick updates');
      lines.push('');
      lines.push('**Example output**:');
      lines.push('```');
      lines.push('🔍 Analyzing changes...');
      lines.push('   Created: 5');
      lines.push('   Updated: 2');
      lines.push('   Unchanged: 143');
      lines.push('   Deleted: 0');
      lines.push('```');
      lines.push('');

      lines.push('### `npm run ingest:clean`');
      lines.push('Clean database + fresh ingestion:');
      lines.push('```bash');
      lines.push('npm run ingest:clean');
      lines.push('```');
      lines.push('');

      lines.push('### `npm run clean:db`');
      lines.push('Removes all data from Neo4j:');
      lines.push('```bash');
      lines.push('npm run clean:db');
      lines.push('```');
      lines.push('**⚠️ Warning**: This deletes everything!');
      lines.push('');

      lines.push('### How ingestion works');
      lines.push('');
      lines.push('The code is parsed using the configuration in `ragforge.config.yaml`:');
      lines.push('');
      lines.push('```yaml');
      lines.push('source:');
      lines.push(`  type: ${config.source.type}`);
      lines.push(`  adapter: ${config.source.adapter}`);
      lines.push(`  root: ${config.source.root || '.'}`);
      lines.push('  include:');
      for (const pattern of config.source.include.slice(0, 2)) {
        lines.push(`    - "${pattern}"`);
      }
      if (config.source.include.length > 2) {
        lines.push(`    # ... and ${config.source.include.length - 2} more`);
      }
      if (config.source.exclude && config.source.exclude.length > 0) {
        lines.push('  exclude:');
        for (const pattern of config.source.exclude.slice(0, 2)) {
          lines.push(`    - "${pattern}"`);
        }
        if (config.source.exclude.length > 2) {
          lines.push(`    # ... and ${config.source.exclude.length - 2} more`);
        }
      }
      lines.push('```');
      lines.push('');
      lines.push('Each scope (function, class, method, etc.) gets:');
      lines.push('- A unique UUID');
      lines.push('- A content hash (for change detection)');
      lines.push('- Relationships (DEFINED_IN, CALLS, IMPORTS, etc.)');
      lines.push('');
    }

    // ⭐ CUSTOM YAML-GENERATED METHODS (added first!)
    lines.push('## ⭐ Custom Methods (Generated from YAML Config)');
    lines.push('');
    lines.push('This framework has been customized with methods generated from your `ragforge.config.yaml`:');
    lines.push('');

    // Collect custom semantic search methods
    const customSemanticMethods: string[] = [];
    for (const entity of config.entities) {
      const vectorIndexes = entity.vector_indexes || (entity.vector_index ? [entity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        const entityMethod = this.camelCase(entity.name);
        for (const index of vectorIndexes) {
          const sourceField = index.source_field || index.field || 'embedding';
          const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
          const indexName = index.name;
          const model = index.model || 'gemini-embedding-001';
          const dimension = index.dimension || 768;
          customSemanticMethods.push(
            `- **\`${entityMethod}().${methodName}(query, { topK?, minScore? })\`**\n  ` +
            `Searches using \`${indexName}\` (${model}, ${dimension}D, field: ${sourceField})`
          );
        }
      }
    }

    // Collect custom relationship filter methods
    const customRelationshipMethods: string[] = [];
    for (const entity of config.entities) {
      const entityMethod = this.camelCase(entity.name);
      if (entity.relationships?.length) {
        for (const rel of entity.relationships) {
          // Generate whereXxx filter methods
          const whereMethodName = this.camelCase(`where_${rel.type}`);
          customRelationshipMethods.push(
            `- **\`${entityMethod}().${whereMethodName}(targetName)\`**\n  ` +
            `Filter by ${rel.type} relationship${rel.description ? ` — ${rel.description}` : ''}`
          );

          // Generate withXxx expansion methods
          const withMethodName = this.camelCase(`with_${rel.type}`);
          customRelationshipMethods.push(
            `- **\`${entityMethod}().${withMethodName}(depth?)\`**\n  ` +
            `Expand ${rel.type} relationships (default depth: 1)`
          );
        }
      }
    }

    if (customSemanticMethods.length > 0) {
      lines.push('### Custom Semantic Search Methods');
      lines.push('');
      lines.push(...customSemanticMethods);
      lines.push('');
      lines.push('**Example:**');
      lines.push('```typescript');
      const firstEntity = config.entities[0];
      if (firstEntity) {
        const entityMethod = this.camelCase(firstEntity.name);
        const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
        if (vectorIndexes.length > 0) {
          const sourceField = vectorIndexes[0].source_field || vectorIndexes[0].field || 'embedding';
          const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
          lines.push(`const results = await rag.${entityMethod}()`);
          lines.push(`  .${methodName}('your search query', { topK: 50 })`);
          lines.push(`  .execute();`);
        }
      }
      lines.push('```');
      lines.push('');
    }

    if (customRelationshipMethods.length > 0) {
      lines.push('### Custom Relationship Methods');
      lines.push('');
      lines.push(...customRelationshipMethods);
      lines.push('');
      lines.push('**Example:**');
      lines.push('```typescript');
      const firstEntity = config.entities[0];
      if (firstEntity && firstEntity.relationships?.length) {
        const entityMethod = this.camelCase(firstEntity.name);
        const rel = firstEntity.relationships[0];
        const whereMethodName = this.camelCase(`where_${rel.type}`);
        const withMethodName = this.camelCase(`with_${rel.type}`);

        // Find a real entity name for expansion examples
        let expansionEntity = 'SomeName'; // fallback
        if (schema.workingExamples) {
          const entitiesWithRels = schema.workingExamples[`${firstEntity.name}.entitiesWithRelationships`];
          if (entitiesWithRels && Array.isArray(entitiesWithRels) && entitiesWithRels.length > 0 && entitiesWithRels[0].name) {
            expansionEntity = entitiesWithRels[0].name;
          }
        }

        lines.push(`// Filter by relationship`);
        lines.push(`const filtered = await rag.${entityMethod}()`);
        lines.push(`  .${whereMethodName}('TargetName')`);
        lines.push(`  .execute();`);
        lines.push('');
        lines.push(`// Expand relationships`);
        lines.push(`const expanded = await rag.${entityMethod}()`);
        lines.push(`  .whereName('${expansionEntity}')`);
        lines.push(`  .${withMethodName}(2)  // Get relationships 2 levels deep`);
        lines.push(`  .execute();`);
      }
      lines.push('```');
      lines.push('');
    }

    // LLM Reranking section
    lines.push('## 🤖 LLM Reranking');
    lines.push('');
    lines.push('The framework is pre-configured with a default LLM provider (Gemini API).');
    lines.push('Use `.llmRerank()` to intelligently rerank results — **no need to create a provider!**');
    lines.push('');
    lines.push('**Example:**');
    lines.push('```typescript');
    const firstEntity = config.entities[0];
    if (firstEntity) {
      const entityMethod = this.camelCase(firstEntity.name);
      const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        const sourceField = vectorIndexes[0].source_field || vectorIndexes[0].field || 'embedding';
        const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
        lines.push(`const results = await rag.${entityMethod}()`);
        lines.push(`  .${methodName}('database connection', { topK: 50 })`);
        lines.push(`  .llmRerank('where is the database connection initialized?', {`);
        lines.push(`    topK: 10,        // Rerank top 50, return best 10`);
        lines.push(`    minScore: 0.7    // Only high-confidence results`);
        lines.push(`  })`);
        lines.push(`  .execute();`);
        lines.push('');
        lines.push(`// Access LLM reasoning`);
        lines.push(`results.forEach(r => {`);
        lines.push(`  console.log(\`\${r.entity.name}: \${r.score.toFixed(3)}\`);`);
        lines.push(`  if (r.scoreBreakdown?.llmReasoning) {`);
        lines.push(`    console.log(\`  Why: \${r.scoreBreakdown.llmReasoning}\`);`);
        lines.push(`  }`);
        lines.push(`});`);
      }
    }
    lines.push('```');
    lines.push('');
    lines.push('**When to use LLM reranking:**');
    lines.push('- Complex queries requiring reasoning (e.g., "functions that handle errors gracefully")');
    lines.push('- When semantic search returns too many similar results');
    lines.push('- When you need understanding beyond keyword matching');
    lines.push('');
    lines.push('**Tip:** Start with broad semantic search (topK: 50-100), then llmRerank to top 5-10.');
    lines.push('');

    // Metadata section
    lines.push('## 📊 Pipeline Metadata & Observability');
    lines.push('');
    lines.push('Use `.executeWithMetadata()` to get detailed information about each pipeline operation:');
    lines.push('');
    lines.push('**Example:**');
    lines.push('```typescript');
    if (firstEntity) {
      const entityMethod = this.camelCase(firstEntity.name);
      const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        const sourceField = vectorIndexes[0].source_field || vectorIndexes[0].field || 'embedding';
        const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
        lines.push(`const { results, metadata } = await rag.${entityMethod}()`);
        lines.push(`  .${methodName}('neo4j driver', { topK: 50 })`);
        lines.push(`  .llmRerank('functions that create the neo4j driver', { topK: 10 })`);
        lines.push(`  .executeWithMetadata();`);
        lines.push('');
        lines.push(`// Inspect what happened in each step`);
        lines.push(`metadata.operations.forEach(op => {`);
        lines.push(`  console.log(\`\${op.type}: \${op.inputCount} → \${op.outputCount} (\${op.duration}ms)\`);`);
        lines.push('');
        lines.push(`  if (op.type === 'semantic') {`);
        lines.push(`    console.log(\`  Index: \${op.metadata?.vectorIndex}\`);`);
        lines.push(`    console.log(\`  Model: \${op.metadata?.model} (\${op.metadata?.dimension}D)\`);`);
        lines.push(`  }`);
        lines.push('');
        lines.push(`  if (op.type === 'llmRerank') {`);
        lines.push(`    console.log(\`  LLM: \${op.metadata?.llmModel}\`);`);
        lines.push(`    // Access detailed reasoning for each result`);
        lines.push(`    op.metadata?.evaluations?.forEach(e => {`);
        lines.push(`      console.log(\`    \${e.entityId}: \${e.score.toFixed(3)} - "\${e.reasoning}"\`);`);
        lines.push(`    });`);
        lines.push(`  }`);
        lines.push(`});`);
      }
    }
    lines.push('```');
    lines.push('');
    lines.push('### Custom Metadata Override');
    lines.push('');
    lines.push('Add custom metadata to any operation:');
    lines.push('');
    lines.push('```typescript');
    if (firstEntity) {
      const entityMethod = this.camelCase(firstEntity.name);
      const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
      if (vectorIndexes.length > 0) {
        const sourceField = vectorIndexes[0].source_field || vectorIndexes[0].field || 'embedding';
        const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
        lines.push(`const { results, metadata } = await rag.${entityMethod}()`);
        lines.push(`  .${methodName}('typescript parser', {`);
        lines.push(`    topK: 50,`);
        lines.push(`    metadataOverride: (results, defaultMeta) => ({`);
        lines.push(`      ...defaultMeta,`);
        lines.push(`      customNote: 'Focused on TS parsing',`);
        lines.push(`      avgScore: results.reduce((s, r) => s + r.score, 0) / results.length`);
        lines.push(`    })`);
        lines.push(`  })`);
        lines.push(`  .llmRerank('libraries for parsing typescript', {`);
        lines.push(`    topK: 10,`);
        lines.push(`    metadataOverride: (results, defaultMeta) => ({`);
        lines.push(`      ...defaultMeta,`);
        lines.push(`      topResult: results[0]?.entity.name`);
        lines.push(`    })`);
        lines.push(`  })`);
        lines.push(`  .executeWithMetadata();`);
        lines.push('');
        lines.push(`// Access custom metadata`);
        lines.push(`console.log(metadata.operations[0].metadata?.customNote);`);
        lines.push(`console.log(metadata.operations[1].metadata?.topResult);`);
      }
    }
    lines.push('```');
    lines.push('');

    // Agent helper
    lines.push('### Iterative Agent Helper');
    lines.push('');
    lines.push('```typescript');
    lines.push(`import { createIterativeAgent } from './agent.js';`);
    lines.push(`import type { LLMClient } from '@luciformresearch/ragforge-runtime';`);
    lines.push('');
    lines.push(`const llm: LLMClient = /* wrap your LLM */;`);
    lines.push(`const agent = createIterativeAgent({`);
    lines.push(`  llm,`);
    lines.push(`  workDir: './tmp',`);
    lines.push(`  ragClientPath: './client.js'`);
    lines.push(`});`);
    lines.push('');
    lines.push(`const answer = await agent.answer('How does OAuth token refresh work?');`);
    lines.push('```');
    lines.push('');
    lines.push('_Tip_: the runtime exposes `GeminiAPIProvider.fromEnv()` to bootstrap LLM reranking with `GEMINI_API_KEY`.');
    lines.push('');

    lines.push('## Entity Reference');
    lines.push('');

    for (const entity of config.entities) {
      const nodeSchema = schema.nodes.find(n => n.label === entity.name);
      const entityMethod = this.camelCase(entity.name);
      const vectorIndexes = entity.vector_indexes || (entity.vector_index ? [entity.vector_index] : []);

      lines.push(`### ${entity.name}`);
      if (entity.description) {
        lines.push(`> ${entity.description}`);
      }
      if (nodeSchema?.count !== undefined) {
        lines.push('');
        lines.push(`Approximate nodes: ${nodeSchema.count}`);
      }

      lines.push('');
      lines.push(`Usage: \`const builder = rag.${entityMethod}()\``);
      lines.push('');

      // Fields
      if (entity.searchable_fields.length > 0) {
        lines.push('**Searchable fields**');
        for (const field of entity.searchable_fields) {
          const description = field.description ? ` — ${field.description}` : '';
          const values = field.values && field.values.length ? ` (values: ${field.values.join(', ')})` : '';
          lines.push(`- \`${field.name}\` (${field.type})${description}${values}`);
        }
      } else {
        lines.push('**Searchable fields**');
        lines.push('- _none defined in config_');
      }
      lines.push('');

      // Query builder API
      lines.push('#### Query Builder Methods');
      lines.push('');
      lines.push(`- \`where(filter: ${entity.name}Filter)\``);

      for (const field of entity.searchable_fields) {
        const methodName = `where${this.capitalize(field.name)}`;
        let signature: string;
        switch (field.type) {
          case 'string':
            signature = 'string | { contains?: string; startsWith?: string; endsWith?: string }';
            break;
          case 'number':
            signature = 'number | { gt?: number; gte?: number; lt?: number; lte?: number }';
            break;
          case 'enum':
            signature = field.values?.length ? field.values.map(v => `'${v}'`).join(' | ') : 'string';
            break;
          default:
            signature = field.type;
        }
        lines.push(`- \`${methodName}(${signature})\`${field.description ? ` — ${field.description}` : ''}`);
      }

      if (vectorIndexes.length > 0) {
        for (const index of vectorIndexes) {
          const methodName = `semanticSearchBy${this.capitalize(index.source_field || index.field || 'embedding')}`;
          lines.push(`- \`${methodName}(query: string, options?: { topK?: number; minScore?: number })\``);
        }
      } else {
        lines.push('- Semantic helper not generated: use `.semantic(query, { topK, vectorIndex })`');
      }

      if (entity.relationships?.length) {
        for (const rel of entity.relationships) {
          const methodName = this.camelCase(`with_${rel.type}`);
          lines.push(`- \`${methodName}(depth?: number)\`${rel.description ? ` — ${rel.description}` : ''}`);
        }
      }

      if (config.reranking?.strategies?.length) {
        for (const strategy of config.reranking.strategies) {
          const methodName = this.camelCase(`rerank_by_${strategy.name}`);
          lines.push(`- \`${methodName}()\`${strategy.description ? ` — ${strategy.description}` : ''}`);
        }
      }

      lines.push('- `.limit(n)`, `.offset(n)`, `.orderBy(field, direction)`');
      lines.push('- `.expand(relType, { depth?, direction? })` for arbitrary relationship traversal');
      lines.push('');

      // Example
      lines.push('#### Example');
      lines.push('');
      lines.push('```typescript');
      lines.push(`const results = await rag.${entityMethod}()`);
      if (entity.searchable_fields.length > 0) {
        const firstField = entity.searchable_fields[0];
        const methodName = `where${this.capitalize(firstField.name)}`;
        if (firstField.type === 'string') {
          lines.push(`  .${methodName}({ contains: 'keyword' })`);
        } else {
          lines.push(`  .${methodName}(${firstField.type === 'number' ? '42' : `'value'`})`);
        }
      }
      if (vectorIndexes.length > 0) {
        const methodName = `semanticSearchBy${this.capitalize(vectorIndexes[0].source_field || vectorIndexes[0].field || 'embedding')}`;
        lines.push(`  .${methodName}('search query', { topK: 25 })`);
      } else {
        lines.push(`  .semantic('search query', { topK: 25 })`);
      }
      if (entity.relationships?.length) {
        const methodName = this.camelCase(`with_${entity.relationships[0].type}`);
        lines.push(`  .${methodName}(1)`);
      }
      if (config.reranking?.strategies?.length) {
        const methodName = this.camelCase(`rerank_by_${config.reranking.strategies[0].name}`);
        lines.push(`  .${methodName}()`);
      }
      lines.push('  .limit(10)');
      lines.push('  .execute();');
      lines.push('```');
      lines.push('');
    }

    if (config.reranking?.strategies?.length) {
      lines.push('## Reranking Strategies');
      lines.push('');
      for (const strategy of config.reranking.strategies) {
        const typeLabel = strategy.type === 'builtin' ? `(builtin ${strategy.algorithm})` : '(custom scorer)';
        lines.push(`- **${strategy.name}** ${typeLabel}${strategy.description ? ` — ${strategy.description}` : ''}`);
      }
      lines.push('');
    }

    // Generated Examples section
    if (exampleSummaries.length > 0) {
      lines.push('## 📚 Generated Examples');
      lines.push('');
      lines.push('The following examples demonstrate how to use the generated RAG client:');
      lines.push('');
      for (const summary of exampleSummaries) {
        lines.push(summary);
      }
    }

    lines.push('## Usage Patterns');
    lines.push('');
    lines.push('- Start broad with semantic search (topK high), then filter or rerank.');
    lines.push('- Use relationship helpers (with..., whereConsumesScope, etc.) to explore the graph.');
    lines.push('- Combine semantic search and relationship expansion to build rich context.');
    lines.push('- The iterative agent uses exactly these methods; provide clear objectives.');
    lines.push('');
    lines.push('---');
    lines.push('Generated automatically by RagForge.');

    return lines.join('\n');
  }

  /**
   * Generate TypeScript module exporting documentation string
   */
  private static generateDocumentationModule(documentation: string): string {
    const docLiteral = JSON.stringify(documentation);
    return `export const CLIENT_DOCUMENTATION = ${docLiteral};\n`;
  }

  /**
   * Generate enrichment config for an entity from its relationships
   */
  private static generateEnrichmentConfig(entity: EntityConfig): string {
    const enrichments = entity.relationships?.filter(r => r.enrich) || [];

    if (enrichments.length === 0) {
      return '';
    }

    const items = enrichments.map(rel => {
      return `{ type: '${rel.type}', direction: '${rel.direction}' as const, target: '${rel.target}', enrich: true, enrich_field: '${rel.enrich_field || rel.type.toLowerCase()}' }`;
    });

    return `[\n    ${items.join(',\n    ')}\n  ]`;
  }

  /**
   * Generate entity context for LLM reranker from entity config
   */
  private static generateEntityContext(entity: EntityConfig, schema: GraphSchema): string {
    const fields: string[] = [];
    const seen = new Set<string>();

    // Build a map of field names to their summarization config
    const summarizationMap = new Map<string, any>();
    for (const searchableField of entity.searchable_fields || []) {
      if (searchableField.summarization?.enabled) {
        summarizationMap.set(searchableField.name, searchableField.summarization);
      }
    }

    const addField = (name?: string, opts: { required?: boolean; label?: string; maxLength?: number; maxItems?: number; preferSummary?: boolean } = {}) => {
      if (!name) return;
      if (seen.has(name)) return;
      seen.add(name);
      const parts = [`name: '${name}'`];
      if (opts.required) parts.push('required: true');
      const label = opts.label ?? this.formatFieldLabel(name);
      if (label) {
        parts.push(`label: '${label}'`);
      }

      // Check if this field has summarization configured
      const hasSummarization = summarizationMap.has(name);
      const preferSummary = opts.preferSummary !== undefined ? opts.preferSummary : hasSummarization;

      if (preferSummary) {
        parts.push('preferSummary: true');
      } else {
        // Only add maxLength if NOT using summary (summaries don't need truncation)
        if (opts.maxLength) parts.push(`maxLength: ${opts.maxLength}`);
      }

      if (opts.maxItems) parts.push(`maxItems: ${opts.maxItems}`);
      fields.push(`{ ${parts.join(', ')} }`);
    };

    const displayField = this.getDisplayNameField(entity);
    addField(displayField, { required: true, maxLength: this.getDefaultFieldLength(displayField) });

    // Don't add unique_field to LLM context if it's a UUID/ID (not useful for semantic reranking)
    const isUuidField = entity.unique_field && (
      entity.unique_field.toLowerCase().includes('uuid') ||
      entity.unique_field.toLowerCase().includes('id')
    );

    if (entity.unique_field && entity.unique_field !== displayField && !isUuidField) {
      addField(entity.unique_field, { required: fields.length < 2, maxLength: this.getDefaultFieldLength(entity.unique_field) });
    }

    for (const fieldName of entity.example_display_fields || []) {
      addField(fieldName, { maxLength: this.getDefaultFieldLength(fieldName) });
    }

    for (const vectorIndex of entity.vector_indexes || (entity.vector_index ? [entity.vector_index] : [])) {
      addField(vectorIndex.source_field, { maxLength: this.getDefaultFieldLength(vectorIndex.source_field) });
    }

    const schemaFieldCandidates = this.collectSchemaFieldCandidates(schema, entity.name);
    const searchableCandidates = entity.searchable_fields.map(f => f.name);
    const combinedCandidates = [...searchableCandidates, ...schemaFieldCandidates];

    for (const candidate of combinedCandidates) {
      addField(candidate, { maxLength: this.getDefaultFieldLength(candidate) });
      if (fields.length >= 6) break;
    }

    if (fields.length === 0) {
      addField('name', { required: true, maxLength: 80 });
      addField('description', { maxLength: 400 });
    }

    const enrichments = (entity.relationships?.filter(r => r.enrich) || []).map(rel => {
      const fieldName = rel.enrich_field || rel.type.toLowerCase();
      const label = this.generateEnrichmentLabel(rel.type);
      return `{ fieldName: '${fieldName}', label: '${label}', maxItems: 10 }`;
    });

    const displayName = this.generateDisplayName(entity.name);

    // Add optional metadata fields if specified in config
    const uniqueFieldLine = entity.unique_field ? `uniqueField: '${entity.unique_field}',` : '';
    const queryFieldLine = entity.query_field ? `queryField: '${entity.query_field}',` : '';
    const exampleDisplayFieldsLine = entity.example_display_fields && entity.example_display_fields.length > 0
      ? `exampleDisplayFields: [${entity.example_display_fields.map(f => `'${f}'`).join(', ')}],`
      : '';

    return `{
    type: '${entity.name}',
    displayName: '${displayName}',
    ${uniqueFieldLine}
    ${queryFieldLine}
    ${exampleDisplayFieldsLine}
    fields: [
      ${fields.join(',\n      ')}
    ],
    enrichments: [
      ${enrichments.join(',\n      ')}
    ]
  }`;
  }

  private static generateEmbeddingsArtifacts(embeddings?: EmbeddingsConfig) {
    if (!embeddings) {
      return undefined;
    }

    const loader = loadTemplate('embeddings/load-config.ts');
    const createIndexesScript = this.generateCreateIndexesScript();
    const generateEmbeddingsScript = this.generateGenerateEmbeddingsScript();

    return {
      loader,
      createIndexesScript,
      generateEmbeddingsScript
    };
  }

  private static generateCreateIndexesScript(): string {
    return loadTemplate('scripts/create-vector-indexes.ts');
  }

  private static generateGenerateEmbeddingsScript(): string {
    return loadTemplate('scripts/generate-embeddings.ts');
  }

  /**
   * Generate summarization artifacts (prompts + script)
   */
  private static generateSummarizationArtifacts(config: RagForgeConfig) {
    // Check if any field has summarization enabled
    const hasSummarization = config.entities.some(entity =>
      entity.searchable_fields?.some(field => field.summarization?.enabled)
    );

    if (!hasSummarization && !config.summarization_strategies) {
      return undefined;
    }

    const prompts = new Map<string, string>();

    // Generate prompt templates for custom strategies
    if (config.summarization_strategies) {
      for (const [strategyId, strategy] of Object.entries(config.summarization_strategies)) {
        const promptContent = this.generatePromptTemplate(strategyId, strategy);
        prompts.set(`${strategyId}.txt`, promptContent);
      }
    }

    // Load generate-summaries script template
    const generateSummariesScript = loadTemplate('scripts/generate-summaries.ts');

    return {
      prompts,
      generateSummariesScript
    };
  }

  /**
   * Generate tool artifacts for agent interaction (Phase 2)
   */
  private static generateToolsArtifacts(config: RagForgeConfig) {
    // Generate tools metadata using Phase 1 tool generator
    const { tools, handlers } = generateToolsFromConfig(config);

    // Generate database-tools.ts (auto-generated, DO NOT EDIT)
    const databaseTools = this.generateDatabaseToolsFile(tools, handlers);

    // Generate custom-tools.ts template (user-editable, preserved)
    const customTools = this.generateCustomToolsTemplate(config);

    // Generate tools/index.ts (combines both)
    const index = this.generateToolsIndexFile();

    return {
      databaseTools,
      customTools,
      index
    };
  }

  /**
   * Generate database-tools.ts (auto-generated from config)
   */
  private static generateDatabaseToolsFile(tools: any[], handlers: any): string {
    const lines: string[] = [];

    // Warning header
    lines.push(`/**`);
    lines.push(` * AUTO-GENERATED DATABASE TOOLS`);
    lines.push(` * `);
    lines.push(` * ⚠️  DO NOT EDIT THIS FILE MANUALLY`);
    lines.push(` * This file is automatically generated from ragforge.config.yaml`);
    lines.push(` * Run 'ragforge generate' to regenerate`);
    lines.push(` * `);
    lines.push(` * For custom tools, use custom-tools.ts instead`);
    lines.push(` */`);
    lines.push(``);

    // Imports
    lines.push(`import type { RagClient } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import type { Tool } from '@luciformresearch/ragforge-runtime';`);
    lines.push(``);

    // Tool definitions as JSON
    lines.push(`/**`);
    lines.push(` * Generated tool definitions`);
    lines.push(` */`);
    lines.push(`export const DATABASE_TOOLS: Tool[] = ${JSON.stringify(tools, null, 2)};`);
    lines.push(``);

    // Handler setup function
    lines.push(`/**`);
    lines.push(` * Attach handlers to database tools`);
    lines.push(` * @param ragClient - RAG client instance`);
    lines.push(` */`);
    lines.push(`export function attachDatabaseHandlers(ragClient: RagClient): Map<string, Function> {`);
    lines.push(`  const handlers = new Map<string, Function>();`);
    lines.push(``);
    lines.push(`  // Note: Handler attachment logic would go here`);
    lines.push(`  // This is simplified for now - full implementation in Phase 2`);
    lines.push(``);
    lines.push(`  return handlers;`);
    lines.push(`}`);
    lines.push(``);

    return lines.join('\n');
  }

  /**
   * Generate custom-tools.ts template (user-editable)
   */
  private static generateCustomToolsTemplate(config: RagForgeConfig): string {
    const lines: string[] = [];

    // Get first entity for examples
    const firstEntity = config.entities[0];
    const entityName = firstEntity?.name || 'Entity';
    const uniqueField = firstEntity ? this.getUniqueField(firstEntity) : 'uuid';
    const displayField = firstEntity ? this.getDisplayNameField(firstEntity) : 'name';
    const entityLower = entityName.toLowerCase();
    const toolExample = `analyze_${entityLower}_complexity`;
    const descExample = `Analyze ${entityName.toLowerCase()} complexity and provide metrics`;

    lines.push(`/**`);
    lines.push(` * CUSTOM TOOLS`);
    lines.push(` * `);
    lines.push(` * ✅ You can freely edit this file`);
    lines.push(` * This file is preserved across 'ragforge generate' runs`);
    lines.push(` * `);
    lines.push(` * Add your custom tool definitions and handlers here`);
    lines.push(` */`);
    lines.push(``);
    lines.push(`import type { RagClient } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import type { Tool } from '@luciformresearch/ragforge-runtime';`);
    lines.push(``);
    lines.push(`/**`);
    lines.push(` * Custom tool definitions`);
    lines.push(` * `);
    lines.push(` * Example:`);
    lines.push(` * `);
    lines.push(` * export const CUSTOM_TOOLS: Tool[] = [`);
    lines.push(` *   {`);
    lines.push(` *     name: '${toolExample}',`);
    lines.push(` *     description: '${descExample}',`);
    lines.push(` *     inputSchema: {`);
    lines.push(` *       type: 'object',`);
    lines.push(` *       properties: {`);
    lines.push(` *         ${uniqueField}: { type: 'string', description: '${entityName} ${uniqueField}' }`);
    lines.push(` *       },`);
    lines.push(` *       required: ['${uniqueField}']`);
    lines.push(` *     }`);
    lines.push(` *   }`);
    lines.push(` * ];`);
    lines.push(` */`);
    lines.push(`export const CUSTOM_TOOLS: Tool[] = [];`);
    lines.push(``);
    lines.push(`/**`);
    lines.push(` * Attach handlers to custom tools`);
    lines.push(` * @param ragClient - RAG client instance`);
    lines.push(` */`);
    lines.push(`export function attachCustomHandlers(ragClient: RagClient): Map<string, Function> {`);
    lines.push(`  const handlers = new Map<string, Function>();`);
    lines.push(``);
    lines.push(`  // Add your custom handlers here`);
    lines.push(`  // Example:`);
    lines.push(`  // handlers.set('${toolExample}', async (args: { ${uniqueField}: string }) => {`);
    lines.push(`  //   const result = await ragClient.get('${entityName}')`);
    lines.push(`  //     .where('${uniqueField}', '=', args.${uniqueField})`);
    lines.push(`  //     .execute();`);
    lines.push(`  //   // Analyze and return results`);
    lines.push(`  //   return { complexity: 'medium', metrics: {} };`);
    lines.push(`  // });`);
    lines.push(``);
    lines.push(`  return handlers;`);
    lines.push(`}`);
    lines.push(``);

    return lines.join('\n');
  }

  /**
   * Generate tools/index.ts (combines database + custom)
   */
  private static generateToolsIndexFile(): string {
    const lines: string[] = [];

    lines.push(`/**`);
    lines.push(` * TOOL REGISTRY SETUP`);
    lines.push(` * `);
    lines.push(` * Combines auto-generated database tools with custom tools`);
    lines.push(` */`);
    lines.push(``);
    lines.push(`import type { RagClient } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import { ToolRegistry } from '@luciformresearch/ragforge-runtime';`);
    lines.push(`import { DATABASE_TOOLS, attachDatabaseHandlers } from './database-tools.js';`);
    lines.push(`import { CUSTOM_TOOLS, attachCustomHandlers } from './custom-tools.js';`);
    lines.push(``);
    lines.push(`/**`);
    lines.push(` * Setup tool registry with all available tools`);
    lines.push(` * `);
    lines.push(` * @param ragClient - RAG client instance`);
    lines.push(` * @returns Configured ToolRegistry`);
    lines.push(` * `);
    lines.push(` * @example`);
    lines.push(` * const registry = setupToolRegistry(ragClient);`);
    lines.push(` * const agent = new AgentRuntime({ registry });`);
    lines.push(` */`);
    lines.push(`export function setupToolRegistry(ragClient: RagClient): ToolRegistry {`);
    lines.push(`  const registry = new ToolRegistry();`);
    lines.push(``);
    lines.push(`  // Register database tools`);
    lines.push(`  const dbHandlers = attachDatabaseHandlers(ragClient);`);
    lines.push(`  for (const tool of DATABASE_TOOLS) {`);
    lines.push(`    const handler = dbHandlers.get(tool.name);`);
    lines.push(`    if (handler) {`);
    lines.push(`      registry.registerTool(tool, handler);`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(``);
    lines.push(`  // Register custom tools`);
    lines.push(`  const customHandlers = attachCustomHandlers(ragClient);`);
    lines.push(`  for (const tool of CUSTOM_TOOLS) {`);
    lines.push(`    const handler = customHandlers.get(tool.name);`);
    lines.push(`    if (handler) {`);
    lines.push(`      registry.registerTool(tool, handler);`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(``);
    lines.push(`  return registry;`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`// Re-export for convenience`);
    lines.push(`export { DATABASE_TOOLS } from './database-tools.js';`);
    lines.push(`export { CUSTOM_TOOLS } from './custom-tools.js';`);
    lines.push(``);

    return lines.join('\n');
  }

  /**
   * Generate a prompt template file for a strategy
   */
  private static generatePromptTemplate(strategyId: string, strategy: any): string {
    let template = '';

    // System context
    template += strategy.system_prompt || 'Analyze the content and extract structured information.';
    template += '\n\n';

    // User task section
    template += 'Content to analyze:\n';
    template += '{{field_value}}\n\n';

    // Instructions
    if (strategy.instructions) {
      template += strategy.instructions;
      template += '\n\n';
    }

    // Output format
    template += 'IMPORTANT: Respond with XML ONLY. Do NOT use JSON or markdown.\n\n';
    template += 'Expected format:\n\n';
    template += `<${strategy.output_schema.root}>\n`;

    for (const field of strategy.output_schema.fields) {
      if (field.type === 'array') {
        template += `  <${field.name}>Value 1</${field.name}>\n`;
        template += `  <${field.name}>Value 2</${field.name}>\n`;
      } else {
        template += `  <${field.name}>Value</${field.name}>\n`;
      }
    }

    template += `</${strategy.output_schema.root}>\n\n`;
    template += 'Your XML response:';

    return template;
  }

  /**
   * Generate enrichment label from relationship type
   */
  private static generateEnrichmentLabel(relType: string): string {
    const labels: Record<string, string> = {
      'CONSUMES': 'Uses',
      'CONSUMED_BY': 'Used by',
      'PURCHASED_WITH': 'Often bought with',
      'FOLLOWS': 'Follows',
      'FOLLOWED_BY': 'Followed by',
      'LINKS_TO': 'Links to',
      'SIMILAR_TO': 'Similar to'
    };

    return labels[relType] || relType.replace(/_/g, ' ');
  }

  /**
   * Generate display name (pluralize)
   */
  private static generateDisplayName(entityName: string): string {
    const lower = entityName.toLowerCase();

    // Special cases
    if (lower === 'scope') return 'code scopes';
    if (lower.endsWith('y')) return `${lower.slice(0, -1)}ies`;
    if (lower.endsWith('s')) return lower;

    return `${lower}s`;
  }

  /**
   * Generate example TypeScript files
   */
  private static generateExamples(config: RagForgeConfig, schema: GraphSchema): { examples: Map<string, string>, exampleSummaries: string[] } {
    const examples = new Map<string, string>();
    const exampleSummaries: string[] = [];

    // Get first entity with vector indexes for examples
    const firstEntity = config.entities[0];
    if (!firstEntity) return { examples, exampleSummaries };

    const entityMethod = this.camelCase(firstEntity.name);
    const entityDisplayName = this.generateDisplayName(firstEntity.name);
    const vectorIndexes = firstEntity.vector_indexes || (firstEntity.vector_index ? [firstEntity.vector_index] : []);
    const relationships = firstEntity.relationships || [];

    let exampleNum = 1;

    // Generate semantic search examples for each vector index
    for (const index of vectorIndexes) {
      const sourceField = index.source_field || index.field;
      const methodName = `semanticSearchBy${this.capitalize(sourceField)}`;
      // Priority: YAML config > real data from database > generic fallback
      const query = index.example_query
        || this.getFieldExample(schema, firstEntity.name, sourceField)
        || `your ${sourceField} query here`;

      examples.set(`${String(exampleNum).padStart(2, '0')}-semantic-search-${sourceField.toLowerCase()}`, this.generateSemanticSearchExample(
        firstEntity,
        entityMethod,
        methodName,
        `Semantic search by ${sourceField}`,
        `Search ${entityDisplayName} using ${index.name} vector index`,
        `Find ${entityDisplayName} by semantic similarity to ${sourceField}`,
        `semantic, ${sourceField}`,
        query,
        50
      ));
      exampleNum++;
    }

    // Generate relationship filtering examples (only for relationships with custom filters)
    for (const rel of relationships) {
      // Only generate examples for relationships with custom filter methods
      if (!rel.filters || rel.filters.length === 0) {
        continue;
      }

      // Use the first filter method defined in YAML
      const firstFilter = rel.filters[0];
      const whereMethod = firstFilter.name;
      const paramName = firstFilter.parameter || 'entityName';
      const withMethod = this.camelCase(`with_${rel.type}`);

      // Priority: YAML config > popular targets > working example from introspection > real data from target entity > relationshipExamples > generic fallback
      let exampleTarget = rel.example_target;

      // Try to find a popular target first (e.g., parent with many children for HAS_PARENT)
      // This ensures filter examples return actual results
      if (!exampleTarget && schema.workingExamples) {
        const popularTargets = schema.workingExamples[`${firstEntity.name}.popularTargets`];
        if (popularTargets && Array.isArray(popularTargets)) {
          const matchingTarget = popularTargets.find((ex: any) =>
            ex.relType === rel.type && ex.targetLabel === rel.target
          );
          if (matchingTarget) {
            exampleTarget = matchingTarget.targetName;
          }
        }
      }

      // Fallback: Try to find any working example from introspection
      if (!exampleTarget && schema.workingExamples) {
        const relExamples = schema.workingExamples[`${firstEntity.name}.relationshipExamplesWithTargets`];
        if (relExamples && Array.isArray(relExamples)) {
          const matchingRel = relExamples.find((ex: any) =>
            ex.relType === rel.type && ex.targetLabel === rel.target
          );
          if (matchingRel) {
            exampleTarget = matchingRel.targetName;
          }
        }
      }

      // Fallback to target entity's first searchable field
      if (!exampleTarget && rel.target) {
        const targetEntity = config.entities.find(e => e.name === rel.target);
        if (targetEntity && targetEntity.searchable_fields.length > 0) {
          const firstField = targetEntity.searchable_fields[0].name;
          exampleTarget = this.getFieldExample(schema, rel.target, firstField);
        }
      }

      exampleTarget = exampleTarget || schema.relationshipExamples?.[rel.type] || 'TargetName';

      // Find an entity name for expansion examples (entity that has relationships to expand from)
      let expansionEntity = 'SomeName'; // fallback
      if (schema.workingExamples) {
        const entitiesWithRels = schema.workingExamples[`${firstEntity.name}.entitiesWithRelationships`];
        if (entitiesWithRels && Array.isArray(entitiesWithRels) && entitiesWithRels.length > 0) {
          // Try to find an entity that specifically has THIS relationship type
          const entityWithThisRel = entitiesWithRels.find((e: any) =>
            e.relationships?.some((r: any) => r.type === rel.type)
          );
          if (entityWithThisRel && entityWithThisRel.name) {
            expansionEntity = entityWithThisRel.name;
          } else if (entitiesWithRels[0].name) {
            // Fall back to any entity with relationships
            expansionEntity = entitiesWithRels[0].name;
          }
        }
      }

      examples.set(`${String(exampleNum).padStart(2, '0')}-relationship-${rel.type.toLowerCase()}`, this.generateRelationshipExample(
        firstEntity,
        entityMethod,
        whereMethod,
        withMethod,
        rel.type,
        exampleTarget,
        expansionEntity,
        `Filter and expand by ${rel.type}`,
        `Use ${rel.type} relationship to find connected ${entityDisplayName}`,
        `Find ${entityDisplayName} related through ${rel.type}`,
        `relationships, ${rel.type.toLowerCase()}, graph`
      ));
      exampleNum++;
    }

    // LLM Reranking (only if we have at least one vector index)
    if (vectorIndexes.length > 0) {
      const firstIndex = vectorIndexes[0];
      const methodName = `semanticSearchBy${this.capitalize(firstIndex.source_field || firstIndex.field)}`;
      // Priority: YAML config > real data from database > generic fallback
      const semanticQuery = firstIndex.example_query
        || this.getFieldExample(schema, firstEntity.name, firstIndex.source_field || firstIndex.field)
        || 'your search query';
      // LLM question contextualized with the semantic search query
      const llmQuestion = `find the most relevant ${entityDisplayName} around this semantic search: ${semanticQuery}`;

      // Collect available filter methods (1 custom + up to 2 non-custom)
      const filterMethods: string[] = [];

      // Add one custom relationship filter if available (only if it has filters defined)
      const relWithFilters = relationships.find(r => r.filters && r.filters.length > 0);
      if (relWithFilters && relWithFilters.filters) {
        const firstFilter = relWithFilters.filters[0];
        filterMethods.push(`.${firstFilter.name}()`);
      }

      // Add up to 2 non-custom filters from searchable_fields
      const fieldFilters = firstEntity.searchable_fields
        .slice(0, 2)
        .map(field => `.where${this.capitalize(field.name)}()`);
      filterMethods.push(...fieldFilters);

      // Collect available relationship expansion methods
      const relationshipMethods = relationships
        .slice(0, 2)
        .map(rel => `.${this.camelCase(`with_${rel.type}`)}()`);

      examples.set(`${String(exampleNum).padStart(2, '0')}-llm-reranking`, this.generateLLMRerankExample(
        firstEntity,
        entityMethod,
        methodName,
        'LLM reranking for better relevance',
        'Semantic search followed by LLM reranking',
        `Find most relevant ${entityDisplayName} using AI reasoning`,
        'llm, reranking, advanced',
        semanticQuery,
        llmQuestion,
        filterMethods,
        relationshipMethods
      ));
      exampleNum++;
    }

    // Metadata tracking (only if we have at least one vector index)
    if (vectorIndexes.length > 0) {
      const firstIndex = vectorIndexes[0];
      const methodName = `semanticSearchBy${this.capitalize(firstIndex.source_field || firstIndex.field)}`;
      // Priority: YAML config > real data from database > generic fallback
      const query = firstIndex.example_query
        || this.getFieldExample(schema, firstEntity.name, firstIndex.source_field || firstIndex.field)
        || 'your search query';

      examples.set(`${String(exampleNum).padStart(2, '0')}-metadata-tracking`, this.generateMetadataExample(
        entityMethod,
        methodName,
        'Pipeline metadata and observability',
        'Track each operation in the query pipeline',
        'Debug and optimize query pipelines',
        'metadata, observability, debugging',
        query,
        entityDisplayName
      ));
      exampleNum++;
    }

    // Complex pipeline (only if we have vector indexes and relationships with filters)
    const relWithFiltersForPipeline = relationships.find(r => r.filters && r.filters.length > 0);
    if (vectorIndexes.length > 0 && relWithFiltersForPipeline && relWithFiltersForPipeline.filters) {
      const firstIndex = vectorIndexes[0];
      const firstFilter = relWithFiltersForPipeline.filters[0];
      const methodName = `semanticSearchBy${this.capitalize(firstIndex.source_field || firstIndex.field)}`;
      const whereMethod = firstFilter.name;
      const withMethod = this.camelCase(`with_${relWithFiltersForPipeline.type}`);
      // Priority: YAML config > real data from database > generic fallback
      const semanticQuery = firstIndex.example_query
        || this.getFieldExample(schema, firstEntity.name, firstIndex.source_field || firstIndex.field)
        || 'your search query';

      // Priority: YAML config > working example from introspection > real data from target entity > relationshipExamples > generic fallback
      let exampleTarget = relWithFiltersForPipeline.example_target;

      // Try to find a working example from introspection (guaranteed to have results)
      if (!exampleTarget && schema.workingExamples) {
        const relExamples = schema.workingExamples[`${firstEntity.name}.relationshipExamplesWithTargets`];
        if (relExamples && Array.isArray(relExamples)) {
          const matchingRel = relExamples.find((ex: any) =>
            ex.relType === relWithFiltersForPipeline.type && ex.targetLabel === relWithFiltersForPipeline.target
          );
          if (matchingRel) {
            exampleTarget = matchingRel.targetName;
          }
        }
      }

      // Fallback to target entity's first searchable field
      if (!exampleTarget && relWithFiltersForPipeline.target) {
        const targetEntity = config.entities.find(e => e.name === relWithFiltersForPipeline.target);
        if (targetEntity && targetEntity.searchable_fields.length > 0) {
          const firstField = targetEntity.searchable_fields[0].name;
          exampleTarget = this.getFieldExample(schema, relWithFiltersForPipeline.target, firstField);
        }
      }

      exampleTarget = exampleTarget || schema.relationshipExamples?.[relWithFiltersForPipeline.type] || 'TargetName';

      examples.set(`${String(exampleNum).padStart(2, '0')}-complex-pipeline`, this.generateComplexPipelineExample(
        entityMethod,
        methodName,
        whereMethod,
        withMethod,
        'Complex multi-stage pipeline',
        'Combine semantic search, filters, LLM reranking, and relationship expansion',
        'Build sophisticated queries with multiple operations',
        'pipeline, advanced, complex',
        semanticQuery,
        entityDisplayName,
        exampleTarget
      ));
      exampleNum++;
    }

    // Advanced examples (only if we have both vector indexes and relationships)
    if (vectorIndexes.length > 0 && relationships.length > 0) {
      const firstIndex = vectorIndexes[0];
      const methodName = `semanticSearchBy${this.capitalize(firstIndex.source_field || firstIndex.field)}`;
      const firstRel = relationships[0];
      const withMethod = this.camelCase(`with_${firstRel.type}`);

      // Conditional Search Strategy
      examples.set(`${String(exampleNum).padStart(2, '0')}-conditional-search`, this.generateConditionalSearchExample(
        entityMethod,
        methodName,
        entityDisplayName
      ));
      exampleNum++;

      // Breadth-First Exploration (if at least 2 relationships)
      if (relationships.length >= 2) {
        // Try to find an entity with relationships for the entry point
        let entryPoint = 'TargetName';
        if (schema.workingExamples) {
          const entitiesWithRels = schema.workingExamples[`${firstEntity.name}.entitiesWithRelationships`];
          if (entitiesWithRels && Array.isArray(entitiesWithRels) && entitiesWithRels.length > 0) {
            entryPoint = entitiesWithRels[0].name || 'TargetName';
          }
        }

        examples.set(`${String(exampleNum).padStart(2, '0')}-breadth-first`, this.generateBreadthFirstExample(
          entityMethod,
          relationships.slice(0, 3).map(r => this.camelCase(`with_${r.type}`)),
          entityDisplayName,
          entryPoint
        ));
        exampleNum++;
      }

      // Stopping Criteria
      examples.set(`${String(exampleNum).padStart(2, '0')}-stopping-criteria`, this.generateStoppingCriteriaExample(
        entityMethod,
        methodName,
        entityDisplayName
      ));
      exampleNum++;
    }

    // Generate mutation examples
    // Find entities with relationships for mutation examples
    const entitiesWithRelationships = config.entities.filter(e =>
      e.relationships && e.relationships.length > 0
    );

    if (entitiesWithRelationships.length > 0) {
      const mainEntity = entitiesWithRelationships[0];
      const relatedEntities = (mainEntity.relationships || [])
        .map(rel => config.entities.find(e => e.name === rel.target))
        .filter((e): e is typeof config.entities[number] => e !== undefined);

      // CRUD example
      examples.set(`${String(exampleNum).padStart(2, '0')}-mutations-crud`, this.generateCrudExample(
        mainEntity,
        relatedEntities[0]
      ));
      exampleNum++;

      // Batch mutations example
      if (relatedEntities.length >= 2) {
        examples.set(`${String(exampleNum).padStart(2, '0')}-batch-mutations`, this.generateBatchMutationsExample(
          config.entities
        ));
        exampleNum++;
      }
    }

    // Extract summaries from generated examples (just the function body code)
    for (const [filename, code] of examples.entries()) {
      const summary = this.extractExampleSummary(filename, code);
      if (summary) {
        exampleSummaries.push(summary);
      }
    }

    return { examples, exampleSummaries };
  }

  /**
   * Extract a concise summary from generated example code
   * Extracts the function body to show what the example does
   */
  private static extractExampleSummary(filename: string, code: string): string | null {
    // Extract function name from JSDoc @example tag
    const exampleMatch = code.match(/@example\s+(.+)/);
    const exampleTitle = exampleMatch ? exampleMatch[1] : filename;

    // Extract intent from JSDoc @intent tag
    const intentMatch = code.match(/@intent\s+(.+)/);
    const intent = intentMatch ? intentMatch[1] : '';

    // Extract the function body (between first { after "async function" and last })
    const functionMatch = code.match(/async function \w+\(\) \{([\s\S]+)\n\}/);
    if (!functionMatch) return null;

    let body = functionMatch[1];

    // Remove the boilerplate lines (createRagClient, close, return)
    body = body
      .replace(/\s*const rag = createRagClient\(\);.*\n/g, '')
      .replace(/\s*await rag\.close\(\);.*\n/g, '')
      .replace(/\s*return \{?.+\}?;.*\n/g, '')
      .trim();

    // Limit to first 15 lines for brevity
    const lines = body.split('\n');
    const limitedLines = lines.slice(0, 15);
    const truncated = lines.length > 15;

    let summary = `### ${exampleTitle}\n`;
    if (intent) {
      summary += `*${intent}*\n\n`;
    }
    summary += '```typescript\n';
    summary += limitedLines.join('\n');
    if (truncated) {
      summary += `\n  // ... (${lines.length - 15} more lines)`;
    }
    summary += '\n```\n';

    return summary;
  }

  /**
   * Generate example boilerplate wrapper
   */
  private static generateExampleWrapper(
    title: string,
    description: string,
    intent: string,
    tags: string,
    bodyCode: string,
    returnStatement: string = 'return results;'
  ): string {
    const functionName = this.camelCase(title.replace(/[^a-zA-Z0-9]/g, '_'));
    return `import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example ${title}
 * @description ${description}
 * @intent ${intent}
 * @tags ${tags}
 */
async function ${functionName}() {
  const rag = createRagClient(); // Uses .env variables automatically

${bodyCode}

  await rag.close();
  ${returnStatement}
}

export { ${functionName} };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    ${functionName}()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
`;
  }

  /**
   * Generate a semantic search example
   */
  private static generateSemanticSearchExample(
    entity: EntityConfig,
    entityMethod: string,
    searchMethod: string,
    title: string,
    description: string,
    intent: string,
    tags: string,
    query: string,
    topK: number
  ): string {
    const displayNameField = this.getDisplayNameField(entity);
    const displayFields = this.getExampleDisplayFields(entity);

    // Build parts array for concatenation
    const parts: string[] = [`'  - ' + entity.${displayNameField}`];
    for (const field of displayFields) {
      parts.push(`(entity.${field} ? ' (in ' + entity.${field} + ')' : '')`);
    }
    parts.push(`' (score: ' + r.score.toFixed(3) + ')'`);

    const displayCode = `console.log(${parts.join(' + ')});`;

    // Sanitize query for safe insertion into generated code
    const sanitizedQuery = this.sanitizeQueryExample(query);

    const bodyCode = `  console.log('🔎 Semantic search for: "${sanitizedQuery}"');
  const results = await rag.${entityMethod}()
    .${searchMethod}('${sanitizedQuery}', { topK: ${topK} })
    .execute();

  console.log(\`\\nFound \${results.length} results:\`);
  results.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    ${displayCode}
  });
  if (results.length > 5) {
    console.log(\`  ... and \${results.length - 5} more\`);
  }`;

    return this.generateExampleWrapper(title, description, intent, tags, bodyCode);
  }

  /**
   * Generate a relationship filtering example
   */
  private static generateRelationshipExample(
    entity: EntityConfig,
    entityMethod: string,
    whereMethod: string,
    withMethod: string,
    relType: string,
    exampleTarget: string,
    expansionEntity: string,
    title: string,
    description: string,
    intent: string,
    tags: string
  ): string {
    const displayNameField = this.getDisplayNameField(entity);
    const queryField = this.getQueryField(entity);
    const displayFields = this.getExampleDisplayFields(entity);

    // Build parts array for concatenation
    const parts: string[] = [`'  - ' + entity.${displayNameField}`];
    for (const field of displayFields) {
      parts.push(`(entity.${field} ? ' (in ' + entity.${field} + ')' : '')`);
    }

    const displayCode = `console.log(${parts.join(' + ')});`;

    const bodyCode = `  console.log('🔍 Filtering by ${relType} relationship...');
  const filtered = await rag.${entityMethod}()
    .${whereMethod}('${exampleTarget}')
    .execute();

  console.log(\`\\nFound \${filtered.length} items with ${relType} relationship:\`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    ${displayCode}
  });
  if (filtered.length > 5) {
    console.log(\`  ... and \${filtered.length - 5} more\`);
  }

  console.log('\\n🔗 Expanding relationships from "${expansionEntity}"...');
  const expanded = await rag.${entityMethod}()
    .where${this.capitalize(queryField)}('${expansionEntity}')
    .${withMethod}(2)  // Get relationships 2 levels deep
    .execute();

  console.log(\`\\nFound \${expanded.length} items with expanded context:\`);
  expanded.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    ${displayCode}
  });
  if (expanded.length > 5) {
    console.log(\`  ... and \${expanded.length - 5} more\`);
  }`;

    return this.generateExampleWrapper(title, description, intent, tags, bodyCode, 'return { filtered, expanded };');
  }

  /**
   * Generate LLM reranking example
   */
  private static generateLLMRerankExample(
    entity: EntityConfig,
    entityMethod: string,
    searchMethod: string,
    title: string,
    description: string,
    intent: string,
    tags: string,
    semanticQuery: string,
    llmQuestion: string,
    filterMethods: string[],
    relationshipMethods: string[]
  ): string {
    const displayNameField = this.getDisplayNameField(entity);
    const displayFields = this.getExampleDisplayFields(entity);

    // Build parts array for concatenation
    const parts: string[] = [`'  - ' + entity.${displayNameField}`];
    for (const field of displayFields) {
      parts.push(`(entity.${field} ? ' (in ' + entity.${field} + ')' : '')`);
    }
    parts.push(`': ' + r.score.toFixed(3)`);

    const displayCode = `console.log(${parts.join(' + ')});`;

    // Sanitize queries for safe insertion into generated code
    const sanitizedSemanticQuery = this.sanitizeQueryExample(semanticQuery);
    const sanitizedLlmQuestion = this.sanitizeQueryExample(llmQuestion);

    const highlightFields = [displayNameField, ...displayFields];
    const highlightExpr = highlightFields.length > 0
      ? `  const highlights = [${highlightFields.map(field => `entity.${field} ? '${field}: ' + entity.${field} : null`).join(', ')}]
    .filter(Boolean)
    .join(' | ');
  console.log(\`    Why: matches "${sanitizedSemanticQuery}" → \${highlights || 'high semantic similarity'}\`);`
      : `  console.log('    Why: high semantic similarity to "${sanitizedSemanticQuery}"');`;

    // Build dynamic comment showing available methods
    const filtersList = filterMethods.length > 0
      ? `\n  //   - Filters: ${filterMethods.join(', ')}`
      : '';
    const relationshipsList = relationshipMethods.length > 0
      ? `\n  //   - Relationships: ${relationshipMethods.join(', ')}`
      : '';

    const bodyCode = `  console.log('🔎 Semantic search: "${sanitizedSemanticQuery}"');
  console.log('🤖 Then reranking with LLM: "${sanitizedLlmQuestion}"');

  // NOTE: llmRerank() can be used after ANY operation that returns results.
  // In this example, we use it after .${searchMethod}(), but you can also use it after:${filtersList}${relationshipsList}
  //   - Or even directly without prior operations
  const results = await rag.${entityMethod}()
    .${searchMethod}('${sanitizedSemanticQuery}', { topK: 50 })
    .llmRerank('${sanitizedLlmQuestion}', {
      topK: 10,
      minScore: 0.7
    })
    .execute();

  console.log(\`\\nFound \${results.length} results after LLM reranking:\`);
  results.forEach(r => {
    const entity = r.entity as any;
    ${displayCode}
${highlightExpr}
    if (r.scoreBreakdown?.llmReasoning) {
      console.log(\`    Why (LLM): \${r.scoreBreakdown.llmReasoning}\`);
    }
    if (typeof r.scoreBreakdown?.llmScore === 'number') {
      console.log(\`    LLM score contribution: \${r.scoreBreakdown.llmScore.toFixed(3)}\`);
    }
  });`;

    return this.generateExampleWrapper(title, description, intent, tags, bodyCode);
  }

  /**
   * Generate metadata tracking example
   */
  private static generateMetadataExample(
    entityMethod: string,
    searchMethod: string,
    title: string,
    description: string,
    intent: string,
    tags: string,
    query: string,
    entityDisplayName: string
  ): string {
    // Sanitize query for safe insertion into generated code
    const sanitizedQuery = this.sanitizeQueryExample(query);

    const bodyCode = `  const { results, metadata } = await rag.${entityMethod}()
    .${searchMethod}('${sanitizedQuery}', { topK: 50 })
    .llmRerank('find ${entityDisplayName} related to: ${sanitizedQuery}', { topK: 10 })
    .executeWithMetadata();

  console.log(\`Pipeline executed in \${metadata.totalDuration}ms\`);
  console.log(\`Final result count: \${metadata.finalCount}\`);

  metadata.operations.forEach((op, idx) => {
    console.log(\`\\n[\${idx + 1}] \${op.type.toUpperCase()}\`);
    console.log(\`  Duration: \${op.duration}ms\`);
    console.log(\`  Results: \${op.inputCount} → \${op.outputCount}\`);

    if (op.type === 'semantic' && op.metadata) {
      console.log(\`  Index: \${op.metadata.vectorIndex}\`);
      console.log(\`  Model: \${op.metadata.model} (\${op.metadata.dimension}D)\`);
    }

    if (op.type === 'llmRerank' && op.metadata) {
      console.log(\`  LLM: \${op.metadata.llmModel}\`);
      console.log(\`  Evaluations: \${op.metadata.evaluations?.length}\`);
    }
  });`;

    return this.generateExampleWrapper(title, description, intent, tags, bodyCode, 'return { results, metadata };');
  }

  /**
   * Generate complex pipeline example
   */
  private static generateComplexPipelineExample(
    entityMethod: string,
    searchMethod: string,
    whereMethod: string,
    withMethod: string,
    title: string,
    description: string,
    intent: string,
    tags: string,
    semanticQuery: string,
    entityDisplayName: string,
    exampleTarget: string
  ): string {
    // Sanitize query for safe insertion into generated code
    const sanitizedSemanticQuery = this.sanitizeQueryExample(semanticQuery);

    const bodyCode = `  // Multi-stage pipeline:
  // 1. Semantic search (broad)
  // 2. Filter (focus)
  // 3. LLM rerank (quality)
  // 4. Expand relationships (complete context)
  // 5. Track metadata (observe)
  const { results, metadata } = await rag.${entityMethod}()
    .${searchMethod}('${sanitizedSemanticQuery}', { topK: 100 })
    .${whereMethod}('${exampleTarget}')
    .llmRerank('find the most relevant ${entityDisplayName}', { topK: 20 })
    .${withMethod}(1)
    .executeWithMetadata();

  console.log(\`\\n🎯 Pipeline Results\`);
  console.log(\`Total time: \${metadata.totalDuration}ms\`);
  console.log(\`Final results: \${results.length}\`);

  console.log(\`\\n📊 Pipeline stages:\`);
  metadata.operations.forEach((op, idx) => {
    console.log(\`  [\${idx + 1}] \${op.type}: \${op.inputCount} → \${op.outputCount} (\${op.duration}ms)\`);
  });

  console.log(\`\\n🔝 Top results:\`);
  results.slice(0, 5).forEach((r, idx) => {
    console.log(\`  [\${idx + 1}] \${r.entity.name} (score: \${r.score.toFixed(3)})\`);
    if (r.scoreBreakdown?.llmReasoning) {
      console.log(\`      → \${r.scoreBreakdown.llmReasoning}\`);
    }
  });`;

    return this.generateExampleWrapper(title, description, intent, tags, bodyCode, 'return { results, metadata };');
  }

  /**
   * Generate conditional search strategy example
   */
  private static generateConditionalSearchExample(
    entityMethod: string,
    searchMethod: string,
    entityDisplayName: string
  ): string {
    const bodyCode = `  // Initial broad search
  let results = await rag.${entityMethod}()
    .${searchMethod}('query', { topK: 50 })
    .execute();

  console.log(\`Found \${results.length} initial results\`);

  // Decision 1: Too few results? Broaden query
  if (results.length < 5) {
    console.log('Too few results, broadening query...');
    results = await rag.${entityMethod}()
      .${searchMethod}('broader query terms', { topK: 50 })
      .execute();
  }

  // Decision 2: Too many results? Add filter or rerank
  if (results.length > 30) {
    console.log('Too many results, refining with llmRerank...');
    results = await rag.${entityMethod}()
      .${searchMethod}('query', { topK: 50 })
      .llmRerank('specific question', { topK: 10 })
      .execute();
  }

  // Decision 3: Get context for top results if found
  if (results.length > 0) {
    console.log(\`Final: \${results.length} results\`);
    results.slice(0, 3).forEach(r => {
      console.log(\`  - \${r.entity.name} (score: \${r.score.toFixed(3)})\`);
    });
  }`;

    return this.generateExampleWrapper(
      'Conditional search strategy',
      'Adapt search based on initial results',
      'Demonstrate decision-making based on result count and quality',
      'conditional, adaptive, strategy',
      bodyCode,
      'return results;'
    );
  }

  /**
   * Generate breadth-first exploration example
   */
  private static generateBreadthFirstExample(
    entityMethod: string,
    relationshipMethods: string[],
    entityDisplayName: string,
    entryPointName: string = 'TargetName'
  ): string {
    const relMethods = relationshipMethods.slice(0, 3);
    const relCalls = relMethods.map(m => `    .${m}(1)`).join('\n');

    const bodyCode = `  // Find entry point
  const entry = await rag.${entityMethod}()
    .whereName('${entryPointName}')
    .execute();

  if (entry.length === 0) {
    console.log('Entry point not found');
    return { context: [] };
  }

  // Breadth-first: Get immediate neighborhood
  const context = await rag.${entityMethod}()
    .whereName('${entryPointName}')
${relCalls}
    .execute();

  console.log(\`Breadth-first context: \${context.length} ${entityDisplayName}\`);

  // Analyze immediate context by relationship type
  context.forEach(r => {
    const relTypes = r.context?.related?.map(rel => rel.relationshipType).join(', ');
    console.log(\`  - \${r.entity.name} (related via: \${relTypes || 'direct'})\`);
  });`;

    return this.generateExampleWrapper(
      'Breadth-first context exploration',
      'Get immediate neighborhood around an entity',
      'Map local context by exploring 1-hop relationships',
      'breadth-first, exploration, context',
      bodyCode,
      'return { context };'
    );
  }

  /**
   * Generate stopping criteria example
   */
  private static generateStoppingCriteriaExample(
    entityMethod: string,
    searchMethod: string,
    entityDisplayName: string
  ): string {
    const bodyCode = `  const MAX_ITERATIONS = 3;
  const TARGET_RESULTS = 5;
  const MIN_SCORE = 0.8;

  let allResults: any[] = [];
  let iteration = 0;
  let shouldContinue = true;

  while (shouldContinue && iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(\`\\nIteration \${iteration}\`);

    // Progressive search strategy
    const query = iteration === 1 ? 'initial query' : 'refined query';

    const results = await rag.${entityMethod}()
      .${searchMethod}(query, { topK: 30 })
      .execute();

    allResults = [...allResults, ...results];
    console.log(\`  Found \${results.length} results\`);

    // Stopping criteria
    const highQuality = allResults.filter(r => r.score >= MIN_SCORE);

    if (highQuality.length >= TARGET_RESULTS) {
      console.log(\`  ✅ STOP: Found \${highQuality.length} high-quality results\`);
      shouldContinue = false;
    } else if (results.length === 0) {
      console.log(\`  ⚠️ STOP: No results, need different strategy\`);
      shouldContinue = false;
    } else if (iteration === MAX_ITERATIONS) {
      console.log(\`  ⏱️ STOP: Max iterations reached\`);
    } else {
      console.log(\`  🔄 CONTINUE: Only \${highQuality.length}/\${TARGET_RESULTS} high-quality\`);
    }
  }

  console.log(\`\\nFinal: \${allResults.length} total, \${iteration} iterations\`);`;

    return this.generateExampleWrapper(
      'Stopping criteria logic',
      'Demonstrate when to stop searching',
      'Show decision logic for iterative search with quality thresholds',
      'stopping, criteria, iterative, quality',
      bodyCode,
      'return allResults;'
    );
  }

  /**
   * Generate CRUD mutations example
   */
  private static generateCrudExample(
    mainEntity: EntityConfig,
    relatedEntity?: EntityConfig
  ): string {
    const mainEntityMethod = this.camelCase(mainEntity.name);
    const mainEntityCreate = `${mainEntity.name}Create`;
    const mainEntityUpdate = `${mainEntity.name}Update`;
    const uniqueField = mainEntity.unique_field || 'uuid';

    let relatedEntityCreate = '';
    let relatedEntityMethod = '';
    let relationshipType = '';
    let addRelationshipMethod = '';
    let removeRelationshipMethod = '';

    if (relatedEntity && mainEntity.relationships && mainEntity.relationships.length > 0) {
      const rel = mainEntity.relationships[0];
      relatedEntityMethod = this.camelCase(relatedEntity.name);
      relatedEntityCreate = `${relatedEntity.name}Create`;
      relationshipType = rel.type;
      addRelationshipMethod = this.camelCase(`add_${rel.type}`);
      removeRelationshipMethod = this.camelCase(`remove_${rel.type}`);
    }

    // Get sample fields from the entity (excluding unique field)
    const mainFields = mainEntity.searchable_fields
      .filter(f => f.name !== uniqueField)
      .slice(0, 3)
      .map(f => f.name);
    const relatedUniqueField = relatedEntity ? (relatedEntity.unique_field || 'uuid') : uniqueField;
    const relatedFields = relatedEntity ?
      relatedEntity.searchable_fields
        .filter(f => f.name !== relatedUniqueField)
        .slice(0, 2)
        .map(f => f.name) : [];

    // Check if relatedEntity is the same as mainEntity (self-referential relationship)
    const isSelfReferential = relatedEntity && relatedEntity.name === mainEntity.name;

    const bodyCode = `  console.log('📚 Testing CRUD mutations\\n');

  ${!isSelfReferential && relatedEntity ? `// 1. Create a new ${relatedEntity.name.toLowerCase()}
  console.log('1️⃣ Creating a new ${relatedEntity.name.toLowerCase()}...');
  const new${relatedEntity.name}: ${relatedEntityCreate} = {
    ${uniqueField}: '${relatedEntity.name.toLowerCase()}-test-001',${relatedFields.map((f, i) => `\n    ${f}: 'Sample ${f} ${i + 1}'`).join(',')}
  };

  const created${relatedEntity.name} = await rag.${relatedEntityMethod}Mutations().create(new${relatedEntity.name});
  console.log('✅ ${relatedEntity.name} created:', created${relatedEntity.name});
  console.log();

  // 2. Create a new ${mainEntity.name.toLowerCase()}
  console.log('2️⃣ Creating a new ${mainEntity.name.toLowerCase()}...');` : `// 1. Create a new ${mainEntity.name.toLowerCase()}
  console.log('1️⃣ Creating a new ${mainEntity.name.toLowerCase()}...');`}
  const new${mainEntity.name}: ${mainEntityCreate} = {
    ${uniqueField}: '${mainEntity.name.toLowerCase()}-test-001',${mainFields.map((f, i) => `\n    ${f}: 'Sample ${f} ${i + 1}'`).join(',')}
  };

  const created${mainEntity.name} = await rag.${mainEntityMethod}Mutations().create(new${mainEntity.name});
  console.log('✅ ${mainEntity.name} created:', created${mainEntity.name});
  console.log();

  ${relatedEntity && relationshipType ? `// ${!isSelfReferential ? '3' : '2'}. Add relationship: ${mainEntity.name} ${relationshipType} ${relatedEntity.name}
  console.log('${!isSelfReferential ? '3' : '2'}️⃣ Linking ${mainEntity.name.toLowerCase()} to ${relatedEntity.name.toLowerCase()}...');
  await rag.${mainEntityMethod}Mutations().${addRelationshipMethod}('${mainEntity.name.toLowerCase()}-test-001', '${relatedEntity.name.toLowerCase()}-test-001');
  console.log('✅ Relationship added: ${mainEntity.name} ${relationshipType} ${relatedEntity.name}');
  console.log();

  // ${!isSelfReferential ? '4' : '3'}. Update the ${mainEntity.name.toLowerCase()}
  console.log('${!isSelfReferential ? '4' : '3'}️⃣ Updating ${mainEntity.name.toLowerCase()}...');` : `// ${!isSelfReferential ? '3' : '2'}. Update the ${mainEntity.name.toLowerCase()}
  console.log('${!isSelfReferential ? '3' : '2'}️⃣ Updating ${mainEntity.name.toLowerCase()}...');`}
  const ${mainEntityMethod}Update: ${mainEntityUpdate} = {
    ${mainFields[1]}: 'Updated ${mainFields[1]}'
  };

  const updated${mainEntity.name} = await rag.${mainEntityMethod}Mutations().update('${mainEntity.name.toLowerCase()}-test-001', ${mainEntityMethod}Update);
  console.log('✅ ${mainEntity.name} updated:', updated${mainEntity.name});
  console.log();

  ${relatedEntity && relationshipType ? `// ${!isSelfReferential ? '5' : '4'}. Remove the relationship
  console.log('${!isSelfReferential ? '5' : '4'}️⃣ Removing ${mainEntity.name.toLowerCase()}-${relatedEntity.name.toLowerCase()} relationship...');
  await rag.${mainEntityMethod}Mutations().${removeRelationshipMethod}('${mainEntity.name.toLowerCase()}-test-001', '${relatedEntity.name.toLowerCase()}-test-001');
  console.log('✅ Relationship removed');
  console.log();

  // ${!isSelfReferential ? '6' : '5'}. Delete the ${mainEntity.name.toLowerCase()}
  console.log('${!isSelfReferential ? '6' : '5'}️⃣ Deleting the ${mainEntity.name.toLowerCase()}...');` : `// ${!isSelfReferential ? '4' : '3'}. Delete the ${mainEntity.name.toLowerCase()}
  console.log('${!isSelfReferential ? '4' : '3'}️⃣ Deleting the ${mainEntity.name.toLowerCase()}...');`}
  await rag.${mainEntityMethod}Mutations().delete('${mainEntity.name.toLowerCase()}-test-001');
  console.log('✅ ${mainEntity.name} deleted');
  console.log();

  ${relatedEntity && !isSelfReferential ? `// 7. Delete the ${relatedEntity.name.toLowerCase()}
  console.log('7️⃣ Deleting the ${relatedEntity.name.toLowerCase()}...');
  await rag.${relatedEntityMethod}Mutations().delete('${relatedEntity.name.toLowerCase()}-test-001');
  console.log('✅ ${relatedEntity.name} deleted');
  console.log();` : ''}

  console.log('✨ All CRUD operations completed successfully!');`;

    return this.generateExampleWrapper(
      'CRUD operations with mutations',
      `Create, update, and delete ${mainEntity.name} entities${relatedEntity ? ` with ${relationshipType} relationships` : ''}`,
      'mutation, crud, create, update, delete, relationships',
      'crud, mutations, create, update, delete',
      bodyCode,
      ''
    );
  }

  /**
   * Generate batch mutations example
   */
  private static generateBatchMutationsExample(entities: EntityConfig[]): string {
    const firstThreeEntities = entities.slice(0, 3);
    const uniqueField = firstThreeEntities[0].unique_field || 'uuid';

    const createBatchSections = firstThreeEntities.map((entity, idx) => {
      const entityMethod = this.camelCase(entity.name);
      const entityCreate = `${entity.name}Create`;
      const entityUniqueField = entity.unique_field || 'uuid';
      const fields = entity.searchable_fields
        .filter(f => f.name !== entityUniqueField)
        .slice(0, 2);

      return `  // ${idx + 1}. Create multiple ${entity.name} entities in batch
  console.log('${idx + 1}️⃣ Creating multiple ${entity.name.toLowerCase()} entities in batch...');
  const new${entity.name}s: ${entityCreate}[] = [
    {
      ${uniqueField}: '${entity.name.toLowerCase()}-batch-001',${fields.map((f, i) => `\n      ${f.name}: 'Sample ${entity.name} 1 ${f.name}'`).join(',')}
    },
    {
      ${uniqueField}: '${entity.name.toLowerCase()}-batch-002',${fields.map((f, i) => `\n      ${f.name}: 'Sample ${entity.name} 2 ${f.name}'`).join(',')}
    },
    {
      ${uniqueField}: '${entity.name.toLowerCase()}-batch-003',${fields.map((f, i) => `\n      ${f.name}: 'Sample ${entity.name} 3 ${f.name}'`).join(',')}
    }
  ];

  const created${entity.name}s = await rag.${entityMethod}Mutations().createBatch(new${entity.name}s);
  console.log(\`✅ Created \${created${entity.name}s.length} ${entity.name.toLowerCase()} entities\`);
  created${entity.name}s.forEach(item => {
    console.log(\`   - \${item.${entity.display_name_field || fields[0].name}}\`);
  });
  console.log();`;
    }).join('\n\n');

    const cleanupSections = firstThreeEntities.map((entity, idx) => {
      const entityMethod = this.camelCase(entity.name);
      return `    for (const item of created${entity.name}s) {
      await rag.${entityMethod}Mutations().delete(item.${uniqueField});
    }
    console.log('   ✅ Deleted all ${entity.name.toLowerCase()} entities');`;
    }).join('\n\n');

    const bodyCode = `  console.log('📦 Testing batch mutations\\n');

${createBatchSections}

  // ${firstThreeEntities.length + 1}. Cleanup - delete everything
  console.log('${firstThreeEntities.length + 1}️⃣ Cleaning up...');

${cleanupSections}
  console.log();

  console.log('✨ Batch operations completed successfully!');`;

    return this.generateExampleWrapper(
      'Batch mutations',
      'Create multiple entities in a single transaction for better performance',
      'mutation, batch, createBatch, performance, transaction',
      'batch, mutations, createBatch',
      bodyCode,
      ''
    );
  }

  /**
   * Helper: capitalize string
   */
  private static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Helper: convert to camelCase
   */
  private static camelCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/[_-]([a-z])/g, (_, letter) => letter.toUpperCase())
      .replace(/^[A-Z]/, letter => letter.toLowerCase());
  }

  /**
   * Helper: get a real example value for a field from introspected schema data
   * Returns first example value if available, otherwise undefined
   */
  private static getFieldExample(schema: GraphSchema, entityLabel: string, fieldName: string): string | undefined {
    if (!schema.fieldExamples) return undefined;

    const key = `${entityLabel}.${fieldName}`;
    const examples = schema.fieldExamples[key];

    if (examples && examples.length > 0) {
      // Return first example value
      return examples[0];
    }

    return undefined;
  }

  /**
   * Sanitize and truncate query examples for generated code
   *
   * Ensures query strings are safe to use in TypeScript code by:
   * - Removing newlines and collapsing whitespace
   * - Escaping quotes
   * - Intelligently truncating long queries
   * - Extracting signatures from code patterns
   *
   * @param query - Raw query string (may contain newlines, code, etc.)
   * @returns Sanitized query safe for insertion into generated code
   */
  private static sanitizeQueryExample(query: string | null | undefined): string {
    if (!query) return '';

    // Remove newlines and extra spaces
    let sanitized = query
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Escape single quotes (since generated code uses single quotes)
    sanitized = sanitized.replace(/'/g, "\\'");

    // Intelligent truncation
    const SOFT_LIMIT = 100;
    const HARD_LIMIT = 150;

    if (sanitized.length <= SOFT_LIMIT) {
      // Perfect length, keep as-is
      return sanitized;
    }

    if (sanitized.length <= HARD_LIMIT) {
      // Acceptable length, but prefer to truncate at word boundary
      const lastSpace = sanitized.lastIndexOf(' ', SOFT_LIMIT);
      if (lastSpace > 60) {  // Don't truncate too early
        return sanitized.substring(0, lastSpace) + '...';
      }
      return sanitized;  // Keep full if we can't find good boundary
    }

    // Too long - intelligent extraction
    // If it looks like code (has 'function', 'class', etc.), extract just the signature
    if (sanitized.match(/^(function|class|interface|const|let|var|export)\s+\w+/)) {
      const match = sanitized.match(/^[^{(]+/);  // Get everything before { or (
      if (match && match[0].length < HARD_LIMIT) {
        return match[0].trim() + '...';
      }
    }

    // Otherwise just truncate at word boundary
    const truncateAt = sanitized.lastIndexOf(' ', SOFT_LIMIT);
    if (truncateAt > 60) {
      return sanitized.substring(0, truncateAt) + '...';
    }

    // Last resort: hard cut
    return sanitized.substring(0, SOFT_LIMIT - 3) + '...';
  }

  private static formatFieldLabel(fieldName: string): string {
    const words = fieldName
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(' ')
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    return words.join(' ');
  }

  private static getDefaultFieldLength(fieldName: string): number {
    const lower = fieldName.toLowerCase();
    if (lower.includes('description') || lower.includes('content') || lower.includes('summary')) {
      return 400;
    }
    if (lower.includes('source') || lower.includes('body') || lower.includes('code')) {
      return 300;
    }
    return 120;
  }

  /**
   * Generate source code ingestion scripts if source config is present
   */
  private static generateSourceScripts(config: RagForgeConfig): {
    ingestFromSource?: string;
    setup?: string;
    cleanDb?: string;
    watch?: string;
    changeStats?: string;
  } | undefined {
    if (!config.source) {
      return undefined;
    }

    const { include, adapter, exclude = [], root = '.' } = config.source;
    const hasEmbeddings = !!config.embeddings;
    const hasSummarization = !!config.summarization_strategies;
    const hasWatch = !!config.watch?.enabled;
    const hasChangeTracking = config.source.track_changes || config.entities.some(e => e.track_changes);

    // Calculate root path: if root is '.', use projectRoot (config file location)
    // otherwise resolve relative to projectRoot
    const rootPathExpression = root === '.'
      ? 'projectRoot'
      : `path.resolve(projectRoot, '${root}')`;

    const ingestFromSource = `/**
 * Ingest code from configured source paths
 * Generated by RagForge
 *
 * This script reads the source configuration from ragforge.config.yaml
 * to ensure correct path resolution regardless of where it's run from.
 */

import { IncrementalIngestionManager } from '@luciformresearch/ragforge-runtime';
import { createRagClient } from '../client.js';
import { loadConfig } from '../load-config.js';

const rag = createRagClient();

console.log('🔄 Starting code ingestion...\\n');

const manager = new IncrementalIngestionManager(rag.client);

// Load source configuration from ragforge.config.yaml
// This ensures correct path resolution when running from generated/ directory
const fullConfig = await loadConfig();
const sourceConfig = fullConfig.source;

if (!sourceConfig) {
  throw new Error('No source configuration found in ragforge.config.yaml');
}

console.log('📋 Source configuration loaded from config:');
console.log(\`   Type: \${sourceConfig.type}\`);
console.log(\`   Adapter: \${sourceConfig.adapter}\`);
console.log(\`   Root: \${sourceConfig.root}\`);
console.log('');

try {
  // Parse and ingest (incremental by default)
  const stats = await manager.ingestFromPaths(sourceConfig, {
    incremental: true,
    verbose: true
  });

  console.log('\\n✅ Ingestion complete!');
  console.log(\`   Created: \${stats.created}\`);
  console.log(\`   Updated: \${stats.updated}\`);
  console.log(\`   Unchanged: \${stats.unchanged}\`);
  console.log(\`   Deleted: \${stats.deleted}\`);

} catch (error) {
  console.error('❌ Ingestion failed:', error);
  process.exit(1);
} finally {
  await rag.close();
}
`;

    const setup = `/**
 * Complete setup script
 * Runs: ingestion → indexes → embeddings → summaries
 * Generated by RagForge
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(\`Command failed with code \${code}\`));
    });
  });
}

async function main() {
  console.log('🚀 RagForge Setup - Complete Initialization\\n');
  console.log('='.repeat(60));

  // Step 1: Ingest code
  console.log('\\n📥 Step 1/${hasEmbeddings && hasSummarization ? '4' : hasEmbeddings ? '3' : '1'}: Ingesting code...\\n');
  await runCommand('npm', ['run', 'ingest']);

${hasEmbeddings ? `  // Step 2: Create vector indexes
  console.log('\\n📊 Step 2/${hasSummarization ? '4' : '3'}: Creating vector indexes...\\n');
  await runCommand('npm', ['run', 'embeddings:index']);

  // Step 3: Generate embeddings
  console.log('\\n🔢 Step 3/${hasSummarization ? '4' : '3'}: Generating embeddings...\\n');
  await runCommand('npm', ['run', 'embeddings:generate']);
` : ''}
${hasSummarization ? `  // Step ${hasEmbeddings ? '4' : '2'}: Generate summaries
  console.log('\\n📝 Step ${hasEmbeddings ? '4' : '2'}/${hasEmbeddings ? '4' : '2'}: Generating summaries...\\n');
  await runCommand('npm', ['run', 'summaries:generate']);
` : ''}
  console.log('\\n' + '='.repeat(60));
  console.log('✅ Setup complete! Your RAG system is ready.\\n');
}

main().catch(error => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
`;

    const cleanDb = `/**
 * Clean the database
 * Deletes all nodes and relationships
 * Generated by RagForge
 */

import { createRagClient } from '../client.js';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const rag = createRagClient();

async function main() {
  console.log('⚠️  WARNING: This will delete ALL data in the database!\\n');

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('Are you sure you want to continue? (yes/no): ');
  rl.close();

  if (answer.toLowerCase() !== 'yes') {
    console.log('Operation cancelled.');
    await rag.close();
    return;
  }

  console.log('\\n🗑️  Deleting all nodes and relationships...');

  try {
    await rag.client.run('MATCH (n) DETACH DELETE n');
    console.log('✅ Database cleaned successfully!');
  } catch (error) {
    console.error('❌ Failed to clean database:', error);
    process.exit(1);
  } finally {
    await rag.close();
  }
}

main();
`;

    // Watch script (only if watch is enabled in config)
    const watch = hasWatch ? `/**
 * Watch source files and automatically ingest changes
 * Uses batching to efficiently handle multiple file changes
 * Generated by RagForge
 */

import { IncrementalIngestionManager, FileWatcher } from '@luciformresearch/ragforge-runtime';
import { createRagClient } from '../client.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const rag = createRagClient();
const manager = new IncrementalIngestionManager(rag.client);

// Source configuration (from ragforge.config.yaml)
const sourceConfig = {
  type: 'code' as const,
  root: path.resolve(projectRoot, '..', '${root}'),
  include: ${JSON.stringify(include)},
  exclude: ${JSON.stringify(exclude)},
  adapter: '${adapter}' as const
};

// Watch configuration
const watchConfig = {
  batchInterval: ${config.watch?.batch_interval ?? 1000},
  verbose: ${config.watch?.verbose ?? true},
  onBatchStart: (fileCount: number) => {
    console.log(\`\\n🔄 Processing batch of \${fileCount} file(s)...\`);
  },
  onBatchComplete: (stats) => {
    console.log(\`✅ Batch complete: \${stats.created + stats.updated} scope(s) updated\`);
    ${config.watch?.auto_embed ? `
    // Auto-generate embeddings for dirty scopes only
    if (stats.created + stats.updated > 0) {
      console.log('🔢 Generating embeddings for modified scopes...');
      spawn('npm', ['run', 'embeddings:generate', '--', '--only-dirty'], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true
      });
    }
    ` : ''}
  },
  onBatchError: (error) => {
    console.error('❌ Batch failed:', error);
  }
};

console.log('👀 Starting file watcher...\\n');
console.log('   Watching patterns:');
${include.map(p => `console.log('     - ${p}');`).join('\n')}
${exclude.length > 0 ? `console.log('\\n   Ignoring patterns:');
${exclude.map(p => `console.log('     - ${p}');`).join('\n')}` : ''}
console.log(\`\\n   Batch interval: ${config.watch?.batch_interval ?? 1000}ms\`);
console.log('   Press Ctrl+C to stop\\n');

const watcher = new FileWatcher(manager, sourceConfig, watchConfig);

try {
  await watcher.start();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\\n\\n🛑 Stopping watcher...');
    await watcher.stop();
    await rag.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
} catch (error) {
  console.error('❌ Watcher failed:', error);
  await rag.close();
  process.exit(1);
}
` : undefined;

    // Change stats script (only if change tracking is enabled)
    const changeStats = hasChangeTracking ? loadTemplate('scripts/change-stats.ts') : undefined;

    return {
      ingestFromSource,
      setup,
      cleanDb,
      ...(watch ? { watch } : {}),
      ...(changeStats ? { changeStats } : {})
    };
  }

  private static collectSchemaFieldCandidates(schema: GraphSchema, entityName: string): string[] {
    const candidates: string[] = [];
    if (!schema.fieldExamples) {
      return candidates;
    }

    for (const [key, values] of Object.entries(schema.fieldExamples)) {
      if (!key.startsWith(`${entityName}.`)) {
        continue;
      }
      const [, fieldName] = key.split('.');
      if (!fieldName || values.length === 0) {
        continue;
      }
      candidates.push(fieldName);
    }

    return candidates;
  }

  /**
   * Generate text2cypher script for natural language to Cypher conversion
   */
  private static generateText2Cypher(config: RagForgeConfig, schema: GraphSchema): string {
    // Build schema description for the prompt
    const entities = config.entities || [];
    const entityDescriptions = entities.map(e => {
      const fields = e.searchable_fields?.map(f => f.name).join(', ') || '';
      return `- ${e.name}: ${fields}`;
    }).join('\n');

    // Get relationships from schema
    const relationships = schema.relationships?.map(r => `- (${r.startNode})-[:${r.type}]->(${r.endNode})`).join('\n') || '';

    return `/**
 * Text2Cypher - Natural Language to Cypher Query
 *
 * Converts natural language questions to Cypher queries using Gemini.
 *
 * Usage:
 *   npx tsx text2cypher.ts "Your question here"
 *   npm run ask "Your question here"
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@luciformresearch/ragforge-runtime';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const client = createClient({
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  }
});

// Pre-defined schema from config
const SCHEMA = \`
## Graph Schema

### Entities:
${entityDescriptions}

### Relationships:
${relationships}

### Important Notes:
- Use MATCH (n:Label) to query specific node types
- Use toLower() for case-insensitive text search
- Limit results to avoid large outputs
\`;

async function generateCypher(question: string): Promise<string> {
  const prompt = \`You are a Neo4j Cypher expert. Generate a Cypher query to answer the question.

\${SCHEMA}

## Rules:
- Return ONLY the Cypher query, no explanations
- Use clear aliases in RETURN (AS readable_name)
- Limit results to 20 maximum
- For text search, use CONTAINS or toLower() for case-insensitive

## Question:
\${question}

## Cypher:\`;

  const result = await model.generateContent(prompt);
  return result.response.text()
    .replace(/\\\`\\\`\\\`cypher\\n?/g, '')
    .replace(/\\\`\\\`\\\`\\n?/g, '')
    .trim();
}

async function executeAndFormat(cypher: string): Promise<void> {
  console.log('\\n📝 Generated Cypher:');
  console.log('─'.repeat(50));
  console.log(cypher);
  console.log('─'.repeat(50));

  try {
    const result = await client.raw(cypher);
    console.log(\`\\n📊 Results (\${result.records.length} rows):\\n\`);

    if (result.records.length === 0) {
      console.log('  (no results)');
      return;
    }

    const keys = result.records[0].keys;
    for (const record of result.records) {
      const values = keys.map(key => {
        let val = record.get(key);
        if (val === null || val === undefined) return \`\${key}: (null)\`;
        if (typeof val === 'object' && val.low !== undefined) val = val.low;
        if (typeof val === 'string' && val.length > 100) val = val.substring(0, 100) + '...';
        return \`\${key}: \${val}\`;
      });
      console.log('  ' + values.join(' | '));
    }
  } catch (error: any) {
    console.error('\\n❌ Query Error:', error.message);
  }
}

async function main() {
  const question = process.argv.slice(2).join(' ');

  if (!question) {
    console.log('Usage: npx tsx text2cypher.ts "Your question"');
    console.log('   or: npm run ask "Your question"');
    console.log('\\nExamples:');
    console.log('  npm run ask "List all documents"');
    console.log('  npm run ask "How many nodes of each type?"');
    process.exit(1);
  }

  console.log('🤔 Question:', question);

  try {
    console.log('🧠 Generating Cypher...');
    const cypher = await generateCypher(question);
    await executeAndFormat(cypher);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
`;
  }
}
