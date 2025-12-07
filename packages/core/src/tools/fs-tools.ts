/**
 * File System Tools
 *
 * Agent tools for file system exploration and manipulation.
 * Uses fs-helpers.ts for actual implementation.
 *
 * @since 2025-12-07
 */

import type { GeneratedToolDefinition } from './types/index.js';
import * as fsHelpers from './fs-helpers.js';

// ============================================
// Types
// ============================================

export interface FsToolsContext {
  /**
   * Project root directory (for relative paths)
   * Can be a string or a getter function for dynamic resolution
   */
  projectRoot: string | (() => string | null);

  /**
   * Callback after file deletion (for Neo4j cleanup)
   */
  onFileDeleted?: (filePath: string) => Promise<void>;

  /**
   * Callback after file move (for Neo4j update)
   */
  onFileMoved?: (source: string, destination: string) => Promise<void>;
}

/**
 * Helper to resolve projectRoot from context
 */
function getProjectRoot(ctx: FsToolsContext): string | null {
  if (typeof ctx.projectRoot === 'function') {
    return ctx.projectRoot();
  }
  return ctx.projectRoot;
}

// ============================================
// Tool Definitions
// ============================================

export function generateListDirectoryTool(): GeneratedToolDefinition {
  return {
    name: 'list_directory',
    description: `List files and directories in a given path.

Returns file names, types (file/directory), sizes, and modification times.
Use this to explore a codebase or check what files exist.

Parameters:
- path: Directory to list (default: project root)
- recursive: Include subdirectories (default: false)
- show_hidden: Include hidden files starting with . (default: false)
- no_default_excludes: Include node_modules, .git, dist, etc. (default: false)

Example: list_directory({ path: "src" })
Example: list_directory({ path: ".", recursive: true })
Example: list_directory({ path: "node_modules", no_default_excludes: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: project root)',
          optional: true,
        },
        recursive: {
          type: 'boolean',
          description: 'Include subdirectories recursively (default: false)',
          optional: true,
        },
        show_hidden: {
          type: 'boolean',
          description: 'Include hidden files starting with . (default: false)',
          optional: true,
        },
        no_default_excludes: {
          type: 'boolean',
          description: 'Disable default excludes (node_modules, .git, dist, etc.)',
          optional: true,
        },
      },
    },
  };
}

export function generateGlobFilesTool(): GeneratedToolDefinition {
  return {
    name: 'glob_files',
    description: `Find files matching a glob pattern.

Useful to find all files of a certain type or in a specific location.
Does NOT read file contents - just returns matching paths.

Common patterns:
- "**/*.ts" - All TypeScript files recursively
- "src/**/*.vue" - All Vue files in src
- "*.json" - JSON files in current directory
- "**/*.{ts,tsx}" - TypeScript and TSX files

Parameters:
- pattern: Glob pattern to match
- cwd: Base directory for pattern (default: project root)
- ignore: Additional patterns to ignore
- no_default_excludes: Include node_modules, .git, dist, etc. (default: false)

Example: glob_files({ pattern: "**/*.ts" })
Example: glob_files({ pattern: "src/components/**/*.vue" })
Example: glob_files({ pattern: "node_modules/**/*.d.ts", no_default_excludes: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.vue")',
        },
        cwd: {
          type: 'string',
          description: 'Base directory for pattern (default: project root)',
          optional: true,
        },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional patterns to ignore',
          optional: true,
        },
        no_default_excludes: {
          type: 'boolean',
          description: 'Disable default excludes (node_modules, .git, dist, etc.)',
          optional: true,
        },
      },
      required: ['pattern'],
    },
  };
}

export function generateFileExistsTool(): GeneratedToolDefinition {
  return {
    name: 'file_exists',
    description: `Check if a file or directory exists.

Quick check without reading the file. Returns basic info if exists.

Parameters:
- path: Path to check

Example: file_exists({ path: "package.json" })
Example: file_exists({ path: "src/utils" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File or directory path to check',
        },
      },
      required: ['path'],
    },
  };
}

export function generateGetFileInfoTool(): GeneratedToolDefinition {
  return {
    name: 'get_file_info',
    description: `Get detailed information about a file or directory.

Returns: exists, type, size, created/modified/accessed times, permissions.

Parameters:
- path: Path to get info for

Example: get_file_info({ path: "package.json" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File or directory path',
        },
      },
      required: ['path'],
    },
  };
}

export function generateDeletePathTool(): GeneratedToolDefinition {
  return {
    name: 'delete_path',
    description: `Delete a file or directory.

By default, only deletes files and empty directories. Use recursive: true for non-empty directories.
The deletion is tracked and removed from the knowledge graph.

Parameters:
- path: File or directory to delete
- recursive: Delete non-empty directories (default: false)

Example: delete_path({ path: "src/old-file.ts" })
Example: delete_path({ path: "temp", recursive: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to delete',
        },
        recursive: {
          type: 'boolean',
          description: 'Delete non-empty directories (default: false, DANGEROUS)',
          optional: true,
        },
      },
      required: ['path'],
    },
  };
}

export function generateMoveFileTool(): GeneratedToolDefinition {
  return {
    name: 'move_file',
    description: `Move or rename a file or directory.

Creates parent directories if needed.
Updates the knowledge graph to reflect the new path.

Parameters:
- source: Current path
- destination: New path

Example: move_file({ source: "src/utils.ts", destination: "src/lib/utils.ts" })
Example: move_file({ source: "old-name.ts", destination: "new-name.ts" })`,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Current file/directory path',
        },
        destination: {
          type: 'string',
          description: 'New path',
        },
      },
      required: ['source', 'destination'],
    },
  };
}

export function generateCopyFileTool(): GeneratedToolDefinition {
  return {
    name: 'copy_file',
    description: `Copy a file or directory.

Creates parent directories if needed.
Directories are copied recursively by default.

Parameters:
- source: File/directory to copy
- destination: Destination path

Example: copy_file({ source: "template.ts", destination: "src/new-file.ts" })
Example: copy_file({ source: "src/components", destination: "src/components-backup" })`,
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source path',
        },
        destination: {
          type: 'string',
          description: 'Destination path',
        },
      },
      required: ['source', 'destination'],
    },
  };
}

export function generateCreateDirectoryTool(): GeneratedToolDefinition {
  return {
    name: 'create_directory',
    description: `Create a directory (and parent directories if needed).

Equivalent to "mkdir -p". Does nothing if directory already exists.

Parameters:
- path: Directory path to create

Example: create_directory({ path: "src/components/ui" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create',
        },
      },
      required: ['path'],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export function generateListDirectoryHandler(ctx: FsToolsContext) {
  return async (params: {
    path?: string;
    recursive?: boolean;
    show_hidden?: boolean;
    no_default_excludes?: boolean;
  }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      const dirPath = params.path || '.';
      return await fsHelpers.listDirectory(dirPath, {
        basePath: projectRoot,
        recursive: params.recursive,
        showHidden: params.show_hidden,
        noDefaultExcludes: params.no_default_excludes,
      });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateGlobFilesHandler(ctx: FsToolsContext) {
  return async (params: {
    pattern: string;
    cwd?: string;
    ignore?: string[];
    no_default_excludes?: boolean;
  }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      const cwd = params.cwd
        ? (require('path').isAbsolute(params.cwd) ? params.cwd : require('path').join(projectRoot, params.cwd))
        : projectRoot;

      const defaultIgnore = params.no_default_excludes
        ? []
        : ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/__pycache__/**', '**/build/**', '**/.next/**', '**/.nuxt/**', '**/coverage/**'];
      const ignore = params.ignore ? [...defaultIgnore, ...params.ignore] : defaultIgnore;

      return await fsHelpers.globFiles(params.pattern, { cwd, ignore });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateFileExistsHandler(ctx: FsToolsContext) {
  return async (params: { path: string }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      const exists = await fsHelpers.pathExists(params.path, { basePath: projectRoot });
      if (exists) {
        const info = await fsHelpers.getFileInfo(params.path, { basePath: projectRoot });
        return {
          exists: true,
          type: info.type,
          path: params.path,
          absolutePath: info.absolutePath,
        };
      }
      return { exists: false, path: params.path };
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateGetFileInfoHandler(ctx: FsToolsContext) {
  return async (params: { path: string }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      return await fsHelpers.getFileInfo(params.path, { basePath: projectRoot });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateDeletePathHandler(ctx: FsToolsContext) {
  return async (params: { path: string; recursive?: boolean }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      const result = await fsHelpers.deletePath(params.path, {
        basePath: projectRoot,
        recursive: params.recursive,
      });

      // Notify for Neo4j cleanup
      if (ctx.onFileDeleted) {
        await ctx.onFileDeleted(result.absolutePath);
      }

      return result;
    } catch (err: any) {
      if (err.code === 'ENOTEMPTY') {
        return {
          error: `Directory not empty: ${params.path}. Use recursive: true to delete non-empty directories.`,
        };
      }
      return { error: err.message };
    }
  };
}

export function generateMoveFileHandler(ctx: FsToolsContext) {
  return async (params: { source: string; destination: string }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      const result = await fsHelpers.moveFile(params.source, params.destination, {
        basePath: projectRoot,
      });

      // Notify for Neo4j update
      if (ctx.onFileMoved) {
        await ctx.onFileMoved(result.absoluteSource, result.absoluteDestination);
      }

      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateCopyFileHandler(ctx: FsToolsContext) {
  return async (params: { source: string; destination: string }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      return await fsHelpers.copyFile(params.source, params.destination, {
        basePath: projectRoot,
      });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateCreateDirectoryHandler(ctx: FsToolsContext) {
  return async (params: { path: string }) => {
    const projectRoot = getProjectRoot(ctx);
    if (!projectRoot) {
      return {
        error: 'No project loaded. Use create_project, setup_project, or load_project first.',
        suggestion: 'load_project',
      };
    }

    try {
      return await fsHelpers.createDirectory(params.path, { basePath: projectRoot });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

// ============================================
// Export All FS Tools
// ============================================

export interface FsToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all file system tools with handlers
 */
export function generateFsTools(ctx: FsToolsContext): FsToolsResult {
  return {
    tools: [
      generateListDirectoryTool(),
      generateGlobFilesTool(),
      generateFileExistsTool(),
      generateGetFileInfoTool(),
      generateDeletePathTool(),
      generateMoveFileTool(),
      generateCopyFileTool(),
      generateCreateDirectoryTool(),
    ],
    handlers: {
      list_directory: generateListDirectoryHandler(ctx),
      glob_files: generateGlobFilesHandler(ctx),
      file_exists: generateFileExistsHandler(ctx),
      get_file_info: generateGetFileInfoHandler(ctx),
      delete_path: generateDeletePathHandler(ctx),
      move_file: generateMoveFileHandler(ctx),
      copy_file: generateCopyFileHandler(ctx),
      create_directory: generateCreateDirectoryHandler(ctx),
    },
  };
}
