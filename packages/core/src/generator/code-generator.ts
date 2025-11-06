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
  client: string;                // main client code
  index: string;                 // index.ts exports
  agent: string;                 // iterative agent wrapper
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
  examples: Map<string, string>; // example name -> TypeScript example code
  rebuildAgentScript: string;    // Script to rebuild agent documentation
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

    // Generate query builder for each entity
    for (const entity of config.entities) {
      const code = this.generateQueryBuilder(entity, config);
      queries.set(entity.name.toLowerCase(), code);
    }

    // Generate main client
    const client = this.generateClient(config, schema);

    // Generate index exports
    const index = this.generateIndex(config);

    // Generate examples
    const { examples, exampleSummaries } = this.generateExamples(config, schema);

    // Generate two documentations
    const agentMarkdown = this.generateAgentDocumentation(config, schema, exampleSummaries);
    const agentModule = this.generateDocumentationModule(agentMarkdown);
    const developerMarkdown = this.generateDeveloperDocumentation(config, schema, exampleSummaries);

    const agent = this.generateAgent(config);
    const embeddingsArtifacts = this.generateEmbeddingsArtifacts(config.embeddings);

    // Load rebuild agent script template
    const rebuildAgentScript = loadTemplate('rebuild-agent.ts');

    return {
      queries,
      client,
      index,
      agent,
      agentDocumentation: {
        markdown: agentMarkdown,
        module: agentModule
      },
      developerDocumentation: {
        markdown: developerMarkdown
      },
      embeddings: embeddingsArtifacts,
      examples,
      rebuildAgentScript
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
      }
    }

    // Generate reranking methods
    if (config.reranking?.strategies) {
      for (const strategy of config.reranking.strategies) {
        lines.push(...this.generateRerankMethod(strategy));
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

    return lines;
  }

  /**
   * Generate method for relationship traversal
   */
  private static generateRelationshipMethod(rel: any): string[] {
    const lines: string[] = [];
    const methodName = this.camelCase(`with_${rel.type}`);

    lines.push(`  /**`);
    lines.push(`   * Include related entities via ${rel.type}`);
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

      const entityContext = this.generateEntityContext(entity, schema);
      lines.push(`  // Entity context for LLM reranker (generated from YAML config)`);
      lines.push(`  private ${this.camelCase(entity.name)}EntityContext = ${entityContext};`);
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

    // Export types
    lines.push(`export * from './types.js';`);
    lines.push(``);

    // Export docs + agent
    lines.push(`export { CLIENT_DOCUMENTATION } from './documentation.js';`);
    lines.push(`export { createIterativeAgent, type GeneratedAgentConfig } from './agent.js';`);

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
    const addField = (name?: string, opts: { required?: boolean; label?: string; maxLength?: number; maxItems?: number } = {}) => {
      if (!name) return;
      if (seen.has(name)) return;
      seen.add(name);
      const parts = [`name: '${name}'`];
      if (opts.required) parts.push('required: true');
      const label = opts.label ?? this.formatFieldLabel(name);
      if (label) {
        parts.push(`label: '${label}'`);
      }
      if (opts.maxLength) parts.push(`maxLength: ${opts.maxLength}`);
      if (opts.maxItems) parts.push(`maxItems: ${opts.maxItems}`);
      fields.push(`{ ${parts.join(', ')} }`);
    };

    const displayField = this.getDisplayNameField(entity);
    addField(displayField, { required: true, maxLength: this.getDefaultFieldLength(displayField) });

    if (entity.unique_field && entity.unique_field !== displayField) {
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

      // Priority: YAML config > working example from introspection > real data from target entity > relationshipExamples > generic fallback
      let exampleTarget = rel.example_target;

      // Try to find a working example from introspection (guaranteed to have results)
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

    const bodyCode = `  console.log('🔎 Semantic search for: "${query}"');
  const results = await rag.${entityMethod}()
    .${searchMethod}('${query}', { topK: ${topK} })
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

    const highlightFields = [displayNameField, ...displayFields];
    const highlightExpr = highlightFields.length > 0
      ? `  const highlights = [${highlightFields.map(field => `entity.${field} ? '${field}: ' + entity.${field} : null`).join(', ')}]
    .filter(Boolean)
    .join(' | ');
  console.log(\`    Why: matches "${semanticQuery}" → \${highlights || 'high semantic similarity'}\`);`
      : `  console.log('    Why: high semantic similarity to "${semanticQuery}"');`;

    // Build dynamic comment showing available methods
    const filtersList = filterMethods.length > 0
      ? `\n  //   - Filters: ${filterMethods.join(', ')}`
      : '';
    const relationshipsList = relationshipMethods.length > 0
      ? `\n  //   - Relationships: ${relationshipMethods.join(', ')}`
      : '';

    const bodyCode = `  console.log('🔎 Semantic search: "${semanticQuery}"');
  console.log('🤖 Then reranking with LLM: "${llmQuestion}"');

  // NOTE: llmRerank() can be used after ANY operation that returns results.
  // In this example, we use it after .${searchMethod}(), but you can also use it after:${filtersList}${relationshipsList}
  //   - Or even directly without prior operations
  const results = await rag.${entityMethod}()
    .${searchMethod}('${semanticQuery}', { topK: 50 })
    .llmRerank('${llmQuestion}', {
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
    const bodyCode = `  const { results, metadata } = await rag.${entityMethod}()
    .${searchMethod}('${query}', { topK: 50 })
    .llmRerank('find ${entityDisplayName} related to: ${query}', { topK: 10 })
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
    const bodyCode = `  // Multi-stage pipeline:
  // 1. Semantic search (broad)
  // 2. Filter (focus)
  // 3. LLM rerank (quality)
  // 4. Expand relationships (complete context)
  // 5. Track metadata (observe)
  const { results, metadata } = await rag.${entityMethod}()
    .${searchMethod}('${semanticQuery}', { topK: 100 })
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
}
