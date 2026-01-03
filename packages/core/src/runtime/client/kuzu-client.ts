/**
 * Kuzu Client
 *
 * Drop-in replacement for Neo4jClient using Kuzu embedded graph database.
 * Handles automatic conversion of named parameters ($name) to positional ($1, $2).
 *
 * IMPORTANT: Kuzu is an embedded database that only supports single-process access.
 * For multi-process scenarios (CLI + daemon), use the daemon which holds the connection.
 */

import kuzu from 'kuzu';
import fs from 'fs';
import path from 'path';
import type { RuntimeNeo4jConfig as Neo4jConfig, CypherQuery, QueryPlan, VectorSearchResult } from '../types/index.js';
import type { DatabaseClient, DatabaseSession, DatabaseQueryResult } from './database-client.js';
import { generateKuzuSchema, generateKuzuFtsIndexes, generateKuzuFtsDropIndexes, generateKuzuVectorIndexes, NODE_SCHEMAS, FTS_INDEX_CONFIG, VECTOR_INDEX_CONFIG } from '../../utils/node-schema.js';

/**
 * Custom error for Kuzu database lock conflicts
 */
export class KuzuLockError extends Error {
  constructor(dbPath: string) {
    super(
      `Kuzu database is locked by another process.\n` +
      `Database path: ${dbPath}\n\n` +
      `This usually means the ragforge daemon is running.\n` +
      `Solutions:\n` +
      `  1. Use the daemon: ragforge daemon start (recommended)\n` +
      `  2. Stop the daemon: ragforge daemon stop\n` +
      `  3. Kill any ragforge processes: pkill -f ragforge\n\n` +
      `Kuzu is an embedded database that only supports single-process access.`
    );
    this.name = 'KuzuLockError';
  }
}

/**
 * Check if Kuzu database is locked by another process
 */
function isKuzuLocked(dbPath: string): boolean {
  if (dbPath === ':memory:') return false;

  // Kuzu creates a lock file in the database directory
  // The lock file is typically named ".lock" or similar
  const lockPatterns = [
    path.join(dbPath, '.lock'),
    path.join(dbPath, 'lock'),
    path.join(dbPath, 'LOCK'),
  ];

  for (const lockFile of lockPatterns) {
    if (fs.existsSync(lockFile)) {
      // Lock file exists, try to determine if it's stale
      // For now, just report that it's locked
      return true;
    }
  }

  return false;
}

/**
 * Get valid property names for a node type from the schema
 */
function getValidProperties(nodeType: string): Set<string> {
  const schema = NODE_SCHEMAS[nodeType];
  if (!schema) return new Set(); // Unknown type - allow all (will fail at DB level)

  const props = new Set<string>();
  for (const key of Object.keys(schema.required || {})) {
    props.add(key);
  }
  for (const key of Object.keys(schema.optional || {})) {
    props.add(key);
  }
  return props;
}

// Kuzu types (kuzu package doesn't export proper TypeScript types)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KuzuDatabase = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KuzuConnection = any;

/**
 * Result interface compatible with Neo4j QueryResult
 */
export interface KuzuQueryResult {
  records: KuzuRecord[];
  summary: {
    counters: {
      nodesCreated: () => number;
      nodesDeleted: () => number;
      relationshipsCreated: () => number;
      relationshipsDeleted: () => number;
      propertiesSet: () => number;
    };
    plan?: any;
  };
}

export interface KuzuRecord {
  get(key: string): any;
  toObject(): Record<string, any>;
  keys: string[];
}

/**
 * Converts named Cypher parameters to positional parameters for Kuzu.
 *
 * @example
 * // Input: "MATCH (n) WHERE n.uuid = $uuid AND n.name = $name", { uuid: 'abc', name: 'foo' }
 * // Output: { query: "MATCH (n) WHERE n.uuid = $1 AND n.name = $2", params: { '1': 'abc', '2': 'foo' } }
 */
function convertNamedToPositional(
  cypher: string,
  params: Record<string, any> = {}
): { query: string; params: Record<string, any> } {
  // Find all $paramName patterns (not followed by a digit, to avoid matching $1, $2, etc.)
  const paramRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const paramOrder: string[] = [];
  const seen = new Set<string>();

  // Collect unique param names in order of appearance
  let match;
  while ((match = paramRegex.exec(cypher)) !== null) {
    const paramName = match[1];
    if (!seen.has(paramName)) {
      seen.add(paramName);
      paramOrder.push(paramName);
    }
  }

  // Build positional params
  const positionalParams: Record<string, any> = {};
  for (let i = 0; i < paramOrder.length; i++) {
    const paramName = paramOrder[i];
    positionalParams[String(i + 1)] = params[paramName];
  }

  // Replace named params with positional in query
  let convertedQuery = cypher;
  for (let i = 0; i < paramOrder.length; i++) {
    const paramName = paramOrder[i];
    // Replace all occurrences of $paramName with $N
    const regex = new RegExp(`\\$${paramName}(?![a-zA-Z0-9_])`, 'g');
    convertedQuery = convertedQuery.replace(regex, `$${i + 1}`);
  }

  return { query: convertedQuery, params: positionalParams };
}

/**
 * Wraps a value to simulate Neo4j Integer interface if it's a bigint
 * Note: Only wrap bigints, not regular numbers (floats like score should remain as-is)
 */
function wrapValue(value: any): any {
  // Only wrap bigints to simulate Neo4j Integer interface
  // Regular numbers (including floats like score) should remain as-is
  if (typeof value === 'bigint') {
    return {
      toNumber: () => Number(value),
      toInt: () => Number(value),
      toBigInt: () => BigInt(value),
      valueOf: () => Number(value),
      toString: () => String(value),
    };
  }
  return value;
}

/**
 * Wraps a Kuzu result row to match Neo4j Record interface
 */
function wrapRecord(row: Record<string, any>): KuzuRecord {
  const keys = Object.keys(row);
  return {
    keys,
    get(key: string): any {
      // Handle both "n.name" style and "name" style keys
      let value: any;
      if (key in row) {
        value = row[key];
      } else {
        // Try to find a key that ends with the requested key
        for (const k of keys) {
          if (k.endsWith(`.${key}`) || k === key) {
            value = row[k];
            break;
          }
        }
      }
      return wrapValue(value);
    },
    toObject(): Record<string, any> {
      return row;
    }
  };
}

// Metadata keys for index state
const METADATA_FTS_DIRTY = 'indexes.fts.dirty';
const METADATA_VECTOR_DIRTY = 'indexes.vector.dirty';

export class KuzuClient implements DatabaseClient {
  private db: KuzuDatabase | null = null;
  private conn: KuzuConnection | null = null;
  private isInitialized = false;
  private dbPath: string;
  private initError: Error | null = null;
  private _ftsRebuildInProgress = false;
  private _vectorRebuildInProgress = false;

  constructor(config: Neo4jConfig | { path?: string }) {
    // Use path from config, or default to in-memory
    this.dbPath = (config as any).path || ':memory:';

    try {
      this.db = new kuzu.Database(this.dbPath);
      this.conn = new kuzu.Connection(this.db);
    } catch (e: any) {
      // Check if this is a lock error
      if (e.message?.includes('Could not set lock on file') ||
          e.message?.includes('lock') ||
          e.message?.includes('concurrency')) {
        this.initError = new KuzuLockError(this.dbPath);
      } else {
        this.initError = e;
      }
      // Don't throw here - defer to first operation so we can provide better context
    }
  }

  /**
   * Ensure the database connection is valid, throwing stored error if initialization failed
   */
  private ensureConnection(): void {
    if (this.initError) {
      throw this.initError;
    }
    if (!this.db || !this.conn) {
      throw new Error('Kuzu database connection not established');
    }
  }

  /**
   * Initialize the database (create schema if needed)
   */
  async init(): Promise<void> {
    // Check connection before doing anything
    this.ensureConnection();

    if (this.isInitialized) return;

    // Always run schema creation - it uses IF NOT EXISTS so it's idempotent
    // This ensures any missing tables (from partial failures) are created
    await this.createSchema();
    this.isInitialized = true;
  }

  /**
   * Create the database schema using the centralized schema definition
   */
  private async createSchema(): Promise<void> {
    // Load extensions first (fts is pre-installed in 0.11.3 but needs to be loaded)
    await this.loadExtensions();

    const statements = generateKuzuSchema();
    console.log(`[Kuzu] Creating schema with ${statements.length} statements...`);

    for (const statement of statements) {
      try {
        await this.conn.query(statement);
        // Log relationship table creations
        if (statement.includes('REL TABLE')) {
          console.log(`[Kuzu] Created: ${statement.substring(0, 80)}...`);
        }
      } catch (e: any) {
        // Ignore "already exists" errors and Kuzu's internal unordered_map::at errors
        // (which happen when using IF NOT EXISTS on existing tables)
        const msg = e.message || '';
        if (!msg.includes('already exists') && !msg.includes('unordered_map::at')) {
          console.warn('[Kuzu] Schema creation warning:', msg, '- Statement:', statement.substring(0, 100));
        }
      }
    }
    console.log('[Kuzu] Schema creation complete');

    // Create FTS indexes (idempotent - will skip if they exist)
    await this.createFtsIndexes();

    // Create Vector indexes (idempotent - will skip if they exist)
    await this.createVectorIndexes();
  }

  /**
   * Load Kuzu extensions (fts, vector)
   * Extensions are pre-installed in 0.11.3 but need to be loaded per connection
   */
  private async loadExtensions(): Promise<void> {
    const extensions = ['fts', 'vector'];

    for (const ext of extensions) {
      try {
        // INSTALL is idempotent in 0.11.3 (pre-installed)
        await this.conn.query(`INSTALL ${ext}`);
        await this.conn.query(`LOAD EXTENSION ${ext}`);
        console.log(`[Kuzu] Loaded extension: ${ext}`);
      } catch (e: any) {
        // Extension might already be loaded or not available
        const msg = e.message || '';
        if (!msg.includes('already loaded') && !msg.includes('already installed')) {
          console.debug(`[Kuzu] Extension ${ext} warning:`, msg.substring(0, 80));
        }
      }
    }
  }

  /**
   * Create FTS indexes for all configured node types.
   * Indexes are immutable - must be dropped and recreated after data changes.
   */
  private async createFtsIndexes(): Promise<void> {
    const statements = generateKuzuFtsIndexes();
    if (statements.length === 0) return;

    console.log(`[Kuzu] Creating ${statements.length} FTS indexes...`);

    for (const statement of statements) {
      try {
        await this.conn.query(statement);
        // Extract index name for logging
        const match = statement.match(/CREATE_FTS_INDEX\('(\w+)'/);
        if (match) {
          console.log(`[Kuzu] Created FTS index: ${match[1].toLowerCase()}_fts`);
        }
      } catch (e: any) {
        const msg = e.message || '';
        // Ignore "already exists" errors
        if (!msg.includes('already exists') && !msg.includes('Index with name')) {
          console.debug(`[Kuzu] FTS index warning:`, msg.substring(0, 100));
        }
      }
    }
  }

  /**
   * Create Vector indexes for all configured node types.
   * Indexes are immutable - must be dropped and recreated after data changes.
   */
  private async createVectorIndexes(): Promise<void> {
    const statements = generateKuzuVectorIndexes();
    if (statements.length === 0) return;

    console.log(`[Kuzu] Creating ${statements.length} Vector indexes...`);

    for (const statement of statements) {
      try {
        await this.conn.query(statement);
        const match = statement.match(/CREATE_VECTOR_INDEX\('(\w+)',\s*'(\w+)'/);
        if (match) {
          console.log(`[Kuzu] Created Vector index: ${match[2]}`);
        }
      } catch (e: any) {
        const msg = e.message || '';
        if (!msg.includes('already exists') && !msg.includes('Index with name')) {
          console.debug(`[Kuzu] Vector index warning:`, msg.substring(0, 100));
        }
      }
    }
  }

  /**
   * Rebuild FTS indexes after data ingestion.
   * Drops existing indexes and recreates them.
   */
  async rebuildFtsIndexes(): Promise<void> {
    console.log('[Kuzu] Rebuilding FTS indexes...');

    // Drop existing indexes
    const dropStatements = generateKuzuFtsDropIndexes();
    for (const statement of dropStatements) {
      try {
        await this.conn.query(statement);
      } catch (e: any) {
        // Ignore errors if index doesn't exist
      }
    }

    // Recreate indexes
    await this.createFtsIndexes();
    console.log('[Kuzu] FTS indexes rebuilt');
  }

  /**
   * Rebuild Vector indexes after data ingestion.
   */
  async rebuildVectorIndexes(): Promise<void> {
    console.log('[Kuzu] Rebuilding Vector indexes...');

    // Drop existing indexes
    for (const [label, properties] of Object.entries(VECTOR_INDEX_CONFIG)) {
      for (const prop of properties) {
        const indexName = `${label.toLowerCase()}_${prop}_vec`;
        try {
          await this.conn.query(`CALL DROP_VECTOR_INDEX('${label}', '${indexName}')`);
        } catch {
          // Ignore if index doesn't exist
        }
      }
    }

    // Recreate indexes
    await this.createVectorIndexes();
    console.log('[Kuzu] Vector indexes rebuilt');
  }

  /**
   * Check if FTS index exists for a given table
   */
  async hasFtsIndex(tableName: string): Promise<boolean> {
    try {
      const result = await this.conn.query('CALL SHOW_INDEXES() RETURN *');
      const rows = await result.getAll();
      const indexName = `${tableName.toLowerCase()}_fts`;
      return rows.some((row: any) => row['index name'] === indexName || row.index_name === indexName);
    } catch {
      return false;
    }
  }

  // ============================================================
  // Metadata helpers (for persistent index state)
  // ============================================================

  /**
   * Get a metadata value from the database
   */
  private async getMetadataBool(key: string): Promise<boolean> {
    try {
      const result = await this.conn.query(
        `MATCH (m:RagForgeMetadata {key: $1}) RETURN m.boolValue AS value`,
        { '1': key }
      );
      const rows = await result.getAll();
      if (rows.length > 0 && rows[0].value !== null) {
        return rows[0].value === true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Set a metadata boolean value in the database
   */
  private async setMetadataBool(key: string, value: boolean): Promise<void> {
    const uuid = `metadata:${key}`;
    const now = new Date().toISOString();
    try {
      await this.conn.query(
        `MERGE (m:RagForgeMetadata {uuid: $1})
         SET m.key = $2, m.boolValue = $3, m.updatedAt = $4`,
        { '1': uuid, '2': key, '3': value, '4': now }
      );
    } catch (e: any) {
      console.debug(`[Kuzu] Failed to set metadata ${key}:`, e.message?.substring(0, 50));
    }
  }

  /**
   * Mark FTS indexes as dirty (need rebuild before next search).
   * Call this after any data ingestion operation.
   * Persisted to database so survives restarts.
   */
  markFtsIndexesDirty(): void {
    // Fire and forget - async write to DB
    this.setMetadataBool(METADATA_FTS_DIRTY, true).catch(() => {});
  }

  /**
   * Mark Vector indexes as dirty (need rebuild before next search).
   */
  markVectorIndexesDirty(): void {
    this.setMetadataBool(METADATA_VECTOR_DIRTY, true).catch(() => {});
  }

  /**
   * Mark all indexes (FTS + Vector) as dirty.
   * Convenience method for after data ingestion.
   */
  markIndexesDirty(): void {
    this.markFtsIndexesDirty();
    this.markVectorIndexesDirty();
  }

  /**
   * Ensure FTS indexes are fresh before searching.
   * Rebuilds indexes if they were marked as dirty.
   * Uses a lock to prevent concurrent rebuilds.
   */
  async ensureFtsIndexesFresh(): Promise<void> {
    // Check database for dirty flag
    const isDirty = await this.getMetadataBool(METADATA_FTS_DIRTY);
    if (!isDirty) return;

    if (this._ftsRebuildInProgress) {
      // Wait for ongoing rebuild to complete
      while (this._ftsRebuildInProgress) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this._ftsRebuildInProgress = true;
    try {
      await this.rebuildFtsIndexes();
      await this.setMetadataBool(METADATA_FTS_DIRTY, false);
    } finally {
      this._ftsRebuildInProgress = false;
    }
  }

  /**
   * Ensure Vector indexes are fresh before searching.
   * Rebuilds indexes if they were marked as dirty.
   */
  async ensureVectorIndexesFresh(): Promise<void> {
    const isDirty = await this.getMetadataBool(METADATA_VECTOR_DIRTY);
    if (!isDirty) return;

    if (this._vectorRebuildInProgress) {
      while (this._vectorRebuildInProgress) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this._vectorRebuildInProgress = true;
    try {
      await this.rebuildVectorIndexes();
      await this.setMetadataBool(METADATA_VECTOR_DIRTY, false);
    } finally {
      this._vectorRebuildInProgress = false;
    }
  }

  /**
   * Handle batch embedding updates (UNWIND $batch AS item MATCH...SET)
   * Converts them to individual UPDATE statements
   */
  private async handleBatchEmbeddingUpdate(
    query: string,
    params: Record<string, any>
  ): Promise<KuzuQueryResult | null> {
    // Detect UNWIND $batch AS item pattern with MATCH...SET
    const unwindMatch = query.match(/UNWIND\s+\$(\w+)\s+AS\s+item/i);
    if (!unwindMatch) {
      return null;
    }

    // Check for MATCH pattern with uuid
    const matchMatch = query.match(/MATCH\s+\(n(?::(\w+))?\s+\{uuid:\s*item\.uuid\}\)/i);
    if (!matchMatch) {
      return null;
    }

    const label = matchMatch[1]; // Optional label
    const batchParam = unwindMatch[1];
    const batch = params[batchParam] as Array<Record<string, any>>;

    if (!batch || !Array.isArray(batch)) {
      return null;
    }

    // Extract SET clause properties
    // Pattern: SET n.prop1 = item.val1, n.prop2 = item.val2, ...
    const setMatch = query.match(/SET\s+(.+)$/is);
    if (!setMatch) {
      return null;
    }

    // Parse SET clause to extract property mappings
    // e.g., "n.embedding_name = item.embedding, n.embedding_name_hash = item.hash"
    const setClause = setMatch[1].trim();
    const propMappings: Array<{ nodeProp: string; itemProp: string }> = [];

    // Split by comma and parse each assignment
    const assignments = setClause.split(',').map(s => s.trim());
    for (const assignment of assignments) {
      const propMatch = assignment.match(/n\.(\w+)\s*=\s*item\.(\w+)/);
      if (propMatch) {
        propMappings.push({ nodeProp: propMatch[1], itemProp: propMatch[2] });
      }
    }

    if (propMappings.length === 0) {
      return null;
    }

    let totalCount = 0;

    for (const item of batch) {
      if (!item.uuid) continue;

      // Build SET clause with positional params
      const setParts: string[] = [];
      const paramObj: Record<string, any> = { '1': item.uuid };
      let paramIdx = 2;

      for (const { nodeProp, itemProp } of propMappings) {
        const value = item[itemProp];
        if (value === undefined) continue;

        // Handle array values (embeddings)
        if (Array.isArray(value)) {
          // Kuzu needs arrays as literals
          setParts.push(`n.${nodeProp} = $${paramIdx}`);
          paramObj[String(paramIdx)] = value;
          paramIdx++;
        } else {
          setParts.push(`n.${nodeProp} = $${paramIdx}`);
          paramObj[String(paramIdx)] = value;
          paramIdx++;
        }
      }

      if (setParts.length === 0) continue;

      const updateQuery = label
        ? `MATCH (n:${label} {uuid: $1}) SET ${setParts.join(', ')}`
        : `MATCH (n {uuid: $1}) SET ${setParts.join(', ')}`;

      try {
        const ps = await this.conn.prepare(updateQuery);
        await this.conn.execute(ps, paramObj);
        totalCount++;
      } catch (e: any) {
        // Silently skip failures
        // console.warn(`[Kuzu] Embedding update failed:`, e.message?.substring(0, 80));
      }
    }

    return {
      records: [wrapRecord({ count: totalCount })],
      summary: {
        counters: {
          nodesCreated: () => 0,
          nodesDeleted: () => 0,
          relationshipsCreated: () => 0,
          relationshipsDeleted: () => 0,
          propertiesSet: () => totalCount * propMappings.length,
        },
      },
    };
  }

  /**
   * Handle Neo4j-style batch UNWIND + MERGE queries that Kuzu doesn't support
   * Converts them to individual MERGE statements
   */
  private async handleBatchMerge(
    query: string,
    params: Record<string, any>
  ): Promise<KuzuQueryResult | null> {
    // First check if this is a relationship batch
    const relResult = await this.handleBatchRelationshipMerge(query, params);
    if (relResult) return relResult;

    // Check if this is an embedding batch update (UNWIND $batch AS item MATCH...SET)
    const embedResult = await this.handleBatchEmbeddingUpdate(query, params);
    if (embedResult) return embedResult;

    // Detect UNWIND $nodes AS nodeData pattern with += operator
    const unwindMatch = query.match(/UNWIND\s+\$(\w+)\s+AS\s+nodeData/i);
    if (!unwindMatch || !query.includes('+=')) {
      return null; // Not a batch merge query
    }

    const nodesParam = unwindMatch[1];
    const nodes = params[nodesParam] as Array<{ uuid: string; props: Record<string, any> }>;
    if (!nodes || !Array.isArray(nodes)) {
      return null;
    }

    // Extract label and unique field from MERGE clause
    // Handle both: {uuid: nodeData.uuid} and {projectId: nodeData.props.projectId}
    const mergeMatch = query.match(/MERGE\s+\(n:(\w+)\s+\{(\w+):\s*nodeData\.(?:props\.)?(\w+)\}/i);
    if (!mergeMatch) {
      return null;
    }

    const label = mergeMatch[1];
    const uniqueField = mergeMatch[2];
    const uniqueProp = mergeMatch[3];

    // Get valid properties for this node type
    const validProps = getValidProperties(label);

    let totalCount = 0;
    const timestamp = new Date().toISOString();

    for (const node of nodes) {
      // Extract unique value - could be node.uuid, node.props.uuid, or node.props[uniqueProp]
      let uniqueValue = (node as any)[uniqueProp];
      if (uniqueValue === undefined && node.props) {
        uniqueValue = (node.props as any)[uniqueProp];
      }
      if (uniqueValue === undefined) {
        uniqueValue = node.uuid || (node.props as any)?.uuid;
      }
      if (!uniqueValue) {
        console.warn(`[Kuzu] Skipping node without unique value for ${uniqueProp}`);
        continue;
      }

      // Get the node's uuid (required for primary key)
      const nodeUuid = node.uuid || (node.props as any)?.uuid;
      if (!nodeUuid) {
        console.warn(`[Kuzu] Skipping node without uuid for ${label}`);
        continue;
      }

      const props = { ...node.props };

      // Add state management properties
      if (query.includes("'parsed'")) {
        props._state = 'parsed';
        props._parsedAt = timestamp;
      } else if (query.includes("'linked'")) {
        props._state = 'linked';
        props._stateChangedAt = timestamp;
      }
      props._updatedAt = timestamp;

      // Build parameterized SET clause for all properties
      // Exclude uuid (primary key) - Kuzu doesn't allow setting primary keys in SET
      const setParts: string[] = [];
      let paramCount = 0;
      const queryParams: any[] = [];

      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null) continue;
        if (k === 'uuid') continue; // Skip primary key
        // Skip properties not in schema (Kuzu requires all properties to be defined)
        if (validProps.size > 0 && !validProps.has(k)) continue;

        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          setParts.push(`n.${k} = $${paramCount + 2}`); // +2 because $1 is uuid
          queryParams.push(v);
          paramCount++;
        } else if (Array.isArray(v)) {
          // Skip arrays for now - Kuzu list handling is complex
          continue;
        }
      }

      const setClause = setParts.join(', ');

      // Build param object for Kuzu - always use uuid as primary key
      const paramObj: Record<string, any> = { '1': nodeUuid };
      queryParams.forEach((v, i) => {
        paramObj[String(i + 2)] = v;
      });

      // Always MERGE on uuid (primary key) regardless of what field the query used
      const mergeQuery = setClause
        ? `MERGE (n:${label} {uuid: $1}) SET ${setClause}`
        : `MERGE (n:${label} {uuid: $1})`;

      try {
        const ps = await this.conn.prepare(mergeQuery);
        await this.conn.execute(ps, paramObj);
        totalCount++;
      } catch (e: any) {
        console.warn(`[Kuzu] Batch merge item failed:`, e.message?.substring(0, 100));
      }
    }

    // Return a simulated result
    return {
      records: [wrapRecord({ count: totalCount })],
      summary: {
        counters: {
          nodesCreated: () => totalCount,
          nodesDeleted: () => 0,
          relationshipsCreated: () => 0,
          relationshipsDeleted: () => 0,
          propertiesSet: () => 0,
        },
      },
    };
  }

  /**
   * Handle Neo4j-style batch relationship UNWIND + MERGE queries
   * Converts them to individual relationship MERGE statements
   */
  private async handleBatchRelationshipMerge(
    query: string,
    params: Record<string, any>
  ): Promise<KuzuQueryResult | null> {
    // Detect UNWIND $param AS relData pattern for relationships
    const unwindMatch = query.match(/UNWIND\s+\$(\w+)\s+AS\s+relData/i);
    if (!unwindMatch) {
      return null; // Not a relationship batch query
    }

    // Check if this is a relationship query (has MATCH...MERGE pattern with relationship)
    // Use multiline-friendly pattern with [\s\S] instead of \s for line breaks
    const relMatch = query.match(
      /MATCH\s+\(from:(\w+)\s+\{uuid:\s*relData\.from\}\)[\s\S]*?MATCH\s+\(to:(\w+)\s+\{uuid:\s*relData\.to\}\)[\s\S]*?MERGE\s+\(from\)-\[r:(\w+)\]->\(to\)/i
    );
    if (!relMatch) {
      return null;
    }

    const fromLabel = relMatch[1];
    const toLabel = relMatch[2];
    const relType = relMatch[3];

    const relsParam = unwindMatch[1];
    const rels = params[relsParam] as Array<{ from: string; to: string; props?: Record<string, any> }>;
    if (!rels || !Array.isArray(rels)) {
      return null;
    }

    let totalCount = 0;

    for (const rel of rels) {
      if (!rel.from || !rel.to) {
        console.warn(`[Kuzu] Skipping relationship without from/to`);
        continue;
      }

      // Build simple MERGE query for relationship
      // Kuzu doesn't support SET r += props, so we handle props individually
      const mergeQuery = `
        MATCH (from:${fromLabel} {uuid: $1})
        MATCH (to:${toLabel} {uuid: $2})
        MERGE (from)-[r:${relType}]->(to)
      `;

      const paramObj: Record<string, any> = {
        '1': rel.from,
        '2': rel.to,
      };

      try {
        const ps = await this.conn.prepare(mergeQuery);
        await this.conn.execute(ps, paramObj);
        totalCount++;
      } catch (e: any) {
        // Silently skip failures - often due to missing nodes
        // console.warn(`[Kuzu] Relationship merge failed:`, e.message?.substring(0, 80));
      }
    }

    return {
      records: [wrapRecord({ count: totalCount })],
      summary: {
        counters: {
          nodesCreated: () => 0,
          nodesDeleted: () => 0,
          relationshipsCreated: () => totalCount,
          relationshipsDeleted: () => 0,
          propertiesSet: () => 0,
        },
      },
    };
  }

  /**
   * Empty counters helper
   */
  private emptyCounters() {
    return {
      counters: {
        nodesCreated: () => 0,
        nodesDeleted: () => 0,
        relationshipsCreated: () => 0,
        relationshipsDeleted: () => 0,
        propertiesSet: () => 0,
      },
    };
  }

  /**
   * Execute a Cypher query
   */
  async run(
    cypher: string | CypherQuery,
    params?: Record<string, any>
  ): Promise<KuzuQueryResult> {
    await this.init();

    const query = typeof cypher === 'string' ? cypher : cypher.query;
    const queryParams = typeof cypher === 'string' ? (params || {}) : cypher.params;

    // Note: Full-text and vector search are handled by SearchProvider (see search-provider.ts)
    // which generates native Kuzu queries. No fallback needed here.

    // Try to handle batch merge queries specially
    const batchResult = await this.handleBatchMerge(query, queryParams);
    if (batchResult) {
      return batchResult;
    }

    // Replace datetime() with current timestamp string
    let processedQuery = query.replace(/datetime\(\)/g, `'${new Date().toISOString()}'`);

    // Convert named parameters to positional
    const { query: convertedQuery, params: positionalParams } =
      convertNamedToPositional(processedQuery, queryParams);

    // Prepare and execute
    try {
      const ps = await this.conn.prepare(convertedQuery);
      const result = await this.conn.execute(ps, positionalParams);
      const rows = await result.getAll();
      return {
        records: rows.map(wrapRecord),
        summary: {
          counters: {
            nodesCreated: () => 0,
            nodesDeleted: () => 0,
            relationshipsCreated: () => 0,
            relationshipsDeleted: () => 0,
            propertiesSet: () => 0,
          },
          plan: undefined
        }
      };
    } catch (e: any) {
      // Check if this is a lock error and convert to helpful message
      if (e.message?.includes('Could not set lock on file') ||
          e.message?.includes('lock') && e.message?.includes('concurrency')) {
        throw new KuzuLockError(this.dbPath);
      }
      // Log query for debugging
      console.error('[Kuzu] Query failed:', convertedQuery.substring(0, 200));
      console.error('[Kuzu] Error:', e.message);
      throw e;
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(
    fn: (tx: KuzuTransaction) => Promise<T>
  ): Promise<T> {
    await this.init();
    // Kuzu auto-commits, but we can wrap in begin/commit
    try {
      await this.conn.query('BEGIN TRANSACTION');
      const tx = new KuzuTransaction(this);
      const result = await fn(tx);
      await this.conn.query('COMMIT');
      return result;
    } catch (e) {
      await this.conn.query('ROLLBACK').catch(() => {});
      throw e;
    }
  }

  /**
   * Execute a read-only transaction
   */
  async readTransaction<T>(
    fn: (tx: KuzuTransaction) => Promise<T>
  ): Promise<T> {
    await this.init();
    // For read-only, just execute directly
    const tx = new KuzuTransaction(this);
    return fn(tx);
  }

  /**
   * Explain query execution plan
   */
  async explain(cypher: string, params: Record<string, any> = {}): Promise<QueryPlan> {
    const { query: convertedQuery } = convertNamedToPositional(cypher, params);

    try {
      const result = await this.conn.query(`EXPLAIN ${convertedQuery}`);
      const rows = await result.getAll();

      return {
        cypher,
        params,
        estimatedRows: undefined,
        indexesUsed: [],
        executionSteps: rows.map((r: unknown) => JSON.stringify(r))
      };
    } catch {
      return {
        cypher,
        params,
        estimatedRows: undefined,
        indexesUsed: [],
        executionSteps: []
      };
    }
  }

  /**
   * Vector similarity search
   * Note: Kuzu uses different syntax for vector search
   */
  async vectorSearch(
    indexName: string,
    embedding: number[],
    topK: number = 10
  ): Promise<VectorSearchResult[]> {
    // Kuzu vector search syntax is different
    // For now, we'll do a manual cosine similarity calculation
    const tableName = indexName.replace('idx_', '').replace('_embedding', '');

    const cypher = `
      MATCH (n:${tableName})
      WHERE n.embedding IS NOT NULL
      RETURN n, n.embedding AS emb
    `;

    const result = await this.run(cypher);

    // Calculate cosine similarity in JS
    const withScores = result.records.map(record => {
      const nodeEmb = record.get('emb') as number[];
      const score = cosineSimilarity(embedding, nodeEmb);
      return {
        node: record.get('n'),
        score
      };
    });

    // Sort by score and take topK
    return withScores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Full-text search
   * Note: Kuzu may have different FTS capabilities
   */
  async fullTextSearch(
    indexName: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<any[]> {
    // For now, use CONTAINS for basic text search
    const tableName = indexName.replace('idx_', '').replace('_fulltext', '');
    const limit = options.limit || 10;

    const cypher = `
      MATCH (n:${tableName})
      WHERE n.name CONTAINS $query OR n.source CONTAINS $query
      RETURN n, 1.0 AS score
      LIMIT $limit
    `;

    const result = await this.run(cypher, { query, limit });

    return result.records.map(record => ({
      node: record.get('n'),
      score: record.get('score')
    }));
  }

  /**
   * Check if connection is healthy
   */
  async verifyConnectivity(): Promise<boolean> {
    try {
      await this.conn.query('RETURN 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying Kuzu connection
   */
  getConnection(): KuzuConnection {
    return this.conn;
  }

  /**
   * Get a mock "driver" for compatibility with code that expects Neo4j driver
   * Returns an object with session() method that wraps KuzuClient
   */
  getDriver(): { session: () => DatabaseSession } {
    const client = this;
    return {
      session: () => new KuzuSession(client),
    };
  }

  /**
   * Get the underlying Kuzu database
   */
  getDatabase(): KuzuDatabase {
    return this.db;
  }

  /**
   * Get a session for manual session management
   * Returns a wrapper that mimics Neo4j session behavior
   */
  getSession(): DatabaseSession {
    return new KuzuSession(this);
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    // Kuzu doesn't have explicit close, but we can null out references
    // The garbage collector will clean up
  }
}

/**
 * Transaction wrapper for Kuzu
 */
class KuzuTransaction {
  constructor(private client: KuzuClient) {}

  async run(cypher: string, params?: Record<string, any>): Promise<KuzuQueryResult> {
    return this.client.run(cypher, params);
  }
}

/**
 * Session wrapper for Kuzu (mimics Neo4j session interface)
 */
class KuzuSession implements DatabaseSession {
  constructor(private client: KuzuClient) {}

  async run(cypher: string, params?: Record<string, any>): Promise<DatabaseQueryResult> {
    return this.client.run(cypher, params);
  }

  async close(): Promise<void> {
    // Kuzu doesn't need session cleanup
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Create a Kuzu client (factory function matching Neo4j pattern)
 */
export function createKuzuClient(config: { path?: string } = {}): KuzuClient {
  return new KuzuClient(config);
}
