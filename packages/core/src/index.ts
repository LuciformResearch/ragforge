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

// Generators
export { TypeGenerator } from './generator/type-generator.js';
export { ConfigGenerator, type DomainPattern } from './generator/config-generator.js';
export { CodeGenerator, type GeneratedCode } from './generator/code-generator.js';

// Version
export const VERSION = '0.0.1';
