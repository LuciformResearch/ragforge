export interface GeneratedEmbeddingPipelineConfig {
  name: string;
  source: string;
  targetProperty: string;
  model?: string;
  dimension?: number;
  similarity?: 'cosine' | 'dot' | 'euclidean';
  preprocessors?: string[];
  includeFields?: string[];
  includeRelationships?: GeneratedEmbeddingRelationshipConfig[];
  batchSize?: number;
  concurrency?: number;
  throttleMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface GeneratedEmbeddingRelationshipConfig {
  type: string;
  direction: 'outgoing' | 'incoming' | 'both';
  fields?: string[];
  depth?: number;
  maxItems?: number;
}

export interface GeneratedEmbeddingEntityConfig {
  entity: string;
  pipelines: GeneratedEmbeddingPipelineConfig[];
}

export interface GeneratedEmbeddingsConfig {
  provider: 'gemini';
  defaults?: {
    model?: string;
    dimension?: number;
    similarity?: 'cosine' | 'dot' | 'euclidean';
  };
  entities: GeneratedEmbeddingEntityConfig[];
}

export interface EmbeddingRecord {
  id: string;
  content: string;
}
