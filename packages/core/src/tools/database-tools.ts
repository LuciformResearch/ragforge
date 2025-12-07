/**
 * Database Tools
 *
 * Tools for the agent to interact with external databases:
 * - query_database: Execute SQL/queries on connected databases
 * - describe_table: Get detailed info about a table
 * - list_tables: List all tables in a database
 *
 * STATUS: Placeholder - Not yet implemented
 * TODO: Implement with pg, mysql2, better-sqlite3, mongodb drivers
 *
 * @since 2025-12-07
 */

import type { GeneratedToolDefinition } from './types/index.js';

// ============================================
// Types
// ============================================

export type DatabaseDriver = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'neo4j';

export interface DatabaseConnection {
  uri: string;
  driver: DatabaseDriver;
  name?: string;
}

export interface DatabaseToolsContext {
  /** Active database connections (by name or URI) */
  connections: Map<string, DatabaseConnection>;

  /** Default connection to use */
  defaultConnection?: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

// ============================================
// Connection Management (placeholder)
// ============================================

/**
 * Create a database tools context
 */
export function createDatabaseToolsContext(): DatabaseToolsContext {
  return {
    connections: new Map(),
    defaultConnection: undefined,
  };
}

/**
 * Add a database connection to the context
 */
export function addDatabaseConnection(
  ctx: DatabaseToolsContext,
  name: string,
  uri: string,
  driver?: DatabaseDriver
): void {
  ctx.connections.set(name, {
    uri,
    driver: driver || 'postgresql',
    name,
  });

  if (!ctx.defaultConnection) {
    ctx.defaultConnection = name;
  }
}

/**
 * Execute a query (placeholder)
 */
export async function executeQuery(
  _connection: DatabaseConnection,
  _query: string,
  _params?: unknown[]
): Promise<QueryResult> {
  throw new Error(
    'Database query execution not yet implemented. ' +
    'This feature is coming soon! For now, use the Neo4j graph database.'
  );
}

// ============================================
// Tool: query_database
// ============================================

export function generateQueryDatabaseTool(): GeneratedToolDefinition {
  return {
    name: 'query_database',
    description: `[NOT YET IMPLEMENTED] Execute a SQL query on a connected external database.

This tool will support:
- PostgreSQL, MySQL, SQLite, MongoDB
- Safe SELECT queries by default
- Parameterized queries to prevent SQL injection

Coming soon!`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute',
        },
        connection: {
          type: 'string',
          description: 'Connection name to use',
        },
      },
      required: ['query'],
    },
  };
}

export function generateQueryDatabaseHandler(_ctx: DatabaseToolsContext) {
  return async (_params: unknown): Promise<QueryResult> => {
    throw new Error(
      'query_database not yet implemented. ' +
      'This feature is coming soon! For now, use the Neo4j graph database tools.'
    );
  };
}

// ============================================
// Tool: describe_table
// ============================================

export function generateDescribeTableTool(): GeneratedToolDefinition {
  return {
    name: 'describe_table',
    description: `[NOT YET IMPLEMENTED] Get detailed information about a database table.

Coming soon!`,
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Table name to describe',
        },
        connection: {
          type: 'string',
          description: 'Connection name to use',
        },
      },
      required: ['table'],
    },
  };
}

export function generateDescribeTableHandler(_ctx: DatabaseToolsContext) {
  return async (_params: unknown): Promise<unknown> => {
    throw new Error(
      'describe_table not yet implemented. ' +
      'This feature is coming soon!'
    );
  };
}

// ============================================
// Tool: list_tables
// ============================================

export function generateListTablesTool(): GeneratedToolDefinition {
  return {
    name: 'list_tables',
    description: `[NOT YET IMPLEMENTED] List all tables in a connected database.

Coming soon!`,
    inputSchema: {
      type: 'object',
      properties: {
        connection: {
          type: 'string',
          description: 'Connection name to use',
        },
      },
      required: [],
    },
  };
}

export function generateListTablesHandler(_ctx: DatabaseToolsContext) {
  return async (_params: unknown): Promise<unknown> => {
    throw new Error(
      'list_tables not yet implemented. ' +
      'This feature is coming soon!'
    );
  };
}

// ============================================
// Export all tools
// ============================================

export function generateDatabaseTools(): GeneratedToolDefinition[] {
  return [
    generateQueryDatabaseTool(),
    generateDescribeTableTool(),
    generateListTablesTool(),
  ];
}

export function generateDatabaseToolHandlers(ctx: DatabaseToolsContext): Record<string, (params: unknown) => Promise<unknown>> {
  return {
    query_database: generateQueryDatabaseHandler(ctx),
    describe_table: generateDescribeTableHandler(ctx),
    list_tables: generateListTablesHandler(ctx),
  };
}
