import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Breadth-first context exploration
 * @description Get immediate neighborhood around an entity
 * @intent Map local context by exploring 1-hop relationships
 * @tags breadth-first, exploration, context
 */
async function breadthFirstContextExploration() {
  const rag = createRagClient(); // Uses .env variables automatically

  // Find entry point
  const entry = await rag.scope()
    .whereName('needsSummary')
    .execute();

  if (entry.length === 0) {
    console.log('Entry point not found');
    return { context: [] };
  }

  // Breadth-first: Get immediate neighborhood
  const context = await rag.scope()
    .whereName('needsSummary')
    .withDefinedIn(1)
    .withConsumes(1)
    .withHasParent(1)
    .execute();

  console.log(`Breadth-first context: ${context.length} code scopes`);

  // Analyze immediate context by relationship type
  context.forEach(r => {
    const relTypes = r.context?.related?.map(rel => rel.relationshipType).join(', ');
    console.log(`  - ${r.entity.name} (related via: ${relTypes || 'direct'})`);
  });

  await rag.close();
  return { context };
}

export { breadthFirstContextExploration };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    breadthFirstContextExploration()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
