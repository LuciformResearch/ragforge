import { QueryBuilder } from '@ragforge/runtime';
import type { File, FileFilter } from '../types.js';

/**
 * Query builder for File entities
 * File entity (49 nodes)
 */
export class FileQuery extends QueryBuilder<File> {
  /**
   * Filter File entities by field values
   */
  where(filter: FileFilter): this {
    return super.where(filter);
  }

  /**
   * Filter by name
   * name of File
   */
  whereName(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ name: value } as any);
  }

  /**
   * Include related entities via DEFINED_IN
   * Scope DEFINED_IN File
   */
  withDefinedIn(depth: number = 1): this {
    return this.expand('DEFINED_IN', { depth });
  }

  /**
   * Include related entities via IN_DIRECTORY
   * File IN_DIRECTORY Directory
   */
  withInDirectory(depth: number = 1): this {
    return this.expand('IN_DIRECTORY', { depth });
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