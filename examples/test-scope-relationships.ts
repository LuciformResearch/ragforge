/**
 * Test scope relationship queries
 * Find all scopes that consume/are consumed by a given scope
 */

import { createRagClient } from './generated-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Testing Scope Relationship Queries\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Pick a scope to analyze (loadEnvironment function)
  const targetScope = 'loadEnvironment';

  console.log(`📌 Analyzing scope: "${targetScope}"\n`);

  // 1. Find all scopes consumed by this scope (dependencies)
  console.log('1️⃣ Finding dependencies (scopes consumed by this scope):');
  console.log('─'.repeat(70));

  const dependencies = await rag.scope()
    .whereName(targetScope)
    .withConsumes(1)
    .execute();

  if (dependencies.length > 0) {
    console.log(`Found ${dependencies.length} result(s):`);
    dependencies.forEach(result => {
      console.log(`\n  Main scope: ${result.entity.name}`);
      if (result.context?.related && result.context.related.length > 0) {
        console.log(`  Dependencies (${result.context.related.length}):`);
        result.context.related.forEach((dep: any) => {
          console.log(`    → ${dep.entity.name} (${dep.entity.type})`);
        });
      } else {
        console.log('  No dependencies found');
      }
    });
  } else {
    console.log('No results found');
  }
  console.log();

  // 2. Find all scopes that consume this scope (consumers/usages)
  console.log('2️⃣ Finding consumers (scopes that consume this scope):');
  console.log('─'.repeat(70));

  const consumers = await rag.scope()
    .whereName(targetScope)
    .withConsumedBy(1)
    .execute();

  if (consumers.length > 0) {
    console.log(`Found ${consumers.length} result(s):`);
    consumers.forEach(result => {
      console.log(`\n  Main scope: ${result.entity.name}`);
      if (result.context?.related && result.context.related.length > 0) {
        console.log(`  Consumers (${result.context.related.length}):`);
        result.context.related.forEach((consumer: any) => {
          console.log(`    ← ${consumer.entity.name} (${consumer.entity.type})`);
        });
      } else {
        console.log('  No consumers found');
      }
    });
  } else {
    console.log('No results found');
  }
  console.log();

  // 3. Alternative: Direct Cypher query for comparison
  console.log('3️⃣ Direct query (for comparison - using raw Cypher):');
  console.log('─'.repeat(70));

  const directDeps = await rag.scope()
    .whereName(targetScope)
    .execute();

  if (directDeps.length > 0) {
    console.log(`Scope: ${directDeps[0].entity.name}`);
    console.log(`Type: ${directDeps[0].entity.type}`);
    console.log(`File: ${directDeps[0].entity.file}`);
  }
  console.log();

  await rag.close();
  console.log('✅ Test completed!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
