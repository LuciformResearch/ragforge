/**
 * Context Tools
 *
 * Agent tools for getting context information about the current environment.
 *
 * @since 2025-12-07
 */

import type { GeneratedToolDefinition } from './types/index.js';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// ============================================
// Types
// ============================================

export interface ContextToolsContext {
  /**
   * Project root directory
   * Can be a string or a getter function for dynamic resolution
   */
  projectRoot: string | (() => string | null);

  /**
   * Whether a project is loaded
   */
  isProjectLoaded: boolean | (() => boolean);

  /**
   * Whether Neo4j is connected
   */
  isNeo4jConnected?: boolean | (() => boolean);

  /**
   * Current project name (if any)
   */
  projectName?: string | (() => string | null);

  /**
   * Get loaded projects list (for multi-project support)
   */
  getLoadedProjects?: () => Array<{ id: string; path: string; active: boolean }>;
}

/**
 * Helper to resolve values from context (handles both value and getter)
 */
function resolveValue<T>(value: T | (() => T)): T {
  if (typeof value === 'function') {
    return (value as () => T)();
  }
  return value;
}

// ============================================
// Tool Definitions
// ============================================

export function generateGetWorkingDirectoryTool(): GeneratedToolDefinition {
  return {
    name: 'get_working_directory',
    description: `Get the current working directory and project context.

Returns:
- cwd: Current working directory (process.cwd)
- project_root: Loaded project root (if any)
- project_loaded: Whether a RagForge project is loaded
- neo4j_connected: Whether Neo4j is connected
- loaded_projects: List of loaded projects (multi-project mode)

Use this to understand where you are before file operations.

Example: get_working_directory()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

export function generateGetEnvironmentInfoTool(): GeneratedToolDefinition {
  return {
    name: 'get_environment_info',
    description: `Get information about the runtime environment.

Returns: Node version, OS, platform, architecture, home directory, etc.

Useful for understanding the execution context and available tools.

Example: get_environment_info()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

export function generateGetProjectInfoTool(): GeneratedToolDefinition {
  return {
    name: 'get_project_info',
    description: `Get detailed information about the loaded project.

Returns: package.json info, ragforge config, git info, etc.

Example: get_project_info()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export function generateGetWorkingDirectoryHandler(ctx: ContextToolsContext) {
  return async () => {
    const projectRoot = resolveValue(ctx.projectRoot);
    const isProjectLoaded = resolveValue(ctx.isProjectLoaded);
    const isNeo4jConnected = ctx.isNeo4jConnected ? resolveValue(ctx.isNeo4jConnected) : undefined;
    const projectName = ctx.projectName ? resolveValue(ctx.projectName) : undefined;
    const loadedProjects = ctx.getLoadedProjects ? ctx.getLoadedProjects() : undefined;

    return {
      cwd: process.cwd(),
      project_root: projectRoot,
      project_name: projectName,
      project_loaded: isProjectLoaded,
      neo4j_connected: isNeo4jConnected,
      loaded_projects: loadedProjects,
      home_directory: os.homedir(),
    };
  };
}

export function generateGetEnvironmentInfoHandler() {
  return async () => {
    // Check for common tools
    const checkCommand = async (cmd: string): Promise<boolean> => {
      try {
        const { execSync } = await import('child_process');
        execSync(`which ${cmd}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    };

    const [hasGit, hasDocker, hasNode, hasPython] = await Promise.all([
      checkCommand('git'),
      checkCommand('docker'),
      checkCommand('node'),
      checkCommand('python3').then(r => r || checkCommand('python')),
    ]);

    return {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      os_type: os.type(),
      os_release: os.release(),
      home_directory: os.homedir(),
      temp_directory: os.tmpdir(),
      cpu_cores: os.cpus().length,
      total_memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10,
      free_memory_gb: Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10,
      shell: process.env.SHELL || 'unknown',
      user: os.userInfo().username,
      available_tools: {
        git: hasGit,
        docker: hasDocker,
        node: hasNode,
        python: hasPython,
      },
    };
  };
}

export function generateGetProjectInfoHandler(ctx: ContextToolsContext) {
  return async () => {
    const projectRoot = resolveValue(ctx.projectRoot);

    if (!projectRoot) {
      return {
        error: 'No project loaded',
        suggestion: 'Use create_project, setup_project, or load_project first.',
      };
    }

    const result: Record<string, any> = {
      project_root: projectRoot,
    };

    // Read package.json
    try {
      const packageJsonPath = path.join(projectRoot, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      result.package = {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        scripts: Object.keys(packageJson.scripts || {}),
        dependencies_count: Object.keys(packageJson.dependencies || {}).length,
        dev_dependencies_count: Object.keys(packageJson.devDependencies || {}).length,
      };
    } catch {
      result.package = null;
    }

    // Read ragforge config
    try {
      const ragforgeConfigPath = path.join(projectRoot, '.ragforge', 'ragforge.config.yaml');
      const configContent = await fs.readFile(ragforgeConfigPath, 'utf-8');
      const yaml = await import('js-yaml');
      const config = yaml.load(configContent) as any;
      result.ragforge = {
        name: config.name,
        source_type: config.source?.type,
        entities: (config.entities || []).map((e: any) => e.name),
        has_embeddings: !!config.embeddings,
      };
    } catch {
      // Try alternate location
      try {
        const ragforgeConfigPath = path.join(projectRoot, '.ragforge', 'generated', 'ragforge.config.yaml');
        const configContent = await fs.readFile(ragforgeConfigPath, 'utf-8');
        const yaml = await import('js-yaml');
        const config = yaml.load(configContent) as any;
        result.ragforge = {
          name: config.name,
          source_type: config.source?.type,
          entities: (config.entities || []).map((e: any) => e.name),
          has_embeddings: !!config.embeddings,
        };
      } catch {
        result.ragforge = null;
      }
    }

    // Get git info
    try {
      const { execSync } = await import('child_process');
      const branch = execSync('git branch --show-current', { cwd: projectRoot, encoding: 'utf-8' }).trim();
      const remoteUrl = execSync('git remote get-url origin', { cwd: projectRoot, encoding: 'utf-8' }).trim();
      const lastCommit = execSync('git log -1 --format="%h %s"', { cwd: projectRoot, encoding: 'utf-8' }).trim();

      result.git = {
        branch,
        remote_url: remoteUrl,
        last_commit: lastCommit,
      };
    } catch {
      result.git = null;
    }

    // Count files by type
    try {
      const glob = (await import('glob')).glob;
      const [tsFiles, jsFiles, vueFiles, pyFiles] = await Promise.all([
        glob('**/*.ts', { cwd: projectRoot, ignore: ['**/node_modules/**', '**/dist/**'] }),
        glob('**/*.js', { cwd: projectRoot, ignore: ['**/node_modules/**', '**/dist/**'] }),
        glob('**/*.vue', { cwd: projectRoot, ignore: ['**/node_modules/**', '**/dist/**'] }),
        glob('**/*.py', { cwd: projectRoot, ignore: ['**/node_modules/**', '**/dist/**', '**/__pycache__/**'] }),
      ]);

      result.file_counts = {
        typescript: tsFiles.length,
        javascript: jsFiles.length,
        vue: vueFiles.length,
        python: pyFiles.length,
      };
    } catch {
      result.file_counts = null;
    }

    return result;
  };
}

// ============================================
// Export All Context Tools
// ============================================

export interface ContextToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all context tools with handlers
 */
export function generateContextTools(ctx: ContextToolsContext): ContextToolsResult {
  return {
    tools: [
      generateGetWorkingDirectoryTool(),
      generateGetEnvironmentInfoTool(),
      generateGetProjectInfoTool(),
    ],
    handlers: {
      get_working_directory: generateGetWorkingDirectoryHandler(ctx),
      get_environment_info: generateGetEnvironmentInfoHandler(),
      get_project_info: generateGetProjectInfoHandler(ctx),
    },
  };
}
