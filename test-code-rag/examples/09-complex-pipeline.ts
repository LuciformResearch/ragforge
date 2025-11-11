import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Complex multi-stage pipeline
 * @description Combine semantic search, filters, LLM reranking, and relationship expansion
 * @intent Build sophisticated queries with multiple operations
 * @tags pipeline, advanced, complex
 */
async function complexMultiStagePipeline() {
  const rag = createRagClient(); // Uses .env variables automatically

  // Multi-stage pipeline:
  // 1. Semantic search (broad)
  // 2. Filter (focus)
  // 3. LLM rerank (quality)
  // 4. Expand relationships (complete context)
  // 5. Track metadata (observe)
  const { results, metadata } = await rag.scope()
    .semanticSearchBySource('public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers...', { topK: 100 })
    .whereFileName('config.ts')
    .llmRerank('find the most relevant code scopes', { topK: 20 })
    .withDefinedIn(1)
    .executeWithMetadata();

  console.log(`\n🎯 Pipeline Results`);
  console.log(`Total time: ${metadata.totalDuration}ms`);
  console.log(`Final results: ${results.length}`);

  console.log(`\n📊 Pipeline stages:`);
  metadata.operations.forEach((op, idx) => {
    console.log(`  [${idx + 1}] ${op.type}: ${op.inputCount} → ${op.outputCount} (${op.duration}ms)`);
  });

  console.log(`\n🔝 Top results:`);
  results.slice(0, 5).forEach((r, idx) => {
    console.log(`  [${idx + 1}] ${r.entity.name} (score: ${r.score.toFixed(3)})`);
    if (r.scoreBreakdown?.llmReasoning) {
      console.log(`      → ${r.scoreBreakdown.llmReasoning}`);
    }
  });

  await rag.close();
  return { results, metadata };
}

export { complexMultiStagePipeline };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    complexMultiStagePipeline()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
