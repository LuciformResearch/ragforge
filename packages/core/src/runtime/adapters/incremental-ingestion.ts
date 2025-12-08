/**
 * Incremental Ingestion Module
 *
 * Provides utilities for incremental code ingestion based on content hashes.
 * Uses UniversalSourceAdapter for all file types (code, documents, media, data).
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { ParsedGraph, ParsedNode, ParsedRelationship, SourceConfig, SourceAdapter } from './types.js';
import { UniversalSourceAdapter } from './universal-source-adapter.js';
import { ChangeTracker } from './change-tracker.js';
import { isStructuralNode } from '../../utils/node-schema.js';
import { addSchemaVersion } from '../../utils/schema-version.js';
import { createHash } from 'crypto';
import { globby } from 'globby';

export interface IncrementalStats {
  unchanged: number;
  updated: number;
  created: number;
  deleted: number;
}

export interface IngestionOptions {
  /** Project ID to scope the ingestion */
  projectId?: string;
  /** Dry run - don't actually modify the database */
  dryRun?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Enable change tracking with diffs */
  trackChanges?: boolean;
  /** Clean up orphaned relationships */
  cleanupRelationships?: boolean;
}

// Singleton adapter instance (reused across calls)
let universalAdapter: UniversalSourceAdapter | null = null;

/**
 * Get or create the universal source adapter
 */
function getAdapter(): SourceAdapter {
  if (!universalAdapter) {
    universalAdapter = new UniversalSourceAdapter();
  }
  return universalAdapter;
}

export class IncrementalIngestionManager {
  private changeTracker: ChangeTracker;

  constructor(private client: Neo4jClient) {
    this.changeTracker = new ChangeTracker(client);
  }

  /**
   * Get existing hashes and content for a set of node UUIDs
   * Used for incremental ingestion to detect changes and generate diffs
   *
   * Works with ALL content node types:
   * - Scope, DataFile, MediaFile, DocumentFile
   * - VueSFC, SvelteComponent, Stylesheet
   * - MarkdownDocument, CodeBlock, DataSection
   *
   * @param nodeIds - UUIDs to look up
   * @param projectId - Optional project ID to filter by
   */
  async getExistingHashes(
    nodeIds: string[],
    projectId?: string
  ): Promise<Map<string, { uuid: string; hash: string; source?: string; textContent?: string; name?: string; file?: string; labels?: string[]; schemaDirty?: boolean }>> {
    if (nodeIds.length === 0) {
      return new Map();
    }

    // Query ALL nodes by UUID (not just Scope)
    // Optionally filter by projectId
    const query = projectId
      ? `
        MATCH (n)
        WHERE n.uuid IN $nodeIds AND n.projectId = $projectId
        RETURN n.uuid AS uuid, n.hash AS hash, n.source AS source, n.textContent AS textContent, n.name AS name, n.file AS file, labels(n) AS labels, n.schemaDirty AS schemaDirty
        `
      : `
        MATCH (n)
        WHERE n.uuid IN $nodeIds
        RETURN n.uuid AS uuid, n.hash AS hash, n.source AS source, n.textContent AS textContent, n.name AS name, n.file AS file, labels(n) AS labels, n.schemaDirty AS schemaDirty
        `;

    const result = await this.client.run(query, { nodeIds, projectId });

    const hashes = new Map<string, { uuid: string; hash: string; source?: string; textContent?: string; name?: string; file?: string; labels?: string[]; schemaDirty?: boolean }>();
    for (const record of result.records) {
      hashes.set(record.get('uuid'), {
        uuid: record.get('uuid'),
        hash: record.get('hash'),
        source: record.get('source'),
        textContent: record.get('textContent'),
        name: record.get('name'),
        file: record.get('file'),
        labels: record.get('labels'),
        schemaDirty: record.get('schemaDirty')
      });
    }
    return hashes;
  }

  /**
   * Get existing File nodes with their rawContentHash for a project
   * Used for pre-parsing incremental check
   *
   * @param projectId - Project ID to query
   * @returns Map of relative file path -> rawContentHash
   */
  async getExistingFileHashes(projectId: string): Promise<Map<string, string>> {
    const query = `
      MATCH (f:File)-[:BELONGS_TO]->(p:Project {projectId: $projectId})
      WHERE f.rawContentHash IS NOT NULL
      RETURN f.path AS path, f.rawContentHash AS hash
    `;

    const result = await this.client.run(query, { projectId });

    const hashes = new Map<string, string>();
    for (const record of result.records) {
      const filePath = record.get('path');
      const hash = record.get('hash');
      if (filePath && hash) {
        hashes.set(filePath, hash);
      }
    }
    return hashes;
  }

  /**
   * Compute raw content hash for a file (SHA-256)
   * Fast operation - just reads file and hashes it, no parsing
   */
  static async computeFileHash(filePath: string): Promise<string> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Filter files to only those that have changed (based on rawContentHash)
   *
   * This is the KEY optimization for incremental ingestion:
   * - Reads file content (fast)
   * - Computes hash (fast)
   * - Compares with DB hash (fast)
   * - Only changed files will be parsed (expensive operation skipped for unchanged)
   *
   * @param config - Source configuration with include/exclude patterns
   * @param projectId - Project ID to compare against
   * @param verbose - Enable verbose logging
   * @returns Object with changedFiles (to parse) and unchangedFiles (to skip)
   */
  async filterChangedFiles(
    config: SourceConfig,
    projectId: string,
    verbose: boolean = false
  ): Promise<{
    allFiles: string[];
    changedFiles: string[];
    unchangedFiles: Set<string>;
    newHashes: Map<string, string>;
  }> {
    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const pLimit = (await import('p-limit')).default;

    const rootPath = config.root || process.cwd();
    const patterns = config.include || ['**/*'];
    const ignore = config.exclude || [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.ragforge/**',
    ];

    // 1. Discover all files matching patterns
    const allFiles = await globby(patterns, {
      cwd: rootPath,
      ignore,
      absolute: true,
    });

    if (verbose) {
      console.log(`🔍 Discovered ${allFiles.length} files`);
    }

    // 2. Get existing hashes from DB
    const existingHashes = await this.getExistingFileHashes(projectId);
    if (verbose) {
      console.log(`📊 Found ${existingHashes.size} files with hashes in database`);
    }

    // 3. Compute hashes for current files in parallel (fast - just read + hash)
    const limit = pLimit(20); // Higher concurrency since we're just reading
    const newHashes = new Map<string, string>();
    const changedFiles: string[] = [];
    const unchangedFiles = new Set<string>();

    await Promise.all(
      allFiles.map(file =>
        limit(async () => {
          try {
            const relPath = pathModule.relative(rootPath, file);
            const hash = await IncrementalIngestionManager.computeFileHash(file);
            newHashes.set(relPath, hash);

            const existingHash = existingHashes.get(relPath);
            if (existingHash === hash) {
              // File unchanged - skip parsing
              unchangedFiles.add(relPath);
            } else {
              // File new or changed - needs parsing
              changedFiles.push(file);
            }
          } catch (err) {
            // File might have been deleted, include it for processing
            changedFiles.push(file);
          }
        })
      )
    );

    // 4. Check for files with schemaDirty nodes - these need re-ingestion even if file unchanged
    const schemaDirtyFiles = await this.getFilesWithDirtySchema(projectId);
    if (schemaDirtyFiles.size > 0) {
      let forcedCount = 0;
      for (const dirtyFile of schemaDirtyFiles) {
        if (unchangedFiles.has(dirtyFile)) {
          unchangedFiles.delete(dirtyFile);
          // Find the absolute path and add to changedFiles
          const absPath = pathModule.join(rootPath, dirtyFile);
          if (!changedFiles.includes(absPath)) {
            changedFiles.push(absPath);
            forcedCount++;
          }
        }
      }
      if (verbose) {
        console.log(`🔄 Found ${schemaDirtyFiles.size} files with outdated schema, forced ${forcedCount} to re-ingest`);
      }
    }

    if (verbose) {
      console.log(`✅ Hash comparison: ${changedFiles.length} changed, ${unchangedFiles.size} unchanged`);
      if (unchangedFiles.size > 0 && changedFiles.length === 0) {
        console.log(`⚡ All files unchanged - skipping parsing entirely`);
      }
    }

    return { allFiles, changedFiles, unchangedFiles, newHashes };
  }

  /**
   * Get files that have nodes with schemaDirty = true
   * These files need to be re-ingested even if their content hash hasn't changed
   */
  private async getFilesWithDirtySchema(projectId: string): Promise<Set<string>> {
    const result = await this.client.run(
      `MATCH (n)
       WHERE n.projectId = $projectId AND n.schemaDirty = true AND n.file IS NOT NULL
       RETURN DISTINCT n.file AS file`,
      { projectId }
    );

    const files = new Set<string>();
    for (const record of result.records) {
      const file = record.get('file');
      if (file) {
        files.add(file);
      }
    }
    return files;
  }

  /**
   * Delete nodes and their relationships
   * Used to clean up orphaned nodes when files are deleted
   *
   * Works with ALL content node types (not just Scope)
   */
  async deleteNodes(uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;

    // Delete ANY node by UUID (not just Scope)
    await this.client.run(
      `
      MATCH (n)
      WHERE n.uuid IN $uuids
      DETACH DELETE n
      `,
      { uuids }
    );
  }

  /**
   * Delete all nodes associated with a file path
   * Used when a file is deleted (unlink event)
   *
   * Deletes:
   * - File node itself
   * - All content nodes with matching file property (Scope, DocumentFile, etc.)
   * - All related nodes (via cascade relationships like HAS_PARENT, CONTAINS, etc.)
   *
   * @returns Number of nodes deleted
   */
  async deleteNodesForFile(filePath: string): Promise<number> {
    // First, find all nodes associated with this file
    // This includes:
    // - Nodes with file = filePath (Scope, Chunk, etc.)
    // - Nodes with path = filePath (File node)
    // - Nodes with source_file = filePath (some adapters use this)
    const result = await this.client.run(
      `
      MATCH (n)
      WHERE n.file = $filePath
         OR n.path = $filePath
         OR n.source_file = $filePath
      DETACH DELETE n
      RETURN count(n) AS deleted
      `,
      { filePath }
    );

    return result.records[0]?.get('deleted')?.toNumber() || 0;
  }

  /**
   * Delete all nodes for multiple files at once
   * More efficient than calling deleteNodesForFile in a loop
   */
  async deleteNodesForFiles(filePaths: string[]): Promise<number> {
    if (filePaths.length === 0) return 0;

    const result = await this.client.run(
      `
      MATCH (n)
      WHERE n.file IN $filePaths
         OR n.path IN $filePaths
         OR n.source_file IN $filePaths
      DETACH DELETE n
      RETURN count(n) AS deleted
      `,
      { filePaths }
    );

    return result.records[0]?.get('deleted')?.toNumber() || 0;
  }

  /**
   * Delete outgoing relationships from nodes before re-upserting
   * This ensures stale relationships are cleaned up when content changes
   *
   * @param uuids - Node UUIDs to clean relationships from
   * @param relationshipTypes - Optional list of relationship types to delete (default: all outgoing)
   */
  async deleteOutgoingRelationships(
    uuids: string[],
    relationshipTypes?: string[]
  ): Promise<number> {
    if (uuids.length === 0) return 0;

    let query: string;
    if (relationshipTypes && relationshipTypes.length > 0) {
      // Delete specific relationship types
      const relTypePattern = relationshipTypes.join('|');
      query = `
        MATCH (n)-[r:${relTypePattern}]->()
        WHERE n.uuid IN $uuids
        DELETE r
        RETURN count(r) AS deleted
      `;
    } else {
      // Delete ALL outgoing relationships
      query = `
        MATCH (n)-[r]->()
        WHERE n.uuid IN $uuids
        DELETE r
        RETURN count(r) AS deleted
      `;
    }

    const result = await this.client.run(query, { uuids });
    return result.records[0]?.get('deleted')?.toNumber() || 0;
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

      // Add schemaVersion to content nodes (for detecting schema changes)
      addSchemaVersion(node.labels, props);

      // Note: schemaDirty is cleared via REMOVE in the query below, not via props

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
    let processedNodes = 0;
    const totalNodes = nodes.length;
    for (const [labels, nodeData] of nodesByLabel) {
      if (nodeData.length === 0) continue;

      // Determine unique field based on node type
      // File and Directory use 'path', others use 'uuid'
      // Note: ImageFile, ThreeDFile, DocumentFile are MediaFile subtypes and use 'uuid'
      const labelsArray = labels.split(':');
      const isMediaFile = labelsArray.includes('MediaFile') || labelsArray.includes('ImageFile')
        || labelsArray.includes('ThreeDFile') || labelsArray.includes('DocumentFile');
      const isFileOrDirectory = (labelsArray.includes('File') || labelsArray.includes('Directory')) && !isMediaFile;
      const uniqueField = isFileOrDirectory ? 'path' : 'uuid';
      const uniqueValue = isFileOrDirectory ? 'nodeData.props.path' : 'nodeData.uuid';

      await this.client.run(
        `
        UNWIND $nodes AS nodeData
        MERGE (n:${labels} {${uniqueField}: ${uniqueValue}})
        SET n += nodeData.props
        REMOVE n.schemaDirty
        `,
        { nodes: nodeData }
      );

      processedNodes += nodeData.length;
      console.log(`   📦 Upserted ${nodeData.length} ${labels} nodes (${processedNodes}/${totalNodes})`);
    }

    // Create relationships using UNWIND batching (batches of 500)
    // Optimization: Build uuid->labels map for indexed MATCH queries
    if (relationships.length > 0) {
      console.log(`   🔗 Creating ${relationships.length} relationships...`);

      // Build uuid -> primary label map for fast indexed lookups
      const uuidToLabel = new Map<string, string>();
      for (const node of nodes) {
        // Use first label as primary (most specific)
        const primaryLabel = node.labels[0] || 'Node';
        uuidToLabel.set(node.id, primaryLabel);
      }

      const batchSize = 500;
      // Group by relationship type AND label combination for optimized queries
      const relsByTypeAndLabels = new Map<string, Array<{ from: string; to: string; props: any }>>();

      for (const rel of relationships) {
        const fromLabel = uuidToLabel.get(rel.from) || 'Node';
        const toLabel = uuidToLabel.get(rel.to) || 'Node';
        // Key includes rel type + labels for specific queries
        const key = `${rel.type}|${fromLabel}|${toLabel}`;

        if (!relsByTypeAndLabels.has(key)) {
          relsByTypeAndLabels.set(key, []);
        }
        relsByTypeAndLabels.get(key)!.push({
          from: rel.from,
          to: rel.to,
          props: rel.properties || {}
        });
      }

      // Process each relationship type+label combination in batches
      let processedRels = 0;
      for (const [key, rels] of relsByTypeAndLabels) {
        const [relType, fromLabel, toLabel] = key.split('|');

        for (let i = 0; i < rels.length; i += batchSize) {
          const batch = rels.slice(i, i + batchSize);

          // Use labeled MATCH for indexed lookups (100x faster!)
          await this.client.run(
            `
            UNWIND $rels AS relData
            MATCH (from:${fromLabel} {uuid: relData.from})
            MATCH (to:${toLabel} {uuid: relData.to})
            MERGE (from)-[r:${relType}]->(to)
            SET r += relData.props
            `,
            { rels: batch }
          );

          processedRels += batch.length;
        }
        console.log(`   🔗 ${rels.length} ${relType} (${fromLabel}→${toLabel}) [${processedRels}/${relationships.length}]`);
      }
    }

    console.log(`   ✅ Upsert complete: ${totalNodes} nodes, ${relationships.length} relationships`);
  }

  /**
   * Incremental ingestion - only updates changed content nodes
   *
   * Strategy:
   * 1. Fetch existing hashes from DB (ALL content node types)
   * 2. Filter nodes: only keep changed/new ones
   * 3. Delete orphaned nodes (files removed from codebase)
   * 4. Clean up outgoing relationships for modified nodes
   * 5. Upsert changed nodes
   * 6. Update relationships for affected nodes
   * 7. Track changes and generate diffs (if enabled)
   *
   * Supports: Scope, DataFile, MediaFile, DocumentFile, VueSFC,
   *           SvelteComponent, Stylesheet, MarkdownDocument, CodeBlock
   */
  async ingestIncremental(
    graph: ParsedGraph,
    options: IngestionOptions = {}
  ): Promise<IncrementalStats> {
    const { projectId, dryRun, verbose = false, trackChanges, cleanupRelationships = true } = options;
    const { nodes, relationships } = graph;

    if (verbose) {
      console.log('🔍 Analyzing changes...');
      if (projectId) {
        console.log(`   Project: ${projectId}`);
      }
    }

    // Add projectId to all nodes if specified
    if (projectId) {
      for (const node of nodes) {
        node.properties.projectId = projectId;
      }
    }

    // 1. Get ALL content nodes (not just Scope)
    // Content nodes have a hash property and are not structural (File, Directory, Project)
    const contentNodes = nodes.filter(n =>
      n.properties.hash !== undefined &&
      !isStructuralNode(n)
    );
    const nodeIds = contentNodes.map(n => n.id);
    const existingHashes = await this.getExistingHashes(nodeIds, projectId);

    if (verbose) {
      console.log(`   Found ${existingHashes.size} existing content nodes in database`);
    }

    // 2. Classify nodes
    const unchanged: string[] = [];
    const modified: ParsedNode[] = [];
    const created: ParsedNode[] = [];

    for (const node of contentNodes) {
      const uuid = node.id;
      const existing = existingHashes.get(uuid);
      const currentHash = node.properties.hash as string;

      if (!existing) {
        created.push(node);
      } else if (existing.hash !== currentHash || existing.schemaDirty === true) {
        // Treat schemaDirty nodes as modified even if hash unchanged
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

    if (dryRun) {
      return stats;
    }

    // 4. Delete orphaned nodes
    if (deleted.length > 0) {
      if (verbose) {
        console.log(`\n🗑️  Deleting ${deleted.length} orphaned nodes...`);
      }
      await this.deleteNodes(deleted);
    }

    // 5. Clean up outgoing relationships for modified nodes
    // This ensures stale references are removed before re-upserting
    if (cleanupRelationships && modified.length > 0) {
      const modifiedUuids = modified.map(n => n.id);
      if (verbose) {
        console.log(`\n🔗 Cleaning up relationships for ${modified.length} modified nodes...`);
      }
      const deletedRels = await this.deleteOutgoingRelationships(modifiedUuids);
      if (verbose && deletedRels > 0) {
        console.log(`   Removed ${deletedRels} stale relationships`);
      }
    }

    // 6. Upsert modified + created nodes
    const nodesToUpsert = [...modified, ...created];

    // Always include structural nodes (File, Directory, Project)
    // These should be upserted even if no content changes
    const structuralNodes = nodes.filter(isStructuralNode);

    if (nodesToUpsert.length > 0 || structuralNodes.length > 0) {
      if (verbose) {
        console.log(`\n💾 Upserting ${nodesToUpsert.length} changed content nodes + ${structuralNodes.length} structural nodes...`);
      }

      // Include all node IDs for relationship filtering
      const allNodesToIngest = [...nodesToUpsert, ...structuralNodes];
      const affectedUuids = new Set(allNodesToIngest.map(n => n.id));
      const relevantRelationships = relationships.filter(rel =>
        affectedUuids.has(rel.from) || affectedUuids.has(rel.to)
      );

      await this.ingestNodes(
        allNodesToIngest,
        relevantRelationships,
        true  // Mark changed nodes as embeddingsDirty
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

        // Helper to get content from different node types
        const getNodeContent = (node: ParsedNode): string | undefined => {
          // Scope nodes use 'source'
          if (node.labels.includes('Scope')) return node.properties.source as string;
          // Document nodes use 'textContent'
          if (node.labels.includes('DocumentFile') || node.labels.includes('PDFDocument') ||
              node.labels.includes('WordDocument') || node.labels.includes('SpreadsheetDocument')) {
            return node.properties.textContent as string;
          }
          // Markdown sections use 'rawText'
          if (node.labels.includes('MarkdownSection')) return node.properties.rawText as string;
          // Code blocks use 'code'
          if (node.labels.includes('CodeBlock')) return node.properties.code as string;
          // Web pages use 'textContent'
          if (node.labels.includes('WebPage')) return node.properties.textContent as string;
          return undefined;
        };

        // Helper to get entity type from labels
        const getEntityType = (node: ParsedNode): string => {
          if (node.labels.includes('Scope')) return 'Scope';
          if (node.labels.includes('PDFDocument')) return 'PDFDocument';
          if (node.labels.includes('WordDocument')) return 'WordDocument';
          if (node.labels.includes('SpreadsheetDocument')) return 'SpreadsheetDocument';
          if (node.labels.includes('DocumentFile')) return 'DocumentFile';
          if (node.labels.includes('MarkdownSection')) return 'MarkdownSection';
          if (node.labels.includes('CodeBlock')) return 'CodeBlock';
          if (node.labels.includes('WebPage')) return 'WebPage';
          return node.labels[0] || 'Unknown';
        };

        // Add created content nodes
        for (const node of created) {
          const content = getNodeContent(node);
          if (!content) continue; // Skip nodes without trackable content

          const nodeName = node.properties.name as string || node.properties.path as string || node.id;
          const nodeFile = node.properties.file as string || node.properties.path as string || '';
          const newHash = node.properties.hash as string;
          const entityType = getEntityType(node);

          changesToTrack.push({
            entityType,
            entityUuid: node.id,
            entityLabel: nodeFile ? `${nodeFile}:${nodeName}` : nodeName,
            oldContent: null,
            newContent: content,
            oldHash: null,
            newHash,
            changeType: 'created',
            metadata: { name: nodeName, file: nodeFile }
          });
        }

        // Add modified content nodes
        for (const node of modified) {
          const existing = existingHashes.get(node.id);
          if (!existing) continue;

          const content = getNodeContent(node);
          if (!content) continue; // Skip nodes without trackable content

          const nodeName = node.properties.name as string || node.properties.path as string || node.id;
          const nodeFile = node.properties.file as string || node.properties.path as string || '';
          const newHash = node.properties.hash as string;
          const entityType = getEntityType(node);

          changesToTrack.push({
            entityType,
            entityUuid: node.id,
            entityLabel: nodeFile ? `${nodeFile}:${nodeName}` : nodeName,
            oldContent: existing.source || existing.textContent || '',
            newContent: content,
            oldHash: existing.hash,
            newHash,
            changeType: 'updated',
            metadata: { name: nodeName, file: nodeFile }
          });
        }

        // Track all changes in parallel using p-limit (10 concurrent)
        await this.changeTracker.trackEntityChangesBatch(changesToTrack, 10);

        if (verbose) {
          console.log(`   Tracked ${changesToTrack.length} content change(s)`);
        }
      }
    }

    if (verbose && (created.length > 0 || modified.length > 0)) {
      console.log(`\n⚠️  ${created.length + modified.length} scope(s) marked as dirty - embeddings need regeneration`);
    }

    return stats;
  }

  /**
   * Ingest files from source configuration
   *
   * OPTIMIZED: Pre-parsing hash check skips unchanged files entirely
   *
   * @param config - Source configuration (code, documents, etc.)
   * @param options - Ingestion options
   *   - incremental: Controls hash checking behavior
   *     - true/'both': Check file hashes AND scope hashes (default)
   *     - 'files': Check file hashes only, skip scope comparison
   *     - 'content': Skip file hash check, but compare scope hashes (for watcher)
   *     - false: No hash checks, direct upsert
   */
  async ingestFromPaths(
    config: SourceConfig,
    options: IngestionOptions & { incremental?: boolean | 'files' | 'content' | 'both' } = {}
  ): Promise<IncrementalStats> {
    const { projectId, verbose = false, dryRun, trackChanges: optTrackChanges } = options;
    const trackChanges = optTrackChanges ?? config.track_changes ?? false;

    // Parse incremental option
    const incrementalOpt = options.incremental ?? true;
    const checkFileHashes = incrementalOpt === true || incrementalOpt === 'both' || incrementalOpt === 'files';
    const checkContentHashes = incrementalOpt === true || incrementalOpt === 'both' || incrementalOpt === 'content';

    if (verbose) {
      const pathCount = config.include?.length || 0;
      const sourceType = config.type === 'code' ? 'code' : 'files';
      console.log(`\n🔄 Ingesting ${sourceType} from ${pathCount} path(s)...`);
      console.log(`   Base path: ${config.root || '.'}`);
      const modeStr = checkFileHashes && checkContentHashes ? 'incremental (files + content)'
        : checkFileHashes ? 'incremental (files only)'
        : checkContentHashes ? 'incremental (content only)'
        : 'full';
      console.log(`   Mode: ${modeStr}`);
      if (projectId) {
        console.log(`   Project: ${projectId}`);
      }
      if (trackChanges) {
        console.log(`   Change tracking: enabled`);
      }
    }

    // ===== PRE-PARSING OPTIMIZATION =====
    // Check file hashes BEFORE parsing to skip unchanged files entirely
    // This is the key optimization that makes re-ingestion fast
    let skipFiles: Set<string> | undefined;
    let newHashes: Map<string, string> | undefined;

    if (checkFileHashes && projectId) {
      const filterStart = Date.now();
      const filterResult = await this.filterChangedFiles(config, projectId, verbose);
      const filterMs = Date.now() - filterStart;

      skipFiles = filterResult.unchangedFiles;
      newHashes = filterResult.newHashes;

      if (verbose) {
        console.log(`   Pre-parsing check took ${filterMs}ms`);
      }

      // If ALL files are unchanged, return early with zero changes
      if (filterResult.changedFiles.length === 0 && filterResult.unchangedFiles.size > 0) {
        if (verbose) {
          console.log(`\n⚡ No files changed - skipping parsing entirely!`);
        }
        return {
          unchanged: filterResult.unchangedFiles.size,
          updated: 0,
          created: 0,
          deleted: 0
        };
      }
    }

    // Create adapter and parse (only changed files if incremental)
    const adapter = getAdapter();
    const parseResult = await adapter.parse({
      source: config,
      skipFiles, // Pass unchanged files to skip
      onProgress: undefined
    });

    if (verbose) {
      // Generic entity count (works for both Scope and Document/Chunk)
      const entityCounts = new Map<string, number>();
      for (const node of parseResult.graph.nodes) {
        for (const label of node.labels) {
          entityCounts.set(label, (entityCounts.get(label) || 0) + 1);
        }
      }

      const countStr = Array.from(entityCounts.entries())
        .map(([label, count]) => `${count} ${label}${count !== 1 ? 's' : ''}`)
        .join(', ');
      console.log(`\n✅ Parsed ${countStr} from source`);
    }

    // Add rawContentHash to File nodes (for future incremental checks)
    if (newHashes) {
      for (const node of parseResult.graph.nodes) {
        if (node.labels.includes('File') && node.properties.path) {
          const hash = newHashes.get(node.properties.path as string);
          if (hash) {
            node.properties.rawContentHash = hash;
          }
        }
      }
    }

    // Ingest with projectId
    if (checkContentHashes) {
      const stats = await this.ingestIncremental(parseResult.graph, {
        projectId,
        verbose,
        dryRun,
        trackChanges
      });

      // Add skipped files to unchanged count
      if (skipFiles) {
        stats.unchanged += skipFiles.size;
      }

      return stats;
    } else {
      // Full ingestion - add projectId to nodes
      if (projectId) {
        for (const node of parseResult.graph.nodes) {
          node.properties.projectId = projectId;
        }
      }
      await this.ingestNodes(parseResult.graph.nodes, parseResult.graph.relationships);
      const totalNodes = parseResult.graph.nodes.length;
      return {
        unchanged: 0,
        updated: 0,
        created: totalNodes,
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

  /**
   * Re-ingest multiple files at once (for batch processing agent edits)
   *
   * More efficient than calling reIngestFile in a loop.
   * Handles both creates, updates, and deletes.
   *
   * @param changes - Array of file changes (path + changeType)
   * @param rootPath - Root path for relative path calculation
   * @param options - Ingestion options including projectId
   */
  async reIngestFiles(
    changes: Array<{ path: string; changeType: 'created' | 'updated' | 'deleted' }>,
    rootPath: string,
    options: IngestionOptions = {}
  ): Promise<IncrementalStats> {
    const { projectId, verbose = false, trackChanges } = options;
    const path = await import('path');

    if (changes.length === 0) {
      return { unchanged: 0, updated: 0, created: 0, deleted: 0 };
    }

    if (verbose) {
      console.log(`🔄 Re-ingesting ${changes.length} files...`);
    }

    // Separate deletes from creates/updates
    const deletes = changes.filter(c => c.changeType === 'deleted');
    const upserts = changes.filter(c => c.changeType !== 'deleted');

    let stats: IncrementalStats = { unchanged: 0, updated: 0, created: 0, deleted: 0 };

    // Handle deletes
    if (deletes.length > 0) {
      const relPaths = deletes.map(d => path.relative(rootPath, d.path));

      // Delete all nodes for these files (filtered by projectId if provided)
      const query = projectId
        ? `
          MATCH (n)
          WHERE n.projectId = $projectId
            AND (n.path IN $relPaths OR n.filePath IN $relPaths OR n.file IN $relPaths)
          DETACH DELETE n
          RETURN count(n) AS deleted
          `
        : `
          MATCH (n)
          WHERE n.path IN $relPaths OR n.filePath IN $relPaths OR n.file IN $relPaths
          DETACH DELETE n
          RETURN count(n) AS deleted
          `;

      const result = await this.client.run(query, { projectId, relPaths });
      stats.deleted = result.records[0]?.get('deleted')?.toNumber() || 0;

      if (verbose) {
        console.log(`   Deleted ${stats.deleted} nodes for ${deletes.length} files`);
      }
    }

    // Handle creates/updates
    if (upserts.length > 0) {
      const relPaths = upserts.map(u => path.relative(rootPath, u.path));

      // For updates, delete existing nodes first
      const updates = upserts.filter(u => u.changeType === 'updated');
      if (updates.length > 0) {
        const updatePaths = updates.map(u => path.relative(rootPath, u.path));

        const deleteQuery = projectId
          ? `
            MATCH (n)
            WHERE n.projectId = $projectId
              AND (n.path IN $updatePaths OR n.filePath IN $updatePaths OR n.file IN $updatePaths)
            DETACH DELETE n
            `
          : `
            MATCH (n)
            WHERE n.path IN $updatePaths OR n.filePath IN $updatePaths OR n.file IN $updatePaths
            DETACH DELETE n
            `;

        await this.client.run(deleteQuery, { projectId, updatePaths });
      }

      // Parse and ingest the files
      const ingestStats = await this.ingestFromPaths(
        {
          type: 'files',
          root: rootPath,
          include: relPaths,
        },
        {
          projectId,
          verbose,
          trackChanges,
          incremental: false, // We already handled incremental logic above
        }
      );

      stats.created = ingestStats.created;
      stats.updated = updates.length; // Files we deleted then re-created
    }

    return stats;
  }

  /**
   * Re-ingest a single file (optimized for file tool modifications)
   *
   * This method:
   * 1. Parses only the specified file
   * 2. Deletes scopes that were in the old version but not the new
   * 3. Upserts new/modified scopes
   * 4. Marks affected scopes as embeddingsDirty
   *
   * @param filePath - Absolute path to the file
   * @param sourceConfig - Source configuration (for adapter type, root path)
   * @param options - Optional settings including projectId
   */
  async reIngestFile(
    filePath: string,
    sourceConfig: SourceConfig,
    options: IngestionOptions = {}
  ): Promise<{
    scopesCreated: number;
    scopesUpdated: number;
    scopesDeleted: number;
  }> {
    const verbose = options.verbose ?? false;
    const fs = await import('fs/promises');
    const path = await import('path');

    // Resolve relative path from root
    const root = sourceConfig.root || '.';
    const relativePath = path.relative(root, filePath);

    if (verbose) {
      console.log(`🔄 Re-ingesting file: ${relativePath}`);
    }

    // Check if file exists
    let fileExists = true;
    try {
      await fs.access(filePath);
    } catch {
      fileExists = false;
    }

    // Get existing scopes for this file
    const existingResult = await this.client.run(
      `
      MATCH (s:Scope)
      WHERE s.file = $relativePath OR s.file = $filePath
      RETURN s.uuid AS uuid, s.hash AS hash, s.name AS name, s.source AS source
      `,
      { relativePath, filePath }
    );

    const existingScopes = new Map<string, { hash: string; name: string; source?: string }>();
    for (const record of existingResult.records) {
      existingScopes.set(record.get('uuid'), {
        hash: record.get('hash'),
        name: record.get('name'),
        source: record.get('source')
      });
    }

    if (verbose) {
      console.log(`   Found ${existingScopes.size} existing scopes for this file`);
    }

    // If file was deleted, remove all its scopes
    if (!fileExists) {
      const deletedUuids = Array.from(existingScopes.keys());
      if (deletedUuids.length > 0) {
        await this.deleteNodes(deletedUuids);
        if (verbose) {
          console.log(`   ✅ Deleted ${deletedUuids.length} scopes (file removed)`);
        }
      }
      return {
        scopesCreated: 0,
        scopesUpdated: 0,
        scopesDeleted: deletedUuids.length
      };
    }

    // Parse the single file
    const adapter = getAdapter();

    // Read file content
    const content = await fs.readFile(filePath, 'utf-8');

    // Create a mini source config for just this file
    const singleFileConfig: SourceConfig = {
      ...sourceConfig,
      include: [relativePath]
    };

    // Parse the file
    const parseResult = await adapter.parse({
      source: singleFileConfig,
      onProgress: undefined
    });

    // Get new scopes
    const newScopes = parseResult.graph.nodes.filter(n => n.labels.includes('Scope'));

    if (verbose) {
      console.log(`   Parsed ${newScopes.length} scopes from file`);
    }

    // Classify changes
    const newScopeIds = new Set(newScopes.map(n => n.id));
    const existingIds = new Set(existingScopes.keys());

    const created = newScopes.filter(n => !existingIds.has(n.id));
    const updated = newScopes.filter(n => {
      const existing = existingScopes.get(n.id);
      return existing && existing.hash !== n.properties.hash;
    });
    const deleted = Array.from(existingIds).filter(id => !newScopeIds.has(id));

    if (verbose) {
      console.log(`   Changes: +${created.length} created, ~${updated.length} updated, -${deleted.length} deleted`);
    }

    // Delete removed scopes
    if (deleted.length > 0) {
      await this.deleteNodes(deleted);
    }

    // Upsert created + updated scopes
    const nodesToUpsert = [...created, ...updated];
    if (nodesToUpsert.length > 0) {
      // Include File node for the file
      const fileNodes = parseResult.graph.nodes.filter(n => n.labels.includes('File'));

      // Get relevant relationships
      const affectedUuids = new Set(nodesToUpsert.map(n => n.id));
      const relevantRelationships = parseResult.graph.relationships.filter(rel =>
        affectedUuids.has(rel.from) || affectedUuids.has(rel.to)
      );

      await this.ingestNodes(
        [...nodesToUpsert, ...fileNodes],
        relevantRelationships,
        true // Mark as embeddingsDirty
      );
    }

    // Track changes if enabled
    if (options.trackChanges && (created.length > 0 || updated.length > 0 || deleted.length > 0)) {
      const changesToTrack: Array<{
        entityType: string;
        entityUuid: string;
        entityLabel: string;
        oldContent: string | null;
        newContent: string;
        oldHash: string | null;
        newHash: string;
        changeType: 'created' | 'updated' | 'deleted';
      }> = [];

      for (const node of created) {
        changesToTrack.push({
          entityType: 'Scope',
          entityUuid: node.id,
          entityLabel: node.properties.name as string,
          oldContent: null,
          newContent: node.properties.source as string,
          oldHash: null,
          newHash: node.properties.hash as string,
          changeType: 'created'
        });
      }

      for (const node of updated) {
        const existing = existingScopes.get(node.id);
        changesToTrack.push({
          entityType: 'Scope',
          entityUuid: node.id,
          entityLabel: node.properties.name as string,
          oldContent: existing?.source || null,
          newContent: node.properties.source as string,
          oldHash: existing?.hash || null,
          newHash: node.properties.hash as string,
          changeType: 'updated'
        });
      }

      for (const uuid of deleted) {
        const existing = existingScopes.get(uuid);
        if (existing) {
          changesToTrack.push({
            entityType: 'Scope',
            entityUuid: uuid,
            entityLabel: existing.name,
            oldContent: existing.source || '',
            newContent: '',
            oldHash: existing.hash,
            newHash: '',
            changeType: 'deleted'
          });
        }
      }

      await this.changeTracker.trackEntityChangesBatch(changesToTrack);
    }

    if (verbose) {
      console.log(`   ✅ Re-ingestion complete`);
    }

    return {
      scopesCreated: created.length,
      scopesUpdated: updated.length,
      scopesDeleted: deleted.length
    };
  }
}
