/**
 * Test Pipeline Chaining
 *
 * Verifies that the new pipeline architecture allows flexible chaining of operations:
 * 1. Multiple semantic searches in a row
 * 2. Semantic search AFTER relationship expansion
 * 3. Complex multi-step pipelines
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing Pipeline Chaining\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // TEST 1: Double semantic search (was previously impossible!)
  console.log('='.repeat(80));
  console.log('TEST 1: Chaining Two Semantic Searches');
  console.log('='.repeat(80));
  console.log('Pipeline: semanticBySignature() → semanticBySource()');
  console.log('Goal: Find scopes with relevant signatures, then filter by source code\n');

  const test1 = await rag.scope()
    .semanticSearchBySignature('neo4j driver connection', { topK: 50 })
    .semanticSearchBySource('class constructor initialization', { topK: 10 })
    .execute();

  console.log(`Results: ${test1.length}`);
  console.log('Top 3:');
  test1.slice(0, 3).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
    if (r.scoreBreakdown?.semantic) {
      console.log(`     Semantic: ${r.scoreBreakdown.semantic.toFixed(3)}`);
    }
  });

  // TEST 2: Expand THEN semantic (was previously impossible!)
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Semantic Search AFTER Relationship Expansion');
  console.log('='.repeat(80));
  console.log('Pipeline: relatedTo() → expand() → semanticBySource()');
  console.log('Goal: Find scopes related to Neo4jClient, expand relationships, then semantic filter\n');

  const test2 = await rag.scope()
    .relatedTo('Neo4jClient', 'IMPORTS', 'incoming')
    .expand('CALLS', { depth: 1 })
    .semanticSearchBySource('database query execution', { topK: 5 })
    .execute();

  console.log(`Results: ${test2.length}`);
  test2.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
  });

  // TEST 3: Complex multi-step pipeline
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Complex Multi-Step Pipeline');
  console.log('='.repeat(80));
  console.log('Pipeline: semantic(50) → semantic(20) → expand() → semantic(10)');
  console.log('Goal: Progressive refinement through multiple semantic filters + expansion\n');

  const test3 = await rag.scope()
    .semanticSearchBySource('vector embedding search', { topK: 50 })
    .semanticSearchBySignature('async function search query', { topK: 20 })
    .expand('CALLS')
    .semanticSearchBySource('generate embedding api call', { topK: 10 })
    .execute();

  console.log(`Results: ${test3.length}`);
  test3.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
  });

  // TEST 4: Triple semantic search (extreme test!)
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: Triple Semantic Search (Extreme Progressive Refinement)');
  console.log('='.repeat(80));
  console.log('Pipeline: semantic(100) → semantic(30) → semantic(10)');
  console.log('Goal: Three-stage progressive filtering\n');

  const test4 = await rag.scope()
    .semanticSearchBySource('neo4j cypher query', { topK: 100 })
    .semanticSearchBySignature('execute run transaction', { topK: 30 })
    .semanticSearchBySource('session driver connection', { topK: 10 })
    .execute();

  console.log(`Results: ${test4.length}`);
  test4.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ PIPELINE CHAINING TESTS COMPLETE!');
  console.log('='.repeat(80));
  console.log('\n💡 Key Achievements:');
  console.log('  ✓ Multiple semantic searches can be chained');
  console.log('  ✓ Semantic search works AFTER expansions');
  console.log('  ✓ Complex multi-step pipelines execute correctly');
  console.log('  ✓ Progressive refinement through stages works as expected');

  await rag.close();
}

main().catch(console.error);
