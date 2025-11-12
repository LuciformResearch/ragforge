/**
 * Query Builder
 *
 * Fluent API for building and executing Neo4j queries with RAG capabilities
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import { VectorSearch } from '../vector/vector-search.js';
import { LLMReranker, type LLMRerankOptions } from '../reranking/llm-reranker.js';
import type { LLMProvider } from '../reranking/llm-provider.js';
import type {
  SearchResult,
  SearchResultWithMetadata,
  QueryExecutionMetadata,
  OperationMetadata,
  QueryPlan,
  CypherQuery,
  SemanticSearchOptions,
  ExpandOptions,
  FilterValue,
  RelationshipConfig
} from '../types/index.js';
import type {
  PipelineOperation,
  FetchOperation,
  ExpandOperation,
  SemanticOperation,
  LLMRerankOperation,
  FilterOperation,
  ClientFilterOperation
} from './operations.js';
import type { EntityContext } from '../types/entity-context.js';
import {
  StructuredLLMExecutor,
  type LLMStructuredCallConfig,
  type EmbeddingGenerationConfig
} from '../llm/structured-llm-executor.js';

export class QueryBuilder<T = any> {
  // Pipeline-based architecture
  private operations: PipelineOperation[] = [];

  // Legacy fields (kept for backward compatibility during transition)
  private filters: Record<string, FilterValue<any>> = {};
  private semanticQuery?: { text: string; options: SemanticSearchOptions };
  private expansions: Array<{ relType: string; options: ExpandOptions }> = [];
  private rerankStrategies: string[] = [];
  private _limit: number = 10;
  private _offset: number = 0;
  private _orderBy?: { field: string; direction: 'ASC' | 'DESC' };
  private vectorSearch: VectorSearch;
  private uuidFilter?: string[];
  private relatedToFilter?: { scopeName: string; relationship: string; direction: 'incoming' | 'outgoing' };
  private llmRerankConfig?: {
    userQuestion: string;
    llmProvider: LLMProvider;
    options?: LLMRerankOptions;
  };
  private enrichmentConfig: RelationshipConfig[] = []; // Config-driven relationship enrichment
  private entityContext?: EntityContext;

  // Metadata tracking
  private trackMetadata: boolean = false;
  private executionMetadata?: QueryExecutionMetadata;

  // Unified LLM structured generation
  private structuredLLMExecutor: StructuredLLMExecutor;

  constructor(
    protected client: Neo4jClient,
    protected entityType: string,
    enrichmentConfig?: RelationshipConfig[],
    entityContext?: EntityContext
  ) {
    this.vectorSearch = new VectorSearch(client);
    this.enrichmentConfig = enrichmentConfig || [];
    this.entityContext = entityContext;
    this.structuredLLMExecutor = new StructuredLLMExecutor();
  }

  /**
   * Build Cypher clause for relationship enrichment (config-driven)
   * Generates OPTIONAL MATCH clauses for all relationships marked with enrich: true
   */
  private buildEnrichmentClause(): string {
    const enrichRelationships = this.enrichmentConfig.filter(r => r.enrich);
    if (enrichRelationships.length === 0) {
      return ''; // No enrichment configured
    }

    return enrichRelationships.map(rel => {
      const fieldName = rel.enrich_field || rel.type.toLowerCase();
      let pattern = '';

      // Build relationship pattern based on direction
      switch (rel.direction) {
        case 'outgoing':
          pattern = `-[:${rel.type}]->`;
          break;
        case 'incoming':
          pattern = `<-[:${rel.type}]-`;
          break;
        case 'both':
          pattern = `-[:${rel.type}]-`;
          break;
      }

      return `
      OPTIONAL MATCH (n)${pattern}(${fieldName}_dep:\`${rel.target}\`)`;
    }).join('');
  }

  /**
   * Build RETURN clause with enriched fields
   * Returns 'n' plus all enriched relationship fields as arrays
   */
  private buildEnrichmentReturn(): string {
    const enrichRelationships = this.enrichmentConfig.filter(r => r.enrich);
    if (enrichRelationships.length === 0) {
      return 'n'; // No enrichment, just return node
    }

    const enrichFields = enrichRelationships.map(rel => {
      const fieldName = rel.enrich_field || rel.type.toLowerCase();
      return `collect(DISTINCT ${fieldName}_dep.name) AS ${fieldName}`;
    });

    return `n, ${enrichFields.join(', ')}`;
  }

  /**
   * Get list of enrichment field names for parsing results
   */
  private getEnrichmentFields(): string[] {
    return this.enrichmentConfig
      .filter(r => r.enrich)
      .map(r => r.enrich_field || r.type.toLowerCase());
  }

  /**
   * Filter by field values
   *
   * @example
   * query.where({ type: 'function', name: { contains: 'auth' } })
   */
  where(filter: Record<string, FilterValue<any>>): this {
    this.filters = { ...this.filters, ...filter };

    // Merge with last operation if it's also a filter (optimize consecutive filters)
    const lastOp = this.operations[this.operations.length - 1];
    if (lastOp && lastOp.type === 'filter') {
      // Merge filters into existing operation
      lastOp.config.filters = { ...lastOp.config.filters, ...filter };
    } else {
      // Add new filter operation to pipeline
      this.operations.push({
        type: 'filter',
        config: { filters: filter }
      });
    }

    return this;
  }

  /**
   * Filter by field matching any value in array (batch query)
   * Completely generic - works with any field type
   * @param field - Field name to filter on
   * @param values - Array of values to match
   */
  whereIn(field: string, values: any[]): this {
    // Add WHERE IN filter
    this.filters = { ...this.filters, [field]: { $in: values } };

    // Merge with last operation if it's also a filter
    const lastOp = this.operations[this.operations.length - 1];
    if (lastOp && lastOp.type === 'filter') {
      lastOp.config.filters = { ...lastOp.config.filters, [field]: { $in: values } };
    } else {
      this.operations.push({
        type: 'filter',
        config: { filters: { [field]: { $in: values } } }
      });
    }

    return this;
  }

  /**
   * Filter by regex pattern on a field
   * Uses Neo4j's =~ operator for server-side regex matching
   *
   * @example
   * // Find all async functions
   * query.wherePattern('source', /async\s+function/)
   *
   * // Find all handle* functions
   * query.wherePattern('name', /^handle/)
   *
   * // Find all try-catch blocks
   * query.wherePattern('source', /try\s*{[\s\S]*catch/)
   */
  wherePattern(fieldName: string, pattern: RegExp | string): this {
    const regexString = pattern instanceof RegExp ? pattern.source : pattern;

    // Store as special filter with __pattern suffix
    const filter = { [`${fieldName}__pattern`]: regexString };
    this.filters = { ...this.filters, ...filter };

    // Merge with last operation if it's also a filter
    const lastOp = this.operations[this.operations.length - 1];
    if (lastOp && lastOp.type === 'filter') {
      lastOp.config.filters = { ...lastOp.config.filters, ...filter };
    } else {
      this.operations.push({
        type: 'filter',
        config: { filters: filter }
      });
    }

    return this;
  }

  /**
   * Semantic search by text
   *
   * Can be chained multiple times to refine results progressively.
   *
   * @example
   * // Single semantic search
   * query.semantic('authentication code', { topK: 20, vectorIndex: 'scopeEmbeddings' })
   *
   * // Chained semantic searches (progressive refinement)
   * query.semantic('auth', { topK: 50, vectorIndex: 'scopeEmbeddingsSignature' })
   *      .semantic('JWT token', { topK: 10, vectorIndex: 'scopeEmbeddingsSource' })
   */
  semantic(query: string, options: SemanticSearchOptions = {}): this {
    // Add to pipeline
    this.operations.push({
      type: 'semantic',
      config: {
        query,
        vectorIndex: options.vectorIndex || 'scopeEmbeddings',
        topK: Math.floor(options.topK || 10),  // Ensure integer for Neo4j
        minScore: options.minScore || 0.0,
        metadataOverride: options.metadataOverride
      }
    });

    // Keep legacy behavior (last semantic query wins) for backward compatibility
    this.semanticQuery = { text: query, options };
    return this;
  }

  /**
   * Expand to related entities via relationships
   *
   * Can now be used anywhere in the pipeline, including after semantic search.
   *
   * @example
   * query.expand('CONSUMES', { depth: 2, direction: 'outgoing' })
   *
   * // After semantic search
   * query.semantic('auth', { topK: 10 })
   *      .expand('CALLS', { depth: 1 })
   */
  expand(relType: string, options: ExpandOptions = {}): this {
    // Add to pipeline
    this.operations.push({
      type: 'expand',
      config: {
        relType,
        depth: options.depth || 1,
        direction: options.direction || 'outgoing'
      }
    });

    // Keep legacy behavior
    this.expansions.push({ relType, options });
    return this;
  }

  /**
   * Client-side filtering of results using a predicate function
   * Applied after query execution, useful for complex logic or regex on already-fetched results
   *
   * @example
   * // Filter by name pattern (client-side regex)
   * query.limit(100)
   *      .filter(r => /^handle/.test(r.entity.name))
   *
   * // Filter by custom logic
   * query.limit(50)
   *      .filter(r => r.score > 0.8 && r.entity.type === 'function')
   *
   * // Combine server + client filtering
   * query.where({ type: 'function' })  // Server-side
   *      .limit(100)
   *      .filter(r => /async/.test(r.entity.source))  // Client-side
   */
  filter(predicate: (result: SearchResult<T>) => boolean): this {
    this.operations.push({
      type: 'clientFilter',
      config: { predicate }
    });
    return this;
  }

  /**
   * Apply reranking strategy
   *
   * @example
   * query.rerank('code-quality')
   */
  rerank(strategy: string): this {
    this.rerankStrategies.push(strategy);
    return this;
  }

  /**
   * Limit number of results
   */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /**
   * Skip first n results
   */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Order results by field
   *
   * @example
   * query.orderBy('name', 'ASC')
   */
  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this._orderBy = { field, direction };
    return this;
  }

  /**
   * Filter by UUIDs
   *
   * @example
   * query.whereUuidIn(['uuid1', 'uuid2', 'uuid3'])
   */
  whereUuidIn(uuids: string[]): this {
    this.uuidFilter = uuids;
    return this;
  }

  /**
   * Generic: Find entities related to a given entity via any relationship
   *
   * This is the generic version that works for any entity type and relationship.
   *
   * @example
   * // Code analysis
   * query.whereRelatedBy('getNeo4jDriver', 'CONSUMES', 'outgoing')
   *
   * // E-commerce
   * query.whereRelatedBy('laptop', 'PURCHASED_WITH', 'outgoing')
   *
   * // Social network
   * query.whereRelatedBy('alice', 'FOLLOWS', 'outgoing')
   */
  whereRelatedBy(
    entityName: string,
    relationship: string,
    direction: 'incoming' | 'outgoing' = 'outgoing',
    targetType?: string
  ): this {
    this.relatedToFilter = { scopeName: entityName, relationship, direction };

    // If this is the first operation, add a fetch operation
    // Otherwise, add a filter operation that will query Neo4j
    if (this.operations.length === 0) {
      this.operations.push({
        type: 'fetch',
        config: {
          mode: 'relationship',
          scopeName: entityName,
          relationship,
          direction,
          targetType
        }
      });
    } else {
      // Add as a filter operation with relationship metadata
      this.operations.push({
        type: 'filter',
        config: {
          filters: {},  // No field filters
          relationshipFilter: {
            entityName,
            relationship,
            direction,
            targetType
          }
        }
      });
    }

    return this;
  }

  /**
   * @deprecated Use whereRelatedBy() for generic relationships
   * Find all scopes that consume a given scope (CONSUMES relationship, outgoing)
   *
   * @example
   * query.whereConsumesScope('loadEnvironment')
   */
  whereConsumesScope(scopeName: string): this {
    return this.whereRelatedBy(scopeName, 'CONSUMES', 'outgoing');
  }

  /**
   * @deprecated Use whereRelatedBy() for generic relationships
   * Find all scopes consumed by a given scope (CONSUMES relationship, incoming)
   *
   * @example
   * query.whereConsumedByScope('main')
   */
  whereConsumedByScope(scopeName: string): this {
    return this.whereRelatedBy(scopeName, 'CONSUMES', 'incoming');
  }

  /**
   * @deprecated Use whereRelatedBy() for clearer API
   * Find all scopes related to a given scope via any relationship
   *
   * @example
   * query.whereRelatedTo('loadEnvironment', { relationship: 'CONSUMES', direction: 'incoming' })
   */
  whereRelatedTo(scopeName: string, options: { relationship: string; direction: 'incoming' | 'outgoing' }): this {
    return this.whereRelatedBy(scopeName, options.relationship, options.direction);
  }

  /**
   * Apply LLM reranking to search results
   *
   * Uses an LLM to evaluate and rerank search results based on relevance
   * to the user's question. Can be used anywhere in the pipeline.
   *
   * @param userQuestion - The question to evaluate relevance against
   * @param llmProviderOrOptions - Optional LLM provider (if not set, uses default) or options object
   * @param options - Optional reranking options (if provider is specified)
   *
   * @example
   * // Using default provider (configured via LLMReranker.setDefaultProvider)
   * const results = await rag.scope()
   *   .semanticSearchBySource('How does authentication work?', { topK: 50 })
   *   .llmRerank('How does authentication work?', { topK: 10, minScore: 0.6 })
   *   .execute();
   *
   * // Using explicit provider
   * const provider = GeminiAPIProvider.fromEnv('gemma-3n-e2b-it');
   * const results = await rag.scope()
   *   .semanticSearchBySource('How does authentication work?', { topK: 50 })
   *   .llmRerank('How does authentication work?', provider, { topK: 10 })
   *   .execute();
   *
   * // Chain multiple LLM reranks for progressive refinement
   * await rag.scope()
   *   .semantic('auth', { topK: 100 })
   *   .llmRerank('Is it about JWT?', { topK: 30 })
   *   .semantic('validate token', { topK: 10 })
   *   .llmRerank('Does it check expiry?', { topK: 5 })
   *   .execute();
   */
  llmRerank(
    userQuestion: string,
    llmProviderOrOptions?: LLMProvider | LLMRerankOptions,
    options?: LLMRerankOptions
  ): this {
    // Determine provider and options
    let llmProvider: LLMProvider | undefined;
    let rerankOptions: LLMRerankOptions | undefined;

    // Check if first parameter is a provider or options
    if (llmProviderOrOptions && typeof (llmProviderOrOptions as any).generateContent === 'function') {
      // It's a provider
      llmProvider = llmProviderOrOptions as LLMProvider;
      rerankOptions = options;
    } else {
      // It's options (or undefined)
      rerankOptions = llmProviderOrOptions as LLMRerankOptions | undefined;
    }

    // Use default provider if none specified
    if (!llmProvider) {
      llmProvider = LLMReranker.getDefaultProvider();
      if (!llmProvider) {
        throw new Error(
          'No LLM provider specified and no default provider configured. ' +
          'Either pass a provider to llmRerank() or configure a default provider using LLMReranker.setDefaultProvider()'
        );
      }
    }

    // Add to pipeline
    this.operations.push({
      type: 'llmRerank',
      config: {
        userQuestion,
        llmProvider,
        options: rerankOptions
      }
    });

    // Keep legacy behavior
    this.llmRerankConfig = { userQuestion, llmProvider, options: rerankOptions };
    return this;
  }

  /**
   * Generate structured LLM outputs for query results
   *
   * Uses an LLM to generate custom structured data for each result based on
   * input fields, context, and a defined output schema.
   *
   * @example
   * // Security audit - generate risk scores
   * const audited = await rag.scope()
   *   .semantic('authentication', { topK: 20 })
   *   .llmGenerateStructured({
   *     inputFields: ['name', 'source'],
   *     outputSchema: {
   *       riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Security risk level' },
   *       reasoning: { type: 'string', description: 'Why this risk level?' }
   *     },
   *     llm: { provider: 'gemini', model: 'gemini-pro' }
   *   })
   *   .execute();
   *
   * @example
   * // Documentation generation
   * const documented = await rag.scope()
   *   .where({ type: 'function' })
   *   .llmGenerateStructured({
   *     inputFields: [
   *       { name: 'source', maxLength: 500 },
   *       { name: 'consumes', prompt: 'dependencies used' }
   *     ],
   *     outputSchema: {
   *       summary: { type: 'string', description: 'One-line summary' },
   *       params: { type: 'array', description: 'Parameter descriptions' },
   *       returns: { type: 'string', description: 'Return value description' }
   *     }
   *   })
   *   .execute();
   */
  llmGenerateStructured<TOutput = any>(
    config: Omit<LLMStructuredCallConfig<T, TOutput>, 'outputSchema'> & {
      outputSchema: LLMStructuredCallConfig<T, TOutput>['outputSchema']
    }
  ): QueryBuilder<T & TOutput> {
    // Add to pipeline
    this.operations.push({
      type: 'llmStructured' as any,
      config: config as any
    });

    return this as any;
  }

  /**
   * Alias for llmGenerateStructured - backward compatible reranking using new unified API
   *
   * @deprecated Use llmRerank() for traditional reranking, or llmGenerateStructured() for custom outputs
   */
  rerankWithLLM<TOutput = any>(
    config: Omit<LLMStructuredCallConfig<T, TOutput>, 'outputSchema'> & {
      outputSchema: LLMStructuredCallConfig<T, TOutput>['outputSchema']
    }
  ): QueryBuilder<T & TOutput> {
    return this.llmGenerateStructured(config);
  }

  /**
   * Generate embeddings for query results with optional relationship context
   *
   * Generates embeddings by combining specified fields and optionally including
   * relationship context (e.g., dependency names alongside code content).
   *
   * @example
   * // Generate embeddings with dependency context
   * const withEmbeddings = await rag.scope()
   *   .where({ type: 'function' })
   *   .generateEmbeddings({
   *     sourceFields: ['name', 'source'],
   *     targetField: 'codeEmbedding',
   *     includeRelationships: ['CONSUMES'],
   *     relationshipFormat: 'text',
   *     provider: { provider: 'gemini', model: 'text-embedding-004' }
   *   })
   *   .execute();
   *
   * @example
   * // Weighted combination of fields
   * const withWeightedEmbeddings = await rag.scope()
   *   .generateEmbeddings({
   *     sourceFields: ['name', 'signature', 'source'],
   *     weights: { name: 0.3, signature: 0.3, source: 0.4 },
   *     combineStrategy: 'weighted',
   *     targetField: 'embedding'
   *   })
   *   .execute();
   */
  generateEmbeddings(config: EmbeddingGenerationConfig): this {
    // Add to pipeline
    this.operations.push({
      type: 'generateEmbeddings' as any,
      config: config as any
    });

    return this;
  }

  /**
   * Generate summaries for query results
   *
   * Alias for llmGenerateStructured with common summarization patterns.
   *
   * @example
   * // Generate summaries for complex code
   * const summarized = await rag.scope()
   *   .semantic('database operations', { topK: 10 })
   *   .withSummaries({
   *     inputFields: ['name', 'source'],
   *     summaryFields: ['oneLine', 'detailed', 'keywords'],
   *     llm: { provider: 'gemini' }
   *   })
   *   .execute();
   */
  withSummaries(config: {
    inputFields: LLMStructuredCallConfig<T, any>['inputFields'];
    summaryFields?: string[];
    llm?: LLMStructuredCallConfig<T, any>['llm'];
    [key: string]: any;
  }): QueryBuilder<T & { summary?: string; summaryDetailed?: string; keywords?: string[] }> {
    // Build output schema from summaryFields
    const outputSchema: any = {};
    const summaryFieldList = config.summaryFields || ['oneLine', 'detailed', 'keywords'];

    for (const field of summaryFieldList) {
      switch (field) {
        case 'oneLine':
          outputSchema.summary = {
            type: 'string',
            description: 'One-line summary of the code',
            prompt: 'Summarize in one sentence'
          };
          break;
        case 'detailed':
          outputSchema.summaryDetailed = {
            type: 'string',
            description: 'Detailed multi-sentence summary',
            prompt: 'Provide a detailed explanation'
          };
          break;
        case 'keywords':
          outputSchema.keywords = {
            type: 'array',
            items: { type: 'string' },
            description: 'Key concepts and terms',
            prompt: 'Extract 3-5 key concepts'
          };
          break;
        default:
          outputSchema[field] = {
            type: 'string',
            description: `Summary: ${field}`
          };
      }
    }

    return this.llmGenerateStructured({
      inputFields: config.inputFields,
      outputSchema,
      llm: config.llm
    });
  }

  /**
   * Execute query and return results
   */
  async execute(): Promise<SearchResult<T>[]> {
    // NEW: Pipeline-based execution
    if (this.operations.length > 0) {
      return this.executePipeline();
    }

    // LEGACY: Backward compatibility - existing execution path
    let results: SearchResult<T>[] = [];

    // 1. Determine execution path
    const hasFieldFilters = Object.keys(this.filters).length > 0;
    const hasStructuralFilters = this.uuidFilter || this.relatedToFilter;
    const hasSemanticOnly = this.semanticQuery && !hasFieldFilters && !hasStructuralFilters;

    if (hasSemanticOnly) {
      // Pure semantic search (with optional expansions)
      // Do vector search first, then expand if needed
      results = await this.applySemanticSearch([]);

      // Handle relationship expansion after semantic search
      if (this.expansions.length > 0) {
        results = await this.expandRelationshipsForResults(results);
      }
    } else {
      // Traditional Cypher query (with optional semantic enhancement)
      const cypherQuery = this.buildCypher();
      const rawResult = await this.client.run(cypherQuery.query, cypherQuery.params);
      results = this.parseResults(rawResult.records);

      // Apply semantic search if specified (merge with filter results)
      if (this.semanticQuery) {
        results = await this.applySemanticSearch(results);
      }
    }

    // 2. Apply LLM reranking if configured
    if (this.llmRerankConfig) {
      results = await this.applyLLMReranking(results);
    }

    // 3. Apply reranking strategies
    for (const strategy of this.rerankStrategies) {
      results = await this.applyReranking(results, strategy);
    }

    // 4. Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // 5. Apply offset and limit
    const finalResults = results.slice(this._offset, this._offset + this._limit);

    // 6. Check for dirty embeddings and warn user
    this.checkDirtyEmbeddings(finalResults);

    return finalResults;
  }

  /**
   * Execute query and return flat entities (without score wrapper)
   *
   * This is a convenience method for simple queries where you don't need
   * the score, scoreBreakdown, or context metadata. It returns just the
   * entity objects directly.
   *
   * Use this for:
   * - Simple WHERE queries without semantic search
   * - When you don't need to inspect scores
   * - Cleaner code for basic data retrieval
   *
   * Use execute() instead when:
   * - Using semantic search (need scores)
   * - Using LLM reranking (need reasoning)
   * - Need to debug/inspect scores
   *
   * @example
   * // Simple query - get entities directly
   * const classes = await rag.scope()
   *   .whereType('class')
   *   .executeFlat();
   *
   * classes.forEach(c => {
   *   console.log(c.name, c.extends); // Direct property access
   * });
   *
   * @example
   * // Compare with execute()
   * const results = await rag.scope().whereType('class').execute();
   * results.forEach(r => {
   *   console.log(r.entity.name, r.score); // Need .entity prefix
   * });
   */
  async executeFlat(): Promise<T[]> {
    const results = await this.execute();
    return results.map(r => r.entity);
  }

  /**
   * Execute query and return results with detailed metadata
   *
   * This method provides insight into the query execution pipeline,
   * including all operations performed and intermediate result counts.
   *
   * @example
   * const { results, metadata } = await rag
   *   .scope()
   *   .semantic('parser', { vectorIndex: 'scopeEmbeddings', topK: 10 })
   *   .llmRerank('find TypeScript parsers', { topK: 5 })
   *   .executeWithMetadata();
   *
   * // Access LLM reasoning for each result
   * results.forEach(r => {
   *   console.log(r.entity.name, r.scoreBreakdown?.llmReasoning);
   * });
   *
   * // See pipeline operations
   * metadata.operations.forEach(op => {
   *   console.log(`${op.type}: ${op.inputCount} -> ${op.outputCount} (${op.duration}ms)`);
   *   if (op.type === 'llmRerank' && op.metadata?.evaluations) {
   *     op.metadata.evaluations.forEach(e => {
   *       console.log(`  - ${e.entityId}: ${e.score} - ${e.reasoning}`);
   *     });
   *   }
   * });
   */
  async executeWithMetadata(): Promise<SearchResultWithMetadata<T>> {
    const startTime = Date.now();
    this.trackMetadata = true;
    this.executionMetadata = {
      operations: [],
      totalDuration: 0,
      finalCount: 0
    };

    const results = await this.execute();

    this.executionMetadata.totalDuration = Date.now() - startTime;
    this.executionMetadata.finalCount = results.length;

    return {
      results,
      metadata: this.executionMetadata
    };
  }

  /**
   * Record metadata for an operation (if tracking is enabled)
   */
  private recordOperationMetadata(opMeta: OperationMetadata): void {
    if (this.trackMetadata && this.executionMetadata) {
      this.executionMetadata.operations.push(opMeta);
    }
  }

  /**
   * Execute the operation pipeline (new architecture)
   */
  private async executePipeline(): Promise<SearchResult<T>[]> {
    let currentResults: SearchResult<T>[] = [];

    // Process each operation in sequence (using index to allow skipping)
    for (let i = 0; i < this.operations.length; i++) {
      const operation = this.operations[i];
      const inputCount = currentResults.length;
      const startTime = Date.now();
      let operationMetadata: any = {};
      let skipCount = 0; // How many following operations to skip
      let mergedOperations: any[] = []; // Operations merged into this one

      switch (operation.type) {
        case 'fetch':
          currentResults = await this.executeFetch(operation);
          break;

        case 'expand':
          const expandResult = await this.executeExpandWithFilters(currentResults, operation, i);
          currentResults = expandResult.results;
          skipCount = expandResult.skippedOperations;
          mergedOperations = expandResult.mergedOperations;
          break;

        case 'semantic':
          const semanticResult = await this.executeSemanticWithFilters(currentResults, operation, i);
          currentResults = semanticResult.results;
          skipCount = semanticResult.skippedOperations;
          mergedOperations = semanticResult.mergedOperations;
          operationMetadata = semanticResult.metadata;
          break;

        case 'llmRerank':
          const rerankResult = await this.executeLLMRerankWithMetadata(currentResults, operation);
          currentResults = rerankResult.results;
          operationMetadata = rerankResult.metadata;
          break;

        case 'filter':
          currentResults = await this.executeFilter(currentResults, operation);
          break;

        case 'clientFilter':
          // Client-side filtering using predicate function
          currentResults = currentResults.filter(operation.config.predicate);
          break;

        case 'llmStructured':
          currentResults = await this.executeLLMStructured(currentResults, operation);
          break;

        case 'generateEmbeddings':
          currentResults = await this.executeGenerateEmbeddings(currentResults, operation);
          break;

        default:
          console.warn(`Unknown operation type: ${(operation as any).type}`);
      }

      const duration = Date.now() - startTime;

      // Record the main operation with merged operations if any
      const opMeta: any = {
        type: operation.type,
        config: operation.config,
        inputCount,
        outputCount: currentResults.length,
        duration,
        metadata: operationMetadata
      };

      // Add mergedOperations and optimized flag if operations were merged
      if (mergedOperations.length > 0) {
        opMeta.mergedOperations = mergedOperations;
        opMeta.optimized = true;
      }

      this.recordOperationMetadata(opMeta);

      // Also record the merged operations individually (shared references)
      for (const mergedOp of mergedOperations) {
        this.recordOperationMetadata(mergedOp);
      }

      // Skip operations that were merged into this one
      i += skipCount;
    }

    // Sort by score (descending)
    currentResults.sort((a, b) => b.score - a.score);

    // Apply offset and limit
    const finalResults = currentResults.slice(this._offset, this._offset + this._limit);

    // Check for dirty embeddings and warn user
    this.checkDirtyEmbeddings(finalResults);

    return finalResults;
  }

  /**
   * Check if any results have dirty embeddings and warn the user
   */
  private checkDirtyEmbeddings(results: SearchResult<T>[]): void {
    const dirtyResults = results.filter(r => (r.entity as any)?.embeddingsDirty === true);

    if (dirtyResults.length > 0) {
      console.warn(`\n⚠️  WARNING: ${dirtyResults.length} of ${results.length} result(s) have stale embeddings!`);
      console.warn(`   Code has changed but embeddings have not been regenerated.`);
      console.warn(`   Run 'npm run embeddings:generate' to update embeddings.\n`);

      if (dirtyResults.length <= 5) {
        console.warn(`   Affected scopes:`);
        dirtyResults.forEach(r => {
          const entity = r.entity as any;
          console.warn(`     - ${entity.name || entity.uuid} (${entity.file})`);
        });
      }
    }
  }

  /**
   * FETCH Operation: Retrieve initial results from Neo4j
   */
  private async executeFetch(operation: FetchOperation): Promise<SearchResult<T>[]> {
    const { mode, uuids, scopeName, relationship, direction, filters, targetType } = operation.config;
    const params: Record<string, any> = {};
    let cypher = '';

    switch (mode) {
      case 'all':
        // Fetch all entities of this type
        cypher = `MATCH (n:\`${this.entityType}\`)`;
        break;

      case 'uuid':
        // Fetch specific UUIDs
        if (!uuids || uuids.length === 0) {
          return [];
        }
        cypher = `MATCH (n:\`${this.entityType}\`) WHERE n.uuid IN $uuids`;
        params.uuids = uuids;
        break;

      case 'relationship':
        // Fetch via relationship
        if (!scopeName || !relationship) {
          throw new Error('relationship mode requires scopeName and relationship');
        }
        params.targetScopeName = scopeName;

        // Use targetType if provided, otherwise fallback to this.entityType (for backwards compatibility)
        const targetLabel = targetType || this.entityType;

        if (direction === 'outgoing') {
          cypher = `MATCH (target:\`${targetLabel}\` {name: $targetScopeName}), (n:\`${this.entityType}\`)-[:${relationship}]->(target)`;
        } else {
          cypher = `MATCH (target:\`${targetLabel}\` {name: $targetScopeName}), (target)-[:${relationship}]->(n:\`${this.entityType}\`)`;
        }
        break;

      case 'filter':
        // Fetch with field filters - temporarily save filters and build WHERE
        const savedFilters = this.filters;
        this.filters = filters || {};

        cypher = `MATCH (n:\`${this.entityType}\`)`;
        const whereConditions = this.buildWhereConditions(params);
        if (whereConditions.length > 0) {
          cypher += ` WHERE ` + whereConditions.join(' AND ');
        }

        // Restore original filters
        this.filters = savedFilters;
        break;

      default:
        throw new Error(`Unknown fetch mode: ${mode}`);
    }

    // Add relationship enrichment (config-driven)
    const enrichmentClause = this.buildEnrichmentClause();
    const enrichmentReturn = this.buildEnrichmentReturn();

    cypher += enrichmentClause;
    cypher += `
      WITH ${enrichmentReturn}
      RETURN ${enrichmentReturn}
    `;

    const result = await this.client.run(cypher, params);
    return this.parseResults(result.records);
  }

  /**
   * EXPAND Operation with automatic filter fusion
   * Looks ahead for consecutive filter operations and merges them into the Cypher query
   */
  private async executeExpandWithFilters(
    currentResults: SearchResult<T>[],
    operation: ExpandOperation,
    currentIndex: number
  ): Promise<{ results: SearchResult<T>[], skippedOperations: number, mergedOperations: any[] }> {
    // Collect all consecutive filter operations that follow this expand
    const followingFilters: Record<string, any> = {};
    const mergedOps: any[] = [];
    let skipCount = 0;

    for (let j = currentIndex + 1; j < this.operations.length; j++) {
      const nextOp = this.operations[j];
      if (nextOp.type === 'filter') {
        // Only merge filter operations that have field filters
        // Relationship filters CANNOT be merged into expand and must be executed separately
        if (nextOp.config.relationshipFilter) {
          // Stop at relationship filter - it must be executed as a separate operation
          break;
        }

        // Create metadata object for this merged operation
        const mergedOpMeta = {
          type: 'filter',
          config: nextOp.config,
          skipped: true,
          mergedInto: currentIndex,
          inputCount: undefined,
          outputCount: undefined,
          duration: 0,
          metadata: {}
        };
        mergedOps.push(mergedOpMeta);

        // Merge field filters
        Object.assign(followingFilters, nextOp.config.filters);
        skipCount++;
      } else {
        // Stop at first non-filter operation
        break;
      }
    }

    // Execute expand with merged filters
    const results = await this.executeExpand(currentResults, operation, followingFilters);
    return { results, skippedOperations: skipCount, mergedOperations: mergedOps };
  }

  /**
   * EXPAND Operation: Follow relationships to find related entities
   */
  private async executeExpand(
    currentResults: SearchResult<T>[],
    operation: ExpandOperation,
    additionalFilters: Record<string, any> = {}
  ): Promise<SearchResult<T>[]> {
    if (currentResults.length === 0) {
      return [];
    }

    const { relType, depth = 1, direction = 'outgoing' } = operation.config;

    // Build query to expand from current results
    const uuids = currentResults.map(r => (r.entity as any).uuid).filter(Boolean);
    if (uuids.length === 0) {
      return currentResults;
    }

    let relationshipPattern = '';
    let pathPattern = '';
    switch (direction) {
      case 'outgoing':
        relationshipPattern = `-[:${relType}*1..${depth}]->`;
        pathPattern = `(n)-[rels:${relType}*1..${depth}]->(related)`;
        break;
      case 'incoming':
        relationshipPattern = `<-[:${relType}*1..${depth}]-`;
        pathPattern = `(n)<-[rels:${relType}*1..${depth}]-(related)`;
        break;
      case 'both':
        relationshipPattern = `-[:${relType}*1..${depth}]-`;
        pathPattern = `(n)-[rels:${relType}*1..${depth}]-(related)`;
        break;
    }

    // Build WHERE clause for additional filters
    const params: Record<string, any> = { uuids };
    let filterWhereClause = '';
    if (Object.keys(additionalFilters).length > 0) {
      // Temporarily set filters to build WHERE conditions
      const savedFilters = this.filters;
      this.filters = additionalFilters;
      const whereConditions = this.buildWhereConditions(params);
      this.filters = savedFilters;

      if (whereConditions.length > 0) {
        // Replace 'n.' with 'related.' in the conditions
        filterWhereClause = '\nAND ' + whereConditions.join(' AND ').replace(/\bn\./g, 'related.');
      }
    }

    // New approach: Fetch related entities grouped by source
    const cypher = `
      MATCH (n:\`${this.entityType}\`)
      WHERE n.uuid IN $uuids
      MATCH path = ${pathPattern}${filterWhereClause}
      RETURN n.uuid as sourceUuid,
             related,
             type(rels[0]) as relationshipType,
             length(path) as pathDepth
      ORDER BY n.uuid, pathDepth
    `;

    const result = await this.client.run(cypher, params);

    // Group related entities by source UUID
    const relatedBySource = new Map<string, any[]>();
    for (const record of result.records) {
      const sourceUuid = record.get('sourceUuid');
      const relatedNode = record.get('related');
      const relationshipType = record.get('relationshipType');
      const pathDepth = record.get('pathDepth');

      if (!relatedBySource.has(sourceUuid)) {
        relatedBySource.set(sourceUuid, []);
      }

      // Parse related entity properties
      const relatedEntity: any = {};
      const props = relatedNode.properties;
      for (const key in props) {
        relatedEntity[key] = props[key];
      }

      relatedBySource.get(sourceUuid)!.push({
        entity: relatedEntity,
        relationshipType,
        depth: pathDepth
      });
    }

    // Enrich current results with context.related
    return currentResults.map(result => {
      const uuid = (result.entity as any).uuid;
      const related = relatedBySource.get(uuid) || [];

      return {
        ...result,
        context: {
          ...(result.context || {}),
          related
        }
      };
    });
  }

  /**
   * SEMANTIC Operation with automatic filter fusion
   * Looks ahead for consecutive filter operations and merges them into the vector search
   */
  private async executeSemanticWithFilters(
    currentResults: SearchResult<T>[],
    operation: SemanticOperation,
    currentIndex: number
  ): Promise<{ results: SearchResult<T>[], metadata: any, skippedOperations: number, mergedOperations: any[] }> {
    // Collect all consecutive filter operations that follow this semantic search
    const followingFilters: Record<string, any> = {};
    const mergedOps: any[] = [];
    let skipCount = 0;

    for (let j = currentIndex + 1; j < this.operations.length; j++) {
      const nextOp = this.operations[j];
      if (nextOp.type === 'filter') {
        // Only merge filter operations that have field filters
        // Relationship filters CANNOT be merged into semantic and must be executed separately
        if (nextOp.config.relationshipFilter) {
          // Stop at relationship filter - it must be executed as a separate operation
          break;
        }

        // Create metadata object for this merged operation
        const mergedOpMeta = {
          type: 'filter',
          config: nextOp.config,
          skipped: true,
          mergedInto: currentIndex,
          inputCount: undefined,
          outputCount: undefined,
          duration: 0,
          metadata: {}
        };
        mergedOps.push(mergedOpMeta);

        // Merge field filters
        Object.assign(followingFilters, nextOp.config.filters);
        skipCount++;
      } else {
        // Stop at first non-filter operation
        break;
      }
    }

    // Execute semantic with merged filters
    const results = await this.executeSemantic(currentResults, operation, followingFilters);

    // Extract index config for metadata
    const indexConfig = VectorSearch['indexRegistry'].get(operation.config.vectorIndex);

    let metadata: any = {
      vectorIndex: operation.config.vectorIndex,
      model: indexConfig?.model || 'gemini-embedding-001',
      dimension: indexConfig?.dimension
    };

    // Apply metadata override if provided
    if (operation.config.metadataOverride) {
      metadata = operation.config.metadataOverride(results, metadata);
    }

    return { results, metadata, skippedOperations: skipCount, mergedOperations: mergedOps };
  }

  /**
   * Execute SEMANTIC operation with metadata tracking
   */
  private async executeSemanticWithMetadata(
    currentResults: SearchResult<T>[],
    operation: SemanticOperation
  ): Promise<{ results: SearchResult<T>[], metadata: any }> {
    const results = await this.executeSemantic(currentResults, operation);

    // Extract index config for metadata
    const indexConfig = VectorSearch['indexRegistry'].get(operation.config.vectorIndex);

    let metadata: any = {
      vectorIndex: operation.config.vectorIndex,
      model: indexConfig?.model || 'gemini-embedding-001',
      dimension: indexConfig?.dimension
    };

    // Apply metadata override if provided
    if (operation.config.metadataOverride) {
      metadata = operation.config.metadataOverride(results, metadata);
    }

    return { results, metadata };
  }

  /**
   * Execute LLM RERANK operation with metadata tracking
   */
  private async executeLLMRerankWithMetadata(
    currentResults: SearchResult<T>[],
    operation: LLMRerankOperation
  ): Promise<{ results: SearchResult<T>[], metadata: any }> {
    if (currentResults.length === 0) {
      return { results: [], metadata: {} };
    }

    const { userQuestion, llmProvider, options } = operation.config;

    // Ensure entityContext is provided for LLM reranking
    if (!this.entityContext) {
      throw new Error(
        `EntityContext is required for LLM reranking but was not provided. ` +
        `Please provide an EntityContext when creating the QueryBuilder. ` +
        `If using generated code, ensure you have regenerated with 'ragforge generate'.`
      );
    }

    // Create reranker with entity context
    const reranker = new LLMReranker(llmProvider, options, this.entityContext);

    // Build query context
    const queryContext = `// Pipeline operations executed: ${this.operations.length}`;

    // Perform reranking
    const rerankResult = await reranker.rerank({
      userQuestion,
      results: currentResults,
      queryContext
    });

    // Apply score merging
    const results = reranker.mergeScores(
      currentResults,
      rerankResult.evaluations,
      options?.scoreMerging,
      options?.weights
    );

    // Extract metadata
    let metadata: any = {
      llmModel: (llmProvider as any).modelName || 'unknown',
      evaluations: rerankResult.evaluations.map(e => ({
        entityId: e.scopeId,
        score: e.score,
        reasoning: e.reasoning
      }))
    };

    if (rerankResult.queryFeedback) {
      metadata.queryFeedback = rerankResult.queryFeedback;
    }

    // Apply metadata override if provided
    if (options?.metadataOverride) {
      metadata = options.metadataOverride(results, metadata);
    }

    return { results, metadata };
  }

  /**
   * SEMANTIC Operation: Filter/rerank by semantic similarity
   *
   * This is the KEY operation that enables flexible chaining:
   * - If currentResults is EMPTY: do normal vector search
   * - If currentResults EXISTS: filter to only those UUIDs
   */
  private async executeSemantic(
    currentResults: SearchResult<T>[],
    operation: SemanticOperation,
    additionalFilters: Record<string, any> = {}
  ): Promise<SearchResult<T>[]> {
    const { query, vectorIndex, topK, minScore } = operation.config;

    try {
      // Extract UUIDs from current results for filtering
      const filterUuids = currentResults.length > 0
        ? currentResults.map(r => (r.entity as any).uuid).filter(Boolean)
        : undefined;

      // Build WHERE conditions for additional filters
      const fieldFilterConditions: { conditions: string[], params: Record<string, any> } = { conditions: [], params: {} };
      if (Object.keys(additionalFilters).length > 0) {
        const savedFilters = this.filters;
        this.filters = additionalFilters;
        const whereConditions = this.buildWhereConditions(fieldFilterConditions.params);
        this.filters = savedFilters;

        // Replace 'n.' with 'node.' for vector search
        fieldFilterConditions.conditions = whereConditions.map(cond => cond.replace(/\bn\./g, 'node.'));
      }

      // Perform vector search (with optional UUID filtering and field filters)
      const vectorResults = await this.vectorSearch.search(query, {
        indexName: vectorIndex,
        topK: Math.floor(topK),  // Ensure integer for Neo4j
        minScore,
        filterUuids,  // Filter to existing results
        fieldFilterConditions  // Additional field filters as WHERE conditions
      });

      // Convert vector results to SearchResult format
      const semanticResults: SearchResult<T>[] = vectorResults.map(vr => ({
        entity: vr.properties as T,
        score: vr.score,
        scoreBreakdown: {
          semantic: vr.score
        },
        context: undefined
      }));

      // If we had previous results, merge scores
      if (currentResults.length > 0) {
        const prevScoreMap = new Map(
          currentResults.map(r => [(r.entity as any).uuid, r])
        );

        return semanticResults.map(sr => {
          const uuid = (sr.entity as any).uuid;
          const prevResult = prevScoreMap.get(uuid);

          if (prevResult) {
            // Merge scores: weighted combination
            const combinedScore = prevResult.score * 0.3 + sr.score * 0.7;
            return {
              ...sr,
              score: combinedScore,
              scoreBreakdown: {
                ...prevResult.scoreBreakdown,
                semantic: sr.score,
                previous: prevResult.score
              }
            };
          }

          return sr;
        });
      }

      return semanticResults;

    } catch (error: any) {
      console.error('Semantic search operation failed:', error.message);
      return currentResults;
    }
  }

  /**
   * LLM_RERANK Operation: Rerank using LLM
   */
  private async executeLLMRerank(
    currentResults: SearchResult<T>[],
    operation: LLMRerankOperation
  ): Promise<SearchResult<T>[]> {
    if (currentResults.length === 0) {
      return [];
    }

    const { userQuestion, llmProvider, options } = operation.config;

    // Ensure entityContext is provided for LLM reranking
    if (!this.entityContext) {
      throw new Error(
        `EntityContext is required for LLM reranking but was not provided. ` +
        `Please provide an EntityContext when creating the QueryBuilder. ` +
        `If using generated code, ensure you have regenerated with 'ragforge generate'.`
      );
    }

    try {
      // Create reranker
      const reranker = new LLMReranker(llmProvider, options, this.entityContext);

      // Build query context
      const queryContext = `// Pipeline operations executed: ${this.operations.length}`;

      // Perform reranking
      const rerankResult = await reranker.rerank({
        userQuestion,
        results: currentResults,
        queryContext
      });

      // Merge LLM scores with existing scores
      const strategy = options?.scoreMerging || 'weighted';
      const weights = options?.weights || { vector: 0.3, llm: 0.7 };

      return reranker.mergeScores(
        currentResults,
        rerankResult.evaluations,
        strategy,
        weights
      );

    } catch (error: any) {
      console.error('LLM reranking operation failed:', error.message);
      return currentResults;
    }
  }

  /**
   * FILTER Operation: Post-process filtering
   */
  private async executeFilter(
    currentResults: SearchResult<T>[],
    operation: FilterOperation
  ): Promise<SearchResult<T>[]> {
    const { filters, relationshipFilter } = operation.config;

    // Handle relationship filters (requires Neo4j query)
    if (relationshipFilter) {
      return this.executeRelationshipFilter(currentResults, relationshipFilter);
    }

    // If no current results, fetch from database with filters
    if (currentResults.length === 0) {
      const fetchOp: FetchOperation = {
        type: 'fetch',
        config: {
          mode: 'filter',
          filters
        }
      };
      return this.executeFetch(fetchOp);
    }

    // Otherwise, filter in-memory
    return currentResults.filter(result => {
      for (const [key, value] of Object.entries(filters)) {
        const entityValue = (result.entity as any)[key];

        // Handle complex filter operators
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const operators = value as any;

          if ('equals' in operators && entityValue !== operators.equals) {
            return false;
          }
          if ('contains' in operators && !entityValue?.includes(operators.contains)) {
            return false;
          }
          if ('startsWith' in operators && !entityValue?.startsWith(operators.startsWith)) {
            return false;
          }
          if ('endsWith' in operators && !entityValue?.endsWith(operators.endsWith)) {
            return false;
          }
        } else {
          // Simple equality check
          if (entityValue !== value) {
            return false;
          }
        }
      }
      return true;
    });
  }

  /**
   * Execute LLM STRUCTURED operation: Generate custom structured outputs using LLM
   */
  private async executeLLMStructured(
    currentResults: SearchResult<T>[],
    operation: any
  ): Promise<SearchResult<any>[]> {
    if (currentResults.length === 0) {
      return [];
    }

    const config = operation.config as LLMStructuredCallConfig<T, any>;

    try {
      // Extract entities from SearchResults
      const entities = currentResults.map(r => r.entity);

      // Execute LLM batch generation
      const enriched = await this.structuredLLMExecutor.executeLLMBatch(entities, config);

      // Merge generated fields back into SearchResults
      return currentResults.map((result, index) => ({
        ...result,
        entity: enriched[index]
      }));
    } catch (error: any) {
      console.error('LLM structured generation failed:', error.message);
      return currentResults;
    }
  }

  /**
   * Execute GENERATE EMBEDDINGS operation: Generate embeddings with relationship context
   */
  private async executeGenerateEmbeddings(
    currentResults: SearchResult<T>[],
    operation: any
  ): Promise<SearchResult<any>[]> {
    if (currentResults.length === 0) {
      return [];
    }

    const config = operation.config as EmbeddingGenerationConfig;

    try {
      // Extract entities from SearchResults
      const entities = currentResults.map(r => r.entity);

      // Execute embedding generation
      const withEmbeddings = await this.structuredLLMExecutor.generateEmbeddings(entities, config);

      // Merge embeddings back into SearchResults
      return currentResults.map((result, index) => ({
        ...result,
        entity: withEmbeddings[index]
      }));
    } catch (error: any) {
      console.error('Embedding generation failed:', error.message);
      return currentResults;
    }
  }

  /**
   * Execute relationship filter - queries Neo4j to check which results satisfy the relationship
   */
  private async executeRelationshipFilter(
    currentResults: SearchResult<T>[],
    relationshipFilter: { entityName: string; relationship: string; direction: string; targetType?: string }
  ): Promise<SearchResult<T>[]> {
    if (currentResults.length === 0) {
      return [];
    }

    const { entityName, relationship, direction, targetType } = relationshipFilter;
    const uuids = currentResults.map(r => (r.entity as any).uuid).filter(Boolean);

    if (uuids.length === 0) {
      return currentResults;
    }

    // Use targetType if provided, otherwise fallback to this.entityType (for backwards compatibility)
    const targetLabel = targetType || this.entityType;

    // Query Neo4j to find which UUIDs satisfy the relationship
    let cypher = '';
    if (direction === 'outgoing') {
      cypher = `
        MATCH (target:\`${targetLabel}\` {name: $entityName})
        MATCH (n:\`${this.entityType}\`)-[:${relationship}]->(target)
        WHERE n.uuid IN $uuids
        RETURN n.uuid AS uuid
      `;
    } else {
      cypher = `
        MATCH (target:\`${targetLabel}\` {name: $entityName})
        MATCH (target)-[:${relationship}]->(n:\`${this.entityType}\`)
        WHERE n.uuid IN $uuids
        RETURN n.uuid AS uuid
      `;
    }

    const result = await this.client.run(cypher, { entityName, uuids });
    const matchingUuids = new Set(result.records.map(r => r.get('uuid')));

    // Filter currentResults to only those that match
    return currentResults.filter(r => matchingUuids.has((r.entity as any).uuid));
  }

  /**
   * Get count of matching entities (without executing full query)
   */
  async count(): Promise<number> {
    const cypherQuery = this.buildCountCypher();
    const result = await this.client.run(cypherQuery.query, cypherQuery.params);
    return result.records[0]?.get('count').toNumber() || 0;
  }

  /**
   * Explain query execution plan
   */
  async explain(): Promise<QueryPlan> {
    const cypherQuery = this.buildCypher();
    return this.client.explain(cypherQuery.query, cypherQuery.params);
  }

  /**
   * Build Cypher query from current builder state
   */
  protected buildCypher(): CypherQuery {
    const params: Record<string, any> = {};
    let cypher = '';

    // Build MATCH clause (potentially with relationship filter)
    if (this.relatedToFilter) {
      const { scopeName, relationship, direction } = this.relatedToFilter;
      params.targetScopeName = scopeName;

      if (direction === 'outgoing') {
        // Find scopes that have relationship TO target
        cypher = `MATCH (target:\`${this.entityType}\` {name: $targetScopeName}), (n:\`${this.entityType}\`)-[:${relationship}]->(target)`;
      } else {
        // Find scopes that target has relationship TO
        cypher = `MATCH (target:\`${this.entityType}\` {name: $targetScopeName}), (target)-[:${relationship}]->(n:\`${this.entityType}\`)`;
      }
    } else {
      cypher = `MATCH (n:\`${this.entityType}\`)`;
    }

    // Build WHERE clause
    const whereConditions = this.buildWhereConditions(params);

    // Add UUID filter if present
    if (this.uuidFilter && this.uuidFilter.length > 0) {
      params.uuidList = this.uuidFilter;
      whereConditions.push('n.uuid IN $uuidList');
    }

    if (whereConditions.length > 0) {
      cypher += `\nWHERE ` + whereConditions.join(' AND ');
    }

    // Build expansions (relationship traversals)
    for (let i = 0; i < this.expansions.length; i++) {
      const { relType, options } = this.expansions[i];
      const depth = options.depth || 1;
      const varName = `related_${i}`;

      cypher += `\nOPTIONAL MATCH path${i} = (n)-[:${relType}*1..${depth}]->(${varName})`;
      cypher += `\nWITH n, collect(DISTINCT ${varName}) AS ${varName}_list`;
    }

    // Return clause
    cypher += `\nRETURN n`;

    // Add related entities to return
    if (this.expansions.length > 0) {
      for (let i = 0; i < this.expansions.length; i++) {
        cypher += `, related_${i}_list`;
      }
    }

    // Order by
    if (this._orderBy) {
      cypher += `\nORDER BY n.${this._orderBy.field} ${this._orderBy.direction}`;
    }

    // Note: We don't add LIMIT/OFFSET here as we handle that after reranking

    return { query: cypher, params };
  }

  /**
   * Build WHERE conditions from filters
   */
  private buildWhereConditions(params: Record<string, any>): string[] {
    const conditions: string[] = [];

    for (const [field, value] of Object.entries(this.filters)) {
      if (value === null || value === undefined) {
        continue;
      }

      // Check if this is a regex pattern filter
      if (field.endsWith('__pattern')) {
        const actualFieldName = field.replace('__pattern', '');
        const paramName = `${actualFieldName}_pattern`;
        conditions.push(`n.${actualFieldName} =~ $${paramName}`);
        params[paramName] = value as string;
        continue;
      }

      // Check if value is an operator object
      if (typeof value === 'object' && !Array.isArray(value)) {
        const operators = value as any;

        if ('equals' in operators) {
          const paramName = `${field}_eq`;
          conditions.push(`n.${field} = $${paramName}`);
          params[paramName] = operators.equals;
        }

        if ('contains' in operators) {
          const paramName = `${field}_contains`;
          conditions.push(`n.${field} CONTAINS $${paramName}`);
          params[paramName] = operators.contains;
        }

        if ('startsWith' in operators) {
          const paramName = `${field}_starts`;
          conditions.push(`n.${field} STARTS WITH $${paramName}`);
          params[paramName] = operators.startsWith;
        }

        if ('endsWith' in operators) {
          const paramName = `${field}_ends`;
          conditions.push(`n.${field} ENDS WITH $${paramName}`);
          params[paramName] = operators.endsWith;
        }

        if ('gt' in operators) {
          const paramName = `${field}_gt`;
          conditions.push(`n.${field} > $${paramName}`);
          params[paramName] = operators.gt;
        }

        if ('gte' in operators) {
          const paramName = `${field}_gte`;
          conditions.push(`n.${field} >= $${paramName}`);
          params[paramName] = operators.gte;
        }

        if ('lt' in operators) {
          const paramName = `${field}_lt`;
          conditions.push(`n.${field} < $${paramName}`);
          params[paramName] = operators.lt;
        }

        if ('lte' in operators) {
          const paramName = `${field}_lte`;
          conditions.push(`n.${field} <= $${paramName}`);
          params[paramName] = operators.lte;
        }

        if ('in' in operators) {
          const paramName = `${field}_in`;
          conditions.push(`n.${field} IN $${paramName}`);
          params[paramName] = operators.in;
        }
      } else {
        // Simple equality
        const paramName = field;
        conditions.push(`n.${field} = $${paramName}`);
        params[paramName] = value;
      }
    }

    return conditions;
  }

  /**
   * Build count query
   */
  private buildCountCypher(): CypherQuery {
    let cypher = `MATCH (n:\`${this.entityType}\`)`;
    const params: Record<string, any> = {};

    const whereConditions = this.buildWhereConditions(params);
    if (whereConditions.length > 0) {
      cypher += `\nWHERE ` + whereConditions.join(' AND ');
    }

    cypher += `\nRETURN count(n) AS count`;

    return { query: cypher, params };
  }

  /**
   * Parse raw Neo4j records into SearchResults
   */
  private parseResults(records: any[]): SearchResult<T>[] {
    return records.map(record => {
      const entity = record.get('n').properties as T;

      // Add enriched relationship fields (config-driven)
      // This helps with semantic search and LLM reranking
      const enrichmentFields = this.getEnrichmentFields();
      for (const fieldName of enrichmentFields) {
        try {
          const fieldValue = record.get(fieldName);
          if (fieldValue && fieldValue.length > 0) {
            (entity as any)[fieldName] = fieldValue;
          }
        } catch (e) {
          // Field might not exist in query (e.g., no enrichment configured)
        }
      }

      // Parse related entities if expansions were used
      // BUT: Only in legacy mode, not in pipeline mode
      // In pipeline mode, expansions are handled differently (expanded entities become regular results)
      const related = (this.expansions.length > 0 && this.operations.length === 0)
        ? this.parseRelatedEntities(record)
        : undefined;

      return {
        entity,
        score: 1.0, // Base score
        scoreBreakdown: {},
        context: related ? { related } : undefined
      };
    });
  }

  /**
   * Parse related entities from expansion
   */
  private parseRelatedEntities(record: any): any[] {
    const related: any[] = [];

    for (let i = 0; i < this.expansions.length; i++) {
      const relatedList = record.get(`related_${i}_list`);
      const { relType } = this.expansions[i];

      if (relatedList && relatedList.length > 0) {
        for (const node of relatedList) {
          if (node) {
            related.push({
              entity: node.properties,
              relationshipType: relType,
              direction: 'outgoing',
              distance: 1 // TODO: Calculate actual distance
            });
          }
        }
      }
    }

    return related;
  }

  /**
   * Apply semantic search using VectorSearch module
   */
  private async applySemanticSearch(
    results: SearchResult<T>[]
  ): Promise<SearchResult<T>[]> {
    if (!this.semanticQuery) {
      return results;
    }

    const { text, options } = this.semanticQuery;
    const indexName = options.vectorIndex;

    if (!indexName) {
      console.warn('Semantic search requires vectorIndex option');
      return results;
    }

    try {
      // Perform vector search
      const vectorResults = await this.vectorSearch.search(text, {
        indexName,
        topK: options.topK || 20,
        minScore: options.minScore || 0.0
      });

      // If we have filter results, merge them with vector results
      if (results.length > 0) {
        return this.mergeResults(results, vectorResults);
      }

      // Otherwise, use vector results directly
      return vectorResults.map(vr => ({
        entity: vr.properties as T,
        score: vr.score,
        scoreBreakdown: {
          semantic: vr.score
        },
        context: undefined
      }));
    } catch (error: any) {
      console.error('Semantic search failed:', error.message);
      return results;
    }
  }

  /**
   * Merge filter-based results with vector search results
   */
  private mergeResults(
    filterResults: SearchResult<T>[],
    vectorResults: any[]
  ): SearchResult<T>[] {
    // Create a map of vector scores by node properties
    const vectorScoreMap = new Map<string, number>();

    for (const vr of vectorResults) {
      // Use UUID or name as key for matching
      const key = vr.properties.uuid || vr.properties.name || vr.nodeId;
      vectorScoreMap.set(key, vr.score);
    }

    // Enhance filter results with vector scores
    return filterResults.map(result => {
      const key = (result.entity as any).uuid || (result.entity as any).name;
      const vectorScore = vectorScoreMap.get(key);

      if (vectorScore !== undefined) {
        // Combine scores
        return {
          ...result,
          score: result.score * 0.3 + vectorScore * 0.7,  // Weight vector higher
          scoreBreakdown: {
            ...result.scoreBreakdown,
            filter: result.score,
            semantic: vectorScore
          }
        };
      }

      // No vector match, lower the score
      return {
        ...result,
        score: result.score * 0.3,
        scoreBreakdown: {
          ...result.scoreBreakdown,
          filter: result.score,
          semantic: 0
        }
      };
    });
  }

  /**
   * Expand relationships for results (used after vector search)
   */
  private async expandRelationshipsForResults(results: SearchResult<T>[]): Promise<SearchResult<T>[]> {
    // For each result, fetch its relationships
    const expandedResults = await Promise.all(
      results.map(async (result) => {
        const uuid = (result.entity as any).uuid;

        if (!uuid) {
          return result;
        }

        // Build relationship query
        let cypher = `MATCH (n:\`${this.entityType}\` {uuid: $uuid})`;

        for (let i = 0; i < this.expansions.length; i++) {
          const { relType, options } = this.expansions[i];
          const depth = options.depth || 1;
          const varName = `related_${i}`;

          cypher += `\nOPTIONAL MATCH (n)-[:${relType}*1..${depth}]->(${varName})`;

          // Build WITH clause that carries forward all previous related_X_list
          const withItems = ['n'];
          for (let j = 0; j < i; j++) {
            withItems.push(`related_${j}_list`);
          }
          withItems.push(`collect(DISTINCT ${varName}) AS ${varName}_list`);

          cypher += `\nWITH ${withItems.join(', ')}`;
        }

        cypher += `\nRETURN n`;

        for (let i = 0; i < this.expansions.length; i++) {
          cypher += `, related_${i}_list`;
        }

        // Debug: log the query
        // console.log('Relationship expansion query:', cypher);
        // console.log('UUID:', uuid);

        const relResult = await this.client.run(cypher, { uuid });

        if (relResult.records.length > 0) {
          const record = relResult.records[0];
          const related = this.parseRelatedEntities(record);

          return {
            ...result,
            context: related.length > 0 ? { related } : result.context
          };
        }

        return result;
      })
    );

    return expandedResults;
  }

  /**
   * Apply LLM reranking to search results
   */
  private async applyLLMReranking(results: SearchResult<T>[]): Promise<SearchResult<T>[]> {
    if (!this.llmRerankConfig || results.length === 0) {
      return results;
    }

    const { userQuestion, llmProvider, options } = this.llmRerankConfig;

    // Ensure entityContext is provided for LLM reranking
    if (!this.entityContext) {
      throw new Error(
        `EntityContext is required for LLM reranking but was not provided. ` +
        `Please provide an EntityContext when creating the QueryBuilder. ` +
        `If using generated code, ensure you have regenerated with 'ragforge generate'.`
      );
    }

    try {
      // Create reranker with entity context
      const reranker = new LLMReranker(llmProvider, options, this.entityContext);

      // Get the query context (show the user what query was used)
      const cypherQuery = this.buildCypher();
      const queryContext = `// QueryBuilder configuration:\n${JSON.stringify({
        semantic: this.semanticQuery ? `"${this.semanticQuery.text}"` : undefined,
        filters: this.filters,
        relatedTo: this.relatedToFilter,
        limit: this._limit
      }, null, 2)}`;

      // Perform reranking
      const rerankResult = await reranker.rerank({
        userQuestion,
        results,
        queryContext
      });

      // Merge LLM scores with existing scores
      const strategy = options?.scoreMerging || 'weighted';
      const weights = options?.weights || { vector: 0.3, llm: 0.7 };

      const rerankedResults = reranker.mergeScores(
        results,
        rerankResult.evaluations,
        strategy,
        weights
      );

      // Log query feedback if available
      if (rerankResult.queryFeedback) {
        console.log('\n[LLM Reranking Feedback]');
        console.log(`Quality: ${rerankResult.queryFeedback.quality}`);
        if (rerankResult.queryFeedback.suggestions.length > 0) {
          console.log('Suggestions:');
          rerankResult.queryFeedback.suggestions.forEach(s => {
            console.log(`  - [${s.type}] ${s.description}`);
            if (s.exampleCode) {
              console.log(`    ${s.exampleCode}`);
            }
          });
        }
      }

      return rerankedResults;
    } catch (error: any) {
      console.error('LLM reranking failed:', error.message);
      // Return original results if reranking fails
      return results;
    }
  }

  /**
   * Apply reranking strategy (placeholder - will be implemented by RerankingEngine)
   */
  private async applyReranking(
    results: SearchResult<T>[],
    strategy: string
  ): Promise<SearchResult<T>[]> {
    // TODO: Implement in RerankingEngine
    console.warn(`Reranking strategy '${strategy}' not yet implemented`);
    return results;
  }
}
