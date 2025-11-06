/**
 * Test simplified semantic search on related scopes
 *
 * This demonstrates the new one-liner API for semantic search on related scopes
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Simplified Semantic Search on Related Scopes\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  const targetScope = 'loadEnvironment';

  // ═══════════════════════════════════════════════════════════════════
  // NEW: One-liner semantic search on consumers
  // ═══════════════════════════════════════════════════════════════════

  console.log(`1️⃣ Find consumers of "${targetScope}" semantically (ONE LINE)`);
  console.log('─'.repeat(70));

  const query1 = 'configuration and setup code';
  console.log(`Query: "${query1}"\n`);

  const results1 = await rag.scope()
    .whereConsumesScope(targetScope)
    .semanticSearchBySource(query1, { topK: 50 })
    .limit(5)
    .execute();

  console.log(`Found ${results1.length} matching consumers:\n`);
  results1.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   File: ${result.entity.file}`);
    console.log(`   Type: ${result.entity.type}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // NEW: One-liner semantic search on dependencies
  // ═══════════════════════════════════════════════════════════════════

  console.log(`\n2️⃣ Find dependencies of "${targetScope}" semantically (ONE LINE)`);
  console.log('─'.repeat(70));

  const query2 = 'path resolution and file system utilities';
  console.log(`Query: "${query2}"\n`);

  const results2 = await rag.scope()
    .whereConsumedByScope(targetScope)
    .semanticSearchBySource(query2, { topK: 50 })
    .limit(5)
    .execute();

  console.log(`Found ${results2.length} matching dependencies:\n`);
  results2.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   File: ${result.entity.file}`);
    console.log(`   Type: ${result.entity.type}`);
    console.log('');
  });

  await rag.close();

  console.log('═'.repeat(70));
  console.log('✅ Success! The new API works!\n');
  console.log('Before: ~20 lines of code with manual filtering');
  console.log('After:  1 fluent query chain\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
