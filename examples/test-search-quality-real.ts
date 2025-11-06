/**
 * Test search quality on ACTUAL indexed content (LR_CodeRag project)
 *
 * This tests realistic search scenarios on the code that's actually in Neo4j
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔬 RAG Search Quality Analysis - LR_CodeRag Project\n');
  console.log('Testing realistic search scenarios on ACTUAL indexed content\n');
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
  // Scenario 1: "How do I parse TypeScript/Python files?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 1: Finding code parsers');
  console.log('─'.repeat(80));
  console.log('User question: "How do I parse TypeScript and Python files?"');
  console.log('Expected: TypeScriptParser, PythonParser classes and their methods\n');

  const parserResults = await rag.scope()
    .semanticSearchBySource('parse typescript python extract ast syntax tree', { topK: 10 })
    .execute();

  console.log(`Found ${parserResults.length} results:\n`);
  parserResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 2: "How does the daemon watch for file changes?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 2: Understanding file watching');
  console.log('─'.repeat(80));
  console.log('User question: "How does the daemon detect file changes?"');
  console.log('Expected: ChangeDetector class, file watching logic\n');

  const daemonResults = await rag.scope()
    .semanticSearchBySource('watch file changes detect modifications daemon', { topK: 10 })
    .execute();

  console.log(`Found ${daemonResults.length} results:\n`);
  daemonResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 3: "How do I get scope context and dependencies?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 3: Getting scope context');
  console.log('─'.repeat(80));
  console.log('User question: "How do I get the context and dependencies of a scope?"');
  console.log('Expected: getScopeContext, getScopeCallstack, related functions\n');

  const contextResults = await rag.scope()
    .semanticSearchBySource('scope context dependencies call stack usage', { topK: 10 })
    .execute();

  console.log(`Found ${contextResults.length} results:\n`);
  contextResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 4: "How is scope data stored in Neo4j?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 4: Neo4j storage');
  console.log('─'.repeat(80));
  console.log('User question: "How is scope data ingested into Neo4j?"');
  console.log('Expected: ingestXmlToNeo4j, buildScopeGraph, Neo4j operations\n');

  const neo4jResults = await rag.scope()
    .semanticSearchBySource('neo4j ingest store graph database persist', { topK: 10 })
    .execute();

  console.log(`Found ${neo4jResults.length} results:\n`);
  neo4jResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 5: "How do I build the scope graph from source files?"
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 5: Building scope graph');
  console.log('─'.repeat(80));
  console.log('User question: "How is the scope graph built from source code?"');
  console.log('Expected: buildScopeGraph, buildXmlScopes, parsing pipeline\n');

  const buildResults = await rag.scope()
    .semanticSearchBySource('build scope graph analyze source code extract', { topK: 10 })
    .execute();

  console.log(`Found ${buildResults.length} results:\n`);
  buildResults.slice(0, 5).forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 6: Test relationship filtering
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 6: Find consumers of TypeScriptParser');
  console.log('─'.repeat(80));
  console.log('User question: "What code uses the TypeScriptParser?"');
  console.log('Expected: Scripts or modules that import/use TypeScriptParser\n');

  const consumerResults = await rag.scope()
    .whereConsumesScope('TypeScriptParser')
    .semanticSearchBySource('parse analyze typescript code', { topK: 20 })
    .limit(5)
    .execute();

  console.log(`Found ${consumerResults.length} results:\n`);
  consumerResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Scenario 7: Signature vs Source for class methods
  // ═══════════════════════════════════════════════════════════════════

  console.log('\n📋 SCENARIO 7: Signature vs Source search for methods');
  console.log('─'.repeat(80));
  console.log('Testing: Find methods related to "extract function parameters"');

  console.log('\nUsing SIGNATURE search:');
  const sigResults = await rag.scope()
    .semanticSearchBySignature('extract parameters function method', { topK: 5 })
    .execute();

  sigResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  console.log('Using SOURCE search:');
  const srcResults = await rag.scope()
    .semanticSearchBySource('extract parameters function method', { topK: 5 })
    .execute();

  srcResults.forEach((result, i) => {
    console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
    console.log(`   Type: ${result.entity.type}`);
    console.log(`   File: ${result.entity.file}`);
    console.log('');
  });

  await rag.close();

  console.log('═'.repeat(80));
  console.log('\n💭 NEXT STEP: Manual codebase exploration');
  console.log('I will now explore the codebase manually to verify these results\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
