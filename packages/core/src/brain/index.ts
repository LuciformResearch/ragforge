/**
 * Brain Module
 *
 * Central knowledge management for the agent.
 */

export {
  BrainManager,
  DEFAULT_PERSONAS,
  type BrainConfig,
  type PersonaDefinition,
  type TerminalColor,
  type RegisteredProject,
  type ProjectsRegistry,
  type QuickIngestOptions,
  type QuickIngestResult,
  type BrainSearchOptions,
  type BrainSearchResult,
  type UnifiedSearchResult,
  type GCStats,
} from './brain-manager.js';

export {
  EmbeddingService,
  hashContent,
  DEFAULT_EMBED_CONFIGS,
  MULTI_EMBED_CONFIGS,
  type EmbeddingType,
  type EmbeddingFieldConfig,
  type MultiEmbedNodeTypeConfig,
  type EmbedNodeTypeConfig,
  type EmbeddingResult,
  type GenerateEmbeddingsOptions,
  type GenerateMultiEmbeddingsOptions,
  type MultiEmbeddingResult,
} from './embedding-service.js';

export {
  ThreeDService,
  type ThreeDServiceConfig,
  type RenderAndAnalyzeOptions,
  type RenderAndAnalyzeResult,
} from './threed-service.js';
