/**
 * Test search quality and compare with manual exploration
 *
 * This script tests various realistic search scenarios and analyzes
 * whether the semantic search results are truly relevant.
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔬 RAG Search Quality Analysis\n');
  console.log('Testing realistic search scenarios and comparing with manual exploration\n');
  console.log('═'.repeat(80));

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 1: "I want to understand how configuration is loaded"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 1: Understanding configuration loading');
  console.log('─'.repeat(80));
  console.log('User question: "How does this codebase load configuration?"');
  console.log('Expected: Should find env loading, config parsing, validation functions\n');

  const configResults = await rag.scope()
    .semanticSearchBySource('load configuration environment variables setup', { topK: 10 })
    .execute();

  console.log(`Found ${configResults.length} results:\n`);
  configResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    if (result.entity.signature) {
      console.log(`   Signature: ${result.entity.signature.substring(0, 80)}...`);
    }
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 2: "I need to understand database operations"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 2: Understanding database operations');
  console.log('─'.repeat(80));
  console.log('User question: "How do I run queries against Neo4j?"');
  console.log('Expected: Neo4jClient, query methods, connection handling\n');

  const dbResults = await rag.scope()
    .semanticSearchBySource('neo4j database query execution connection', { topK: 10 })
    .execute();

  console.log(`Found ${dbResults.length} results:\n`);
  dbResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 3: "I want to add semantic search to my queries"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 3: Adding semantic search');
  console.log('─'.repeat(80));
  console.log('User question: "How do I do vector/semantic search?"');
  console.log('Expected: VectorSearch class, embedding methods, similarity search\n');

  const vectorResults = await rag.scope()
    .semanticSearchBySource('vector embedding similarity semantic search', { topK: 10 })
    .execute();

  console.log(`Found ${vectorResults.length} results:\n`);
  vectorResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 4: "What uses the QueryBuilder?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 4: Finding consumers of QueryBuilder');
  console.log('─'.repeat(80));
  console.log('User question: "What code uses QueryBuilder? Show me examples"');
  console.log('Expected: Generated query classes, test files\n');

  const qbResults = await rag.scope()
    .whereConsumesScope('QueryBuilder')
    .semanticSearchBySource('query builder usage examples', { topK: 20 })
    .limit(5)
    .execute();

  console.log(`Found ${qbResults.length} results:\n`);
  qbResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 5: "What does VectorSearch depend on?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 5: Understanding VectorSearch dependencies');
  console.log('─'.repeat(80));
  console.log('User question: "What does VectorSearch need to work?"');
  console.log('Expected: Neo4jClient, embedding service, config\n');

  const vsDepResults = await rag.scope()
    .whereConsumedByScope('VectorSearch')
    .semanticSearchBySource('client service dependency injection', { topK: 20 })
    .limit(5)
    .execute();

  console.log(`Found ${vsDepResults.length} results:\n`);
  vsDepResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 6: Signature vs Source search comparison
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 6: Signature vs Source search');
  console.log('─'.repeat(80));
  console.log('Testing: Search for "database connection" using both indexes\n');

  console.log('Using SIGNATURE search:');
  const sigResults = await rag.scope()
    .semanticSearchBySignature('database connection neo4j client', { topK: 5 })
    .execute();

  sigResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Signature: ${result.entity.signature?.substring(0, 80)}...`);
    console.log('');
  });

  console.log('\nUsing SOURCE search:');
  const srcResults = await rag.scope()
    .semanticSearchBySource('database connection neo4j client', { topK: 5 })
    .execute();

  srcResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 7: Complex workflow understanding
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 7: Understanding a complete workflow');
  console.log('─'.repeat(80));
  console.log('User question: "How does a query get executed from start to finish?"');
  console.log('Expected: QueryBuilder -> build -> execute -> Neo4jClient -> results\n');

  const workflowResults = await rag.scope()
    .semanticSearchBySource('query execution pipeline build execute results', { topK: 10 })
    .execute();

  console.log(`Found ${workflowResults.length} results:\n`);
  workflowResults.slice(0, 7).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  await rag.close();

  console.log('═'.repeat(80));
  console.log('\n💭 ANALYSIS NOTES:');
  console.log('');
  console.log('After running these scenarios, I will:');
  console.log('1. Manually explore the codebase to find what SHOULD be returned');
  console.log('2. Compare with what WAS actually returned');
  console.log('3. Identify gaps, irrelevant results, and missed relevant code');
  console.log('4. Suggest improvements to the search strategy');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
