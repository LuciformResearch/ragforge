/**
 * @luciformresearch/ragforge - Unified RagForge library
 *
 * Provides schema introspection, config loading, code generation,
 * LLM execution, agents, and RAG runtime.
 * 
 * Trigger embedding regeneration - 2025-12-10
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
export type { ToolSection, ToolPropertySchema } from './tools/types/index.js';

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

// 3D Tools (render, generate from image/text, analyze)
export {
  generate3DTools,
  generateRender3DAssetTool,
  generateGenerate3DFromImageTool,
  generateGenerate3DFromTextTool,
  generateAnalyze3DModelTool,
  generateRender3DAssetHandler,
  generateGenerate3DFromImageHandler,
  generateGenerate3DFromTextHandler,
  generateAnalyze3DModelHandler,
} from './tools/threed-tools.js';
export type { ThreeDToolsContext, ThreeDToolsResult, ThreeDAnalyzeContext } from './tools/threed-tools.js';

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
  getGlobalEmbeddingLock,
} from './tools/ingestion-lock.js';
export type { IngestionStatus, IngestionLockOptions } from './tools/ingestion-lock.js';

// Brain Tools (persistent knowledge base)
export {
  generateBrainTools,
  generateBrainToolHandlers,
  generateIngestDirectoryTool,
  generateIngestDirectoryHandler,
  generateBrainSearchTool,
  generateBrainSearchHandler,
  generateForgetPathTool,
  generateForgetPathHandler,
  generateListBrainProjectsTool,
  generateListBrainProjectsHandler,
  // Setup tools (for MCP users)
  generateSetupTools,
  generateSetupToolHandlers,
  generateSetApiKeyTool,
  generateSetApiKeyHandler,
  generateGetBrainStatusTool,
  generateGetBrainStatusHandler,
  generateCleanupBrainTool,
  generateCleanupBrainHandler,
} from './tools/brain-tools.js';
export type { BrainToolsContext } from './tools/brain-tools.js';

// Agent Tools (call agent, extract prompts, call steps)
export {
  generateAgentTools,
  generateAgentToolHandlers,
} from './tools/agent-tools.js';
export type { AgentToolsContext } from './tools/agent-tools.js';

// Debug Tools (inspect/test conversation memory)
export {
  generateAllDebugTools,
  generateAllDebugHandlers,
  generateDebugContextTool,
  generateDebugContextHandler,
  generateDebugConversationSearchTool,
  generateDebugConversationSearchHandler,
  generateDebugInjectTurnTool,
  generateDebugInjectTurnHandler,
  generateDebugListSummariesTool,
  generateDebugListSummariesHandler,
  generateDebugMessageTool,
  generateDebugMessageHandler,
} from './tools/debug-tools.js';
export type { DebugToolsContext } from './tools/debug-tools.js';

// Database Tools (query external databases)
export {
  generateDatabaseTools,
  generateDatabaseToolHandlers,
  generateQueryDatabaseTool,
  generateQueryDatabaseHandler,
  generateDescribeTableTool,
  generateDescribeTableHandler,
  generateListTablesTool,
  generateListTablesHandler,
  createDatabaseToolsContext,
  addDatabaseConnection,
  executeQuery,
} from './tools/database-tools.js';
export type {
  DatabaseConnection,
  DatabaseToolsContext,
  QueryResult,
} from './tools/database-tools.js';

// FS Helpers (file system operations)
export * from './tools/fs-helpers.js';

// FS Tools (file system agent tools)
export {
  generateFsTools,
  generateListDirectoryTool,
  generateListDirectoryHandler,
  generateGlobFilesTool,
  generateGlobFilesHandler,
  generateFileExistsTool,
  generateFileExistsHandler,
  generateGetFileInfoTool,
  generateGetFileInfoHandler,
  generateDeletePathTool,
  generateDeletePathHandler,
  generateMoveFileTool,
  generateMoveFileHandler,
  generateCopyFileTool,
  generateCopyFileHandler,
  generateCreateDirectoryTool,
  generateCreateDirectoryHandler,
} from './tools/fs-tools.js';
export type { FsToolsContext, FsToolsResult } from './tools/fs-tools.js';

// Shell Helpers (command execution with validation)
export * from './tools/shell-helpers.js';

// Shell Tools (shell command agent tools)
export {
  generateShellTools,
  generateRunCommandTool,
  generateRunCommandHandler,
  generateRunNpmScriptTool,
  generateRunNpmScriptHandler,
  generateGitStatusTool,
  generateGitStatusHandler,
  generateGitDiffTool,
  generateGitDiffHandler,
  generateListSafeCommandsTool,
  generateListSafeCommandsHandler,
} from './tools/shell-tools.js';
export type { ShellToolsContext, ShellToolsResult } from './tools/shell-tools.js';

// Context Tools (environment and project info)
export {
  generateContextTools,
  generateGetWorkingDirectoryTool,
  generateGetWorkingDirectoryHandler,
  generateGetEnvironmentInfoTool,
  generateGetEnvironmentInfoHandler,
  generateGetProjectInfoTool,
  generateGetProjectInfoHandler,
} from './tools/context-tools.js';
export type { ContextToolsContext, ContextToolsResult } from './tools/context-tools.js';

// Tool Sections (tool grouping and sub-agent management)
export {
  SECTION_INFO,
  ALWAYS_AVAILABLE_SECTIONS,
  MAX_SUBAGENT_DEPTH,
  aggregateToolsBySection,
  getToolsForSections,
  getSectionSummary,
  validateSections,
  canSpawnSubAgent,
  createChildContext,
  createRootContext,
  validateToolSection,
  validateAllToolSections,
} from './tools/tool-sections.js';
export type {
  SectionInfo,
  SubAgentContext,
} from './tools/tool-sections.js';

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
// Brain (persistent knowledge management)
// ============================================
export * from './brain/index.js';

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
// test 1765365652
