/**
 * Entity Context Types
 *
 * Configuration for making LLM reranker generic across any domain.
 */

/**
 * Entity field configuration for LLM prompt rendering
 */
export interface EntityField {
  /**
   * Field name in entity object (e.g., "name", "description", "price")
   */
  name: string;

  /**
   * Display label in LLM prompt
   * Default: field name
   */
  label?: string;

  /**
   * Maximum length for field value (truncate if longer)
   */
  maxLength?: number;

  /**
   * Always show this field (included in entity header)
   */
  required?: boolean;
}

/**
 * Enrichment field configuration for LLM prompt rendering
 */
export interface EnrichmentField {
  /**
   * Field name in entity (from enrich_field in config)
   * e.g., "consumes", "frequentlyBoughtWith", "following"
   */
  fieldName: string;

  /**
   * Display label in LLM prompt
   * e.g., "Uses:", "Often bought with:", "Follows:"
   */
  label: string;

  /**
   * Maximum number of items to show (for array fields)
   * Default: 10
   */
  maxItems?: number;
}

/**
 * Entity context configuration for LLM reranker
 *
 * This makes the LLM reranker generic and adaptable to any domain:
 * - Code analysis: Scope entities with CONSUMES relationships
 * - E-commerce: Product entities with PURCHASED_WITH relationships
 * - Social: User entities with FOLLOWS relationships
 * - Knowledge bases: Document entities with LINKS_TO relationships
 */
export interface EntityContext {
  /**
   * Entity type name (e.g., "Product", "User", "Scope")
   */
  type: string;

  /**
   * Display name for LLM prompts (e.g., "products", "users", "code scopes")
   */
  displayName: string;

  /**
   * Fields to show in LLM prompt
   */
  fields: EntityField[];

  /**
   * Enrichment fields to show (from relationship enrichments)
   */
  enrichments: EnrichmentField[];
}

/**
 * Default EntityContext for Scope entities (code analysis)
 * Used for backward compatibility when no context is provided.
 */
export const DEFAULT_SCOPE_CONTEXT: EntityContext = {
  type: 'Scope',
  displayName: 'code scopes',
  fields: [
    { name: 'name', required: true },
    { name: 'type', required: true },
    { name: 'file', required: true },
    { name: 'signature', maxLength: 200 },
    { name: 'source', label: 'Code', maxLength: 300 }
  ],
  enrichments: [
    { fieldName: 'consumes', label: 'Uses', maxItems: 10 }
  ]
};
