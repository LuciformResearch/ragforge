import { createClient } from '@ragforge/runtime';
import type { RuntimeConfig } from '@ragforge/runtime';
import { ScopeQuery } from './queries/scope.js';
import { FileQuery } from './queries/file.js';
import { ExternalLibraryQuery } from './queries/externallibrary.js';
import { DirectoryQuery } from './queries/directory.js';

/**
 * lr-coderag RAG Client
 * Generated RAG framework for code
 */
export class RagClient {
  private runtime: ReturnType<typeof createClient>;
  private neo4jClient: any;

  constructor(config: RuntimeConfig) {
    this.runtime = createClient(config);
    this.neo4jClient = this.runtime._getClient();
  }

  /**
   * Query Scope entities
   * Scope entity (516 nodes)
   */
  scope(): ScopeQuery {
    return new ScopeQuery(this.neo4jClient, 'Scope');
  }

  /**
   * Query File entities
   * File entity (49 nodes)
   */
  file(): FileQuery {
    return new FileQuery(this.neo4jClient, 'File');
  }

  /**
   * Query ExternalLibrary entities
   * ExternalLibrary entity (24 nodes)
   */
  externallibrary(): ExternalLibraryQuery {
    return new ExternalLibraryQuery(this.neo4jClient, 'ExternalLibrary');
  }

  /**
   * Query Directory entities
   * Directory entity (15 nodes)
   */
  directory(): DirectoryQuery {
    return new DirectoryQuery(this.neo4jClient, 'Directory');
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.runtime.close();
  }
}

/**
 * Create lr-coderag client
 */
export function createRagClient(config: RuntimeConfig): RagClient {
  return new RagClient(config);
}