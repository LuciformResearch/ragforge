/**
 * Import Resolver - Resolves TypeScript imports using tsconfig.json
 *
 * Handles:
 * - Relative imports (./foo, ../bar)
 * - Extension resolution (.js → .ts, .jsx → .tsx)
 * - Index file resolution (./folder → ./folder/index.ts)
 * - Path mappings from tsconfig.json
 * - baseUrl resolution
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import stripJsonComments from 'strip-json-comments';

interface TsConfigPaths {
  [pattern: string]: string[];
}

interface TsConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: TsConfigPaths;
    rootDir?: string;
    outDir?: string;
    moduleResolution?: string;
  };
}

export class ImportResolver {
  private tsConfig: TsConfig | null = null;
  private projectRoot: string;
  private baseUrl: string | null = null;
  private paths: TsConfigPaths | null = null;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Load and parse tsconfig.json
   */
  async loadTsConfig(tsConfigPath?: string): Promise<void> {
    const configPath = tsConfigPath || path.join(this.projectRoot, 'tsconfig.json');

    try {
      const content = await fs.readFile(configPath, 'utf8');
      // Remove comments properly (handles comments in strings correctly)
      const cleaned = stripJsonComments(content);
      this.tsConfig = JSON.parse(cleaned);

      // Extract baseUrl
      if (this.tsConfig?.compilerOptions?.baseUrl) {
        this.baseUrl = path.resolve(
          path.dirname(configPath),
          this.tsConfig.compilerOptions.baseUrl
        );
      } else if (this.tsConfig?.compilerOptions?.paths) {
        // If paths are defined but baseUrl is not, default to tsconfig directory
        this.baseUrl = path.dirname(configPath);
      }

      // Extract path mappings
      if (this.tsConfig?.compilerOptions?.paths) {
        this.paths = this.tsConfig.compilerOptions.paths;
      }
    } catch (error) {
      console.warn(`Warning: Could not load tsconfig.json from ${configPath}`);
      this.tsConfig = null;
    }
  }

  /**
   * Check if an import path matches a tsconfig path alias
   * This determines if an import like "@/foo" or "~/bar" is a local path alias
   * vs a scoped npm package like "@google/generative-ai"
   *
   * @param importPath - The import specifier to check
   * @returns true if it matches a path alias, false otherwise
   */
  isPathAlias(importPath: string): boolean {
    if (!this.paths) {
      return false;
    }

    // Check if the import matches any path mapping pattern
    for (const pattern of Object.keys(this.paths)) {
      // Convert tsconfig pattern to regex
      // "@/*" becomes "^@/"
      // "~/*" becomes "^~/"
      const patternPrefix = pattern.replace('/*', '/');
      if (importPath.startsWith(patternPrefix)) {
        return true;
      }

      // Also handle exact matches (patterns without wildcard)
      if (pattern === importPath) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolve an import specifier to an absolute file path
   *
   * @param importPath - The import specifier (e.g., "./constants.js", "../neo4j/index.js")
   * @param currentFile - The absolute path of the file containing the import
   * @returns The absolute path to the resolved source file, or null if not found
   */
  async resolveImport(importPath: string, currentFile: string): Promise<string | null> {
    // Skip external modules (node_modules)
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      // Could be a path mapping or external module
      if (this.paths) {
        const resolved = await this.resolvePathMapping(importPath, currentFile);
        if (resolved) return resolved;
      }

      // External module - not a file in the project
      return null;
    }

    // Resolve relative import
    return this.resolveRelativeImport(importPath, currentFile);
  }

  /**
   * Resolve a relative import (./foo, ../bar)
   */
  private async resolveRelativeImport(importPath: string, currentFile: string): Promise<string | null> {
    const currentDir = path.dirname(currentFile);
    let resolved = path.resolve(currentDir, importPath);

    // Try to resolve the file with various extensions
    const candidates = await this.getCandidatePaths(resolved);

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Resolve path mappings from tsconfig paths
   */
  private async resolvePathMapping(importPath: string, currentFile: string): Promise<string | null> {
    if (!this.paths || !this.baseUrl) return null;

    for (const [pattern, substitutions] of Object.entries(this.paths)) {
      const regex = this.pathPatternToRegex(pattern);
      const match = importPath.match(regex);

      if (match) {
        // Try each substitution
        for (const substitution of substitutions) {
          let resolved = substitution;

          // Replace * wildcards with matched groups
          if (match[1]) {
            resolved = resolved.replace('*', match[1]);
          }

          // Resolve relative to baseUrl
          const fullPath = path.resolve(this.baseUrl, resolved);
          const candidates = await this.getCandidatePaths(fullPath);

          for (const candidate of candidates) {
            if (await this.fileExists(candidate)) {
              return candidate;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Convert tsconfig path pattern to regex
   * Example: "@/*" → /^@\/(.*)$/
   */
  private pathPatternToRegex(pattern: string): RegExp {
    // First, replace * wildcards with a placeholder
    let regexPattern = pattern.replace(/\*/g, '___WILDCARD___');

    // Escape special regex characters
    regexPattern = regexPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

    // Replace placeholder with capture group
    regexPattern = regexPattern.replace(/___WILDCARD___/g, '(.*)');

    return new RegExp(`^${regexPattern}$`);
  }

  /**
   * Get all candidate file paths for a given import
   * Handles extension resolution and index files
   */
  private async getCandidatePaths(basePath: string): Promise<string[]> {
    const candidates: string[] = [];

    // Strategy 1: Replace .js/.jsx with .ts/.tsx
    if (basePath.endsWith('.js')) {
      candidates.push(basePath.replace(/\.js$/, '.ts'));
    } else if (basePath.endsWith('.jsx')) {
      candidates.push(basePath.replace(/\.jsx$/, '.tsx'));
    }

    // Strategy 2: Try as-is (might already have .ts extension)
    candidates.push(basePath);

    // Strategy 3: Try adding .ts extension
    if (!basePath.endsWith('.ts') && !basePath.endsWith('.tsx')) {
      candidates.push(`${basePath}.ts`);
      candidates.push(`${basePath}.tsx`);
    }

    // Strategy 4: Try as directory with index.ts
    candidates.push(path.join(basePath, 'index.ts'));
    candidates.push(path.join(basePath, 'index.tsx'));

    // Strategy 5: If it has .js, also try directory/index.ts
    if (basePath.endsWith('.js')) {
      const withoutExt = basePath.replace(/\.js$/, '');
      candidates.push(path.join(withoutExt, 'index.ts'));
    }

    return candidates;
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Get the relative path from project root
   */
  getRelativePath(absolutePath: string): string {
    return path.relative(this.projectRoot, absolutePath);
  }

  /**
   * Follow re-exports to find the actual source file for a symbol
   * Handles barrel files (index.ts) that re-export from other modules
   *
   * @param filePath - The absolute path to the file that might be re-exporting
   * @param symbol - The symbol name to look for
   * @returns The absolute path to the file that actually defines the symbol, or the original file if no re-export found
   */
  async followReExports(filePath: string, symbol: string): Promise<string> {
    const visited = new Set<string>();
    let currentFile = filePath;

    while (currentFile) {
      // Prevent infinite loops
      if (visited.has(currentFile)) {
        break;
      }
      visited.add(currentFile);

      // Safety limit
      if (visited.size > 10) {
        console.warn(`Warning: Re-export chain too long for ${symbol} starting from ${filePath}`);
        break;
      }

      try {
        const content = await fs.readFile(currentFile, 'utf8');
        let foundReExport = false;

        // Simple regex-based detection of re-exports
        // Pattern 1: export * from '...'
        // Pattern 2: export { symbol } from '...'
        // Pattern 3: export { original as symbol } from '...'

        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();

          // export * from './somewhere'
          const starExportMatch = trimmed.match(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/);
          if (starExportMatch) {
            const reExportPath = starExportMatch[1];
            const resolvedReExport = await this.resolveImport(reExportPath, currentFile);
            if (resolvedReExport && !visited.has(resolvedReExport)) {
              currentFile = resolvedReExport;
              foundReExport = true;
              break; // Continue following this chain
            }
          }

          // export { foo, bar } from './somewhere'
          // export { original as alias } from './somewhere'
          const namedExportMatch = trimmed.match(/^export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
          if (namedExportMatch) {
            const exports = namedExportMatch[1];
            const reExportPath = namedExportMatch[2];

            // Parse the exports list
            const exportedSymbols = exports.split(',').map(e => {
              const parts = e.trim().split(/\s+as\s+/);
              return {
                original: parts[0].trim(),
                alias: parts[1]?.trim() || parts[0].trim()
              };
            });

            // Check if our symbol is in this re-export
            if (exportedSymbols.some(e => e.alias === symbol)) {
              const resolvedReExport = await this.resolveImport(reExportPath, currentFile);
              if (resolvedReExport && !visited.has(resolvedReExport)) {
                currentFile = resolvedReExport;
                foundReExport = true;
                break; // Continue following this chain
              }
            }
          }
        }

        // If we didn't find any re-export, we've reached the source file
        if (!foundReExport) {
          break;
        }
      } catch (error) {
        // If we can't read the file, return what we have
        break;
      }
    }

    return currentFile;
  }
}
