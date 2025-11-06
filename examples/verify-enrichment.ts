/**
 * Verify that camelCase enrichment was applied to getNeo4jDriver
 */

import neo4j from 'neo4j-driver';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Verifying camelCase Enrichment in getNeo4jDriver\n');

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USERNAME || 'neo4j',
      process.env.NEO4J_PASSWORD || ''
    )
  );

  const session = driver.session({ database: 'neo4j' });

  try {
    // Get the scope with its CONSUMES
    const result = await session.run(`
      MATCH (s:Scope {name: 'getNeo4jDriver'})
      OPTIONAL MATCH (s)-[:CONSUMES]->(dep:Scope)
      WITH s, collect(DISTINCT dep.name) AS consumes
      RETURN s.name AS name,
             s.source AS source,
             consumes,
             s.embedding_source IS NOT NULL AS has_embedding,
             size(s.embedding_source) AS embedding_dim
    `);

    if (result.records.length === 0) {
      console.log('❌ Scope not found!');
      return;
    }

    const record = result.records[0];
    const source = record.get('source');
    const consumes = record.get('consumes');

    console.log('='.repeat(80));
    console.log('📝 Scope Information');
    console.log('='.repeat(80));
    console.log(`Name: ${record.get('name')}`);
    console.log(`Has embedding: ${record.get('has_embedding')}`);
    console.log(`Embedding dimension: ${record.get('embedding_dim')}`);
    console.log(`\nSource (${source?.length || 0} chars):`);
    console.log(source);
    console.log(`\nCONSUMES (${consumes.length}):`);
    consumes.forEach((dep: string) => console.log(`  - ${dep}`));

    console.log('\n' + '='.repeat(80));
    console.log('💡 Expected Enrichment (what should have been embedded):');
    console.log('='.repeat(80));

    // Simulate the enrichment that should have been applied
    function splitCamelCase(identifier: string): string {
      if (!identifier || identifier.length <= 1) return identifier;

      const words = identifier
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(' ');

      return words
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    const enrichments: string[] = [];

    // Function name enrichment
    const splitName = splitCamelCase('getNeo4jDriver');
    if (splitName !== 'getNeo4jDriver') {
      enrichments.push(`Function: ${splitName}`);
    }

    // CONSUMES enrichment
    if (consumes.length > 0) {
      const consumesOriginal = consumes.slice(0, 10).join(', ');
      const consumesSplit = consumes.slice(0, 10)
        .map((dep: string) => splitCamelCase(dep))
        .join(', ');

      enrichments.push(`Uses: ${consumesOriginal}`);

      if (consumesSplit !== consumesOriginal) {
        enrichments.push(`Uses (expanded): ${consumesSplit}`);
      }
    }

    console.log('\nOriginal source:');
    console.log(source);

    if (enrichments.length > 0) {
      console.log('\nWith enrichment:');
      console.log(source);
      console.log(`\n${enrichments.join('\n')}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎯 Analysis');
    console.log('='.repeat(80));
    console.log('\nThe enrichment adds:');
    enrichments.forEach(e => console.log(`  - ${e}`));

    console.log('\n💡 Key tokens added:');
    console.log('  - "Get Neo4j Driver" (from function name)');
    console.log('  - "Create Neo4j Driver" (from CONSUMES)');
    console.log('  - "Driver" (from CONSUMES)');

    console.log('\n⚠️  Issue:');
    console.log('  Even with these tokens, the function is still a short wrapper');
    console.log('  The semantic content is minimal compared to implementation functions');
    console.log('  Query: "neo4j database connection setup"');
    console.log('  Match: "Get Neo4j Driver" has some overlap, but weak semantic signal');

    // Test self-query
    console.log('\n' + '='.repeat(80));
    console.log('🔬 Self-Query Test (sanity check)');
    console.log('='.repeat(80));

    const selfQuery = await session.run(`
      MATCH (target:Scope {name: 'getNeo4jDriver'})
      WITH target.embedding_source AS targetEmb
      CALL db.index.vector.queryNodes('scopeEmbeddingsSource', 5, targetEmb)
      YIELD node, score
      RETURN node.name AS name, score
      ORDER BY score DESC
    `);

    console.log('\nQuerying with its own embedding (should be #1 with score ~1.0):');
    selfQuery.records.forEach((r, i) => {
      const name = r.get('name');
      const score = r.get('score');
      const marker = name === 'getNeo4jDriver' ? '→' : ' ';
      console.log(`${marker} ${i + 1}. ${name.padEnd(30)} Score: ${score.toFixed(4)}`);
    });

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
