/**
 * Database Client Interface
 *
 * Abstract interface for graph database clients.
 * Allows switching between Neo4j and Kuzu (or other backends).
 */

import type { CypherQuery, QueryPlan, VectorSearchResult } from '../types/index.js';

/**
 * Query result interface (compatible with Neo4j QueryResult)
 */
export interface DatabaseQueryResult {
  records: DatabaseRecord[];
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

/**
 * Record interface (compatible with Neo4j Record)
 */
export interface DatabaseRecord {
  get(key: string): any;
  toObject(): Record<string, any>;
  keys: string[];
}

/**
 * Session interface for transaction-like operations
 */
export interface DatabaseSession {
  run(cypher: string, params?: Record<string, any>): Promise<DatabaseQueryResult>;
  close(): Promise<void>;
}

/**
 * Transaction interface
 */
export interface DatabaseTransaction {
  run(cypher: string, params?: Record<string, any>): Promise<DatabaseQueryResult>;
}

/**
 * Abstract database client interface
 */
export interface DatabaseClient {
  /**
   * Execute a Cypher query
   */
  run(cypher: string | CypherQuery, params?: Record<string, any>): Promise<DatabaseQueryResult>;

  /**
   * Execute multiple queries in a write transaction
   */
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;

  /**
   * Execute a read-only transaction
   */
  readTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;

  /**
   * Get a session for manual session management
   * (Used by ingestion code that needs direct session access)
   */
  getSession(): DatabaseSession;

  /**
   * Explain query execution plan
   */
  explain(cypher: string, params?: Record<string, any>): Promise<QueryPlan>;

  /**
   * Vector similarity search
   */
  vectorSearch(
    indexName: string,
    embedding: number[],
    topK?: number
  ): Promise<VectorSearchResult[]>;

  /**
   * Full-text search
   */
  fullTextSearch(
    indexName: string,
    query: string,
    options?: { limit?: number }
  ): Promise<any[]>;

  /**
   * Verify database connectivity
   */
  verifyConnectivity(): Promise<boolean>;

  /**
   * Close the connection
   */
  close(): Promise<void>;
}

/**
 * Database provider type
 */
export type DatabaseProvider = 'neo4j' | 'kuzu';
