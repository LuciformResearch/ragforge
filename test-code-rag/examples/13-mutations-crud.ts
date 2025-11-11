import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example CRUD operations with mutations
 * @description Create, update, and delete Scope entities with DEFINED_IN relationships
 * @intent mutation, crud, create, update, delete, relationships
 * @tags crud, mutations, create, update, delete
 */
async function crudOperationsWithMutations() {
  const rag = createRagClient(); // Uses .env variables automatically

  console.log('📚 Testing CRUD mutations\n');

  // 1. Create a new scope
  console.log('1️⃣ Creating a new scope...');
  const newScope: ScopeCreate = {
    uuid: 'scope-test-001',
    name: 'Sample name 1',
    file: 'Sample file 2'
  };

  const createdScope = await rag.scopeMutations().create(newScope);
  console.log('✅ Scope created:', createdScope);
  console.log();

  // 2. Create a new scope
  console.log('2️⃣ Creating a new scope...');
  const newScope: ScopeCreate = {
    uuid: 'scope-test-001',
    name: 'Sample name 1',
    file: 'Sample file 2',
    source: 'Sample source 3'
  };

  const createdScope = await rag.scopeMutations().create(newScope);
  console.log('✅ Scope created:', createdScope);
  console.log();

  // 3. Add relationship: Scope DEFINED_IN Scope
  console.log('3️⃣ Linking scope to scope...');
  await rag.scopeMutations().addDefinedIn('scope-test-001', 'scope-test-001');
  console.log('✅ Relationship added: Scope DEFINED_IN Scope');
  console.log();

  // 4. Update the scope
  console.log('4️⃣ Updating scope...');
  const scopeUpdate: ScopeUpdate = {
    file: 'Updated file'
  };

  const updatedScope = await rag.scopeMutations().update('scope-test-001', scopeUpdate);
  console.log('✅ Scope updated:', updatedScope);
  console.log();

  // 5. Remove the relationship
  console.log('5️⃣ Removing scope-scope relationship...');
  await rag.scopeMutations().removeDefinedIn('scope-test-001', 'scope-test-001');
  console.log('✅ Relationship removed');
  console.log();

  // 6. Delete the scope
  console.log('6️⃣ Deleting the scope...');
  await rag.scopeMutations().delete('scope-test-001');
  console.log('✅ Scope deleted');
  console.log();

  // 7. Delete the scope
  console.log('7️⃣ Deleting the scope...');
  await rag.scopeMutations().delete('scope-test-001');
  console.log('✅ Scope deleted');
  console.log();

  console.log('✨ All CRUD operations completed successfully!');

  await rag.close();
  
}

export { crudOperationsWithMutations };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    crudOperationsWithMutations()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
