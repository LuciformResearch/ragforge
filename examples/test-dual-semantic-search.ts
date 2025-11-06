/**
 * Test dual semantic search (signature + source)
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Testing Dual Semantic Search\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Test 1: Search by signature
  console.log('1️⃣ Semantic search by SIGNATURE');
  console.log('   Query: "function that takes a path and returns void"');
  console.log('─'.repeat(70));

  try {
    const bySignature = await rag.scope()
      .semanticSearchBySignature('function that takes a path and returns void', { topK: 5 })
      .execute();

    console.log(`Found ${bySignature.length} results:\n`);
    bySignature.forEach((result, i) => {
      console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
      console.log(`   Signature: ${result.entity.signature?.substring(0, 80)}...`);
      console.log(`   File: ${result.entity.file}`);
      if (result.scoreBreakdown) {
        console.log(`   Score breakdown:`, result.scoreBreakdown);
      }
      console.log('');
    });
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 2: Search by source
  console.log('2️⃣ Semantic search by SOURCE');
  console.log('   Query: "code that uses dotenv to load environment variables"');
  console.log('─'.repeat(70));

  try {
    const bySource = await rag.scope()
      .semanticSearchBySource('code that uses dotenv to load environment variables', { topK: 5 })
      .execute();

    console.log(`Found ${bySource.length} results:\n`);
    bySource.forEach((result, i) => {
      console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
      console.log(`   Type: ${result.entity.type}`);
      console.log(`   File: ${result.entity.file}`);
      if (result.scoreBreakdown) {
        console.log(`   Score breakdown:`, result.scoreBreakdown);
      }
      console.log('');
    });
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 3: Combined with relationships
  console.log('3️⃣ Semantic search + Relationship expansion');
  console.log('   Query: "environment configuration" with consumers and dependencies');
  console.log('─'.repeat(70));

  try {
    const withRelations = await rag.scope()
      .semanticSearchBySource('environment configuration', { topK: 3 })
      .withConsumes(1)
      .withConsumedBy(1)
      .limit(3)
      .execute();

    console.log(`Found ${withRelations.length} results:\n`);
    withRelations.forEach((result, i) => {
      console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
      console.log(`   Type: ${result.entity.type}`);
      console.log(`   File: ${result.entity.file}`);

      if (result.context?.related) {
        const dependencies = result.context.related.filter((r: any) => r.relationshipType === 'CONSUMES');
        const consumers = result.context.related.filter((r: any) => r.relationshipType === 'CONSUMED_BY');

        if (dependencies.length > 0) {
          console.log(`   Dependencies (${dependencies.length}):`);
          dependencies.slice(0, 3).forEach((dep: any) => {
            console.log(`     → ${dep.entity.name}`);
          });
        }

        if (consumers.length > 0) {
          console.log(`   Consumers (${consumers.length}):`);
          consumers.slice(0, 3).forEach((con: any) => {
            console.log(`     ← ${con.entity.name}`);
          });
        }
      }
      console.log('');
    });
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 4: Compare signature vs source search
  console.log('4️⃣ Comparison: Signature vs Source search');
  console.log('   Same query on both indexes: "parse TypeScript file"');
  console.log('─'.repeat(70));

  try {
    const [sigResults, srcResults] = await Promise.all([
      rag.scope().semanticSearchBySignature('parse TypeScript file', { topK: 3 }).execute(),
      rag.scope().semanticSearchBySource('parse TypeScript file', { topK: 3 }).execute()
    ]);

    console.log('By Signature:');
    sigResults.forEach((r, i) => console.log(`  ${i + 1}. ${r.entity.name} (${r.score.toFixed(3)})`));

    console.log('\nBy Source:');
    srcResults.forEach((r, i) => console.log(`  ${i + 1}. ${r.entity.name} (${r.score.toFixed(3)})`));

    console.log('');
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  await rag.close();

  console.log('✅ All tests completed!\n');
  console.log('💡 Key insights:');
  console.log('   - semanticSearchBySignature() finds functions by their API/interface');
  console.log('   - semanticSearchBySource() finds functions by their implementation');
  console.log('   - Both can be combined with relationship expansion');
  console.log('   - Different queries benefit from different embedding types');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
