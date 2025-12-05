/**
 * QueryPlan - Internal representation of a generic query
 *
 * Represents the declarative structure of a query before execution.
 * This allows for query optimization, explanation, and flexible execution.
 *
 * Updated to support generic query building for agent tools.
 */

export type RelationshipDirection = 'outgoing' | 'incoming' | 'both';

export interface FilterOperation {
  name: string;
  params?: Record<string, any>;
  cypherCondition?: string; // Optional custom Cypher
}

export interface RelationshipStep {
  name: string;
  direction: RelationshipDirection;
  targetEntity?: string;
}

export interface SemanticSearchStep {
  indexName: string;
  query: string;
  minScore?: number;
  topK?: number;
  rerank?: boolean;
  rerankModel?: string;
}

export interface TextSearchStep {
  query: string;
  fields?: string[];
}

export interface WhereCondition {
  field: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'CONTAINS' | 'STARTS WITH' | 'ENDS WITH' | 'IN';
  value: any;
}

/**
 * QueryPlan - Complete representation of a query
 */
export class QueryPlan {
  entity: string;
  relationships: RelationshipStep[] = [];
  filters: FilterOperation[] = [];
  whereConditions: WhereCondition[] = [];
  semanticSearch?: SemanticSearchStep;
  textSearch?: TextSearchStep;
  limitValue?: number;
  offsetValue?: number;
  orderBy?: { field: string; direction: 'ASC' | 'DESC' }[];

  constructor(entity: string) {
    this.entity = entity;
  }

  /**
   * Add a relationship traversal
   */
  addRelationship(name: string, direction: RelationshipDirection = 'outgoing', targetEntity?: string): this {
    this.relationships.push({ name, direction, targetEntity });
    return this;
  }

  /**
   * Add a filter operation
   */
  addFilter(name: string, params?: Record<string, any>, cypherCondition?: string): this {
    this.filters.push({ name, params, cypherCondition });
    return this;
  }

  /**
   * Add a WHERE condition
   */
  addWhere(field: string, operator: WhereCondition['operator'], value: any): this {
    this.whereConditions.push({ field, operator, value });
    return this;
  }

  /**
   * Set semantic search
   */
  setSemanticSearch(step: SemanticSearchStep): this {
    this.semanticSearch = step;
    return this;
  }

  /**
   * Set text search
   */
  setTextSearch(step: TextSearchStep): this {
    this.textSearch = step;
    return this;
  }

  /**
   * Set limit
   */
  setLimit(n: number): this {
    this.limitValue = n;
    return this;
  }

  /**
   * Set offset
   */
  setOffset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  /**
   * Add order by
   */
  addOrderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    if (!this.orderBy) this.orderBy = [];
    this.orderBy.push({ field, direction });
    return this;
  }

  /**
   * Clone this query plan
   */
  clone(): QueryPlan {
    const plan = new QueryPlan(this.entity);
    plan.relationships = [...this.relationships];
    plan.filters = [...this.filters];
    plan.whereConditions = [...this.whereConditions];
    plan.semanticSearch = this.semanticSearch ? { ...this.semanticSearch } : undefined;
    plan.textSearch = this.textSearch ? { ...this.textSearch } : undefined;
    plan.limitValue = this.limitValue;
    plan.offsetValue = this.offsetValue;
    plan.orderBy = this.orderBy ? [...this.orderBy] : undefined;
    return plan;
  }

  /**
   * Explain this query in natural language
   */
  explain(): string {
    const parts: string[] = [];

    // Entity
    parts.push(`Find ${this.entity} entities`);

    // Relationships
    if (this.relationships.length > 0) {
      for (const rel of this.relationships) {
        const dir = rel.direction === 'incoming' ? 'incoming from' : 'to';
        parts.push(`following ${rel.name} relationships ${dir} ${rel.targetEntity || 'related entities'}`);
      }
    }

    // Filters
    if (this.filters.length > 0) {
      parts.push(`filtered by: ${this.filters.map(f => f.name).join(', ')}`);
    }

    // Where conditions
    if (this.whereConditions.length > 0) {
      parts.push(`where: ${this.whereConditions.map(w => `${w.field} ${w.operator} ${w.value}`).join(' AND ')}`);
    }

    // Semantic search
    if (this.semanticSearch) {
      parts.push(`semantically similar to "${this.semanticSearch.query}"`);
      if (this.semanticSearch.minScore) {
        parts.push(`(min score: ${this.semanticSearch.minScore})`);
      }
    }

    // Text search
    if (this.textSearch) {
      parts.push(`containing text "${this.textSearch.query}"`);
    }

    // Limit
    if (this.limitValue) {
      parts.push(`limited to ${this.limitValue} results`);
    }

    // Offset
    if (this.offsetValue) {
      parts.push(`starting from result ${this.offsetValue}`);
    }

    // Order by
    if (this.orderBy && this.orderBy.length > 0) {
      parts.push(`ordered by ${this.orderBy.map(o => `${o.field} ${o.direction}`).join(', ')}`);
    }

    return parts.join(', ');
  }

  /**
   * Get a summary of this query
   */
  getSummary(): {
    entity: string;
    relationshipCount: number;
    filterCount: number;
    hasSemanticSearch: boolean;
    hasTextSearch: boolean;
    limit?: number;
  } {
    return {
      entity: this.entity,
      relationshipCount: this.relationships.length,
      filterCount: this.filters.length,
      hasSemanticSearch: !!this.semanticSearch,
      hasTextSearch: !!this.textSearch,
      limit: this.limitValue
    };
  }
}
