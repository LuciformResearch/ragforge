import { QueryBuilder } from '@luciformresearch/ragforge-runtime';
import type { Scope, ScopeFilter } from '../types.js';

/**
 * Query builder for Scope entities
 */
export class ScopeQuery extends QueryBuilder<Scope> {
  /**
   * Filter Scope entities by field values
   */
  where(filter: ScopeFilter): this {
    return super.where(filter);
  }

  /**
   * Filter by source
   */
  whereSource(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ source: value } as any);
  }

}