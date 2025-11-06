/**
 * Diagnose Ranking Issues
 *
 * Test with high topK to find where missing critical scopes appear
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Ranking Diagnosis - High topK Test\n');

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
  console.log(`Testing with topK=50 (vs topK=15 in original test)\n`);

  const results = await rag.scope()
    .semanticSearchBySource(query, { topK: 50, minScore: 0.3 })
    .execute();

  console.log(`Total results: ${results.length}\n`);

  // Critical scopes we expect to find
  const criticalScopes = [
    'createNeo4jDriver',
    'getNeo4jDriver',
    'getNeo4jSession',
    'getNeo4jConfig',
    'buildConfig',
    'Neo4jConfig'
  ];

  console.log('='.repeat(80));
  console.log('📊 Position of Critical Scopes');
  console.log('='.repeat(80));

  criticalScopes.forEach(scopeName => {
    const index = results.findIndex(r => r.entity.name === scopeName);
    if (index >= 0) {
      const result = results[index];
      console.log(`\n✅ ${scopeName}`);
      console.log(`   Rank: #${index + 1} / ${results.length}`);
      console.log(`   Score: ${result.score.toFixed(4)}`);
      console.log(`   File: ${result.entity.file}`);

      if ((result.entity as any).consumes) {
        const consumes = (result.entity as any).consumes;
        console.log(`   Uses: ${consumes.slice(0, 3).join(', ')}${consumes.length > 3 ? '...' : ''}`);
      }

      // Show source snippet
      if (result.entity.source && result.entity.source.length < 200) {
        console.log(`   Source: ${result.entity.source.substring(0, 150)}`);
      }
    } else {
      console.log(`\n❌ ${scopeName}`);
      console.log(`   NOT FOUND in top ${results.length} results`);
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('📈 All Results (Top 30)');
  console.log('='.repeat(80));

  results.slice(0, 30).forEach((r, i) => {
    const isCritical = criticalScopes.includes(r.entity.name);
    const marker = isCritical ? '⭐' : '  ';
    console.log(`${marker} ${i + 1}. ${r.entity.name.padEnd(30)} Score: ${r.score.toFixed(4)}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('🎯 Analysis');
  console.log('='.repeat(80));

  const foundCritical = criticalScopes.filter(name =>
    results.some(r => r.entity.name === name)
  );
  const missingCritical = criticalScopes.filter(name =>
    !results.some(r => r.entity.name === name)
  );

  console.log(`\nCritical scopes found: ${foundCritical.length}/${criticalScopes.length}`);
  if (missingCritical.length > 0) {
    console.log(`Missing: ${missingCritical.join(', ')}`);
  }

  // Average rank of critical scopes
  const ranks = criticalScopes
    .map(name => results.findIndex(r => r.entity.name === name))
    .filter(i => i >= 0);

  if (ranks.length > 0) {
    const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    console.log(`\nAverage rank of critical scopes: #${(avgRank + 1).toFixed(1)}`);
    console.log(`Best rank: #${Math.min(...ranks) + 1}`);
    console.log(`Worst rank: #${Math.max(...ranks) + 1}`);
  }

  await rag.close();
}

main().catch(console.error);
