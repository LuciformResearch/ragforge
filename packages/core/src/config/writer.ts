/**
 * Configuration Writer
 *
 * Writes RagForge configuration to YAML files with educational comments.
 * This is used by quickstart to expand minimal configs with full defaults.
 *
 * Key feature: Annotates auto-added fields from defaults with comments like:
 * "Auto-added from TypeScript defaults"
 */

import { promises as fs } from 'fs';
import YAML from 'yaml';
import type { RagForgeConfig } from '../types/config.js';

export interface WriteOptions {
  addComments?: boolean;
  preserveUserComments?: boolean;
  indentSize?: number;
  createBackup?: boolean;
}

/**
 * Check if a value exists in the original user config
 */
function existsInOriginal(originalConfig: any, path: string[]): boolean {
  let current = originalConfig;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return false;
    }
    current = current[key];
  }
  return current !== undefined;
}

/**
 * Add comments to distinguish user-provided vs auto-added fields
 */
function annotateAutoAddedFields(
  doc: YAML.Document,
  originalConfig: Partial<RagForgeConfig>,
  mergedConfig: RagForgeConfig
): void {
  const contents = doc.contents as any;
  if (!contents || !contents.items) return;

  // Helper to get adapter name for comments
  const adapterName = mergedConfig.source?.adapter || 'defaults';
  const adapterLabel = adapterName.charAt(0).toUpperCase() + adapterName.slice(1);

  // Annotate top-level fields
  contents.items.forEach((pair: any) => {
    const key = pair.key?.value;
    if (!key) return;

    // Check if this field was auto-added
    const wasAutoAdded = !existsInOriginal(originalConfig, [key]);

    // Special handling for specific fields
    switch (key) {
      case 'source':
        annotateSourceConfig(pair.value, originalConfig.source || {}, adapterLabel);
        break;

      case 'entities':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ` Entity definitions (auto-detected from ${adapterLabel} codebase)`;
        }
        annotateEntities(pair.value, originalConfig.entities || [], adapterLabel);
        break;

      case 'watch':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ` Watch mode configuration (auto-added from ${adapterLabel} defaults)`;
        }
        break;

      case 'summarization_llm':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ` LLM for code summarization (auto-added from ${adapterLabel} defaults)`;
        }
        break;

      case 'embeddings':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ` Vector embeddings for semantic search (auto-added from ${adapterLabel} defaults)`;
        }
        break;

      case 'neo4j':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ' Neo4j database connection settings';
        }
        break;
    }
  });
}

/**
 * Annotate source configuration
 */
function annotateSourceConfig(
  sourceNode: any,
  originalSource: any,
  adapterLabel: string
): void {
  if (!sourceNode || !sourceNode.items) return;

  sourceNode.items.forEach((pair: any) => {
    const key = pair.key?.value;
    if (!key) return;

    const wasAutoAdded = !existsInOriginal(originalSource, [key]);

    switch (key) {
      case 'exclude':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ` Auto-added from ${adapterLabel} defaults`;
        }
        // Add inline comments for each exclude pattern
        if (pair.value?.items) {
          const excludeComments: Record<string, string> = {
            '**/node_modules/**': 'Node.js dependencies',
            '**/dist/**': 'Build output',
            '**/build/**': 'Alternative build output',
            '**/.next/**': 'Next.js build cache',
            '**/coverage/**': 'Test coverage reports',
            '**/*.test.ts': 'Test files',
            '**/*.spec.ts': 'Spec files',
            '**/*.d.ts': 'Type definition files',
            '**/.git/**': 'Git directory'
          };

          pair.value.items.forEach((item: any) => {
            const value = item.value;
            if (typeof value === 'string' && excludeComments[value] && !item.commentBefore) {
              item.commentBefore = ' ' + excludeComments[value];
            }
          });
        }
        break;

      case 'track_changes':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ` Auto-added: enables incremental updates with change detection`;
        }
        break;

      case 'root':
        if (wasAutoAdded && pair.value?.commentBefore === undefined) {
          pair.value.commentBefore = ' Root directory for code analysis';
        }
        break;
    }
  });
}

/**
 * Annotate entities configuration
 */
function annotateEntities(
  entitiesNode: any,
  originalEntities: any[],
  adapterLabel: string
): void {
  if (!entitiesNode || !entitiesNode.items) return;

  entitiesNode.items.forEach((entityNode: any, index: number) => {
    const entityName = entityNode.get('name');
    const wasAutoAdded = !originalEntities[index];

    if (entityName === 'Scope' && wasAutoAdded) {
      if (entityNode.commentBefore === undefined) {
        entityNode.commentBefore = ` Scope entity - represents functions, classes, methods, etc. (auto-added)`;
      }

      // Annotate entity fields
      if (entityNode.items) {
        entityNode.items.forEach((pair: any) => {
          const key = pair.key?.value;
          if (!key) return;

          switch (key) {
            case 'unique_field':
              if (!pair.value.commentBefore) {
                pair.value.commentBefore = ' Unique identifier for each scope';
              }
              break;

            case 'vector_indexes':
              if (!pair.value.commentBefore) {
                pair.value.commentBefore = ' Vector indexes for semantic search (auto-added)';
              }
              break;

            case 'searchable_fields':
              if (!pair.value.commentBefore) {
                pair.value.commentBefore = ' Fields that can be searched and filtered (auto-added)';
              }
              annotateSearchableFields(pair.value);
              break;

            case 'relationships':
              if (!pair.value.commentBefore) {
                pair.value.commentBefore = ' Graph relationships to other entities (auto-added)';
              }
              break;
          }
        });
      }
    }
  });
}

/**
 * Annotate searchable_fields
 */
function annotateSearchableFields(fieldsNode: any): void {
  if (!fieldsNode || !fieldsNode.items) return;

  fieldsNode.items.forEach((fieldNode: any) => {
    const fieldName = fieldNode.get('name');

    if (fieldName === 'source' && fieldNode.items) {
      fieldNode.items.forEach((pair: any) => {
        const key = pair.key?.value;

        if (key === 'summarization' && pair.value?.items) {
          // Annotate summarization config
          pair.value.items.forEach((sumPair: any) => {
            const sumKey = sumPair.key?.value;

            if (sumKey === 'output_fields' && sumPair.value?.items) {
              const fieldComments: Record<string, string> = {
                'purpose': 'What this code does',
                'operation': 'How it works',
                'dependency': 'What it depends on',
                'concept': 'Key concepts used',
                'complexity': 'Complexity assessment',
                'suggestion': 'Improvement suggestions'
              };

              sumPair.value.items.forEach((item: any) => {
                const value = item.value;
                if (typeof value === 'string' && fieldComments[value] && !item.commentBefore) {
                  item.commentBefore = ' ' + fieldComments[value];
                }
              });
            }
          });
        }
      });
    }
  });
}

/**
 * Write expanded configuration to YAML file with educational comments
 */
export async function writeConfigWithDefaults(
  configPath: string,
  originalConfig: Partial<RagForgeConfig>,
  mergedConfig: RagForgeConfig,
  options: WriteOptions = {}
): Promise<void> {
  const {
    addComments = true,
    createBackup = true,
    indentSize = 2
  } = options;

  // Create backup if file exists
  if (createBackup) {
    try {
      await fs.access(configPath);
      const backupPath = `${configPath}.backup`;
      await fs.copyFile(configPath, backupPath);
      console.log(`📋 Backup saved to: ${backupPath}`);
    } catch {
      // File doesn't exist, no backup needed
    }
  }

  // Create YAML document with formatting options
  const doc = new YAML.Document(mergedConfig as any, {
    indent: indentSize,
    lineWidth: 0 // Don't wrap long lines
  } as any);

  // Add annotations for auto-added fields
  if (addComments) {
    annotateAutoAddedFields(doc, originalConfig, mergedConfig);
  }

  // Add header comment
  const adapterName = mergedConfig.source?.adapter || 'your project';
  const header = `# RagForge Configuration
# This file has been expanded with default settings for ${adapterName}
#
# Fields marked as "auto-added" come from adapter defaults and can be customized.
# Your original values are preserved and will not be overwritten.
#
# See https://docs.ragforge.dev for more information.

`;

  const yamlContent = header + doc.toString();

  // Write to file
  await fs.writeFile(configPath, yamlContent, 'utf-8');
}

/**
 * Write minimal configuration (user-facing, no defaults)
 */
export async function writeMinimalConfig(
  configPath: string,
  config: Partial<RagForgeConfig>
): Promise<void> {
  const yamlContent = YAML.stringify(config, {
    indent: 2,
    lineWidth: 0
  });

  await fs.writeFile(configPath, yamlContent, 'utf-8');
}
