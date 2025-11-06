/**
 * Example usage of @ragforge/runtime
 *
 * This example queries the LR_CodeRag Neo4j database
 */

import { createClient } from './src/index.js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from LR_CodeRag root
dotenv.config({ path: resolve(process.cwd(), '../../../.env') });
dotenv.config({ path: resolve(process.cwd(), '../../../.env.local') });

interface Scope {
  uuid: string;
  name: string;
  type: string;
  signature?: string;
  file: string;
  startLine: number;
  endLine: number;
  docstring?: string;
}

async function main() {
  console.log('🚀 @ragforge/runtime Example\n');

  // Create RAG client
  const rag = createClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Verify connection
  console.log('📡 Checking Neo4j connection...');
  const isHealthy = await rag.ping();
  if (!isHealthy) {
    console.error('❌ Failed to connect to Neo4j');
    process.exit(1);
  }
  console.log('✅ Connected to Neo4j\n');

  // Example 1: Simple query
  console.log('📝 Example 1: Find all functions');
  console.log('─'.repeat(50));

  const functions = await rag.query<Scope>('Scope')
    .where({ type: 'function' })
    .limit(5)
    .execute();

  console.log(`Found ${functions.length} functions:`);
  functions.forEach(result => {
    console.log(`  - ${result.entity.name} (${result.entity.file}:${result.entity.startLine})`);
  });
  console.log();

  // Example 2: Query with string operators
  console.log('📝 Example 2: Find scopes in ingest files');
  console.log('─'.repeat(50));

  const ingestScopes = await rag.query<Scope>('Scope')
    .where({
      file: { contains: 'ingest' }
    })
    .limit(5)
    .execute();

  console.log(`Found ${ingestScopes.length} scopes in ingest files:`);
  ingestScopes.forEach(result => {
    console.log(`  - ${result.entity.name} (${result.entity.type})`);
    console.log(`    ${result.entity.signature || 'no signature'}`);
  });
  console.log();

  // Example 3: Query with numeric operators
  console.log('📝 Example 3: Find large functions (>100 lines)');
  console.log('─'.repeat(50));

  const largeFunctions = await rag.query<Scope>('Scope')
    .where({
      type: 'function',
      startLine: { gte: 1 }
    })
    .limit(5)
    .execute();

  console.log(`Found ${largeFunctions.length} large functions:`);
  largeFunctions.forEach(result => {
    const loc = result.entity.endLine - result.entity.startLine;
    console.log(`  - ${result.entity.name}: ${loc} lines`);
  });
  console.log();

  // Example 4: Get count
  console.log('📝 Example 4: Count entities');
  console.log('─'.repeat(50));

  const totalScopes = await rag.query('Scope').count();
  const totalFunctions = await rag.query('Scope').where({ type: 'function' }).count();
  const totalClasses = await rag.query('Scope').where({ type: 'class' }).count();

  console.log(`Total scopes: ${totalScopes}`);
  console.log(`Total functions: ${totalFunctions}`);
  console.log(`Total classes: ${totalClasses}`);
  console.log();

  // Example 5: Query with expansion (relationships)
  console.log('📝 Example 5: Find scopes with their dependencies');
  console.log('─'.repeat(50));

  const scopesWithDeps = await rag.query<Scope>('Scope')
    .where({ type: 'function' })
    .expand('CONSUMES', { depth: 1 })
    .limit(3)
    .execute();

  console.log(`Found ${scopesWithDeps.length} scopes with dependencies:`);
  scopesWithDeps.forEach(result => {
    console.log(`  - ${result.entity.name}`);
    const relatedCount = result.context?.related?.length || 0;
    console.log(`    Dependencies: ${relatedCount} scopes`);
    if (result.context?.related) {
      result.context.related.slice(0, 3).forEach(rel => {
        console.log(`      → ${rel.entity.name}`);
      });
    }
  });
  console.log();

  // Example 6: Explain query
  console.log('📝 Example 6: Explain query execution plan');
  console.log('─'.repeat(50));

  const plan = await rag.query('Scope')
    .where({ type: 'function', file: { contains: 'auth' } })
    .explain();

  console.log('Cypher query:');
  console.log(plan.cypher);
  console.log('\nParameters:', plan.params);
  if (plan.indexesUsed && plan.indexesUsed.length > 0) {
    console.log('Indexes used:', plan.indexesUsed);
  }
  console.log();

  // Example 7: Raw Cypher
  console.log('📝 Example 7: Raw Cypher query');
  console.log('─'.repeat(50));

  const rawResult = await rag.raw(`
    MATCH (s:Scope)
    WHERE s.type = $type
    RETURN s.name AS name, s.file AS file
    LIMIT 5
  `, { type: 'function' });

  console.log('Results from raw query:');
  rawResult.records.forEach(record => {
    console.log(`  - ${record.get('name')} (${record.get('file')})`);
  });
  console.log();

  // Close connection
  console.log('👋 Closing connection...');
  await rag.close();
  console.log('✅ Done!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
