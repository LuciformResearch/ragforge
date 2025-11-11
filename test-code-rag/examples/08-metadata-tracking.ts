import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Pipeline metadata and observability
 * @description Track each operation in the query pipeline
 * @intent Debug and optimize query pipelines
 * @tags metadata, observability, debugging
 */
async function pipelineMetadataAndObservability() {
  const rag = createRagClient(); // Uses .env variables automatically

  const { results, metadata } = await rag.scope()
    .semanticSearchBySource('public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers...', { topK: 50 })
    .llmRerank('find code scopes related to: public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers...', { topK: 10 })
    .executeWithMetadata();

  console.log(`Pipeline executed in ${metadata.totalDuration}ms`);
  console.log(`Final result count: ${metadata.finalCount}`);

  metadata.operations.forEach((op, idx) => {
    console.log(`\n[${idx + 1}] ${op.type.toUpperCase()}`);
    console.log(`  Duration: ${op.duration}ms`);
    console.log(`  Results: ${op.inputCount} → ${op.outputCount}`);

    if (op.type === 'semantic' && op.metadata) {
      console.log(`  Index: ${op.metadata.vectorIndex}`);
      console.log(`  Model: ${op.metadata.model} (${op.metadata.dimension}D)`);
    }

    if (op.type === 'llmRerank' && op.metadata) {
      console.log(`  LLM: ${op.metadata.llmModel}`);
      console.log(`  Evaluations: ${op.metadata.evaluations?.length}`);
    }
  });

  await rag.close();
  return { results, metadata };
}

export { pipelineMetadataAndObservability };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    pipelineMetadataAndObservability()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
