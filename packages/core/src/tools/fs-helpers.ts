/**
 * File System Helpers
 *
 * Low-level file system operations used by fs-tools.ts
 * These are the actual implementations, separate from agent tool definitions.
 *
 * @since 2025-12-07
 */

import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';

// ============================================
// Types
// ============================================

export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modifiedAt?: string;
}

export interface ListDirectoryResult {
  path: string;
  absolutePath: string;
  entries: DirectoryEntry[];
  totalFiles: number;
  totalDirectories: number;
}

export interface GlobFilesResult {
  pattern: string;
  cwd: string;
  files: string[];
  count: number;
}

export interface FileInfoResult {
  path: string;
  absolutePath: string;
  exists: boolean;
  type?: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  createdAt?: string;
  modifiedAt?: string;
  accessedAt?: string;
  permissions?: string;
}

export interface DeleteResult {
  path: string;
  absolutePath: string;
  deleted: boolean;
  type: 'file' | 'directory';
}

export interface MoveResult {
  source: string;
  destination: string;
  absoluteSource: string;
  absoluteDestination: string;
  moved: boolean;
}

export interface CopyResult {
  source: string;
  destination: string;
  absoluteSource: string;
  absoluteDestination: string;
  copied: boolean;
}

// ============================================
// Helpers
// ============================================

// Default patterns to exclude
const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', '__pycache__', 'build', '.next', '.nuxt', 'coverage'];

/**
 * List contents of a directory
 */
export async function listDirectory(
  dirPath: string,
  options: {
    basePath?: string;
    recursive?: boolean;
    showHidden?: boolean;
    includeStats?: boolean;
    noDefaultExcludes?: boolean;
  } = {}
): Promise<ListDirectoryResult> {
  const { basePath, recursive = false, showHidden = false, includeStats = true, noDefaultExcludes = false } = options;

  // Resolve path
  const absolutePath = basePath && !path.isAbsolute(dirPath)
    ? path.join(basePath, dirPath)
    : path.resolve(dirPath);

  // Check if directory exists
  const stat = await fs.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${absolutePath}`);
  }

  const entries: DirectoryEntry[] = [];
  let totalFiles = 0;
  let totalDirs = 0;

  async function readDir(currentPath: string, relativeTo: string) {
    const items = await fs.readdir(currentPath, { withFileTypes: true });

    for (const item of items) {
      // Skip hidden files unless requested
      if (!showHidden && item.name.startsWith('.')) {
        continue;
      }

      // Skip default excludes unless disabled
      if (!noDefaultExcludes && DEFAULT_EXCLUDES.includes(item.name)) {
        continue;
      }

      const itemPath = path.join(currentPath, item.name);
      const relativePath = path.relative(relativeTo, itemPath);

      let entry: DirectoryEntry = {
        name: recursive ? relativePath : item.name,
        type: item.isFile() ? 'file' :
              item.isDirectory() ? 'directory' :
              item.isSymbolicLink() ? 'symlink' : 'other',
      };

      if (includeStats && item.isFile()) {
        try {
          const itemStat = await fs.stat(itemPath);
          entry.size = itemStat.size;
          entry.modifiedAt = itemStat.mtime.toISOString();
        } catch {
          // Ignore stat errors (permission issues, etc.)
        }
      }

      entries.push(entry);

      if (item.isFile()) {
        totalFiles++;
      } else if (item.isDirectory()) {
        totalDirs++;

        if (recursive) {
          await readDir(itemPath, relativeTo);
        }
      }
    }
  }

  await readDir(absolutePath, absolutePath);

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    path: dirPath,
    absolutePath,
    entries,
    totalFiles,
    totalDirectories: totalDirs,
  };
}

/**
 * Find files matching a glob pattern
 */
export async function globFiles(
  pattern: string,
  options: {
    cwd?: string;
    ignore?: string[];
    dot?: boolean;
    absolute?: boolean;
  } = {}
): Promise<GlobFilesResult> {
  const {
    cwd = process.cwd(),
    ignore = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/__pycache__/**'],
    dot = false,
    absolute = false,
  } = options;

  const files = await glob(pattern, {
    cwd,
    ignore,
    dot,
    absolute,
    nodir: true, // Only return files, not directories
  });

  // Sort alphabetically
  files.sort();

  return {
    pattern,
    cwd,
    files,
    count: files.length,
  };
}

/**
 * Check if a file or directory exists and get info
 */
export async function getFileInfo(
  filePath: string,
  options: { basePath?: string } = {}
): Promise<FileInfoResult> {
  const { basePath } = options;

  const absolutePath = basePath && !path.isAbsolute(filePath)
    ? path.join(basePath, filePath)
    : path.resolve(filePath);

  try {
    const stat = await fs.stat(absolutePath);

    return {
      path: filePath,
      absolutePath,
      exists: true,
      type: stat.isFile() ? 'file' :
            stat.isDirectory() ? 'directory' :
            stat.isSymbolicLink() ? 'symlink' : 'other',
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      accessedAt: stat.atime.toISOString(),
      permissions: (stat.mode & 0o777).toString(8),
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return {
        path: filePath,
        absolutePath,
        exists: false,
      };
    }
    throw err;
  }
}

/**
 * Check if a path exists (quick check)
 */
export async function pathExists(
  filePath: string,
  options: { basePath?: string } = {}
): Promise<boolean> {
  const { basePath } = options;

  const absolutePath = basePath && !path.isAbsolute(filePath)
    ? path.join(basePath, filePath)
    : path.resolve(filePath);

  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a file or directory
 */
export async function deletePath(
  filePath: string,
  options: { basePath?: string; recursive?: boolean } = {}
): Promise<DeleteResult> {
  const { basePath, recursive = false } = options;

  const absolutePath = basePath && !path.isAbsolute(filePath)
    ? path.join(basePath, filePath)
    : path.resolve(filePath);

  const stat = await fs.stat(absolutePath);
  const type = stat.isDirectory() ? 'directory' : 'file';

  if (type === 'directory') {
    if (recursive) {
      await fs.rm(absolutePath, { recursive: true, force: true });
    } else {
      // Only delete empty directories
      await fs.rmdir(absolutePath);
    }
  } else {
    await fs.unlink(absolutePath);
  }

  return {
    path: filePath,
    absolutePath,
    deleted: true,
    type,
  };
}

/**
 * Move or rename a file/directory
 */
export async function moveFile(
  source: string,
  destination: string,
  options: { basePath?: string } = {}
): Promise<MoveResult> {
  const { basePath } = options;

  const absoluteSource = basePath && !path.isAbsolute(source)
    ? path.join(basePath, source)
    : path.resolve(source);

  const absoluteDestination = basePath && !path.isAbsolute(destination)
    ? path.join(basePath, destination)
    : path.resolve(destination);

  // Check source exists
  await fs.access(absoluteSource);

  // Create destination parent directory if needed
  const destDir = path.dirname(absoluteDestination);
  await fs.mkdir(destDir, { recursive: true });

  // Move the file
  await fs.rename(absoluteSource, absoluteDestination);

  return {
    source,
    destination,
    absoluteSource,
    absoluteDestination,
    moved: true,
  };
}

/**
 * Copy a file or directory
 */
export async function copyFile(
  source: string,
  destination: string,
  options: { basePath?: string; recursive?: boolean } = {}
): Promise<CopyResult> {
  const { basePath, recursive = true } = options;

  const absoluteSource = basePath && !path.isAbsolute(source)
    ? path.join(basePath, source)
    : path.resolve(source);

  const absoluteDestination = basePath && !path.isAbsolute(destination)
    ? path.join(basePath, destination)
    : path.resolve(destination);

  // Check source exists
  const stat = await fs.stat(absoluteSource);

  // Create destination parent directory if needed
  const destDir = path.dirname(absoluteDestination);
  await fs.mkdir(destDir, { recursive: true });

  if (stat.isDirectory()) {
    if (!recursive) {
      throw new Error('Cannot copy directory without recursive option');
    }
    await copyDir(absoluteSource, absoluteDestination);
  } else {
    await fs.copyFile(absoluteSource, absoluteDestination);
  }

  return {
    source,
    destination,
    absoluteSource,
    absoluteDestination,
    copied: true,
  };
}

/**
 * Recursively copy a directory
 */
async function copyDir(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Create a directory (mkdir -p)
 */
export async function createDirectory(
  dirPath: string,
  options: { basePath?: string } = {}
): Promise<{ path: string; absolutePath: string; created: boolean }> {
  const { basePath } = options;

  const absolutePath = basePath && !path.isAbsolute(dirPath)
    ? path.join(basePath, dirPath)
    : path.resolve(dirPath);

  await fs.mkdir(absolutePath, { recursive: true });

  return {
    path: dirPath,
    absolutePath,
    created: true,
  };
}
