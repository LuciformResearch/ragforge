/**
 * FileProcessor - Unified file processing module
 *
 * Handles the complete file processing pipeline for both:
 * - Orphan files (TouchedFilesWatcher)
 * - Project files (IncrementalIngestionManager)
 *
 * Optimizations:
 * - Batch node creation using UNWIND (instead of one-by-one)
 * - Batch relationship creation using UNWIND
 * - Parallel file processing with p-limit
 * - State machine integration for tracking
 *
 * Pipeline stages:
 *   discovered → parsing → parsed → relations → linked
 *
 * @since 2025-12-13
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import pLimit from 'p-limit';
import type { Neo4jClient } from '../runtime/client/neo4j-client.js';
import type { EmbeddingService } from './embedding-service.js';
import { UniversalSourceAdapter } from '../runtime/adapters/universal-source-adapter.js';
import type { ParsedGraph, ParsedNode, ParsedRelationship } from '../runtime/adapters/types.js';
import {
  extractReferences,
  resolveAllReferences,
  createReferenceRelations,
  type ResolvedReference,
} from './reference-extractor.js';
import {
  FileStateMachine,
  type FileState,
} from './file-state-machine.js';
import { UniqueIDHelper } from '../runtime/utils/UniqueIDHelper.js';

// ============================================
// Types
// ============================================

export interface FileInfo {
  /** Absolute path to the file (canonical identifier) */
  absolutePath: string;
  /** File UUID in Neo4j */
  uuid: string;
  /** Content hash (for change detection) */
  hash?: string;
  /** Current state in the pipeline */
  state: FileState;
  /** File name */
  name?: string;
  /** File extension */
  extension?: string;
}

export interface ProcessResult {
  /** Processing status */
  status: 'parsed' | 'skipped' | 'deleted' | 'error';
  /** Number of scope nodes created */
  scopesCreated: number;
  /** Number of relationships created */
  relationshipsCreated: number;
  /** Number of references created (CONSUMES/PENDING_IMPORT) */
  referencesCreated: number;
  /** Error message if status is 'error' */
  error?: string;
  /** New content hash */
  newHash?: string;
}

export interface BatchResult {
  /** Files successfully processed */
  processed: number;
  /** Files skipped (unchanged) */
  skipped: number;
  /** Files deleted (not found) */
  deleted: number;
  /** Errors encountered */
  errors: number;
  /** Total scopes created */
  totalScopesCreated: number;
  /** Total relationships created */
  totalRelationshipsCreated: number;
  /** Processing duration in ms */
  durationMs: number;
}

export interface FileProcessorConfig {
  /** Neo4j client */
  neo4jClient: Neo4jClient;
  /** Adapter for parsing (optional - creates default if not provided) */
  adapter?: UniversalSourceAdapter;
  /** State machine for tracking (optional - creates default if not provided) */
  stateMachine?: FileStateMachine;
  /** Project ID */
  projectId: string;
  /** Project root path (for calculating relative paths) */
  projectRoot?: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Concurrency limit for parallel processing (default: 10) */
  concurrency?: number;
  /**
   * Callback when a file transitions to 'linked' state
   * Used to resolve PENDING_IMPORT → CONSUMES relations
   */
  onFileLinked?: (filePath: string) => Promise<void>;
  /**
   * Callback to create a mentioned file (for unresolved imports)
   */
  onCreateMentionedFile?: (
    targetPath: string,
    importedBy: {
      filePath: string;
      scopeUuid?: string;
      symbols: string[];
      importPath: string;
    }
  ) => Promise<{ created: boolean; fileState: string }>;
  /**
   * Callback to check if a file exists in the graph and get its state
   */
  onGetFileState?: (absolutePath: string) => Promise<string | null>;
}

// ============================================
// FileProcessor
// ============================================

export class FileProcessor {
  private neo4jClient: Neo4jClient;
  private adapter: UniversalSourceAdapter;
  private stateMachine: FileStateMachine;
  private projectId: string;
  private projectRoot?: string;
  private verbose: boolean;
  private concurrency: number;
  private config: FileProcessorConfig;

  constructor(config: FileProcessorConfig) {
    this.config = config;
    this.neo4jClient = config.neo4jClient;
    this.adapter = config.adapter || new UniversalSourceAdapter();
    this.stateMachine = config.stateMachine || new FileStateMachine(config.neo4jClient);
    this.projectId = config.projectId;
    this.projectRoot = config.projectRoot;
    this.verbose = config.verbose || false;
    this.concurrency = config.concurrency || 10;
  }

  /**
   * Process a single file through the complete pipeline:
   * 1. Transition: discovered → parsing
   * 2. Read file content
   * 3. Check hash (skip if unchanged)
   * 4. Parse with UniversalSourceAdapter
   * 5. Transition: parsing → parsed
   * 6. Delete old scopes
   * 7. Create new scopes in Neo4j (batch)
   * 8. Transition: parsed → relations
   * 9. Extract and create references
   * 10. Transition: relations → linked
   */
  async processFile(file: FileInfo): Promise<ProcessResult> {
    const startTime = Date.now();

    try {
      // 0. Re-check current state from database (in case it was updated since queuing)
      // This prevents race conditions where:
      // - read_file calls touchFile (state="discovered")
      // - Watcher queues the file for processing
      // - read_file calls updateMediaContent which sets state="linked"
      // - Watcher starts processFile with stale state info
      const currentStateResult = await this.neo4jClient.run(
        `MATCH (f:File {uuid: $uuid}) RETURN f.state as state`,
        { uuid: file.uuid }
      );

      if (currentStateResult.records.length > 0) {
        const currentState = currentStateResult.records[0].get('state');
        // Skip if file is already being processed or was processed by another path
        // - 'parsing': being processed by updateMediaContent or another processFile call
        // - 'linked': content nodes created, waiting for embeddings
        // - 'embedded': fully processed with embeddings
        if (currentState === 'parsing' || currentState === 'linked' || currentState === 'embedded') {
          // File already processed by another path (e.g., read_file → updateMediaContent)
          if (this.verbose) {
            console.log(`[FileProcessor] Skipping ${file.absolutePath}: already in state '${currentState}'`);
          }
          return { status: 'skipped', scopesCreated: 0, relationshipsCreated: 0, referencesCreated: 0 };
        }
      }

      // 1. Transition to parsing state
      await this.stateMachine.transition(file.uuid, 'parsing');

      // 2. Read file content
      let content: string;
      try {
        content = await fs.readFile(file.absolutePath, 'utf-8');
      } catch (err: any) {
        // File may have been deleted
        if (err.code === 'ENOENT') {
          await this.deleteFileAndScopes(file.absolutePath);
          return { status: 'deleted', scopesCreated: 0, relationshipsCreated: 0, referencesCreated: 0 };
        }
        throw err;
      }

      // 3. Compute and check hash
      const newHash = this.computeHash(content);
      if (file.hash === newHash) {
        // File unchanged - transition directly to linked
        await this.stateMachine.transition(file.uuid, 'linked', { contentHash: newHash });
        return { status: 'skipped', scopesCreated: 0, relationshipsCreated: 0, referencesCreated: 0, newHash };
      }

      // 4. Parse the file
      const fileName = path.basename(file.absolutePath);
      const parseResult = await this.adapter.parse({
        source: {
          type: 'code',
          root: path.dirname(file.absolutePath),
          include: [fileName],
        },
        projectId: this.projectId,
      });

      // 5. Transition to parsed state
      await this.stateMachine.transition(file.uuid, 'parsed', { contentHash: newHash });

      // 6. Delete old scopes
      await this.deleteFileScopes(file.absolutePath);

      // 7. Create new scopes (batch)
      let scopesCreated = 0;
      let relationshipsCreated = 0;

      if (parseResult?.graph && parseResult.graph.nodes.length > 0) {
        // Prepare nodes with proper properties
        const preparedNodes = this.prepareNodes(parseResult.graph.nodes, file.absolutePath);

        // Batch create nodes
        scopesCreated = await this.createNodesBatch(preparedNodes, file.absolutePath);

        // Batch create relationships from the graph
        if (parseResult.graph.relationships && parseResult.graph.relationships.length > 0) {
          relationshipsCreated = await this.createRelationshipsBatch(parseResult.graph.relationships);
        }
      }

      // 8. Transition to relations state
      await this.stateMachine.transition(file.uuid, 'relations');

      // 9. Extract and create references
      let referencesCreated = 0;
      try {
        referencesCreated = await this.processFileReferences(file.absolutePath, content, file.uuid);
      } catch (err: any) {
        if (this.verbose) {
          console.warn(`[FileProcessor] Error processing references for ${fileName}: ${err.message}`);
        }
      }

      // 10. Transition to linked state
      await this.stateMachine.transition(file.uuid, 'linked');
      await this.updateFileHash(file.absolutePath, newHash, content.split('\n').length);

      // Notify that file was linked (to resolve PENDING_IMPORT relations)
      if (this.config.onFileLinked) {
        try {
          await this.config.onFileLinked(file.absolutePath);
        } catch (err: any) {
          if (this.verbose) {
            console.warn(`[FileProcessor] Error in onFileLinked for ${fileName}: ${err.message}`);
          }
        }
      }

      if (this.verbose) {
        const duration = Date.now() - startTime;
        console.log(`[FileProcessor] Parsed ${fileName}: ${scopesCreated} scopes, ${relationshipsCreated} rels, ${referencesCreated} refs (${duration}ms)`);
      }

      return {
        status: 'parsed',
        scopesCreated,
        relationshipsCreated,
        referencesCreated,
        newHash,
      };
    } catch (err: any) {
      // Transition to error state
      await this.stateMachine.transition(file.uuid, 'error', {
        errorType: 'parse',
        errorMessage: err.message,
      });

      if (this.verbose) {
        console.error(`[FileProcessor] Error processing ${file.absolutePath}: ${err.message}`);
      }

      return {
        status: 'error',
        scopesCreated: 0,
        relationshipsCreated: 0,
        referencesCreated: 0,
        error: err.message,
      };
    }
  }

  /**
   * Batch process multiple files with concurrency control
   */
  async processBatch(files: FileInfo[]): Promise<BatchResult> {
    const startTime = Date.now();
    const limit = pLimit(this.concurrency);

    let processed = 0;
    let skipped = 0;
    let deleted = 0;
    let errors = 0;
    let totalScopesCreated = 0;
    let totalRelationshipsCreated = 0;

    const results = await Promise.all(
      files.map(file =>
        limit(async () => {
          const result = await this.processFile(file);
          return result;
        })
      )
    );

    for (const result of results) {
      switch (result.status) {
        case 'parsed':
          processed++;
          totalScopesCreated += result.scopesCreated;
          totalRelationshipsCreated += result.relationshipsCreated;
          break;
        case 'skipped':
          skipped++;
          break;
        case 'deleted':
          deleted++;
          break;
        case 'error':
          errors++;
          break;
      }
    }

    return {
      processed,
      skipped,
      deleted,
      errors,
      totalScopesCreated,
      totalRelationshipsCreated,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Check if a file needs processing (hash changed)
   */
  async needsProcessing(absolutePath: string, currentHash?: string): Promise<{
    needsProcessing: boolean;
    newHash: string;
    reason?: 'new' | 'changed' | 'error_retry';
  }> {
    // Read current file content
    let content: string;
    try {
      content = await fs.readFile(absolutePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { needsProcessing: false, newHash: '', reason: undefined };
      }
      throw err;
    }

    const newHash = this.computeHash(content);

    // Check stored hash
    const storedHash = await this.getStoredHash(absolutePath);

    if (!storedHash) {
      return { needsProcessing: true, newHash, reason: 'new' };
    }

    if (storedHash !== newHash) {
      return { needsProcessing: true, newHash, reason: 'changed' };
    }

    // Check if file is in error state (retry)
    const state = await this.getFileState(absolutePath);
    if (state === 'error') {
      return { needsProcessing: true, newHash, reason: 'error_retry' };
    }

    return { needsProcessing: false, newHash };
  }

  /**
   * Create or update File node in Neo4j
   */
  async ensureFileNode(absolutePath: string, options?: {
    projectRoot?: string;
    state?: FileState;
  }): Promise<{ uuid: string; created: boolean }> {
    const fileName = path.basename(absolutePath);
    const extension = path.extname(absolutePath).slice(1);
    const relativePath = options?.projectRoot
      ? path.relative(options.projectRoot, absolutePath)
      : fileName;

    const fileUuid = UniqueIDHelper.GenerateFileUUID(absolutePath);
    const result = await this.neo4jClient.run(`
      MERGE (f:File {absolutePath: $absolutePath})
      ON CREATE SET
        f.uuid = $fileUuid,
        f.name = $name,
        f.extension = $extension,
        f.file = $relativePath,
        f.path = $relativePath,
        f.projectId = $projectId,
        f.state = $state,
        f.stateUpdatedAt = datetime()
      ON MATCH SET
        f.name = $name,
        f.extension = $extension
      RETURN f.uuid AS uuid, f.state IS NULL AS created
    `, {
      absolutePath,
      fileUuid,
      name: fileName,
      extension,
      relativePath,
      projectId: this.projectId,
      state: options?.state || 'discovered',
    });

    const record = result.records[0];
    return {
      uuid: record.get('uuid'),
      created: record.get('created') || false,
    };
  }

  /**
   * Get relative path from absolute path
   */
  getRelativePath(absolutePath: string): string {
    if (this.projectRoot) {
      return path.relative(this.projectRoot, absolutePath);
    }
    return path.basename(absolutePath);
  }

  // ============================================
  // Batch Operations (Optimized)
  // ============================================

  /**
   * Create nodes in batch using UNWIND
   * Much faster than creating one by one
   */
  private async createNodesBatch(nodes: PreparedNode[], filePath: string): Promise<number> {
    if (nodes.length === 0) return 0;

    // Group nodes by label for efficient batch creation
    const nodesByLabel = new Map<string, PreparedNode[]>();
    for (const node of nodes) {
      const label = node.label;
      if (!nodesByLabel.has(label)) {
        nodesByLabel.set(label, []);
      }
      nodesByLabel.get(label)!.push(node);
    }

    let totalCreated = 0;

    // Create nodes for each label type
    for (const [label, labelNodes] of nodesByLabel) {
      // Skip File and Project nodes - they are already managed elsewhere:
      // - File nodes are created by touchFile() or ensureFileNode()
      // - Project nodes should NOT be created for touched-files (orphan files)
      // Creating them here would cause duplicates with different UUIDs
      if (label === 'File' || label === 'Project') {
        continue;
      }

      const nodeProps = labelNodes.map(n => ({
        uuid: n.properties.uuid,
        props: n.properties,
      }));

      // Use UNWIND for batch creation
      const result = await this.neo4jClient.run(`
        UNWIND $nodes AS nodeData
        CREATE (n:${label})
        SET n = nodeData.props
        WITH n
        MATCH (f:File {absolutePath: $filePath})
        CREATE (n)-[:DEFINED_IN]->(f)
        RETURN count(n) AS created
      `, { nodes: nodeProps, filePath });

      const created = result.records[0]?.get('created');
      totalCreated += (typeof created === 'number' ? created : created?.toNumber?.() || 0);
    }

    return totalCreated;
  }

  /**
   * Create relationships in batch using UNWIND
   */
  private async createRelationshipsBatch(relationships: ParsedRelationship[]): Promise<number> {
    if (relationships.length === 0) return 0;

    // Group relationships by type for efficient batch creation
    const relsByType = new Map<string, ParsedRelationship[]>();
    for (const rel of relationships) {
      if (!relsByType.has(rel.type)) {
        relsByType.set(rel.type, []);
      }
      relsByType.get(rel.type)!.push(rel);
    }

    let totalCreated = 0;

    // Create relationships for each type
    for (const [relType, typeRels] of relsByType) {
      const relData = typeRels.map(r => ({
        from: r.from,
        to: r.to,
        props: r.properties || {},
      }));

      // Use UNWIND for batch creation
      const result = await this.neo4jClient.run(`
        UNWIND $rels AS relData
        MATCH (source {uuid: relData.from}), (target {uuid: relData.to})
        CREATE (source)-[r:${relType}]->(target)
        SET r = relData.props
        RETURN count(r) AS created
      `, { rels: relData });

      const created = result.records[0]?.get('created');
      totalCreated += (typeof created === 'number' ? created : created?.toNumber?.() || 0);
    }

    return totalCreated;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Prepare nodes for batch insertion
   */
  private prepareNodes(nodes: ParsedNode[], filePath: string): PreparedNode[] {
    const relativePath = this.getRelativePath(filePath);

    return nodes.map(node => ({
      label: node.labels[0] || 'Scope',
      properties: {
        ...node.properties,
        uuid: node.id || crypto.randomUUID(),
        projectId: this.projectId,
        file: relativePath,
        absolutePath: filePath,
        embeddingsDirty: true,
      },
    }));
  }

  /**
   * Compute content hash
   */
  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Get stored hash for a file
   */
  private async getStoredHash(absolutePath: string): Promise<string | null> {
    const result = await this.neo4jClient.run(`
      MATCH (f:File {absolutePath: $absolutePath, projectId: $projectId})
      RETURN f.hash AS hash
    `, { absolutePath, projectId: this.projectId });

    return result.records[0]?.get('hash') || null;
  }

  /**
   * Get file state
   */
  private async getFileState(absolutePath: string): Promise<FileState | null> {
    const result = await this.neo4jClient.run(`
      MATCH (f:File {absolutePath: $absolutePath, projectId: $projectId})
      RETURN f.state AS state
    `, { absolutePath, projectId: this.projectId });

    return result.records[0]?.get('state') || null;
  }

  /**
   * Update file hash and line count
   */
  private async updateFileHash(absolutePath: string, hash: string, lineCount?: number): Promise<void> {
    await this.neo4jClient.run(`
      MATCH (f:File {absolutePath: $absolutePath, projectId: $projectId})
      SET f.hash = $hash,
          f.lineCount = $lineCount
    `, { absolutePath, projectId: this.projectId, hash, lineCount: lineCount || null });
  }

  /**
   * Delete file scopes
   */
  private async deleteFileScopes(absolutePath: string): Promise<void> {
    await this.neo4jClient.run(`
      MATCH (n)-[:DEFINED_IN]->(f:File {absolutePath: $absolutePath})
      WHERE n.projectId = $projectId
      DETACH DELETE n
    `, { absolutePath, projectId: this.projectId });
  }

  /**
   * Delete file and all its scopes
   */
  private async deleteFileAndScopes(absolutePath: string): Promise<void> {
    // Delete scopes first
    await this.deleteFileScopes(absolutePath);

    // Delete the file node
    await this.neo4jClient.run(`
      MATCH (f:File {absolutePath: $absolutePath, projectId: $projectId})
      DETACH DELETE f
    `, { absolutePath, projectId: this.projectId });

    if (this.verbose) {
      console.log(`[FileProcessor] Deleted ${absolutePath} (file not found)`);
    }
  }

  /**
   * Process file imports and create references
   */
  private async processFileReferences(
    filePath: string,
    content: string,
    fileUuid: string
  ): Promise<number> {
    // Extract references
    const refs = extractReferences(content, filePath);
    if (refs.length === 0) {
      return 0;
    }

    // Resolve references to absolute paths
    const projectPath = this.projectRoot || path.dirname(filePath);
    const resolvedRefs = await resolveAllReferences(refs, filePath, projectPath);

    // Process each reference
    let created = 0;

    if (this.config.onGetFileState && this.config.onCreateMentionedFile) {
      // Orphan file mode - handle PENDING_IMPORT creation
      for (const ref of resolvedRefs) {
        const targetState = await this.config.onGetFileState(ref.absolutePath);

        if (targetState === 'linked' || targetState === 'embedded') {
          // Target is already linked - create relation directly
          const result = await createReferenceRelations(
            this.neo4jClient,
            fileUuid,
            filePath,
            [ref],
            this.projectId,
            { useAbsolutePath: true, createPending: false }
          );
          created += result.created;
        } else {
          // Target not linked - create mentioned file + PENDING_IMPORT
          await this.config.onCreateMentionedFile(ref.absolutePath, {
            filePath,
            symbols: ref.symbols,
            importPath: ref.source,
          });
          created++;
        }
      }
    } else {
      // Project file mode - use batch reference creation
      const result = await createReferenceRelations(
        this.neo4jClient,
        fileUuid,
        filePath,
        resolvedRefs,
        this.projectId,
        { useAbsolutePath: true, createPending: true }
      );
      created = result.created;
    }

    return created;
  }
}

// ============================================
// Internal Types
// ============================================

interface PreparedNode {
  label: string;
  properties: Record<string, any>;
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a FileProcessor for orphan files (touched-files)
 */
export function createOrphanFileProcessor(
  neo4jClient: Neo4jClient,
  options?: Partial<FileProcessorConfig>
): FileProcessor {
  return new FileProcessor({
    neo4jClient,
    projectId: 'touched-files',
    verbose: false,
    concurrency: 10,
    ...options,
  });
}

/**
 * Create a FileProcessor for project files
 */
export function createProjectFileProcessor(
  neo4jClient: Neo4jClient,
  projectId: string,
  projectRoot: string,
  options?: Partial<FileProcessorConfig>
): FileProcessor {
  return new FileProcessor({
    neo4jClient,
    projectId,
    projectRoot,
    verbose: false,
    concurrency: 10,
    ...options,
  });
}
