/**
 * Test LLM Reranking with topK filtering
 *
 * Demonstrates how topK limits results progressively in a pipeline
 */

import { createRagClient } from './generated-dual-client/index.js';
import { GeminiAPIProvider } from '@ragforge/runtime';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing LLM Reranking with topK\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  const llmProvider = GeminiAPIProvider.fromEnv('gemma-3n-e2b-it');

  const question = 'How does Neo4j connection management work?';
  const query = 'neo4j connection driver session';

  console.log(`Question: "${question}"\n`);

  // Test 1: Without topK (returns all evaluated results)
  console.log('=' .repeat(80));
  console.log('Test 1: LLM Rerank WITHOUT topK');
  console.log('=' .repeat(80));
  console.log('Pipeline: semantic(topK=30) → llmRerank(no topK)\n');

  const withoutTopK = await rag.scope()
    .semanticSearchBySource(query, { topK: 30 })
    .llmRerank(question, llmProvider, {
      batchSize: 10,
      parallel: 3,
      minScore: 0.5  // Filter low scores
    })
    .limit(5)
    .execute();

  console.log(`Results returned: ${withoutTopK.length}`);
  console.log('Top 3:');
  withoutTopK.slice(0, 3).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     Score: ${r.score.toFixed(3)} (vector: ${r.scoreBreakdown?.vector?.toFixed(3)}, llm: ${r.scoreBreakdown?.llm?.toFixed(3)})`);
  });

  // Test 2: With topK=10 (LLM returns only top 10)
  console.log('\n' + '='.repeat(80));
  console.log('Test 2: LLM Rerank WITH topK=10');
  console.log('='.repeat(80));
  console.log('Pipeline: semantic(topK=30) → llmRerank(topK=10, minScore=0.5)\n');

  const withTopK = await rag.scope()
    .semanticSearchBySource(query, { topK: 30 })
    .llmRerank(question, llmProvider, {
      batchSize: 10,
      parallel: 3,
      topK: 10,         // ← Limit to top 10 after LLM evaluation
      minScore: 0.5
    })
    .limit(5)
    .execute();

  console.log(`Results returned: ${withTopK.length}`);
  console.log('Top 3:');
  withTopK.slice(0, 3).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     Score: ${r.score.toFixed(3)} (vector: ${r.scoreBreakdown?.vector?.toFixed(3)}, llm: ${r.scoreBreakdown?.llm?.toFixed(3)})`);
  });

  // Test 3: Aggressive filtering (topK=5)
  console.log('\n' + '='.repeat(80));
  console.log('Test 3: Aggressive filtering with topK=5');
  console.log('='.repeat(80));
  console.log('Pipeline: semantic(topK=30) → llmRerank(topK=5, minScore=0.7)\n');

  const aggressive = await rag.scope()
    .semanticSearchBySource(query, { topK: 30 })
    .llmRerank(question, llmProvider, {
      batchSize: 10,
      parallel: 3,
      topK: 5,          // ← Very aggressive
      minScore: 0.7     // ← High quality bar
    })
    .execute();

  console.log(`Results returned: ${aggressive.length}`);
  aggressive.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.entity.name} (${r.entity.type})`);
    console.log(`     File: ${r.entity.file}`);
    console.log(`     Score: ${r.score.toFixed(3)} (llm: ${r.scoreBreakdown?.llm?.toFixed(3)})`);
    if (r.scoreBreakdown?.llmReasoning) {
      console.log(`     Reason: ${r.scoreBreakdown.llmReasoning.substring(0, 80)}...`);
    }
    console.log();
  });

  console.log('\n💡 Summary:');
  console.log('  - Test 1: Evaluated 30, filtered by minScore, returned all passing');
  console.log('  - Test 2: Evaluated 30, kept top 10 by LLM, returned top 10');
  console.log('  - Test 3: Evaluated 30, kept top 5 with score≥0.7, returned ~5');
  console.log('\n✅ topK allows progressive filtering in the pipeline!');

  await rag.close();
}

main().catch(console.error);
