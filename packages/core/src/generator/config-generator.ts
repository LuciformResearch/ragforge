/**
 * Smart Config Generator
 *
 * Analyzes Neo4j schema and generates intelligent config suggestions
 * This is the "magic" that makes RagForge easy to use
 */

import { GraphSchema, NodeSchema, PropertySchema } from '../types/schema.js';
import {
  RagForgeConfig,
  EntityConfig,
  RerankingStrategy,
  EmbeddingsConfig,
  EmbeddingEntityConfig
} from '../types/config.js';

export interface DomainPattern {
  name: string;
  confidence: number;
  indicators: string[];
}

export class ConfigGenerator {
  /**
   * Generate a complete RagForge config from Neo4j schema analysis
   * This is smart - it detects domain patterns and suggests best practices
   */
  static generate(schema: GraphSchema, projectName: string): RagForgeConfig {
    // Detect domain (code, e-commerce, legal, etc.)
    const domain = this.detectDomain(schema);

    // Generate entities with smart defaults
    const entities = this.generateEntities(schema, domain);

    // Generate reranking strategies based on domain
    const reranking = this.generateRerankingStrategies(schema, domain);

    // Generate MCP tools based on domain
    const mcp = this.generateMCPTools(schema, domain);
    const embeddings = this.generateEmbeddingConfig(entities);

    return {
      name: projectName,
      version: '1.0.0',
      description: `Generated RAG framework for ${domain.name}`,
      neo4j: {
        uri: '${NEO4J_URI}',
        database: 'neo4j',
        username: '${NEO4J_USER}',
        password: '${NEO4J_PASSWORD}'
      },
      entities,
      reranking,
      mcp,
      generation: {
        output_dir: './generated',
        language: 'typescript',
        include_tests: true,
        include_docs: true,
        mcp_server: true
      },
      embeddings
    };
  }

  /**
   * Detect domain based on schema patterns
   */
  private static detectDomain(schema: GraphSchema): DomainPattern {
    const patterns: DomainPattern[] = [
      this.detectCodeDomain(schema),
      this.detectEcommerceDomain(schema),
      this.detectLegalDomain(schema),
      this.detectDocumentationDomain(schema),
      this.detectSocialDomain(schema)
    ];

    // Return highest confidence domain
    return patterns.sort((a, b) => b.confidence - a.confidence)[0];
  }

  private static detectCodeDomain(schema: GraphSchema): DomainPattern {
    const indicators: string[] = [];
    let score = 0;

    // Check for code-related nodes
    const codeNodes = ['Scope', 'Function', 'Class', 'Method', 'File'];
    for (const label of codeNodes) {
      if (schema.nodes.some(n => n.label === label)) {
        indicators.push(`Found ${label} node`);
        score += 0.2;
      }
    }

    // Check for code-related properties
    const codeProps = ['signature', 'startLine', 'endLine', 'type', 'language'];
    for (const node of schema.nodes) {
      for (const prop of codeProps) {
        if (node.properties.some(p => p.name === prop)) {
          indicators.push(`Found ${prop} property in ${node.label}`);
          score += 0.1;
        }
      }
    }

    // Check for code-related relationships
    const codeRels = ['CONSUMES', 'CONSUMED_BY', 'DEFINED_IN', 'INHERITS_FROM'];
    for (const rel of codeRels) {
      if (schema.relationships.some(r => r.type === rel)) {
        indicators.push(`Found ${rel} relationship`);
        score += 0.15;
      }
    }

    return {
      name: 'code',
      confidence: Math.min(score, 1),
      indicators
    };
  }

  private static detectEcommerceDomain(schema: GraphSchema): DomainPattern {
    const indicators: string[] = [];
    let score = 0;

    // E-commerce nodes
    const ecomNodes = ['Product', 'Category', 'Order', 'Customer', 'Cart'];
    for (const label of ecomNodes) {
      if (schema.nodes.some(n => n.label === label)) {
        indicators.push(`Found ${label} node`);
        score += 0.2;
      }
    }

    // E-commerce properties
    const ecomProps = ['price', 'rating', 'inStock', 'sku', 'brand'];
    for (const node of schema.nodes) {
      for (const prop of ecomProps) {
        if (node.properties.some(p => p.name === prop)) {
          indicators.push(`Found ${prop} in ${node.label}`);
          score += 0.15;
        }
      }
    }

    // E-commerce relationships
    const ecomRels = ['BOUGHT_TOGETHER', 'IN_CATEGORY', 'PURCHASED'];
    for (const rel of ecomRels) {
      if (schema.relationships.some(r => r.type === rel)) {
        indicators.push(`Found ${rel} relationship`);
        score += 0.15;
      }
    }

    return {
      name: 'e-commerce',
      confidence: Math.min(score, 1),
      indicators
    };
  }

  private static detectLegalDomain(schema: GraphSchema): DomainPattern {
    const indicators: string[] = [];
    let score = 0;

    const legalNodes = ['Contract', 'Clause', 'Party', 'Document'];
    const legalProps = ['jurisdiction', 'effectiveDate', 'parties'];

    for (const label of legalNodes) {
      if (schema.nodes.some(n => n.label === label)) {
        indicators.push(`Found ${label} node`);
        score += 0.25;
      }
    }

    for (const node of schema.nodes) {
      for (const prop of legalProps) {
        if (node.properties.some(p => p.name === prop)) {
          indicators.push(`Found ${prop} in ${node.label}`);
          score += 0.2;
        }
      }
    }

    return { name: 'legal', confidence: Math.min(score, 1), indicators };
  }

  private static detectDocumentationDomain(schema: GraphSchema): DomainPattern {
    const indicators: string[] = [];
    let score = 0;

    const docNodes = ['Article', 'Section', 'Page', 'Document'];
    const docProps = ['title', 'content', 'author', 'publishedAt'];

    for (const label of docNodes) {
      if (schema.nodes.some(n => n.label === label)) {
        indicators.push(`Found ${label} node`);
        score += 0.2;
      }
    }

    for (const node of schema.nodes) {
      for (const prop of docProps) {
        if (node.properties.some(p => p.name === prop)) {
          indicators.push(`Found ${prop} in ${node.label}`);
          score += 0.15;
        }
      }
    }

    return { name: 'documentation', confidence: Math.min(score, 1), indicators };
  }

  private static detectSocialDomain(schema: GraphSchema): DomainPattern {
    const indicators: string[] = [];
    let score = 0;

    const socialNodes = ['User', 'Post', 'Comment', 'Like'];
    const socialRels = ['FOLLOWS', 'LIKES', 'COMMENTED_ON'];

    for (const label of socialNodes) {
      if (schema.nodes.some(n => n.label === label)) {
        indicators.push(`Found ${label} node`);
        score += 0.2;
      }
    }

    for (const rel of socialRels) {
      if (schema.relationships.some(r => r.type === rel)) {
        indicators.push(`Found ${rel} relationship`);
        score += 0.25;
      }
    }

    return { name: 'social', confidence: Math.min(score, 1), indicators };
  }

  /**
   * Generate entity configs with smart defaults
   */
  private static generateEntities(schema: GraphSchema, domain: DomainPattern): EntityConfig[] {
    const entities: EntityConfig[] = [];

    // Pick most relevant nodes (sorted by count, exclude very small nodes)
    const relevantNodes = schema.nodes
      .filter(n => (n.count || 0) > 10) // At least 10 nodes
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 5); // Top 5 nodes

    for (const node of relevantNodes) {
      entities.push(this.generateEntityConfig(node, schema, domain));
    }

    return entities;
  }

  private static generateEntityConfig(
    node: NodeSchema,
    schema: GraphSchema,
    domain: DomainPattern
  ): EntityConfig {
    // Determine which fields should be searchable
    const searchableFields = node.properties
      .filter(p => this.isSearchableProperty(p, domain))
      .map(p => ({
        name: p.name,
        type: this.mapPropertyType(p),
        indexed: p.indexed || false,
        description: this.generateFieldDescription(p, node.label)
      }));

    // Detect if this entity should have vector search
    const hasTextContent = node.properties.some(p =>
      ['description', 'content', 'text', 'summary', 'signature', 'source'].includes(p.name)
    );

    const vectorIndex = hasTextContent ? {
      name: `${node.label.toLowerCase()}Embeddings`,
      field: 'embedding',
      source_field: 'source',
      dimension: 768,
      similarity: 'cosine' as const,
      provider: 'gemini' as const,
      model: 'gemini-embedding-001'
    } : undefined;

    // Find relationships for this node
    const relationships = schema.relationships
      .filter(r => r.startNode === node.label || r.endNode === node.label)
      .map(r => {
        const direction: 'outgoing' | 'incoming' = r.startNode === node.label ? 'outgoing' : 'incoming';
        return {
          type: r.type,
          direction,
          target: r.startNode === node.label ? r.endNode : r.startNode,
          description: this.generateRelationshipDescription(r.type, r.startNode, r.endNode)
        };
      });

    return {
      name: node.label,
      description: `${node.label} entity (${node.count} nodes)`,
      searchable_fields: searchableFields,
      vector_index: vectorIndex,
      vector_indexes: vectorIndex ? [vectorIndex] : undefined,
      relationships: relationships.length > 0 ? relationships : undefined
    };
  }

  private static isSearchableProperty(prop: PropertySchema, domain: DomainPattern): boolean {
    // Always searchable
    const alwaysSearchable = ['name', 'title', 'id', 'uuid'];
    if (alwaysSearchable.includes(prop.name.toLowerCase())) return true;

    // Domain-specific searchable fields
    if (domain.name === 'code') {
      return ['type', 'file', 'signature', 'language'].includes(prop.name);
    }
    if (domain.name === 'e-commerce') {
      return ['price', 'category', 'brand', 'inStock', 'rating'].includes(prop.name);
    }
    if (domain.name === 'legal') {
      return ['jurisdiction', 'type', 'parties'].includes(prop.name);
    }

    // Exclude system fields
    const systemFields = ['createdAt', 'updatedAt', 'deletedAt', 'version'];
    if (systemFields.includes(prop.name)) return false;

    return true;
  }

  private static mapPropertyType(prop: PropertySchema): any {
    const typeMap: Record<string, string> = {
      'String': 'string',
      'Integer': 'number',
      'Float': 'number',
      'Boolean': 'boolean',
      'Date': 'datetime',
      'DateTime': 'datetime',
      'List': 'array<string>'
    };

    return typeMap[prop.type] || 'string';
  }

  private static generateFieldDescription(prop: PropertySchema, entityLabel: string): string {
    return `${prop.name} of ${entityLabel}`;
  }

  private static generateRelationshipDescription(type: string, from: string, to: string): string {
    return `${from} ${type} ${to}`;
  }

  /**
   * Generate reranking strategies based on domain
   */
  private static generateRerankingStrategies(
    schema: GraphSchema,
    domain: DomainPattern
  ): { strategies: RerankingStrategy[] } {
    const strategies: RerankingStrategy[] = [];

    // Always add PageRank for graph-based scoring
    strategies.push({
      name: 'topology-centrality',
      description: 'Rank by graph centrality (importance)',
      type: 'builtin',
      algorithm: 'pagerank'
    });

    // Domain-specific strategies
    if (domain.name === 'code') {
      strategies.push({
        name: 'code-quality',
        description: 'Prefer well-documented, concise code',
        type: 'custom',
        scorer: `(scope) => {
  let score = 0;
  if (scope.docstring) score += 0.4;
  const loc = scope.endLine - scope.startLine;
  if (loc < 100) score += 0.3;
  return score;
}`
      });
    }

    if (domain.name === 'e-commerce') {
      strategies.push({
        name: 'popularity',
        description: 'Rank by rating and review count',
        type: 'custom',
        scorer: `(product) => {
  const rating = product.rating || 0;
  const reviews = product.reviewCount || 1;
  return (rating / 5) * Math.log10(reviews + 1) / 10;
}`
      });
    }

    // Add recency if datetime fields exist
    const hasDateFields = schema.nodes.some(n =>
      n.properties.some(p => p.type === 'DateTime' || p.type === 'Date')
    );

    if (hasDateFields) {
      strategies.push({
        name: 'recency',
        description: 'Prefer recent items',
        type: 'custom',
        scorer: `(entity) => {
  const date = entity.createdAt || entity.publishedAt || entity.updatedAt;
  if (!date) return 0;
  const age = Date.now() - new Date(date).getTime();
  const daysSince = age / (1000 * 60 * 60 * 24);
  return 1 / (1 + daysSince / 30); // Decay over 30 days
}`
      });
    }

    return { strategies };
  }

  /**
   * Generate MCP tools based on domain
   */
  private static generateMCPTools(schema: GraphSchema, domain: DomainPattern): any {
    const tools: any[] = [];

    // Always add basic search
    tools.push({
      name: 'search',
      description: 'Search entities using natural language',
      expose: true
    });

    // Domain-specific tools
    if (domain.name === 'code') {
      tools.push(
        {
          name: 'get_dependencies',
          description: 'Get dependencies of a code scope',
          expose: true
        },
        {
          name: 'find_usages',
          description: 'Find where a scope is used',
          expose: true
        }
      );
    }

    if (domain.name === 'e-commerce') {
      tools.push(
        {
          name: 'get_recommendations',
          description: 'Get product recommendations',
          expose: true
        },
        {
          name: 'search_by_category',
          description: 'Search products in a category',
          expose: true
        }
      );
    }

    return {
      server: {
        name: `${domain.name}-rag`,
        version: '1.0.0'
      },
      tools
    };
  }

  private static generateEmbeddingConfig(entities: EntityConfig[]) {
    const embeddingEntities = entities
      .map<EmbeddingEntityConfig | null>(entity => {
        const configs = entity.vector_indexes || (entity.vector_index ? [entity.vector_index] : []);
        if (configs.length === 0) {
          return null;
        }

        const pipelines = configs.map(cfg => ({
          name: cfg.name,
          source: cfg.source_field || cfg.field || 'source',
          target_property: cfg.field || 'embedding',
          dimension: cfg.dimension,
          similarity: (cfg.similarity ?? 'cosine') as 'cosine' | 'dot' | 'euclidean',
          preprocessors: ['normalizeWhitespace']
        }));

        return {
          entity: entity.name,
          pipelines
        };
      })
      .filter((item): item is EmbeddingEntityConfig => Boolean(item));

    if (embeddingEntities.length === 0) {
      return undefined;
    }

    const config: EmbeddingsConfig = {
      provider: 'gemini',
      defaults: {
        model: 'gemini-embedding-001',
        dimension: 768,
        similarity: 'cosine'
      },
      entities: embeddingEntities
    };

    return config;
  }

  private static generateEmbeddingsArtifacts(embeddings?: EmbeddingsConfig) {
    if (!embeddings) {
      return undefined;
    }

    const loaderModule = [
      "import fs from 'fs';",
      "import path from 'path';",
      "import { fileURLToPath } from 'url';",
      "import yaml from 'js-yaml';",
      "",
      "const __filename = fileURLToPath(import.meta.url);",
      "const __dirname = path.dirname(__filename);",
      "const PROJECT_ROOT = path.resolve(__dirname, '..');",
      "const YAML_PATH = path.resolve(PROJECT_ROOT, '../ragforge.config.yaml');",
      "",
      "function transformPipeline(pipeline) {",
      "  if (!pipeline) {",
      "    return undefined;",
      "  }",
      "",
      "  return {",
      "    name: pipeline.name,",
      "    source: pipeline.source,",
      "    targetProperty: pipeline.target_property ?? pipeline.targetProperty ?? 'embedding',",
      "    model: pipeline.model,",
      "    dimension: pipeline.dimension,",
      "    similarity: pipeline.similarity,",
      "    preprocessors: pipeline.preprocessors,",
      "    includeFields: pipeline.include_fields,",
      "    includeRelationships: pipeline.include_relationships",
      "      ? pipeline.include_relationships.map(rel => ({",
      "          type: rel.type,",
          "          direction: rel.direction,",
          "          fields: rel.fields,",
          "          depth: rel.depth,",
          "          maxItems: rel.max_items ?? rel.maxItems",
          "        }))",
          "      : undefined,",
      "    batchSize: pipeline.batch_size ?? pipeline.batchSize,",
      "    concurrency: pipeline.concurrency,",
      "    throttleMs: pipeline.throttle_ms ?? pipeline.throttleMs,",
      "    maxRetries: pipeline.max_retries ?? pipeline.maxRetries,",
      "    retryDelayMs: pipeline.retry_delay_ms ?? pipeline.retryDelayMs",
      "  };",
      "}",
      "",
      "function transformEmbeddingsConfig(raw) {",
      "  if (!raw) {",
      "    throw new Error('Embeddings configuration missing from ragforge.config.yaml');",
      "  }",
      "",
      "  const entities = Array.isArray(raw.entities)",
      "    ? raw.entities.map(entity => ({",
      "        entity: entity.entity,",
      "        pipelines: Array.isArray(entity.pipelines)",
      "          ? entity.pipelines",
      "              .map(transformPipeline)",
      "              .filter(Boolean)",
      "          : []",
      "      }))",
      "    : [];",
      "",
      "  return {",
      "    provider: raw.provider,",
      "    defaults: raw.defaults ? { ...raw.defaults } : undefined,",
      "    entities",
      "  };",
      "}",
      "",
      "export function loadEmbeddingsConfig() {",
      "  const yamlContent = fs.readFileSync(YAML_PATH, 'utf-8');",
      "  const config = yaml.load(yamlContent) ?? {};",
      "  return transformEmbeddingsConfig(config.embeddings);",
      "}",
      "",
      "export const EMBEDDINGS_CONFIG = loadEmbeddingsConfig();",
      ""
    ].join('\\n');

    const loaderTypes = [
      "export interface EmbeddingPipelineConfig {",
      "  name: string;",
      "  source: string;",
      "  targetProperty: string;",
      "  model?: string;",
      "  dimension?: number;",
      "  similarity?: 'cosine' | 'dot' | 'euclidean';",
      "  preprocessors?: string[];",
      "  includeFields?: string[];",
      "  includeRelationships?: Array<{",
      "    type: string;",
      "    direction: 'outgoing' | 'incoming' | 'both';",
      "    fields?: string[];",
      "    depth?: number;",
      "    maxItems?: number;",
      "  }>;",
      "  batchSize?: number;",
      "  concurrency?: number;",
      "  throttleMs?: number;",
      "  maxRetries?: number;",
      "  retryDelayMs?: number;",
      "}",
      "",
      "export interface EmbeddingEntityConfig {",
      "  entity: string;",
      "  pipelines: EmbeddingPipelineConfig[];",
      "}",
      "",
      "export interface EmbeddingsConfig {",
      "  provider: string;",
      "  defaults?: {",
      "    model?: string;",
      "    dimension?: number;",
      "    similarity?: 'cosine' | 'dot' | 'euclidean';",
      "  };",
      "  entities: EmbeddingEntityConfig[];",
      "}",
      "",
      "export declare function loadEmbeddingsConfig(): EmbeddingsConfig;",
      "export declare const EMBEDDINGS_CONFIG: EmbeddingsConfig;",
      ""
    ].join('\\n');

    const createIndexesScript = this.generateCreateIndexesScript();
    const generateEmbeddingsScript = this.generateGenerateEmbeddingsScript();

    return {
      loaderModule,
      loaderTypes,
      createIndexesScript,
      generateEmbeddingsScript
    };
  }
 
  private static generateCreateIndexesScript(): string {
    const lines = [
      "import dotenv from 'dotenv';",
      "import path from 'path';",
      "import { fileURLToPath } from 'url';",
      "import { Neo4jClient } from '@luciformresearch/ragforge-runtime';",
      "",
      "import { EMBEDDINGS_CONFIG } from '../embeddings/load-config.js';",
      "",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
      "dotenv.config({ path: path.resolve(__dirname, '../.env') });",
      "",
      "async function main() {",
      "  const client = new Neo4jClient({",
      "    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',",
      "    username: process.env.NEO4J_USERNAME || 'neo4j',",
      "    password: process.env.NEO4J_PASSWORD || '',",
      "    database: process.env.NEO4J_DATABASE",
      "  });",
      "",
      "  try {",
      "    for (const entity of EMBEDDINGS_CONFIG.entities) {",
      "      for (const pipeline of entity.pipelines) {",
      "        const dimension = pipeline.dimension ?? EMBEDDINGS_CONFIG.defaults?.dimension ?? 768;",
      "        const similarity = pipeline.similarity ?? EMBEDDINGS_CONFIG.defaults?.similarity ?? 'cosine';",
      "",
      "        console.log(`Creating vector index ${pipeline.name} for ${entity.entity}.${pipeline.targetProperty}`);",
      "        await client.run(`DROP INDEX ${pipeline.name} IF EXISTS`);",
      "        await client.run(",
      "          `CREATE VECTOR INDEX ${pipeline.name} IF NOT EXISTS` +",
      "          ` FOR (n:\\`${entity.entity}\\`)` +",
      "          ` ON n.\\`${pipeline.targetProperty}\\`` +",
      "          ` OPTIONS { indexConfig: { \\`vector.dimensions\\`: $dimension, \\`vector.similarity_function\\`: $similarity } }`,",
      "          { dimension, similarity }",
      "        );",
      "      }",
      "    }",
      "",
      "    console.log('✅ Vector indexes created successfully');",
      "  } catch (error) {",
      "    console.error('❌ Failed to create vector indexes', error);",
      "    process.exitCode = 1;",
      "  } finally {",
      "    await client.close();",
      "  }",
      "}",
      "",
      "main();",
      ""
    ];

    return lines.join('\\n');
  }

  private static generateGenerateEmbeddingsScript(): string {
    const lines = [
      "import dotenv from 'dotenv';",
      "import path from 'path';",
      "import { fileURLToPath } from 'url';",
      "import {",
      "  Neo4jClient,",
      "  GeminiEmbeddingProvider,",
      "  runEmbeddingPipelines",
      "} from '@luciformresearch/ragforge-runtime';",
      "",
      "import { EMBEDDINGS_CONFIG } from '../embeddings/load-config.js';",
      "",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
      "dotenv.config({ path: path.resolve(__dirname, '../.env') });",
      "",
      "async function main() {",
      "  const apiKey = process.env.GEMINI_API_KEY;",
      "  if (!apiKey) {",
      "    throw new Error('GEMINI_API_KEY is required to generate embeddings.');",
      "  }",
      "",
      "  const client = new Neo4jClient({",
      "    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',",
      "    username: process.env.NEO4J_USERNAME || 'neo4j',",
      "    password: process.env.NEO4J_PASSWORD || '',",
      "    database: process.env.NEO4J_DATABASE",
      "  });",
      "",
      "  const defaults = EMBEDDINGS_CONFIG.defaults ?? {};",
      "  const providerCache = new Map();",
      "",
      "  const getProvider = (model, dimension) => {",
      "    const resolvedModel = model ?? defaults.model;",
      "    const resolvedDimension = dimension ?? defaults.dimension;",
      "    const cacheKey = `${resolvedModel ?? 'default'}::${resolvedDimension ?? 'none'}`;",
      "",
      "    if (providerCache.has(cacheKey)) {",
      "      return providerCache.get(cacheKey);",
      "    }",
      "",
      "    const provider = new GeminiEmbeddingProvider({",
      "      apiKey,",
      "      model: resolvedModel,",
      "      dimension: resolvedDimension",
      "    });",
      "",
      "    providerCache.set(cacheKey, provider);",
      "    return provider;",
      "  };",
      "",
      "  try {",
      "    for (const entity of EMBEDDINGS_CONFIG.entities) {",
      "      console.log(`🔄 Generating embeddings for ${entity.entity}`);",
      "      for (const pipeline of entity.pipelines) {",
      "        const provider = getProvider(pipeline.model, pipeline.dimension);",
      "        await runEmbeddingPipelines({",
      "          neo4j: client,",
      "          entity: {",
      "            entity: entity.entity,",
      "            pipelines: [pipeline]",
      "          },",
      "          provider,",
      "          defaults: EMBEDDINGS_CONFIG.defaults",
      "        });",
      "      }",
      "    }",
      "",
      "    console.log('✅ Embeddings generated successfully');",
      "  } catch (error) {",
      "    console.error('❌ Failed to generate embeddings', error);",
      "    process.exitCode = 1;",
      "  } finally {",
      "    await client.close();",
      "  }",
      "}",
      "",
      "main();",
      ""
    ];

    return lines.join('\\n');
  }
}
