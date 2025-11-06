/**
 * Semantic search on related scopes
 *
 * Example: Find all scopes that consume a given scope, then search semantically among them
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔍 Semantic Search on Related Scopes\n');

  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  const targetScope = 'loadEnvironment';

  // ═══════════════════════════════════════════════════════════════════
  // Use Case 1: Semantic search on CONSUMERS of a scope
  // ═══════════════════════════════════════════════════════════════════

  console.log(`1️⃣ Find consumers of "${targetScope}" and search them semantically`);
  console.log('─'.repeat(70));

  // Step 1: Get the target scope with its consumers
  const scopeWithConsumers = await rag.scope()
    .whereName(targetScope)
    .withConsumedBy(1)
    .execute();

  if (scopeWithConsumers.length === 0) {
    console.log('⚠️  Scope not found');
  } else {
    const consumers = scopeWithConsumers[0].context?.related?.filter(
      (r: any) => r.relationshipType === 'CONSUMED_BY'
    ) || [];

    console.log(`Found ${consumers.length} consumers:\n`);

    // Extract consumer UUIDs
    const consumerUuids = consumers.map((c: any) => c.entity.uuid);

    if (consumerUuids.length > 0) {
      // Step 2: Semantic search among these consumers
      // Use raw Cypher to filter by UUID list + do semantic search
      const semanticQuery = 'configuration and setup code';

      console.log(`Semantic search query: "${semanticQuery}"`);
      console.log(`Searching among ${consumerUuids.length} consumers...\n`);

      // For now, we filter by UUID then do semantic search
      // This is a workaround - ideally we'd have a `.whereUuidIn(uuids)` method

      // Alternative: Do semantic search on all scopes, then filter results
      const allResults = await rag.scope()
        .semanticSearchBySource(semanticQuery, { topK: 50 })
        .execute();

      // Filter to only include consumers
      const matchingConsumers = allResults.filter(r =>
        consumerUuids.includes(r.entity.uuid)
      ).slice(0, 5);

      console.log(`Found ${matchingConsumers.length} matching consumers:\n`);
      matchingConsumers.forEach((result, i) => {
        console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
        console.log(`   File: ${result.entity.file}`);
        console.log(`   Type: ${result.entity.type}`);
        console.log('');
      });
    } else {
      console.log('No consumers found\n');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Use Case 2: Semantic search on DEPENDENCIES of a scope
  // ═══════════════════════════════════════════════════════════════════

  console.log(`\n2️⃣ Find dependencies of "${targetScope}" and search them semantically`);
  console.log('─'.repeat(70));

  // Step 1: Get the target scope with its dependencies
  const scopeWithDeps = await rag.scope()
    .whereName(targetScope)
    .withConsumes(1)
    .execute();

  if (scopeWithDeps.length === 0) {
    console.log('⚠️  Scope not found');
  } else {
    const dependencies = scopeWithDeps[0].context?.related?.filter(
      (r: any) => r.relationshipType === 'CONSUMES'
    ) || [];

    console.log(`Found ${dependencies.length} dependencies:\n`);

    const depUuids = dependencies.map((d: any) => d.entity.uuid);

    if (depUuids.length > 0) {
      const semanticQuery = 'path resolution and file system utilities';

      console.log(`Semantic search query: "${semanticQuery}"`);
      console.log(`Searching among ${depUuids.length} dependencies...\n`);

      const allResults = await rag.scope()
        .semanticSearchBySource(semanticQuery, { topK: 50 })
        .execute();

      const matchingDeps = allResults.filter(r =>
        depUuids.includes(r.entity.uuid)
      ).slice(0, 5);

      console.log(`Found ${matchingDeps.length} matching dependencies:\n`);
      matchingDeps.forEach((result, i) => {
        console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
        console.log(`   File: ${result.entity.file}`);
        console.log(`   Type: ${result.entity.type}`);
        console.log('');
      });
    } else {
      console.log('No dependencies found\n');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Use Case 3: Better approach with raw Cypher (more efficient)
  // ═══════════════════════════════════════════════════════════════════

  console.log(`\n3️⃣ Optimized approach: Direct Cypher + Semantic Search`);
  console.log('─'.repeat(70));

  // Get consumers using raw Cypher
  const consumersResult = await (rag as any).runtime.raw(`
    MATCH (source:Scope {name: $sourceName})
    MATCH (consumer:Scope)-[:CONSUMES]->(source)
    RETURN consumer.uuid AS uuid, consumer.name AS name
  `, { sourceName: targetScope });

  const consumerUuids = consumersResult.records.map((r: any) => r.get('uuid'));
  console.log(`Found ${consumerUuids.length} consumers via Cypher\n`);

  if (consumerUuids.length > 0) {
    // Do semantic search on all, then filter
    const semanticQuery = 'configuration and environment variables';

    const allResults = await rag.scope()
      .semanticSearchBySource(semanticQuery, { topK: 100 })
      .execute();

    const matchingConsumers = allResults.filter(r =>
      consumerUuids.includes(r.entity.uuid)
    ).slice(0, 5);

    console.log(`Semantic query: "${semanticQuery}"`);
    console.log(`Matching consumers: ${matchingConsumers.length}\n`);

    matchingConsumers.forEach((result, i) => {
      console.log(`${i + 1}. ${result.entity.name} (score: ${result.score.toFixed(3)})`);
      console.log(`   File: ${result.entity.file}`);
      console.log('');
    });
  }

  await rag.close();

  console.log('═'.repeat(70));
  console.log('💡 Summary\n');
  console.log('Two approaches for semantic search on related scopes:');
  console.log('');
  console.log('1. Using existing API:');
  console.log('   - Get scope with .withConsumes() or .withConsumedBy()');
  console.log('   - Extract UUIDs from context.related');
  console.log('   - Do semantic search, filter by UUIDs');
  console.log('');
  console.log('2. Using raw Cypher (more efficient):');
  console.log('   - Query relationships with raw Cypher');
  console.log('   - Get UUIDs of related scopes');
  console.log('   - Do semantic search, filter by UUIDs');
  console.log('');
  console.log('Future improvement: Add .whereUuidIn(uuids) to QueryBuilder');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
