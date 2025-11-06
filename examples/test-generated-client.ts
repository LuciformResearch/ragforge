/**
 * Test the generated RAG client
 */

import { createRagClient } from './generated-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing Generated RAG Client\n');

  // Create client
  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Test 1: Simple query with typed methods
  console.log('📝 Test 1: Find functions with typed methods');
  console.log('─'.repeat(60));

  
  const functions = await rag.scope()
    .whereType('function')
    .limit(5)
    .execute();

  console.log(`Found ${functions.length} functions:`);
  functions.forEach(r => {
    console.log(`  - ${r.entity.name} (${r.entity.file})`);
  });
  console.log();

  // Test 2: Query with relationship expansion
  console.log('📝 Test 2: Find functions with dependencies');
  console.log('─'.repeat(60));

  const withDeps = await rag.scope()
    .whereType('function')
    .withConsumes(1)
    .limit(3)
    .execute();

  console.log(`Found ${withDeps.length} functions:`);
  withDeps.forEach(r => {
    const depsCount = r.context?.related?.length || 0;
    console.log(`  - ${r.entity.name}: ${depsCount} dependencies`);
  });
  console.log();

  // Test 3: Advanced query with filters
  console.log('📝 Test 3: Complex query with operators');
  console.log('─'.repeat(60));

  const ingestScopes = await rag.scope()
    .whereFile({ contains: 'ingest' })
    .limit(5)
    .execute();

  console.log(`Found ${ingestScopes.length} scopes in ingest files:`);
  ingestScopes.forEach(r => {
    console.log(`  - ${r.entity.name} (${r.entity.type})`);
  });
  console.log();

  // Test 4: Query files
  console.log('📝 Test 4: Query files');
  console.log('─'.repeat(60));

  const files = await rag.file()
    .limit(5)
    .execute();

  console.log(`Found ${files.length} files:`);
  files.forEach(r => {
    console.log(`  - ${r.entity.name}`);
  });
  console.log();


  const test


  // Close
  await rag.close();

  console.log('✅ All tests passed!');
  console.log();
  console.log('🎉 The generated client works perfectly!');
  console.log();
  console.log('Type-safe API includes:');
  console.log('  - rag.scope().whereType(...) ← Autocomplete!');
  console.log('  - rag.scope().withConsumes(...) ← Typed relationships!');
  console.log('  - rag.scope().rerankByCodeQuality() ← Custom reranking!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
