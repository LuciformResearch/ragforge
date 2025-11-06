import { createClient } from '@ragforge/runtime';
import type { RuntimeConfig } from '@ragforge/runtime';
import { ScopeQuery } from './queries/scope.js';
import { FileQuery } from './queries/file.js';
import { ExternalLibraryQuery } from './queries/externallibrary.js';
import { DirectoryQuery } from './queries/directory.js';

/**
 * lr-coderag RAG Client
 * Generated RAG framework for code with dual embeddings
 */
export class RagClient {
  private runtime: ReturnType<typeof createClient>;
  private neo4jClient: any;

  // Enrichment configuration for Scope entity
  private scopeEnrichmentConfig = [
    { type: 'CONSUMES', direction: 'outgoing' as const, target: 'Scope', enrich: true, enrich_field: 'consumes' }
  ];

  // Entity context for LLM reranker (generated from YAML config)
  private scopeEntityContext = {
    type: 'Scope',
    displayName: 'code scopes',
    fields: [
      { name: 'signature', required: true },
      { name: 'type', required: true },
      { name: 'file', required: true },
      { name: 'uuid', required: false, maxLength: 200 },
      { name: 'name', required: false, maxLength: 200 }
    ],
    enrichments: [
      { fieldName: 'consumes', label: 'Uses', maxItems: 10 }
    ]
  };

  // Entity context for LLM reranker (generated from YAML config)
  private fileEntityContext = {
    type: 'File',
    displayName: 'files',
    fields: [
      { name: 'name', required: true }
    ],
    enrichments: [
      
    ]
  };

  // Entity context for LLM reranker (generated from YAML config)
  private externallibraryEntityContext = {
    type: 'ExternalLibrary',
    displayName: 'externallibraries',
    fields: [
      { name: 'name', required: true }
    ],
    enrichments: [
      
    ]
  };

  // Entity context for LLM reranker (generated from YAML config)
  private directoryEntityContext = {
    type: 'Directory',
    displayName: 'directories',
    fields: [
      
    ],
    enrichments: [
      
    ]
  };

  constructor(config: RuntimeConfig) {
    this.runtime = createClient(config);
    this.neo4jClient = this.runtime._getClient();
  }

  /**
   * Query Scope entities
   * Code scope with dual embeddings (signature + source)
   */
  scope(): ScopeQuery {
    return new ScopeQuery(this.neo4jClient, 'Scope', this.scopeEnrichmentConfig);
  }

  /**
   * Query File entities
   * Source code file
   */
  file(): FileQuery {
    return new FileQuery(this.neo4jClient, 'File');
  }

  /**
   * Query ExternalLibrary entities
   * External library dependency
   */
  externallibrary(): ExternalLibraryQuery {
    return new ExternalLibraryQuery(this.neo4jClient, 'ExternalLibrary');
  }

  /**
   * Query Directory entities
   * Directory in project
   */
  directory(): DirectoryQuery {
    return new DirectoryQuery(this.neo4jClient, 'Directory');
  }

  /**
   * Get entity context for LLM reranker
   * @param entityType - Entity type name (e.g., "Scope", "Product", "User")
   */
  getEntityContext(entityType: string) {
    switch (entityType) {
      case 'Scope':
        return this.scopeEntityContext;
      case 'File':
        return this.fileEntityContext;
      case 'ExternalLibrary':
        return this.externallibraryEntityContext;
      case 'Directory':
        return this.directoryEntityContext;
      default:
        return undefined;
    }
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