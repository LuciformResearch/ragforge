/**
 * GenericQueryBuilder - Fluent API for building queries
 *
 * Provides a generic query interface that works for any entity type:
 * - .get(entity) - Start query
 * - .getRelationship(name, direction?, targetEntity?) - Add relationship traversal
 * - .filter(name, params?) - Add named filter
 * - .where(field, operator, value) - Add where condition
 * - .semanticSearch(indexName, query, options?) - Add semantic search
 * - .textSearch(query, fields?) - Add text search
 * - .limit(n) - Set limit
 * - .offset(n) - Set offset
 * - .orderBy(field, direction?) - Add ordering
 * - .execute() - Execute query
 * - .explain() - Get explanation
 *
 * Example usage:
 * ```typescript
 * const results = await client
 *   .get('Scope')
 *   .getRelationship('DEPENDS_ON')
 *   .filter('complexityGt5')
 *   .semanticSearch('code_embeddings', 'authentication logic')
 *   .limit(10)
 *   .execute();
 * ```
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import { QueryPlan, type RelationshipDirection, type WhereCondition } from './query-plan.js';
import { QueryExecutor, type FilterRegistry } from './query-executor.js';

export interface GenericQueryBuilderOptions {
  neo4j: Neo4jClient;
  filterRegistry?: FilterRegistry;
  entityContext?: any; // For LLM reranking
}

export interface SemanticSearchOptions {
  minScore?: number;
  topK?: number;
  rerank?: boolean;
  rerankModel?: string;
}

/**
 * GenericQueryBuilder - Fluent API for building and executing queries
 */
export class GenericQueryBuilder<T = any> {
  private plan: QueryPlan;
  private executor: QueryExecutor;

  constructor(
    entity: string,
    private options: GenericQueryBuilderOptions
  ) {
    this.plan = new QueryPlan(entity);
    this.executor = new QueryExecutor({
      neo4j: options.neo4j,
      filterRegistry: options.filterRegistry,
      entityContext: options.entityContext
    });
  }

  /**
   * Static factory method to start a query
   */
  static get<T = any>(
    entity: string,
    options: GenericQueryBuilderOptions
  ): GenericQueryBuilder<T> {
    return new GenericQueryBuilder<T>(entity, options);
  }

  /**
   * Add relationship traversal
   *
   * @param name - Relationship name (e.g., 'DEPENDS_ON', 'CALLED_BY')
   * @param direction - Direction: 'outgoing' (default), 'incoming', or 'both'
   * @param targetEntity - Optional target entity type
   *
   * @example
   * .getRelationship('DEPENDS_ON')
   * .getRelationship('CALLED_BY', 'incoming')
   * .getRelationship('USES', 'outgoing', 'ExternalLibrary')
   */
  getRelationship(
    name: string,
    direction: RelationshipDirection = 'outgoing',
    targetEntity?: string
  ): this {
    this.plan.addRelationship(name, direction, targetEntity);
    return this;
  }

  /**
   * Add a named filter from the filter registry
   *
   * @param name - Filter name (e.g., 'complexityGt5', 'recentlyModified')
   * @param params - Optional parameters for the filter
   *
   * @example
   * .filter('complexityGt5')
   * .filter('modifiedAfter', { date: '2024-01-01' })
   */
  filter(name: string, params?: Record<string, any>): this {
    this.plan.addFilter(name, params);
    return this;
  }

  /**
   * Add a WHERE condition
   *
   * @param field - Field name
   * @param operator - Comparison operator
   * @param value - Value to compare against
   *
   * @example
   * .where('complexity', '>', 5)
   * .where('name', 'CONTAINS', 'auth')
   * .where('tags', 'IN', ['core', 'utils'])
   */
  where(
    field: string,
    operator: WhereCondition['operator'],
    value: any
  ): this {
    this.plan.addWhere(field, operator, value);
    return this;
  }

  /**
   * Add semantic search (vector search)
   *
   * @param indexName - Name of the vector index
   * @param query - Search query
   * @param options - Optional search options (minScore, topK, rerank)
   *
   * @example
   * .semanticSearch('code_embeddings', 'authentication logic')
   * .semanticSearch('code_embeddings', 'error handling', { topK: 20, minScore: 0.8 })
   */
  semanticSearch(
    indexName: string,
    query: string,
    options?: SemanticSearchOptions
  ): this {
    this.plan.setSemanticSearch({
      indexName,
      query,
      minScore: options?.minScore,
      topK: options?.topK,
      rerank: options?.rerank,
      rerankModel: options?.rerankModel
    });
    return this;
  }

  /**
   * Add text search (full-text search)
   *
   * @param query - Search query
   * @param fields - Optional fields to search in
   *
   * @example
   * .textSearch('authentication')
   * .textSearch('error handling', ['name', 'summary'])
   */
  textSearch(query: string, fields?: string[]): this {
    this.plan.setTextSearch({ query, fields });
    return this;
  }

  /**
   * Set result limit
   *
   * @param n - Maximum number of results
   *
   * @example
   * .limit(10)
   */
  limit(n: number): this {
    this.plan.setLimit(n);
    return this;
  }

  /**
   * Set result offset (skip first N results)
   *
   * @param n - Number of results to skip
   *
   * @example
   * .offset(20)
   */
  offset(n: number): this {
    this.plan.setOffset(n);
    return this;
  }

  /**
   * Add ordering
   *
   * @param field - Field to order by
   * @param direction - 'ASC' (default) or 'DESC'
   *
   * @example
   * .orderBy('complexity', 'DESC')
   * .orderBy('name')
   */
  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.plan.addOrderBy(field, direction);
    return this;
  }

  /**
   * Execute the query and return results
   *
   * @returns Array of results
   *
   * @example
   * const results = await query.execute();
   */
  async execute(): Promise<T[]> {
    return await this.executor.execute<T>(this.plan);
  }

  /**
   * Get natural language explanation of the query
   *
   * @returns Natural language description
   *
   * @example
   * console.log(query.explain());
   * // "Find Scope entities following DEPENDS_ON relationships, filtered by: complexityGt5, ..."
   */
  explain(): string {
    return this.plan.explain();
  }

  /**
   * Get Cypher query that would be executed
   *
   * @returns Cypher query string with parameters
   *
   * @example
   * const { cypher, params } = query.getCypher();
   */
  getCypher(): { cypher: string; params: Record<string, any> } {
    return this.executor.generateCypher(this.plan);
  }

  /**
   * Get summary of the query plan
   *
   * @returns Query summary object
   */
  getSummary() {
    return this.plan.getSummary();
  }

  /**
   * Clone this query builder
   *
   * @returns New query builder with same plan
   */
  clone(): GenericQueryBuilder<T> {
    const cloned = new GenericQueryBuilder<T>(this.plan.entity, this.options);
    cloned.plan = this.plan.clone();
    return cloned;
  }
}

/**
 * QueryClient - High-level client for generic queries
 *
 * Provides the .get() entry point for building queries
 */
export class QueryClient {
  constructor(private options: GenericQueryBuilderOptions) {}

  /**
   * Start a new query for an entity
   *
   * @param entity - Entity type (e.g., 'Scope', 'File', 'Function')
   * @returns GenericQueryBuilder instance
   *
   * @example
   * const results = await client.get('Scope')
   *   .where('complexity', '>', 5)
   *   .limit(10)
   *   .execute();
   */
  get<T = any>(entity: string): GenericQueryBuilder<T> {
    return GenericQueryBuilder.get<T>(entity, this.options);
  }

  /**
   * Register a custom filter
   *
   * @param name - Filter name
   * @param cypherCondition - Cypher condition (use 'n' as node alias)
   * @param paramNames - Optional parameter names
   *
   * @example
   * client.registerFilter('complexityGt5', 'n.complexity > 5');
   * client.registerFilter('modifiedAfter', 'n.last_modified > $afterDate', ['afterDate']);
   */
  registerFilter(
    name: string,
    cypherCondition: string,
    paramNames?: string[]
  ): void {
    if (!this.options.filterRegistry) {
      this.options.filterRegistry = {};
    }
    this.options.filterRegistry[name] = { cypherCondition, paramNames };
  }

  /**
   * Get all registered filters
   */
  getFilters(): FilterRegistry {
    return this.options.filterRegistry || {};
  }
}
