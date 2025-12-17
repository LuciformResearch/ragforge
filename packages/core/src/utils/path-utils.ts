/**
 * Cross-platform path utilities
 *
 * These utilities handle both Unix (/) and Windows (\) path separators.
 * Use these instead of hardcoded '/' operations.
 */

import path from 'path';
import os from 'os';

/**
 * Regex to match both Unix and Windows path separators
 */
export const PATH_SEP_REGEX = /[\\/]/;

/**
 * Split a path into parts (cross-platform)
 * Works with both / and \ separators
 *
 * @example
 * splitPath('/home/user/project') // ['home', 'user', 'project']
 * splitPath('C:\\Users\\project') // ['C:', 'Users', 'project']
 * splitPath('src/components')     // ['src', 'components']
 */
export function splitPath(p: string): string[] {
  return p.split(PATH_SEP_REGEX).filter(Boolean);
}

/**
 * Get the file name from a path (cross-platform)
 * Wrapper around path.basename() for consistency
 *
 * @example
 * getFileName('/home/user/file.ts')  // 'file.ts'
 * getFileName('C:\\Users\\file.ts')  // 'file.ts'
 */
export function getFileName(p: string): string {
  return path.basename(p);
}

/**
 * Get the last segment of a path (cross-platform)
 * Like split('/').pop() but works on Windows too
 *
 * @example
 * getLastSegment('/home/user/project') // 'project'
 * getLastSegment('src/components')      // 'components'
 */
export function getLastSegment(p: string): string {
  const parts = splitPath(p);
  return parts[parts.length - 1] || p;
}

/**
 * Get the directory depth (cross-platform)
 *
 * @example
 * getPathDepth('src/components/ui') // 3
 * getPathDepth('/home/user')        // 2
 */
export function getPathDepth(p: string): number {
  return splitPath(p).length;
}

/**
 * Check if a path is absolute (cross-platform)
 * Use this instead of startsWith('/')
 *
 * @example
 * isAbsolutePath('/home/user')    // true (Unix)
 * isAbsolutePath('C:\\Users')     // true (Windows)
 * isAbsolutePath('./relative')    // false
 * isAbsolutePath('relative')      // false
 */
export function isAbsolutePath(p: string): boolean {
  return path.isAbsolute(p);
}

/**
 * Check if a path/import is local (relative or absolute file path)
 * Use this instead of: startsWith('.') || startsWith('/')
 *
 * @example
 * isLocalPath('./utils')          // true (relative)
 * isLocalPath('../lib')           // true (relative parent)
 * isLocalPath('/home/user/lib')   // true (absolute Unix)
 * isLocalPath('C:\\lib')          // true (absolute Windows)
 * isLocalPath('lodash')           // false (package)
 * isLocalPath('@scope/package')   // false (scoped package)
 */
export function isLocalPath(p: string): boolean {
  return p.startsWith('.') || path.isAbsolute(p);
}

/**
 * Check if a path looks like a relative path (starts with . or ..)
 *
 * @example
 * isRelativePath('./utils')   // true
 * isRelativePath('../lib')    // true
 * isRelativePath('utils')     // false
 * isRelativePath('/abs')      // false
 */
export function isRelativePath(p: string): boolean {
  return p.startsWith('./') || p.startsWith('../') || p === '.' || p === '..';
}

/**
 * Normalize path separators to the current platform
 *
 * @example
 * // On Unix:
 * normalizeSeparators('src\\components') // 'src/components'
 * // On Windows:
 * normalizeSeparators('src/components')  // 'src\\components'
 */
export function normalizeSeparators(p: string): string {
  return p.split(PATH_SEP_REGEX).join(path.sep);
}

/**
 * Normalize path separators to Unix style (forward slashes)
 * Useful for consistent storage/comparison
 *
 * @example
 * toUnixPath('C:\\Users\\project') // 'C:/Users/project'
 * toUnixPath('src\\components')    // 'src/components'
 */
export function toUnixPath(p: string): string {
  return p.split(PATH_SEP_REGEX).join('/');
}

/**
 * Get home directory (cross-platform)
 * Use this instead of process.env.HOME
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Get ragforge config directory (~/.ragforge)
 */
export function getRagforgeDir(): string {
  return path.join(os.homedir(), '.ragforge');
}

/**
 * Get ragforge logs directory (~/.ragforge/logs)
 */
export function getRagforgeLogsDir(): string {
  return path.join(os.homedir(), '.ragforge', 'logs');
}

/**
 * Get ragforge env file path (~/.ragforge/.env)
 */
export function getRagforgeEnvPath(): string {
  return path.join(os.homedir(), '.ragforge', '.env');
}

/**
 * Join paths safely (just a re-export for convenience)
 */
export const joinPath = path.join;

/**
 * Resolve paths safely (just a re-export for convenience)
 */
export const resolvePath = path.resolve;

/**
 * Get directory name (just a re-export for convenience)
 */
export const getDirName = path.dirname;
