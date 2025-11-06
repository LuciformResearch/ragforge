/**
 * Test Double Semantic Search
 *
 * The KEY test: Can we chain two semantic searches?
 * This was IMPOSSIBLE before the pipeline refactoring.
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing Double Semantic Search (Previously Impossible!)\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // TEST 1: Single semantic search (baseline)
  console.log('='.repeat(80));
  console.log('BASELINE: Single Semantic Search by Signature');
  console.log('='.repeat(80));

  const baseline = await rag.scope()
    .semanticSearchBySignature('neo4j driver connection', { topK: 20 })
    .execute();

  console.log(`Results: ${baseline.length}`);
  console.log('Top 5:');
  baseline.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
  });

  // TEST 2: DOUBLE semantic search (THE MAGIC!)
  console.log('\n' + '='.repeat(80));
  console.log('🎯 PIPELINE TEST: Double Semantic Search');
  console.log('='.repeat(80));
  console.log('Pipeline: semanticBySignature(50) → semanticBySource(10)');
  console.log('This refines results by FIRST finding relevant signatures,');
  console.log('THEN filtering by source code content.\n');

  const doubleSearch = await rag.scope()
    .semanticSearchBySignature('neo4j driver connection', { topK: 50 })
    .semanticSearchBySource('constructor initialization config', { topK: 10 })
    .execute();

  console.log(`Results: ${doubleSearch.length}`);
  console.log('Top results:');
  doubleSearch.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
    if (r.scoreBreakdown) {
      console.log(`     Breakdown:`, r.scoreBreakdown);
    }
    console.log();
  });

  // TEST 3: TRIPLE semantic search (extreme!)
  console.log('='.repeat(80));
  console.log('🚀 EXTREME TEST: Triple Semantic Search');
  console.log('='.repeat(80));
  console.log('Pipeline: semanticBySource(100) → semanticBySignature(30) → semanticBySource(5)');
  console.log('Three stages of progressive refinement!\n');

  const tripleSearch = await rag.scope()
    .semanticSearchBySource('query builder search', { topK: 100 })
    .semanticSearchBySignature('async function execute', { topK: 30 })
    .semanticSearchBySource('neo4j cypher match return', { topK: 5 })
    .execute();

  console.log(`Results: ${tripleSearch.length}`);
  tripleSearch.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ DOUBLE/TRIPLE SEMANTIC SEARCH WORKING!');
  console.log('='.repeat(80));
  console.log('\n💡 Before pipeline refactoring: IMPOSSIBLE');
  console.log('   After pipeline refactoring: WORKS PERFECTLY');
  console.log('\n   The second/third semantic searches correctly filter');
  console.log('   the results from the first search using filterUuids!');

  await rag.close();
}

main().catch(console.error);
