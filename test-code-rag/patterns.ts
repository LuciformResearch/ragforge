/**
 * Common Query Patterns - Generated from RagForge config
 * 
 * Pre-built query patterns for common use cases to improve developer experience.
 * These patterns provide a more intuitive API and reduce the learning curve.
 * 
 * DO NOT EDIT - regenerate with: ragforge generate
 */

import type { RagClient } from './client.js';

/**
 * Create common query patterns for easier discovery and use
 */
export function createCommonPatterns(client: RagClient) {
  return {

    // ========== Scope Patterns ==========

    /**
     * Find Scope entities where name starts with a prefix
     * @example
     * const results = await patterns.findScopeByPrefix('example').execute();
     */
    findScopeByPrefix(prefix: string) {
      return client.scope().whereName({ startsWith: prefix });
    },

    /**
     * Find Scope entities where name contains text
     * @example
     * const results = await patterns.findScopeByContaining('builder').execute();
     */
    findScopeByContaining(text: string) {
      return client.scope().whereName({ contains: text });
    },

    /**
     * Find Scope by exact name
     * @example
     * const result = await patterns.findScopeByExact('MyEntity').first();
     */
    findScopeByExact(value: string) {
      return client.scope().whereName(value);
    },

    /**
     * Find Scope entities where name contains text
     * @example
     * const results = await patterns.findScopeByName('text').execute();
     */
    findScopeByName(text: string) {
      return client.scope().whereName({ contains: text });
    },

    /**
     * Find Scope entities where file contains text
     * @example
     * const results = await patterns.findScopeByFile('text').execute();
     */
    findScopeByFile(text: string) {
      return client.scope().whereFile({ contains: text });
    },

    /**
     * Find Scope entities where source contains text
     * @example
     * const results = await patterns.findScopeBySource('text').execute();
     */
    findScopeBySource(text: string) {
      return client.scope().whereSource({ contains: text });
    },

    /**
     * Find Scope entities with DEFINED_IN relationship expanded
     * @example
     * const results = await patterns.findScopeWithDEFINED_IN(2).execute();
     */
    findScopeWithDEFINED_IN(depth: number = 1) {
      return client.scope().withDEFINED_IN(depth);
    },

    /**
     * Find Scope entities with CONSUMES relationship expanded
     * @example
     * const results = await patterns.findScopeWithCONSUMES(2).execute();
     */
    findScopeWithCONSUMES(depth: number = 1) {
      return client.scope().withCONSUMES(depth);
    },

    /**
     * Find Scope entities with HAS_PARENT relationship expanded
     * @example
     * const results = await patterns.findScopeWithHAS_PARENT(2).execute();
     */
    findScopeWithHAS_PARENT(depth: number = 1) {
      return client.scope().withHAS_PARENT(depth);
    },

    // ===== Temporal Patterns (Change Tracking) =====

    /**
     * Find Scope entities modified in the last N days
     * @example
     * const results = await patterns.findRecentlyModifiedScope(7).execute();
     */
    findRecentlyModifiedScope(days: number = 7) {
      return client.scope().recentlyModified(days);
    },

    /**
     * Find Scope entities modified since a specific date
     * @example
     * const results = await patterns.findScopeModifiedSince(new Date('2025-01-01')).execute();
     */
    findScopeModifiedSince(date: Date) {
      return client.scope().modifiedSince(date);
    },

    /**
     * Find Scope entities modified within a date range
     * @example
     * const results = await patterns.findScopeModifiedBetween(new Date('2025-01-01'), new Date('2025-01-31')).execute();
     */
    findScopeModifiedBetween(startDate: Date, endDate: Date) {
      return client.scope().modifiedBetween(startDate, endDate);
    },

    /**
     * Find Scope entities with change history information
     * @example
     * const results = await patterns.findScopeWithChangeHistory().execute();
     */
    findScopeWithChangeHistory() {
      return client.scope().withChangeInfo();
    },
  };
}