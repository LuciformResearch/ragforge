/**
 * Configuration Loader
 *
 * Loads and validates RagForge configuration from YAML files
 */

import { promises as fs } from 'fs';
import YAML from 'yaml';
import { z } from 'zod';
import { RagForgeConfig } from '../types/config.js';

// Zod schema for validation
const FieldSummarizationConfigSchema = z.object({
  enabled: z.boolean(),
  strategy: z.string(),
  threshold: z.number(),
  cache: z.boolean().optional(),
  on_demand: z.boolean().optional(),
  prompt_template: z.string().optional(),
  output_fields: z.array(z.string()),
  rerank_use: z.enum(['always', 'prefer_summary', 'never']).optional(),
  // Graph context enrichment
  context_query: z.string().optional(),
  // Intelligent batching
  batch_order_query: z.string().optional()
});

const FieldConfigSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'datetime', 'enum', 'array<string>', 'array<number>']),
  indexed: z.boolean().optional(),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  summarization: FieldSummarizationConfigSchema.optional()
});

const VectorIndexConfigSchema = z.object({
  name: z.string(),
  field: z.string().optional(),
  source_field: z.string().optional(),
  dimension: z.number().optional(),
  similarity: z.enum(['cosine', 'euclidean', 'dot']).optional(),
  provider: z.enum(['openai', 'vertex', 'gemini', 'custom']).optional(),
  model: z.string().optional()
});

const RelationshipFilterSchema = z.object({
  name: z.string(),
  direction: z.enum(['outgoing', 'incoming']),
  description: z.string().optional(),
  parameter: z.string().optional()
});

const RelationshipConfigSchema = z.object({
  type: z.string(),
  direction: z.enum(['outgoing', 'incoming', 'both']),
  target: z.string(),
  description: z.string().optional(),
  properties: z.array(FieldConfigSchema).optional(),
  enrich: z.boolean().optional(),
  enrich_field: z.string().optional(),
  filters: z.array(RelationshipFilterSchema).optional()
});

const EntityConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  searchable_fields: z.array(FieldConfigSchema),
  vector_index: VectorIndexConfigSchema.optional(),
  vector_indexes: z.array(VectorIndexConfigSchema).optional(),
  relationships: z.array(RelationshipConfigSchema).optional(),
  // Entity field mappings (optional, with smart defaults)
  display_name_field: z.string().optional(),
  unique_field: z.string().optional(),
  query_field: z.string().optional(),
  example_display_fields: z.array(z.string()).optional()
});

const RerankingStrategySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['builtin', 'custom']),
  algorithm: z.string().optional(),
  scorer: z.string().optional()
});

const RerankingConfigSchema = z.object({
  strategies: z.array(RerankingStrategySchema)
});

const McpToolConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  expose: z.boolean()
});

const McpConfigSchema = z.object({
  server: z.object({
    name: z.string(),
    version: z.string()
  }).optional(),
  tools: z.array(McpToolConfigSchema).optional()
});

const Neo4jConfigSchema = z.object({
  uri: z.string(),
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional()
});

const GenerationConfigSchema = z.object({
  output_dir: z.string().optional(),
  language: z.enum(['typescript', 'javascript']).optional(),
  include_tests: z.boolean().optional(),
  include_docs: z.boolean().optional(),
  mcp_server: z.boolean().optional()
});

const SummarizationStrategyConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  system_prompt: z.string(),
  output_schema: z.object({
    root: z.string(),
    fields: z.array(
      z.object({
        name: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
        description: z.string(),
        required: z.boolean().optional(),
        nested: z.any().optional()
      })
    )
  }),
  instructions: z.string().optional()
});

const SummarizationLLMConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  api_key: z.string().optional()
});

const SourceConfigSchema = z.object({
  type: z.literal('code'),
  adapter: z.enum(['typescript', 'python']),
  root: z.string().optional(),
  include: z.array(z.string()).min(1, 'source.include must contain at least one pattern'),
  exclude: z.array(z.string()).optional(),
  options: z.record(z.any()).optional()
});

const RagForgeConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  neo4j: Neo4jConfigSchema,
  entities: z.array(EntityConfigSchema),
  reranking: RerankingConfigSchema.optional(),
  mcp: McpConfigSchema.optional(),
  generation: GenerationConfigSchema.optional(),
  summarization_strategies: z.record(SummarizationStrategyConfigSchema).optional(),
  summarization_llm: SummarizationLLMConfigSchema.optional(),
  source: SourceConfigSchema.optional(),
  embeddings: z
    .object({
      provider: z.literal('gemini'),
      defaults: z
        .object({
          model: z.string().optional(),
          dimension: z.number().optional(),
          similarity: z.enum(['cosine', 'dot', 'euclidean']).optional()
        })
        .optional(),
      entities: z.array(
        z.object({
          entity: z.string(),
          pipelines: z.array(
            z.object({
              name: z.string(),
              source: z.string(),
              target_property: z.string(),
              model: z.string().optional(),
              dimension: z.number().optional(),
              similarity: z.enum(['cosine', 'dot', 'euclidean']).optional(),
              preprocessors: z.array(z.string()).optional(),
              include_fields: z.array(z.string()).optional(),
              include_relationships: z
                .array(
                  z.object({
                    type: z.string(),
                    direction: z.enum(['outgoing', 'incoming', 'both']),
                    fields: z.array(z.string()).optional(),
                    depth: z.number().optional(),
                    max_items: z.number().optional()
                  })
                )
                .optional(),
              batch_size: z.number().optional(),
              concurrency: z.number().optional(),
              throttle_ms: z.number().optional(),
              max_retries: z.number().optional(),
              retry_delay_ms: z.number().optional()
            })
          )
        })
      )
    })
    .optional()
});

export class ConfigLoader {
  /**
   * Load and validate a RagForge configuration from a YAML file
   */
  static async load(filePath: string): Promise<RagForgeConfig> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = YAML.parse(content);

    // Validate with Zod
    const validated = RagForgeConfigSchema.parse(parsed);

    return validated as RagForgeConfig;
  }

  /**
   * Validate a configuration object
   */
  static validate(config: unknown): RagForgeConfig {
    return RagForgeConfigSchema.parse(config) as RagForgeConfig;
  }

  /**
   * Load configuration with environment variable substitution
   */
  static async loadWithEnv(filePath: string): Promise<RagForgeConfig> {
    let content = await fs.readFile(filePath, 'utf-8');

    // Replace ${ENV_VAR} with process.env.ENV_VAR
    content = content.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });

    const parsed = YAML.parse(content);
    return RagForgeConfigSchema.parse(parsed) as RagForgeConfig;
  }
}
