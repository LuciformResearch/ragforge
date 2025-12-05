/**
 * Summary Storage
 *
 * Handles caching and retrieval of field summaries in Neo4j.
 *
 * Storage strategy:
 * - For field "source" with output_fields ["purpose", "operations", "suggestions"]
 * - Creates properties: source_summary_purpose, source_summary_operations, source_summary_suggestions
 * - Adds metadata: source_summary_hash (for change detection), source_summarized_at
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { FieldSummary } from './generic-summarizer.js';
import crypto from 'crypto';

/**
 * Summary cache entry
 */
export interface CachedSummary {
  /** Entity UUID */
  uuid: string;

  /** Field name that was summarized */
  fieldName: string;

  /** Summary data */
  summary: FieldSummary;

  /** When it was generated */
  summarizedAt: Date;

  /** Hash of original content (for change detection) */
  contentHash: string;
}

/**
 * Options for summary storage
 */
export interface SummaryStorageOptions {
  /** Entity label in Neo4j */
  entityLabel: string;

  /** Unique field name (default: 'uuid') */
  uniqueField?: string;
}

/**
 * Summary Storage Manager
 *
 * Manages persistence of field summaries in Neo4j.
 */
export class SummaryStorage {
  constructor(
    private neo4jClient: Neo4jClient,
    private options: SummaryStorageOptions
  ) {}

  /**
   * Store a summary for a field
   *
   * @param entityId - Unique identifier for the entity
   * @param fieldName - Field that was summarized
   * @param fieldValue - Original field content (for hash)
   * @param summary - Summary to store
   */
  async storeSummary(
    entityId: string,
    fieldName: string,
    fieldValue: string,
    summary: FieldSummary
  ): Promise<void> {
    const uniqueField = this.options.uniqueField || 'uuid';

    // Generate content hash for change detection
    const contentHash = this.hashContent(fieldValue);

    // Build property updates
    const summaryProps: Record<string, any> = {};

    for (const [key, value] of Object.entries(summary)) {
      const propName = `${fieldName}_summary_${key}`;

      // Store arrays as comma-separated strings
      if (Array.isArray(value)) {
        summaryProps[propName] = value.join(', ');
      } else {
        summaryProps[propName] = value;
      }
    }

    // Add metadata
    summaryProps[`${fieldName}_summary_hash`] = contentHash;
    summaryProps[`${fieldName}_summarized_at`] = new Date().toISOString();

    // Update Neo4j
    await this.neo4jClient.run(
      `
      MATCH (n:${this.options.entityLabel} {${uniqueField}: $entityId})
      SET n += $summaryProps
      `,
      {
        entityId,
        summaryProps
      }
    );
  }

  /**
   * Store multiple summaries in batch
   *
   * Much faster than individual stores.
   */
  async storeBatch(
    items: Array<{
      entityId: string;
      fieldName: string;
      fieldValue: string;
      summary: FieldSummary;
    }>
  ): Promise<void> {
    if (items.length === 0) return;

    const uniqueField = this.options.uniqueField || 'uuid';

    // Build batch update query
    const updates = items.map(item => {
      const contentHash = this.hashContent(item.fieldValue);
      const summaryProps: Record<string, any> = {};

      for (const [key, value] of Object.entries(item.summary)) {
        const propName = `${item.fieldName}_summary_${key}`;
        if (Array.isArray(value)) {
          summaryProps[propName] = value.join(', ');
        } else {
          summaryProps[propName] = value;
        }
      }

      summaryProps[`${item.fieldName}_summary_hash`] = contentHash;
      summaryProps[`${item.fieldName}_summarized_at`] = new Date().toISOString();

      return {
        entityId: item.entityId,
        summaryProps
      };
    });

    // Execute batch update with UNWIND
    await this.neo4jClient.run(
      `
      UNWIND $updates AS update
      MATCH (n:${this.options.entityLabel} {${uniqueField}: update.entityId})
      SET n += update.summaryProps
      `,
      { updates }
    );
  }

  /**
   * Load cached summary for a field
   *
   * @param entityId - Entity identifier
   * @param fieldName - Field name
   * @param outputFields - Expected output fields
   * @returns Cached summary or null if not found
   */
  async loadSummary(
    entityId: string,
    fieldName: string,
    outputFields: string[]
  ): Promise<CachedSummary | null> {
    const uniqueField = this.options.uniqueField || 'uuid';

    // Build list of properties to fetch
    const propsToFetch = [
      ...outputFields.map(f => `${fieldName}_summary_${f}`),
      `${fieldName}_summary_hash`,
      `${fieldName}_summarized_at`
    ];

    const result = await this.neo4jClient.run(
      `
      MATCH (n:${this.options.entityLabel} {${uniqueField}: $entityId})
      RETURN ${propsToFetch.map(p => `n.${p} AS ${p}`).join(', ')}
      `,
      { entityId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];

    // Check if summary exists (at least one field is not null)
    const hasSummary = outputFields.some(field => {
      const value = record.get(`${fieldName}_summary_${field}`);
      return value !== null && value !== undefined;
    });

    if (!hasSummary) {
      return null;
    }

    // Extract summary data
    const summary: FieldSummary = {};
    for (const field of outputFields) {
      const propName = `${fieldName}_summary_${field}`;
      const value = record.get(propName);

      if (value !== null && value !== undefined) {
        // Parse comma-separated arrays back
        if (typeof value === 'string' && value.includes(',')) {
          summary[field] = value.split(',').map(s => s.trim());
        } else {
          summary[field] = value;
        }
      }
    }

    const contentHash = record.get(`${fieldName}_summary_hash`);
    const summarizedAtStr = record.get(`${fieldName}_summarized_at`);
    const summarizedAt = summarizedAtStr ? new Date(summarizedAtStr) : new Date();

    return {
      uuid: entityId,
      fieldName,
      summary,
      summarizedAt,
      contentHash
    };
  }

  /**
   * Load multiple summaries in batch
   */
  async loadBatch(
    entityIds: string[],
    fieldName: string,
    outputFields: string[]
  ): Promise<Map<string, CachedSummary>> {
    if (entityIds.length === 0) return new Map();

    const uniqueField = this.options.uniqueField || 'uuid';

    // Build list of properties to fetch
    const propsToFetch = [
      uniqueField,
      ...outputFields.map(f => `${fieldName}_summary_${f}`),
      `${fieldName}_summary_hash`,
      `${fieldName}_summarized_at`
    ];

    const result = await this.neo4jClient.run(
      `
      MATCH (n:${this.options.entityLabel})
      WHERE n.${uniqueField} IN $entityIds
      RETURN ${propsToFetch.map(p => `n.${p} AS ${p}`).join(', ')}
      `,
      { entityIds }
    );

    const summaries = new Map<string, CachedSummary>();

    for (const record of result.records) {
      const entityId = record.get(uniqueField);

      // Check if summary exists
      const hasSummary = outputFields.some(field => {
        const value = record.get(`${fieldName}_summary_${field}`);
        return value !== null && value !== undefined;
      });

      if (!hasSummary) continue;

      // Extract summary
      const summary: FieldSummary = {};
      for (const field of outputFields) {
        const propName = `${fieldName}_summary_${field}`;
        const value = record.get(propName);

        if (value !== null && value !== undefined) {
          if (typeof value === 'string' && value.includes(',')) {
            summary[field] = value.split(',').map(s => s.trim());
          } else {
            summary[field] = value;
          }
        }
      }

      const contentHash = record.get(`${fieldName}_summary_hash`);
      const summarizedAtStr = record.get(`${fieldName}_summarized_at`);
      const summarizedAt = summarizedAtStr ? new Date(summarizedAtStr) : new Date();

      summaries.set(entityId, {
        uuid: entityId,
        fieldName,
        summary,
        summarizedAt,
        contentHash
      });
    }

    return summaries;
  }

  /**
   * Check if field content has changed since last summarization
   *
   * @returns true if content changed (need to regenerate)
   */
  needsRegeneration(
    currentContent: string,
    cachedSummary: CachedSummary | null
  ): boolean {
    if (!cachedSummary) return true;

    const currentHash = this.hashContent(currentContent);
    return currentHash !== cachedSummary.contentHash;
  }

  /**
   * Find entities that need summarization
   *
   * Returns entities where:
   * - Field length > threshold
   * - AND (no summary exists OR content changed)
   */
  async findEntitiesNeedingSummaries(
    fieldName: string,
    threshold: number,
    limit?: number
  ): Promise<Array<{
    uuid: string;
    fieldValue: string;
    hasSummary: boolean;
  }>> {
    const uniqueField = this.options.uniqueField || 'uuid';

    const query = `
      MATCH (n:${this.options.entityLabel})
      WHERE n.${fieldName} IS NOT NULL
        AND size(n.${fieldName}) > $threshold
        AND (
          n.${fieldName}_summary_hash IS NULL
          OR n.${fieldName}_summary_hash <> $hashPlaceholder
        )
      RETURN n.${uniqueField} AS uuid,
             n.${fieldName} AS fieldValue,
             n.${fieldName}_summary_hash IS NOT NULL AS hasSummary
      ${limit ? 'LIMIT $limit' : ''}
    `;

    const result = await this.neo4jClient.run(query, {
      threshold,
      hashPlaceholder: '', // We'll check hashes individually
      ...(limit ? { limit } : {})
    });

    return result.records.map(record => ({
      uuid: record.get('uuid'),
      fieldValue: record.get('fieldValue'),
      hasSummary: record.get('hasSummary')
    }));
  }

  /**
   * Delete summaries for a field
   *
   * Useful for re-generation or cleanup.
   */
  async deleteSummaries(
    entityIds: string[],
    fieldName: string,
    outputFields: string[]
  ): Promise<void> {
    if (entityIds.length === 0) return;

    const uniqueField = this.options.uniqueField || 'uuid';

    // Build list of properties to remove
    const propsToRemove = [
      ...outputFields.map(f => `${fieldName}_summary_${f}`),
      `${fieldName}_summary_hash`,
      `${fieldName}_summarized_at`
    ];

    const removeClause = propsToRemove.map(p => `n.${p} = null`).join(', ');

    await this.neo4jClient.run(
      `
      MATCH (n:${this.options.entityLabel})
      WHERE n.${uniqueField} IN $entityIds
      SET ${removeClause}
      `,
      { entityIds }
    );
  }

  /**
   * Get summary statistics
   */
  async getStatistics(fieldName: string): Promise<{
    total: number;
    summarized: number;
    pending: number;
    percentage: number;
  }> {
    const result = await this.neo4jClient.run(
      `
      MATCH (n:${this.options.entityLabel})
      WHERE n.${fieldName} IS NOT NULL
      WITH count(n) AS total,
           count(n.${fieldName}_summary_hash) AS summarized
      RETURN total, summarized,
             total - summarized AS pending,
             CASE
               WHEN total > 0 THEN toFloat(summarized) / toFloat(total) * 100
               ELSE 0
             END AS percentage
      `
    );

    if (result.records.length === 0) {
      return { total: 0, summarized: 0, pending: 0, percentage: 0 };
    }

    const record = result.records[0];
    return {
      total: record.get('total'),
      summarized: record.get('summarized'),
      pending: record.get('pending'),
      percentage: record.get('percentage')
    };
  }

  /**
   * Hash content for change detection
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
