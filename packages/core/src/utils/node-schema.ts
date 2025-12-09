/**
 * Node Schema Utilities
 *
 * Dynamically handles node types without hardcoding.
 * This enables adding new node types (Stylesheet, Markdown, etc.)
 * without modifying quickstart.ts or incremental-ingestion.ts.
 *
 * @since 2025-12-06
 */

import type { ParsedNode } from '../runtime/adapters/types.js';

/**
 * Configuration for prefix-based node types
 */
interface PrefixConfig {
  /** The field used for uniqueness constraint */
  uniqueField: 'path' | 'name' | 'uuid';
  /** Whether to strip prefix when matching (for path/name based nodes) */
  stripPrefix: boolean;
}

/**
 * Known prefix patterns and their configurations.
 * Nodes with these prefixes use special unique fields.
 * All other prefixes default to uuid-based matching.
 */
const PREFIX_CONFIGS: Record<string, PrefixConfig> = {
  'file:': { uniqueField: 'path', stripPrefix: true },
  'dir:': { uniqueField: 'path', stripPrefix: true },
  'lib:': { uniqueField: 'name', stripPrefix: true },
  'project:': { uniqueField: 'name', stripPrefix: true },
};

/**
 * Result of analyzing a node ID
 */
export interface NodeTypeInfo {
  /** The prefix (e.g., 'file:', 'stylesheet:') or empty string */
  prefix: string;
  /** The field used for uniqueness (path, name, or uuid) */
  uniqueField: 'path' | 'name' | 'uuid';
  /** The value to use for MATCH queries (stripped or full ID) */
  matchValue: string;
  /** Whether this is a uuid-based node (keeps full prefixed ID) */
  isUuidBased: boolean;
}

/**
 * Infer node type information from an ID
 *
 * @param id - The node ID (e.g., 'file:src/index.ts', 'stylesheet:ABC123')
 * @returns NodeTypeInfo with prefix, uniqueField, and matchValue
 *
 * @example
 * getNodeTypeFromId('file:src/index.ts')
 * // { prefix: 'file:', uniqueField: 'path', matchValue: 'src/index.ts', isUuidBased: false }
 *
 * getNodeTypeFromId('stylesheet:ABC123')
 * // { prefix: 'stylesheet:', uniqueField: 'uuid', matchValue: 'stylesheet:ABC123', isUuidBased: true }
 */
export function getNodeTypeFromId(id: string): NodeTypeInfo {
  for (const [prefix, config] of Object.entries(PREFIX_CONFIGS)) {
    if (id.startsWith(prefix)) {
      return {
        prefix,
        uniqueField: config.uniqueField,
        matchValue: config.stripPrefix ? id.slice(prefix.length) : id,
        isUuidBased: false
      };
    }
  }

  // Extract prefix for uuid-based nodes (everything before first ':' if present)
  const colonIndex = id.indexOf(':');
  const prefix = colonIndex > 0 ? id.slice(0, colonIndex + 1) : '';

  return {
    prefix,
    uniqueField: 'uuid',
    matchValue: id, // Keep full ID for uuid-based nodes
    isUuidBased: true
  };
}

/**
 * Group nodes by their primary label
 *
 * @param nodes - Array of parsed nodes
 * @returns Map of label -> nodes array
 */
export function groupNodesByLabel(nodes: ParsedNode[]): Map<string, ParsedNode[]> {
  const byLabel = new Map<string, ParsedNode[]>();

  for (const node of nodes) {
    const label = node.labels[0];
    if (!label) continue;

    if (!byLabel.has(label)) {
      byLabel.set(label, []);
    }
    byLabel.get(label)!.push(node);
  }

  return byLabel;
}

/**
 * Infer the unique field for a node based on its ID
 *
 * @param node - A parsed node
 * @returns The unique field ('path', 'name', or 'uuid')
 */
export function inferUniqueField(node: ParsedNode): 'path' | 'name' | 'uuid' {
  return getNodeTypeFromId(node.id).uniqueField;
}

/**
 * Content node types that should be tracked for changes.
 * These are nodes with searchable/embeddable content that need:
 * - Hash-based change detection
 * - Schema versioning
 * - Embedding generation
 *
 * Structural nodes (File, Directory, Project) are NOT in this set.
 */
export const CONTENT_NODE_LABELS = new Set([
  'Scope',              // Code scopes (functions, classes, etc.)
  'MediaFile',          // Base media type
  'ImageFile',          // Images
  'ThreeDFile',         // 3D models
  'DocumentFile',       // Documents (PDF, DOCX, etc.)
  'MarkdownSection',    // Markdown sections
  'CodeBlock',          // Code blocks in markdown
  'MarkdownDocument',   // Markdown documents
  'SpreadsheetDocument', // Excel, CSV
  'PDFDocument',        // PDF documents
  'WordDocument',       // Word documents
  'WebPage',            // Web pages
  'VueSFC',             // Vue single file components
  'SvelteComponent',    // Svelte components
  'Stylesheet',         // CSS/SCSS stylesheets
  'DataFile',           // JSON, YAML, etc.
  'GenericFile',        // Unknown code files
  'WebDocument',        // HTML documents
]);

/**
 * Check if a node is structural (File, Directory, Project)
 *
 * Structural nodes are always upserted during incremental ingestion,
 * regardless of whether their content has changed.
 *
 * Content nodes (Scope, DocumentFile, MarkdownSection, MediaFile, etc.) are tracked for changes.
 *
 * @param node - A parsed node
 * @returns true if the node is structural (File, Directory, Project only)
 */
export function isStructuralNode(node: ParsedNode): boolean {
  const isContentNode = node.labels.some(l => CONTENT_NODE_LABELS.has(l));
  return !isContentNode;
}

/**
 * Check if a node is a Scope node
 *
 * @param node - A parsed node
 * @returns true if the node is a Scope
 */
export function isScopeNode(node: ParsedNode): boolean {
  return node.labels.includes('Scope');
}

/**
 * Get the Cypher variable reference for a unique field
 *
 * @param uniqueField - The unique field type
 * @returns The Cypher expression to use in MERGE/MATCH
 */
export function getCypherUniqueValue(uniqueField: 'path' | 'name' | 'uuid'): string {
  switch (uniqueField) {
    case 'path':
      return 'nodeData.props.path';
    case 'name':
      return 'nodeData.props.name';
    case 'uuid':
      return 'nodeData.uuid';
  }
}

/**
 * Generate a constraint name for a node type
 *
 * @param label - The node label
 * @param uniqueField - The unique field
 * @returns A valid Neo4j constraint name
 */
export function getConstraintName(label: string, uniqueField: string): string {
  return `${label.toLowerCase()}_${uniqueField}`;
}

/**
 * Known node types that need specific indexes beyond the unique constraint
 */
export const TYPE_INDEXES: Record<string, string[]> = {
  Scope: ['name', 'type', 'file'],
};

/**
 * Schema definition for a node type (for ingestion/tools)
 * Note: This is different from types/schema.ts NodeSchema which is for Neo4j introspection
 */
export interface NodeTypeSchema {
  /** Required properties - must always be present */
  required: string[];
  /** Optional properties - may be present depending on content */
  optional?: string[];
  /** Description of the node type */
  description?: string;
}

/**
 * Schema definitions for content nodes.
 * This is the single source of truth for node type schemas.
 *
 * Required properties define the "shape" of each node type.
 * Optional properties may be present depending on the content being parsed.
 *
 * The schema hash is computed from required properties only,
 * ensuring nodes of the same type get the same schemaVersion regardless
 * of which optional properties they have.
 */
export const NODE_SCHEMAS: Record<string, NodeTypeSchema> = {
  // Code scopes (functions, classes, methods, etc.)
  Scope: {
    required: ['name', 'type', 'file', 'language', 'startLine', 'endLine', 'linesOfCode', 'source', 'signature'],
    optional: [
      'returnType',      // Return type for functions/methods
      'parameters',      // Function parameters (JSON string)
      'parent',          // Parent scope name
      'parentUUID',      // Parent scope UUID
      'depth',           // Nesting depth
      'modifiers',       // Access modifiers (public, private, static, etc.)
      'complexity',      // Cyclomatic complexity
      'heritageClauses', // extends/implements clauses (JSON string)
      'extends',         // Extended classes (comma-separated)
      'implements',      // Implemented interfaces (comma-separated)
      'genericParameters', // Generic type parameters (JSON string)
      'generics',        // Generic names (comma-separated)
      'decoratorDetails', // Decorator details (JSON string)
      'decorators',      // Decorator names (comma-separated)
      'enumMembers',     // Enum member values (JSON string)
      'docstring',       // Documentation string
      'value',           // Value for constants/variables
      // Embeddings (generated)
      'nameEmbedding',
      'contentEmbedding',
      'descriptionEmbedding',
    ],
    description: 'Code scope (function, class, method, interface, variable, etc.)',
  },

  // Markdown documents
  MarkdownDocument: {
    required: ['file', 'type', 'title', 'sectionCount', 'codeBlockCount', 'linkCount', 'imageCount', 'wordCount'],
    optional: [
      'frontMatter',  // YAML front matter (JSON string)
      'sections',     // Section summary (JSON string)
    ],
    description: 'Markdown document with sections and code blocks',
  },

  // Markdown sections (headings)
  MarkdownSection: {
    required: ['title', 'level', 'content', 'file', 'startLine', 'endLine', 'slug'],
    optional: [
      'ownContent',   // Section content without children
      'rawText',      // Raw text content for search
      'parentTitle',  // Parent section title
      // Embeddings
      'nameEmbedding',
      'contentEmbedding',
    ],
    description: 'Section within a markdown document',
  },

  // Code blocks in markdown
  CodeBlock: {
    required: ['file', 'language', 'code', 'rawText', 'startLine', 'endLine'],
    optional: [
      'index',        // Index in document
      'linesOfCode',  // Line count
      // Embeddings
      'contentEmbedding',
    ],
    description: 'Code block embedded in markdown',
  },

  // Web pages
  WebPage: {
    required: ['url', 'title', 'textContent', 'headingCount', 'linkCount', 'depth', 'crawledAt'],
    optional: [
      'description',    // Meta description
      'headingsJson',   // Headings structure (JSON string)
      'rawHtml',        // Original HTML
      // Embeddings
      'contentEmbedding',
    ],
    description: 'Crawled web page',
  },

  // Media files (base type)
  MediaFile: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'analyzed',       // Whether content analysis was performed
      'description',    // Visual description (from AI)
      'ocrText',        // OCR extracted text
      // Embeddings
      'descriptionEmbedding',
    ],
    description: 'Base type for media files',
  },

  // Image files
  ImageFile: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'width',          // Image width in pixels
      'height',         // Image height in pixels
      'analyzed',
      'description',
      'ocrText',
      'descriptionEmbedding',
    ],
    description: 'Image file (PNG, JPG, GIF, WebP, SVG, etc.)',
  },

  // 3D model files
  ThreeDFile: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'meshCount',      // Number of meshes
      'materialCount',  // Number of materials
      'textureCount',   // Number of textures
      'animationCount', // Number of animations
      'gltfVersion',    // GLTF version
      'generator',      // Generator tool
      'analyzed',
      'description',
      'renderedViews',  // Paths to rendered view images
      'descriptionEmbedding',
    ],
    description: '3D model file (GLTF, GLB)',
  },

  // Document files (PDF, Word, etc.)
  DocumentFile: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'pageCount',
      'title',
      'author',
      'extractedText',
      'contentEmbedding',
    ],
    description: 'Document file (PDF, DOCX, etc.)',
  },

  // PDF documents
  PDFDocument: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'pageCount',
      'title',
      'author',
      'subject',
      'extractedText',
      'contentEmbedding',
    ],
    description: 'PDF document',
  },

  // Word documents
  WordDocument: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'pageCount',
      'title',
      'author',
      'extractedText',
      'contentEmbedding',
    ],
    description: 'Word document (DOCX)',
  },

  // Spreadsheet documents
  SpreadsheetDocument: {
    required: ['file', 'path', 'format', 'category', 'sizeBytes'],
    optional: [
      'sheetCount',
      'sheetNames',
      'rowCount',
      'columnCount',
      'extractedText',
    ],
    description: 'Spreadsheet (XLSX, CSV)',
  },

  // Vue single file components
  VueSFC: {
    required: ['file', 'type', 'templateStartLine', 'templateEndLine'],
    optional: [
      'componentName',
      'scriptLang',
      'isScriptSetup',
      'hasStyle',
      'imports',
      'usedComponents',
    ],
    description: 'Vue Single File Component',
  },

  // Svelte components
  SvelteComponent: {
    required: ['file', 'type', 'templateStartLine', 'templateEndLine'],
    optional: [
      'componentName',
      'scriptLang',
      'hasStyle',
      'imports',
    ],
    description: 'Svelte component',
  },

  // CSS/SCSS stylesheets
  Stylesheet: {
    required: ['file', 'type', 'ruleCount'],
    optional: [
      'selectorCount',
      'variableCount',
      'mixinCount',
      'importCount',
    ],
    description: 'CSS/SCSS stylesheet',
  },

  // Data files (JSON, YAML, etc.)
  DataFile: {
    required: ['file', 'type', 'format'],
    optional: [
      'keyCount',
      'structure',
      'preview',
    ],
    description: 'Data file (JSON, YAML, XML, etc.)',
  },

  // Generic/unknown code files
  GenericFile: {
    required: ['file', 'type', 'language', 'linesOfCode'],
    optional: [
      'braceStyle',
      'imports',
    ],
    description: 'Generic code file with unknown syntax',
  },

  // HTML documents
  WebDocument: {
    required: ['file', 'type', 'title'],
    optional: [
      'hasTemplate',
      'hasScript',
      'hasStyle',
      'componentName',
      'scriptLang',
      'isScriptSetup',
      'imports',
      'usedComponents',
      'imageCount',
    ],
    description: 'HTML document or web component',
  },

  // Structural nodes (not content nodes, but included for completeness)
  File: {
    required: ['path', 'name', 'directory', 'extension'],
    optional: [
      'contentHash',
      'rawContentHash',
      'mtime',
    ],
    description: 'File in the filesystem',
  },

  Directory: {
    required: ['path', 'depth'],
    optional: [],
    description: 'Directory in the filesystem',
  },

  Project: {
    required: ['name', 'rootPath'],
    optional: [
      'gitRemote',
      'indexedAt',
    ],
    description: 'Project root',
  },

  ExternalLibrary: {
    required: ['name'],
    optional: [],
    description: 'External library dependency',
  },

  PackageJson: {
    required: ['file', 'name', 'version'],
    optional: [
      'description',
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'scripts',
      'main',
      'moduleType',
    ],
    description: 'package.json file',
  },
};

/**
 * Get the required properties for a node type.
 * Returns undefined if the type is not defined (fallback to dynamic computation).
 */
export function getRequiredProperties(nodeType: string): string[] | undefined {
  return NODE_SCHEMAS[nodeType]?.required;
}

/**
 * Get additional indexes needed for a node type
 *
 * @param label - The node label
 * @returns Array of field names to index
 */
export function getAdditionalIndexes(label: string): string[] {
  return TYPE_INDEXES[label] || [];
}
