import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env with override to ensure local config takes precedence
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

import { createClient, VectorSearch, LLMReranker, GeminiAPIProvider } from '@luciformresearch/ragforge-runtime';
import type { RuntimeConfig } from '@luciformresearch/ragforge-runtime';
import { EMBEDDINGS_CONFIG } from './embeddings/load-config.ts';
import { ScopeQuery } from './queries/scope.js';

import { ScopeMutations } from './mutations/scope.js';

import { SCOPE_CONTEXT } from './entity-contexts.js';

/**
 * test-code-rag RAG Client
 * Test project for code RAG with source adapter
 */
export class RagClient {
  private runtime: ReturnType<typeof createClient>;
  private neo4jClient: any;

  // Entity context for LLM reranker (imported from entity-contexts.ts)
  private scopeEntityContext = SCOPE_CONTEXT;

  constructor(config: RuntimeConfig) {
    this.runtime = createClient(config);
    this.neo4jClient = this.runtime._getClient();
    const defaultModel = EMBEDDINGS_CONFIG.defaults?.model || 'gemini-embedding-001';
    VectorSearch.setDefaultConfig({
      model: defaultModel,
      dimension: EMBEDDINGS_CONFIG.defaults?.dimension
    });

    for (const entity of EMBEDDINGS_CONFIG.entities) {
      for (const pipeline of entity.pipelines) {
        VectorSearch.registerIndex(pipeline.name, {
          model: pipeline.model || defaultModel,
          dimension: pipeline.dimension ?? EMBEDDINGS_CONFIG.defaults?.dimension
        });
      }
    }

    // Configure default LLM provider for reranking
    if (process.env.GEMINI_API_KEY) {
      try {
        const defaultLLMProvider = GeminiAPIProvider.fromEnv('gemma-3n-e2b-it');
        LLMReranker.setDefaultProvider(defaultLLMProvider);
      } catch (error) {
        // Ignore if GEMINI_API_KEY is not set or invalid
      }
    }
  }

  /**
   * Get the underlying Neo4j client
   * Used by utilities like IncrementalIngestionManager
   */
  get client() {
    return this.neo4jClient;
  }

  /**
   * Query Scope entities
   */
  scope(): ScopeQuery {
    return new ScopeQuery(this.neo4jClient, 'Scope', undefined, this.scopeEntityContext);
  }

  /**
   * Perform mutations (create, update, delete) on Scope entities
   */
  scopeMutations(): ScopeMutations {
    return new ScopeMutations(this.neo4jClient, {
      name: 'Scope',
      uniqueField: 'uuid',
      displayNameField: 'name'
    });
  }

  /**
   * Get entity context for LLM reranker
   * @param entityType - Entity type name (e.g., "Scope", "Product", "User")
   */
  getEntityContext(entityType: string) {
    switch (entityType) {
      case 'Scope':
        return this.scopeEntityContext;
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
 * Create test-code-rag client
 * @param config Optional config. If omitted, uses environment variables (NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE)
 */
export function createRagClient(config?: Partial<RuntimeConfig>): RagClient {
  const finalConfig: RuntimeConfig = {
    neo4j: {
      uri: config?.neo4j?.uri || process.env.NEO4J_URI!,
      username: config?.neo4j?.username || process.env.NEO4J_USERNAME!,
      password: config?.neo4j?.password || process.env.NEO4J_PASSWORD!,
      database: config?.neo4j?.database || process.env.NEO4J_DATABASE
    }
  };
  return new RagClient(finalConfig);
}