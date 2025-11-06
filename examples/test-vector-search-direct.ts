/**
 * Test VectorSearch module directly
 */

import { VectorSearch } from '../packages/runtime/src/vector/vector-search.js';
import { Neo4jClient } from '../packages/runtime/src/client/neo4j-client.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing VectorSearch Module Directly\n');

  const neo4jClient = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: 'neo4j'
  });

  const vectorSearch = new VectorSearch(neo4jClient);

  try {
    // Test 1: Generate embedding
    console.log('1️⃣ Test embedding generation');
    console.log('─'.repeat(70));

    const testText = 'function that takes a path and returns void';
    console.log(`Text: "${testText}"`);

    const embedding = await vectorSearch.generateEmbedding(testText);

    console.log(`✅ Generated embedding`);
    console.log(`   Dimension: ${embedding.length}`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
    console.log('');

    // Test 2: Vector search on signature index
    console.log('2️⃣ Test vector search (signature index)');
    console.log('─'.repeat(70));

    const sigResults = await vectorSearch.search(testText, {
      indexName: 'scopeEmbeddingsSignature',
      topK: 5,
      minScore: 0.0
    });

    console.log(`Found ${sigResults.length} results:\n`);
    sigResults.forEach((result, i) => {
      console.log(`${i + 1}. ${result.properties.name} (score: ${result.score.toFixed(4)})`);
      console.log(`   Signature: ${result.properties.signature?.substring(0, 80)}...`);
      console.log(`   File: ${result.properties.file}`);
      console.log('');
    });

    // Test 3: Vector search on source index
    console.log('3️⃣ Test vector search (source index)');
    console.log('─'.repeat(70));

    const srcText = 'code that uses dotenv to load environment variables';
    const srcResults = await vectorSearch.search(srcText, {
      indexName: 'scopeEmbeddingsSource',
      topK: 5,
      minScore: 0.0
    });

    console.log(`Query: "${srcText}"`);
    console.log(`Found ${srcResults.length} results:\n`);
    srcResults.forEach((result, i) => {
      console.log(`${i + 1}. ${result.properties.name} (score: ${result.score.toFixed(4)})`);
      console.log(`   Type: ${result.properties.type}`);
      console.log(`   File: ${result.properties.file}`);
      console.log('');
    });

    console.log('✅ VectorSearch module works!\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await neo4jClient.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
