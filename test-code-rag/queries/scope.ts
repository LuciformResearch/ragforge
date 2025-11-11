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
   * Filter by name
   */
  whereName(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ name: value } as any);
  }

  /**
   * Filter by name matching any value in the array (batch query)
   * @example
   * .whereNameIn(['value1', 'value2', 'value3'])
   */
  whereNameIn(values: string[]): this {
    return this.whereIn('name', values);
  }

  /**
   * Filter by file
   */
  whereFile(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ file: value } as any);
  }

  /**
   * Filter by file matching any value in the array (batch query)
   * @example
   * .whereFileIn(['value1', 'value2', 'value3'])
   */
  whereFileIn(values: string[]): this {
    return this.whereIn('file', values);
  }

  /**
   * Filter by source
   */
  whereSource(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this {
    return this.where({ source: value } as any);
  }

  /**
   * Filter by source matching any value in the array (batch query)
   * @example
   * .whereSourceIn(['value1', 'value2', 'value3'])
   */
  whereSourceIn(values: string[]): this {
    return this.whereIn('source', values);
  }

  /**
   * Semantic search using scopeSourceEmbeddings
   * Searches by source embeddings (model=text-embedding-004, dimension=768)
   */
  semanticSearchBySource(query: string, options?: { topK?: number; minScore?: number }): this {
    return this.semantic(query, {
      ...options,
      vectorIndex: 'scopeSourceEmbeddings'
    });
  }

  /**
   * Include related entities via DEFINED_IN (outgoing)
   * Scope DEFINED_IN File
   */
  withDefinedIn(depth: number = 1): this {
    return this.expand('DEFINED_IN', { depth });
  }

  /**
   * Filter scopes defined in the provided file
   */
  whereFileName(fileName: string): this {
    return this.whereRelatedBy(fileName, 'DEFINED_IN', 'outgoing', 'File');
  }

  /**
   * Include related entities via DEFINED_IN in reverse direction (incoming)
   * This traverses the relationship in the opposite direction from outgoing
   * Inverse of: Scope DEFINED_IN File
   * @example
   * // Find entities that have this relationship TO the current entity
   * .reversedDefinedIn(1)
   */
  reversedDefinedIn(depth: number = 1): this {
    return this.expand('DEFINED_IN', { depth, direction: 'incoming' });
  }

  /**
   * Include related entities via CONSUMES (outgoing)
   * Scope CONSUMES Scope
   */
  withConsumes(depth: number = 1): this {
    return this.expand('CONSUMES', { depth });
  }

  /**
   * Filter scopes that consume the provided scope
   */
  whereConsumesScope(scopeName: string): this {
    return this.whereRelatedBy(scopeName, 'CONSUMES', 'outgoing', 'Scope');
  }

  /**
   * Filter scopes consumed by the provided scope
   */
  whereConsumedByScope(scopeName: string): this {
    return this.whereRelatedBy(scopeName, 'CONSUMES', 'incoming', 'Scope');
  }

  /**
   * Include related entities via CONSUMES in reverse direction (incoming)
   * This traverses the relationship in the opposite direction from outgoing
   * Inverse of: Scope CONSUMES Scope
   * @example
   * // Find entities that have this relationship TO the current entity
   * .reversedConsumes(1)
   */
  reversedConsumes(depth: number = 1): this {
    return this.expand('CONSUMES', { depth, direction: 'incoming' });
  }

  /**
   * Include related entities via HAS_PARENT (outgoing)
   * Scope HAS_PARENT Scope
   */
  withHasParent(depth: number = 1): this {
    return this.expand('HAS_PARENT', { depth });
  }

  /**
   * Filter scopes with the provided parent scope
   */
  whereParentScope(scopeName: string): this {
    return this.whereRelatedBy(scopeName, 'HAS_PARENT', 'outgoing', 'Scope');
  }

  /**
   * Include related entities via HAS_PARENT in reverse direction (incoming)
   * This traverses the relationship in the opposite direction from outgoing
   * Inverse of: Scope HAS_PARENT Scope
   * @example
   * // Find entities that have this relationship TO the current entity
   * .reversedHasParent(1)
   */
  reversedHasParent(depth: number = 1): this {
    return this.expand('HAS_PARENT', { depth, direction: 'incoming' });
  }

  /**
   * Include related entities via USES_LIBRARY (outgoing)
   * Scope USES_LIBRARY ExternalLibrary
   */
  withUsesLibrary(depth: number = 1): this {
    return this.expand('USES_LIBRARY', { depth });
  }

  /**
   * Filter scopes that use the provided library
   */
  whereUsesLibrary(libraryName: string): this {
    return this.whereRelatedBy(libraryName, 'USES_LIBRARY', 'outgoing', 'ExternalLibrary');
  }

  /**
   * Include related entities via USES_LIBRARY in reverse direction (incoming)
   * This traverses the relationship in the opposite direction from outgoing
   * Inverse of: Scope USES_LIBRARY ExternalLibrary
   * @example
   * // Find entities that have this relationship TO the current entity
   * .reversedUsesLibrary(1)
   */
  reversedUsesLibrary(depth: number = 1): this {
    return this.expand('USES_LIBRARY', { depth, direction: 'incoming' });
  }

  /**
   * Include related entities via INHERITS_FROM (outgoing)
   * Scope INHERITS_FROM Scope
   */
  withInheritsFrom(depth: number = 1): this {
    return this.expand('INHERITS_FROM', { depth });
  }

  /**
   * Filter scopes that inherit from the provided scope
   */
  whereInheritsFrom(scopeName: string): this {
    return this.whereRelatedBy(scopeName, 'INHERITS_FROM', 'outgoing', 'Scope');
  }

  /**
   * Include related entities via INHERITS_FROM in reverse direction (incoming)
   * This traverses the relationship in the opposite direction from outgoing
   * Inverse of: Scope INHERITS_FROM Scope
   * @example
   * // Find entities that have this relationship TO the current entity
   * .reversedInheritsFrom(1)
   */
  reversedInheritsFrom(depth: number = 1): this {
    return this.expand('INHERITS_FROM', { depth, direction: 'incoming' });
  }

  /**
   * Filter Scope entities modified since a specific date
   * Requires change tracking to be enabled
   * @param date - Date to filter from
   * @example
   * const recent = await query.modifiedSince(new Date('2024-11-01')).execute();
   */
  modifiedSince(date: Date): this {
    return this.clientFilter(result => {
      if (!result.changeInfo?.lastModified) return false;
      return result.changeInfo.lastModified >= date;
    });
  }

  /**
   * Filter Scope entities modified in the last N days
   * Requires change tracking to be enabled
   * @param days - Number of days to look back
   * @example
   * const thisWeek = await query.recentlyModified(7).execute();
   */
  recentlyModified(days: number): this {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    return this.modifiedSince(cutoffDate);
  }

  /**
   * Filter Scope entities modified between two dates
   * Requires change tracking to be enabled
   * @param startDate - Start date
   * @param endDate - End date
   * @example
   * const november = await query.modifiedBetween(
   *   new Date('2024-11-01'),
   *   new Date('2024-11-30')
   * ).execute();
   */
  modifiedBetween(startDate: Date, endDate: Date): this {
    return this.clientFilter(result => {
      if (!result.changeInfo?.lastModified) return false;
      return result.changeInfo.lastModified >= startDate && 
             result.changeInfo.lastModified <= endDate;
    });
  }

  /**
   * Enrich results with change information
   * Adds changeInfo to each result with lastModified, changeType, etc.
   * Requires change tracking to be enabled
   * @example
   * const results = await query.withChangeInfo().execute();
   * results.forEach(r => console.log(r.changeInfo?.lastModified));
   */
  withChangeInfo(): this {
    // This will be handled automatically by the query execution
    // The changeInfo is fetched from the most recent Change node
    return this;
  }

  /**
   * Get the first result or undefined
   * @example
   * const result = await query.first();
   */
  async first(): Promise<import('@luciformresearch/ragforge-runtime').SearchResult<Scope> | undefined> {
    const results = await this.limit(1).execute();
    return results[0];
  }

  /**
   * Extract a single field from all results
   * @example
   * const names = await query.pluck('name');
   */
  async pluck<K extends keyof Scope>(field: K): Promise<Scope[K][]> {
    const results = await this.execute();
    return results.map(r => r.entity[field]);
  }

  /**
   * Count the total number of results
   * @example
   * const total = await query.count();
   */
  async count(): Promise<number> {
    const results = await this.execute();
    return results.length;
  }

  /**
   * Show the generated Cypher query for debugging
   * @example
   * console.log(query.debug());
   */
  debug(): string {
    const built = this.buildCypher();
    return `Cypher Query:\n${built.query}\n\nParameters:\n${JSON.stringify(built.params, null, 2)}`;
  }

}