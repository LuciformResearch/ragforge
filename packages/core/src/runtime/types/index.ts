/**
 * Runtime Type Exports
 *
 * Unified types (imported from core):
 * - Neo4jConfig, RelationshipConfig, ComputedFieldConfig
 *
 * Runtime-specific types (different from core):
 * - RuntimeConfig, EmbeddingsConfig, RerankingConfig
 */

export * from './query.js';
export * from './result.js';

// Entity context types
export {
  EntityField,
  EnrichmentField,
  EntityContext,
  ComputedFieldConfig,  // Unified from core
} from './entity-context.js';

// Config types
export {
  RuntimeConfig,
  Neo4jConfig,           // Unified from core
  RelationshipConfig,    // Unified from core
  RerankingStrategyConfig,
} from './config.js';

// Runtime-specific config types (different from core versions)
export {
  EmbeddingsConfig as RuntimeEmbeddingsConfig,
  RerankingConfig as RuntimeRerankingConfig,
} from './config.js';

// Backward compat aliases
export type { Neo4jConfig as RuntimeNeo4jConfig } from './config.js';
export type { RelationshipConfig as RuntimeRelationshipConfig } from './config.js';
export type { ComputedFieldConfig as RuntimeComputedFieldConfig } from './entity-context.js';
