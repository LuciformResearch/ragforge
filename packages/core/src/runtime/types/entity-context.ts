/**
 * Entity Context Types
 *
 * Configuration for making LLM reranker generic across any domain.
 */

// Import unified ComputedFieldConfig from core
import type { ComputedFieldConfig } from '../../types/config.js';
export type { ComputedFieldConfig };

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
   * Maximum number of array items to show (for list-valued fields)
   */
  maxItems?: number;

  /**
   * Always show this field (included in entity header)
   */
  required?: boolean;

  /**
   * Prefer using summary field if available (e.g., use "source_summary" instead of "source")
   * When true, the reranker will look for a field named "{name}_summary" and use it if present.
   * Falls back to the original field if summary doesn't exist.
   * This is useful for large fields that have been summarized for better LLM context.
   */
  preferSummary?: boolean;
}

// ComputedFieldConfig imported from core (unified)

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
   * Unique field name used to identify entities (e.g., "id", "uuid", "scopeId")
   * This field should contain a stable unique identifier for each entity.
   * Fallback: if not specified or if entity doesn't have this field, numeric index is used.
   */
  uniqueField?: string;

  /**
   * Query field name used for semantic queries (e.g., "name", "title", "description")
   * This indicates the primary field to search against.
   */
  queryField?: string;

  /**
   * Example display fields to show in results
   * These are the most important fields to display when showing entity information.
   */
  exampleDisplayFields?: string[];

  /**
   * Fields to show in LLM prompt
   */
  fields: EntityField[];

  /**
   * Enrichment fields to show (from relationship enrichments)
   */
  enrichments: EnrichmentField[];

  /**
   * Computed fields configuration (Phase 3)
   * Used for ORDER BY support on computed fields
   */
  computedFields?: ComputedFieldConfig[];
}
