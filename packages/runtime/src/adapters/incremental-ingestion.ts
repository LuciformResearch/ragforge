/**
 * Incremental Ingestion Module
 *
 * Provides utilities for incremental code ingestion based on content hashes
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { ParsedGraph, ParsedNode, ParsedRelationship } from './types.js';
import type { CodeSourceConfig } from './code-source-adapter.js';
import { CodeSourceAdapter } from './code-source-adapter.js';

export interface IncrementalStats {
  unchanged: number;
  updated: number;
  created: number;
  deleted: number;
}

export class IncrementalIngestionManager {
  constructor(private client: Neo4jClient) {}

  /**
   * Get existing hashes for a set of node UUIDs
   * Used for incremental ingestion to detect changes
   */
  async getExistingHashes(
    nodeIds: string[]
  ): Promise<Map<string, { uuid: string; hash: string }>> {
    if (nodeIds.length === 0) {
      return new Map();
    }

    const result = await this.client.run(
      `
      MATCH (n:Scope)
      WHERE n.uuid IN $nodeIds
      RETURN n.uuid AS uuid, n.hash AS hash
      `,
      { nodeIds }
    );

    const hashes = new Map<string, { uuid: string; hash: string }>();
    for (const record of result.records) {
      hashes.set(record.get('uuid'), {
        uuid: record.get('uuid'),
        hash: record.get('hash')
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
   */
  private async ingestNodes(nodes: ParsedNode[], relationships: ParsedRelationship[]): Promise<void> {
    // Create nodes
    for (const node of nodes) {
      const labels = node.labels.join(':');
      const props = node.properties;

      await this.client.run(
        `
        MERGE (n:${labels} {uuid: $uuid})
        SET n += $props
        `,
        { uuid: node.id, props }
      );
    }

    // Create relationships
    for (const rel of relationships) {
      const props = rel.properties || {};

      await this.client.run(
        `
        MATCH (from {uuid: $from}), (to {uuid: $to})
        MERGE (from)-[r:${rel.type}]->(to)
        SET r += $props
        `,
        { from: rel.from, to: rel.to, props }
      );
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
   */
  async ingestIncremental(
    graph: ParsedGraph,
    options: { dryRun?: boolean; verbose?: boolean } = {}
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
        relevantRelationships
      );
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
    } = {}
  ): Promise<IncrementalStats> {
    const verbose = options.verbose ?? false;
    const incremental = options.incremental ?? true;

    if (verbose) {
      const pathCount = config.include?.length || 0;
      console.log(`\n🔄 Ingesting code from ${pathCount} path(s)...`);
      console.log(`   Base path: ${config.root || '.'}`);
      console.log(`   Mode: ${incremental ? 'incremental' : 'full'}`);
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
        dryRun: options.dryRun
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
}
