import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example LLM reranking for better relevance
 * @description Semantic search followed by LLM reranking
 * @intent Find most relevant code scopes using AI reasoning
 * @tags llm, reranking, advanced
 */
async function llmRerankingForBetterRelevance() {
  const rag = createRagClient(); // Uses .env variables automatically

  console.log('🔎 Semantic search: "public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers..."');
  console.log('🤖 Then reranking with LLM: "find the most relevant code scopes around this semantic search: public static GenerateUUID(): string..."');

  // NOTE: llmRerank() can be used after ANY operation that returns results.
  // In this example, we use it after .semanticSearchBySource(), but you can also use it after:
  //   - Filters: .whereFileName(), .whereName(), .whereFile()
  //   - Relationships: .withDefinedIn(), .withConsumes()
  //   - Or even directly without prior operations
  const results = await rag.scope()
    .semanticSearchBySource('public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers...', { topK: 50 })
    .llmRerank('find the most relevant code scopes around this semantic search: public static GenerateUUID(): string...', {
      topK: 10,
      minScore: 0.7
    })
    .execute();

  console.log(`\nFound ${results.length} results after LLM reranking:`);
  results.forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name + ': ' + r.score.toFixed(3));
  const highlights = [entity.name ? 'name: ' + entity.name : null]
    .filter(Boolean)
    .join(' | ');
  console.log(`    Why: matches "public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers..." → ${highlights || 'high semantic similarity'}`);
    if (r.scoreBreakdown?.llmReasoning) {
      console.log(`    Why (LLM): ${r.scoreBreakdown.llmReasoning}`);
    }
    if (typeof r.scoreBreakdown?.llmScore === 'number') {
      console.log(`    LLM score contribution: ${r.scoreBreakdown.llmScore.toFixed(3)}`);
    }
  });

  await rag.close();
  return results;
}

export { llmRerankingForBetterRelevance };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    llmRerankingForBetterRelevance()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
