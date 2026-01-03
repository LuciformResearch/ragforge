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

// ============================================================
// PROPERTY TYPES (for Kuzu schema generation)
// ============================================================

/**
 * Property types supported by Kuzu
 */
export type PropType = 'STRING' | 'INT64' | 'DOUBLE' | 'BOOLEAN' | 'DOUBLE[]' | 'STRING[]';

/**
 * Property definition with type
 */
export interface PropDef {
  type: PropType;
  nullable?: boolean;
}

/**
 * Common state tracking properties (for stateful nodes)
 */
export const STATE_PROPS: Record<string, PropDef> = {
  _state: { type: 'STRING' },
  _stateChangedAt: { type: 'STRING', nullable: true },
  _errorType: { type: 'STRING', nullable: true },
  _errorMessage: { type: 'STRING', nullable: true },
  _retryCount: { type: 'INT64', nullable: true },
  _createdAt: { type: 'STRING', nullable: true },
  _updatedAt: { type: 'STRING', nullable: true },
  _detectedAt: { type: 'STRING', nullable: true },
  _parsedAt: { type: 'STRING', nullable: true },
  _linkedAt: { type: 'STRING', nullable: true },
  _embeddedAt: { type: 'STRING', nullable: true },
  _contentHash: { type: 'STRING', nullable: true },
  // Properties used by incremental ingestion
  schemaDirty: { type: 'BOOLEAN', nullable: true },
  embeddingsDirty: { type: 'BOOLEAN', nullable: true },
  hash: { type: 'STRING', nullable: true },
  textContent: { type: 'STRING', nullable: true },
  source_file: { type: 'STRING', nullable: true },
};

/**
 * Common embedding properties (multi-embedding support)
 */
export const EMBEDDING_PROPS: Record<string, PropDef> = {
  // Legacy single embedding (kept for backwards compatibility)
  embedding: { type: 'DOUBLE[]', nullable: true },
  _embeddingHash: { type: 'STRING', nullable: true },
  // Multi-embedding: name embedding (for fuzzy name search)
  embedding_name: { type: 'DOUBLE[]', nullable: true },
  embedding_name_hash: { type: 'STRING', nullable: true },
  // Multi-embedding: content embedding (for semantic code search)
  embedding_content: { type: 'DOUBLE[]', nullable: true },
  embedding_content_hash: { type: 'STRING', nullable: true },
  // Multi-embedding: description embedding (for docstring/comment search)
  embedding_description: { type: 'DOUBLE[]', nullable: true },
  embedding_description_hash: { type: 'STRING', nullable: true },
  // Provider info (shared across all embedding types)
  _embeddingProvider: { type: 'STRING', nullable: true },
  _embeddingModel: { type: 'STRING', nullable: true },
  embedding_provider: { type: 'STRING', nullable: true },
  embedding_model: { type: 'STRING', nullable: true },
  // Chunking support for large files
  usesChunks: { type: 'BOOLEAN', nullable: true },
  chunkCount: { type: 'INT64', nullable: true },
};

/**
 * Schema definition for a node type (for ingestion/tools)
 * Note: This is different from types/schema.ts NodeSchema which is for Neo4j introspection
 */
export interface NodeTypeSchema {
  /** Primary key field (default: 'uuid') */
  primaryKey?: string;
  /** Required properties with types */
  required: Record<string, PropDef>;
  /** Optional properties with types */
  optional?: Record<string, PropDef>;
  /** Description of the node type */
  description?: string;
  /** Whether this node type supports state tracking */
  stateful?: boolean;
  /** Whether this node type has embeddings */
  hasEmbedding?: boolean;
}

/**
 * Schema definitions for all node types.
 * This is the single source of truth for node type schemas.
 *
 * Used for:
 * - Kuzu table generation (types)
 * - Schema validation
 * - Embedding extraction
 */
export const NODE_SCHEMAS: Record<string, NodeTypeSchema> = {
  // ============================================================
  // STRUCTURAL NODES
  // ============================================================

  Project: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      projectId: { type: 'STRING' },
      name: { type: 'STRING' },
      path: { type: 'STRING' },
    },
    optional: {
      rootPath: { type: 'STRING', nullable: true }, // Project root directory path
      type: { type: 'STRING', nullable: true }, // Project type: quick-ingest, web-crawl, etc.
      lastAccessed: { type: 'STRING', nullable: true }, // ISO timestamp of last access
      excluded: { type: 'BOOLEAN', nullable: true }, // Whether project is excluded from search
      autoCleanup: { type: 'BOOLEAN', nullable: true }, // Whether to auto-cleanup old data
      displayName: { type: 'STRING', nullable: true }, // Human-readable display name
      gitRemote: { type: 'STRING', nullable: true },
      gitBranch: { type: 'STRING', nullable: true },
      indexedAt: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
    },
    stateful: true,
    description: 'Project root',
  },

  Directory: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      depth: { type: 'INT64', nullable: true },
    },
    description: 'Directory in the filesystem',
  },

  File: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      absolutePath: { type: 'STRING', nullable: true }, // Full absolute path to file
      extension: { type: 'STRING', nullable: true },
      projectId: { type: 'STRING', nullable: true },
      directory: { type: 'STRING', nullable: true },
      lineCount: { type: 'INT64', nullable: true },
      contentHash: { type: 'STRING', nullable: true },
      rawContentHash: { type: 'STRING', nullable: true },
      mtime: { type: 'STRING', nullable: true },
      source: { type: 'STRING', nullable: true }, // File content for embedding
      // Orphan watcher properties
      isWatched: { type: 'BOOLEAN', nullable: true },
      watchedSince: { type: 'STRING', nullable: true }, // ISO timestamp
      firstAccessed: { type: 'STRING', nullable: true }, // ISO timestamp - first touch
      lastAccessed: { type: 'STRING', nullable: true }, // ISO timestamp - last touch
      accessCount: { type: 'INT64', nullable: true }, // Number of times accessed
      // State property (used by file state machine)
      state: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'File in the filesystem',
  },

  ExternalLibrary: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
    },
    description: 'External library dependency',
  },

  // ============================================================
  // CODE NODES
  // ============================================================

  Scope: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      name: { type: 'STRING' },
      type: { type: 'STRING' },
    },
    optional: {
      signature: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      projectId: { type: 'STRING', nullable: true },
      language: { type: 'STRING', nullable: true },
      startLine: { type: 'INT64', nullable: true },
      endLine: { type: 'INT64', nullable: true },
      startCol: { type: 'INT64', nullable: true },
      endCol: { type: 'INT64', nullable: true },
      linesOfCode: { type: 'INT64', nullable: true },
      source: { type: 'STRING', nullable: true },
      docstring: { type: 'STRING', nullable: true },
      returnType: { type: 'STRING', nullable: true },
      parameters: { type: 'STRING', nullable: true },
      parent: { type: 'STRING', nullable: true },
      parentUUID: { type: 'STRING', nullable: true },
      depth: { type: 'INT64', nullable: true },
      modifiers: { type: 'STRING', nullable: true },
      complexity: { type: 'INT64', nullable: true },
      isExported: { type: 'BOOLEAN', nullable: true },
      isAsync: { type: 'BOOLEAN', nullable: true },
      extends: { type: 'STRING', nullable: true },
      implements: { type: 'STRING', nullable: true },
      generics: { type: 'STRING', nullable: true },
      decorators: { type: 'STRING', nullable: true },
      value: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Code scope (function, class, method, interface, variable, etc.)',
  },

  // ============================================================
  // MARKDOWN NODES
  // ============================================================

  MarkdownDocument: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      title: { type: 'STRING', nullable: true },
      wordCount: { type: 'INT64', nullable: true },
      sectionCount: { type: 'INT64', nullable: true },
      codeBlockCount: { type: 'INT64', nullable: true },
      linkCount: { type: 'INT64', nullable: true },
      imageCount: { type: 'INT64', nullable: true },
      frontMatter: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Markdown document with sections and code blocks',
  },

  MarkdownSection: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
    },
    optional: {
      path: { type: 'STRING', nullable: true },
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      title: { type: 'STRING', nullable: true },
      heading: { type: 'STRING', nullable: true },
      level: { type: 'INT64', nullable: true },
      content: { type: 'STRING', nullable: true },
      ownContent: { type: 'STRING', nullable: true },
      rawText: { type: 'STRING', nullable: true },
      slug: { type: 'STRING', nullable: true },
      startLine: { type: 'INT64', nullable: true },
      endLine: { type: 'INT64', nullable: true },
      parentTitle: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Section within a markdown document',
  },

  CodeBlock: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
    },
    optional: {
      file: { type: 'STRING', nullable: true },
      projectId: { type: 'STRING', nullable: true },
      language: { type: 'STRING', nullable: true },
      code: { type: 'STRING', nullable: true },
      rawText: { type: 'STRING', nullable: true },
      startLine: { type: 'INT64', nullable: true },
      endLine: { type: 'INT64', nullable: true },
      index: { type: 'INT64', nullable: true },
      linesOfCode: { type: 'INT64', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Code block embedded in markdown',
  },

  // ============================================================
  // WEB NODES
  // ============================================================

  WebPage: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      url: { type: 'STRING' },
    },
    optional: {
      title: { type: 'STRING', nullable: true },
      projectId: { type: 'STRING', nullable: true },
      textContent: { type: 'STRING', nullable: true },
      content: { type: 'STRING', nullable: true },
      html: { type: 'STRING', nullable: true },
      rawHtml: { type: 'STRING', nullable: true },
      description: { type: 'STRING', nullable: true },
      metaDescription: { type: 'STRING', nullable: true },
      headingCount: { type: 'INT64', nullable: true },
      linkCount: { type: 'INT64', nullable: true },
      depth: { type: 'INT64', nullable: true },
      crawledAt: { type: 'STRING', nullable: true },
      headingsJson: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Crawled web page',
  },

  // ============================================================
  // MEDIA NODES
  // ============================================================

  ImageFile: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      format: { type: 'STRING', nullable: true },
      category: { type: 'STRING', nullable: true },
      sizeBytes: { type: 'INT64', nullable: true },
      width: { type: 'INT64', nullable: true },
      height: { type: 'INT64', nullable: true },
      analyzed: { type: 'BOOLEAN', nullable: true },
      description: { type: 'STRING', nullable: true },
      ocrText: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Image file (PNG, JPG, GIF, WebP, SVG, etc.)',
  },

  ThreeDFile: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      format: { type: 'STRING', nullable: true },
      category: { type: 'STRING', nullable: true },
      sizeBytes: { type: 'INT64', nullable: true },
      meshCount: { type: 'INT64', nullable: true },
      materialCount: { type: 'INT64', nullable: true },
      textureCount: { type: 'INT64', nullable: true },
      animationCount: { type: 'INT64', nullable: true },
      gltfVersion: { type: 'STRING', nullable: true },
      generator: { type: 'STRING', nullable: true },
      analyzed: { type: 'BOOLEAN', nullable: true },
      description: { type: 'STRING', nullable: true },
      renderedViews: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: '3D model file (GLTF, GLB)',
  },

  // ============================================================
  // DOCUMENT NODES
  // ============================================================

  DocumentFile: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      format: { type: 'STRING', nullable: true },
      category: { type: 'STRING', nullable: true },
      sizeBytes: { type: 'INT64', nullable: true },
      pageCount: { type: 'INT64', nullable: true },
      title: { type: 'STRING', nullable: true },
      author: { type: 'STRING', nullable: true },
      extractedText: { type: 'STRING', nullable: true },
      content: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Document file (PDF, DOCX, etc.)',
  },

  DataFile: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      format: { type: 'STRING', nullable: true },
      keyCount: { type: 'INT64', nullable: true },
      structure: { type: 'STRING', nullable: true },
      preview: { type: 'STRING', nullable: true },
      rawContent: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Data file (JSON, YAML, XML, etc.)',
  },

  MediaFile: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      format: { type: 'STRING', nullable: true },
      category: { type: 'STRING', nullable: true },
      sizeBytes: { type: 'INT64', nullable: true },
      duration: { type: 'INT64', nullable: true },
      width: { type: 'INT64', nullable: true },
      height: { type: 'INT64', nullable: true },
      textContent: { type: 'STRING', nullable: true },
      ocrText: { type: 'STRING', nullable: true },
      description: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Media file (audio, video)',
  },

  WebDocument: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      url: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      title: { type: 'STRING', nullable: true },
      content: { type: 'STRING', nullable: true },
      html: { type: 'STRING', nullable: true },
      fetchedAt: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
      ...EMBEDDING_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Web document (fetched HTML page)',
  },

  // ============================================================
  // COMPONENT NODES
  // ============================================================

  VueSFC: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      componentName: { type: 'STRING', nullable: true },
      scriptLang: { type: 'STRING', nullable: true },
      isScriptSetup: { type: 'BOOLEAN', nullable: true },
      hasStyle: { type: 'BOOLEAN', nullable: true },
      templateStartLine: { type: 'INT64', nullable: true },
      templateEndLine: { type: 'INT64', nullable: true },
      imports: { type: 'STRING', nullable: true },
      usedComponents: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
    },
    stateful: true,
    description: 'Vue Single File Component',
  },

  SvelteComponent: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      componentName: { type: 'STRING', nullable: true },
      scriptLang: { type: 'STRING', nullable: true },
      hasStyle: { type: 'BOOLEAN', nullable: true },
      templateStartLine: { type: 'INT64', nullable: true },
      templateEndLine: { type: 'INT64', nullable: true },
      imports: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
    },
    stateful: true,
    description: 'Svelte component',
  },

  Stylesheet: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      path: { type: 'STRING' },
      name: { type: 'STRING' },
    },
    optional: {
      projectId: { type: 'STRING', nullable: true },
      file: { type: 'STRING', nullable: true },
      ruleCount: { type: 'INT64', nullable: true },
      selectorCount: { type: 'INT64', nullable: true },
      variableCount: { type: 'INT64', nullable: true },
      mixinCount: { type: 'INT64', nullable: true },
      importCount: { type: 'INT64', nullable: true },
      ...STATE_PROPS,
    },
    stateful: true,
    description: 'CSS/SCSS stylesheet',
  },

  PackageJson: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
    },
    optional: {
      file: { type: 'STRING', nullable: true },
      path: { type: 'STRING', nullable: true },
      name: { type: 'STRING', nullable: true },
      version: { type: 'STRING', nullable: true },
      description: { type: 'STRING', nullable: true },
      dependencies: { type: 'STRING', nullable: true },
      devDependencies: { type: 'STRING', nullable: true },
      peerDependencies: { type: 'STRING', nullable: true },
      scripts: { type: 'STRING', nullable: true },
      main: { type: 'STRING', nullable: true },
      moduleType: { type: 'STRING', nullable: true },
      projectId: { type: 'STRING', nullable: true },
    },
    description: 'package.json file',
  },

  // ============================================================
  // EMBEDDING CHUNKS (for large content that needs chunking)
  // ============================================================

  EmbeddingChunk: {
    primaryKey: 'uuid',
    required: {
      uuid: { type: 'STRING' },
      projectId: { type: 'STRING' },
      parentUuid: { type: 'STRING' },
      parentLabel: { type: 'STRING' },
    },
    optional: {
      chunkIndex: { type: 'INT64', nullable: true },
      text: { type: 'STRING', nullable: true },
      startChar: { type: 'INT64', nullable: true },
      endChar: { type: 'INT64', nullable: true },
      startLine: { type: 'INT64', nullable: true },
      endLine: { type: 'INT64', nullable: true },
      embedding_content: { type: 'DOUBLE[]', nullable: true },
      embedding_content_hash: { type: 'STRING', nullable: true },
      embedding_provider: { type: 'STRING', nullable: true },
      embedding_model: { type: 'STRING', nullable: true },
      // State machine embedding tracking (used by P.embeddingProvider/P.embeddingModel)
      _embeddingProvider: { type: 'STRING', nullable: true },
      _embeddingModel: { type: 'STRING', nullable: true },
      ...STATE_PROPS,
    },
    stateful: true,
    hasEmbedding: true,
    description: 'Embedding chunk for large content that was split into smaller pieces',
  },

  // ============================================================
  // SYSTEM METADATA
  // ============================================================

  RagForgeMetadata: {
    required: {
      uuid: { type: 'STRING' },
      key: { type: 'STRING' },
    },
    optional: {
      value: { type: 'STRING', nullable: true },
      boolValue: { type: 'BOOLEAN', nullable: true },
      intValue: { type: 'INT64', nullable: true },
      updatedAt: { type: 'STRING', nullable: true },
    },
    stateful: false,
    hasEmbedding: false,
    description: 'System metadata storage (index state, configuration, etc.)',
  },
};

// ============================================================
// RELATIONSHIP SCHEMAS
// ============================================================

export interface RelSchema {
  from: string;
  to: string;
  properties?: Record<string, PropDef>;
}

export const REL_SCHEMAS: Record<string, RelSchema[]> = {
  BELONGS_TO: [
    { from: 'File', to: 'Project' },
    { from: 'Scope', to: 'Project' },
    { from: 'MarkdownDocument', to: 'Project' },
    { from: 'MarkdownSection', to: 'Project' },
    { from: 'CodeBlock', to: 'Project' },
    { from: 'DataFile', to: 'Project' },
    { from: 'MediaFile', to: 'Project' },
    { from: 'ImageFile', to: 'Project' },
    { from: 'ThreeDFile', to: 'Project' },
    { from: 'DocumentFile', to: 'Project' },
    { from: 'VueSFC', to: 'Project' },
    { from: 'SvelteComponent', to: 'Project' },
    { from: 'Stylesheet', to: 'Project' },
    { from: 'WebPage', to: 'Project' },
    { from: 'WebDocument', to: 'Project' },
    { from: 'PackageJson', to: 'Project' },
  ],
  IN_PROJECT: [
    { from: 'File', to: 'Project' },
    { from: 'Directory', to: 'Project' },
    { from: 'Scope', to: 'Project' },
  ],
  IN_DIRECTORY: [
    { from: 'File', to: 'Directory' },
    { from: 'Directory', to: 'Directory' },
  ],
  DEFINED_IN: [
    { from: 'Scope', to: 'File' },
  ],
  CONTAINS: [
    { from: 'Scope', to: 'Scope' },
  ],
  CONSUMES: [
    { from: 'Scope', to: 'Scope', properties: { line: { type: 'INT64', nullable: true } } },
  ],
  CONSUMED_BY: [
    { from: 'Scope', to: 'Scope' },
  ],
  INHERITS_FROM: [
    { from: 'Scope', to: 'Scope' },
  ],
  IMPLEMENTS: [
    { from: 'Scope', to: 'Scope' },
  ],
  DECORATED_BY: [
    { from: 'Scope', to: 'Scope' },
  ],
  USES_LIBRARY: [
    { from: 'Scope', to: 'ExternalLibrary' },
  ],
  IN_DOCUMENT: [
    { from: 'MarkdownSection', to: 'MarkdownDocument' },
    { from: 'CodeBlock', to: 'MarkdownSection' },
  ],
  LINKS_TO: [
    { from: 'WebPage', to: 'WebPage' },
  ],
  HAS_EMBEDDING_CHUNK: [
    { from: 'Scope', to: 'EmbeddingChunk' },
    { from: 'File', to: 'EmbeddingChunk' },
    { from: 'MarkdownDocument', to: 'EmbeddingChunk' },
    { from: 'MarkdownSection', to: 'EmbeddingChunk' },
    { from: 'CodeBlock', to: 'EmbeddingChunk' },
    { from: 'WebPage', to: 'EmbeddingChunk' },
    { from: 'ImageFile', to: 'EmbeddingChunk' },
    { from: 'ThreeDFile', to: 'EmbeddingChunk' },
    { from: 'DocumentFile', to: 'EmbeddingChunk' },
    { from: 'DataFile', to: 'EmbeddingChunk' },
    { from: 'MediaFile', to: 'EmbeddingChunk' },
    { from: 'WebDocument', to: 'EmbeddingChunk' },
  ],
};

// ============================================================
// KUZU SCHEMA GENERATION
// ============================================================

/**
 * FTS (Full-Text Search) index configuration per node type.
 * Maps node label to array of STRING properties to index.
 * Based on KuzuSearchProvider searchFields.
 */
export const FTS_INDEX_CONFIG: Record<string, string[]> = {
  Scope: ['name', 'signature', 'docstring', 'source'],
  File: ['name', 'path', 'source'],
  MarkdownSection: ['title', 'heading', 'content', 'ownContent'],
  WebPage: ['title', 'textContent', 'description'],
  CodeBlock: ['code', 'language'],
  DataFile: ['name', 'preview', 'structure'],
  DocumentFile: ['name', 'title', 'extractedText', 'content'],
  MediaFile: ['name', 'description', 'textContent'],
};

/**
 * Vector index configuration per node type.
 * Maps node label to embedding property names to index.
 * Note: Kuzu vector extension only supports FLOAT[] (32-bit).
 * Our schema uses DOUBLE[] so vector indexes won't work until migration.
 */
export const VECTOR_INDEX_CONFIG: Record<string, string[]> = {
  // Now enabled - schema generates FLOAT[] for Kuzu (see convertTypeForKuzu)
  Scope: ['embedding_content', 'embedding_name', 'embedding_description'],
  File: ['embedding_content'],
  MarkdownSection: ['embedding_content'],
  WebPage: ['embedding_content'],
  EmbeddingChunk: ['embedding_content'],
};

/**
 * Generate Kuzu CREATE NODE TABLE statement
 */
/**
 * Convert property type for Kuzu.
 * Kuzu's vector indexes require FLOAT[] instead of DOUBLE[].
 * This saves memory and is standard for ML embeddings (float32).
 */
function convertTypeForKuzu(type: PropType): string {
  // Convert DOUBLE[] to FLOAT[] for Kuzu vector index compatibility
  if (type === 'DOUBLE[]') {
    return 'FLOAT[]';
  }
  return type;
}

export function generateKuzuNodeTable(name: string, schema: NodeTypeSchema): string {
  const allProps = { ...schema.required, ...schema.optional };
  const props = Object.entries(allProps)
    .map(([propName, propDef]) => `${propName} ${convertTypeForKuzu(propDef.type)}`)
    .join(', ');

  const pk = schema.primaryKey || 'uuid';
  return `CREATE NODE TABLE IF NOT EXISTS ${name}(${props}, PRIMARY KEY(${pk}))`;
}

/**
 * Generate Kuzu CREATE REL TABLE statement
 */
export function generateKuzuRelTable(name: string, schema: RelSchema): string {
  const propsStr = schema.properties
    ? ', ' + Object.entries(schema.properties)
        .map(([propName, propDef]) => `${propName} ${convertTypeForKuzu(propDef.type)}`)
        .join(', ')
    : '';

  return `CREATE REL TABLE IF NOT EXISTS ${name}(FROM ${schema.from} TO ${schema.to}${propsStr})`;
}

/**
 * Generate all Kuzu schema statements
 *
 * Note: For relationship types with multiple FROM/TO combinations,
 * we use Kuzu's REL TABLE GROUP syntax.
 */
export function generateKuzuSchema(): string[] {
  const statements: string[] = [];

  // Node tables
  for (const [name, schema] of Object.entries(NODE_SCHEMAS)) {
    statements.push(generateKuzuNodeTable(name, schema));
  }

  // Relationship tables - use GROUP for multi-source/target relationships
  for (const [relType, schemas] of Object.entries(REL_SCHEMAS)) {
    if (schemas.length === 1) {
      // Single FROM/TO - use simple REL TABLE
      statements.push(generateKuzuRelTable(relType, schemas[0]));
    } else {
      // Multiple FROM/TO combinations - use REL TABLE GROUP
      const propsStr = schemas[0].properties
        ? ', ' + Object.entries(schemas[0].properties)
            .map(([propName, propDef]) => `${propName} ${convertTypeForKuzu(propDef.type)}`)
            .join(', ')
        : '';

      const connections = schemas
        .map(s => `FROM ${s.from} TO ${s.to}`)
        .join(', ');

      statements.push(`CREATE REL TABLE GROUP IF NOT EXISTS ${relType}(${connections}${propsStr})`);
    }
  }

  return statements;
}

/**
 * Generate FTS index creation statements for Kuzu.
 * These should be run AFTER schema creation and data ingestion.
 *
 * Note: FTS indexes are immutable in Kuzu - they must be dropped and
 * recreated after data changes.
 *
 * @returns Array of CALL CREATE_FTS_INDEX statements
 */
export function generateKuzuFtsIndexes(): string[] {
  const statements: string[] = [];

  for (const [label, properties] of Object.entries(FTS_INDEX_CONFIG)) {
    // Filter to only include properties that exist in the schema
    const schema = NODE_SCHEMAS[label];
    if (!schema) continue;

    const allProps = { ...schema.required, ...schema.optional };
    const validProps = properties.filter(p => p in allProps);

    if (validProps.length === 0) continue;

    const indexName = `${label.toLowerCase()}_fts`;
    const propsArray = validProps.map(p => `'${p}'`).join(', ');

    // CALL CREATE_FTS_INDEX('TableName', 'index_name', ['prop1', 'prop2'])
    statements.push(
      `CALL CREATE_FTS_INDEX('${label}', '${indexName}', [${propsArray}])`
    );
  }

  return statements;
}

/**
 * Generate FTS index drop statements for Kuzu.
 * Use before recreating indexes after data changes.
 *
 * @returns Array of CALL DROP_FTS_INDEX statements
 */
export function generateKuzuFtsDropIndexes(): string[] {
  const statements: string[] = [];

  for (const label of Object.keys(FTS_INDEX_CONFIG)) {
    const indexName = `${label.toLowerCase()}_fts`;
    statements.push(`CALL DROP_FTS_INDEX('${label}', '${indexName}')`);
  }

  return statements;
}

/**
 * Generate Vector index creation statements for Kuzu.
 * Currently disabled because Kuzu only supports FLOAT[] and we use DOUBLE[].
 *
 * @returns Array of CALL CREATE_VECTOR_INDEX statements
 */
export function generateKuzuVectorIndexes(): string[] {
  const statements: string[] = [];

  for (const [label, properties] of Object.entries(VECTOR_INDEX_CONFIG)) {
    for (const prop of properties) {
      const indexName = `${label.toLowerCase()}_${prop}_vec`;
      // CALL CREATE_VECTOR_INDEX('TableName', 'index_name', 'column_name', metric := 'cosine')
      statements.push(
        `CALL CREATE_VECTOR_INDEX('${label}', '${indexName}', '${prop}', metric := 'cosine')`
      );
    }
  }

  return statements;
}

/**
 * Get the required properties for a node type.
 * Returns undefined if the type is not defined (fallback to dynamic computation).
 */
export function getRequiredProperties(nodeType: string): string[] | undefined {
  const schema = NODE_SCHEMAS[nodeType];
  if (!schema) return undefined;
  return Object.keys(schema.required);
}

/**
 * Get all stateful node labels
 */
export function getStatefulLabels(): string[] {
  return Object.entries(NODE_SCHEMAS)
    .filter(([_, schema]) => schema.stateful)
    .map(([name]) => name);
}

/**
 * Get all labels with embeddings
 */
export function getEmbeddingLabels(): string[] {
  return Object.entries(NODE_SCHEMAS)
    .filter(([_, schema]) => schema.hasEmbedding)
    .map(([name]) => name);
}

/**
 * Check if a label is stateful
 */
export function isStatefulLabelFromSchema(label: string): boolean {
  return NODE_SCHEMAS[label]?.stateful ?? false;
}

/**
 * Get schema for a node type
 */
export function getNodeSchema(label: string): NodeTypeSchema | undefined {
  return NODE_SCHEMAS[label];
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

// ============================================================
// FIELD MAPPING - Unified Access to Node Content
// ============================================================
// Mirrors the textExtractor logic from embedding-service.ts MULTI_EMBED_CONFIGS
// Returns null for fields that are duplicates or not applicable
// (avoids redundancy in brain_search output formatting)

/**
 * Field extractor function that takes a node and returns the field value.
 * Returns null if the field is not applicable or would duplicate another field.
 */
export type FieldExtractor = (node: Record<string, any>) => string | null;

/**
 * Configuration for extracting semantic fields from a node type.
 * Mirrors the 3-embedding pattern from embedding-service.ts:
 * - title: corresponds to embedding_name (signature, title, path)
 * - content: corresponds to embedding_content (source, textContent)
 * - description: corresponds to embedding_description (docstring, metaDescription)
 *
 * Returns null if the field would be a duplicate or doesn't exist for this type.
 */
export interface NodeFieldMapping {
  /** Extract the title/name/signature - what the node IS */
  title: FieldExtractor;
  /** Extract the main content - the actual code/text (null if same as title) */
  content: FieldExtractor;
  /** Extract the description/documentation (null if same as title/content) */
  description: FieldExtractor;
  /** Extract the location (file path, URL, etc.) */
  location: FieldExtractor;
}

/**
 * Field mappings for each node type.
 * Logic mirrors MULTI_EMBED_CONFIGS textExtractors from embedding-service.ts
 * Returns null for fields that don't exist or would duplicate another field.
 */
export const FIELD_MAPPING: Record<string, NodeFieldMapping> = {
  // === CODE ===
  Scope: {
    title: (n) => n.signature || n.name || null,
    content: (n) => n.source || null,
    description: (n) => n.docstring || null,
    location: (n) => n.file || null,
  },

  File: {
    title: (n) => n.name || n.path || null,
    content: (n) => n.source || null,
    description: (n) => null, // Would duplicate title
    location: (n) => n.path || null,
  },

  CodeBlock: {
    title: (n) => n.language ? `${n.language} code block` : 'code block',
    content: (n) => n.code || null,
    description: (n) => null, // Language already in title
    location: (n) => n.file || null,
  },

  // === MARKDOWN ===
  MarkdownDocument: {
    title: (n) => n.title || n.file || null,
    content: (n) => null, // No distinct content for document node
    description: (n) => n.frontMatter || null,
    location: (n) => n.file || null,
  },

  MarkdownSection: {
    title: (n) => n.title || null,
    content: (n) => n.ownContent || n.content || null,
    description: (n) => null, // rawText would duplicate content
    location: (n) => n.file || null,
  },

  // === WEB ===
  WebPage: {
    title: (n) => n.title || null,
    content: (n) => n.textContent || null,
    description: (n) => n.metaDescription || n.description || null,
    location: (n) => n.url || null,
  },

  // === MEDIA ===
  MediaFile: {
    title: (n) => n.file || null,
    content: (n) => n.textContent || n.ocrText || null,
    description: (n) => n.description || null, // AI visual description
    location: (n) => n.path || null,
  },

  ImageFile: {
    title: (n) => n.file || null,
    content: (n) => n.textContent || n.ocrText || null,
    description: (n) => n.description || null,
    location: (n) => n.path || null,
  },

  ThreeDFile: {
    title: (n) => n.file || null,
    content: (n) => null, // No distinct content, only description
    description: (n) => n.description || null,
    location: (n) => n.path || null,
  },

  // === DOCUMENTS ===
  DocumentFile: {
    title: (n) => n.title || n.file || null,
    content: (n) => n.textContent || n.extractedText || null,
    description: (n) => null, // Title already used
    location: (n) => n.path || null,
  },

  PDFDocument: {
    title: (n) => n.title || n.file || null,
    content: (n) => n.textContent || n.extractedText || null,
    description: (n) => null,
    location: (n) => n.path || null,
  },

  WordDocument: {
    title: (n) => n.title || n.file || null,
    content: (n) => n.textContent || n.extractedText || null,
    description: (n) => null,
    location: (n) => n.path || null,
  },

  SpreadsheetDocument: {
    title: (n) => n.file || null,
    content: (n) => n.extractedText || null,
    description: (n) => n.sheetNames || null,
    location: (n) => n.path || null,
  },

  // === DATA ===
  DataFile: {
    title: (n) => n.file || n.path || null,
    content: (n) => n.rawContent || n.preview || null,
    description: (n) => n.structure || null,
    location: (n) => n.path || n.file || null,
  },

  // === STRUCTURE ===
  Project: {
    title: (n) => n.name || null,
    content: (n) => null, // No content
    description: (n) => n.gitRemote || null,
    location: (n) => n.rootPath || null,
  },

  Directory: {
    title: (n) => n.path || null,
    content: (n) => null,
    description: (n) => null,
    location: (n) => n.path || null,
  },

  ExternalLibrary: {
    title: (n) => n.name || null,
    content: (n) => null,
    description: (n) => null,
    location: (n) => null, // External, no path
  },

  PackageJson: {
    title: (n) => n.name || null,
    content: (n) => null,
    description: (n) => n.description || null,
    location: (n) => n.file || null,
  },
};

/**
 * Get the title/signature of a node according to its type.
 * Returns null if not available.
 */
export function getNodeTitle(node: Record<string, any>, nodeType: string): string | null {
  const mapping = FIELD_MAPPING[nodeType];
  if (mapping) {
    return mapping.title(node);
  }
  // Fallback: try common fields
  return node.signature || node.title || node.name || node.file || null;
}

/**
 * Get the main content of a node according to its type.
 * Returns null if not available or would duplicate title.
 */
export function getNodeContent(node: Record<string, any>, nodeType: string): string | null {
  const mapping = FIELD_MAPPING[nodeType];
  if (mapping) {
    return mapping.content(node);
  }
  // Fallback: try common fields
  return node.source || node.content || node.textContent || node.code || null;
}

/**
 * Get the description/documentation of a node according to its type.
 * Returns null if not available or would duplicate other fields.
 */
export function getNodeDescription(node: Record<string, any>, nodeType: string): string | null {
  const mapping = FIELD_MAPPING[nodeType];
  if (mapping) {
    return mapping.description(node);
  }
  // Fallback: try common fields
  return node.docstring || node.description || node.metaDescription || null;
}

/**
 * Get the location (file path, URL) of a node according to its type.
 */
export function getNodeLocation(node: Record<string, any>, nodeType: string): string | null {
  const mapping = FIELD_MAPPING[nodeType];
  if (mapping) {
    return mapping.location(node);
  }
  // Fallback: try common fields
  return node.file || node.path || node.url || null;
}

/**
 * Get line range for a node if available
 */
export function getNodeLineRange(node: Record<string, any>): { start: number; end: number } | null {
  if (node.startLine != null && node.endLine != null) {
    return { start: node.startLine, end: node.endLine };
  }
  return null;
}

/**
 * Format a node location with optional line range for display.
 * @example "src/utils/node-schema.ts:45-67"
 */
export function formatNodeLocation(node: Record<string, any>, nodeType: string): string {
  const location = getNodeLocation(node, nodeType) || 'unknown';
  const lines = getNodeLineRange(node);
  if (lines) {
    return `${location}:${lines.start}-${lines.end}`;
  }
  return location;
}

/**
 * Format a node for display in search results.
 * @example "async function getUser(id: string): Promise<User> (Scope) @ src/users.ts:45-67"
 */
export function formatNodeResult(node: Record<string, any>, nodeType: string): string {
  const title = getNodeTitle(node, nodeType) || 'Untitled';
  const location = formatNodeLocation(node, nodeType);
  return `${title} (${nodeType}) @ ${location}`;
}

// ============================================================
// EMBEDDING EXTRACTORS - Text extraction for embeddings
// ============================================================
// Uses FIELD_MAPPING as source of truth but may combine fields
// for better embedding search quality.
// Corresponds to MULTI_EMBED_CONFIGS in embedding-service.ts

/**
 * Embedding extractor functions for a node type.
 * Maps to the 3 embedding types:
 * - name → embedding_name (for "find X")
 * - content → embedding_content (for "code that does X")
 * - description → embedding_description (for "documented as X")
 */
export interface EmbeddingExtractors {
  name: (node: Record<string, any>) => string;
  content: (node: Record<string, any>) => string;
  description: (node: Record<string, any>) => string;
}

/**
 * Special cases where embedding_name needs more context than display title.
 * For file-like nodes, we use full path for better search.
 * For web pages, we include URL.
 */
const EMBEDDING_NAME_OVERRIDES: Record<string, (n: Record<string, any>) => string> = {
  // Files: use full path for search (display uses just filename)
  File: (n) => n.path || '',
  DataFile: (n) => n.path || '',
  MediaFile: (n) => n.path || '',
  ImageFile: (n) => n.path || '',
  ThreeDFile: (n) => n.path || '',
  // Web pages: include URL for better search
  WebPage: (n) => `${n.title || ''} ${n.url || ''}`.trim(),
};

/**
 * Get embedding text extractors for a node type.
 * Uses FIELD_MAPPING as the source of truth but handles special cases
 * where embeddings need more context than display.
 *
 * @param label - The node label (Scope, File, MediaFile, etc.)
 * @returns Extractors for name, content, and description embeddings
 */
export function getEmbeddingExtractors(label: string): EmbeddingExtractors {
  const mapping = FIELD_MAPPING[label];

  if (!mapping) {
    // Fallback for unknown types
    return {
      name: (n) => n.signature || n.title || n.name || n.path || '',
      content: (n) => n.source || n.content || n.textContent || '',
      description: (n) => n.docstring || n.description || '',
    };
  }

  // Use override for name if exists, otherwise use FIELD_MAPPING.title
  const nameExtractor = EMBEDDING_NAME_OVERRIDES[label]
    || ((n: Record<string, any>) => mapping.title(n) || '');

  return {
    name: nameExtractor,
    content: (n) => mapping.content(n) || '',
    description: (n) => mapping.description(n) || '',
  };
}

/**
 * Convert a Neo4j record to a plain object for use with extractors.
 * Neo4j records use record.get('field') while extractors expect node.field
 */
export function recordToNode(record: any): Record<string, any> {
  const node: Record<string, any> = {};
  // Neo4j records have a keys property with all field names
  if (record.keys) {
    for (const key of record.keys) {
      node[key] = record.get(key);
    }
  }
  return node;
}

/**
 * Create embedding text extractors that work with Neo4j records.
 * Wrapper around getEmbeddingExtractors for use in embedding-service.ts
 *
 * @param label - The node label
 * @returns Extractors that take Neo4j records and return text
 */
export function getRecordEmbeddingExtractors(label: string): {
  name: (record: any) => string;
  content: (record: any) => string;
  description: (record: any) => string;
} {
  const extractors = getEmbeddingExtractors(label);

  return {
    name: (r) => extractors.name(recordToNode(r)),
    content: (r) => extractors.content(recordToNode(r)),
    description: (r) => extractors.description(recordToNode(r)),
  };
}
