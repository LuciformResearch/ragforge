/**
 * Generate Field Summaries
 *
 * Generates LLM-powered summaries for configured fields.
 * Summaries are cached in Neo4j for fast reranking.
 *
 * Usage:
 *   npm run generate-summaries                        # Generate all
 *   npm run generate-summaries -- --entity=Scope      # Specific entity
 *   npm run generate-summaries -- --field=source      # Specific field
 *   npm run generate-summaries -- --force             # Regenerate all
 *   npm run generate-summaries -- --dry-run           # Preview without generating
 *   npm run generate-summaries -- --save-prompts      # Save prompts to logs/prompts/ for debugging
 *   npm run generate-summaries -- --dry-run --save-prompts  # Preview + save (no API calls)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { neo4j } from '@luciformresearch/ragforge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { config } from '../load-config.js';
import { Neo4jClient } from '@luciformresearch/ragforge';
import {
  GenericSummarizer,
  SummaryStorage,
  getDefaultStrategies
} from '@luciformresearch/ragforge';
import { GeminiAPIProvider } from '@luciformresearch/ragforge';

// Parse CLI args
const args = process.argv.slice(2);
const flags = {
  entity: args.find(a => a.startsWith('--entity='))?.split('=')[1],
  field: args.find(a => a.startsWith('--field='))?.split('=')[1],
  force: args.includes('--force'),
  dryRun: args.includes('--dry-run'),
  savePrompts: args.includes('--save-prompts'),
  limit: parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || undefined
};

async function generateSummaries() {
  console.log('📝 Field Summarization Generator');
  console.log('═'.repeat(60));
  console.log('');

  if (flags.dryRun) {
    console.log('🔍 DRY RUN MODE - No summaries will be generated\n');
  }

  if (flags.force) {
    console.log('⚠️  FORCE MODE - Regenerating all summaries\n');
  }

  if (flags.savePrompts) {
    console.log('💾 SAVE PROMPTS MODE - Prompts will be saved to logs/prompts/\n');
    const logsDir = path.resolve(__dirname, '../logs/prompts');
    await fs.mkdir(logsDir, { recursive: true });
  }

  if (flags.limit) {
    console.log(`🔢 LIMIT MODE - Processing only ${flags.limit} items for testing\n`);
  }

  // Initialize Neo4j client
  const neo4jClient = new Neo4jClient(config.neo4j);

  try {
    await neo4jClient.verifyConnectivity();
    console.log('✅ Connected to Neo4j\n');
  } catch (error) {
    console.error('❌ Failed to connect to Neo4j:', error);
    process.exit(1);
  }

  // Initialize LLM provider for summarization
  if (!config.summarization_llm) {
    console.error('❌ No summarization_llm configured in ragforge.config.yaml');
    console.error('   Add summarization_llm section with provider and model');
    await neo4jClient.close();
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY || config.summarization_llm.api_key;
  if (!apiKey) {
    console.error('❌ No GEMINI_API_KEY found in environment or config');
    console.error('   Set GEMINI_API_KEY in your .env file');
    await neo4jClient.close();
    process.exit(1);
  }

  const llmProvider = new GeminiAPIProvider({
    model: config.summarization_llm.model,
    apiKey,
    temperature: config.summarization_llm.temperature || 0.3,
    maxTokens: config.summarization_llm.max_tokens || 1000
  });

  // Load strategies (default + custom from config)
  const strategies = getDefaultStrategies();
  if (config.summarization_strategies) {
    for (const [id, strategyConfig] of Object.entries(config.summarization_strategies)) {
      // Convert config strategy to runtime format
      strategies.set(id, {
        id,
        name: strategyConfig.name || id,
        description: strategyConfig.description || '',
        recommendedThreshold: 500,
        promptConfig: {
          systemContext: strategyConfig.system_prompt,
          userTask: 'Analyze the following content:\n\n{{field_value}}',
          outputFormat: strategyConfig.output_schema,
          instructions: strategyConfig.instructions
        }
      });
    }
  }

  // Initialize summarizer
  const summarizer = new GenericSummarizer(llmProvider, strategies);

  let totalGenerated = 0;
  let totalCached = 0;
  let totalErrors = 0;
  let totalToProcess = 0;

  // Count total items to process
  console.log('🔍 Scanning entities...\n');
  for (const entityConfig of config.entities) {
    if (flags.entity && entityConfig.name !== flags.entity) continue;

    const fieldsWithSummarization = entityConfig.searchable_fields?.filter(
      f => f.summarization?.enabled
    ) || [];

    for (const field of fieldsWithSummarization) {
      if (flags.field && field.name !== flags.field) continue;

      const sumConfig = field.summarization!;
      const storage = new SummaryStorage(neo4jClient, {
        entityLabel: entityConfig.name,
        uniqueField: entityConfig.unique_field || 'uuid'
      });

      const stats = await storage.getStatistics(field.name);
      const toProcess = flags.force ? stats.total : stats.pending;
      totalToProcess += Number(toProcess);
    }
  }

  // Show overall estimate and ask for confirmation
  if (totalToProcess > 0 && !flags.dryRun) {
    console.log('📊 Overall Estimate:');
    console.log(`   Items to process: ${totalToProcess}`);
    console.log(`   Estimated time: ~${Math.ceil(totalToProcess / 10)} seconds (at ~10 items/sec with packing)`);
    console.log(`   Model: ${config.summarization_llm.model}`);
    console.log('');
    console.log('⚠️  This will consume LLM API credits.');
    console.log('   Run with --dry-run first to preview what will be processed.\n');

    // Simple confirmation (could be enhanced with readline for proper Y/N)
    console.log('Press Ctrl+C to cancel, or the script will continue in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('');
  }

  // Process each entity
  for (const entityConfig of config.entities) {
    // Filter by entity flag if provided
    if (flags.entity && entityConfig.name !== flags.entity) {
      continue;
    }

    const fieldsWithSummarization = entityConfig.searchable_fields?.filter(
      f => f.summarization?.enabled
    ) || [];

    if (fieldsWithSummarization.length === 0) {
      continue;
    }

    console.log(`📦 Entity: ${entityConfig.name}`);
    console.log('─'.repeat(60));

    const storage = new SummaryStorage(neo4jClient, {
      entityLabel: entityConfig.name,
      uniqueField: entityConfig.unique_field || 'uuid'
    });

    for (const field of fieldsWithSummarization) {
      // Filter by field flag if provided
      if (flags.field && field.name !== flags.field) {
        continue;
      }

      const sumConfig = field.summarization!;

      console.log(`\n  Field: ${field.name}`);
      console.log(`    Strategy: ${sumConfig.strategy}`);
      console.log(`    Threshold: ${sumConfig.threshold} chars`);

      // Get statistics
      const stats = await storage.getStatistics(field.name);
      console.log(`    Status: ${stats.summarized}/${stats.total} summarized (${stats.percentage.toFixed(1)}%)`);

      if (stats.pending === 0 && !flags.force) {
        console.log(`    ✅ All up to date, skipping`);
        continue;
      }

      // Find entities needing summaries
      const batchSize = 100;
      let offset = 0;
      let hasMore = true;
      let processedCount = 0;

      while (hasMore) {
        // Check limit
        if (flags.limit && processedCount >= flags.limit) {
          console.log(`    ⚠️  Reached limit of ${flags.limit} items, stopping`);
          break;
        }

        // Calculate effective batch size respecting limit
        const effectiveBatchSize = flags.limit
          ? Math.min(batchSize, flags.limit - processedCount)
          : batchSize;

        // Query entities - use batch_order_query if available, otherwise default query
        let query;

        if (sumConfig.batch_order_query) {
          // Use custom batch order query
          let baseQuery = sumConfig.batch_order_query.trim();

          // In non-force mode, add summary_hash IS NULL condition
          // We inject it before the first WITH, ORDER BY, or RETURN clause
          if (!flags.force) {
            const insertPoint = baseQuery.search(/\b(WITH|ORDER BY|RETURN)\b/i);
            if (insertPoint > 0) {
              const beforeInsert = baseQuery.substring(0, insertPoint).trim();
              const afterInsert = baseQuery.substring(insertPoint);

              // Add AND condition to existing WHERE, or create new WHERE
              if (beforeInsert.includes('WHERE')) {
                query = `${beforeInsert}\n  AND n.${field.name}_summary_hash IS NULL\n${afterInsert}`;
              } else {
                query = `${beforeInsert}\nWHERE n.${field.name}_summary_hash IS NULL\n${afterInsert}`;
              }
            } else {
              // Fallback: append WHERE clause
              query = `${baseQuery}\nWHERE n.${field.name}_summary_hash IS NULL`;
            }
          } else {
            query = baseQuery;
          }

          // Add pagination
          query += `\nSKIP $offset\nLIMIT $batchSize`;

          // Debug: log the generated query
          if (offset === 0 && flags.dryRun) {
            console.log(`\n    [DEBUG] Generated Cypher query:\n${query}\n`);
          }
        } else {
          // Default query
          query = flags.force
            ? `
              MATCH (n:${entityConfig.name})
              WHERE n.${field.name} IS NOT NULL
                AND size(n.${field.name}) > $threshold
              RETURN n.${entityConfig.unique_field || 'uuid'} AS uuid,
                     n.${field.name} AS fieldValue
              SKIP $offset
              LIMIT $batchSize
            `
            : `
              MATCH (n:${entityConfig.name})
              WHERE n.${field.name} IS NOT NULL
                AND size(n.${field.name}) > $threshold
                AND n.${field.name}_summary_hash IS NULL
              RETURN n.${entityConfig.unique_field || 'uuid'} AS uuid,
                     n.${field.name} AS fieldValue
              SKIP $offset
              LIMIT $batchSize
            `;
        }

        const result = await neo4jClient.run(query, {
          threshold: neo4j.int(sumConfig.threshold),
          offset: neo4j.int(offset),
          batchSize: neo4j.int(effectiveBatchSize)
        });

        if (result.records.length === 0) {
          hasMore = false;
          break;
        }

        let entities = result.records.map(r => ({
          uuid: r.get('uuid'),
          fieldValue: r.get('fieldValue')
        }));

        // Truncate to respect limit
        if (flags.limit && processedCount + entities.length > flags.limit) {
          const remaining = flags.limit - processedCount;
          entities = entities.slice(0, remaining);
          hasMore = false; // This will be our last batch
        }

        console.log(`\n    Batch: ${offset + 1}-${offset + entities.length} (${entities.length} items)`);

        // Prepare batch input (needed for both dry-run and actual generation)
        let batchInput = entities.map(entity => ({
          entityType: entityConfig.name,
          fieldName: field.name,
          fieldValue: entity.fieldValue,
          entity: entity,
          config: sumConfig
        }));

        // Enrich with graph context if context_query is configured
        if (sumConfig.context_query) {
          batchInput = await Promise.all(
            batchInput.map(async (item) => {
              try {
                const contextResult = await neo4jClient.run(
                  sumConfig.context_query,
                  { uuid: item.entity.uuid }
                );

                const graphContext = contextResult.records[0]?.toObject() || {};

                return {
                  ...item,
                  graphContext
                };
              } catch (error) {
                console.warn(`      ⚠️  Failed to fetch context for ${item.entity.uuid}: ${error}`);
                return item;
              }
            })
          );
        }

        // Save prompts for debugging if requested (works in dry-run too!)
        if (flags.savePrompts) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const batchNum = Math.floor(offset / batchSize);
          const promptFile = path.resolve(__dirname, `../logs/prompts/${entityConfig.name}_${field.name}_batch${batchNum}_${timestamp}.txt`);

          // Build the REAL prompt that would be sent to LLM
          const prompts = summarizer.buildPrompts(batchInput);
          const fullPrompt = prompts.join('\n\n===== PROMPT SEPARATOR =====\n\n');

          // Save the actual prompt
          await fs.writeFile(promptFile, fullPrompt);
          console.log(`      💾 Saved ${prompts.length} prompt(s) to ${path.basename(promptFile)}`);

          // Also save metadata JSON for reference
          const metadataFile = path.resolve(__dirname, `../logs/prompts/${entityConfig.name}_${field.name}_batch${batchNum}_${timestamp}.meta.json`);
          const debugData = {
            metadata: {
              entity: entityConfig.name,
              field: field.name,
              batch: batchNum,
              offset,
              count: entities.length,
              strategy: sumConfig.strategy,
              timestamp,
              dryRun: flags.dryRun,
              promptCount: prompts.length
            },
            items: batchInput.map(item => ({
              uuid: item.entity.uuid,
              fieldValuePreview: item.fieldValue.substring(0, 200) + (item.fieldValue.length > 200 ? '...' : ''),
              fieldValueLength: item.fieldValue.length
            }))
          };

          await fs.writeFile(metadataFile, JSON.stringify(debugData, null, 2));
        }

        if (flags.dryRun) {
          console.log(`      [DRY RUN] Would generate ${entities.length} summaries`);
          totalGenerated += entities.length;
        } else {
          try {
            // Estimate cost
            const estimate = summarizer.estimateTokens(batchInput);
            console.log(`      Estimated: ~${estimate.totalPromptTokens} prompt tokens, ~${estimate.totalResponseTokens} response tokens`);
            console.log(`      Estimated cost: $${estimate.estimatedCost.toFixed(4)}`);

            // Generate summaries
            console.log(`      Generating summaries...`);
            const summaries = await summarizer.summarizeBatch(batchInput);

            // Save outputs for debugging if requested
            if (flags.savePrompts) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const batchNum = Math.floor(offset / batchSize);
              const outputFile = path.resolve(__dirname, `../logs/prompts/${entityConfig.name}_${field.name}_batch${batchNum}_${timestamp}_output.json`);

              await fs.writeFile(outputFile, JSON.stringify({
                metadata: {
                  entity: entityConfig.name,
                  field: field.name,
                  batch: batchNum,
                  count: entities.length
                },
                summaries: summaries.map((summary, i) => ({
                  uuid: entities[i].uuid,
                  summary
                }))
              }, null, 2));

              console.log(`      💾 Saved summaries output to ${path.basename(outputFile)}`);
            }

            // Store in Neo4j
            console.log(`      Storing in Neo4j...`);
            await storage.storeBatch(
              entities.map((entity, i) => ({
                entityId: entity.uuid,
                fieldName: field.name,
                fieldValue: entity.fieldValue,
                summary: summaries[i]
              }))
            );

            totalGenerated += entities.length;
            console.log(`      ✅ Generated and stored ${entities.length} summaries`);
          } catch (error) {
            console.error(`      ❌ Error generating summaries:`, error);
            totalErrors += entities.length;
          }
        }

        offset += entities.length;
        processedCount += entities.length;

        // Check if there are more
        if (result.records.length < batchSize) {
          hasMore = false;
        }
      }
    }

    console.log('');
  }

  // Final summary
  console.log('═'.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Generated: ${totalGenerated}`);
  console.log(`   Cached: ${totalCached}`);
  console.log(`   Errors: ${totalErrors}`);
  console.log('');

  if (flags.dryRun) {
    console.log('✅ Dry run complete (no summaries were generated)');
  } else if (totalErrors > 0) {
    console.log(`⚠️  Completed with ${totalErrors} error(s)`);
  } else {
    console.log('✅ All summaries generated successfully!');
  }

  await neo4jClient.close();
}

generateSummaries().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
