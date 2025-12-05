/**
 * Source Adapters for RagForge
 *
 * Adapters for parsing various sources into Neo4j graph structures
 */

// Re-export types with alias for SourceConfig to avoid conflict with core
export {
  SourceConfig as AdapterSourceConfig,
  ParsedNode,
  ParsedRelationship,
  ParsedGraph,
  UpdateStats,
  ParseResult,
  ParseOptions,
  ParseProgress,
  SourceAdapter,
  ValidationResult,
} from './types.js';
export * from './code-source-adapter.js';
// Deprecated: LlamaIndex-based adapter replaced by TikaSourceAdapter
// export * from './document-source-adapter.js';
// Note: document/ module exports TikaSourceAdapter, TikaParser, Chunker
// TikaParser requires Java installed locally
export * from './document/index.js';
export * from './incremental-ingestion.js';
export * from './ingestion-queue.js';
export * from './file-watcher.js';
export * from './change-tracker.js';
