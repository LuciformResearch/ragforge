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
 * Get additional indexes needed for a node type
 *
 * @param label - The node label
 * @returns Array of field names to index
 */
export function getAdditionalIndexes(label: string): string[] {
  return TYPE_INDEXES[label] || [];
}
