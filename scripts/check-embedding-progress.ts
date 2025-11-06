/**
 * Check embedding reindexing progress
 */

import neo4j from 'neo4j-driver';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || ''
    )
  );

  const session = driver.session({ database: 'neo4j' });

  try {
    const result = await session.run(`
      MATCH (s:Scope)
      RETURN
        count(s) AS total,
        count(s.embedding_signature) AS with_signature,
        count(s.embedding_source) AS with_source
    `);

    const record = result.records[0];
    const total = record.get('total').toNumber();
    const withSig = record.get('with_signature').toNumber();
    const withSrc = record.get('with_source').toNumber();

    console.log('📊 Embedding Progress:');
    console.log(`  Total scopes: ${total}`);
    console.log(`  With signature embedding: ${withSig} (${((withSig/total)*100).toFixed(1)}%)`);
    console.log(`  With source embedding: ${withSrc} (${((withSrc/total)*100).toFixed(1)}%)`);

    if (withSig === total && withSrc === total) {
      console.log('\n✅ Reindexing complete!');
    } else {
      console.log('\n⏳ Reindexing in progress...');
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main();
