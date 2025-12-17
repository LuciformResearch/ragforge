/**
 * Reference Extractor Module
 *
 * Shared module for extracting file references from various file types.
 * Used by both project ingestion and touched-files-watcher.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { Neo4jClient } from '../runtime/client/neo4j-client.js';
import { isLocalPath } from '../utils/path-utils.js';

// ============================================
// Types
// ============================================

export type ReferenceType =
  | 'code'        // Import de code (.ts, .js, .py, etc.)
  | 'asset'       // Image, font, audio, video, 3D
  | 'document'    // Markdown, PDF, docs
  | 'stylesheet'  // CSS, SCSS
  | 'data'        // JSON, YAML
  | 'external';   // URL externe (non résolu)

export type RelationType =
  | 'CONSUMES'          // Scope → Scope (code)
  | 'IMPORTS'           // File → File (fallback)
  | 'REFERENCES_ASSET'  // * → asset file
  | 'REFERENCES_DOC'    // * → document
  | 'REFERENCES_STYLE'  // * → stylesheet
  | 'REFERENCES_DATA'   // * → data file
  | 'PENDING_IMPORT';   // Non résolu

export interface ExtractedReference {
  /** Source brute (e.g., "./utils", "../styles/main.css") */
  source: string;
  /** Symboles importés (e.g., ["foo", "bar"] ou ["*"] ou ["default"]) */
  symbols: string[];
  /** Type de référence détecté */
  type: ReferenceType;
  /** Ligne dans le fichier source (1-indexed) */
  line?: number;
  /** Est-ce une référence locale (vs package npm/externe) */
  isLocal: boolean;
}

export interface ResolvedReference extends ExtractedReference {
  /** Chemin absolu résolu */
  absolutePath: string;
  /** Chemin relatif au projet */
  relativePath: string;
  /** Type de relation à créer */
  relationType: RelationType;
}

export interface ReferenceCreationResult {
  /** Nombre de relations créées */
  created: number;
  /** Nombre de références en attente (non résolues) */
  pending: number;
  /** Détails des erreurs */
  errors: string[];
}

// ============================================
// Constants
// ============================================

/** Extensions par type de référence */
const TYPE_BY_EXTENSION: Record<string, ReferenceType> = {
  // Code
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code',
  '.mjs': 'code', '.cjs': 'code',
  '.py': 'code', '.pyw': 'code',
  '.vue': 'code', '.svelte': 'code',
  '.go': 'code', '.rs': 'code', '.rb': 'code', '.php': 'code',
  // Assets - Images
  '.png': 'asset', '.jpg': 'asset', '.jpeg': 'asset', '.gif': 'asset',
  '.svg': 'asset', '.webp': 'asset', '.ico': 'asset', '.bmp': 'asset',
  // Assets - Fonts
  '.woff': 'asset', '.woff2': 'asset', '.ttf': 'asset', '.eot': 'asset', '.otf': 'asset',
  // Assets - Audio
  '.mp3': 'asset', '.wav': 'asset', '.ogg': 'asset', '.flac': 'asset', '.aac': 'asset',
  // Assets - Video
  '.mp4': 'asset', '.webm': 'asset', '.avi': 'asset', '.mov': 'asset', '.mkv': 'asset',
  // Assets - 3D
  '.glb': 'asset', '.gltf': 'asset', '.fbx': 'asset', '.obj': 'asset', '.stl': 'asset',
  // Assets - Other
  '.zip': 'asset', '.pdf': 'document',
  // Documents
  '.md': 'document', '.mdx': 'document', '.markdown': 'document',
  '.doc': 'document', '.docx': 'document',
  '.txt': 'document', '.rtf': 'document',
  // Stylesheets
  '.css': 'stylesheet', '.scss': 'stylesheet', '.sass': 'stylesheet', '.less': 'stylesheet',
  // Data
  '.json': 'data', '.yaml': 'data', '.yml': 'data', '.xml': 'data',
  '.toml': 'data', '.ini': 'data', '.env': 'data',
};

/** Extensions de code qui peuvent être omises dans les imports */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];

/** Extensions d'index files */
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs'];

// ============================================
// Extraction Functions
// ============================================

/**
 * Extract all references from file content
 */
export function extractReferences(
  content: string,
  filePath: string
): ExtractedReference[] {
  const ext = path.extname(filePath).toLowerCase();
  const refs: ExtractedReference[] = [];

  // TypeScript / JavaScript
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    refs.push(...extractTypeScriptReferences(content));
  }
  // Python
  else if (['.py', '.pyw'].includes(ext)) {
    refs.push(...extractPythonReferences(content));
  }
  // Markdown
  else if (['.md', '.mdx', '.markdown'].includes(ext)) {
    refs.push(...extractMarkdownReferences(content));
  }
  // CSS / SCSS
  else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
    refs.push(...extractCssReferences(content));
  }
  // HTML
  else if (['.html', '.htm', '.xhtml'].includes(ext)) {
    refs.push(...extractHtmlReferences(content));
  }
  // Vue / Svelte (extract from script section)
  else if (['.vue', '.svelte'].includes(ext)) {
    refs.push(...extractVueSvelteReferences(content));
  }

  return refs;
}

/**
 * Extract TypeScript/JavaScript imports
 */
function extractTypeScriptReferences(content: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Named imports: import { foo, bar } from './module'
    const namedMatch = line.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
    if (namedMatch) {
      const symbols = namedMatch[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const source = namedMatch[2];
      refs.push({
        source,
        symbols,
        type: 'code',
        line: lineNum,
        isLocal: isLocalImport(source),
      });
      continue;
    }

    // Default import: import Foo from './module'
    const defaultMatch = line.match(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/);
    if (defaultMatch) {
      refs.push({
        source: defaultMatch[2],
        symbols: ['default'],
        type: 'code',
        line: lineNum,
        isLocal: isLocalImport(defaultMatch[2]),
      });
      continue;
    }

    // Namespace import: import * as Foo from './module'
    const namespaceMatch = line.match(/import\s*\*\s*as\s+(\w+)\s*from\s*['"]([^'"]+)['"]/);
    if (namespaceMatch) {
      refs.push({
        source: namespaceMatch[2],
        symbols: ['*'],
        type: 'code',
        line: lineNum,
        isLocal: isLocalImport(namespaceMatch[2]),
      });
      continue;
    }

    // Side-effect import: import './module'
    const sideEffectMatch = line.match(/import\s+['"]([^'"]+)['"]/);
    if (sideEffectMatch) {
      const source = sideEffectMatch[1];
      const ext = path.extname(source).toLowerCase();
      refs.push({
        source,
        symbols: [],
        type: TYPE_BY_EXTENSION[ext] || 'code',
        line: lineNum,
        isLocal: isLocalImport(source),
      });
      continue;
    }

    // Dynamic import: import('./module') or require('./module')
    const dynamicMatches = line.matchAll(/(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of dynamicMatches) {
      refs.push({
        source: match[1],
        symbols: ['*'],
        type: 'code',
        line: lineNum,
        isLocal: isLocalImport(match[1]),
      });
    }

    // Re-exports: export { foo } from './module'
    const reexportMatch = line.match(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
    if (reexportMatch) {
      const symbols = reexportMatch[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      refs.push({
        source: reexportMatch[2],
        symbols,
        type: 'code',
        line: lineNum,
        isLocal: isLocalImport(reexportMatch[2]),
      });
    }

    // Export all: export * from './module'
    const exportAllMatch = line.match(/export\s*\*\s*from\s*['"]([^'"]+)['"]/);
    if (exportAllMatch) {
      refs.push({
        source: exportAllMatch[1],
        symbols: ['*'],
        type: 'code',
        line: lineNum,
        isLocal: isLocalImport(exportAllMatch[1]),
      });
    }
  }

  return refs;
}

/**
 * Extract Python imports
 */
function extractPythonReferences(content: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // from .module import foo, bar
    const fromMatch = line.match(/from\s+(\.+\w*(?:\.\w+)*)\s+import\s+(.+)/);
    if (fromMatch) {
      const source = fromMatch[1];
      const symbolsPart = fromMatch[2].split('#')[0]; // Remove comments
      const symbols = symbolsPart.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      refs.push({
        source,
        symbols,
        type: 'code',
        line: lineNum,
        isLocal: source.startsWith('.'),
      });
      continue;
    }

    // import module (absolute - skip for now as not local)
    const importMatch = line.match(/^import\s+(\w+(?:\.\w+)*)/);
    if (importMatch) {
      refs.push({
        source: importMatch[1],
        symbols: ['*'],
        type: 'code',
        line: lineNum,
        isLocal: false, // Absolute imports are usually packages
      });
    }
  }

  return refs;
}

/**
 * Extract Markdown references (links and images)
 */
function extractMarkdownReferences(content: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Links: [text](./path/to/file.md)
    const linkMatches = line.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g);
    for (const match of linkMatches) {
      let target = match[2];
      // Skip external URLs
      if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
        continue;
      }
      // Remove anchor
      target = target.split('#')[0];
      if (!target) continue;

      const ext = path.extname(target).toLowerCase();
      refs.push({
        source: target,
        symbols: [],
        type: TYPE_BY_EXTENSION[ext] || 'document',
        line: lineNum,
        isLocal: true,
      });
    }

    // Images: ![alt](./path/to/image.png)
    const imgMatches = line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g);
    for (const match of imgMatches) {
      let target = match[2];
      // Skip external URLs
      if (target.startsWith('http://') || target.startsWith('https://')) {
        continue;
      }

      refs.push({
        source: target,
        symbols: [],
        type: 'asset',
        line: lineNum,
        isLocal: true,
      });
    }
  }

  return refs;
}

/**
 * Extract CSS/SCSS references
 */
function extractCssReferences(content: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // @import "./file.css" or @import url("./file.css")
    const importMatches = line.matchAll(/@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]\s*\)?/g);
    for (const match of importMatches) {
      const source = match[1];
      if (source.startsWith('http://') || source.startsWith('https://')) {
        continue;
      }
      refs.push({
        source,
        symbols: [],
        type: 'stylesheet',
        line: lineNum,
        isLocal: true,
      });
    }

    // url() references for fonts, images, etc.
    const urlMatches = line.matchAll(/url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/g);
    for (const match of urlMatches) {
      const source = match[1];
      // Skip external URLs and data URIs
      if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('data:')) {
        continue;
      }
      // Skip if already captured by @import
      if (line.includes('@import')) continue;

      const ext = path.extname(source).toLowerCase();
      refs.push({
        source,
        symbols: [],
        type: TYPE_BY_EXTENSION[ext] || 'asset',
        line: lineNum,
        isLocal: true,
      });
    }
  }

  return refs;
}

/**
 * Extract HTML references
 */
function extractHtmlReferences(content: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];

  // Track line numbers approximately
  let currentLine = 1;
  const getLineNumber = (index: number): number => {
    const before = content.substring(0, index);
    return before.split('\n').length;
  };

  // <script src="...">
  const scriptMatches = content.matchAll(/<script[^>]+src\s*=\s*['"]([^'"]+)['"]/gi);
  for (const match of scriptMatches) {
    const source = match[1];
    if (source.startsWith('http://') || source.startsWith('https://')) continue;
    refs.push({
      source,
      symbols: [],
      type: 'code',
      line: getLineNumber(match.index || 0),
      isLocal: true,
    });
  }

  // <link href="..."> (stylesheets)
  const linkMatches = content.matchAll(/<link[^>]+href\s*=\s*['"]([^'"]+)['"]/gi);
  for (const match of linkMatches) {
    const source = match[1];
    if (source.startsWith('http://') || source.startsWith('https://')) continue;
    const ext = path.extname(source).toLowerCase();
    refs.push({
      source,
      symbols: [],
      type: ext === '.css' || ext === '.scss' ? 'stylesheet' : TYPE_BY_EXTENSION[ext] || 'asset',
      line: getLineNumber(match.index || 0),
      isLocal: true,
    });
  }

  // <img src="...">
  const imgMatches = content.matchAll(/<img[^>]+src\s*=\s*['"]([^'"]+)['"]/gi);
  for (const match of imgMatches) {
    const source = match[1];
    if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('data:')) continue;
    refs.push({
      source,
      symbols: [],
      type: 'asset',
      line: getLineNumber(match.index || 0),
      isLocal: true,
    });
  }

  // <a href="..."> (internal links only)
  const anchorMatches = content.matchAll(/<a[^>]+href\s*=\s*['"]([^'"]+)['"]/gi);
  for (const match of anchorMatches) {
    let source = match[1];
    // Skip external URLs, anchors, and special protocols
    if (source.startsWith('http://') || source.startsWith('https://') ||
        source.startsWith('mailto:') || source.startsWith('tel:') ||
        source.startsWith('#') || source.startsWith('javascript:')) {
      continue;
    }
    // Remove anchor
    source = source.split('#')[0];
    if (!source) continue;

    const ext = path.extname(source).toLowerCase();
    refs.push({
      source,
      symbols: [],
      type: TYPE_BY_EXTENSION[ext] || 'document',
      line: getLineNumber(match.index || 0),
      isLocal: true,
    });
  }

  return refs;
}

/**
 * Extract references from Vue/Svelte files
 */
function extractVueSvelteReferences(content: string): ExtractedReference[] {
  const refs: ExtractedReference[] = [];

  // Extract from <script> sections
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    const scriptContent = scriptMatch[1];
    const scriptRefs = extractTypeScriptReferences(scriptContent);

    // Adjust line numbers based on script position
    const scriptStart = content.substring(0, content.indexOf(scriptMatch[0])).split('\n').length;
    for (const ref of scriptRefs) {
      if (ref.line) {
        ref.line += scriptStart;
      }
      refs.push(ref);
    }
  }

  // Extract from <style> sections
  const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch) {
    const styleContent = styleMatch[1];
    const styleRefs = extractCssReferences(styleContent);

    const styleStart = content.substring(0, content.indexOf(styleMatch[0])).split('\n').length;
    for (const ref of styleRefs) {
      if (ref.line) {
        ref.line += styleStart;
      }
      refs.push(ref);
    }
  }

  // Extract from <template> - img src, a href, etc.
  const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  if (templateMatch) {
    const templateContent = templateMatch[1];
    const templateRefs = extractHtmlReferences(templateContent);

    const templateStart = content.substring(0, content.indexOf(templateMatch[0])).split('\n').length;
    for (const ref of templateRefs) {
      if (ref.line) {
        ref.line += templateStart;
      }
      refs.push(ref);
    }
  }

  return refs;
}

// ============================================
// Resolution Functions
// ============================================

/**
 * Check if an import source is local (vs npm package)
 */
function isLocalImport(source: string): boolean {
  return isLocalPath(source);
}

/**
 * Try to resolve a path with common extensions
 */
async function resolveWithExtensions(
  source: string,
  baseDir: string
): Promise<string | null> {
  // If source already has extension, try it directly
  if (path.extname(source)) {
    const fullPath = path.resolve(baseDir, source);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      return null;
    }
  }

  // Try with code extensions
  for (const ext of CODE_EXTENSIONS) {
    const fullPath = path.resolve(baseDir, source + ext);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Continue trying
    }
  }

  // Try as directory with index file
  for (const indexFile of INDEX_FILES) {
    const fullPath = path.resolve(baseDir, source, indexFile);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Continue trying
    }
  }

  return null;
}

/**
 * Resolve a reference to an absolute path
 */
export async function resolveReference(
  ref: ExtractedReference,
  sourceFilePath: string,
  projectPath: string
): Promise<ResolvedReference | null> {
  if (!ref.isLocal) {
    return null; // Skip external packages
  }

  const sourceDir = path.dirname(sourceFilePath);
  const absolutePath = await resolveWithExtensions(ref.source, sourceDir);

  if (!absolutePath) {
    return null; // Cannot resolve
  }

  const relativePath = path.relative(projectPath, absolutePath);
  const targetExt = path.extname(absolutePath).toLowerCase();
  const targetType = TYPE_BY_EXTENSION[targetExt] || 'code';

  // Determine relation type based on target
  let relationType: RelationType;
  switch (targetType) {
    case 'asset':
      relationType = 'REFERENCES_ASSET';
      break;
    case 'document':
      relationType = 'REFERENCES_DOC';
      break;
    case 'stylesheet':
      relationType = 'REFERENCES_STYLE';
      break;
    case 'data':
      relationType = 'REFERENCES_DATA';
      break;
    default:
      relationType = 'CONSUMES';
  }

  return {
    ...ref,
    absolutePath,
    relativePath,
    relationType,
  };
}

/**
 * Resolve all references from a file
 */
export async function resolveAllReferences(
  refs: ExtractedReference[],
  sourceFilePath: string,
  projectPath: string
): Promise<ResolvedReference[]> {
  const resolved: ResolvedReference[] = [];

  for (const ref of refs) {
    const result = await resolveReference(ref, sourceFilePath, projectPath);
    if (result) {
      resolved.push(result);
    }
  }

  return resolved;
}

// ============================================
// Relation Creation Functions
// ============================================

/**
 * Create reference relations in Neo4j
 */
export async function createReferenceRelations(
  neo4jClient: Neo4jClient,
  sourceNodeUuid: string,
  sourceFile: string,
  refs: ResolvedReference[],
  projectId: string,
  options: {
    /** Create PENDING_IMPORT for unresolved refs (default: true) */
    createPending?: boolean;
    /** Use absolutePath for matching (for orphan files) */
    useAbsolutePath?: boolean;
  } = {}
): Promise<ReferenceCreationResult> {
  const { createPending = true, useAbsolutePath = false } = options;

  let created = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const ref of refs) {
    try {
      // Build the match condition based on options
      const pathCondition = useAbsolutePath
        ? 'target.absolutePath = $absolutePath'
        : '(target.file = $relativePath OR target.path = $relativePath)';

      // Try to find target node - check multiple node types
      const targetResult = await neo4jClient.run(`
        MATCH (target)
        WHERE target.projectId = $projectId
          AND ${pathCondition}
          AND (target:Scope OR target:File OR target:MarkdownDocument OR target:MarkdownSection
               OR target:Stylesheet OR target:DataFile OR target:MediaFile OR target:ImageFile
               OR target:ThreeDFile OR target:VueSFC OR target:SvelteComponent)
        RETURN target.uuid as uuid, labels(target) as labels
        LIMIT 1
      `, {
        projectId,
        relativePath: ref.relativePath,
        absolutePath: ref.absolutePath,
      });

      if (targetResult.records.length > 0) {
        const targetUuid = targetResult.records[0].get('uuid');
        const targetLabels = targetResult.records[0].get('labels') as string[];

        // For CONSUMES, try to find specific Scope with matching symbol
        if (ref.relationType === 'CONSUMES' && ref.symbols.length > 0 && !ref.symbols.includes('*')) {
          // Try to find Scope with matching exported name
          const scopeResult = await neo4jClient.run(`
            MATCH (scope:Scope {projectId: $projectId})
            WHERE (scope.absolutePath = $absolutePath OR scope.file = $relativePath OR scope.path = $relativePath)
              AND scope.name IN $symbols
            RETURN scope.uuid as uuid
            LIMIT 1
          `, { projectId, relativePath: ref.relativePath, absolutePath: ref.absolutePath, symbols: ref.symbols });

          if (scopeResult.records.length > 0) {
            const scopeUuid = scopeResult.records[0].get('uuid');
            await neo4jClient.run(`
              MATCH (source {uuid: $sourceUuid})
              MATCH (target:Scope {uuid: $targetUuid})
              MERGE (source)-[r:CONSUMES]->(target)
              SET r.symbols = $symbols,
                  r.createdAt = datetime()
            `, { sourceUuid: sourceNodeUuid, targetUuid: scopeUuid, symbols: ref.symbols });
            created++;
            continue;
          }
        }

        // Create the relationship to the found node
        await neo4jClient.run(`
          MATCH (source {uuid: $sourceUuid})
          MATCH (target {uuid: $targetUuid})
          MERGE (source)-[r:${ref.relationType}]->(target)
          SET r.symbols = $symbols,
              r.createdAt = datetime()
        `, { sourceUuid: sourceNodeUuid, targetUuid, symbols: ref.symbols });

        created++;
      } else if (createPending) {
        // Create PENDING_IMPORT for later resolution
        await neo4jClient.run(`
          MATCH (source {uuid: $sourceUuid})
          MERGE (source)-[r:PENDING_IMPORT {targetPath: $targetPath}]->(source)
          SET r.symbols = $symbols,
              r.intendedRelationType = $relationType,
              r.absolutePath = $absolutePath,
              r.createdAt = datetime()
        `, {
          sourceUuid: sourceNodeUuid,
          targetPath: ref.relativePath,
          symbols: ref.symbols,
          relationType: ref.relationType,
          absolutePath: ref.absolutePath,
        });

        pending++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to create relation for ${ref.source}: ${errMsg}`);
    }
  }

  return { created, pending, errors };
}

/**
 * Resolve pending imports after new files are indexed
 * Call this after ingesting new files to convert PENDING_IMPORT to actual relations
 */
export async function resolvePendingImports(
  neo4jClient: Neo4jClient,
  projectId: string
): Promise<{ resolved: number; remaining: number }> {
  let resolved = 0;

  // Find all PENDING_IMPORT relations
  const pendingResult = await neo4jClient.run(`
    MATCH (source)-[r:PENDING_IMPORT]->(source)
    WHERE source.projectId = $projectId
    RETURN source.uuid as sourceUuid, r.targetPath as targetPath, r.symbols as symbols,
           r.intendedRelationType as relationType, r.absolutePath as absolutePath
  `, { projectId });

  for (const record of pendingResult.records) {
    const sourceUuid = record.get('sourceUuid');
    const targetPath = record.get('targetPath');
    const symbols = record.get('symbols') || [];
    const relationType = record.get('relationType') || 'CONSUMES';
    const absolutePath = record.get('absolutePath');

    // Try to find the target now
    const targetResult = await neo4jClient.run(`
      MATCH (target)
      WHERE target.projectId = $projectId
        AND (target.file = $targetPath OR target.path = $targetPath OR target.absolutePath = $absolutePath)
        AND (target:Scope OR target:File OR target:MarkdownDocument OR target:Stylesheet
             OR target:DataFile OR target:MediaFile OR target:ImageFile)
      RETURN target.uuid as uuid
      LIMIT 1
    `, { projectId, targetPath, absolutePath });

    if (targetResult.records.length > 0) {
      const targetUuid = targetResult.records[0].get('uuid');

      // Create the actual relation
      await neo4jClient.run(`
        MATCH (source {uuid: $sourceUuid})
        MATCH (target {uuid: $targetUuid})
        MERGE (source)-[r:${relationType}]->(target)
        SET r.symbols = $symbols,
            r.resolvedFrom = 'pending',
            r.createdAt = datetime()
      `, { sourceUuid, targetUuid, symbols });

      // Delete the PENDING_IMPORT
      await neo4jClient.run(`
        MATCH (source {uuid: $sourceUuid})-[r:PENDING_IMPORT {targetPath: $targetPath}]->(source)
        DELETE r
      `, { sourceUuid, targetPath });

      resolved++;
    }
  }

  // Count remaining
  const remainingResult = await neo4jClient.run(`
    MATCH (source)-[r:PENDING_IMPORT]->(source)
    WHERE source.projectId = $projectId
    RETURN count(r) as count
  `, { projectId });

  const remaining = remainingResult.records[0]?.get('count')?.toNumber() || 0;

  return { resolved, remaining };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get the reference type for a file extension
 */
export function getReferenceType(filePath: string): ReferenceType {
  const ext = path.extname(filePath).toLowerCase();
  return TYPE_BY_EXTENSION[ext] || 'code';
}

/**
 * Get the relation type for a target file
 */
export function getRelationType(targetFilePath: string): RelationType {
  const type = getReferenceType(targetFilePath);
  switch (type) {
    case 'asset': return 'REFERENCES_ASSET';
    case 'document': return 'REFERENCES_DOC';
    case 'stylesheet': return 'REFERENCES_STYLE';
    case 'data': return 'REFERENCES_DATA';
    default: return 'CONSUMES';
  }
}
