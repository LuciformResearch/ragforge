import type {
  EmbeddingsConfig as CoreEmbeddingsConfig,
  EmbeddingEntityConfig as CoreEmbeddingEntityConfig,
  EmbeddingPipelineConfig as CoreEmbeddingPipelineConfig
} from '@luciformresearch/ragforge-core';
import type {
  GeneratedEmbeddingsConfig,
  GeneratedEmbeddingEntityConfig,
  GeneratedEmbeddingPipelineConfig
} from '@luciformresearch/ragforge-runtime';

export function toRuntimeEmbeddingsConfig(config?: CoreEmbeddingsConfig): GeneratedEmbeddingsConfig | undefined {
  if (!config) {
    return undefined;
  }

  const entities: GeneratedEmbeddingEntityConfig[] = config.entities.map((entity: CoreEmbeddingEntityConfig) => ({
    entity: entity.entity,
    pipelines: entity.pipelines.map((pipeline: CoreEmbeddingPipelineConfig) => ({
      name: pipeline.name,
      source: pipeline.source,
      targetProperty: pipeline.target_property,
      model: pipeline.model,
      dimension: pipeline.dimension,
      similarity: pipeline.similarity,
      preprocessors: pipeline.preprocessors,
      includeFields: pipeline.include_fields,
      includeRelationships: pipeline.include_relationships?.map(rel => ({
        type: rel.type,
        direction: rel.direction,
        fields: rel.fields,
        depth: rel.depth
      }))
    })) as GeneratedEmbeddingPipelineConfig[]
  }));

  return {
    provider: config.provider,
    defaults: config.defaults ? { ...config.defaults } : undefined,
    entities
  };
}
