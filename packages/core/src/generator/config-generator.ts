/**
 * Smart Config Generator
 *
 * Analyzes Neo4j schema and generates intelligent config suggestions
 * This is the "magic" that makes RagForge easy to use
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GraphSchema, NodeSchema, PropertySchema } from '../types/schema.js';
import {
  RagForgeConfig,
  EntityConfig,
  RerankingStrategy,
  EmbeddingsConfig,
  EmbeddingEntityConfig,
  VectorIndexConfig
} from '../types/config.js';

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
      .filter(n => (n.count || 0) > 2) // At least 3 nodes (allow small test databases)
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

    const vectorIndexes = this.detectVectorIndexes(node, schema, domain);
    const vectorIndex = vectorIndexes[0];

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

    const displayNameField = this.pickDisplayNameField(node);
    const uniqueField = this.pickUniqueField(node);
    const queryField = this.pickQueryField(node, displayNameField);
    const exampleDisplayFields = this.pickExampleDisplayFields(node, [displayNameField, uniqueField]);

    return {
      name: node.label,
      description: `${node.label} entity (${node.count} nodes)`,
      searchable_fields: searchableFields,
      vector_index: vectorIndex,
      vector_indexes: vectorIndexes.length ? vectorIndexes : undefined,
      relationships: relationships.length > 0 ? relationships : undefined,
      display_name_field: displayNameField,
      unique_field: uniqueField,
      query_field: queryField,
      example_display_fields: exampleDisplayFields.length > 0 ? exampleDisplayFields : undefined
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

  private static detectVectorIndexes(
    node: NodeSchema,
    schema: GraphSchema,
    domain: DomainPattern
  ): VectorIndexConfig[] {
    const candidates: Array<{
      prop: PropertySchema;
      score: number;
      example?: string;
    }> = [];

    for (const prop of node.properties) {
      if (!this.isTextualProperty(prop)) {
        continue;
      }

      if (this.isLikelyEmbeddingProperty(prop.name)) {
        continue;
      }

      const score = this.scoreEmbeddingCandidate(node, prop, schema, domain);
      if (score <= 0) {
        continue;
      }

      candidates.push({
        prop,
        score,
        example: this.getFieldExample(schema, node.label, prop.name)
      });
    }

    if (candidates.length === 0) {
      return [];
    }

    candidates.sort((a, b) => b.score - a.score);

    const MIN_SCORE = 1.2;
    const selected = candidates.filter(c => c.score >= MIN_SCORE).slice(0, 3);

    if (selected.length === 0) {
      selected.push(candidates[0]);
    }

    const usedFields = new Set<string>();

    return selected.map((candidate, index) => {
      const normalizedEntity = this.slugify(node.label);
      const normalizedProp = this.slugify(candidate.prop.name) || `field${index + 1}`;
      const targetFieldBase = `embedding_${normalizedProp}`;
      const targetField = this.ensureUniqueFieldName(targetFieldBase, usedFields);
      usedFields.add(targetField);

      return {
        name: `${normalizedEntity}_${normalizedProp}_embeddings`,
        field: targetField,
        source_field: candidate.prop.name,
        dimension: 768,
        similarity: 'cosine',
        provider: 'gemini',
        model: 'gemini-embedding-001',
        example_query: candidate.example
      };
    });
  }

  private static ensureUniqueFieldName(base: string, existing: Set<string>): string {
    if (!existing.has(base)) {
      return base;
    }

    let counter = 1;
    let candidate = `${base}_${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${base}_${counter}`;
    }

    return candidate;
  }

  private static isTextualProperty(prop: PropertySchema): boolean {
    if (prop.type === 'String') return true;
    if (prop.type === 'List') return true;
    return false;
  }

  private static isLikelyEmbeddingProperty(name: string): boolean {
    const lower = name.toLowerCase();
    if (lower.includes('embedding')) return true;
    if (lower.includes('vector')) return true;
    if (lower.startsWith('desc_embedding')) return true;
    return false;
  }

  private static scoreEmbeddingCandidate(
    node: NodeSchema,
    prop: PropertySchema,
    schema: GraphSchema,
    domain: DomainPattern
  ): number {
    const name = prop.name.toLowerCase();
    let score = 0;

    const longTextKeywords = ['content', 'description', 'summary', 'text', 'body', 'source', 'docstring', 'notes', 'message'];
    const nameKeywords = ['name', 'title', 'headline', 'label', 'subject'];

    if (longTextKeywords.some(keyword => name.includes(keyword))) {
      score += 3;
    }

    if (nameKeywords.some(keyword => name.includes(keyword))) {
      score += 1.5;
    }

    if (domain.name === 'code') {
      const codeKeywords = ['source', 'signature', 'doc', 'documentation', 'comment', 'body'];
      if (codeKeywords.some(keyword => name.includes(keyword))) {
        score += 2;
      }
    }

    const examples = this.getFieldExamples(schema, node.label, prop.name);
    if (examples.length > 0) {
      const textExamples = examples.filter(value => typeof value === 'string') as string[];
      if (textExamples.length > 0) {
        const avgLength = textExamples.reduce((sum, value) => sum + value.length, 0) / textExamples.length;
        if (avgLength > 400) score += 3;
        else if (avgLength > 200) score += 2;
        else if (avgLength > 80) score += 1;
        else if (avgLength > 20) score += 0.5;

        const containsLetters = textExamples.some(value => /[A-Za-z]/.test(value));
        if (!containsLetters) {
          score -= 2;
        }

        const mostlyNumeric = textExamples.every(value => /^[\d\s._\-/:]+$/.test(value));
        if (mostlyNumeric) {
          score -= 2;
        }
      }
    } else if (longTextKeywords.some(keyword => name.includes(keyword))) {
      score += 1; // no examples but strong signal from name
    }

    return score;
  }

  private static getFieldExamples(schema: GraphSchema, entityLabel: string, fieldName: string): string[] {
    if (!schema.fieldExamples) {
      return [];
    }

    const key = `${entityLabel}.${fieldName}`;
    return schema.fieldExamples[key] || [];
  }

  private static getFieldExample(schema: GraphSchema, entityLabel: string, fieldName: string): string | undefined {
    const examples = this.getFieldExamples(schema, entityLabel, fieldName);
    return examples.find(value => typeof value === 'string' && value.trim().length > 0);
  }

  private static slugify(value: string): string {
    return value
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();
  }

  private static pickDisplayNameField(node: NodeSchema): string {
    const candidate = this.findPropertyByPriority(node, ['name', 'title', 'label']);
    if (candidate) return candidate;

    const firstString = node.properties.find(prop => prop.type === 'String');
    return firstString?.name || 'name';
  }

  private static pickUniqueField(node: NodeSchema): string {
    const uniqueProp = node.properties.find(prop => prop.unique);
    if (uniqueProp) return uniqueProp.name;

    const candidate = this.findPropertyByPriority(node, ['uuid', 'id', 'guid', 'slug']);
    if (candidate) return candidate;

    return 'uuid';
  }

  private static pickQueryField(node: NodeSchema, displayNameField: string): string {
    const candidate = this.findPropertyByPriority(node, ['title', 'name', 'label']);
    if (candidate) return candidate;

    return displayNameField;
  }

  private static pickExampleDisplayFields(node: NodeSchema, exclude: string[]): string[] {
    const excluded = new Set(exclude.map(name => name.toLowerCase()));
    const priority = ['category', 'type', 'status', 'language', 'file', 'version', 'tag'];
    const selected: string[] = [];

    for (const key of priority) {
      const prop = this.findPropertyByPriority(node, [key]);
      if (prop && !excluded.has(prop.toLowerCase())) {
        selected.push(prop);
        excluded.add(prop.toLowerCase());
        if (selected.length === 2) return selected;
      }
    }

    for (const prop of node.properties) {
      if (selected.length === 2) break;
      if (prop.type !== 'String') continue;
      if (excluded.has(prop.name.toLowerCase())) continue;
      selected.push(prop.name);
      excluded.add(prop.name.toLowerCase());
    }

    return selected;
  }

  private static findPropertyByPriority(node: NodeSchema, candidates: string[]): string | undefined {
    const lowerMap = new Map(node.properties.map(prop => [prop.name.toLowerCase(), prop.name]));

    for (const candidate of candidates) {
      const match = lowerMap.get(candidate.toLowerCase());
      if (match) {
        return match;
      }
    }

    return undefined;
  }
}
