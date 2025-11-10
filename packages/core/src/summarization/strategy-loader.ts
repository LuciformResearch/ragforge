/**
 * Strategy Loader
 *
 * Loads and merges summarization strategies from config with defaults.
 */

import type { SummarizationStrategyConfig } from '../types/config.js';
import type { SummaryStrategy } from '@luciformresearch/ragforge-runtime';
import { getDefaultStrategies } from '@luciformresearch/ragforge-runtime';

/**
 * Convert config strategy to runtime strategy format
 */
export function convertConfigStrategyToRuntime(
  id: string,
  config: SummarizationStrategyConfig
): SummaryStrategy {
  return {
    id,
    name: config.name || id,
    description: config.description || '',
    recommendedThreshold: 500, // Default threshold
    promptConfig: {
      systemContext: config.system_prompt,
      userTask: 'Analyze the following content:\n\n{{field_value}}',
      outputFormat: {
        rootElement: config.output_schema.root,
        fields: config.output_schema.fields.map(field => ({
          name: field.name,
          type: field.type,
          description: field.description,
          required: field.required,
          nested: field.nested as any
        }))
      },
      instructions: config.instructions
    }
  };
}

/**
 * Load all strategies (defaults + custom from config)
 *
 * Custom strategies override defaults with same ID.
 */
export function loadStrategies(
  customStrategies?: Record<string, SummarizationStrategyConfig>
): Map<string, SummaryStrategy> {
  // Start with defaults
  const strategies = getDefaultStrategies();

  // Add/override with custom strategies from config
  if (customStrategies) {
    for (const [id, config] of Object.entries(customStrategies)) {
      const runtimeStrategy = convertConfigStrategyToRuntime(id, config);
      strategies.set(id, runtimeStrategy);
    }
  }

  return strategies;
}

/**
 * Validate that all referenced strategies exist
 */
export function validateStrategyReferences(
  strategies: Map<string, SummaryStrategy>,
  referencedStrategies: Set<string>
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const strategyId of referencedStrategies) {
    if (!strategies.has(strategyId)) {
      missing.push(strategyId);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Extract all strategy IDs referenced in entity configs
 */
export function extractReferencedStrategies(
  entities: any[]
): Set<string> {
  const referenced = new Set<string>();

  for (const entity of entities) {
    if (entity.searchable_fields) {
      for (const field of entity.searchable_fields) {
        if (field.summarization?.enabled) {
          referenced.add(field.summarization.strategy);
        }
      }
    }
  }

  return referenced;
}
