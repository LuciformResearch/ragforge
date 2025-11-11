import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Semantic search by source
 * @description Search code scopes using scopeSourceEmbeddings vector index
 * @intent Find code scopes by semantic similarity to source
 * @tags semantic, source
 */
async function semanticSearchBySource() {
  const rag = createRagClient(); // Uses .env variables automatically

  console.log('🔎 Semantic search for: "public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers..."');
  const results = await rag.scope()
    .semanticSearchBySource('public static GenerateUUID(): string { const lut = this.Lut; // Generate four random 32-bit numbers...', { topK: 50 })
    .execute();

  console.log(`\nFound ${results.length} results:`);
  results.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name + ' (score: ' + r.score.toFixed(3) + ')');
  });
  if (results.length > 5) {
    console.log(`  ... and ${results.length - 5} more`);
  }

  await rag.close();
  return results;
}

export { semanticSearchBySource };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    semanticSearchBySource()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
