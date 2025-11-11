/**
 * Entity Contexts - Generated from RagForge config
 * 
 * These EntityContext objects define how entities are presented to LLM rerankers.
 * They are automatically generated from your ragforge.config.yaml.
 * 
 * DO NOT EDIT - regenerate with: ragforge generate
 */

import type { EntityContext } from '@luciformresearch/ragforge-runtime';

/**
 * EntityContext for Scope entities
 */
export const SCOPE_CONTEXT: EntityContext = {
    type: 'Scope',
    displayName: 'code scopes',
    uniqueField: 'uuid',
    
    
    fields: [
      { name: 'name', required: true, label: 'Name', maxLength: 120 },
      { name: 'source', label: 'Source', preferSummary: true },
      { name: 'file', label: 'File', maxLength: 120 },
      { name: 'signature', label: 'Signature', maxLength: 120 },
      { name: 'type', label: 'Type', maxLength: 120 }
    ],
    enrichments: [
      
    ]
  };

/**
 * Map of entity type to EntityContext
 */
export const ENTITY_CONTEXTS: Record<string, EntityContext> = {
  'Scope': SCOPE_CONTEXT,
};

/**
 * Get EntityContext for a given entity type
 * @throws Error if entity type is not found
 */
export function getEntityContext(entityType: string): EntityContext {
  const context = ENTITY_CONTEXTS[entityType];
  if (!context) {
    throw new Error(`No EntityContext found for entity type: ${entityType}. Available types: ${Object.keys(ENTITY_CONTEXTS).join(', ')}`);
  }
  return context;
}