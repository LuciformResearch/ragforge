/**
 * Inspect Missing Scope - Deep Dive
 *
 * Analyze why getNeo4jDriver doesn't appear in semantic search
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔬 Deep Inspection: getNeo4jDriver\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // 1. Fetch the scope directly
  console.log('='.repeat(80));
  console.log('1️⃣  Direct Fetch (by name)');
  console.log('='.repeat(80));

  const direct = await rag.scope()
    .whereName('getNeo4jDriver')
    .execute();

  if (direct.length === 0) {
    console.log('❌ Scope not found!');
    await rag.close();
    return;
  }

  const scope = direct[0].entity;
  console.log(`\nFound: ${scope.name}`);
  console.log(`File: ${scope.file}`);
  console.log(`Type: ${scope.type}`);
  console.log(`\nSignature:\n${scope.signature}`);
  console.log(`\nSource (${scope.source?.length || 0} chars):\n${scope.source}`);

  if ((scope as any).consumes) {
    console.log(`\nUses: ${(scope as any).consumes.join(', ')}`);
  } else {
    console.log(`\nUses: (none)`);
  }

  console.log(`\nHas embedding_signature? ${!!scope.embedding_signature}`);
  console.log(`Has embedding_source? ${!!scope.embedding_source}`);

  if (scope.embedding_source) {
    console.log(`Embedding_source dimension: ${scope.embedding_source.length}`);
  }

  // 2. Test semantic search with NO minScore filter
  console.log('\n' + '='.repeat(80));
  console.log('2️⃣  Semantic Search (NO minScore filter)');
  console.log('='.repeat(80));

  const semantic = await rag.scope()
    .semanticSearchBySource('neo4j database connection setup', {
      topK: 100,
      minScore: 0.0  // ← No filtering!
    })
    .execute();

  const index = semantic.findIndex(r => r.entity.name === 'getNeo4jDriver');

  if (index >= 0) {
    console.log(`\n✅ FOUND at rank #${index + 1} / ${semantic.length}`);
    console.log(`Score: ${semantic[index].score.toFixed(4)}`);

    if (index > 20) {
      console.log(`\n⚠️  Very low rank! Scores around it:`);
      semantic.slice(Math.max(0, index - 2), index + 3).forEach((r, i) => {
        const marker = r.entity.name === 'getNeo4jDriver' ? '→' : ' ';
        console.log(`${marker} #${index - 2 + i + 1}: ${r.entity.name.padEnd(30)} ${r.score.toFixed(4)}`);
      });
    }
  } else {
    console.log(`\n❌ NOT FOUND even with minScore=0.0!`);
    console.log(`\nTop 10 for comparison:`);
    semantic.slice(0, 10).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.entity.name.padEnd(30)} ${r.score.toFixed(4)}`);
    });
  }

  // 3. Compare with similar scopes
  console.log('\n' + '='.repeat(80));
  console.log('3️⃣  Comparison with Similar Scopes');
  console.log('='.repeat(80));

  const similarScopes = ['createNeo4jDriver', 'getNeo4jSession', 'getNeo4jConfig'];

  for (const name of similarScopes) {
    const similar = await rag.scope().whereName(name).execute();
    if (similar.length > 0) {
      const s = similar[0].entity;
      const idx = semantic.findIndex(r => r.entity.name === name);

      console.log(`\n${name}:`);
      console.log(`  Source length: ${s.source?.length || 0} chars`);
      console.log(`  Uses: ${(s as any).consumes?.join(', ') || '(none)'}`);
      if (idx >= 0) {
        console.log(`  Semantic rank: #${idx + 1} (score: ${semantic[idx].score.toFixed(4)})`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎯 Conclusion');
  console.log('='.repeat(80));
  console.log('\nCompare getNeo4jDriver vs createNeo4jDriver:');
  console.log('- Both create/return a Driver');
  console.log('- createNeo4jDriver: explicit setup code');
  console.log('- getNeo4jDriver: singleton pattern wrapper');
  console.log('\nHypothesis: Short wrapper functions score lower than implementation functions');

  await rag.close();
}

main().catch(console.error);
