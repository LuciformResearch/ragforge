/**
 * Test Semantic Search Improvement with camelCase Tokenization
 *
 * Check if "getNeo4jDriver" now appears in results for "neo4j" queries
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔬 Testing camelCase Tokenization Impact on Semantic Search\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  const query = 'neo4j database connection setup';

  console.log(`Query: "${query}"`);
  console.log(`Testing with topK=50, minScore=0.3\n`);

  // Test semantic search
  const results = await rag.scope()
    .semanticSearchBySource(query, { topK: 50, minScore: 0.3 })
    .execute();

  console.log(`Total results: ${results.length}\n`);

  // Critical scopes we're tracking
  const criticalScopes = [
    'getNeo4jDriver',      // ← This should now appear!
    'createNeo4jDriver',
    'getNeo4jSession',
    'getNeo4jConfig',
    'Neo4jConfig',
    'Neo4jClient'
  ];

  console.log('='.repeat(80));
  console.log('🎯 Critical Scopes (with camelCase enrichment)');
  console.log('='.repeat(80));

  criticalScopes.forEach(scopeName => {
    const index = results.findIndex(r => r.entity.name === scopeName);
    if (index >= 0) {
      const result = results[index];
      console.log(`\n✅ ${scopeName}`);
      console.log(`   Rank: #${index + 1} / ${results.length}`);
      console.log(`   Score: ${result.score.toFixed(4)}`);
      console.log(`   File: ${result.entity.file}`);

      // Show enrichment info
      if ((result.entity as any).consumes) {
        const consumes = (result.entity as any).consumes;
        console.log(`   Uses: ${consumes.slice(0, 3).join(', ')}${consumes.length > 3 ? '...' : ''}`);
      }
    } else {
      console.log(`\n❌ ${scopeName}`);
      console.log(`   NOT FOUND in top ${results.length} results`);
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('📊 Top 20 Results');
  console.log('='.repeat(80));

  results.slice(0, 20).forEach((r, i) => {
    const isCritical = criticalScopes.includes(r.entity.name);
    const marker = isCritical ? '⭐' : '  ';
    console.log(`${marker} ${(i + 1).toString().padStart(2)}. ${r.entity.name.padEnd(30)} Score: ${r.score.toFixed(4)}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('💡 Analysis');
  console.log('='.repeat(80));

  const getNeo4jDriverIndex = results.findIndex(r => r.entity.name === 'getNeo4jDriver');

  if (getNeo4jDriverIndex >= 0) {
    console.log('\n✅ SUCCESS! getNeo4jDriver is now found in semantic search!');
    console.log(`   Rank: #${getNeo4jDriverIndex + 1}`);
    console.log(`   Score: ${results[getNeo4jDriverIndex].score.toFixed(4)}`);
    console.log('\n🎉 camelCase tokenization improved semantic matching!');
    console.log('   "getNeo4jDriver" → "Get Neo4j Driver" helps match "neo4j" queries');
  } else {
    console.log('\n⚠️  getNeo4jDriver still not found');
    console.log('   This could mean:');
    console.log('   1. Embeddings not fully reindexed yet');
    console.log('   2. Need to increase topK');
    console.log('   3. Function content is too sparse for semantic match');
  }

  // Calculate average rank of critical scopes
  const foundScopes = criticalScopes
    .map(name => ({
      name,
      index: results.findIndex(r => r.entity.name === name)
    }))
    .filter(s => s.index >= 0);

  if (foundScopes.length > 0) {
    const avgRank = foundScopes.reduce((sum, s) => sum + s.index, 0) / foundScopes.length;
    console.log(`\n📈 Statistics:`);
    console.log(`   Critical scopes found: ${foundScopes.length}/${criticalScopes.length}`);
    console.log(`   Average rank: #${(avgRank + 1).toFixed(1)}`);
    console.log(`   Best rank: #${Math.min(...foundScopes.map(s => s.index)) + 1}`);
    console.log(`   Worst rank: #${Math.max(...foundScopes.map(s => s.index)) + 1}`);
  }

  console.log('\n' + '='.repeat(80));

  await rag.close();
}

main().catch(console.error);
