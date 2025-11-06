import { QueryBuilder } from '@ragforge/runtime';
import type { Directory, DirectoryFilter } from '../types.js';

/**
 * Query builder for Directory entities
 * Directory in project
 */
export class DirectoryQuery extends QueryBuilder<Directory> {
  /**
   * Filter Directory entities by field values
   */
  where(filter: DirectoryFilter): this {
    return super.where(filter);
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