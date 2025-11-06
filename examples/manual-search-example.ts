/**
 * Claude's manual search strategy
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Claude\'s Manual Search\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Strategy: Search for neo4j connection + expand with withConsumes
  console.log('Strategy: Semantic search for "neo4j connection setup" + withConsumes(1)\n');

  const results = await rag.scope()
    .semanticSearchBySource('neo4j database connection driver setup', { topK: 20 })
    .withConsumes(1)  // ← NOW TESTING THE FIX!
    .execute();

  console.log(`Found ${results.length} results\n`);

  console.log('='.repeat(80));
  console.log('Top Results:');
  console.log('='.repeat(80));

  results.slice(0, 10).forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.entity.name} (${r.entity.type}) - Score: ${r.score.toFixed(4)}`);
    console.log(`   File: ${r.entity.file}`);
    console.log(`   Signature: ${r.entity.signature?.substring(0, 100) || 'N/A'}`);

    if (r.context?.related) {
      const deps = r.context.related.filter(rel => rel.type === 'CONSUMES');
      if (deps.length > 0) {
        console.log(`   Uses: ${deps.slice(0, 3).map(d => d.entity.name).join(', ')}`);
      }
    }
  });

  await rag.close();
}

main().catch(console.error);
