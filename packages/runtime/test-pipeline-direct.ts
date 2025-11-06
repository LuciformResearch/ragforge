/**
 * Direct Pipeline Test (bypasses node_modules caching)
 *
 * Tests the pipeline by directly importing from dist
 */

import { Neo4jClient } from './dist/client/neo4j-client.js';
import { QueryBuilder } from './dist/query/query-builder.js';
import { VectorSearch } from './dist/vector/vector-search.js';

async function main() {
  console.log('🧪 Direct Pipeline Test\n');

  try {
    const client = new Neo4jClient({
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    });

    const vectorSearch = new VectorSearch(client);
    const queryBuilder = new QueryBuilder(client, 'Scope', vectorSearch);

    console.log('='.repeat(80));
    console.log('TEST: Double Semantic Search');
    console.log('='.repeat(80));

    const results = await queryBuilder
      .semantic('neo4j driver connection', {
        topK: 50,
        vectorIndex: 'scopeEmbeddingsSignature',
        minScore: 0.0
      })
      .semantic('constructor initialization', {
        topK: 10,
        vectorIndex: 'scopeEmbeddingsSource',
        minScore: 0.0
      })
      .execute();

    console.log(`\n✅ SUCCESS! Results: ${results.length}`);
    console.log('Top 5:');
    results.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
      console.log(`     Score: ${r.score.toFixed(3)}`);
      if (r.scoreBreakdown) {
        console.log(`     Breakdown:`, r.scoreBreakdown);
      }
    });

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);
