/**
 * Brain Manager
 *
 * Central manager for the agent's persistent knowledge base.
 * Manages:
 * - Neo4j connection (embedded or external)
 * - Project registry (loaded projects)
 * - Quick ingest (ad-hoc directories)
 * - Cross-project search
 *
 * Default location: ~/.ragforge/brain/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { Neo4jClient } from '../runtime/client/neo4j-client.js';
import { ProjectRegistry, type LoadedProject, type ProjectType } from '../runtime/projects/project-registry.js';
import { ConfigLoader } from '../config/loader.js';
import { createClient } from '../runtime/index.js';
import type { RagForgeConfig } from '../types/config.js';
import { UniversalSourceAdapter, detectIncludePatterns } from '../runtime/adapters/universal-source-adapter.js';
import type { ParseResult } from '../runtime/adapters/types.js';

// ============================================
// Types
// ============================================

export interface BrainConfig {
  /** Path to brain directory (default: ~/.ragforge) */
  path: string;

  /** Neo4j configuration */
  neo4j: {
    /** Use embedded or external Neo4j */
    type: 'embedded' | 'external';
    /** URI for external Neo4j */
    uri?: string;
    /** Username for external Neo4j */
    username?: string;
    /** Password for external Neo4j */
    password?: string;
    /** Database name */
    database?: string;
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
}

export interface RegisteredProject {
  /** Unique project ID */
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
}

export interface ProjectsRegistry {
  version: number;
  projects: RegisteredProject[];
}

export interface QuickIngestOptions {
  /** Watch for changes after initial ingest */
  watch?: boolean;
  /** Generate embeddings */
  generateEmbeddings?: boolean;
  /** Custom project name */
  projectName?: string;
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
}

export interface QuickIngestResult {
  projectId: string;
  stats: {
    filesProcessed: number;
    nodesCreated: number;
    embeddingsGenerated?: number;
  };
  configPath: string;
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
  /** Text pattern match */
  textMatch?: string;
  /** Result limit */
  limit?: number;
  /** Result offset */
  offset?: number;
}

export interface BrainSearchResult {
  node: Record<string, any>;
  score: number;
  projectId: string;
  projectPath: string;
  projectType: string;
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
    type: 'external', // For now, require external Neo4j
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password',
    database: 'neo4j',
  },
  embeddings: {
    provider: 'gemini',
    model: 'text-embedding-004',
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

  private constructor(config: BrainConfig) {
    this.config = config;
    this.projectRegistry = new ProjectRegistry({
      memoryPolicy: {
        maxLoadedProjects: 5,
        idleUnloadTimeout: 10 * 60 * 1000, // 10 minutes
      },
    });
    this.sourceAdapter = new UniversalSourceAdapter();
  }

  /**
   * Get or create the singleton BrainManager instance
   */
  static async getInstance(config?: Partial<BrainConfig>): Promise<BrainManager> {
    if (!BrainManager.instance) {
      const mergedConfig = {
        ...DEFAULT_BRAIN_CONFIG,
        ...config,
        neo4j: { ...DEFAULT_BRAIN_CONFIG.neo4j, ...config?.neo4j },
        embeddings: { ...DEFAULT_BRAIN_CONFIG.embeddings, ...config?.embeddings },
        cleanup: { ...DEFAULT_BRAIN_CONFIG.cleanup, ...config?.cleanup },
      };
      BrainManager.instance = new BrainManager(mergedConfig);
    }
    return BrainManager.instance;
  }

  /**
   * Initialize the brain (create directories, load registry, connect to Neo4j)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Create brain directory structure
    await this.ensureBrainDirectories();

    // 2. Load or create config
    await this.loadOrCreateConfig();

    // 3. Load projects registry
    await this.loadProjectsRegistry();

    // 4. Connect to Neo4j
    await this.connectNeo4j();

    this.initialized = true;
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
   * Load or create brain config file
   */
  private async loadOrCreateConfig(): Promise<void> {
    const configPath = path.join(this.config.path, 'config.yaml');

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const loadedConfig = yaml.load(content) as Partial<BrainConfig>;

      // Merge loaded config with defaults
      this.config = {
        ...this.config,
        ...loadedConfig,
        neo4j: { ...this.config.neo4j, ...loadedConfig?.neo4j },
        embeddings: { ...this.config.embeddings, ...loadedConfig?.embeddings },
        cleanup: { ...this.config.cleanup, ...loadedConfig?.cleanup },
      };
    } catch {
      // Config doesn't exist, create it
      await this.saveConfig();
    }
  }

  /**
   * Save brain config to file
   */
  private async saveConfig(): Promise<void> {
    const configPath = path.join(this.config.path, 'config.yaml');
    const content = yaml.dump(this.config, { indent: 2 });
    await fs.writeFile(configPath, content, 'utf-8');
  }

  /**
   * Load projects registry from file
   */
  private async loadProjectsRegistry(): Promise<void> {
    const registryPath = path.join(this.config.path, 'projects.yaml');

    try {
      const content = await fs.readFile(registryPath, 'utf-8');
      const registry = yaml.load(content) as ProjectsRegistry;

      for (const project of registry.projects || []) {
        this.registeredProjects.set(project.id, {
          ...project,
          lastAccessed: new Date(project.lastAccessed),
        });
      }
    } catch {
      // Registry doesn't exist, start fresh
    }
  }

  /**
   * Save projects registry to file
   */
  private async saveProjectsRegistry(): Promise<void> {
    const registryPath = path.join(this.config.path, 'projects.yaml');
    const registry: ProjectsRegistry = {
      version: 1,
      projects: Array.from(this.registeredProjects.values()).map(p => ({
        ...p,
        lastAccessed: p.lastAccessed,
      })),
    };
    const content = yaml.dump(registry, { indent: 2 });
    await fs.writeFile(registryPath, content, 'utf-8');
  }

  /**
   * Connect to Neo4j
   */
  private async connectNeo4j(): Promise<void> {
    if (this.config.neo4j.type === 'external') {
      this.neo4jClient = new Neo4jClient({
        uri: this.config.neo4j.uri!,
        username: this.config.neo4j.username!,
        password: this.config.neo4j.password!,
        database: this.config.neo4j.database,
      });

      // Verify connection
      await this.neo4jClient.verifyConnectivity();
    } else {
      // TODO: Support embedded Neo4j in the future
      throw new Error('Embedded Neo4j not yet supported. Use external Neo4j.');
    }
  }

  // ============================================
  // Project Management
  // ============================================

  /**
   * Register a project in the brain
   */
  async registerProject(projectPath: string, type: ProjectType = 'ragforge-project'): Promise<string> {
    const absolutePath = path.resolve(projectPath);
    const projectId = ProjectRegistry.generateId(absolutePath);

    // Check if already registered
    if (this.registeredProjects.has(projectId)) {
      const existing = this.registeredProjects.get(projectId)!;
      existing.lastAccessed = new Date();
      await this.saveProjectsRegistry();
      return projectId;
    }

    // Count nodes for this project
    const nodeCount = await this.countProjectNodes(projectId);

    // Register
    const registered: RegisteredProject = {
      id: projectId,
      path: absolutePath,
      type,
      lastAccessed: new Date(),
      nodeCount,
      autoCleanup: type === 'quick-ingest',
    };

    this.registeredProjects.set(projectId, registered);
    await this.saveProjectsRegistry();

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
   * List all registered projects
   */
  listProjects(): RegisteredProject[] {
    return Array.from(this.registeredProjects.values());
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
   */
  async quickIngest(dirPath: string, options: QuickIngestOptions = {}): Promise<QuickIngestResult> {
    const absolutePath = path.resolve(dirPath);

    // Generate project ID
    const projectId = options.projectName
      ? options.projectName.toLowerCase().replace(/\s+/g, '-')
      : ProjectRegistry.generateId(absolutePath);

    // Create .ragforge directory with brain-link
    const ragforgeDir = path.join(absolutePath, '.ragforge');
    await fs.mkdir(ragforgeDir, { recursive: true });

    // Create brain-link.yaml
    const brainLinkPath = path.join(ragforgeDir, 'brain-link.yaml');
    await fs.writeFile(brainLinkPath, yaml.dump({
      brainPath: this.config.path,
      projectId,
      linkedAt: new Date().toISOString(),
    }), 'utf-8');

    // Auto-detect file patterns using UniversalFileAdapter
    const detectedPatterns = options.include || await detectIncludePatterns(absolutePath);
    const detected = await this.detectFileTypes(absolutePath);

    // Create source config
    const sourceConfig = {
      type: 'files' as const,
      root: absolutePath,
      include: detectedPatterns,
      exclude: options.exclude || ['node_modules', '.git', 'dist', '__pycache__', 'target', '.ragforge'],
    };

    // Create auto-config for reference
    const autoConfig = this.generateAutoConfig(detected, options);
    const autoConfigPath = path.join(ragforgeDir, 'auto-config.yaml');
    await fs.writeFile(autoConfigPath, yaml.dump(autoConfig), 'utf-8');

    // Perform actual ingestion using UniversalSourceAdapter
    let parseResult: ParseResult;
    try {
      parseResult = await this.sourceAdapter.parse({
        source: sourceConfig,
        onProgress: (progress) => {
          // Could emit events here for progress tracking
          console.log(`[QuickIngest] ${progress.phase}: ${progress.filesProcessed}/${progress.totalFiles} files`);
        },
      });
    } catch (error) {
      console.error('[QuickIngest] Parse error:', error);
      throw error;
    }

    // Write nodes to Neo4j with projectId tag
    let nodesCreated = 0;
    if (this.neo4jClient && parseResult.graph.nodes.length > 0) {
      // Add projectId to all nodes
      const nodesWithProjectId = parseResult.graph.nodes.map(node => ({
        ...node,
        properties: {
          ...node.properties,
          projectId,
        },
      }));

      // Batch insert nodes
      for (const node of nodesWithProjectId) {
        try {
          const labels = node.labels.join(':');
          await this.neo4jClient.run(
            `MERGE (n:${labels} {uuid: $uuid})
             SET n += $properties`,
            {
              uuid: node.id,
              properties: node.properties,
            }
          );
          nodesCreated++;
        } catch (err) {
          console.warn(`[QuickIngest] Failed to create node ${node.id}:`, err);
        }
      }

      // Create relationships
      for (const rel of parseResult.graph.relationships) {
        try {
          await this.neo4jClient.run(
            `MATCH (a {uuid: $from}), (b {uuid: $to})
             MERGE (a)-[r:${rel.type}]->(b)
             SET r += $properties`,
            {
              from: rel.from,
              to: rel.to,
              properties: rel.properties || {},
            }
          );
        } catch (err) {
          // Relationships may fail if nodes aren't found, that's OK
        }
      }
    }

    // Register in brain
    await this.registerProject(absolutePath, 'quick-ingest');

    // Update node count
    const project = this.registeredProjects.get(projectId);
    if (project) {
      project.nodeCount = nodesCreated;
      await this.saveProjectsRegistry();
    }

    const stats = {
      filesProcessed: parseResult.graph.metadata.filesProcessed,
      nodesCreated,
      embeddingsGenerated: options.generateEmbeddings ? 0 : undefined, // TODO: Generate embeddings
    };

    return {
      projectId,
      stats,
      configPath: autoConfigPath,
    };
  }

  /**
   * Detect file types in a directory
   */
  private async detectFileTypes(dirPath: string): Promise<{
    patterns: string[];
    primaryLanguage: string | null;
    totalFiles: number;
    hasPackageJson: boolean;
    hasRequirementsTxt: boolean;
    mediaFiles: number;
    documentFiles: number;
  }> {
    const patterns: string[] = [];
    let primaryLanguage: string | null = null;
    let totalFiles = 0;
    let hasPackageJson = false;
    let hasRequirementsTxt = false;
    let mediaFiles = 0;
    let documentFiles = 0;

    const languageCounts: Record<string, number> = {};

    const scanDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip common ignore directories
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', '__pycache__', 'target', '.ragforge'].includes(entry.name)) {
              continue;
            }
            await scanDir(fullPath);
            continue;
          }

          totalFiles++;
          const ext = path.extname(entry.name).toLowerCase();

          // Check for package files
          if (entry.name === 'package.json') hasPackageJson = true;
          if (entry.name === 'requirements.txt') hasRequirementsTxt = true;

          // Count by extension
          const langMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.rs': 'rust',
            '.go': 'go',
            '.java': 'java',
            '.rb': 'ruby',
            '.php': 'php',
            '.cs': 'csharp',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
          };

          const mediaExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.mp3', '.wav'];
          const docExts = ['.md', '.pdf', '.docx', '.txt', '.rst'];

          if (langMap[ext]) {
            const lang = langMap[ext];
            languageCounts[lang] = (languageCounts[lang] || 0) + 1;
            if (!patterns.includes(`**/*${ext}`)) {
              patterns.push(`**/*${ext}`);
            }
          } else if (mediaExts.includes(ext)) {
            mediaFiles++;
          } else if (docExts.includes(ext)) {
            documentFiles++;
            if (!patterns.includes(`**/*${ext}`)) {
              patterns.push(`**/*${ext}`);
            }
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    await scanDir(dirPath);

    // Determine primary language
    let maxCount = 0;
    for (const [lang, count] of Object.entries(languageCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryLanguage = lang;
      }
    }

    return {
      patterns,
      primaryLanguage,
      totalFiles,
      hasPackageJson,
      hasRequirementsTxt,
      mediaFiles,
      documentFiles,
    };
  }

  /**
   * Generate auto-config for quick ingest
   * Uses type: 'files' with auto-detection (no adapter needed)
   */
  private generateAutoConfig(
    detected: Awaited<ReturnType<typeof this.detectFileTypes>>,
    options: QuickIngestOptions
  ): Partial<RagForgeConfig> {
    return {
      name: 'quick-ingest',
      version: '1.0.0',
      source: {
        type: 'files', // Universal type with auto-detection
        root: '.',
        include: options.include || detected.patterns,
        exclude: options.exclude || ['node_modules', '.git', 'dist', '__pycache__', 'target'],
      },
      entities: [], // Will use default code entities
    };
  }

  // ============================================
  // Web Page Ingestion
  // ============================================

  /**
   * Ingest a web page into the brain
   */
  async ingestWebPage(params: {
    url: string;
    title: string;
    textContent: string;
    rawHtml: string;
    projectName?: string;
    generateEmbeddings?: boolean;
  }): Promise<{ success: boolean; nodeId?: string }> {
    if (!this.neo4jClient) {
      throw new Error('Brain not initialized. Call initialize() first.');
    }

    const { UniqueIDHelper } = await import('../runtime/utils/UniqueIDHelper.js');
    // Deterministic UUID based on URL - same URL = same node (upsert)
    const nodeId = UniqueIDHelper.GenerateDeterministicUUID(params.url);
    const projectName = params.projectName || 'web-pages';

    // Ensure project is registered
    const projectId = await this.registerWebProject(projectName);

    // Extract domain
    const urlParsed = new URL(params.url);
    const domain = urlParsed.hostname;

    // Create WebPage node
    await this.neo4jClient.run(
      `MERGE (n:WebPage {url: $url})
       SET n.uuid = $uuid,
           n.title = $title,
           n.domain = $domain,
           n.textContent = $textContent,
           n.rawHtml = $rawHtml,
           n.projectId = $projectId,
           n.ingestedAt = $ingestedAt`,
      {
        uuid: nodeId,
        url: params.url,
        title: params.title,
        domain,
        textContent: params.textContent.slice(0, 100000), // Limit content size
        rawHtml: params.rawHtml,
        projectId,
        ingestedAt: new Date().toISOString(),
      }
    );

    // Update project node count
    const project = this.registeredProjects.get(projectId);
    if (project) {
      project.nodeCount = await this.countProjectNodes(projectId);
      project.lastAccessed = new Date();
      await this.saveProjectsRegistry();
    }

    console.log(`[Brain] Ingested web page: ${params.url} → project ${projectName}`);

    return { success: true, nodeId };
  }

  /**
   * Register or get a web project
   */
  private async registerWebProject(projectName: string): Promise<string> {
    const projectId = `web-${projectName.toLowerCase().replace(/\s+/g, '-')}`;

    if (!this.registeredProjects.has(projectId)) {
      const registered: RegisteredProject = {
        id: projectId,
        path: `web://${projectName}`,
        type: 'web-crawl',
        lastAccessed: new Date(),
        nodeCount: 0,
        autoCleanup: true,
      };
      this.registeredProjects.set(projectId, registered);
      await this.saveProjectsRegistry();
    }

    return projectId;
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

    const limit = options.limit || 20;
    const offset = options.offset || 0;

    // Build project filter
    let projectFilter = '';
    const params: Record<string, any> = { query, limit, offset };

    if (options.projects && options.projects.length > 0) {
      projectFilter = 'AND n.projectId IN $projectIds';
      params.projectIds = options.projects;
    }

    // Build node type filter
    let nodeTypeFilter = '';
    if (options.nodeTypes && options.nodeTypes.length > 0) {
      const labels = options.nodeTypes.map(t => `n:${t}`).join(' OR ');
      nodeTypeFilter = `AND (${labels})`;
    }

    // Execute search
    let cypher: string;
    if (options.semantic) {
      // Semantic search using vector index
      // TODO: Implement proper vector search
      cypher = `
        MATCH (n)
        WHERE n.name CONTAINS $query ${projectFilter} ${nodeTypeFilter}
        RETURN n, 1.0 as score
        ORDER BY n.name
        SKIP $offset
        LIMIT $limit
      `;
    } else {
      // Text search
      cypher = `
        MATCH (n)
        WHERE (n.name CONTAINS $query OR n.content CONTAINS $query) ${projectFilter} ${nodeTypeFilter}
        RETURN n, 1.0 as score
        ORDER BY n.name
        SKIP $offset
        LIMIT $limit
      `;
    }

    const result = await this.neo4jClient.run(cypher, params);

    const results: BrainSearchResult[] = result.records.map(record => {
      const node = record.get('n').properties;
      const score = record.get('score');
      const projectId = node.projectId || 'unknown';
      const project = this.registeredProjects.get(projectId);

      return {
        node,
        score,
        projectId,
        projectPath: project?.path || 'unknown',
        projectType: project?.type || 'unknown',
      };
    });

    // Get total count
    const countCypher = `
      MATCH (n)
      WHERE (n.name CONTAINS $query OR n.content CONTAINS $query) ${projectFilter} ${nodeTypeFilter}
      RETURN count(n) as total
    `;
    const countResult = await this.neo4jClient.run(countCypher, params);
    const totalCount = countResult.records[0]?.get('total')?.toNumber() || 0;

    return {
      results,
      totalCount,
      searchedProjects: options.projects || Array.from(this.registeredProjects.keys()),
    };
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

    // Remove from registry
    this.registeredProjects.delete(project.id);
    await this.saveProjectsRegistry();

    // Remove .ragforge/brain-link.yaml if exists
    try {
      const brainLinkPath = path.join(projectPath, '.ragforge', 'brain-link.yaml');
      await fs.unlink(brainLinkPath);
    } catch {
      // Ignore if doesn't exist
    }
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

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Shutdown the brain manager
   */
  async shutdown(): Promise<void> {
    // Save registry
    await this.saveProjectsRegistry();

    // Dispose project registry (stops watchers, closes connections)
    await this.projectRegistry.dispose();

    // Close Neo4j connection
    if (this.neo4jClient) {
      await this.neo4jClient.close();
      this.neo4jClient = null;
    }

    this.initialized = false;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    BrainManager.instance = null;
  }
}
