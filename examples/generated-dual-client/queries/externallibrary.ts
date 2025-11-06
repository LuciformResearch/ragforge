import { QueryBuilder } from '@ragforge/runtime';
import type { ExternalLibrary, ExternalLibraryFilter } from '../types.js';

/**
 * Query builder for ExternalLibrary entities
 * External library dependency
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
   * Library name
   */
  whereName(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ name: value } as any);
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