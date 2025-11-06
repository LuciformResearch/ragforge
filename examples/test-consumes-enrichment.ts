/**
 * Test CONSUMES Enrichment
 *
 * Compare search relevance with contextual enrichment.
 * Goal: Find code related to "neo4j database" even if those words
 * don't appear in the code itself, but appear in CONSUMES.
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing CONSUMES Contextual Enrichment\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Test query: Look for code related to "neo4j database connection"
  // We expect to find scopes that:
  // - DON'T necessarily have "neo4j" in their code
  // - BUT consume Neo4jClient, Neo4jConfig, etc.
  const query = 'neo4j database connection setup';

  console.log('='.repeat(80));
  console.log('🔍 Search Query: "neo4j database connection setup"');
  console.log('='.repeat(80));
  console.log('\nExpected: Find code that works with Neo4j, even if the word');
  console.log('"neo4j" doesn\'t appear in the function body itself.\n');

  const results = await rag.scope()
    .semanticSearchBySource(query, { topK: 15, minScore: 0.3 })
    .execute();

  console.log(`\n📊 Results: ${results.length} scopes found\n`);

  results.forEach((r, i) => {
    console.log('─'.repeat(80));
    console.log(`${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`   File: ${r.entity.file}`);
    console.log(`   Score: ${r.score.toFixed(4)}`);

    // Show signature if available
    if (r.entity.signature) {
      console.log(`   Signature: ${r.entity.signature.substring(0, 80)}${r.entity.signature.length > 80 ? '...' : ''}`);
    }

    // Show CONSUMES (the enrichment context!)
    if ((r.entity as any).consumes && (r.entity as any).consumes.length > 0) {
      const consumes = (r.entity as any).consumes;
      console.log(`   📦 Uses: ${consumes.slice(0, 5).join(', ')}${consumes.length > 5 ? ` +${consumes.length - 5} more` : ''}`);
    } else {
      console.log(`   📦 Uses: (none)`);
    }

    // Show code snippet (check if "neo4j" appears)
    if (r.entity.source) {
      const snippet = r.entity.source.substring(0, 200);
      const hasNeo4j = /neo4j/i.test(r.entity.source);
      console.log(`   Code snippet (${hasNeo4j ? '✅ contains "neo4j"' : '❌ NO "neo4j" in code'}):`);
      console.log('   ' + snippet.split('\n').slice(0, 3).map(line => line.substring(0, 70)).join('\n   '));
    }

    console.log();
  });

  console.log('='.repeat(80));
  console.log('📈 Analysis of CONSUMES Enrichment Impact');
  console.log('='.repeat(80));

  const scopesWithNeo4jInCode = results.filter(r =>
    /neo4j/i.test(r.entity.source || '')
  );
  const scopesWithNeo4jInConsumes = results.filter(r =>
    (r.entity as any).consumes?.some((c: string) => /neo4j/i.test(c))
  );
  const scopesFoundViaConsumesOnly = scopesWithNeo4jInConsumes.filter(r =>
    !/neo4j/i.test(r.entity.source || '')
  );

  console.log(`\n📊 Statistics:`);
  console.log(`  • Total results: ${results.length}`);
  console.log(`  • Scopes with "neo4j" in CODE: ${scopesWithNeo4jInCode.length}`);
  console.log(`  • Scopes with "neo4j" in CONSUMES: ${scopesWithNeo4jInConsumes.length}`);
  console.log(`  • Scopes found ONLY via CONSUMES: ${scopesFoundViaConsumesOnly.length} ⭐`);

  if (scopesFoundViaConsumesOnly.length > 0) {
    console.log(`\n✅ SUCCESS! Found ${scopesFoundViaConsumesOnly.length} relevant scopes that would have been MISSED without CONSUMES enrichment:`);
    scopesFoundViaConsumesOnly.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.entity.name} - Uses: ${(r.entity as any).consumes.filter((c: string) => /neo4j/i.test(c)).join(', ')}`);
    });
  } else {
    console.log(`\n⚠️  No scopes found via CONSUMES only. This might mean:`);
    console.log(`  - All relevant code explicitly mentions "neo4j"`);
    console.log(`  - Or the query wasn't well matched to CONSUMES context`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎯 Next: Manual Verification');
  console.log('='.repeat(80));
  console.log('\nPlease review the results above and evaluate:');
  console.log('1. Are the results semantically relevant to the query?');
  console.log('2. Are there false positives (irrelevant results)?');
  console.log('3. Do CONSUMES help find relevant code that would be missed?');
  console.log('4. Is the ranking order logical?\n');

  await rag.close();
}

main().catch(console.error);
