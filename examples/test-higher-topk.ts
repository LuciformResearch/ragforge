/**
 * Test with very high topK to find getNeo4jDriver position
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Testing with High topK\n');

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
  console.log(`Testing with topK=100, minScore=0.0 (no filtering)\n`);

  const results = await rag.scope()
    .semanticSearchBySource(query, { topK: 100, minScore: 0.0 })
    .execute();

  console.log(`Total results: ${results.length}\n`);

  // Find getNeo4jDriver
  const index = results.findIndex(r => r.entity.name === 'getNeo4jDriver');

  if (index >= 0) {
    console.log(`✅ FOUND getNeo4jDriver at rank #${index + 1}`);
    console.log(`   Score: ${results[index].score.toFixed(4)}`);
    console.log(`   File: ${results[index].entity.file}`);

    // Show context around it
    console.log(`\n📊 Context (ranks ${Math.max(1, index - 2)} to ${Math.min(results.length, index + 3)}):\n`);
    results.slice(Math.max(0, index - 2), index + 3).forEach((r, i) => {
      const actualRank = Math.max(0, index - 2) + i + 1;
      const marker = r.entity.name === 'getNeo4jDriver' ? '→' : ' ';
      console.log(`${marker} #${actualRank}: ${r.entity.name.padEnd(30)} Score: ${r.score.toFixed(4)}`);
    });

    // Check if it has consumes
    if ((results[index].entity as any).consumes) {
      console.log(`\n   Uses: ${(results[index].entity as any).consumes.join(', ')}`);
    }
  } else {
    console.log(`❌ getNeo4jDriver NOT FOUND even in top ${results.length}!`);
    console.log(`\nThis is very strange. Let me show the top 30:\n`);

    results.slice(0, 30).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.entity.name.padEnd(30)} Score: ${r.score.toFixed(4)}`);
    });
  }

  await rag.close();
}

main().catch(console.error);
