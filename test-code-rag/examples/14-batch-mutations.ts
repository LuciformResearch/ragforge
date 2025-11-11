import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Batch mutations
 * @description Create multiple entities in a single transaction for better performance
 * @intent mutation, batch, createBatch, performance, transaction
 * @tags batch, mutations, createBatch
 */
async function batchMutations() {
  const rag = createRagClient(); // Uses .env variables automatically

  console.log('📦 Testing batch mutations\n');

  // 1. Create multiple Scope entities in batch
  console.log('1️⃣ Creating multiple scope entities in batch...');
  const newScopes: ScopeCreate[] = [
    {
      uuid: 'scope-batch-001',
      name: 'Sample Scope 1 name',
      file: 'Sample Scope 1 file'
    },
    {
      uuid: 'scope-batch-002',
      name: 'Sample Scope 2 name',
      file: 'Sample Scope 2 file'
    },
    {
      uuid: 'scope-batch-003',
      name: 'Sample Scope 3 name',
      file: 'Sample Scope 3 file'
    }
  ];

  const createdScopes = await rag.scopeMutations().createBatch(newScopes);
  console.log(`✅ Created ${createdScopes.length} scope entities`);
  createdScopes.forEach(item => {
    console.log(`   - ${item.name}`);
  });
  console.log();

  // 2. Cleanup - delete everything
  console.log('2️⃣ Cleaning up...');

    for (const item of createdScopes) {
      await rag.scopeMutations().delete(item.uuid);
    }
    console.log('   ✅ Deleted all scope entities');
  console.log();

  console.log('✨ Batch operations completed successfully!');

  await rag.close();
  
}

export { batchMutations };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    batchMutations()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
