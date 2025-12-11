/**
 * File System Tools
 *
 * Agent tools for file system exploration and manipulation.
 * Uses fs-helpers.ts for actual implementation.
 *
 * @since 2025-12-07
 */

import path from 'path';
import type { GeneratedToolDefinition } from './types/index.js';
import * as fsHelpers from './fs-helpers.js';
import { distance as levenshtein } from 'fastest-levenshtein';
import pLimit from 'p-limit';

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
    section: 'file_ops',
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
    section: 'file_ops',
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
    section: 'file_ops',
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
    section: 'file_ops',
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
    section: 'file_ops',
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
    section: 'file_ops',
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
    section: 'file_ops',
    description: `Copy a file or directory.

Creates parent directories if needed.
Directories are copied recursively by default.
Fails if destination already exists (use overwrite: true to replace).

Parameters:
- source: File/directory to copy
- destination: Destination path
- overwrite: Replace if destination exists (default: false)

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
        overwrite: {
          type: 'boolean',
          description: 'Replace if destination exists (default: false)',
        },
      },
      required: ['source', 'destination'],
    },
  };
}

export function generateCreateDirectoryTool(): GeneratedToolDefinition {
  return {
    name: 'create_directory',
    section: 'file_ops',
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
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

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
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

    try {
      const cwd = params.cwd
        ? (path.isAbsolute(params.cwd) ? params.cwd : path.join(projectRoot, params.cwd))
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
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

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
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

    try {
      return await fsHelpers.getFileInfo(params.path, { basePath: projectRoot });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateDeletePathHandler(ctx: FsToolsContext) {
  return async (params: { path: string; recursive?: boolean }) => {
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

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
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

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
  return async (params: { source: string; destination: string; overwrite?: boolean }) => {
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

    try {
      return await fsHelpers.copyFile(params.source, params.destination, {
        basePath: projectRoot,
        overwrite: params.overwrite ?? false,
      });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

export function generateCreateDirectoryHandler(ctx: FsToolsContext) {
  return async (params: { path: string }) => {
    // Use projectRoot if available, otherwise fall back to cwd
    const projectRoot = getProjectRoot(ctx) || process.cwd();

    try {
      return await fsHelpers.createDirectory(params.path, { basePath: projectRoot });
    } catch (err: any) {
      return { error: err.message };
    }
  };
}

// ============================================
// Change Directory Tool
// ============================================

export function generateChangeDirectoryTool(): GeneratedToolDefinition {
  return {
    name: 'change_directory',
    section: 'file_ops',
    description: `Change the current working directory.

Changes the process working directory (like 'cd' in shell).
Use this to navigate before running commands or file operations.

Parameters:
- path: Directory to change to (absolute or relative)

Example: change_directory({ path: "src/components" })
Example: change_directory({ path: ".." })
Example: change_directory({ path: "/home/user/project" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to change to',
        },
      },
      required: ['path'],
    },
  };
}

export function generateChangeDirectoryHandler(ctx: FsToolsContext) {
  return async (params: { path: string }) => {
    const fs = await import('fs/promises');

    const projectRoot = getProjectRoot(ctx);
    const targetPath = path.isAbsolute(params.path)
      ? params.path
      : path.join(process.cwd(), params.path);

    // Check if directory exists
    try {
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        return { error: `Not a directory: ${params.path}` };
      }
    } catch (err: any) {
      return { error: `Directory not found: ${params.path}` };
    }

    // Change directory
    const previousDir = process.cwd();
    try {
      process.chdir(targetPath);
      return {
        previous_directory: previousDir,
        current_directory: process.cwd(),
        success: true,
      };
    } catch (err: any) {
      return { error: `Failed to change directory: ${err.message}` };
    }
  };
}

// ============================================
// Search Tools (grep, fuzzy search)
// ============================================

export function generateGrepFilesTool(): GeneratedToolDefinition {
  return {
    name: 'grep_files',
    section: 'file_ops',
    description: `Search file contents using regex pattern.

Searches within files matching a glob pattern.
Returns matching lines with file path and line numbers.

Parameters:
- pattern: Glob pattern to filter files (e.g., "**/*.ts", "src/**/*.js")
- regex: Regular expression to search for in file contents
- ignore_case: Case insensitive search (default: false)
- max_results: Maximum number of matches to return (default: 100)
- extract_hierarchy: Extract dependency hierarchy for results (default: false). Requires brain to be available.

Example: grep_files({ pattern: "**/*.ts", regex: "function.*Handler" })
Example: grep_files({ pattern: "src/**/*.js", regex: "TODO|FIXME", ignore_case: true })
Example: grep_files({ pattern: "**/*.ts", regex: "export function", extract_hierarchy: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files',
        },
        regex: {
          type: 'string',
          description: 'Regular expression to search for',
        },
        ignore_case: {
          type: 'boolean',
          description: 'Case insensitive search (default: false)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum matches to return (default: 100)',
        },
        extract_hierarchy: {
          type: 'boolean',
          description: 'Extract dependency hierarchy for results (default: false). Requires brain to be available.',
        },
      },
      required: ['pattern', 'regex'],
    },
  };
}

export function generateSearchFilesTool(): GeneratedToolDefinition {
  return {
    name: 'search_files',
    section: 'file_ops',
    description: `Fuzzy search file contents using Levenshtein distance.

Searches within files matching a glob pattern with typo tolerance.
Useful when you don't know the exact spelling.

Parameters:
- pattern: Glob pattern to filter files (e.g., "**/*.ts")
- query: Text to search for (fuzzy matched)
- threshold: Similarity threshold 0-1 (default: 0.7, higher = stricter)
- max_results: Maximum number of matches to return (default: 50)
- extract_hierarchy: Extract dependency hierarchy for results (default: false). Requires brain to be available.

Example: search_files({ pattern: "**/*.ts", query: "authentification" })
Example: search_files({ pattern: "src/**/*", query: "levenshtien", threshold: 0.6 })
Example: search_files({ pattern: "**/*.ts", query: "normalizeTimestamp", extract_hierarchy: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files',
        },
        query: {
          type: 'string',
          description: 'Text to search for (fuzzy matched)',
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold 0-1 (default: 0.7)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum matches to return (default: 50)',
        },
        extract_hierarchy: {
          type: 'boolean',
          description: 'Extract dependency hierarchy for results (default: false). Requires brain to be available.',
        },
      },
      required: ['pattern', 'query'],
    },
  };
}

export function generateGrepFilesHandler(ctx: FsToolsContext) {
  return async (params: { pattern: string; regex: string; ignore_case?: boolean; max_results?: number; extract_hierarchy?: boolean }) => {
    const fs = await import('fs/promises');
    const { glob } = await import('glob');

    const projectRoot = getProjectRoot(ctx) || process.cwd();

    const { pattern, regex, ignore_case = false, max_results = 100, extract_hierarchy = false } = params;

    try {
      // Validate regex
      new RegExp(regex, ignore_case ? 'i' : '');
    } catch (err: any) {
      return { error: `Invalid regex: ${err.message}` };
    }

    const regexFlags = ignore_case ? 'gi' : 'g';
    const searchRegex = new RegExp(regex, regexFlags);

    // Get files matching glob
    const files = await glob(pattern, {
      cwd: projectRoot,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });

    if (files.length === 0) {
      return { matches: [], files_searched: 0, message: 'No files matched the glob pattern' };
    }

    const limit = pLimit(10); // Process 10 files concurrently
    const matches: Array<{ file: string; line: number; content: string; match: string }> = [];
    let totalMatches = 0;

    const searchFile = async (file: string) => {
      if (totalMatches >= max_results) return;

      const filePath = path.join(projectRoot, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && totalMatches < max_results; i++) {
          const line = lines[i];
          searchRegex.lastIndex = 0; // Reset regex state
          const match = searchRegex.exec(line);

          if (match) {
            matches.push({
              file,
              line: i + 1,
              content: line.trim().substring(0, 200),
              match: match[0],
            });
            totalMatches++;
          }
        }
      } catch {
        // Skip unreadable files (binary, etc.)
      }
    };

    await Promise.all(files.map(file => limit(() => searchFile(file))));

    const result: any = {
      matches,
      files_searched: files.length,
      total_matches: matches.length,
      truncated: totalMatches >= max_results,
    };

    // Note: extract_hierarchy is handled by the MCP server wrapper via daemon proxy
    // The daemon handler will automatically start watchers and sync projects (like brain_search)
    // For direct usage (non-MCP), try direct brain access
    if (extract_hierarchy && matches.length > 0) {
      try {
        const { BrainManager } = await import('../brain/index.js');
        const { generateExtractDependencyHierarchyHandler } = await import('./brain-tools.js');
        const brain = await BrainManager.getInstance();
        
        // Extract hierarchy (ensureProjectSynced is called inside the handler, like brain_search)
        const extractHandler = generateExtractDependencyHierarchyHandler({ brain });
        const hierarchyResult = await extractHandler({
          results: matches,
          depth: 1,
          direction: 'both',
          max_scopes: Math.min(matches.length, 10),
        });
        
        result.hierarchy = hierarchyResult;
      } catch (err: any) {
        // If brain is not available, extraction will be handled by MCP wrapper
        result.hierarchy_error = err.message || 'Brain not available (will be handled by MCP wrapper if available)';
      }
    }

    return result;
  };
}

export function generateSearchFilesHandler(ctx: FsToolsContext) {
  return async (params: { pattern: string; query: string; threshold?: number; max_results?: number; extract_hierarchy?: boolean }) => {
    const fs = await import('fs/promises');
    const { glob } = await import('glob');

    const projectRoot = getProjectRoot(ctx) || process.cwd();

    const { pattern, query, threshold = 0.7, max_results = 50, extract_hierarchy = false } = params;
    const queryLower = query.toLowerCase();
    const queryLen = query.length;

    // Get files matching glob
    const files = await glob(pattern, {
      cwd: projectRoot,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });

    if (files.length === 0) {
      return { matches: [], files_searched: 0, message: 'No files matched the glob pattern' };
    }

    const limit = pLimit(10);
    const matches: Array<{ file: string; line: number; content: string; matched_word: string; similarity: number }> = [];

    const searchFile = async (file: string) => {
      if (matches.length >= max_results) return;

      const filePath = path.join(projectRoot, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && matches.length < max_results; i++) {
          const line = lines[i];
          // Extract words from line
          const words = line.match(/\b\w{3,}\b/g) || [];

          for (const word of words) {
            if (matches.length >= max_results) break;

            const wordLower = word.toLowerCase();
            const maxLen = Math.max(queryLen, word.length);
            const distance = levenshtein(queryLower, wordLower);
            const similarity = 1 - distance / maxLen;

            if (similarity >= threshold) {
              matches.push({
                file,
                line: i + 1,
                content: line.trim().substring(0, 200),
                matched_word: word,
                similarity: Math.round(similarity * 100) / 100,
              });
              break; // One match per line
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    };

    await Promise.all(files.map(file => limit(() => searchFile(file))));

    // Sort by similarity (best first)
    matches.sort((a, b) => b.similarity - a.similarity);

    const result: any = {
      query,
      threshold,
      matches,
      files_searched: files.length,
      total_matches: matches.length,
      truncated: matches.length >= max_results,
    };

    // Note: extract_hierarchy is handled by the MCP server wrapper via daemon proxy
    // The daemon handler will automatically start watchers and sync projects (like brain_search)
    // For direct usage (non-MCP), try direct brain access
    if (extract_hierarchy && matches.length > 0) {
      try {
        // Convert matches to format expected by extract_dependency_hierarchy
        const hierarchyMatches = matches.map(m => ({
          file: m.file,
          line: m.line,
          content: m.content,
          match: m.matched_word,
        }));
        
        const { BrainManager } = await import('../brain/index.js');
        const { generateExtractDependencyHierarchyHandler } = await import('./brain-tools.js');
        const brain = await BrainManager.getInstance();
        
        // Extract hierarchy (ensureProjectSynced is called inside the handler, like brain_search)
        const extractHandler = generateExtractDependencyHierarchyHandler({ brain });
        const hierarchyResult = await extractHandler({
          results: hierarchyMatches,
          depth: 1,
          direction: 'both',
          max_scopes: Math.min(matches.length, 10),
        });
        
        result.hierarchy = hierarchyResult;
      } catch (err: any) {
        // If brain is not available, extraction will be handled by MCP wrapper
        result.hierarchy_error = err.message || 'Brain not available (will be handled by MCP wrapper if available)';
      }
    }

    return result;
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
      generateChangeDirectoryTool(),
      generateGrepFilesTool(),
      generateSearchFilesTool(),
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
      change_directory: generateChangeDirectoryHandler(ctx),
      grep_files: generateGrepFilesHandler(ctx),
      search_files: generateSearchFilesHandler(ctx),
    },
  };
}
