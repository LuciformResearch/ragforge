/**
 * Check Neo4j Directly
 *
 * Query Neo4j directly to see if getNeo4jDriver is in the vector index
 */

import neo4j from 'neo4j-driver';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Direct Neo4j Check\n');

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME || 'neo4j',
      process.env.NEO4J_PASSWORD || ''
    )
  );

  const session = driver.session({ database: 'neo4j' });

  try {
    // 1. Check if scope exists
    console.log('='.repeat(80));
    console.log('1️⃣  Scope Existence');
    console.log('='.repeat(80));

    const exists = await session.run(`
      MATCH (s:Scope {name: 'getNeo4jDriver'})
      RETURN s.name AS name,
             s.file AS file,
             size(s.embedding_source) AS embedding_dim,
             s.embedding_source IS NOT NULL AS has_embedding
    `);

    if (exists.records.length === 0) {
      console.log('❌ Scope does not exist in Neo4j!');
      return;
    }

    const record = exists.records[0];
    console.log('✅ Scope exists');
    console.log(`   Name: ${record.get('name')}`);
    console.log(`   File: ${record.get('file')}`);
    console.log(`   Has embedding: ${record.get('has_embedding')}`);
    console.log(`   Embedding dimension: ${record.get('embedding_dim')}`);

    // 2. Check CONSUMES relationships
    console.log('\n' + '='.repeat(80));
    console.log('2️⃣  CONSUMES Relationships');
    console.log('='.repeat(80));

    const consumes = await session.run(`
      MATCH (s:Scope {name: 'getNeo4jDriver'})-[:CONSUMES]->(dep:Scope)
      RETURN dep.name AS name
    `);

    if (consumes.records.length === 0) {
      console.log('⚠️  NO CONSUMES relationships found!');
      console.log('   This explains why Uses: (none) in previous test');
    } else {
      console.log(`Found ${consumes.records.length} CONSUMES:`);
      consumes.records.forEach(r => console.log(`  - ${r.get('name')}`));
    }

    // 3. Test vector index query directly
    console.log('\n' + '='.repeat(80));
    console.log('3️⃣  Vector Index Query (Direct)');
    console.log('='.repeat(80));

    // First, get a dummy embedding to test (just use zeros)
    const dummyEmbedding = new Array(768).fill(0);

    const vectorTest = await session.run(`
      MATCH (s:Scope {name: 'getNeo4jDriver'})
      RETURN s.embedding_source AS embedding
    `);

    if (vectorTest.records.length > 0 && vectorTest.records[0].get('embedding')) {
      console.log('✅ Scope has embedding_source property');

      // Try to query vector index
      const indexCheck = await session.run(`
        SHOW INDEXES
        WHERE type = 'VECTOR' AND name = 'scopeEmbeddingsSource'
      `);

      if (indexCheck.records.length > 0) {
        console.log('✅ scopeEmbeddingsSource index exists');
        console.log(`   Labels: ${indexCheck.records[0].get('labelsOrTypes')}`);
        console.log(`   Properties: ${indexCheck.records[0].get('properties')}`);
      } else {
        console.log('❌ scopeEmbeddingsSource index NOT FOUND');
      }

      // Check if getNeo4jDriver is in the index by querying with its own embedding
      const selfQuery = await session.run(`
        MATCH (target:Scope {name: 'getNeo4jDriver'})
        WITH target.embedding_source AS targetEmb
        CALL db.index.vector.queryNodes('scopeEmbeddingsSource', 10, targetEmb)
        YIELD node, score
        RETURN node.name AS name, score
        ORDER BY score DESC
      `);

      console.log('\n🔍 Self-query test (query with its own embedding):');
      if (selfQuery.records.length === 0) {
        console.log('❌ NOT FOUND - Even when searching with its own embedding!');
        console.log('   This means getNeo4jDriver is NOT in the vector index!');
      } else {
        console.log('Results:');
        selfQuery.records.forEach((r, i) => {
          const name = r.get('name');
          const score = r.get('score');
          const marker = name === 'getNeo4jDriver' ? '→' : ' ';
          console.log(`${marker} ${i + 1}. ${name.padEnd(30)} Score: ${score.toFixed(4)}`);
        });
      }
    } else {
      console.log('❌ No embedding_source found!');
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
