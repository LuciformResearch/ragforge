import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Filter and expand by DEFINED_IN
 * @description Use DEFINED_IN relationship to find connected code scopes
 * @intent Find code scopes related through DEFINED_IN
 * @tags relationships, defined_in, graph
 */
async function filterAndExpandByDefinedIn() {
  const rag = createRagClient(); // Uses .env variables automatically

  console.log('🔍 Filtering by DEFINED_IN relationship...');
  const filtered = await rag.scope()
    .whereFileName('config.ts')
    .execute();

  console.log(`\nFound ${filtered.length} items with DEFINED_IN relationship:`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (filtered.length > 5) {
    console.log(`  ... and ${filtered.length - 5} more`);
  }

  console.log('\n🔗 Expanding relationships from "needsSummary"...');
  const expanded = await rag.scope()
    .whereName('needsSummary')
    .withDefinedIn(2)  // Get relationships 2 levels deep
    .execute();

  console.log(`\nFound ${expanded.length} items with expanded context:`);
  expanded.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (expanded.length > 5) {
    console.log(`  ... and ${expanded.length - 5} more`);
  }

  await rag.close();
  return { filtered, expanded };
}

export { filterAndExpandByDefinedIn };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    filterAndExpandByDefinedIn()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
