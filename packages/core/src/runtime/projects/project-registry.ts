/**
 * Project Registry
 *
 * Manages multiple loaded projects for the agent.
 * Supports:
 * - Loading/unloading projects dynamically
 * - Switching active project
 * - Cross-project queries
 * - Memory management (auto-unload idle projects)
 */

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { RagForgeConfig } from '../../types/config.js';
import type { FileWatcher } from '../adapters/file-watcher.js';
import type { IncrementalIngestionManager } from '../adapters/incremental-ingestion.js';
import type { IngestionLock } from '../../tools/ingestion-lock.js';
import type { AgentLogger } from '../agents/rag-agent.js';
import { splitPath } from '../../utils/path-utils.js';

/**
 * Status of a loaded project
 */
export type ProjectStatus = 'active' | 'background' | 'unloading';

/**
 * Type of project
 */
export type ProjectType = 'quick-ingest' | 'external' | 'touched-files';

/**
 * A loaded project with all its resources
 */
export interface LoadedProject {
  /** Unique identifier (usually derived from path) */
  id: string;

  /** Absolute path to project root */
  path: string;

  /** Project type */
  type: ProjectType;

  /** Loaded configuration */
  config: RagForgeConfig;

  /** Neo4j client connection */
  neo4jClient: Neo4jClient;

  /** RagClient for queries (created from neo4jClient) */
  ragClient: any; // ReturnType<typeof createClient>

  /** File watcher for auto-ingestion */
  fileWatcher?: FileWatcher;

  /** Incremental ingestion manager */
  incrementalManager?: IncrementalIngestionManager;

  /** Ingestion lock for query coordination */
  ingestionLock?: IngestionLock;

  /** Project status */
  status: ProjectStatus;

  /** Last access time (for LRU eviction) */
  lastAccessed: Date;

  /** Optional logger */
  logger?: AgentLogger;
}

/**
 * Memory management policy
 */
export interface ProjectMemoryPolicy {
  /** Maximum number of projects to keep loaded (default: 3) */
  maxLoadedProjects: number;

  /** Time in ms before unloading an idle project (default: 5 minutes) */
  idleUnloadTimeout: number;

  /** Maximum file watchers for background projects (default: 1) */
  backgroundWatcherLimit: number;
}

/**
 * Configuration for creating a new project registry
 */
export interface ProjectRegistryConfig {
  /** Memory management policy */
  memoryPolicy?: Partial<ProjectMemoryPolicy>;

  /** Callback when project is loaded */
  onProjectLoaded?: (project: LoadedProject) => void;

  /** Callback when project is unloaded */
  onProjectUnloaded?: (projectId: string) => void;

  /** Callback when active project changes */
  onActiveProjectChanged?: (projectId: string | null) => void;
}

const DEFAULT_MEMORY_POLICY: ProjectMemoryPolicy = {
  maxLoadedProjects: 3,
  idleUnloadTimeout: 5 * 60 * 1000, // 5 minutes
  backgroundWatcherLimit: 1,
};

/**
 * Registry for managing multiple loaded projects
 */
export class ProjectRegistry {
  private projects: Map<string, LoadedProject> = new Map();
  private activeProjectId: string | null = null;
  private memoryPolicy: ProjectMemoryPolicy;
  private config: ProjectRegistryConfig;
  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: ProjectRegistryConfig = {}) {
    this.config = config;
    this.memoryPolicy = {
      ...DEFAULT_MEMORY_POLICY,
      ...config.memoryPolicy,
    };
  }

  /**
   * Generate a project ID from a path
   */
  static generateId(projectPath: string): string {
    // Use last two path components for readability
    const parts = splitPath(projectPath);
    const relevant = parts.slice(-2).join('-');
    // Add hash suffix for uniqueness
    const hash = projectPath
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
      .toString(36)
      .slice(-4);
    return `${relevant}-${hash}`;
  }

  /**
   * Register a loaded project
   */
  register(project: LoadedProject): void {
    // Update last accessed
    project.lastAccessed = new Date();

    // Add to registry
    this.projects.set(project.id, project);

    // If no active project, make this one active
    if (!this.activeProjectId) {
      this.activeProjectId = project.id;
      project.status = 'active';
      this.config.onActiveProjectChanged?.(project.id);
    } else {
      project.status = 'background';
    }

    // Notify callback
    this.config.onProjectLoaded?.(project);

    // Enforce memory policy
    this.enforceMemoryPolicy();

    // Start idle check if not running
    this.startIdleCheck();
  }

  /**
   * Unload a project and release resources
   */
  async unload(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.status = 'unloading';

    // Stop file watcher
    if (project.fileWatcher) {
      await project.fileWatcher.stop();
    }

    // Close Neo4j connection
    if (project.neo4jClient) {
      await project.neo4jClient.close();
    }

    // Remove from registry
    this.projects.delete(projectId);

    // If this was the active project, switch to another
    if (this.activeProjectId === projectId) {
      const remaining = Array.from(this.projects.keys());
      this.activeProjectId = remaining.length > 0 ? remaining[0] : null;

      if (this.activeProjectId) {
        const newActive = this.projects.get(this.activeProjectId);
        if (newActive) newActive.status = 'active';
      }

      this.config.onActiveProjectChanged?.(this.activeProjectId);
    }

    // Notify callback
    this.config.onProjectUnloaded?.(projectId);
  }

  /**
   * Switch active project
   */
  switch(projectId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // Update previous active to background
    if (this.activeProjectId && this.activeProjectId !== projectId) {
      const prevActive = this.projects.get(this.activeProjectId);
      if (prevActive) prevActive.status = 'background';
    }

    // Set new active
    this.activeProjectId = projectId;
    project.status = 'active';
    project.lastAccessed = new Date();

    // Notify callback
    this.config.onActiveProjectChanged?.(projectId);

    return true;
  }

  /**
   * Get a project by ID
   */
  get(projectId: string): LoadedProject | undefined {
    const project = this.projects.get(projectId);
    if (project) {
      project.lastAccessed = new Date();
    }
    return project;
  }

  /**
   * Get the active project
   */
  getActive(): LoadedProject | undefined {
    if (!this.activeProjectId) return undefined;
    return this.get(this.activeProjectId);
  }

  /**
   * Get all loaded projects
   */
  getAll(): LoadedProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Check if a project is loaded
   */
  isLoaded(projectPath: string): boolean {
    return Array.from(this.projects.values()).some(p => p.path === projectPath);
  }

  /**
   * Find project by path
   */
  findByPath(projectPath: string): LoadedProject | undefined {
    return Array.from(this.projects.values()).find(p => p.path === projectPath);
  }

  /**
   * Get project count
   */
  get count(): number {
    return this.projects.size;
  }

  /**
   * Get active project ID
   */
  get activeId(): string | null {
    return this.activeProjectId;
  }

  /**
   * Enforce memory policy (unload excess projects)
   */
  private enforceMemoryPolicy(): void {
    if (this.projects.size <= this.memoryPolicy.maxLoadedProjects) {
      return;
    }

    // Sort by last accessed (oldest first)
    const sortedProjects = Array.from(this.projects.values())
      .filter(p => p.id !== this.activeProjectId) // Never unload active
      .sort((a, b) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

    // Unload oldest until within limits
    while (
      this.projects.size > this.memoryPolicy.maxLoadedProjects &&
      sortedProjects.length > 0
    ) {
      const oldest = sortedProjects.shift()!;
      this.unload(oldest.id);
    }
  }

  /**
   * Start periodic check for idle projects
   */
  private startIdleCheck(): void {
    if (this.idleCheckInterval) return;

    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();

      for (const project of this.projects.values()) {
        // Skip active project
        if (project.id === this.activeProjectId) continue;

        const idleTime = now - project.lastAccessed.getTime();
        if (idleTime > this.memoryPolicy.idleUnloadTimeout) {
          this.unload(project.id);
        }
      }

      // Stop interval if no projects left
      if (this.projects.size === 0) {
        this.stopIdleCheck();
      }
    }, 60000); // Check every minute
  }

  /**
   * Stop idle check interval
   */
  private stopIdleCheck(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
  }

  /**
   * Cleanup and unload all projects
   */
  async dispose(): Promise<void> {
    this.stopIdleCheck();

    for (const projectId of this.projects.keys()) {
      await this.unload(projectId);
    }
  }
}
