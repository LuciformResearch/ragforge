import { QueryBuilder } from '@ragforge/runtime';
import type { ExternalLibrary, ExternalLibraryFilter } from '../types.js';

/**
 * Query builder for ExternalLibrary entities
 * ExternalLibrary entity (24 nodes)
 */
export class ExternalLibraryQuery extends QueryBuilder<ExternalLibrary> {
  /**
   * Filter ExternalLibrary entities by field values
   */
  where(filter: ExternalLibraryFilter): this {
    return super.where(filter);
  }

  /**
   * Filter by name
   * name of ExternalLibrary
   */
  whereName(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ name: value } as any);
  }

  /**
   * Include related entities via USES_LIBRARY
   * Scope USES_LIBRARY ExternalLibrary
   */
  withUsesLibrary(depth: number = 1): this {
    return this.expand('USES_LIBRARY', { depth });
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