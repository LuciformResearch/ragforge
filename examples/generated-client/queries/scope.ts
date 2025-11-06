import { QueryBuilder } from '@ragforge/runtime';
import type { Scope, ScopeFilter } from '../types.js';

/**
 * Query builder for Scope entities
 * Scope entity (516 nodes)
 */
export class ScopeQuery extends QueryBuilder<Scope> {
  /**
   * Filter Scope entities by field values
   */
  where(filter: ScopeFilter): this {
    return super.where(filter);
  }

  /**
   * Filter by signature
   * signature of Scope
   */
  whereSignature(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ signature: value } as any);
  }

  /**
   * Filter by type
   * type of Scope
   */
  whereType(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ type: value } as any);
  }

  /**
   * Filter by file
   * file of Scope
   */
  whereFile(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ file: value } as any);
  }

  /**
   * Filter by uuid
   * uuid of Scope
   */
  whereUuid(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ uuid: value } as any);
  }

  /**
   * Filter by name
   * name of Scope
   */
  whereName(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ name: value } as any);
  }

  /**
   * Semantic search using scopeEmbeddings
   */
  semanticSearch(query: string, options?: { topK?: number }): this {
    return this.semantic(query, {
      ...options,
      vectorIndex: 'scopeEmbeddings'
    });
  }

  /**
   * Include related entities via DEFINED_IN
   * Scope DEFINED_IN File
   */
  withDefinedIn(depth: number = 1): this {
    return this.expand('DEFINED_IN', { depth });
  }

  /**
   * Include related entities via CONSUMES
   * Scope CONSUMES Scope
   */
  withConsumes(depth: number = 1): this {
    return this.expand('CONSUMES', { depth });
  }

  /**
   * Include related entities via CONSUMED_BY
   * Scope CONSUMED_BY Scope
   */
  withConsumedBy(depth: number = 1): this {
    return this.expand('CONSUMED_BY', { depth });
  }

  /**
   * Include related entities via USES_LIBRARY
   * Scope USES_LIBRARY ExternalLibrary
   */
  withUsesLibrary(depth: number = 1): this {
    return this.expand('USES_LIBRARY', { depth });
  }

  /**
   * Include related entities via BELONGS_TO
   * Scope BELONGS_TO Project
   */
  withBelongsTo(depth: number = 1): this {
    return this.expand('BELONGS_TO', { depth });
  }

  /**
   * Apply topology-centrality reranking strategy
   * Rank by graph centrality (importance)
   */
  rerankByTopologyCentrality(): this {
    return this.rerank('topology-centrality');
  }

  /**
   * Apply code-quality reranking strategy
   * Prefer well-documented, concise code
   */
  rerankByCodeQuality(): this {
    return this.rerank('code-quality');
  }

  /**
   * Apply recency reranking strategy
   * Prefer recent items
   */
  rerankByRecency(): this {
    return this.rerank('recency');
  }

}