/**
 * @luciformresearch/ragforge - Unified RagForge library
 *
 * Provides schema introspection, config loading, code generation,
 * LLM execution, agents, and RAG runtime.
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
export { generateToolsFromConfig, type ExtendedToolGenerationOptions } from './tools/tool-generator.js';
export type {
  ToolGenerationOptions,
  GeneratedTools,
  GeneratedToolDefinition,
  ToolHandlerGenerator,
  ToolGenerationContext,
  ToolGenerationContextGetter,
  EntityMetadata,
  FieldMetadata,
  VectorIndexMetadata,
  RelationshipMetadata,
  ToolGenerationMetadata,
} from './tools/types/index.js';
export { EMPTY_CONTEXT } from './tools/types/index.js';

// Discovery Tools (schema for agents)
export { generateDiscoveryTools } from './tools/discovery-tools.js';
export type {
  SchemaInfo,
  EntitySchemaInfo,
  FieldInfo,
  RelationshipInfo,
  SemanticIndexInfo,
} from './tools/discovery-tools.js';

// File Tools (read, write, edit with change tracking)
export {
  generateFileTools,
  generateReadFileTool,
  generateWriteFileTool,
  generateEditFileTool,
  generateReadFileHandler,
  generateWriteFileHandler,
  generateEditFileHandler,
} from './tools/file-tools.js';
export type { FileToolsContext, FileToolsResult } from './tools/file-tools.js';

// Image Tools (OCR, describe, list, generate images, multiview)
export {
  generateImageTools,
  generateReadImageTool,
  generateDescribeImageTool,
  generateListImagesTool,
  generateGenerateImageTool,
  generateGenerateMultiviewImagesTool,
  generateReadImageHandler,
  generateDescribeImageHandler,
  generateListImagesHandler,
  generateGenerateImageHandler,
  generateGenerateMultiviewImagesHandler,
} from './tools/image-tools.js';
export type { ImageToolsContext, ImageToolsResult } from './tools/image-tools.js';

// 3D Tools (render, generate from image/text)
export {
  generate3DTools,
  generateRender3DAssetTool,
  generateGenerate3DFromImageTool,
  generateGenerate3DFromTextTool,
  generateRender3DAssetHandler,
  generateGenerate3DFromImageHandler,
  generateGenerate3DFromTextHandler,
} from './tools/threed-tools.js';
export type { ThreeDToolsContext, ThreeDToolsResult } from './tools/threed-tools.js';

// Project Tools (create, setup, ingest, embeddings)
export {
  generateProjectTools,
  generateCreateProjectTool,
  generateSetupProjectTool,
  generateIngestCodeTool,
  generateEmbeddingsTool,
  generateLoadProjectTool,
  generateCreateProjectHandler,
  generateSetupProjectHandler,
  generateIngestCodeHandler,
  generateEmbeddingsHandler,
  generateLoadProjectHandler,
} from './tools/project-tools.js';
export type {
  ProjectToolsContext,
  ProjectToolsResult,
  CreateProjectParams,
  SetupProjectParams,
  IngestCodeParams,
  GenerateEmbeddingsParams,
  LoadProjectParams,
  ProjectToolResult,
} from './tools/project-tools.js';

// Web Tools (search web, fetch web pages)
export {
  webToolDefinitions,
  searchWebToolDefinition,
  fetchWebPageToolDefinition,
  createWebToolHandlers,
  createSearchWebHandler,
  createFetchWebPageHandler,
} from './tools/web-tools.js';
export type {
  WebToolsContext,
  WebSearchParams,
  WebSearchResult,
  FetchWebPageParams,
  FetchWebPageResult,
} from './tools/web-tools.js';

// Ingestion Lock (coordinate file tools with RAG queries)
export {
  IngestionLock,
  getGlobalIngestionLock,
  withIngestionLock,
} from './tools/ingestion-lock.js';
export type { IngestionStatus, IngestionLockOptions } from './tools/ingestion-lock.js';

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

// LLM Abstractions - DEPRECATED: moved to runtime/llm, interfaces no longer needed
// export * from './llm/index.js';

// Database
export * from './database/index.js';

// Document Ingestion (temporarily disabled - llamaindex removed)
// export * from './ingestion';

// ============================================
// Runtime (merged from @luciformresearch/ragforge-runtime)
// ============================================
export * from './runtime/index.js';

// ============================================
// Utilities
// ============================================
export * from './utils/index.js';

// Timestamp utilities (local timezone formatting)
export {
  getLocalTimestamp,
  getFilenameTimestamp,
  formatLocalDate,
} from './runtime/utils/timestamp.js';

// Version
export const VERSION = '0.2.0';
