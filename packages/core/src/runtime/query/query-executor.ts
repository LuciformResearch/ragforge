/**
 * QueryExecutor - Executes QueryPlan by generating and running Cypher
 *
 * Handles:
 * - Cypher generation from QueryPlan
 * - Parameter binding
 * - Result mapping
 * - Semantic search integration
 * - Vector search integration
 *
 * Test change to verify watch functionality.
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import { VectorSearch } from '../vector/vector-search.js';
import { LLMReranker } from '../reranking/llm-reranker.js';
import type { QueryPlan, RelationshipDirection } from './query-plan.js';
import neo4j from 'neo4j-driver';

export interface FilterRegistry {
  [filterName: string]: {
    cypherCondition: string;
    paramNames?: string[];
  };
}

export interface QueryExecutorOptions {
  neo4j: Neo4jClient;
  filterRegistry?: FilterRegistry;
  entityContext?: any; // EntityContext for LLM reranking
}

export class QueryExecutor {
  private neo4j: Neo4jClient;
  private filterRegistry: FilterRegistry;
  private entityContext?: any;

  constructor(options: QueryExecutorOptions) {
    this.neo4j = options.neo4j;
    this.filterRegistry = options.filterRegistry || {};
    this.entityContext = options.entityContext;
  }

  /**
   * Execute a query plan
   */
  async execute<T = any>(plan: QueryPlan): Promise<T[]> {
    // If semantic search is present, handle it specially
    if (plan.semanticSearch) {
      return await this.executeWithSemanticSearch<T>(plan);
    }

    // Otherwise, generate and execute Cypher
    const { cypher, params } = this.generateCypher(plan);
    const result = await this.neo4j.run(cypher, params);

    return this.mapResults<T>(result, plan);
  }

  /**
   * Execute with semantic search (vector search)
   */
  private async executeWithSemanticSearch<T>(plan: QueryPlan): Promise<T[]> {
    if (!plan.semanticSearch) {
      throw new Error('No semantic search defined in plan');
    }

    const { indexName, query, minScore, topK, rerank, rerankModel } = plan.semanticSearch;

    // Use VectorSearch
    const vectorSearch = new VectorSearch(this.neo4j);

    let results = await vectorSearch.search(query, {
      indexName,
      topK: topK || 10,
      minScore: minScore || 0.7
    });

    // Apply reranking if requested
    if (rerank && this.entityContext) {
      const reranker = new LLMReranker(
        LLMReranker.getDefaultProvider()!,
        {},
        this.entityContext
      );

      // Convert VectorSearchResult to SearchResult format for reranker
      const searchResults = results.map(r => ({
        entity: r.properties,
        score: r.score
      }));

      const reranked = await reranker.rerank({
        userQuestion: query,
        results: searchResults
      });

      // Convert back to original format with new scores from evaluations
      results = reranked.evaluations.map(evaluation => ({
        nodeId: evaluation.scopeId,
        score: evaluation.score,
        properties: searchResults.find(r => r.entity.uuid === evaluation.scopeId)?.entity || {}
      }));
    }

    // Apply relationship traversal if present
    if (plan.relationships.length > 0) {
      results = await this.applyRelationships(results, plan);
    }

    // Apply limit/offset
    let finalResults = results;
    if (plan.offsetValue) {
      finalResults = finalResults.slice(plan.offsetValue);
    }
    if (plan.limitValue) {
      finalResults = finalResults.slice(0, plan.limitValue);
    }

    // Flatten structure: merge properties with score at top level
    const flattenedResults = finalResults.map(r => ({
      ...r.properties,
      score: r.score
    }));

    return flattenedResults as T[];
  }

  /**
   * Build filters for vector search from QueryPlan
   */
  private buildFiltersForVectorSearch(plan: QueryPlan): Record<string, any> | undefined {
    if (plan.whereConditions.length === 0 && plan.filters.length === 0) {
      return undefined;
    }

    const filters: Record<string, any> = {};

    // Simple where conditions
    for (const where of plan.whereConditions) {
      if (where.operator === '=') {
        filters[where.field] = where.value;
      }
      // TODO: Support other operators
    }

    return filters;
  }

  /**
   * Apply relationship traversal to existing results
   */
  private async applyRelationships<T>(results: any[], plan: QueryPlan): Promise<T[]> {
    if (results.length === 0 || plan.relationships.length === 0) {
      return results;
    }

    const uuids = results.map(r => r.uuid).filter(Boolean);
    if (uuids.length === 0) return results;

    // Build relationship traversal Cypher
    let cypher = `MATCH (start:${plan.entity}) WHERE start.uuid IN $uuids\n`;
    let currentAlias = 'start';

    for (let i = 0; i < plan.relationships.length; i++) {
      const rel = plan.relationships[i];
      const nextAlias = `n${i}`;
      const relPattern = this.buildRelationshipPattern(currentAlias, rel, nextAlias);
      cypher += `MATCH ${relPattern}\n`;
      currentAlias = nextAlias;
    }

    cypher += `RETURN ${currentAlias} as result`;

    const result = await this.neo4j.run(cypher, { uuids });
    return result.records.map(r => r.get('result').properties);
  }

  /**
   * Generate Cypher from QueryPlan
   */
  generateCypher(plan: QueryPlan): { cypher: string; params: Record<string, any> } {
    const params: Record<string, any> = {};
    let cypher = '';

    // MATCH clause
    cypher += `MATCH (n:${plan.entity})\n`;

    // Relationship traversal
    if (plan.relationships.length > 0) {
      let currentAlias = 'n';
      for (let i = 0; i < plan.relationships.length; i++) {
        const rel = plan.relationships[i];
        const nextAlias = `n${i + 1}`;
        const relPattern = this.buildRelationshipPattern(currentAlias, rel, nextAlias);
        cypher += `MATCH ${relPattern}\n`;
        currentAlias = nextAlias;
      }
      cypher += `WITH n, ${currentAlias} as target\n`;
    }

    // WHERE clause
    const whereConditions: string[] = [];

    // Where conditions
    for (let i = 0; i < plan.whereConditions.length; i++) {
      const where = plan.whereConditions[i];
      const paramName = `where_${i}`;
      whereConditions.push(this.buildWhereCondition('n', where, paramName));
      params[paramName] = where.value;
    }

    // Filters from registry
    for (let i = 0; i < plan.filters.length; i++) {
      const filter = plan.filters[i];
      const filterDef = this.filterRegistry[filter.name];

      if (filterDef) {
        // Use registered filter
        whereConditions.push(filterDef.cypherCondition);
        if (filter.params && filterDef.paramNames) {
          for (const paramName of filterDef.paramNames) {
            params[paramName] = filter.params[paramName];
          }
        }
      } else if (filter.cypherCondition) {
        // Use inline Cypher condition
        whereConditions.push(filter.cypherCondition);
        if (filter.params) {
          Object.assign(params, filter.params);
        }
      } else {
        console.warn(`Filter '${filter.name}' not found in registry and no Cypher condition provided`);
      }
    }

    if (whereConditions.length > 0) {
      cypher += `WHERE ${whereConditions.join(' AND ')}\n`;
    }

    // Text search (if present)
    if (plan.textSearch) {
      // TODO: Implement full-text search
      console.warn('Text search not yet implemented in QueryExecutor');
    }

    // RETURN clause
    cypher += `RETURN n\n`;

    // ORDER BY
    if (plan.orderBy && plan.orderBy.length > 0) {
      const orderBys = plan.orderBy.map(o => `n.${o.field} ${o.direction}`).join(', ');
      cypher += `ORDER BY ${orderBys}\n`;
    }

    // LIMIT
    if (plan.offsetValue) {
      cypher += `SKIP ${plan.offsetValue}\n`;
    }
    if (plan.limitValue) {
      params.limit = neo4j.int(plan.limitValue);
      cypher += `LIMIT $limit`;
    }

    return { cypher, params };
  }

  /**
   * Build relationship pattern for Cypher
   */
  private buildRelationshipPattern(
    fromAlias: string,
    rel: { name: string; direction: RelationshipDirection; targetEntity?: string },
    toAlias: string
  ): string {
    const targetLabel = rel.targetEntity ? `:${rel.targetEntity}` : '';

    switch (rel.direction) {
      case 'outgoing':
        return `(${fromAlias})-[:${rel.name}]->(${toAlias}${targetLabel})`;
      case 'incoming':
        return `(${fromAlias})<-[:${rel.name}]-(${toAlias}${targetLabel})`;
      case 'both':
        return `(${fromAlias})-[:${rel.name}]-(${toAlias}${targetLabel})`;
    }
  }

  /**
   * Build WHERE condition for Cypher
   */
  private buildWhereCondition(
    alias: string,
    where: { field: string; operator: string; value: any },
    paramName: string
  ): string {
    switch (where.operator) {
      case '=':
        return `${alias}.${where.field} = $${paramName}`;
      case '!=':
        return `${alias}.${where.field} <> $${paramName}`;
      case '>':
        return `${alias}.${where.field} > $${paramName}`;
      case '>=':
        return `${alias}.${where.field} >= $${paramName}`;
      case '<':
        return `${alias}.${where.field} < $${paramName}`;
      case '<=':
        return `${alias}.${where.field} <= $${paramName}`;
      case 'CONTAINS':
        return `${alias}.${where.field} CONTAINS $${paramName}`;
      case 'STARTS WITH':
        return `${alias}.${where.field} STARTS WITH $${paramName}`;
      case 'ENDS WITH':
        return `${alias}.${where.field} ENDS WITH $${paramName}`;
      case 'IN':
        return `${alias}.${where.field} IN $${paramName}`;
      default:
        throw new Error(`Unsupported operator: ${where.operator}`);
    }
  }

  /**
   * Map Neo4j results to objects
   */
  private mapResults<T>(result: any, plan: QueryPlan): T[] {
    return result.records.map((record: any) => {
      const node = record.get('n');
      return node.properties as T;
    });
  }

  /**
   * Explain what Cypher will be generated
   */
  explain(plan: QueryPlan): string {
    if (plan.semanticSearch) {
      return `Vector search on ${plan.entity} using index "${plan.semanticSearch.indexName}" with query "${plan.semanticSearch.query}", then:\n` +
        this.generateCypher(plan).cypher;
    }
    return this.generateCypher(plan).cypher;
  }
}
