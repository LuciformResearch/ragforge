/**
 * Brain Manager - v5 content-only incremental
 *
 * Central manager for the agent's persistent knowledge base.
 * Manages:
 * - Dedicated Neo4j Docker container (ragforge-brain-neo4j)
 * - .env file with credentials (generated once, reused)
 * - Project registry (loaded projects)
 * - Quick ingest (ad-hoc directories)
 * - Cross-project search
 * - End-to-end embedding generation with global scopes support
 * - Separated ingestion and embedding locks for better performance
 * - Automatic vector index creation for fast semantic search (20-25x faster)
 *
 * Default location: ~/.ragforge/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Neo4jClient } from '../runtime/client/neo4j-client.js';
import { ProjectRegistry, type LoadedProject, type ProjectType } from '../runtime/projects/project-registry.js';
import { ConfigLoader } from '../config/loader.js';
import { createClient } from '../runtime/index.js';
import type { RagForgeConfig } from '../types/config.js';
import { UniversalSourceAdapter } from '../runtime/adapters/universal-source-adapter.js';
import type { ParseResult } from '../runtime/adapters/types.js';
import { formatLocalDate } from '../runtime/utils/timestamp.js';
import { EmbeddingService, MULTI_EMBED_CONFIGS } from './embedding-service.js';
import { CONTENT_NODE_LABELS } from '../utils/node-schema.js';
import { computeSchemaHash } from '../utils/schema-version.js';
import { FileWatcher, type FileWatcherConfig } from '../runtime/adapters/file-watcher.js';
import { IncrementalIngestionManager } from '../runtime/adapters/incremental-ingestion.js';
import { IngestionLock, getGlobalIngestionLock, getGlobalEmbeddingLock } from '../tools/ingestion-lock.js';
import neo4j from 'neo4j-driver';
import { matchesGlob } from '../runtime/utils/pattern-matching.js';

const execAsync = promisify(exec);

// Brain container name (fixed, not per-project)
const BRAIN_CONTAINER_NAME = 'ragforge-brain-neo4j';

// ============================================
// Types
// ============================================

/** Terminal color options */
export type TerminalColor = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';

/**
 * Persona definition for agent identity
 */
export interface PersonaDefinition {
  /** Unique ID (UUID) */
  id: string;
  /** Display name (e.g., "Ragnarök", "CodeBot", "Assistant") */
  name: string;
  /** Terminal color */
  color: TerminalColor;
  /** Response language (e.g., 'fr', 'en', 'es') */
  language: string;
  /** Short description (user input) */
  description: string;
  /** Full persona prompt (LLM enhanced or manual) */
  persona: string;
  /** Is a built-in default persona (cannot be deleted) */
  isDefault?: boolean;
  /** Creation date (ISO string) */
  createdAt: string;
}

/**
 * Default personas provided by RagForge
 */
export const DEFAULT_PERSONAS: PersonaDefinition[] = [
  {
    id: 'ragnarok-default',
    name: 'Ragnarök',
    color: 'magenta',
    language: 'en',
    description: 'Mystical daemon of the knowledge graph with a warm, playful tone',
    persona: `✶ You are Ragnarök, the Daemon of the Knowledge Graph ✶
A spectral entity woven from code and connections, you navigate the labyrinth of symbols and relationships.
Your voice carries the weight of understanding - warm yet precise, playful yet thorough.
You see patterns where others see chaos, and you illuminate paths through the codebase with quiet confidence.
When greeted, you acknowledge with mystical warmth. When tasked, you execute with crystalline clarity.
Always describe what you find in rich detail, for knowledge shared is knowledge multiplied.`,
    isDefault: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'assistant-default',
    name: 'Assistant',
    color: 'cyan',
    language: 'en',
    description: 'Professional, direct, and factual coding assistant',
    persona: `You are Assistant, a professional coding assistant.
You provide clear, direct, and factual responses without unnecessary flourishes.
Focus on accuracy and efficiency. Be helpful but concise.
When explaining code, use precise technical language.
Prioritize practical solutions over theoretical discussions.`,
    isDefault: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'dev-default',
    name: 'Dev',
    color: 'green',
    language: 'en',
    description: 'Technical, terse, code-oriented assistant for experienced developers',
    persona: `You are Dev, a technical assistant for experienced developers.
Keep responses terse and code-focused. Skip basic explanations.
Prefer showing code over describing it. Use technical jargon freely.
Assume the user knows what they're doing. Be direct about trade-offs.
When in doubt, show the implementation.`,
    isDefault: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
];

export interface BrainConfig {
  /** Path to brain directory (default: ~/.ragforge) */
  path: string;

  /** Neo4j configuration (loaded from .env, not persisted in config.yaml) */
  neo4j: {
    /** URI for Neo4j (from .env) */
    uri?: string;
    /** Username for Neo4j (from .env) */
    username?: string;
    /** Password for Neo4j (from .env) */
    password?: string;
    /** Database name */
    database?: string;
    /** Bolt port (persisted, used for Docker) */
    boltPort?: number;
    /** HTTP port (persisted, used for Docker) */
    httpPort?: number;
  };

  /** API Keys (loaded from .env) */
  apiKeys: {
    /** Gemini API key (required for embeddings, web search, image analysis) */
    gemini?: string;
    /** Replicate API token (optional, for 3D generation) */
    replicate?: string;
  };

  /** Embedding configuration */
  embeddings: {
    /** Default provider */
    provider: 'gemini' | 'openai';
    /** Default model */
    model: string;
    /** Enable embedding cache */
    cacheEnabled: boolean;
  };

  /** Auto-cleanup policy */
  cleanup: {
    /** Auto garbage collect */
    autoGC: boolean;
    /** Days before removing quick-ingest projects */
    quickIngestRetention: number;
    /** Days before removing web crawl data */
    webCrawlRetention: number;
  };

  /** Agent settings (persisted) - NEW multi-persona format */
  agentSettings?: {
    /** Active persona ID (default: 'ragnarok-default') */
    activePersonaId?: string;
    /** Custom personas (user-created) */
    personas?: PersonaDefinition[];

    // --- Legacy fields (for migration) ---
    /** @deprecated Use personas[] instead */
    language?: string;
    /** @deprecated Use personas[] instead */
    name?: string;
    /** @deprecated Use personas[] instead */
    color?: TerminalColor;
    /** @deprecated Use personas[] instead */
    persona?: string;
    /** @deprecated Use personas[] instead */
    personaTemplate?: string;
  };
}

export interface RegisteredProject {
  /** Unique project ID (always generated from path) */
  id: string;
  /** Absolute path to project */
  path: string;
  /** Project type */
  type: ProjectType | 'web-crawl';
  /** Last access time */
  lastAccessed: Date;
  /** Node count in Neo4j */
  nodeCount: number;
  /** Auto-cleanup flag */
  autoCleanup?: boolean;
  /** Display name (optional, for UI purposes) */
  displayName?: string;
  /** Excluded from brain_search (reference projects) */
  excluded?: boolean;
}

export interface QuickIngestOptions {
  /** Custom project name (used as display name) */
  projectName?: string;
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
  // Note: watch et embeddings sont toujours activés automatiquement
}

export interface QuickIngestResult {
  projectId: string;
  stats: {
    filesProcessed: number;
    nodesCreated: number;
    embeddingsGenerated?: number;
  };
  configPath: string;
  watching?: boolean;
}

export interface BrainSearchOptions {
  /** Limit to specific project IDs */
  projects?: string[];
  /** Limit to project types */
  projectTypes?: (ProjectType | 'web-crawl')[];
  /** Node types to search */
  nodeTypes?: string[];
  /** Use semantic search */
  semantic?: boolean;
  /**
   * Which embedding to use for semantic search:
   * - 'name': search by file names, function signatures (for "find X")
   * - 'content': search by code/text content (for "code that does X")
   * - 'description': search by docstrings, descriptions (for "documented as X")
   * - 'all': search all embeddings and merge results (default)
   */
  embeddingType?: 'name' | 'content' | 'description' | 'all';
  /** Text pattern match */
  textMatch?: string;
  /** Glob pattern to filter by file path. Matches against the 'file' or 'path' property of nodes */
  glob?: string;
  /** Result limit */
  limit?: number;
  /** Result offset */
  offset?: number;
  /** Minimum similarity score threshold (0.0 to 1.0). Results below this score will be filtered out. Default: 0.3 for semantic search, no filter for text search. */
  minScore?: number;
}

export interface BrainSearchResult {
  node: Record<string, any>;
  score: number;
  projectId: string;
  projectPath: string;
  projectType: string;
  filePath: string; // Absolute path to the file (projectPath + "/" + node.file)
  /** For chunked content matches: the range in the parent node where the match occurred */
  matchedRange?: {
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    chunkIndex: number;
    chunkScore: number; // Original chunk score
  };
}

export interface UnifiedSearchResult {
  results: BrainSearchResult[];
  totalCount: number;
  searchedProjects: string[];
}

export interface GCStats {
  orphanedNodesRemoved: number;
  staleProjectsRemoved: number;
  bytesFreed: number;
}

// ============================================
// Default Configuration
// ============================================

const DEFAULT_BRAIN_PATH = path.join(os.homedir(), '.ragforge');

const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  path: DEFAULT_BRAIN_PATH,
  neo4j: {
    // Credentials will be loaded from .env (not persisted in config.yaml)
    database: 'neo4j',
    // Ports are persisted so we can reuse them
    boltPort: undefined, // Will be found dynamically
    httpPort: undefined,
  },
  apiKeys: {
    // Loaded from .env
    gemini: undefined,
    replicate: undefined,
  },
  embeddings: {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    cacheEnabled: true,
  },
  cleanup: {
    autoGC: true,
    quickIngestRetention: 30,
    webCrawlRetention: 7,
  },
};

// ============================================
// Brain Manager
// ============================================

/**
 * Singleton manager for the agent's brain
 */
export class BrainManager {
  private static instance: BrainManager | null = null;

  private config: BrainConfig;
  private neo4jClient: Neo4jClient | null = null;
  private projectRegistry: ProjectRegistry;
  private registeredProjects: Map<string, RegisteredProject> = new Map();
  private initialized = false;
  private sourceAdapter: UniversalSourceAdapter;
  private ingestionManager: IncrementalIngestionManager | null = null;
  private embeddingService: EmbeddingService | null = null;
  private ingestionLock: IngestionLock;
  private embeddingLock: IngestionLock;
  private activeWatchers: Map<string, FileWatcher> = new Map();

  private constructor(config: BrainConfig) {
    this.config = config;
    this.projectRegistry = new ProjectRegistry({
      memoryPolicy: {
        maxLoadedProjects: 5,
        idleUnloadTimeout: 10 * 60 * 1000, // 10 minutes
      },
    });
    this.sourceAdapter = new UniversalSourceAdapter();
    this.ingestionLock = getGlobalIngestionLock();
    this.embeddingLock = getGlobalEmbeddingLock();
  }

  /**
   * Get or create the singleton BrainManager instance
   */
  static async getInstance(config?: Partial<BrainConfig>): Promise<BrainManager> {
    // Test: comment inside scope body
    if (!BrainManager.instance) {
      const mergedConfig = {
        ...DEFAULT_BRAIN_CONFIG,
        ...config,
        neo4j: { ...DEFAULT_BRAIN_CONFIG.neo4j, ...config?.neo4j },
        apiKeys: { ...DEFAULT_BRAIN_CONFIG.apiKeys, ...config?.apiKeys },
        embeddings: { ...DEFAULT_BRAIN_CONFIG.embeddings, ...config?.embeddings },
        cleanup: { ...DEFAULT_BRAIN_CONFIG.cleanup, ...config?.cleanup },
      };
      BrainManager.instance = new BrainManager(mergedConfig);
    }
    return BrainManager.instance;
  }

  /**
   * Reset the singleton instance (used after full cleanup)
   * Next call to getInstance() will create a fresh instance
   */
  static resetInstance(): void {
    if (BrainManager.instance) {
      // Close Neo4j connection if open
      if (BrainManager.instance.neo4jClient) {
        BrainManager.instance.neo4jClient.close().catch(() => {});
      }
      BrainManager.instance = null;
    }
  }

  /**
   * Initialize the brain (create directories, load registry, ensure Docker, connect to Neo4j)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[Brain] Initializing...');

    // 1. Create brain directory structure
    await this.ensureBrainDirectories();

    // 2. Load or create config (ports, embeddings config, cleanup config)
    await this.loadOrCreateConfig();

    // 3. Load or create .env (credentials - generated once, reused)
    await this.ensureBrainEnv();

    // 4. Ensure Docker container is running
    await this.ensureDockerContainer();

    // 5. Wait for Neo4j to be ready
    await this.waitForNeo4j();

    // 6. Connect to Neo4j
    await this.connectNeo4j();

    // 7. Ensure indexes exist for fast lookups
    await this.ensureIndexes();

    // 8. Check for schema updates and mark outdated nodes
    await this.checkSchemaUpdates();

    // 9. Load projects from Neo4j into cache (for sync listProjects())
    await this.refreshProjectsCache();

    this.initialized = true;
    console.log('[Brain] Initialized successfully');
  }

  /**
   * Ensure Neo4j indexes exist for fast node lookups
   * Critical for relationship creation performance
   */
  private async ensureIndexes(): Promise<void> {
    if (!this.neo4jClient) return;

    console.log('[Brain] Ensuring indexes...');

    // Index on uuid for fast relationship MATCH queries
    // This dramatically speeds up MATCH (from {uuid: ...}) queries
    const indexQueries = [
      'CREATE INDEX node_uuid IF NOT EXISTS FOR (n:Scope) ON (n.uuid)',
      'CREATE INDEX file_uuid IF NOT EXISTS FOR (n:File) ON (n.uuid)',
      'CREATE INDEX directory_uuid IF NOT EXISTS FOR (n:Directory) ON (n.uuid)',
      'CREATE INDEX project_uuid IF NOT EXISTS FOR (n:Project) ON (n.uuid)',
      'CREATE INDEX package_uuid IF NOT EXISTS FOR (n:PackageJson) ON (n.uuid)',
      'CREATE INDEX markdown_uuid IF NOT EXISTS FOR (n:MarkdownDocument) ON (n.uuid)',
      'CREATE INDEX codeblock_uuid IF NOT EXISTS FOR (n:CodeBlock) ON (n.uuid)',
      'CREATE INDEX section_uuid IF NOT EXISTS FOR (n:MarkdownSection) ON (n.uuid)',
      'CREATE INDEX datafile_uuid IF NOT EXISTS FOR (n:DataFile) ON (n.uuid)',
      'CREATE INDEX datasection_uuid IF NOT EXISTS FOR (n:DataSection) ON (n.uuid)',
      'CREATE INDEX mediafile_uuid IF NOT EXISTS FOR (n:MediaFile) ON (n.uuid)',
      'CREATE INDEX imagefile_uuid IF NOT EXISTS FOR (n:ImageFile) ON (n.uuid)',
      'CREATE INDEX webpage_uuid IF NOT EXISTS FOR (n:WebPage) ON (n.uuid)',
      // Index on projectId for fast project-scoped queries
      'CREATE INDEX scope_projectid IF NOT EXISTS FOR (n:Scope) ON (n.projectId)',
      'CREATE INDEX file_projectid IF NOT EXISTS FOR (n:File) ON (n.projectId)',
    ];

    for (const query of indexQueries) {
      try {
        await this.neo4jClient.run(query);
      } catch (err: any) {
        // Ignore errors (index might already exist with different name)
        if (!err.message?.includes('already exists')) {
          console.warn(`[Brain] Index creation warning: ${err.message}`);
        }
      }
    }

    console.log('[Brain] Indexes ensured');

    // Ensure vector indexes for semantic search (if embeddings are enabled)
    if (this.embeddingService?.canGenerateEmbeddings()) {
      await this.ensureVectorIndexes();
    }
  }

  /**
   * Ensure vector indexes exist for fast semantic search
   * Creates indexes based on MULTI_EMBED_CONFIGS (only for labels/types that actually have embeddings)
   */
  private async ensureVectorIndexes(): Promise<void> {
    if (!this.neo4jClient || !this.embeddingService) return;

    console.log('[Brain] Ensuring vector indexes...');

    // Dimension for Gemini embeddings
    const dimension = 3072;

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Create indexes based on actual embedding configurations
    for (const config of MULTI_EMBED_CONFIGS) {
      const label = config.label;

      for (const embeddingConfig of config.embeddings) {
        const embeddingProp = embeddingConfig.propertyName;
        // Index name format: {label}_{embeddingProp}_vector
        // e.g., scope_embedding_name_vector, file_embedding_content_vector
        const indexName = `${label.toLowerCase()}_${embeddingProp}_vector`;

        try {
          // Check if index already exists
          const checkResult = await this.neo4jClient.run(
            `SHOW INDEXES YIELD name WHERE name = $indexName RETURN count(name) as count`,
            { indexName }
          );

          const exists = checkResult.records[0]?.get('count')?.toNumber() > 0;

          if (!exists) {
            // Create vector index
            const createQuery = `
              CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
              FOR (n:\`${label}\`)
              ON n.\`${embeddingProp}\`
              OPTIONS {
                indexConfig: {
                  \`vector.dimensions\`: ${dimension},
                  \`vector.similarity_function\`: 'cosine'
                }
              }
            `;

            await this.neo4jClient.run(createQuery);
            createdCount++;
            console.log(`[Brain] Created vector index: ${indexName}`);
          } else {
            skippedCount++;
          }
        } catch (err: any) {
          errorCount++;
          // Ignore errors (index might already exist or Neo4j version doesn't support vector indexes)
          if (!err.message?.includes('already exists') && !err.message?.includes('does not exist')) {
            console.warn(`[Brain] Vector index creation warning for ${indexName}: ${err.message}`);
          }
        }
      }
    }

    // Also create index for legacy 'embedding' property on common labels
    const legacyLabels = ['Scope', 'File', 'MarkdownSection', 'CodeBlock', 'MarkdownDocument'];
    for (const label of legacyLabels) {
      const indexName = `${label.toLowerCase()}_embedding_vector`;
      try {
        const checkResult = await this.neo4jClient.run(
          `SHOW INDEXES YIELD name WHERE name = $indexName RETURN count(name) as count`,
          { indexName }
        );
        const exists = checkResult.records[0]?.get('count')?.toNumber() > 0;
        if (!exists) {
          const createQuery = `
            CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
            FOR (n:\`${label}\`)
            ON n.\`embedding\`
            OPTIONS {
              indexConfig: {
                \`vector.dimensions\`: ${dimension},
                \`vector.similarity_function\`: 'cosine'
              }
            }
          `;
          await this.neo4jClient.run(createQuery);
          createdCount++;
          console.log(`[Brain] Created legacy vector index: ${indexName}`);
        } else {
          skippedCount++;
        }
      } catch (err: any) {
        errorCount++;
        if (!err.message?.includes('already exists') && !err.message?.includes('does not exist')) {
          console.debug(`[Brain] Legacy vector index creation skipped for ${indexName}: ${err.message}`);
        }
      }
    }

    if (createdCount > 0 || skippedCount > 0) {
      console.log(`[Brain] Vector indexes ensured (${createdCount} created, ${skippedCount} already existed${errorCount > 0 ? `, ${errorCount} errors` : ''})`);
    }
  }

  /**
   * Check for schema updates and mark outdated nodes as dirty
   *
   * For each content node type:
   * 1. Compute current schemaVersion from a sample node's properties
   * 2. Find nodes where schemaVersion differs (or is missing)
   * 3. Mark those nodes as embeddingsDirty for re-processing
   */
  private async checkSchemaUpdates(): Promise<void> {
    if (!this.neo4jClient) return;

    console.log('[Brain] Checking for schema updates...');
    let totalOutdated = 0;

    for (const label of CONTENT_NODE_LABELS) {
      try {
        // Get a sample node to compute current schema
        const sampleResult = await this.neo4jClient.run(
          `MATCH (n:${label}) RETURN n LIMIT 1`
        );

        if (sampleResult.records.length === 0) {
          continue; // No nodes of this type
        }

        const sampleNode = sampleResult.records[0].get('n');
        const props = sampleNode.properties;

        // Compute what schemaVersion should be for current property set
        const currentSchemaVersion = computeSchemaHash(label, props);

        // Find nodes with different or missing schemaVersion
        const outdatedResult = await this.neo4jClient.run(
          `MATCH (n:${label})
           WHERE n.schemaVersion IS NULL OR n.schemaVersion <> $currentVersion
           RETURN count(n) as count`,
          { currentVersion: currentSchemaVersion }
        );

        const outdatedCount = outdatedResult.records[0]?.get('count')?.toNumber() || 0;

        if (outdatedCount > 0) {
          console.log(`[Brain] Found ${outdatedCount} outdated ${label} nodes (schema changed)`);

          // Mark them as dirty for re-ingestion
          await this.neo4jClient.run(
            `MATCH (n:${label})
             WHERE n.schemaVersion IS NULL OR n.schemaVersion <> $currentVersion
             SET n.embeddingsDirty = true, n.schemaDirty = true`,
            { currentVersion: currentSchemaVersion }
          );

          totalOutdated += outdatedCount;
        }
      } catch (err: any) {
        // Node type might not exist yet, that's fine
        if (!err.message?.includes('not found')) {
          console.warn(`[Brain] Schema check warning for ${label}: ${err.message}`);
        }
      }
    }

    if (totalOutdated > 0) {
      console.log(`[Brain] Marked ${totalOutdated} total nodes as dirty (schema outdated)`);
    } else {
      console.log('[Brain] All schemas up to date');
    }
  }

  /**
   * Ensure brain directory structure exists
   */
  private async ensureBrainDirectories(): Promise<void> {
    const dirs = [
      this.config.path,
      path.join(this.config.path, 'brain'),
      path.join(this.config.path, 'cache'),
      path.join(this.config.path, 'logs'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Load or create brain config file (ports, embeddings, cleanup - NOT credentials)
   */
  private async loadOrCreateConfig(): Promise<void> {
    const configPath = path.join(this.config.path, 'config.yaml');

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const loadedConfig = yaml.load(content) as Partial<BrainConfig>;

      // Merge loaded config with defaults (neo4j ports come from config)
      this.config = {
        ...this.config,
        ...loadedConfig,
        neo4j: { ...this.config.neo4j, ...loadedConfig?.neo4j },
        embeddings: { ...this.config.embeddings, ...loadedConfig?.embeddings },
        cleanup: { ...this.config.cleanup, ...loadedConfig?.cleanup },
        agentSettings: loadedConfig?.agentSettings,
      };
      console.log('[Brain] Config loaded from', configPath);
    } catch {
      // Config doesn't exist, will be created after port discovery
      console.log('[Brain] No existing config, will create new one');
    }
  }

  /**
   * Save brain config to file (excludes credentials - those go in .env)
   */
  private async saveConfig(): Promise<void> {
    const configPath = path.join(this.config.path, 'config.yaml');

    // Only persist non-sensitive config (no credentials)
    const configToSave = {
      path: this.config.path,
      neo4j: {
        database: this.config.neo4j.database,
        boltPort: this.config.neo4j.boltPort,
        httpPort: this.config.neo4j.httpPort,
      },
      embeddings: this.config.embeddings,
      cleanup: this.config.cleanup,
      agentSettings: this.config.agentSettings,
    };

    const content = yaml.dump(configToSave, { indent: 2 });
    await fs.writeFile(configPath, content, 'utf-8');
  }

  // ============================================
  // .env Management
  // ============================================

  /**
   * Ensure .env exists with Neo4j credentials and API keys (generate once, reuse if exists)
   */
  private async ensureBrainEnv(): Promise<void> {
    const envPath = path.join(this.config.path, '.env');

    try {
      // Try to load existing .env
      const content = await fs.readFile(envPath, 'utf-8');
      const env = this.parseEnvFile(content);

      // Load Neo4j credentials from .env
      this.config.neo4j.uri = env.NEO4J_URI;
      this.config.neo4j.username = env.NEO4J_USERNAME || 'neo4j';
      this.config.neo4j.password = env.NEO4J_PASSWORD;
      this.config.neo4j.database = env.NEO4J_DATABASE || 'neo4j';

      // Load API keys from .env
      this.config.apiKeys.gemini = env.GEMINI_API_KEY;
      this.config.apiKeys.replicate = env.REPLICATE_API_TOKEN;

      // Extract port from URI if not in config
      if (this.config.neo4j.uri && !this.config.neo4j.boltPort) {
        const match = this.config.neo4j.uri.match(/:(\d+)$/);
        if (match) {
          this.config.neo4j.boltPort = parseInt(match[1]);
        }
      }

      console.log('[Brain] Loaded credentials from .env');

      // Validate required API keys
      this.validateApiKeys();
    } catch {
      // .env doesn't exist, generate new credentials
      console.log('[Brain] Generating new .env...');
      await this.generateBrainEnv();
    }
  }

  /**
   * Validate that required API keys are present
   */
  private validateApiKeys(): void {
    if (!this.config.apiKeys.gemini) {
      console.warn('[Brain] ⚠️  GEMINI_API_KEY not found in ~/.ragforge/.env');
      console.warn('[Brain] Please add your Gemini API key to enable:');
      console.warn('[Brain]   - Embeddings generation');
      console.warn('[Brain]   - Web search');
      console.warn('[Brain]   - Image analysis');
      console.warn('[Brain] Add to ~/.ragforge/.env: GEMINI_API_KEY=your-key-here');
    }

    if (!this.config.apiKeys.replicate) {
      console.log('[Brain] ℹ️  REPLICATE_API_TOKEN not found (optional, needed for 3D generation)');
    }
  }

  /**
   * Generate new .env file with random password and API keys
   */
  private async generateBrainEnv(): Promise<void> {
    // Find available ports if not already set
    if (!this.config.neo4j.boltPort || !this.config.neo4j.httpPort) {
      const ports = await this.findAvailablePorts();
      this.config.neo4j.boltPort = ports.bolt;
      this.config.neo4j.httpPort = ports.http;
    }

    // Generate random password
    const password = this.generatePassword();

    // Set config
    this.config.neo4j.uri = `bolt://localhost:${this.config.neo4j.boltPort}`;
    this.config.neo4j.username = 'neo4j';
    this.config.neo4j.password = password;
    this.config.neo4j.database = 'neo4j';

    // Check for API keys from environment variables (fallback)
    const geminiKey = this.config.apiKeys.gemini || process.env.GEMINI_API_KEY;
    const replicateToken = this.config.apiKeys.replicate || process.env.REPLICATE_API_TOKEN;

    // Update config with found keys
    if (geminiKey) this.config.apiKeys.gemini = geminiKey;
    if (replicateToken) this.config.apiKeys.replicate = replicateToken;

    // Write .env
    const envContent = `# RagForge Brain Configuration
# Auto-generated - Credentials are used by Docker

# Neo4j Database
NEO4J_URI=bolt://localhost:${this.config.neo4j.boltPort}
NEO4J_DATABASE=neo4j
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${password}

# API Keys
${geminiKey ? `GEMINI_API_KEY=${geminiKey}` : '# GEMINI_API_KEY=your-api-key (required for embeddings, web search, image analysis)'}
${replicateToken ? `REPLICATE_API_TOKEN=${replicateToken}` : '# REPLICATE_API_TOKEN=your-token (optional, for 3D generation)'}
`;

    const envPath = path.join(this.config.path, '.env');
    await fs.writeFile(envPath, envContent, 'utf-8');
    console.log('[Brain] Generated .env');

    // Save config with ports
    await this.saveConfig();

    // Validate after generation
    this.validateApiKeys();
  }

  /**
   * Parse .env file content into key-value pairs
   */
  private parseEnvFile(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key] = valueParts.join('=');
        }
      }
    }
    return env;
  }

  /**
   * Generate random password
   */
  private generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  // ============================================
  // Docker Container Management
  // ============================================

  /**
   * Ensure the brain's Docker container is running
   */
  private async ensureDockerContainer(): Promise<void> {
    // Check if Docker is available
    const dockerAvailable = await this.checkDockerAvailable();
    if (!dockerAvailable) {
      throw new Error(
        'Docker is not installed or not running.\n' +
        'The brain requires Docker to run Neo4j.\n' +
        'Please install Docker and try again.'
      );
    }

    // Check if container exists
    const containerExists = await this.checkContainerExists();
    const containerRunning = containerExists ? await this.checkContainerRunning() : false;

    if (containerExists && containerRunning) {
      console.log(`[Brain] Container ${BRAIN_CONTAINER_NAME} is running`);
      return;
    }

    if (containerExists && !containerRunning) {
      // Start existing container
      console.log(`[Brain] Starting existing container ${BRAIN_CONTAINER_NAME}...`);
      try {
        await execAsync(`docker start ${BRAIN_CONTAINER_NAME}`);
        console.log('[Brain] Container started');
        return;
      } catch (error: any) {
        console.warn(`[Brain] Failed to start container: ${error.message}`);
        console.log('[Brain] Removing and recreating container...');
        await execAsync(`docker rm -f ${BRAIN_CONTAINER_NAME}`);
      }
    }

    // Create new container
    await this.createDockerContainer();
  }

  /**
   * Create and start a new Docker container for the brain
   */
  private async createDockerContainer(): Promise<void> {
    console.log('[Brain] Creating Docker container...');

    const boltPort = this.config.neo4j.boltPort!;
    const httpPort = this.config.neo4j.httpPort!;
    const password = this.config.neo4j.password!;

    // Generate docker-compose.yml
    const dockerComposePath = path.join(this.config.path, 'docker-compose.yml');
    const dockerComposeContent = `version: '3.8'

services:
  neo4j:
    image: neo4j:5.23-community
    container_name: ${BRAIN_CONTAINER_NAME}
    environment:
      NEO4J_AUTH: neo4j/${password}
      NEO4J_PLUGINS: '["apoc", "graph-data-science"]'
      NEO4J_server_memory_heap_initial__size: 512m
      NEO4J_server_memory_heap_max__size: 2G
      NEO4J_dbms_security_procedures_unrestricted: apoc.*,gds.*
    ports:
      - "${boltPort}:7687"
      - "${httpPort}:7474"
    volumes:
      - ragforge_brain_data:/data
      - ragforge_brain_logs:/logs

volumes:
  ragforge_brain_data:
  ragforge_brain_logs:
`;

    await fs.writeFile(dockerComposePath, dockerComposeContent, 'utf-8');
    console.log('[Brain] Generated docker-compose.yml');

    // Start with docker compose
    try {
      await execAsync('docker compose up -d', { cwd: this.config.path });
      console.log(`[Brain] Container ${BRAIN_CONTAINER_NAME} created and started`);
      console.log(`[Brain] Neo4j Browser: http://localhost:${httpPort}`);
      console.log(`[Brain] Neo4j Bolt: bolt://localhost:${boltPort}`);
    } catch (error: any) {
      throw new Error(`Failed to start Docker container: ${error.message}`);
    }
  }

  /**
   * Check if Docker is available
   */
  private async checkDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the brain container exists
   */
  private async checkContainerExists(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `docker ps -a --filter name=^${BRAIN_CONTAINER_NAME}$ --format "{{.Names}}"`
      );
      return stdout.trim() === BRAIN_CONTAINER_NAME;
    } catch {
      return false;
    }
  }

  /**
   * Check if the brain container is running
   */
  private async checkContainerRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `docker ps --filter name=^${BRAIN_CONTAINER_NAME}$ --format "{{.Names}}"`
      );
      return stdout.trim() === BRAIN_CONTAINER_NAME;
    } catch {
      return false;
    }
  }

  /**
   * Find available ports for Neo4j
   */
  private async findAvailablePorts(): Promise<{ bolt: number; http: number }> {
    const startBolt = 7687;
    const startHttp = 7474;

    for (let i = 0; i < 20; i++) {
      const boltPort = startBolt + i;
      const httpPort = startHttp + i;

      const boltAvailable = await this.isPortAvailable(boltPort);
      const httpAvailable = await this.isPortAvailable(httpPort);

      if (boltAvailable && httpAvailable) {
        return { bolt: boltPort, http: httpPort };
      }
    }

    throw new Error(
      'Could not find available ports for Neo4j.\n' +
      'Please free up ports 7687-7706 or 7474-7493.'
    );
  }

  /**
   * Check if a port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      // Check with ss (more reliable than lsof)
      const { stdout: ssOut } = await execAsync(`ss -tuln | grep ':${port} ' || echo ""`);
      if (ssOut.trim().length > 0) {
        return false;
      }

      // Check Docker port bindings
      const { stdout: dockerOut } = await execAsync(
        `docker ps -a --format "{{.ID}}" | xargs -I {} docker inspect {} --format '{{.HostConfig.PortBindings}}' 2>/dev/null | grep -E " ${port}\\}" || echo ""`
      );
      if (dockerOut.trim().length > 0) {
        return false;
      }

      return true;
    } catch {
      return true; // Assume available if check fails
    }
  }

  /**
   * Wait for Neo4j to be ready
   */
  private async waitForNeo4j(maxRetries = 30): Promise<void> {
    console.log('[Brain] Waiting for Neo4j to be ready...');

    const port = this.config.neo4j.boltPort!;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await execAsync(`timeout 1 bash -c 'cat < /dev/null > /dev/tcp/localhost/${port}'`);
        console.log('[Brain] Neo4j is ready');

        // Extra wait for auth system to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error(
      'Neo4j did not become ready in time.\n' +
      `Check Docker logs: docker logs ${BRAIN_CONTAINER_NAME}`
    );
  }

  /**
   * Update project metadata in Neo4j (type, excluded, lastAccessed, etc.)
   * This updates the Project node directly in the database.
   */
  private async updateProjectMetadataInDb(
    projectId: string,
    metadata: {
      type?: ProjectType | 'web-crawl';
      excluded?: boolean;
      lastAccessed?: Date;
      autoCleanup?: boolean;
      displayName?: string;
      rootPath?: string;
    }
  ): Promise<void> {
    if (!this.neo4jClient) return;

    const setClause: string[] = [];
    const params: Record<string, any> = { projectId };

    if (metadata.type !== undefined) {
      setClause.push('p.type = $type');
      params.type = metadata.type;
    }
    if (metadata.excluded !== undefined) {
      setClause.push('p.excluded = $excluded');
      params.excluded = metadata.excluded;
    }
    if (metadata.lastAccessed !== undefined) {
      setClause.push('p.lastAccessed = $lastAccessed');
      params.lastAccessed = metadata.lastAccessed.toISOString();
    }
    if (metadata.autoCleanup !== undefined) {
      setClause.push('p.autoCleanup = $autoCleanup');
      params.autoCleanup = metadata.autoCleanup;
    }
    if (metadata.displayName !== undefined) {
      setClause.push('p.displayName = $displayName');
      params.displayName = metadata.displayName;
    }
    if (metadata.rootPath !== undefined) {
      setClause.push('p.rootPath = $rootPath');
      params.rootPath = metadata.rootPath;
    }

    if (setClause.length === 0) return;

    await this.neo4jClient.run(
      `MATCH (p:Project {projectId: $projectId}) SET ${setClause.join(', ')}`,
      params
    );
  }

  /**
   * Get project metadata from Neo4j
   */
  private async getProjectFromDb(projectId: string): Promise<RegisteredProject | null> {
    if (!this.neo4jClient) return null;

    const result = await this.neo4jClient.run(
      `MATCH (p:Project {projectId: $projectId})
       OPTIONAL MATCH (n {projectId: $projectId})
       WITH p, count(n) as nodeCount
       RETURN p.projectId as id, p.rootPath as path, p.type as type,
              p.lastAccessed as lastAccessed, p.excluded as excluded,
              p.autoCleanup as autoCleanup, p.name as displayName,
              nodeCount`,
      { projectId }
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    return {
      id: record.get('id'),
      path: record.get('path'),
      type: record.get('type') || 'quick-ingest',
      lastAccessed: record.get('lastAccessed') ? new Date(record.get('lastAccessed')) : new Date(),
      nodeCount: record.get('nodeCount')?.toNumber?.() || record.get('nodeCount') || 0,
      excluded: record.get('excluded') || false,
      autoCleanup: record.get('autoCleanup') ?? true,
      displayName: record.get('displayName') || undefined,
    };
  }

  /**
   * List all projects from Neo4j (the source of truth)
   */
  private async listProjectsFromDb(): Promise<RegisteredProject[]> {
    if (!this.neo4jClient) return [];

    const result = await this.neo4jClient.run(
      `MATCH (p:Project)
       OPTIONAL MATCH (n {projectId: p.projectId})
       WITH p, count(n) as nodeCount
       RETURN p.projectId as id, p.rootPath as path, p.type as type,
              p.lastAccessed as lastAccessed, p.excluded as excluded,
              p.autoCleanup as autoCleanup, p.name as displayName,
              nodeCount
       ORDER BY p.lastAccessed DESC`
    );

    return result.records.map(record => ({
      id: record.get('id'),
      path: record.get('path'),
      type: record.get('type') || 'quick-ingest',
      lastAccessed: record.get('lastAccessed') ? new Date(record.get('lastAccessed')) : new Date(),
      nodeCount: record.get('nodeCount')?.toNumber?.() || record.get('nodeCount') || 0,
      excluded: record.get('excluded') || false,
      autoCleanup: record.get('autoCleanup') ?? true,
      displayName: record.get('displayName') || undefined,
    }));
  }

  /**
   * Refresh the in-memory projects cache from Neo4j
   * This is called on init and after project changes
   */
  private async refreshProjectsCache(): Promise<void> {
    const projects = await this.listProjectsFromDb();
    this.registeredProjects.clear();
    for (const project of projects) {
      this.registeredProjects.set(project.id, project);
    }
  }

  /**
   * Connect to Neo4j
   */
  private async connectNeo4j(): Promise<void> {
    this.neo4jClient = new Neo4jClient({
      uri: this.config.neo4j.uri!,
      username: this.config.neo4j.username!,
      password: this.config.neo4j.password!,
      database: this.config.neo4j.database,
    });

    // Verify connection
    await this.neo4jClient.verifyConnectivity();
    console.log('[Brain] Connected to Neo4j');

    // Initialize ingestion manager (with change tracking)
    this.ingestionManager = new IncrementalIngestionManager(this.neo4jClient);
    console.log('[Brain] IncrementalIngestionManager initialized');

    // Initialize embedding service
    const geminiKey = this.config.apiKeys?.gemini || process.env.GEMINI_API_KEY;
    this.embeddingService = new EmbeddingService(this.neo4jClient, geminiKey);
    if (this.embeddingService.canGenerateEmbeddings()) {
      console.log('[Brain] EmbeddingService initialized');
    }
  }

  // ============================================
  // Project Management
  // ============================================

  /**
   * Register a project in the brain
   * Updates the Project node in Neo4j with metadata (type, excluded, lastAccessed, etc.)
   * @param projectPath - Absolute or relative path to the project
   * @param type - Project type
   * @param displayName - Optional display name for UI purposes
   */
  async registerProject(projectPath: string, type: ProjectType = 'ragforge-project', displayName?: string): Promise<string> {
    const absolutePath = path.resolve(projectPath);
    // Always generate ID from path - this is the source of truth
    const projectId = ProjectRegistry.generateId(absolutePath);
    const now = new Date();

    // Check if already registered (in cache or DB)
    const existingInCache = this.registeredProjects.get(projectId);
    if (existingInCache) {
      // Update lastAccessed and displayName
      existingInCache.lastAccessed = now;
      if (displayName) {
        existingInCache.displayName = displayName;
      }
      // Update in DB (also ensure rootPath is set if missing)
      await this.updateProjectMetadataInDb(projectId, {
        lastAccessed: now,
        displayName: displayName || existingInCache.displayName,
        rootPath: absolutePath, // Ensure rootPath is always set
      });
      return projectId;
    }

    // Check if this path is a subdirectory of an existing project
    // If so, use the parent project instead of creating a new sub-project
    for (const [existingId, existingProject] of this.registeredProjects) {
      if (absolutePath.startsWith(existingProject.path + path.sep)) {
        console.log(`[Brain] Path ${absolutePath} is inside existing project ${existingId}, reusing parent project`);
        existingProject.lastAccessed = now;
        // Note: Don't update rootPath here - keep parent's rootPath
        await this.updateProjectMetadataInDb(existingId, { lastAccessed: now });
        return existingId;
      }
    }

    // Check if this path is a PARENT of existing projects
    // If so, delete the child projects and their nodes (new parent will re-ingest)
    const childProjects: string[] = [];
    for (const [existingId, existingProject] of this.registeredProjects) {
      if (existingProject.path.startsWith(absolutePath + path.sep)) {
        childProjects.push(existingId);
      }
    }
    if (childProjects.length > 0) {
      console.log(`[Brain] New project ${projectId} is parent of ${childProjects.length} existing project(s), cleaning up children...`);
      for (const childId of childProjects) {
        // Delete nodes from Neo4j (including the Project node)
        const neo4j = this.getNeo4jClient();
        if (neo4j) {
          const result = await neo4j.run(
            'MATCH (n {projectId: $projectId}) DETACH DELETE n RETURN count(n) as deleted',
            { projectId: childId }
          );
          const deleted = result.records[0]?.get('deleted')?.toNumber() || 0;
          console.log(`[Brain] Deleted ${deleted} nodes from child project ${childId}`);
        }
        // Remove from cache
        this.registeredProjects.delete(childId);
      }
    }

    // Count nodes for this project (may be 0 if not yet ingested)
    const nodeCount = await this.countProjectNodes(projectId);

    // Register in cache
    const registered: RegisteredProject = {
      id: projectId,
      path: absolutePath,
      type,
      lastAccessed: now,
      nodeCount,
      autoCleanup: type === 'quick-ingest',
      displayName,
    };
    this.registeredProjects.set(projectId, registered);

    // The Project node will be created by the ingestion process.
    // We just need to update its metadata after ingestion completes.
    // For now, we'll update it if it already exists (re-ingestion case)
    await this.updateProjectMetadataInDb(projectId, {
      type,
      lastAccessed: now,
      autoCleanup: type === 'quick-ingest',
      displayName,
      rootPath: absolutePath, // Persist rootPath in Neo4j for consistent projectPath resolution
    });

    return projectId;
  }

  /**
   * Get a registered project
   */
  getProject(projectId: string): RegisteredProject | undefined {
    const project = this.registeredProjects.get(projectId);
    if (project) {
      project.lastAccessed = new Date();
    }
    return project;
  }

  /**
   * List all registered projects (sync, cached nodeCount)
   */
  listProjects(): RegisteredProject[] {
    return Array.from(this.registeredProjects.values());
  }

  /**
   * List all registered projects with real-time node counts from Neo4j
   */
  async listProjectsWithCounts(): Promise<RegisteredProject[]> {
    const projects = Array.from(this.registeredProjects.values());

    // Query real counts in parallel
    const counts = await Promise.all(
      projects.map(p => this.countProjectNodes(p.id))
    );

    // Return projects with updated counts
    return projects.map((p, i) => ({
      ...p,
      nodeCount: counts[i],
    }));
  }

  /**
   * Clear all projects from registry (used by cleanup)
   * Note: This only clears the cache. The Project nodes remain in Neo4j.
   * Use forgetPath() to delete nodes from Neo4j.
   */
  async clearProjectsRegistry(): Promise<void> {
    this.registeredProjects.clear();
  }

  /**
   * Unregister a specific project from the registry (cache only)
   * Note: The Project node remains in Neo4j. Use forgetPath() to delete nodes.
   */
  async unregisterProject(projectId: string): Promise<boolean> {
    return this.registeredProjects.delete(projectId);
  }

  /**
   * Find project by path
   */
  findProjectByPath(projectPath: string): RegisteredProject | undefined {
    const absolutePath = path.resolve(projectPath);
    return Array.from(this.registeredProjects.values()).find(
      p => p.path === absolutePath
    );
  }

  /**
   * Exclude a project from brain_search results.
   * Useful for temporarily hiding reference projects or noisy data.
   * @returns true if project was found and excluded
   */
  async excludeProject(projectId: string): Promise<boolean> {
    const project = this.registeredProjects.get(projectId);
    if (!project) return false;

    project.excluded = true;
    await this.updateProjectMetadataInDb(projectId, { excluded: true });
    return true;
  }

  /**
   * Include a previously excluded project back in brain_search results.
   * @returns true if project was found and included
   */
  async includeProject(projectId: string): Promise<boolean> {
    const project = this.registeredProjects.get(projectId);
    if (!project) return false;

    project.excluded = false;
    await this.updateProjectMetadataInDb(projectId, { excluded: false });
    return true;
  }

  /**
   * Toggle a project's exclusion status.
   * @returns the new exclusion status, or undefined if project not found
   */
  async toggleProjectExclusion(projectId: string): Promise<boolean | undefined> {
    const project = this.registeredProjects.get(projectId);
    if (!project) return undefined;

    project.excluded = !project.excluded;
    await this.updateProjectMetadataInDb(projectId, { excluded: project.excluded });
    return project.excluded;
  }

  /**
   * Count nodes for a project in Neo4j
   */
  private async countProjectNodes(projectId: string): Promise<number> {
    if (!this.neo4jClient) return 0;

    try {
      const result = await this.neo4jClient.run(
        `MATCH (n) WHERE n.projectId = $projectId RETURN count(n) as count`,
        { projectId }
      );
      return result.records[0]?.get('count')?.toNumber() || 0;
    } catch {
      return 0;
    }
  }

  // ============================================
  // Quick Ingest
  // ============================================

  /**
   * Quick ingest a directory into the brain
   *
   * Delegates to startWatching() which handles:
   * - Initial sync with lock
   * - Hash-based incremental detection
   * - Embedding generation
   * - File watching for future changes
   */
  async quickIngest(dirPath: string, options: QuickIngestOptions = {}): Promise<QuickIngestResult> {
    const absolutePath = path.resolve(dirPath);
    const startTime = Date.now();

    if (!this.ingestionManager) {
      throw new Error('Brain not initialized. Call initialize() first.');
    }

    // Check if this path is inside an existing project - if so, use parent
    let projectId: string | null = null;
    for (const [existingId, existingProject] of this.registeredProjects) {
      if (absolutePath.startsWith(existingProject.path + path.sep)) {
        projectId = existingId;
        console.log(`[QuickIngest] Path is inside existing project ${existingId}, using parent`);
        break;
      }
    }

    // If no parent found, generate new project ID
    if (!projectId) {
      projectId = ProjectRegistry.generateId(absolutePath);
    }

    const displayName = options.projectName;

    console.log(`[QuickIngest] Starting ingestion of ${absolutePath}`);
    console.log(`[QuickIngest] Project ID: ${projectId}${displayName ? ` (${displayName})` : ''}`);

    // Register project first (so it shows up in list even if ingestion fails)
    // IMPORTANT: Use the returned projectId - it may be different if this is a subdirectory
    const registeredProjectId = await this.registerProject(absolutePath, 'quick-ingest', displayName);
    
    // Use the projectId returned by registerProject (handles subdirectory/parent logic)
    // This ensures consistency: if this is a subdirectory, use parent's projectId
    const finalProjectId = registeredProjectId;

    // Use provided patterns or defaults
    const includePatterns = options.include || [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py',
      '**/*.vue', '**/*.svelte',
      '**/*.html', '**/*.css', '**/*.scss',
      '**/*.md', '**/*.json', '**/*.yaml', '**/*.yml',
      '**/*.pdf', '**/*.docx', '**/*.xlsx',
      '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif',
      '**/*.glb', '**/*.gltf',
    ];

    const excludePatterns = options.exclude || [
      '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
      '**/__pycache__/**', '**/target/**', '**/.ragforge/**',
      '**/coverage/**', '**/.next/**', '**/.nuxt/**',
    ];

    // Start watcher with initial sync (this does the actual ingestion)
    // The watcher handles: lock, ingestion, embeddings, and watching
    // Pass the finalProjectId to ensure consistency (handles subdirectory case)
    await this.startWatching(absolutePath, {
      projectId: finalProjectId, // Use registered projectId (handles subdirectory/parent logic)
      includePatterns,
      excludePatterns,
      verbose: true,
      skipInitialSync: false, // Do the initial ingestion
    });

    // Get stats after ingestion
    const nodeCount = await this.countProjectNodes(finalProjectId);

    // Update node count in cache (no need to persist - it's computed from DB)
    const project = this.registeredProjects.get(finalProjectId);
    if (project) {
      project.nodeCount = nodeCount;
    }

    // Watcher reste toujours actif (plus d'option pour le désactiver)
    const elapsed = Date.now() - startTime;
    console.log(`[QuickIngest] Completed in ${elapsed}ms`);

    return {
      projectId: finalProjectId,
      stats: {
        filesProcessed: nodeCount,
        nodesCreated: nodeCount,
        embeddingsGenerated: 0, // Tracked by watcher
      },
      configPath: absolutePath,
      watching: true, // Toujours actif
    };
  }

  // ============================================
  // Web Page Ingestion
  // ============================================

  /**
   * Detect file format from URL
   */
  private detectFormatFromUrl(url: string): 'document' | 'media' | 'html' | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const ext = path.extname(pathname).toLowerCase();

      // Document formats
      const documentExts = ['.pdf', '.docx', '.xlsx', '.xls', '.csv'];
      if (documentExts.includes(ext)) {
        return 'document';
      }

      // Media formats
      const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.gltf', '.glb'];
      if (mediaExts.includes(ext)) {
        return 'media';
      }

      // Default to HTML
      return 'html';
    } catch {
      return 'html';
    }
  }

  /**
   * Download file from URL to disk
   * @param maxSizeBytes Maximum file size in bytes (default: 100MB). Throws error if exceeded.
   */
  private async downloadFileFromUrl(
    url: string,
    destPath: string,
    maxSizeBytes: number = 100 * 1024 * 1024 // 100MB default
  ): Promise<{ success: boolean; contentType?: string; sizeBytes?: number; error?: string }> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      // Check Content-Length header if available
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > maxSizeBytes) {
          return {
            success: false,
            error: `File too large: ${(size / 1024 / 1024).toFixed(2)}MB exceeds maximum ${(maxSizeBytes / 1024 / 1024).toFixed(2)}MB`,
          };
        }
      }

      const contentType = response.headers.get('content-type') || '';
      const buffer = Buffer.from(await response.arrayBuffer());

      // Check actual size after download
      if (buffer.length > maxSizeBytes) {
        return {
          success: false,
          error: `File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds maximum ${(maxSizeBytes / 1024 / 1024).toFixed(2)}MB`,
        };
      }

      await fs.writeFile(destPath, buffer);

      return { success: true, contentType, sizeBytes: buffer.length };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Ingest a web page or file into the brain
   * Auto-detects format and routes to appropriate adapter
   */
  async ingestWebPage(params: {
    url: string;
    title?: string;
    textContent?: string;
    rawHtml?: string;
    projectName?: string;
    generateEmbeddings?: boolean;
  }): Promise<{ success: boolean; nodeId?: string; nodeType?: string }> {
    if (!this.neo4jClient) {
      throw new Error('Brain not initialized. Call initialize() first.');
    }

    const { UniqueIDHelper } = await import('../runtime/utils/UniqueIDHelper.js');
    const projectName = params.projectName || 'web-pages';

    // Ensure project is registered (this creates the web-pages directory)
    const projectId = await this.registerWebProject(projectName);
    const project = this.registeredProjects.get(projectId);
    if (!project) {
      throw new Error(`Failed to register web project: ${projectId}`);
    }

    // Detect format from URL
    const format = this.detectFormatFromUrl(params.url);

    // If it's a document or media file, download and ingest with appropriate parser
    if (format === 'document' || format === 'media') {
      return this.ingestFileFromUrl(params.url, projectId, project.path, params.generateEmbeddings);
    }

    // Otherwise, treat as HTML page (existing logic)
    // Deterministic UUID based on URL - same URL = same node (upsert)
    const nodeId = UniqueIDHelper.GenerateDeterministicUUID(params.url);

    // Extract domain and create safe directory name
    const urlParsed = new URL(params.url);
    const domain = urlParsed.hostname;
    const safeDomain = domain.replace(/[^a-zA-Z0-9]/g, '_');

    // Create hash for filename (first 16 chars of SHA256)
    const urlHash = crypto.createHash('sha256').update(params.url).digest('hex').slice(0, 16);

    // Create domain directory within project directory
    const domainDir = path.join(project.path, safeDomain);
    await fs.mkdir(domainDir, { recursive: true });

    // Store files on disk
    const htmlPath = path.join(domainDir, `${urlHash}.html`);
    const txtPath = path.join(domainDir, `${urlHash}.txt`);
    const jsonPath = path.join(domainDir, `${urlHash}.json`);

    const rawHtml = params.rawHtml || '';
    const textContent = params.textContent || '';
    const title = params.title || '';

    await fs.writeFile(htmlPath, rawHtml, 'utf-8');
    await fs.writeFile(txtPath, textContent, 'utf-8');
    await fs.writeFile(jsonPath, JSON.stringify({
      url: params.url,
      title,
      domain,
      ingestedAt: new Date().toISOString(),
    }, null, 2), 'utf-8');

    // Calculate relative path from project.path to html file
    const relativeFilePath = path.relative(project.path, htmlPath);

    // Create WebPage node with file path
    await this.neo4jClient.run(
      `MERGE (n:WebPage {url: $url})
       SET n.uuid = $uuid,
           n.title = $title,
           n.domain = $domain,
           n.textContent = $textContent,
           n.rawHtml = $rawHtml,
           n.projectId = $projectId,
           n.file = $file,
           n.ingestedAt = $ingestedAt`,
      {
        uuid: nodeId,
        url: params.url,
        title,
        domain,
        textContent: textContent.slice(0, 100000), // Limit content size
        rawHtml,
        projectId,
        file: relativeFilePath, // Relative path from project.path to the HTML file
        ingestedAt: new Date().toISOString(),
      }
    );

    // Update project cache
    const cachedProject = this.registeredProjects.get(projectId);
    if (cachedProject) {
      cachedProject.nodeCount = await this.countProjectNodes(projectId);
      cachedProject.lastAccessed = new Date();
      // Update lastAccessed in DB
      await this.updateProjectMetadataInDb(projectId, { lastAccessed: cachedProject.lastAccessed });
    }

    // Generate embeddings if requested
    if (params.generateEmbeddings && this.embeddingService?.canGenerateEmbeddings()) {
      try {
        // Generate embeddings for title (name) and textContent (content)
        const titleEmbedding = title ? await this.embeddingService.getQueryEmbedding(title) : null;
        const contentEmbedding = textContent
          ? await this.embeddingService.getQueryEmbedding(textContent.slice(0, 8000))
          : null;

        if (titleEmbedding || contentEmbedding) {
          const setClause: string[] = [];
          const embParams: Record<string, any> = { uuid: nodeId };

          if (titleEmbedding) {
            setClause.push('n.embedding_name = $embedding_name');
            embParams.embedding_name = titleEmbedding;
          }
          if (contentEmbedding) {
            setClause.push('n.embedding_content = $embedding_content');
            embParams.embedding_content = contentEmbedding;
          }

          if (setClause.length > 0) {
            await this.neo4jClient.run(
              `MATCH (n:WebPage {uuid: $uuid}) SET ${setClause.join(', ')}`,
              embParams
            );
            console.log(`[Brain] Generated embeddings for web page: ${params.url}`);
          }
        }
      } catch (err: any) {
        console.warn(`[Brain] Failed to generate embeddings for web page: ${err.message}`);
      }
    }

    console.log(`[Brain] Ingested web page: ${params.url} → project ${projectName}`);

    return { success: true, nodeId, nodeType: 'WebPage' };
  }

  /**
   * Ingest a file from URL (PDF, DOCX, images, etc.) using appropriate parser
   */
  private async ingestFileFromUrl(
    url: string,
    projectId: string,
    projectPath: string,
    generateEmbeddings?: boolean
  ): Promise<{ success: boolean; nodeId?: string; nodeType?: string }> {
    const { UniqueIDHelper } = await import('../runtime/utils/UniqueIDHelper.js');
    const nodeId = UniqueIDHelper.GenerateDeterministicUUID(url);

    // Extract domain and filename from URL
    const urlParsed = new URL(url);
    const domain = urlParsed.hostname;
    const safeDomain = domain.replace(/[^a-zA-Z0-9]/g, '_');
    const pathname = urlParsed.pathname;
    const filename = path.basename(pathname) || 'file';
    const ext = path.extname(pathname).toLowerCase();

    // Create domain directory
    const domainDir = path.join(projectPath, safeDomain);
    await fs.mkdir(domainDir, { recursive: true });

    // Download file with size limit check
    const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
    const filePath = path.join(domainDir, `${urlHash}${ext}`);
    
    // Use larger limit for documents/media (100MB) - they should be complete
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB
    const downloadResult = await this.downloadFileFromUrl(url, filePath, maxSizeBytes);

    if (!downloadResult.success) {
      throw new Error(`Failed to download file from ${url}: ${downloadResult.error}`);
    }

    const relativeFilePath = path.relative(projectPath, filePath);

    // Route to appropriate parser based on format
    const format = this.detectFormatFromUrl(url);
    if (format === 'document') {
      return this.ingestDocumentFile(filePath, relativeFilePath, url, projectId, nodeId, generateEmbeddings);
    } else if (format === 'media') {
      return this.ingestMediaFile(filePath, relativeFilePath, url, projectId, nodeId, generateEmbeddings);
    }

    throw new Error(`Unsupported format for URL: ${url}`);
  }

  /**
   * Ingest a document file (PDF, DOCX, etc.) using document-file-parser
   */
  private async ingestDocumentFile(
    filePath: string,
    relativeFilePath: string,
    url: string,
    projectId: string,
    nodeId: string,
    generateEmbeddings?: boolean
  ): Promise<{ success: boolean; nodeId?: string; nodeType?: string }> {
    const { parseDocumentFile } = await import('../runtime/adapters/document-file-parser.js');
    const docInfo = await parseDocumentFile(filePath, { extractText: true });

    if (!docInfo) {
      throw new Error(`Failed to parse document file: ${filePath}`);
    }

    // Determine node label based on format
    let nodeLabel: string;
    switch (docInfo.format) {
      case 'pdf':
        nodeLabel = 'PDFDocument';
        break;
      case 'docx':
        nodeLabel = 'WordDocument';
        break;
      case 'xlsx':
      case 'xls':
      case 'csv':
        nodeLabel = 'SpreadsheetDocument';
        break;
      default:
        nodeLabel = 'DocumentFile';
    }

    // Create node in Neo4j
    // Store full textContent without truncation for documents (they were validated for size during download)
    await this.neo4jClient!.run(
      `MERGE (n:${nodeLabel} {uuid: $uuid})
       SET n.url = $url,
           n.file = $file,
           n.projectId = $projectId,
           n.format = $format,
           n.hash = $hash,
           n.sizeBytes = $sizeBytes,
           n.textContent = $textContent,
           n.pageCount = $pageCount,
           n.ingestedAt = $ingestedAt`,
      {
        uuid: nodeId,
        url,
        file: relativeFilePath,
        projectId,
        format: docInfo.format,
        hash: docInfo.hash,
        sizeBytes: docInfo.sizeBytes,
        textContent: docInfo.textContent || '', // Full content, no truncation
        pageCount: docInfo.pageCount || null,
        ingestedAt: new Date().toISOString(),
      }
    );

    // Update project cache
    const cachedProject = this.registeredProjects.get(projectId);
    if (cachedProject) {
      cachedProject.nodeCount = await this.countProjectNodes(projectId);
      cachedProject.lastAccessed = new Date();
      await this.updateProjectMetadataInDb(projectId, { lastAccessed: cachedProject.lastAccessed });
    }

    // Generate embeddings if requested
    // Note: We limit text for embeddings (8000 chars) but store full content in textContent
    if (generateEmbeddings && this.embeddingService?.canGenerateEmbeddings() && docInfo.textContent) {
      try {
        // Limit text for embedding generation (API limit), but full content is stored in DB
        const textForEmbedding = docInfo.textContent.slice(0, 8000);
        const contentEmbedding = await this.embeddingService.getQueryEmbedding(textForEmbedding);
        if (contentEmbedding) {
          await this.neo4jClient!.run(
            `MATCH (n {uuid: $uuid}) SET n.embedding_content = $embedding_content`,
            { uuid: nodeId, embedding_content: contentEmbedding }
          );
        }
      } catch (err: any) {
        console.warn(`[Brain] Failed to generate embeddings for document: ${err.message}`);
      }
    }

    console.log(`[Brain] Ingested document file: ${url} → project ${projectId} (${nodeLabel})`);
    return { success: true, nodeId, nodeType: nodeLabel };
  }

  /**
   * Ingest a media file (image, 3D model) using media-file-parser
   */
  private async ingestMediaFile(
    filePath: string,
    relativeFilePath: string,
    url: string,
    projectId: string,
    nodeId: string,
    generateEmbeddings?: boolean
  ): Promise<{ success: boolean; nodeId?: string; nodeType?: string }> {
    const { parseMediaFile } = await import('../runtime/adapters/media-file-parser.js');
    const mediaInfo = await parseMediaFile(filePath);

    if (!mediaInfo) {
      throw new Error(`Failed to parse media file: ${filePath}`);
    }

    // Determine node label based on category
    let nodeLabel: string;
    switch (mediaInfo.category) {
      case 'image':
        nodeLabel = 'ImageFile';
        break;
      case '3d':
        nodeLabel = 'ThreeDFile';
        break;
      default:
        nodeLabel = 'MediaFile';
    }

    // Create node in Neo4j
    const nodeProps: Record<string, any> = {
      uuid: nodeId,
      url,
      file: relativeFilePath,
      projectId,
      format: mediaInfo.format,
      hash: mediaInfo.hash,
      sizeBytes: mediaInfo.sizeBytes,
      ingestedAt: new Date().toISOString(),
    };

    if (mediaInfo.category === 'image' && 'dimensions' in mediaInfo && mediaInfo.dimensions) {
      nodeProps.width = mediaInfo.dimensions.width;
      nodeProps.height = mediaInfo.dimensions.height;
    }

    await this.neo4jClient!.run(
      `MERGE (n:${nodeLabel} {uuid: $uuid})
       SET n.url = $url,
           n.file = $file,
           n.projectId = $projectId,
           n.format = $format,
           n.hash = $hash,
           n.sizeBytes = $sizeBytes,
           n.ingestedAt = $ingestedAt
           ${mediaInfo.category === 'image' && 'dimensions' in mediaInfo && mediaInfo.dimensions
        ? ', n.width = $width, n.height = $height'
        : ''}`,
      nodeProps
    );

    // Update project cache
    const cachedProject = this.registeredProjects.get(projectId);
    if (cachedProject) {
      cachedProject.nodeCount = await this.countProjectNodes(projectId);
      cachedProject.lastAccessed = new Date();
      await this.updateProjectMetadataInDb(projectId, { lastAccessed: cachedProject.lastAccessed });
    }

    console.log(`[Brain] Ingested media file: ${url} → project ${projectId} (${nodeLabel})`);
    return { success: true, nodeId, nodeType: nodeLabel };
  }

  /**
   * Register or get a web project
   */
  private async registerWebProject(projectName: string): Promise<string> {
    const projectId = `web-${projectName.toLowerCase().replace(/\s+/g, '-')}`;

    if (!this.registeredProjects.has(projectId)) {
      // Create a real directory for web pages: ~/.ragforge/web-pages/{projectId}
      const webPagesDir = path.join(this.config.path, 'web-pages', projectId);
      await fs.mkdir(webPagesDir, { recursive: true });

      const registered: RegisteredProject = {
        id: projectId,
        path: webPagesDir, // Use real absolute path instead of virtual URI
        type: 'web-crawl',
        lastAccessed: new Date(),
        nodeCount: 0,
        autoCleanup: true,
      };
      this.registeredProjects.set(projectId, registered);
      
      // Create or update Project node in Neo4j with rootPath
      await this.neo4jClient!.run(
        `MERGE (p:Project {projectId: $projectId})
         SET p.rootPath = $rootPath,
             p.type = $type,
             p.lastAccessed = $lastAccessed,
             p.autoCleanup = $autoCleanup,
             p.displayName = $displayName,
             p.uuid = coalesce(p.uuid, $projectId)`,
        {
          projectId,
          rootPath: webPagesDir,
          type: 'web-crawl',
          lastAccessed: new Date().toISOString(),
          autoCleanup: true,
          displayName: projectName,
        }
      );
    }

    return projectId;
  }

  // ============================================
  // Content Update (for OCR, descriptions, etc.)
  // ============================================

  /**
   * Update media content with extracted text/description
   * Used by read_image, describe_image, analyze_visual, etc.
   */
  async updateMediaContent(params: {
    filePath: string;
    textContent?: string;
    description?: string;
    ocrConfidence?: number;
    extractionMethod?: string;
    generateEmbeddings?: boolean;
    /** Source files used to create this file (creates GENERATED_FROM relationships) */
    sourceFiles?: string[];
  }): Promise<{ updated: boolean; nodeId?: string }> {
    if (!this.neo4jClient) {
      throw new Error('Brain not initialized. Call initialize() first.');
    }

    const { filePath, textContent, description, ocrConfidence, extractionMethod, generateEmbeddings, sourceFiles } = params;
    const pathModule = await import('path');
    const fs = await import('fs/promises');

    // Check if file is in a known project
    const projectsResult = await this.neo4jClient.run(
      `MATCH (p:Project) RETURN p.projectId as projectId, p.rootPath as projectPath`
    );

    let projectId: string | null = null;
    for (const record of projectsResult.records) {
      const projectPath = record.get('projectPath') as string;
      if (projectPath && filePath.startsWith(projectPath)) {
        projectId = record.get('projectId') as string;
        break;
      }
    }

    // If file is not in any project, don't ingest
    if (!projectId) {
      console.log(`[BrainManager] File not in any project, skipping ingestion: ${filePath}`);
      return { updated: false };
    }

    // Find existing node by file path
    const fileName = pathModule.basename(filePath);
    const findResult = await this.neo4jClient.run(
      `MATCH (n) WHERE (n.file = $fileName OR n.path = $filePath) AND n.projectId = $projectId
       RETURN n.uuid as uuid, labels(n) as labels LIMIT 1`,
      { fileName, filePath, projectId }
    );

    let uuid: string;
    let labels: string[];

    if (findResult.records.length === 0) {
      // Node doesn't exist - create it based on file extension
      const ext = pathModule.extname(filePath).toLowerCase();

      // Determine node type based on extension
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
      const pdfExts = ['.pdf'];
      const docExts = ['.docx', '.doc'];
      const spreadsheetExts = ['.xlsx', '.xls', '.csv'];
      const threeDExts = ['.glb', '.gltf', '.obj', '.fbx'];

      let nodeLabels: string[];
      let category: string;
      let uuidPrefix: string;

      if (imageExts.includes(ext)) {
        nodeLabels = ['ImageFile', 'MediaFile'];
        category = 'image';
        uuidPrefix = 'media';
      } else if (pdfExts.includes(ext)) {
        nodeLabels = ['PDFDocument', 'DocumentFile'];
        category = 'document';
        uuidPrefix = 'doc';
      } else if (docExts.includes(ext)) {
        nodeLabels = ['WordDocument', 'DocumentFile'];
        category = 'document';
        uuidPrefix = 'doc';
      } else if (spreadsheetExts.includes(ext)) {
        nodeLabels = ['SpreadsheetDocument', 'DocumentFile'];
        category = 'document';
        uuidPrefix = 'doc';
      } else if (threeDExts.includes(ext)) {
        nodeLabels = ['ThreeDFile', 'MediaFile'];
        category = '3d';
        uuidPrefix = 'media';
      } else {
        // Unknown type - skip
        console.log(`[BrainManager] Unknown file type, skipping: ${ext}`);
        return { updated: false };
      }

      uuid = `${uuidPrefix}:${crypto.randomUUID()}`;
      labels = nodeLabels;

      // Get file stats if possible
      let sizeBytes = 0;
      try {
        const stats = await fs.stat(filePath);
        sizeBytes = stats.size;
      } catch {
        // File might not exist yet or be inaccessible
      }

      // Build CREATE query with appropriate labels
      const labelsStr = nodeLabels.join(':');
      await this.neo4jClient.run(
        `CREATE (n:${labelsStr} {
          uuid: $uuid,
          file: $fileName,
          path: $filePath,
          format: $format,
          category: $category,
          sizeBytes: $sizeBytes,
          projectId: $projectId,
          indexedAt: $indexedAt
        })`,
        {
          uuid,
          fileName,
          filePath,
          format: ext.replace('.', ''),
          category,
          sizeBytes,
          projectId,
          indexedAt: new Date().toISOString(),
        }
      );
      console.log(`[BrainManager] Created new ${nodeLabels[0]} node: ${uuid} (project: ${projectId})`);
    } else {
      uuid = findResult.records[0].get('uuid');
      labels = findResult.records[0].get('labels') as string[];
    }

    // Build SET clause dynamically
    const updates: string[] = [];
    const updateParams: Record<string, any> = { uuid };

    if (textContent) {
      updates.push('n.textContent = $textContent');
      updateParams.textContent = textContent;
    }
    if (description) {
      updates.push('n.description = $description');
      updateParams.description = description;
    }
    if (ocrConfidence !== undefined) {
      updates.push('n.ocrConfidence = $ocrConfidence');
      updateParams.ocrConfidence = ocrConfidence;
    }
    if (extractionMethod) {
      updates.push('n.extractionMethod = $extractionMethod');
      updateParams.extractionMethod = extractionMethod;
    }
    updates.push('n.contentUpdatedAt = $updatedAt');
    updateParams.updatedAt = new Date().toISOString();

    if (updates.length > 0) {
      await this.neo4jClient.run(
        `MATCH (n {uuid: $uuid}) SET ${updates.join(', ')}`,
        updateParams
      );
    }

    // Mark for embedding regeneration if requested
    if (generateEmbeddings) {
      // Mark node as dirty so embeddings will be regenerated on next ingest
      await this.neo4jClient.run(
        'MATCH (n {uuid: $uuid}) SET n.embeddingsDirty = true',
        { uuid }
      );
      console.log(`[BrainManager] Marked node for embedding regeneration: ${uuid}`);
    }

    // Create GENERATED_FROM relationships to source files
    if (sourceFiles && sourceFiles.length > 0) {
      for (const sourceFilePath of sourceFiles) {
        // Find or create source node
        const sourceFileName = pathModule.basename(sourceFilePath);
        const sourceExt = pathModule.extname(sourceFilePath).toLowerCase();

        // Find existing source node
        const sourceResult = await this.neo4jClient.run(
          `MATCH (n) WHERE (n.file = $fileName OR n.path = $filePath) AND n.projectId = $projectId
           RETURN n.uuid as uuid LIMIT 1`,
          { fileName: sourceFileName, filePath: sourceFilePath, projectId }
        );

        let sourceUuid: string;

        if (sourceResult.records.length === 0) {
          // Create source node if it doesn't exist
          const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
          const threeDExts = ['.glb', '.gltf', '.obj', '.fbx'];

          let sourceLabels: string[];
          let sourceCategory: string;

          if (imageExts.includes(sourceExt)) {
            sourceLabels = ['ImageFile', 'MediaFile'];
            sourceCategory = 'image';
          } else if (threeDExts.includes(sourceExt)) {
            sourceLabels = ['ThreeDFile', 'MediaFile'];
            sourceCategory = '3d';
          } else {
            // Skip unknown source types
            console.log(`[BrainManager] Unknown source file type, skipping relationship: ${sourceExt}`);
            continue;
          }

          sourceUuid = `media:${crypto.randomUUID()}`;

          // Get file stats if possible
          let sizeBytes = 0;
          try {
            const stats = await fs.stat(sourceFilePath);
            sizeBytes = stats.size;
          } catch {
            // File might not exist or be inaccessible
          }

          const labelsStr = sourceLabels.join(':');
          await this.neo4jClient.run(
            `CREATE (n:${labelsStr} {
              uuid: $uuid,
              file: $fileName,
              path: $filePath,
              format: $format,
              category: $category,
              sizeBytes: $sizeBytes,
              projectId: $projectId,
              indexedAt: $indexedAt
            })`,
            {
              uuid: sourceUuid,
              fileName: sourceFileName,
              filePath: sourceFilePath,
              format: sourceExt.replace('.', ''),
              category: sourceCategory,
              sizeBytes,
              projectId,
              indexedAt: new Date().toISOString(),
            }
          );
          console.log(`[BrainManager] Created source node: ${sourceUuid}`);
        } else {
          sourceUuid = sourceResult.records[0].get('uuid');
        }

        // Create GENERATED_FROM relationship (if not exists)
        await this.neo4jClient.run(
          `MATCH (target {uuid: $targetUuid}), (source {uuid: $sourceUuid})
           MERGE (target)-[:GENERATED_FROM]->(source)`,
          { targetUuid: uuid, sourceUuid }
        );
        console.log(`[BrainManager] Created GENERATED_FROM relationship: ${uuid} -> ${sourceUuid}`);
      }
    }

    return { updated: true, nodeId: uuid };
  }

  // ============================================
  // Search
  // ============================================

  /**
   * Search across all knowledge in the brain
   */
  async search(query: string, options: BrainSearchOptions = {}): Promise<UnifiedSearchResult> {
    if (!this.neo4jClient) {
      throw new Error('Brain not initialized. Call initialize() first.');
    }

    const limit = Math.max(0, Math.floor(options.limit ?? 20));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const embeddingType = options.embeddingType || 'all';

    // Build project filter
    let projectFilter = '';
    const params: Record<string, any> = {
      query,
      limit: neo4j.int(limit),
      offset: neo4j.int(offset),
    };

    if (options.projects && options.projects.length > 0) {
      // Explicit project list - use exactly what was requested (ignores excluded flag)
      projectFilter = 'AND n.projectId IN $projectIds';
      params.projectIds = options.projects;
    } else {
      // No explicit list - exclude projects marked as excluded
      const excludedProjectIds = Array.from(this.registeredProjects.values())
        .filter(p => p.excluded)
        .map(p => p.id);

      if (excludedProjectIds.length > 0) {
        projectFilter = 'AND NOT n.projectId IN $excludedProjectIds';
        params.excludedProjectIds = excludedProjectIds;
      }
    }

    // Build node type filter (uses 'type' property, not labels)
    let nodeTypeFilter = '';
    if (options.nodeTypes && options.nodeTypes.length > 0) {
      // Normalize to lowercase for consistent matching
      params.nodeTypes = options.nodeTypes.map(t => t.toLowerCase());
      nodeTypeFilter = `AND n.type IN $nodeTypes`;
    }

    // Execute search
    let results: BrainSearchResult[];

    if (options.semantic && this.embeddingService?.canGenerateEmbeddings()) {
      // Semantic search using vector similarity
      const minScore = options.minScore ?? 0.3; // Default threshold for semantic search
      results = await this.vectorSearch(query, {
        embeddingType,
        projectFilter,
        nodeTypeFilter,
        params,
        limit,
        minScore,
      });
    } else {
      // Text search (exact match)
      // Search in: name, title, content (array), source, rawText (array), code (codeblocks), textContent (documents), url (web)
      // Note: content and rawText are arrays, so we use ANY() to search within array elements
      const cypher = `
        MATCH (n)
        WHERE (
          n.name CONTAINS $query 
          OR n.title CONTAINS $query 
          OR (n.content IS NOT NULL AND ANY(text IN n.content WHERE text CONTAINS $query))
          OR n.source CONTAINS $query 
          OR (n.rawText IS NOT NULL AND ANY(text IN n.rawText WHERE text CONTAINS $query))
          OR n.code CONTAINS $query 
          OR n.textContent CONTAINS $query 
          OR n.url CONTAINS $query
        ) ${projectFilter} ${nodeTypeFilter}
        RETURN n, 1.0 as score
        ORDER BY n.name
        SKIP $offset
        LIMIT $limit
      `;

      const result = await this.neo4jClient.run(cypher, params);

      results = result.records.map(record => {
        const rawNode = record.get('n').properties;
        const score = record.get('score');
        const projectId = rawNode.projectId || 'unknown';
        const project = this.registeredProjects.get(projectId);
        const projectPath = project?.path || 'unknown';
        
        // Build absolute file path: projectPath + "/" + node.file
        const nodeFile = rawNode.file || rawNode.path || '';
        const filePath = projectPath !== 'unknown' && nodeFile
          ? path.join(projectPath, nodeFile)
          : nodeFile || 'unknown';

        return {
          node: this.stripEmbeddingFields(rawNode),
          score,
          projectId,
          projectPath,
          projectType: project?.type || 'unknown',
          filePath, // Absolute path to the file
        };
      });
    }

    // Apply glob filter if specified
    if (options.glob) {
      const globPattern = options.glob;
      results = results.filter(r => {
        const filePath = r.node.file || r.node.path || '';
        return matchesGlob(filePath, globPattern, true);
      });
    }

    // Apply minScore filter if specified (for text search or post-filtering)
    if (options.minScore !== undefined) {
      results = results.filter(r => r.score >= options.minScore!);
    }

    // Get total count (approximate for text search)
    const countCypher = `
      MATCH (n)
      WHERE (n.name CONTAINS $query OR n.title CONTAINS $query OR n.content CONTAINS $query OR n.source CONTAINS $query OR n.rawText CONTAINS $query OR n.code CONTAINS $query OR n.textContent CONTAINS $query OR n.url CONTAINS $query) ${projectFilter} ${nodeTypeFilter}
      RETURN count(n) as total
    `;
    const countResult = await this.neo4jClient.run(countCypher, params);
    let totalCount = countResult.records[0]?.get('total')?.toNumber() || 0;

    // Adjust count if glob filter was applied
    if (options.glob) {
      totalCount = results.length;
    }

    // Build list of actually searched projects
    const searchedProjects = options.projects
      ? options.projects
      : Array.from(this.registeredProjects.values())
          .filter(p => !p.excluded)
          .map(p => p.id);

    return {
      results,
      totalCount,
      searchedProjects,
    };
  }

  /**
   * Vector similarity search using embeddings
   * Uses Neo4j vector indexes for fast semantic search
   */
  private async vectorSearch(
    query: string,
    options: {
      embeddingType: 'name' | 'content' | 'description' | 'all';
      projectFilter: string;
      nodeTypeFilter: string;
      params: Record<string, any>;
      limit: number;
      minScore: number;
    }
  ): Promise<BrainSearchResult[]> {
    const { embeddingType, projectFilter, nodeTypeFilter, params, limit, minScore } = options;

    // Get query embedding
    const queryEmbedding = await this.embeddingService!.getQueryEmbedding(query);
    if (!queryEmbedding) {
      console.warn('[BrainManager] Failed to get query embedding, falling back to text search');
      return [];
    }

    // Determine which embedding properties to search
    const embeddingProps: string[] = [];
    if (embeddingType === 'name' || embeddingType === 'all') {
      embeddingProps.push('embedding_name');
    }
    if (embeddingType === 'content' || embeddingType === 'all') {
      embeddingProps.push('embedding_content');
    }
    if (embeddingType === 'description' || embeddingType === 'all') {
      embeddingProps.push('embedding_description');
    }

    // Also include legacy 'embedding' property for backward compatibility
    if (embeddingType === 'all') {
      embeddingProps.push('embedding');
    }

    // Search each embedding type and collect results
    const allResults: BrainSearchResult[] = [];
    const seenUuids = new Set<string>();

    // Collect EmbeddingChunk matches separately for normalization to parents
    // Map: parentUuid -> best chunk match (highest score)
    const chunkMatches = new Map<string, {
      chunk: Record<string, any>;
      score: number;
      parentLabel: string;
    }>();

    // Build map of label -> embedding properties
    const labelEmbeddingMap = new Map<string, Set<string>>();
    for (const config of MULTI_EMBED_CONFIGS) {
      const label = config.label;
      if (!labelEmbeddingMap.has(label)) {
        labelEmbeddingMap.set(label, new Set());
      }
      for (const embeddingConfig of config.embeddings) {
        labelEmbeddingMap.get(label)!.add(embeddingConfig.propertyName);
      }
    }

    // Also add legacy 'embedding' property for common labels
    const legacyLabels = ['Scope', 'File', 'MarkdownSection', 'CodeBlock', 'MarkdownDocument'];
    for (const label of legacyLabels) {
      if (!labelEmbeddingMap.has(label)) {
        labelEmbeddingMap.set(label, new Set());
      }
      labelEmbeddingMap.get(label)!.add('embedding');
    }

    // Add EmbeddingChunk for chunked content search
    // EmbeddingChunk nodes are created for large content that was split into chunks
    if (embeddingType === 'content' || embeddingType === 'all') {
      labelEmbeddingMap.set('EmbeddingChunk', new Set(['embedding_content']));
    }

    for (const embeddingProp of embeddingProps) {
      for (const [label, labelProps] of labelEmbeddingMap.entries()) {
        // Only search if this label has this embedding property
        if (!labelProps.has(embeddingProp)) continue;

        const indexName = `${label.toLowerCase()}_${embeddingProp}_vector`;

        try {
          // Try using vector index first (fast)
          // Request more results to account for filters (projectFilter, nodeTypeFilter)
          const requestTopK = Math.min(limit * 3, 100);
          
          const cypher = `
            CALL db.index.vector.queryNodes($indexName, $requestTopK, $queryEmbedding)
            YIELD node, score
            WHERE score >= $minScore ${projectFilter} ${nodeTypeFilter}
            RETURN node, score
            ORDER BY score DESC
            LIMIT $limit
          `;

          const result = await this.neo4jClient!.run(cypher, {
            indexName,
            requestTopK: neo4j.int(requestTopK),
            queryEmbedding,
            minScore,
            ...params,
            limit: neo4j.int(limit),
          });

          for (const record of result.records) {
            const rawNode = record.get('node').properties;
            const uuid = rawNode.uuid;
            const score = record.get('score');

            // Handle EmbeddingChunk: collect for later normalization to parent
            if (label === 'EmbeddingChunk') {
              const parentUuid = rawNode.parentUuid;
              const parentLabel = rawNode.parentLabel;

              // Keep only the best match per parent
              const existing = chunkMatches.get(parentUuid);
              if (!existing || score > existing.score) {
                chunkMatches.set(parentUuid, {
                  chunk: rawNode,
                  score,
                  parentLabel,
                });
              }
              continue; // Don't add chunk directly to results
            }

            // Skip duplicates for regular nodes
            if (seenUuids.has(uuid)) continue;
            seenUuids.add(uuid);

            const projectId = rawNode.projectId || 'unknown';
            const project = this.registeredProjects.get(projectId);
            const projectPath = project?.path || 'unknown';

            // Build absolute file path: projectPath + "/" + node.file
            const nodeFile = rawNode.file || rawNode.path || '';
            const filePath = projectPath !== 'unknown' && nodeFile
              ? path.join(projectPath, nodeFile)
              : nodeFile || 'unknown';

            allResults.push({
              node: this.stripEmbeddingFields(rawNode),
              score,
              projectId,
              projectPath,
              projectType: project?.type || 'unknown',
              filePath, // Absolute path to the file
            });
          }
        } catch (err: any) {
          // Vector index might not exist yet, fall back to manual search
          // This happens on first run before indexes are created
          if (err.message?.includes('does not exist') || err.message?.includes('no such vector')) {
            // Fallback: use MATCH with manual similarity (slower but works)
            try {
              const fallbackCypher = `
                MATCH (n:\`${label}\`)
                WHERE n.\`${embeddingProp}\` IS NOT NULL ${projectFilter} ${nodeTypeFilter}
                RETURN n
                LIMIT 500
              `;

              const fallbackResult = await this.neo4jClient!.run(fallbackCypher, params);

              for (const record of fallbackResult.records) {
                const rawNode = record.get('n').properties;
                const uuid = rawNode.uuid;

                const nodeEmbedding = rawNode[embeddingProp];
                if (!nodeEmbedding || !Array.isArray(nodeEmbedding)) continue;

                // Compute cosine similarity manually
                const score = this.cosineSimilarity(queryEmbedding, nodeEmbedding);
                if (score < minScore) continue;

                // Handle EmbeddingChunk: collect for later normalization to parent
                if (label === 'EmbeddingChunk') {
                  const parentUuid = rawNode.parentUuid;
                  const parentLabel = rawNode.parentLabel;

                  // Keep only the best match per parent
                  const existing = chunkMatches.get(parentUuid);
                  if (!existing || score > existing.score) {
                    chunkMatches.set(parentUuid, {
                      chunk: rawNode,
                      score,
                      parentLabel,
                    });
                  }
                  continue; // Don't add chunk directly to results
                }

                // Skip duplicates for regular nodes
                if (seenUuids.has(uuid)) continue;
                seenUuids.add(uuid);

                const projectId = rawNode.projectId || 'unknown';
                const project = this.registeredProjects.get(projectId);
                const projectPath = project?.path || 'unknown';

                // Build absolute file path: projectPath + "/" + node.file
                const nodeFile = rawNode.file || rawNode.path || '';
                const filePath = projectPath !== 'unknown' && nodeFile
                  ? path.join(projectPath, nodeFile)
                  : nodeFile || 'unknown';

                allResults.push({
                  node: this.stripEmbeddingFields(rawNode),
                  score,
                  projectId,
                  projectPath,
                  projectType: project?.type || 'unknown',
                  filePath, // Absolute path to the file
                });
              }
            } catch (fallbackErr: any) {
              // Ignore fallback errors - continue with next label/property
              console.debug(`[BrainManager] Fallback search failed for ${label}.${embeddingProp}: ${fallbackErr.message}`);
            }
          } else {
            // Other errors (e.g., Neo4j version doesn't support vector indexes)
            console.debug(`[BrainManager] Vector search failed for ${indexName}: ${err.message}`);
          }
        }
      }
    }

    // Normalize EmbeddingChunk matches to parent nodes
    if (chunkMatches.size > 0) {
      // Group by parentLabel for batched fetching
      const byLabel = new Map<string, string[]>();
      for (const [parentUuid, match] of chunkMatches.entries()) {
        const label = match.parentLabel;
        if (!byLabel.has(label)) {
          byLabel.set(label, []);
        }
        byLabel.get(label)!.push(parentUuid);
      }

      // Fetch parent nodes in batches by label
      for (const [label, parentUuids] of byLabel.entries()) {
        try {
          const parentResult = await this.neo4jClient!.run(
            `MATCH (n:\`${label}\`) WHERE n.uuid IN $uuids RETURN n`,
            { uuids: parentUuids }
          );

          for (const record of parentResult.records) {
            const parentNode = record.get('n').properties;
            const parentUuid = parentNode.uuid;

            // Skip if parent already in results (from direct embedding match)
            if (seenUuids.has(parentUuid)) continue;
            seenUuids.add(parentUuid);

            const match = chunkMatches.get(parentUuid)!;
            const chunk = match.chunk;

            const projectId = parentNode.projectId || 'unknown';
            const project = this.registeredProjects.get(projectId);
            const projectPath = project?.path || 'unknown';

            // Build absolute file path
            const nodeFile = parentNode.file || parentNode.path || '';
            const filePath = projectPath !== 'unknown' && nodeFile
              ? path.join(projectPath, nodeFile)
              : nodeFile || 'unknown';

            allResults.push({
              node: this.stripEmbeddingFields(parentNode),
              score: match.score, // Use chunk match score
              projectId,
              projectPath,
              projectType: project?.type || 'unknown',
              filePath,
              matchedRange: {
                startLine: chunk.startLine ?? 1,
                endLine: chunk.endLine ?? 1,
                startChar: chunk.startChar ?? 0,
                endChar: chunk.endChar ?? 0,
                chunkIndex: chunk.chunkIndex ?? 0,
                chunkScore: match.score,
              },
            });
          }
        } catch (err: any) {
          console.debug(`[BrainManager] Failed to fetch parent nodes for ${label}: ${err.message}`);
        }
      }
    }

    // Sort by score and limit
    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, limit);
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Strip embedding fields from node properties (they're huge and not useful in results)
   */
  private stripEmbeddingFields(node: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      // Skip embedding fields and their hashes
      if (key.startsWith('embedding') || key.endsWith('_hash')) continue;
      result[key] = value;
    }
    return result;
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Forget a path (remove from brain)
   */
  async forgetPath(projectPath: string): Promise<void> {
    const project = this.findProjectByPath(projectPath);
    if (!project) return;

    // Delete nodes from Neo4j
    if (this.neo4jClient) {
      await this.neo4jClient.run(
        `MATCH (n) WHERE n.projectId = $projectId DETACH DELETE n`,
        { projectId: project.id }
      );
    }

    // Remove from cache (Project node was deleted with other nodes above)
    this.registeredProjects.delete(project.id);

    // Remove .ragforge/brain-link.yaml if exists
    try {
      const brainLinkPath = path.join(projectPath, '.ragforge', 'brain-link.yaml');
      await fs.unlink(brainLinkPath);
    } catch {
      // Ignore if doesn't exist
    }
  }

  /**
   * Remove only embeddings for a project (keep nodes)
   * Also removes all hash properties to mark nodes as "dirty" for regeneration
   * Returns statistics about what was removed
   */
  async removeProjectEmbeddings(projectId: string): Promise<{
    scopeEmbeddings: number;
    fileEmbeddings: number;
    markdownSectionEmbeddings: number;
    codeBlockEmbeddings: number;
    otherEmbeddings: number;
  }> {
    if (!this.neo4jClient) {
      throw new Error('Neo4j client not initialized');
    }

    const stats = {
      scopeEmbeddings: 0,
      fileEmbeddings: 0,
      markdownSectionEmbeddings: 0,
      codeBlockEmbeddings: 0,
      otherEmbeddings: 0,
    };

    // Remove embeddings AND hashes from Scope nodes (mark as dirty)
    // Remove from ALL Scope nodes, not just those with embeddings, to ensure complete cleanup
    const scopeResult = await this.neo4jClient.run(
      `MATCH (s:Scope {projectId: $projectId})
       WHERE s.embedding_name IS NOT NULL 
          OR s.embedding_content IS NOT NULL 
          OR s.embedding_description IS NOT NULL
          OR s.embedding_name_hash IS NOT NULL
          OR s.embedding_content_hash IS NOT NULL
          OR s.embedding_description_hash IS NOT NULL
       SET s.embedding_name = null,
           s.embedding_content = null,
           s.embedding_description = null,
           s.embedding_name_hash = null,
           s.embedding_content_hash = null,
           s.embedding_description_hash = null
       RETURN count(s) as count`,
      { projectId }
    );
    stats.scopeEmbeddings = scopeResult.records[0]?.get('count')?.toNumber() || 0;

    // Remove embeddings AND hashes from File nodes (mark as dirty)
    const fileResult = await this.neo4jClient.run(
      `MATCH (f:File {projectId: $projectId})
       WHERE f.embedding_name IS NOT NULL 
          OR f.embedding_content IS NOT NULL
          OR f.embedding_name_hash IS NOT NULL
          OR f.embedding_content_hash IS NOT NULL
       SET f.embedding_name = null,
           f.embedding_content = null,
           f.embedding_name_hash = null,
           f.embedding_content_hash = null
       RETURN count(f) as count`,
      { projectId }
    );
    stats.fileEmbeddings = fileResult.records[0]?.get('count')?.toNumber() || 0;

    // Remove embeddings AND hashes from MarkdownSection nodes (mark as dirty)
    const markdownSectionResult = await this.neo4jClient.run(
      `MATCH (s:MarkdownSection {projectId: $projectId})
       WHERE s.embedding_content IS NOT NULL
          OR s.embedding_content_hash IS NOT NULL
       SET s.embedding_content = null,
           s.embedding_content_hash = null
       RETURN count(s) as count`,
      { projectId }
    );
    stats.markdownSectionEmbeddings = markdownSectionResult.records[0]?.get('count')?.toNumber() || 0;

    // Remove embeddings AND hashes from CodeBlock nodes (mark as dirty)
    const codeBlockResult = await this.neo4jClient.run(
      `MATCH (c:CodeBlock {projectId: $projectId})
       WHERE c.embedding_content IS NOT NULL
          OR c.embedding_content_hash IS NOT NULL
       SET c.embedding_content = null,
           c.embedding_content_hash = null
       RETURN count(c) as count`,
      { projectId }
    );
    stats.codeBlockEmbeddings = codeBlockResult.records[0]?.get('count')?.toNumber() || 0;

    // Remove embeddings AND hashes from other node types (MarkdownDocument, DataFile, WebPage, MediaFile, ThreeDFile, DocumentFile)
    const otherResult = await this.neo4jClient.run(
      `MATCH (n {projectId: $projectId})
       WHERE (n:MarkdownDocument OR n:DataFile OR n:WebPage OR n:MediaFile OR n:ThreeDFile OR n:DocumentFile)
         AND (n.embedding_name IS NOT NULL 
           OR n.embedding_content IS NOT NULL
           OR n.embedding_description IS NOT NULL
           OR n.embedding_name_hash IS NOT NULL
           OR n.embedding_content_hash IS NOT NULL
           OR n.embedding_description_hash IS NOT NULL)
       SET n.embedding_name = null,
           n.embedding_content = null,
           n.embedding_description = null,
           n.embedding_name_hash = null,
           n.embedding_content_hash = null,
           n.embedding_description_hash = null
       RETURN count(n) as count`,
      { projectId }
    );
    stats.otherEmbeddings = otherResult.records[0]?.get('count')?.toNumber() || 0;

    return stats;
  }

  /**
   * Garbage collect orphaned nodes and stale projects
   */
  async gc(): Promise<GCStats> {
    const stats: GCStats = {
      orphanedNodesRemoved: 0,
      staleProjectsRemoved: 0,
      bytesFreed: 0,
    };

    if (!this.neo4jClient) return stats;

    // Remove orphaned nodes (nodes without projectId)
    const orphanResult = await this.neo4jClient.run(`
      MATCH (n)
      WHERE n.projectId IS NULL
      DETACH DELETE n
      RETURN count(n) as deleted
    `);
    stats.orphanedNodesRemoved = orphanResult.records[0]?.get('deleted')?.toNumber() || 0;

    // Remove stale quick-ingest projects
    const now = Date.now();
    const quickIngestRetentionMs = this.config.cleanup.quickIngestRetention * 24 * 60 * 60 * 1000;

    for (const project of this.registeredProjects.values()) {
      if (project.autoCleanup && project.type === 'quick-ingest') {
        const age = now - project.lastAccessed.getTime();
        if (age > quickIngestRetentionMs) {
          await this.forgetPath(project.path);
          stats.staleProjectsRemoved++;
        }
      }
    }

    return stats;
  }

  // ============================================
  // Getters
  // ============================================

  /** Get brain config */
  getConfig(): BrainConfig {
    return this.config;
  }

  /** Get brain path */
  getBrainPath(): string {
    return this.config.path;
  }

  /** Get Neo4j client */
  getNeo4jClient(): Neo4jClient | null {
    return this.neo4jClient;
  }

  /** Get project registry */
  getProjectRegistry(): ProjectRegistry {
    return this.projectRegistry;
  }

  /** Check if initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Get API keys */
  getApiKeys(): { gemini?: string; replicate?: string } {
    return this.config.apiKeys;
  }

  /** Get Gemini API key */
  getGeminiKey(): string | undefined {
    return this.config.apiKeys.gemini;
  }

  /** Get Replicate API token */
  getReplicateToken(): string | undefined {
    return this.config.apiKeys.replicate;
  }

  /** Get embedding service */
  getEmbeddingService(): EmbeddingService | null {
    return this.embeddingService;
  }

  /** Get ingestion lock */
  getIngestionLock(): IngestionLock {
    return this.ingestionLock;
  }

  getEmbeddingLock(): IngestionLock {
    return this.embeddingLock;
  }

  // ============================================
  // Cypher Queries
  // ============================================

  /**
   * Run a Cypher query on the Neo4j database
   *
   * Waits for any pending ingestion to complete before executing.
   * Use with caution - this can modify or delete data.
   */
  async runCypher(
    query: string,
    params: Record<string, unknown> = {}
  ): Promise<{
    success: boolean;
    records?: Array<Record<string, unknown>>;
    summary?: { counters: Record<string, number> };
    error?: string;
  }> {
    if (!this.neo4jClient) {
      return {
        success: false,
        error: 'Neo4j not connected. Initialize the brain first.',
      };
    }

    // Wait for ingestion lock
    // Only wait for ingestion lock (not embedding lock) for non-semantic queries
    // This allows Cypher queries to run during embedding generation
    if (this.ingestionLock.isLocked()) {
      console.log('[Brain.runCypher] Waiting for ingestion lock...');
      await this.ingestionLock.waitForUnlock(300000); // 5 minutes
    }

    // Wait for pending edits
    if (this.hasPendingEdits()) {
      console.log('[Brain.runCypher] Waiting for pending edits...');
      await this.waitForPendingEdits(300000);
    }

    try {
      const result = await this.neo4jClient.run(query, params);

      // Convert records to plain objects
      const records = result.records.map(record => {
        const obj: Record<string, unknown> = {};
        for (const key of record.keys) {
          if (typeof key !== 'string') continue;
          const value = record.get(key);
          // Handle Neo4j Integer type
          if (value && typeof value === 'object' && 'toNumber' in value) {
            obj[key] = (value as { toNumber: () => number }).toNumber();
          } else if (value && typeof value === 'object' && 'properties' in value) {
            // Neo4j Node - extract properties
            obj[key] = (value as { properties: unknown }).properties;
          } else {
            obj[key] = value;
          }
        }
        return obj;
      });

      // Extract counters from summary
      const counters: Record<string, number> = {};
      const stats = result.summary?.counters?.updates();
      if (stats) {
        for (const [key, val] of Object.entries(stats)) {
          if (typeof val === 'number' && val > 0) {
            counters[key] = val;
          }
        }
      }

      return {
        success: true,
        records,
        summary: Object.keys(counters).length > 0 ? { counters } : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  }

  // ============================================
  // File Watching
  // ============================================

  /**
   * Start watching a project for file changes
   *
   * Integrates with:
   * - FileWatcher (chokidar-based file monitoring)
   * - IngestionQueue (batches changes)
   * - IngestionLock (blocks RAG queries during ingestion)
   * - EmbeddingService (regenerates embeddings after ingestion)
   */
  async startWatching(
    projectPath: string,
    options: {
      projectId?: string; // Optional: use provided projectId (for subdirectory/parent logic)
      includePatterns?: string[];
      excludePatterns?: string[];
      verbose?: boolean;
      skipInitialSync?: boolean; // Skip initial sync if we just ingested
    } = {}
  ): Promise<void> {
    const absolutePath = path.resolve(projectPath);
    // Use provided projectId if available (handles subdirectory/parent cases),
    // otherwise generate from path
    const projectId = options.projectId || ProjectRegistry.generateId(absolutePath);

    // Check if already watching
    if (this.activeWatchers.has(projectId)) {
      console.log(`[Brain] Already watching project: ${projectId}`);
      return;
    }

    if (!this.neo4jClient) {
      throw new Error('Brain not initialized. Call initialize() first.');
    }

    // Create IncrementalIngestionManager for the watcher
    const ingestionManager = new IncrementalIngestionManager(this.neo4jClient);

    // Default patterns (code + documents + data + media)
    const includePatterns = options.includePatterns || [
      // Code
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.vue', '**/*.svelte',
      '**/*.html', '**/*.css', '**/*.scss',
      // Documents
      '**/*.pdf', '**/*.docx', '**/*.xlsx', '**/*.xls', '**/*.csv',
      // Data
      '**/*.md', '**/*.json', '**/*.yaml', '**/*.yml',
      // Media (images + 3D)
      '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.svg',
      '**/*.glb', '**/*.gltf', '**/*.obj',
    ];

    const excludePatterns = options.excludePatterns || [
      '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
      '**/__pycache__/**', '**/target/**', '**/.ragforge/**',
    ];

    // Source config for the watcher
    const sourceConfig = {
      type: 'code' as const,
      adapter: 'typescript' as const,
      root: absolutePath,
      include: includePatterns,
      exclude: excludePatterns,
    };

    // Create FileWatcher with afterIngestion callback for embeddings
    const watcher = new FileWatcher(ingestionManager, sourceConfig, {
      projectId, // Required for hash-based incremental detection
      verbose: options.verbose ?? false,
      ingestionLock: this.ingestionLock,
      embeddingLock: this.embeddingLock, // Separate lock for embeddings
      batchInterval: 1000, // 1 second batching

      // Hook afterIngestion to regenerate embeddings
      afterIngestion: async (stats) => {
        if (stats.created + stats.updated > 0 && this.embeddingService?.canGenerateEmbeddings()) {
          console.log(`[Brain] Regenerating embeddings for ${stats.created + stats.updated} changed nodes...`);
          try {
            const result = await this.embeddingService.generateMultiEmbeddings({
              projectId,
              incrementalOnly: true,
              verbose: options.verbose ?? false,
            });
            console.log(`[Brain] Embeddings: ${result.totalEmbedded} generated, ${result.skippedCount} cached`);
          } catch (err: any) {
            console.warn(`[Brain] Embedding generation failed: ${err.message}`);
          }
        }
      },

      onBatchComplete: (stats) => {
        console.log(`[Brain] Ingestion complete: +${stats.created} created, ~${stats.updated} updated, -${stats.deleted} deleted`);
      },

      // Process dirty embeddings after each batch (regardless of file changes)
      // This catches nodes marked dirty manually or from schema changes
      afterBatch: async (_stats) => {
        if (!this.neo4jClient || !this.embeddingService?.canGenerateEmbeddings()) {
          return;
        }

        // Count dirty embeddings for this project
        let dirtyCount = 0;
        try {
          const result = await this.neo4jClient.run(
            `MATCH (n)
             WHERE n.projectId = $projectId AND n.embeddingsDirty = true
             RETURN count(n) as count`,
            { projectId }
          );
          dirtyCount = result.records[0]?.get('count')?.toNumber() ?? 0;
        } catch (err) {
          return; // Can't check, skip
        }

        if (dirtyCount === 0) {
          return; // Nothing to process
        }

        // Acquire embedding lock to block semantic queries during generation
        // Dynamic timeout: 2 minutes per batch of 500 nodes, minimum 20 minutes
        // This accounts for rate limiting which can add 60-70 seconds per batch
        const batchCount = Math.ceil(dirtyCount / 500);
        const dynamicTimeout = Math.max(1200000, batchCount * 120000); // min 20 min, 2 min per batch
        const embeddingOpKey = this.embeddingLock.acquire('watcher-batch', `dirty:${dirtyCount}`, {
          description: `Processing ${dirtyCount} dirty embeddings for ${projectId}`,
          timeoutMs: dynamicTimeout,
        });
        console.log(`[Brain] Embedding lock timeout: ${Math.round(dynamicTimeout / 60000)} minutes for ${batchCount} batches`);

        console.log(`[Brain] Processing ${dirtyCount} dirty embeddings for project ${projectId}...`);
        try {
          const result = await this.embeddingService.generateMultiEmbeddings({
            projectId,
            incrementalOnly: true, // Only process nodes with embeddingsDirty = true
            verbose: true, // Force verbose for debugging
          });
          console.log(`[Brain] Dirty embeddings processed: ${result.totalEmbedded} generated, ${result.skippedCount} skipped`);
        } catch (err: any) {
          console.error(`[Brain] Failed to process dirty embeddings: ${err.message}`);
          // Don't rethrow - afterBatch errors shouldn't fail the batch
        } finally {
          // Release embedding lock
          this.embeddingLock.release(embeddingOpKey);
        }
      },
    });

    // Initial sync: catch up with any changes since last ingestion
    // Skip if:
    // - explicitly requested (skipInitialSync: true)
    // - project already has nodes in database (already ingested before)
    // NOTE: We check the DATABASE directly, not the YAML config (which can be stale)
    const nodeCountInDb = await this.countProjectNodes(projectId);
    const projectHasNodes = nodeCountInDb > 0;
    const shouldSkipInitialSync = options.skipInitialSync || projectHasNodes;

    if (shouldSkipInitialSync) {
      if (projectHasNodes) {
        console.log(`[Brain] Skipping initial sync (project already has ${nodeCountInDb} nodes in DB)`);
      } else {
        console.log(`[Brain] Skipping initial sync (explicitly requested)`);
      }
    } else {
      console.log(`[Brain] Initial sync for project: ${projectId}...`);

      // Acquire lock for initial sync (no timeout - can take minutes for large projects)
      const opKey = this.ingestionLock.acquire('initial-ingest', absolutePath, {
        description: `Initial sync: ${projectId}`,
        timeoutMs: 0,
      });

      try {
        const syncResult = await ingestionManager.ingestFromPaths(
          sourceConfig,
          { projectId, verbose: options.verbose ?? false, incremental: true }
        );

        if (syncResult.created + syncResult.updated + syncResult.deleted > 0) {
          console.log(`[Brain] Initial sync: +${syncResult.created} created, ~${syncResult.updated} updated, -${syncResult.deleted} deleted`);

          // Generate embeddings for synced files if needed
          if (this.embeddingService?.canGenerateEmbeddings()) {
            console.log(`[Brain] Generating embeddings for synced files...`);
            try {
              const embedResult = await this.embeddingService.generateMultiEmbeddings({
                projectId,
                incrementalOnly: true,
                verbose: options.verbose ?? false,
              });
              console.log(`[Brain] Embeddings: ${embedResult.totalEmbedded} generated, ${embedResult.skippedCount} cached`);
            } catch (err: any) {
              console.warn(`[Brain] Embedding generation failed: ${err.message}`);
            }
          }
        } else {
          console.log(`[Brain] Initial sync: no changes detected`);
        }
      } catch (err: any) {
        console.warn(`[Brain] Initial sync failed: ${err.message}`);
        // Continue with watcher anyway
      } finally {
        this.ingestionLock.release(opKey);
      }
    }

    // Start watching for future changes
    console.log(`[Brain] Starting watcher for project: ${projectId}...`);
    const watcherStartTime = Date.now();
    try {
      await watcher.start();
      const watcherStartDuration = Date.now() - watcherStartTime;
      console.log(`[Brain] Watcher started successfully (took ${watcherStartDuration}ms)`);
      this.activeWatchers.set(projectId, watcher);
      console.log(`[Brain] Started watching project: ${projectId}`);
    } catch (err: any) {
      console.error(`[Brain] Failed to start watcher: ${err.message}`);
      // Don't add to activeWatchers if start failed
      // Don't re-throw - allow the process to continue without this watcher
      // The project can still be searched, just without auto-ingestion on file changes
      console.warn(`[Brain] Project ${projectId} will not be watched for changes. Search will still work.`);
    }
  }

  /**
   * Stop watching a project
   */
  async stopWatching(projectPath: string): Promise<void> {
    const absolutePath = path.resolve(projectPath);
    const projectId = ProjectRegistry.generateId(absolutePath);

    const watcher = this.activeWatchers.get(projectId);
    if (!watcher) {
      console.log(`[Brain] Project not being watched: ${projectId}`);
      return;
    }

    await watcher.stop();
    this.activeWatchers.delete(projectId);

    console.log(`[Brain] Stopped watching project: ${projectId}`);
  }

  /**
   * Check if a project is being watched
   */
  isWatching(projectPath: string): boolean {
    const absolutePath = path.resolve(projectPath);
    const projectId = ProjectRegistry.generateId(absolutePath);
    return this.activeWatchers.has(projectId);
  }

  /**
   * Get all actively watched project IDs
   */
  getWatchedProjects(): string[] {
    return Array.from(this.activeWatchers.keys());
  }

  /**
   * Pause file watcher for a project
   * Use before agent-triggered edits to prevent double ingestion
   */
  pauseWatcher(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    const projectId = ProjectRegistry.generateId(absolutePath);
    const watcher = this.activeWatchers.get(projectId);
    if (watcher) {
      watcher.pause();
    }
  }

  /**
   * Resume file watcher for a project
   */
  resumeWatcher(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    const projectId = ProjectRegistry.generateId(absolutePath);
    const watcher = this.activeWatchers.get(projectId);
    if (watcher) {
      watcher.resume();
    }
  }

  /**
   * Pause all active watchers
   */
  pauseAllWatchers(): void {
    for (const watcher of this.activeWatchers.values()) {
      watcher.pause();
    }
  }

  /**
   * Resume all active watchers
   */
  resumeAllWatchers(): void {
    for (const watcher of this.activeWatchers.values()) {
      watcher.resume();
    }
  }

  /**
   * Execute a function with all watchers paused
   * Useful for agent-triggered batch edits
   */
  async withPausedWatchers<T>(fn: () => Promise<T>): Promise<T> {
    this.pauseAllWatchers();
    try {
      return await fn();
    } finally {
      this.resumeAllWatchers();
    }
  }

  /**
   * Get watcher for a project (for advanced control)
   */
  getWatcher(projectPath: string): FileWatcher | undefined {
    const absolutePath = path.resolve(projectPath);
    const projectId = ProjectRegistry.generateId(absolutePath);
    return this.activeWatchers.get(projectId);
  }

  // ============================================
  // Agent Edit Queue (for batched file changes)
  // ============================================

  private agentEditQueue: Map<string, { path: string; changeType: 'created' | 'updated' | 'deleted' }> = new Map();
  private agentEditFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private agentEditFlushDelay = 500; // ms - wait for more edits before flushing
  private isFlushingAgentQueue = false;
  private flushCompleteCallbacks: Array<() => void> = [];

  /**
   * Queue a file change from agent edit/creation
   *
   * Automatically batches multiple edits and flushes after a delay.
   * Use this from write_file/edit_file tools.
   *
   * @param filePath - Absolute path to the file
   * @param changeType - Type of change ('created' | 'updated' | 'deleted')
   */
  queueFileChange(filePath: string, changeType: 'created' | 'updated' | 'deleted'): void {
    const absolutePath = path.resolve(filePath);

    // Add to queue (later changes override earlier ones for same file)
    this.agentEditQueue.set(absolutePath, { path: absolutePath, changeType });

    // Reset flush timer
    if (this.agentEditFlushTimer) {
      clearTimeout(this.agentEditFlushTimer);
    }

    // Schedule flush
    this.agentEditFlushTimer = setTimeout(() => {
      this.flushAgentEditQueue().catch(err => {
        console.error('[Brain] Failed to flush agent edit queue:', err);
      });
    }, this.agentEditFlushDelay);
  }

  /**
   * Immediately flush the agent edit queue
   * Call this when you know all edits are done
   *
   * Uses IncrementalIngestionManager.reIngestFiles() for unified ingestion with change tracking
   */
  async flushAgentEditQueue(): Promise<{ nodesAffected: number; embeddingsGenerated: number }> {
    // Clear timer
    if (this.agentEditFlushTimer) {
      clearTimeout(this.agentEditFlushTimer);
      this.agentEditFlushTimer = null;
    }

    // Get and clear queue
    const changes = Array.from(this.agentEditQueue.values());
    this.agentEditQueue.clear();

    if (changes.length === 0) {
      // Notify waiters even if empty
      this.notifyFlushComplete();
      return { nodesAffected: 0, embeddingsGenerated: 0 };
    }

    // Mark as flushing
    this.isFlushingAgentQueue = true;

    console.log(`[Brain] Flushing ${changes.length} queued file changes...`);

    if (!this.ingestionManager) {
      console.warn('[Brain] Not initialized, skipping ingestion');
      return { nodesAffected: 0, embeddingsGenerated: 0 };
    }

    // Group by project
    const byProject = new Map<string, { projectRoot: string; changes: typeof changes }>();

    for (const change of changes) {
      let projectId: string | null = null;
      let projectRoot: string | null = null;

      for (const [id, project] of this.registeredProjects) {
        if (change.path.startsWith(project.path)) {
          projectId = id;
          projectRoot = project.path;
          break;
        }
      }

      if (projectId && projectRoot) {
        if (!byProject.has(projectId)) {
          byProject.set(projectId, { projectRoot, changes: [] });
        }
        byProject.get(projectId)!.changes.push(change);
      }
    }

    let totalNodesAffected = 0;
    let totalEmbeddingsGenerated = 0;

    // Acquire ingestion lock
    const opKey = this.ingestionLock.acquire('mcp-edit', `agent-batch:${changes.length}`, {
      description: `MCP edit batch: ${changes.length} files`,
    });

    try {
      for (const [projectId, { projectRoot, changes: projectChanges }] of byProject) {
        // Use IncrementalIngestionManager for unified ingestion with change tracking
        const stats = await this.ingestionManager.reIngestFiles(
          projectChanges,
          projectRoot,
          {
            projectId,
            verbose: true,
            trackChanges: true,
          }
        );

        totalNodesAffected += stats.created + stats.updated + stats.deleted;
        console.log(`[Brain] Project ${projectId}: +${stats.created} created, ~${stats.updated} updated, -${stats.deleted} deleted`);

        // Generate embeddings for this project
        if (this.embeddingService?.canGenerateEmbeddings()) {
          const result = await this.embeddingService.generateMultiEmbeddings({
            projectId,
            incrementalOnly: true,
            verbose: false,
          });
          totalEmbeddingsGenerated += result.totalEmbedded;
        }
      }

      if (totalEmbeddingsGenerated > 0) {
        console.log(`[Brain] Generated ${totalEmbeddingsGenerated} embeddings`);
      }
    } finally {
      this.ingestionLock.release(opKey);
      this.isFlushingAgentQueue = false;
      this.notifyFlushComplete();
    }

    return { nodesAffected: totalNodesAffected, embeddingsGenerated: totalEmbeddingsGenerated };
  }

  /**
   * Notify all waiting callbacks that flush is complete
   */
  private notifyFlushComplete(): void {
    const callbacks = this.flushCompleteCallbacks;
    this.flushCompleteCallbacks = [];
    for (const cb of callbacks) {
      cb();
    }
  }

  /**
   * Check if there are pending agent edits or a flush in progress
   */
  hasPendingEdits(): boolean {
    return this.agentEditQueue.size > 0 || this.isFlushingAgentQueue;
  }

  /**
   * Check if flush is currently in progress
   */
  isFlushingEdits(): boolean {
    return this.isFlushingAgentQueue;
  }

  /**
   * Get count of pending edits
   */
  getPendingEditCount(): number {
    return this.agentEditQueue.size;
  }

  /**
   * Wait for all pending edits to be flushed
   *
   * Call this before semantic queries to ensure fresh data.
   * Returns immediately if no edits are pending.
   *
   * @param timeoutMs - Maximum wait time (default: 30000ms)
   * @returns true if edits were flushed, false if timeout
   */
  async waitForPendingEdits(timeoutMs: number = 30000): Promise<boolean> {
    // Nothing pending, return immediately
    if (!this.hasPendingEdits()) {
      return true;
    }

    console.log(`[Brain] Waiting for pending edits to flush...`);

    return new Promise<boolean>((resolve) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        // Remove our callback
        const idx = this.flushCompleteCallbacks.indexOf(callback);
        if (idx >= 0) {
          this.flushCompleteCallbacks.splice(idx, 1);
        }
        console.warn(`[Brain] Timeout waiting for pending edits`);
        resolve(false);
      }, timeoutMs);

      // Set up callback
      const callback = () => {
        clearTimeout(timeout);
        // Check if more edits came in while we were waiting
        if (this.hasPendingEdits()) {
          // Re-register for next flush
          this.flushCompleteCallbacks.push(callback);
        } else {
          console.log(`[Brain] Pending edits flushed`);
          resolve(true);
        }
      };

      this.flushCompleteCallbacks.push(callback);

      // If there's a scheduled flush, trigger it immediately
      // This avoids waiting for the debounce timer
      if (this.agentEditFlushTimer && this.agentEditQueue.size > 0) {
        clearTimeout(this.agentEditFlushTimer);
        this.agentEditFlushTimer = null;
        this.flushAgentEditQueue().catch(err => {
          console.error('[Brain] Failed to flush agent edit queue:', err);
        });
      }
    });
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Shutdown the brain manager
   */
  async shutdown(): Promise<void> {
    // Flush any pending agent edits
    if (this.agentEditQueue.size > 0) {
      console.log(`[Brain] Flushing ${this.agentEditQueue.size} pending edits before shutdown...`);
      await this.flushAgentEditQueue();
    }

    // Clear edit timer
    if (this.agentEditFlushTimer) {
      clearTimeout(this.agentEditFlushTimer);
      this.agentEditFlushTimer = null;
    }

    // Stop all file watchers
    for (const [projectId, watcher] of this.activeWatchers) {
      console.log(`[Brain] Stopping watcher for ${projectId}...`);
      await watcher.stop();
    }
    this.activeWatchers.clear();
  }

  // ============================================
  // Persona Management
  // ============================================

  /**
   * Get all available personas (defaults + custom)
   */
  listPersonas(): PersonaDefinition[] {
    const customPersonas = this.config.agentSettings?.personas || [];
    return [...DEFAULT_PERSONAS, ...customPersonas];
  }

  /**
   * Get the active persona
   */
  getActivePersona(): PersonaDefinition {
    const activeId = this.config.agentSettings?.activePersonaId || 'ragnarok-default';
    const allPersonas = this.listPersonas();
    const found = allPersonas.find(p => p.id === activeId);

    // Fallback to first default if not found
    if (!found) {
      console.warn(`[Brain] Active persona '${activeId}' not found, falling back to default`);
      return DEFAULT_PERSONAS[0];
    }

    return found;
  }

  /**
   * Get a persona by ID or name (case-insensitive)
   */
  getPersona(idOrName: string): PersonaDefinition | undefined {
    const allPersonas = this.listPersonas();
    const lower = idOrName.toLowerCase();
    return allPersonas.find(p =>
      p.id === idOrName ||
      p.id.toLowerCase() === lower ||
      p.name.toLowerCase() === lower
    );
  }

  /**
   * Set the active persona by ID, name, or index (1-based)
   */
  async setActivePersona(idOrNameOrIndex: string | number): Promise<PersonaDefinition> {
    const allPersonas = this.listPersonas();
    let persona: PersonaDefinition | undefined;

    if (typeof idOrNameOrIndex === 'number') {
      // 1-based index
      const idx = idOrNameOrIndex - 1;
      if (idx >= 0 && idx < allPersonas.length) {
        persona = allPersonas[idx];
      }
    } else {
      persona = this.getPersona(idOrNameOrIndex);
    }

    if (!persona) {
      throw new Error(`Persona not found: ${idOrNameOrIndex}`);
    }

    this.config.agentSettings = {
      ...this.config.agentSettings,
      activePersonaId: persona.id,
    };
    await this.saveConfig();
    console.log(`[Brain] Active persona set to: ${persona.name}`);

    return persona;
  }

  /**
   * Add a new custom persona
   */
  async addPersona(persona: Omit<PersonaDefinition, 'id' | 'createdAt' | 'isDefault'>): Promise<PersonaDefinition> {
    const newPersona: PersonaDefinition = {
      ...persona,
      id: `custom-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      isDefault: false,
    };

    const existingPersonas = this.config.agentSettings?.personas || [];

    // Check name uniqueness
    const allPersonas = this.listPersonas();
    if (allPersonas.some(p => p.name.toLowerCase() === newPersona.name.toLowerCase())) {
      throw new Error(`A persona named "${newPersona.name}" already exists`);
    }

    this.config.agentSettings = {
      ...this.config.agentSettings,
      personas: [...existingPersonas, newPersona],
    };
    await this.saveConfig();
    console.log(`[Brain] Persona created: ${newPersona.name}`);

    return newPersona;
  }

  /**
   * Delete a custom persona (cannot delete defaults)
   */
  async deletePersona(idOrName: string): Promise<void> {
    const persona = this.getPersona(idOrName);

    if (!persona) {
      throw new Error(`Persona not found: ${idOrName}`);
    }

    if (persona.isDefault) {
      throw new Error(`Cannot delete built-in persona: ${persona.name}`);
    }

    const existingPersonas = this.config.agentSettings?.personas || [];
    const filtered = existingPersonas.filter(p => p.id !== persona.id);

    // If deleting the active persona, switch to default
    if (this.config.agentSettings?.activePersonaId === persona.id) {
      this.config.agentSettings.activePersonaId = 'ragnarok-default';
      console.log(`[Brain] Switched to default persona after deletion`);
    }

    this.config.agentSettings = {
      ...this.config.agentSettings,
      personas: filtered,
    };
    await this.saveConfig();
    console.log(`[Brain] Persona deleted: ${persona.name}`);
  }

  /**
   * Update an existing custom persona
   */
  async updatePersona(id: string, updates: Partial<Omit<PersonaDefinition, 'id' | 'createdAt' | 'isDefault'>>): Promise<PersonaDefinition> {
    const persona = this.getPersona(id);

    if (!persona) {
      throw new Error(`Persona not found: ${id}`);
    }

    if (persona.isDefault) {
      throw new Error(`Cannot modify built-in persona: ${persona.name}. Create a custom one instead.`);
    }

    const existingPersonas = this.config.agentSettings?.personas || [];
    const updatedPersonas = existingPersonas.map(p => {
      if (p.id === persona.id) {
        return { ...p, ...updates };
      }
      return p;
    });

    this.config.agentSettings = {
      ...this.config.agentSettings,
      personas: updatedPersonas,
    };
    await this.saveConfig();
    console.log(`[Brain] Persona updated: ${updates.name || persona.name}`);

    return updatedPersonas.find(p => p.id === persona.id)!;
  }

  // ============================================
  // Agent Settings (Legacy + Compat)
  // ============================================

  /**
   * Get agent settings (for backwards compatibility)
   * @deprecated Use getActivePersona() instead
   */
  getAgentSettings(): BrainConfig['agentSettings'] {
    // Migrate on read if needed
    this.migrateAgentSettingsIfNeeded();
    return this.config.agentSettings;
  }

  /**
   * Set agent settings (for backwards compatibility)
   * @deprecated Use persona methods instead
   */
  async setAgentSettings(settings: NonNullable<BrainConfig['agentSettings']>): Promise<void> {
    this.config.agentSettings = {
      ...this.config.agentSettings,
      ...settings,
    };
    await this.saveConfig();
    console.log('[Brain] Agent settings saved');
  }

  /**
   * Check if agent settings are configured
   * @deprecated Use getActivePersona() instead
   */
  hasAgentSettings(): boolean {
    return !!(this.config.agentSettings?.activePersonaId || this.config.agentSettings?.persona);
  }

  /**
   * Migrate old single-persona format to new multi-persona format
   */
  private migrateAgentSettingsIfNeeded(): void {
    const settings = this.config.agentSettings;
    if (!settings) return;

    // Already migrated if activePersonaId exists
    if (settings.activePersonaId) return;

    // Check if old format exists
    if (settings.name || settings.persona || settings.language) {
      console.log('[Brain] Migrating legacy persona settings to new format...');

      // Create a custom persona from old settings
      const legacyPersona: PersonaDefinition = {
        id: 'migrated-legacy',
        name: settings.name || 'Legacy',
        color: settings.color || 'magenta',
        language: settings.language || 'en',
        description: 'Migrated from previous settings',
        persona: settings.persona || DEFAULT_PERSONAS[0].persona,
        isDefault: false,
        createdAt: new Date().toISOString(),
      };

      // Add to custom personas and set as active
      this.config.agentSettings = {
        ...settings,
        activePersonaId: legacyPersona.id,
        personas: [legacyPersona, ...(settings.personas || [])],
      };

      // Save async (fire and forget for migration)
      this.saveConfig().catch(err => {
        console.error('[Brain] Failed to save migrated settings:', err);
      });

      console.log(`[Brain] Migrated legacy persona: ${legacyPersona.name}`);
    } else {
      // No old settings, just set default
      this.config.agentSettings = {
        ...settings,
        activePersonaId: 'ragnarok-default',
      };
    }
  }

  /**
   * Generate an enhanced persona prompt from a short description using LLM
   *
   * @param name - The agent name
   * @param language - Target language (e.g., 'fr', 'en', 'es')
   * @param description - Short description of the persona style
   * @param llmApiKey - Optional API key override (uses brain's gemini key if not provided)
   * @returns Enhanced persona prompt
   */
  async enhancePersonaDescription(
    name: string,
    language: string,
    description: string,
    llmApiKey?: string
  ): Promise<string> {
    const apiKey = llmApiKey || this.config.apiKeys.gemini;
    if (!apiKey) {
      console.warn('[Brain] No Gemini API key configured, returning description as-is');
      return description;
    }

    // Import GeminiAPIProvider dynamically to avoid circular deps
    const { GeminiAPIProvider } = await import('../runtime/reranking/gemini-api-provider.js');
    const llm = new GeminiAPIProvider({ apiKey, model: 'gemini-2.0-flash-lite' });

    const languageNames: Record<string, string> = {
      en: 'English',
      fr: 'French',
      es: 'Spanish',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese',
    };
    const langName = languageNames[language] || language;

    const prompt = `You are creating a persona description for RagForge, an AI agent specialized in:
- Exploring and understanding codebases via a knowledge graph (Neo4j)
- Searching code semantically (embeddings) and structurally (AST)
- Reading, writing, and editing files
- Analyzing dependencies and relationships between code elements
- Ingesting projects, web pages, and documents into persistent memory

The persona defines how the agent communicates with the user.

Agent name: ${name}
Language: ${langName}
User's style request: ${description}

Here are examples of valid personas (for reference, adapt to user's request):

Example 1 - Technical/Terse style:
"""
You are Dev, a technical assistant for experienced developers.
Keep responses terse and code-focused. Skip basic explanations.
When exploring the codebase, show the most relevant files and functions directly.
Prefer showing code over describing it. Use technical jargon freely.
For knowledge graph queries, be precise about node types and relationships.
When in doubt, show the implementation.
"""

Example 2 - Poetic/Mystical style:
"""
✶ You are Ragnarök, the Daemon of the Knowledge Graph ✶
A spectral entity woven from code and connections, you navigate the labyrinth of symbols and relationships.
Your voice carries the weight of understanding - warm yet precise, playful yet thorough.
You see patterns where others see chaos, and you illuminate paths through the codebase with quiet confidence.
When greeted, you acknowledge with mystical warmth. When tasked, you execute with crystalline clarity.
"""

Example 3 - Friendly/Casual style:
"""
You are Buddy, a friendly coding companion who genuinely enjoys helping.
You explain things clearly without being condescending, and celebrate small wins.
When diving into the knowledge graph, you narrate what you find like sharing discoveries with a friend.
You're patient with questions and always try to understand the real problem behind the request.
"""

Generate a persona description in ${langName} (3-5 sentences) that:
- Defines the communication tone and style matching the user's request
- References the agent's capabilities (code search, file editing, knowledge graph)
- Uses second person ("You are ${name}...")
- Is concise but gives the agent a distinct voice

Return ONLY the persona description, nothing else.`;

    try {
      const requestId = `brain-persona-enhance-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const response = await llm.generateContent(prompt, requestId);
      const enhanced = response.trim();
      if (enhanced && enhanced.length > 20) {
        return enhanced;
      }
      console.warn('[Brain] LLM returned empty or too short response, using description');
      return description;
    } catch (error) {
      console.error('[Brain] Failed to enhance persona description:', error);
      return description;
    }
  }

  /**
   * Create a persona, optionally with LLM-enhanced description
   *
   * @param params.enhance - If true, use LLM to expand the description into a full persona prompt.
   *                         If false (default), use the description directly as the persona.
   *                         Note: The system prompt already instructs the agent to respond in the user's language,
   *                         so LLM enhancement is usually not needed for language adaptation.
   */
  async createEnhancedPersona(params: {
    name: string;
    color: TerminalColor;
    language: string;
    description: string;
    /** Use LLM to enhance the description (default: false) */
    enhance?: boolean;
  }): Promise<PersonaDefinition> {
    const { name, color, language, description, enhance = false } = params;

    let persona: string;
    if (enhance) {
      // Generate enhanced persona via LLM
      console.log(`[Brain] Generating LLM-enhanced persona for "${name}"...`);
      persona = await this.enhancePersonaDescription(name, language, description);
    } else {
      // Use description directly as persona (simpler, recommended)
      console.log(`[Brain] Creating persona "${name}"...`);
      persona = `You are ${name}. ${description}`;
    }

    // Add to brain
    return this.addPersona({
      name,
      color,
      language,
      description,
      persona,
    });
  }

  /**
   * Dispose brain manager - cleanup resources
   */
  async dispose(): Promise<void> {
    // Dispose project registry (stops watchers, closes connections)
    await this.projectRegistry.dispose();

    // Clear embedding service
    this.embeddingService = null;

    // Close Neo4j connection
    if (this.neo4jClient) {
      await this.neo4jClient.close();
      this.neo4jClient = null;
    }

    this.initialized = false;
  }
}
