/**
 * Test semantic search with relationship expansion
 *
 * This demonstrates the intended usage once VectorSearch module is implemented
 */

import { createRagClient } from './generated-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Testing Semantic Search with Relationships\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // 🎯 USAGE EXAMPLE: What you want to do
  console.log('📌 Query: "Find scopes related to environment configuration"');
  console.log('─'.repeat(70));
  console.log('\nCode you would write:');
  console.log(`
  const results = await rag.scope()
    .semanticSearch('environment configuration and file paths', { topK: 10 })
    .withConsumes(1)      // Include dependencies
    .withConsumedBy(1)    // Include consumers
    .rerankByCodeQuality() // Prefer well-documented code
    .limit(5)
    .execute();
  `);

  console.log('\n⚙️ What happens behind the scenes:\n');
  console.log('1. Semantic Search:');
  console.log('   - Embed query: "environment configuration and file paths"');
  console.log('   - Query Neo4j vector index: scopeEmbeddings');
  console.log('   - Get top 10 semantically similar scopes');
  console.log('');
  console.log('2. Relationship Expansion:');
  console.log('   - For each result, expand CONSUMES relationships (depth=1)');
  console.log('   - For each result, expand CONSUMED_BY relationships (depth=1)');
  console.log('');
  console.log('3. Reranking:');
  console.log('   - Apply code-quality strategy');
  console.log('   - Boost scores based on documentation, conciseness, etc.');
  console.log('');
  console.log('4. Limit & Return:');
  console.log('   - Take top 5 results');
  console.log('   - Each result includes entity + related entities + scores');
  console.log('');

  console.log('📊 Expected result structure:\n');
  console.log(`
  {
    entity: {
      name: 'loadEnvironment',
      type: 'function',
      file: 'src/config/env.ts',
      embedding: [0.123, -0.456, ...],  // 1536-dim vector
    },
    score: 0.87,  // Combined score
    scoreBreakdown: {
      semantic: 0.92,      // Vector similarity
      'code-quality': 0.15  // Reranking boost
    },
    context: {
      related: [
        // Dependencies (CONSUMES)
        {
          entity: { name: 'resolvePath', type: 'function', ... },
          relationshipType: 'CONSUMES',
          direction: 'outgoing',
          distance: 1
        },
        // Consumers (CONSUMED_BY)
        {
          entity: { name: 'getRequiredEnv', type: 'function', ... },
          relationshipType: 'CONSUMED_BY',
          direction: 'outgoing',
          distance: 1
        }
      ]
    }
  }
  `);

  console.log('─'.repeat(70));
  console.log('\n🚧 Current Status:\n');
  console.log('✅ QueryBuilder API - READY');
  console.log('✅ Relationship expansion (withConsumes/withConsumedBy) - READY');
  console.log('✅ Generated client with semanticSearch() - READY');
  console.log('✅ Vector index configured in Neo4j - READY');
  console.log('⏳ VectorSearch module implementation - TODO');
  console.log('⏳ RerankingEngine module implementation - TODO');
  console.log('');
  console.log('The VectorSearch module needs to:');
  console.log('1. Generate embeddings for the query text');
  console.log('2. Call Neo4j vector index search');
  console.log('3. Merge vector results with filter results');
  console.log('4. Compute semantic similarity scores');
  console.log('');

  // Let's test if the vector index actually exists in Neo4j
  console.log('🔍 Checking if vector index exists in Neo4j...\n');

  try {
    const result = await (rag as any).runtime.raw(`
      SHOW INDEXES
      YIELD name, type, labelsOrTypes, properties
      WHERE type = 'VECTOR'
      RETURN name, labelsOrTypes, properties
    `);

    if (result.records.length > 0) {
      console.log('✅ Vector indexes found:');
      result.records.forEach((record: any) => {
        console.log(`   - ${record.get('name')} on ${record.get('labelsOrTypes')} (${record.get('properties')})`);
      });
    } else {
      console.log('⚠️  No vector indexes found in Neo4j');
      console.log('   You need to create the vector index first!');
    }
  } catch (err: any) {
    console.log('❌ Error checking indexes:', err.message);
  }

  console.log('');
  await rag.close();

  console.log('💡 Next steps to enable semantic search:');
  console.log('   1. Implement VectorSearch module in runtime');
  console.log('   2. Integrate with Vertex AI embeddings (text-embedding-004)');
  console.log('   3. Connect QueryBuilder.semantic() to VectorSearch');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
