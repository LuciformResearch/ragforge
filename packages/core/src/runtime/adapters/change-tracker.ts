/**
 * Change Tracker - Track code changes with diffs
 *
 * Stores historical changes to Scopes and Files in Neo4j
 * Each change includes a unified diff showing what changed
 */

import { createTwoFilesPatch } from 'diff';
import type { Neo4jClient } from '../client/neo4j-client.js';
import { createHash } from 'crypto';
import { getLocalTimestamp, formatLocalDate } from '../utils/timestamp.js';
import neo4j from 'neo4j-driver';
import pLimit from 'p-limit';

export interface Change {
  uuid: string;
  timestamp: Date;
  entityType: string;  // Generic: 'Scope', 'Document', 'APIEndpoint', etc.
  entityUuid: string;
  changeType: 'created' | 'updated' | 'deleted';
  diff: string;
  oldHash?: string;
  newHash: string;
  linesAdded: number;
  linesRemoved: number;
  metadata: Record<string, any>;  // Flexible metadata (name, file, etc.)
}

export class ChangeTracker {
  constructor(private client: Neo4jClient) {}

  /**
   * Create a diff between old and new content
   */
  private createDiff(
    fileName: string,
    oldContent: string,
    newContent: string,
    changeType: 'created' | 'updated' | 'deleted'
  ): { diff: string; linesAdded: number; linesRemoved: number } {
    if (changeType === 'created') {
      // For new content, show all lines as additions
      const lines = newContent.split('\n');
      const diff = lines.map((line, i) => `+${line}`).join('\n');
      return {
        diff: `--- /dev/null\n+++ ${fileName}\n${diff}`,
        linesAdded: lines.length,
        linesRemoved: 0
      };
    }

    if (changeType === 'deleted') {
      // For deleted content, show all lines as removals
      const lines = oldContent.split('\n');
      const diff = lines.map((line, i) => `-${line}`).join('\n');
      return {
        diff: `--- ${fileName}\n+++ /dev/null\n${diff}`,
        linesAdded: 0,
        linesRemoved: lines.length
      };
    }

    // For updates, create a unified diff
    const patch = createTwoFilesPatch(
      fileName,
      fileName,
      oldContent,
      newContent,
      '',
      '',
      { context: 3 }
    );

    // Count added/removed lines
    const lines = patch.split('\n');
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesRemoved++;
      }
    }

    return {
      diff: patch,
      linesAdded,
      linesRemoved
    };
  }

  /**
   * Track a generic entity change
   * Works for any entity type: Scope, Document, APIEndpoint, etc.
   */
  async trackEntityChange(
    entityType: string,
    entityUuid: string,
    entityLabel: string,  // Display name for diff header (e.g., "src/file.ts:MyClass")
    oldContent: string | null,
    newContent: string,
    oldHash: string | null,
    newHash: string,
    changeType: 'created' | 'updated' | 'deleted',
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const changeUuid = createHash('sha256')
      .update(`${entityUuid}-${Date.now()}-${newHash}`)
      .digest('hex')
      .substring(0, 16);

    const { diff, linesAdded, linesRemoved } = this.createDiff(
      entityLabel,
      oldContent || '',
      newContent,
      changeType
    );

    const timestamp = getLocalTimestamp();

    // Convert metadata to JSON string for Neo4j compatibility
    const metadataJson = JSON.stringify(metadata);

    // Create Change node with generic relationship
    await this.client.run(
      `
      MATCH (entity:${entityType} {uuid: $entityUuid})
      CREATE (change:Change {
        uuid: $changeUuid,
        entityType: $entityType,
        timestamp: datetime($timestamp),
        changeType: $changeType,
        diff: $diff,
        oldHash: $oldHash,
        newHash: $newHash,
        linesAdded: $linesAdded,
        linesRemoved: $linesRemoved,
        metadataJson: $metadataJson
      })
      CREATE (entity)-[:HAS_CHANGE]->(change)
      `,
      {
        entityType,
        entityUuid,
        changeUuid,
        timestamp,
        changeType,
        diff,
        oldHash,
        newHash,
        linesAdded,
        linesRemoved,
        metadataJson
      }
    );
  }

  /**
   * Track multiple entity changes in parallel using p-limit
   * Much faster than calling trackEntityChange() sequentially
   * @param changes Array of change tracking requests
   * @param concurrency Number of parallel change tracking operations (default: 10)
   */
  async trackEntityChangesBatch(
    changes: Array<{
      entityType: string;
      entityUuid: string;
      entityLabel: string;
      oldContent: string | null;
      newContent: string;
      oldHash: string | null;
      newHash: string;
      changeType: 'created' | 'updated' | 'deleted';
      metadata?: Record<string, any>;
    }>,
    concurrency: number = 10
  ): Promise<void> {
    if (changes.length === 0) return;

    const limit = pLimit(concurrency);

    // Process changes in parallel with p-limit
    await Promise.all(
      changes.map(change =>
        limit(() =>
          this.trackEntityChange(
            change.entityType,
            change.entityUuid,
            change.entityLabel,
            change.oldContent,
            change.newContent,
            change.oldHash,
            change.newHash,
            change.changeType,
            change.metadata || {}
          )
        )
      )
    );
  }

  /**
   * Get change history for any entity (generic)
   */
  async getEntityHistory(
    entityType: string,
    entityUuid: string,
    limit: number = 10
  ): Promise<Change[]> {
    const result = await this.client.run(
      `
      MATCH (entity:${entityType} {uuid: $entityUuid})-[:HAS_CHANGE]->(change:Change)
      RETURN change.uuid AS uuid,
             change.entityType AS entityType,
             change.timestamp AS timestamp,
             change.changeType AS changeType,
             change.diff AS diff,
             change.oldHash AS oldHash,
             change.newHash AS newHash,
             change.linesAdded AS linesAdded,
             change.linesRemoved AS linesRemoved,
             change.metadataJson AS metadataJson
      ORDER BY change.timestamp DESC
      LIMIT $limit
      `,
      { entityUuid, limit: neo4j.int(limit) }
    );

    return result.records.map(record => ({
      uuid: record.get('uuid'),
      entityType: record.get('entityType'),
      entityUuid,
      timestamp: new Date(record.get('timestamp').toString()),
      changeType: record.get('changeType'),
      diff: record.get('diff'),
      oldHash: record.get('oldHash'),
      newHash: record.get('newHash'),
      linesAdded: record.get('linesAdded'),
      linesRemoved: record.get('linesRemoved'),
      metadata: JSON.parse(record.get('metadataJson') || '{}')
    }));
  }

  /**
   * Get all recent changes across any entity type
   */
  async getRecentChanges(
    limit: number = 20,
    entityTypes?: string[]  // Optional: filter by entity types
  ): Promise<Change[]> {
    const whereClause = entityTypes && entityTypes.length > 0
      ? `WHERE change.entityType IN $entityTypes`
      : '';

    const result = await this.client.run(
      `
      MATCH (n)-[:HAS_CHANGE]->(change:Change)
      ${whereClause}
      RETURN n.uuid AS entityUuid,
             change.uuid AS uuid,
             change.entityType AS entityType,
             change.timestamp AS timestamp,
             change.changeType AS changeType,
             change.diff AS diff,
             change.oldHash AS oldHash,
             change.newHash AS newHash,
             change.linesAdded AS linesAdded,
             change.linesRemoved AS linesRemoved,
             change.metadataJson AS metadataJson
      ORDER BY change.timestamp DESC
      LIMIT $limit
      `,
      { limit: neo4j.int(limit), entityTypes: entityTypes || [] }
    );

    return result.records.map(record => ({
      uuid: record.get('uuid'),
      entityType: record.get('entityType'),
      entityUuid: record.get('entityUuid'),
      timestamp: new Date(record.get('timestamp').toString()),
      changeType: record.get('changeType'),
      diff: record.get('diff'),
      oldHash: record.get('oldHash'),
      newHash: record.get('newHash'),
      linesAdded: record.get('linesAdded'),
      linesRemoved: record.get('linesRemoved'),
      metadata: JSON.parse(record.get('metadataJson') || '{}')
    }));
  }

  /**
   * Get statistics about changes
   */
  async getChangeStats(entityType?: string): Promise<{
    totalChanges: number;
    byType: Record<string, number>;
    byEntityType: Record<string, number>;
    totalLinesAdded: number;
    totalLinesRemoved: number;
  }> {
    const whereClause = entityType ? `WHERE change.entityType = $entityType` : '';

    const result = await this.client.run(
      `
      MATCH (change:Change)
      ${whereClause}
      RETURN
        count(change) AS totalChanges,
        change.changeType AS changeType,
        change.entityType AS entityType,
        sum(change.linesAdded) AS linesAdded,
        sum(change.linesRemoved) AS linesRemoved
      `,
      { entityType }
    );

    const byType: Record<string, number> = {};
    const byEntityType: Record<string, number> = {};
    let totalChanges = 0;
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;

    for (const record of result.records) {
      const countValue = record.get('totalChanges');
      const count = typeof countValue === 'number' ? countValue : (countValue?.toNumber ? countValue.toNumber() : 0);
      const type = record.get('changeType');
      const entity = record.get('entityType');
      const addedValue = record.get('linesAdded');
      const removedValue = record.get('linesRemoved');
      const added = typeof addedValue === 'number' ? addedValue : (addedValue?.toNumber ? addedValue.toNumber() : 0);
      const removed = typeof removedValue === 'number' ? removedValue : (removedValue?.toNumber ? removedValue.toNumber() : 0);

      byType[type] = (byType[type] || 0) + count;
      byEntityType[entity] = (byEntityType[entity] || 0) + count;
      totalChanges += count;
      totalLinesAdded += added;
      totalLinesRemoved += removed;
    }

    return {
      totalChanges,
      byType,
      byEntityType,
      totalLinesAdded,
      totalLinesRemoved
    };
  }

  /**
   * Get most modified entities of a specific type
   */
  async getMostModifiedEntities(
    entityType: string,
    limit: number = 10
  ): Promise<Array<{ entityUuid: string; changeCount: number; metadata: Record<string, any> }>> {
    const result = await this.client.run(
      `
      MATCH (entity:${entityType})-[:HAS_CHANGE]->(change:Change)
      WITH entity, count(change) AS changeCount, collect(change)[0] AS latestChange
      RETURN entity.uuid AS entityUuid,
             changeCount,
             latestChange.metadataJson AS metadataJson
      ORDER BY changeCount DESC
      LIMIT $limit
      `,
      { limit: neo4j.int(limit) }
    );

    return result.records.map(record => ({
      entityUuid: record.get('entityUuid'),
      changeCount: record.get('changeCount').toNumber(),
      metadata: JSON.parse(record.get('metadataJson') || '{}')
    }));
  }

  /**
   * Get changes within a date range
   */
  async getChangesByDateRange(
    startDate: Date,
    endDate: Date,
    entityType?: string
  ): Promise<Change[]> {
    const entityFilter = entityType ? `AND change.entityType = $entityType` : '';

    const result = await this.client.run(
      `
      MATCH (n)-[:HAS_CHANGE]->(change:Change)
      WHERE change.timestamp >= datetime($startDate)
        AND change.timestamp <= datetime($endDate)
        ${entityFilter}
      RETURN n.uuid AS entityUuid,
             change.uuid AS uuid,
             change.entityType AS entityType,
             change.timestamp AS timestamp,
             change.changeType AS changeType,
             change.diff AS diff,
             change.oldHash AS oldHash,
             change.newHash AS newHash,
             change.linesAdded AS linesAdded,
             change.linesRemoved AS linesRemoved,
             change.metadataJson AS metadataJson
      ORDER BY change.timestamp DESC
      `,
      {
        startDate: formatLocalDate(startDate),
        endDate: formatLocalDate(endDate),
        entityType
      }
    );

    return result.records.map(record => ({
      uuid: record.get('uuid'),
      entityType: record.get('entityType'),
      entityUuid: record.get('entityUuid'),
      timestamp: new Date(record.get('timestamp').toString()),
      changeType: record.get('changeType'),
      diff: record.get('diff'),
      oldHash: record.get('oldHash'),
      newHash: record.get('newHash'),
      linesAdded: record.get('linesAdded'),
      linesRemoved: record.get('linesRemoved'),
      metadata: JSON.parse(record.get('metadataJson') || '{}')
    }));
  }
}
