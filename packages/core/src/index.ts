/**
 * @luciformresearch/ragforge-core - Core library for RagForge
 *
 * Provides schema introspection, config loading, and code generation
 */

// Types
export * from './types/config.js';
export * from './types/schema.js';

// Schema introspection
export { SchemaIntrospector } from './schema/introspector.js';

// Configuration
export { ConfigLoader } from './config/loader.js';
export { mergeWithDefaults } from './config/merger.js';
export { writeConfigWithDefaults, writeMinimalConfig, type WriteOptions } from './config/writer.js';

// Generators
export { TypeGenerator } from './generator/type-generator.js';
export { ConfigGenerator, type DomainPattern } from './generator/config-generator.js';
export { CodeGenerator, type GeneratedCode } from './generator/code-generator.js';

// Tool Generation (Phase 1)
export { generateToolsFromConfig } from './tools/tool-generator.js';
export type {
  ToolGenerationOptions,
  GeneratedTools,
  GeneratedToolDefinition,
  ToolHandlerGenerator,
  ToolGenerationContext,
  EntityMetadata,
  FieldMetadata,
  VectorIndexMetadata,
  RelationshipMetadata,
  ToolGenerationMetadata,
} from './tools/types/index.js';

// Discovery Tools (schema for agents)
export { generateDiscoveryTools } from './tools/discovery-tools.js';
export type {
  SchemaInfo,
  EntitySchemaInfo,
  FieldInfo,
  RelationshipInfo,
  SemanticIndexInfo,
} from './tools/discovery-tools.js';

// Computed Fields (Phase 3)
export {
  evaluateComputedField,
  evaluateExpression,
  evaluateComputedFields,
  generateCypherFragment,
  validateComputedField
} from './computed/field-evaluator.js';
export type {
  EvaluationContext,
  EvaluationResult
}
from './computed/field-evaluator.js';

// LLM Abstractions
export * from './llm/index.js';

// Database
export * from './database/index.js';

// Document Ingestion (temporarily disabled - llamaindex removed)
// export * from './ingestion';

// Version
export const VERSION = '0.0.1';
