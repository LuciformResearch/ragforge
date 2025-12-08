/**
 * Schema Version Management
 *
 * Automatically computes schema hashes from actual node properties.
 * When a node type's properties change (added/removed),
 * the hash changes and existing nodes are detected as outdated.
 */

import { createHash } from 'crypto';
import { CONTENT_NODE_LABELS } from './node-schema.js';

/**
 * Metadata fields to exclude from schema hash computation.
 * These are fields that change at each ingestion or are not part of the "shape" of the node.
 */
const METADATA_FIELDS = new Set([
  'indexedAt',
  'projectId',
  'uuid',
  'embeddingsDirty',
  'embedding',
  'embedding_hash',
  'embedding_name',
  'embedding_name_hash',
  'embedding_description',
  'embedding_description_hash',
  'embedding_content',
  'embedding_content_hash',
  'schemaVersion', // Don't include schemaVersion in its own computation
]);

/**
 * Compute a schema hash from actual node properties.
 * The hash is based on property NAMES only (not values), excluding metadata fields.
 *
 * @param nodeType - The node type/label (e.g., 'MarkdownSection')
 * @param properties - The actual properties being set on the node
 * @returns A 12-character hash representing the schema
 */
export function computeSchemaHash(nodeType: string, properties: Record<string, unknown>): string {
  // Get property names, excluding metadata
  const schemaKeys = Object.keys(properties)
    .filter(k => !METADATA_FIELDS.has(k))
    .sort();

  // Include node type in hash so different types with same props have different hashes
  const schemaString = `${nodeType}:${schemaKeys.join(',')}`;

  return createHash('sha256').update(schemaString).digest('hex').slice(0, 12);
}

/**
 * Check if a node should have schema versioning based on its labels
 */
export function shouldHaveSchemaVersion(labels: string[]): boolean {
  return labels.some(label => CONTENT_NODE_LABELS.has(label));
}

/**
 * Add schemaVersion to node properties if it's a content node
 *
 * @param labels - Node labels
 * @param properties - Node properties (will be mutated to add schemaVersion)
 * @returns The properties with schemaVersion added (if applicable)
 */
export function addSchemaVersion(
  labels: string[],
  properties: Record<string, unknown>
): Record<string, unknown> {
  if (shouldHaveSchemaVersion(labels)) {
    // Use the first content label for the hash
    const contentLabel = labels.find(l => CONTENT_NODE_LABELS.has(l)) || labels[0];
    properties.schemaVersion = computeSchemaHash(contentLabel, properties);
  }
  return properties;
}
