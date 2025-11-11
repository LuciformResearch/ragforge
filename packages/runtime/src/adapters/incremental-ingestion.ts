/**
 * Incremental Ingestion Module
 *
 * Provides utilities for incremental code ingestion based on content hashes
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { ParsedGraph, ParsedNode, ParsedRelationship } from './types.js';
import type { CodeSourceConfig } from './code-source-adapter.js';
import { CodeSourceAdapter } from './code-source-adapter.js';
import { ChangeTracker } from './change-tracker.js';

export interface IncrementalStats {
  unchanged: number;
  updated: number;
  created: number;
  deleted: number;
}

export class IncrementalIngestionManager {
  private changeTracker: ChangeTracker;

  constructor(private client: Neo4jClient) {
    this.changeTracker = new ChangeTracker(client);
  }

  /**
   * Get existing hashes and content for a set of node UUIDs
   * Used for incremental ingestion to detect changes and generate diffs
   */
  async getExistingHashes(
    nodeIds: string[]
  ): Promise<Map<string, { uuid: string; hash: string; source?: string; name?: string; file?: string }>> {
    if (nodeIds.length === 0) {
      return new Map();
    }

    const result = await this.client.run(
      `
      MATCH (n:Scope)
      WHERE n.uuid IN $nodeIds
      RETURN n.uuid AS uuid, n.hash AS hash, n.source AS source, n.name AS name, n.file AS file
      `,
      { nodeIds }
    );

    const hashes = new Map<string, { uuid: string; hash: string; source?: string; name?: string; file?: string }>();
    for (const record of result.records) {
      hashes.set(record.get('uuid'), {
        uuid: record.get('uuid'),
        hash: record.get('hash'),
        source: record.get('source'),
        name: record.get('name'),
        file: record.get('file')
      });
    }
    return hashes;
  }

  /**
   * Delete nodes and their relationships
   * Used to clean up orphaned nodes when files are deleted
   */
  async deleteNodes(uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;

    await this.client.run(
      `
      MATCH (n:Scope)
      WHERE n.uuid IN $uuids
      DETACH DELETE n
      `,
      { uuids }
    );
  }

  /**
   * Ingest nodes and relationships into Neo4j
   * Uses UNWIND batching for optimal performance
   * @param markDirty - If true, marks Scope nodes as embeddingsDirty=true
   */
  private async ingestNodes(
    nodes: ParsedNode[],
    relationships: ParsedRelationship[],
    markDirty: boolean = false
  ): Promise<void> {
    if (nodes.length === 0 && relationships.length === 0) {
      return;
    }

    // Batch nodes by label type for efficient UNWIND processing
    const nodesByLabel = new Map<string, Array<{ uuid: string; props: any }>>();

    for (const node of nodes) {
      const labels = node.labels.join(':');
      const props = { ...node.properties };

      // Mark Scope nodes as dirty if their embeddings need regeneration
      if (markDirty && node.labels.includes('Scope')) {
        props.embeddingsDirty = true;
      }

      if (!nodesByLabel.has(labels)) {
        nodesByLabel.set(labels, []);
      }
      nodesByLabel.get(labels)!.push({ uuid: node.id, props });
    }

    // Create nodes using UNWIND batching (one query per label type)
    for (const [labels, nodeData] of nodesByLabel) {
      if (nodeData.length === 0) continue;

      await this.client.run(
        `
        UNWIND $nodes AS nodeData
        MERGE (n:${labels} {uuid: nodeData.uuid})
        SET n += nodeData.props
        `,
        { nodes: nodeData }
      );
    }

    // Create relationships using UNWIND batching (batches of 500)
    if (relationships.length > 0) {
      const batchSize = 500;
      const relsByType = new Map<string, Array<{ from: string; to: string; props: any }>>();

      for (const rel of relationships) {
        if (!relsByType.has(rel.type)) {
          relsByType.set(rel.type, []);
        }
        relsByType.get(rel.type)!.push({
          from: rel.from,
          to: rel.to,
          props: rel.properties || {}
        });
      }

      // Process each relationship type in batches
      for (const [relType, rels] of relsByType) {
        for (let i = 0; i < rels.length; i += batchSize) {
          const batch = rels.slice(i, i + batchSize);

          await this.client.run(
            `
            UNWIND $rels AS relData
            MATCH (from {uuid: relData.from}), (to {uuid: relData.to})
            MERGE (from)-[r:${relType}]->(to)
            SET r += relData.props
            `,
            { rels: batch }
          );
        }
      }
    }
  }

  /**
   * Incremental ingestion - only updates changed scopes
   *
   * Strategy:
   * 1. Fetch existing hashes from DB
   * 2. Filter nodes: only keep changed/new ones
   * 3. Delete orphaned nodes (files removed from codebase)
   * 4. Upsert changed nodes
   * 5. Update relationships for affected nodes
   * 6. Track changes and generate diffs (if enabled)
   */
  async ingestIncremental(
    graph: ParsedGraph,
    options: { dryRun?: boolean; verbose?: boolean; trackChanges?: boolean } = {}
  ): Promise<IncrementalStats> {
    const verbose = options.verbose ?? false;
    const { nodes, relationships } = graph;

    if (verbose) {
      console.log('🔍 Analyzing changes...');
    }

    // 1. Get existing hashes for Scope nodes
    const scopeNodes = nodes.filter(n => n.labels.includes('Scope'));
    const nodeIds = scopeNodes.map(n => n.id);
    const existingHashes = await this.getExistingHashes(nodeIds);

    if (verbose) {
      console.log(`   Found ${existingHashes.size} existing scopes in database`);
    }

    // 2. Classify nodes
    const unchanged: string[] = [];
    const modified: ParsedNode[] = [];
    const created: ParsedNode[] = [];

    for (const node of scopeNodes) {
      const uuid = node.id;
      const existing = existingHashes.get(uuid);
      const currentHash = node.properties.hash as string;

      if (!existing) {
        created.push(node);
      } else if (existing.hash !== currentHash) {
        modified.push(node);
      } else {
        unchanged.push(uuid);
      }
    }

    // 3. Find deleted nodes (in DB but not in current parse)
    const currentIds = new Set(nodeIds);
    const deleted = Array.from(existingHashes.keys())
      .filter(id => !currentIds.has(id));

    if (verbose) {
      console.log(`   Changes detected:`);
      console.log(`     Created: ${created.length}`);
      console.log(`     Updated: ${modified.length}`);
      console.log(`     Unchanged: ${unchanged.length}`);
      console.log(`     Deleted: ${deleted.length}`);
    }

    const stats = {
      unchanged: unchanged.length,
      updated: modified.length,
      created: created.length,
      deleted: deleted.length
    };

    if (options.dryRun) {
      return stats;
    }

    // 4. Delete orphaned nodes
    if (deleted.length > 0) {
      if (verbose) {
        console.log(`\n🗑️  Deleting ${deleted.length} orphaned nodes...`);
      }
      await this.deleteNodes(deleted);
    }

    // 5. Upsert modified + created nodes
    const nodesToUpsert = [...modified, ...created];
    if (nodesToUpsert.length > 0) {
      if (verbose) {
        console.log(`\n💾 Upserting ${nodesToUpsert.length} changed nodes...`);
      }

      // Include File nodes too (they have contentHash)
      const fileNodes = nodes.filter(n => n.labels.includes('File'));

      // Filter relationships to only include those related to changed nodes
      const affectedUuids = new Set(nodesToUpsert.map(n => n.id));
      const relevantRelationships = relationships.filter(rel =>
        affectedUuids.has(rel.from) || affectedUuids.has(rel.to)
      );

      await this.ingestNodes(
        [...nodesToUpsert, ...fileNodes],
        relevantRelationships,
        true  // Mark changed scopes as embeddingsDirty
      );

      // 6. Track changes and generate diffs (if enabled)
      if (options.trackChanges) {
        if (verbose) {
          console.log(`\n📝 Tracking changes and generating diffs...`);
        }

        // Prepare all changes for batch processing
        const changesToTrack: Array<{
          entityType: string;
          entityUuid: string;
          entityLabel: string;
          oldContent: string | null;
          newContent: string;
          oldHash: string | null;
          newHash: string;
          changeType: 'created' | 'updated' | 'deleted';
          metadata?: Record<string, any>;
        }> = [];

        // Add created scopes
        for (const node of created) {
          const scopeSource = node.properties.source as string;
          const scopeName = node.properties.name as string;
          const scopeFile = node.properties.file as string;
          const newHash = node.properties.hash as string;

          changesToTrack.push({
            entityType: 'Scope',
            entityUuid: node.id,
            entityLabel: `${scopeFile}:${scopeName}`,
            oldContent: null,
            newContent: scopeSource,
            oldHash: null,
            newHash,
            changeType: 'created',
            metadata: { name: scopeName, file: scopeFile }
          });
        }

        // Add modified scopes
        for (const node of modified) {
          const existing = existingHashes.get(node.id);
          if (!existing) continue;

          const scopeSource = node.properties.source as string;
          const scopeName = node.properties.name as string;
          const scopeFile = node.properties.file as string;
          const newHash = node.properties.hash as string;

          changesToTrack.push({
            entityType: 'Scope',
            entityUuid: node.id,
            entityLabel: `${scopeFile}:${scopeName}`,
            oldContent: existing.source || '',
            newContent: scopeSource,
            oldHash: existing.hash,
            newHash,
            changeType: 'updated',
            metadata: { name: scopeName, file: scopeFile }
          });
        }

        // Track all changes in parallel using p-limit (10 concurrent)
        await this.changeTracker.trackEntityChangesBatch(changesToTrack, 10);

        if (verbose) {
          console.log(`   Tracked ${created.length} created and ${modified.length} updated scope(s)`);
        }
      }
    }

    if (verbose && (created.length > 0 || modified.length > 0)) {
      console.log(`\n⚠️  ${created.length + modified.length} scope(s) marked as dirty - embeddings need regeneration`);
    }

    return stats;
  }

  /**
   * High-level method to ingest code from configured paths
   *
   * @param config - Source configuration with paths, languages, etc.
   * @param options - Ingestion options
   */
  async ingestFromPaths(
    config: CodeSourceConfig,
    options: {
      incremental?: boolean;
      verbose?: boolean;
      dryRun?: boolean;
      trackChanges?: boolean;
    } = {}
  ): Promise<IncrementalStats> {
    const verbose = options.verbose ?? false;
    const incremental = options.incremental ?? true;
    const trackChanges = options.trackChanges ?? config.track_changes ?? false;

    if (verbose) {
      const pathCount = config.include?.length || 0;
      console.log(`\n🔄 Ingesting code from ${pathCount} path(s)...`);
      console.log(`   Base path: ${config.root || '.'}`);
      console.log(`   Mode: ${incremental ? 'incremental' : 'full'}`);
      if (trackChanges) {
        console.log(`   Change tracking: enabled`);
      }
    }

    // Create adapter and parse
    const adapter = new CodeSourceAdapter(config.adapter as 'typescript' | 'python');
    const parseResult = await adapter.parse({
      source: config,
      onProgress: undefined
    });

    if (verbose) {
      const scopeCount = parseResult.graph.nodes.filter(n => n.labels.includes('Scope')).length;
      console.log(`\n✅ Parsed ${scopeCount} scopes from source`);
    }

    // Ingest
    if (incremental) {
      return await this.ingestIncremental(parseResult.graph, {
        verbose,
        dryRun: options.dryRun,
        trackChanges
      });
    } else {
      // Full ingestion
      await this.ingestNodes(parseResult.graph.nodes, parseResult.graph.relationships);
      const scopeCount = parseResult.graph.nodes.filter(n => n.labels.includes('Scope')).length;
      return {
        unchanged: 0,
        updated: 0,
        created: scopeCount,
        deleted: 0
      };
    }
  }

  /**
   * Mark embeddings as clean for specified scopes
   * Call this after successfully generating embeddings
   */
  async markEmbeddingsClean(uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;

    await this.client.run(
      `
      MATCH (n:Scope)
      WHERE n.uuid IN $uuids
      SET n.embeddingsDirty = false
      `,
      { uuids }
    );
  }

  /**
   * Get list of scopes with dirty embeddings
   * Useful for selective embedding regeneration
   */
  async getDirtyScopes(): Promise<Array<{ uuid: string; name: string; file: string }>> {
    const result = await this.client.run(
      `
      MATCH (n:Scope)
      WHERE n.embeddingsDirty = true
      RETURN n.uuid AS uuid, n.name AS name, n.file AS file
      `
    );

    return result.records.map(record => ({
      uuid: record.get('uuid'),
      name: record.get('name'),
      file: record.get('file')
    }));
  }

  /**
   * Count scopes with dirty embeddings
   */
  async countDirtyScopes(): Promise<number> {
    const result = await this.client.run(
      `
      MATCH (n:Scope)
      WHERE n.embeddingsDirty = true
      RETURN count(n) AS count
      `
    );

    return result.records[0]?.get('count')?.toNumber() || 0;
  }

  /**
   * Check if a specific scope has dirty embeddings
   */
  async isScopeDirty(uuid: string): Promise<boolean> {
    const result = await this.client.run(
      `
      MATCH (n:Scope {uuid: $uuid})
      RETURN n.embeddingsDirty AS dirty
      `,
      { uuid }
    );

    return result.records[0]?.get('dirty') === true;
  }
}
