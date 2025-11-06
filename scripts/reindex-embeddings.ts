/**
 * Reindex all scopes with dual embeddings (signature + source)
 */

import neo4j from 'neo4j-driver';
import { VectorSearch } from '../packages/runtime/src/vector/vector-search.js';
import { Neo4jClient } from '../packages/runtime/src/client/neo4j-client.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

/**
 * Split camelCase/PascalCase identifiers into separate words
 * Examples:
 *   getNeo4jDriver -> get Neo4j Driver
 *   Neo4jClient -> Neo4j Client
 *   createNeo4jDriver -> create Neo4j Driver
 */
function splitCamelCase(identifier: string): string {
  // Handle empty or short strings
  if (!identifier || identifier.length <= 1) return identifier;

  // Split on uppercase letters, but keep consecutive uppercase together
  // Examples:
  //   getNeo4jDriver -> get Neo4j Driver
  //   XMLParser -> XML Parser
  //   Neo4jClient -> Neo4j Client
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')  // lowercase followed by uppercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // consecutive uppercase followed by lowercase
    .split(' ');

  // Capitalize first letter of each word
  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function main() {
  console.log('🔄 Reindexing Scopes with Dual Embeddings\n');

  // Connect to Neo4j
  const neo4jClient = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: 'neo4j'
  });

  const vectorSearch = new VectorSearch(neo4jClient);

  try {
    // 1. Get all scopes with their CONSUMES relationships
    console.log('📊 Loading scopes with dependencies from Neo4j...');

    const result = await neo4jClient.run(`
      MATCH (s:Scope)
      OPTIONAL MATCH (s)-[:CONSUMES]->(dep:Scope)
      WITH s, collect(DISTINCT dep.name) AS consumes
      RETURN s.uuid AS uuid,
             s.signature AS signature,
             s.source AS source,
             s.name AS name,
             consumes
      ORDER BY s.name
    `);

    const scopes = result.records.map(r => ({
      uuid: r.get('uuid'),
      signature: r.get('signature') || '',
      source: r.get('source') || '',
      name: r.get('name'),
      consumes: r.get('consumes') || []
    }));

    console.log(`✅ Found ${scopes.length} scopes\n`);

    if (scopes.length === 0) {
      console.log('⚠️  No scopes found. Nothing to reindex.');
      return;
    }

    // 2. Process scopes in parallel batches
    const parallelBatchSize = 40;  // Process 40 scopes at once
    const batches = [];

    for (let i = 0; i < scopes.length; i += parallelBatchSize) {
      batches.push(scopes.slice(i, i + parallelBatchSize));
    }

    console.log(`📦 Processing ${batches.length} batches of up to ${parallelBatchSize} scopes in parallel\n`);

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      console.log(`🔄 Batch ${i + 1}/${batches.length} (${batch.length} scopes in parallel)...`);

      // Process all scopes in batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (scope) => {
          // Skip if no signature or source
          if (!scope.signature && !scope.source) {
            return { status: 'skipped', scope: scope.name };
          }

          // Enrich source with CONSUMES context AND camelCase splitting
          let enrichedSource = scope.source;

          // Build enrichment with tokenized identifiers
          const enrichments: string[] = [];

          // 1. Add scope name with camelCase split
          if (scope.name) {
            const splitName = splitCamelCase(scope.name);
            if (splitName !== scope.name) {
              enrichments.push(`Function: ${splitName}`);
            }
          }

          // 2. Add CONSUMES with camelCase split
          if (scope.consumes && scope.consumes.length > 0) {
            const consumesOriginal = scope.consumes.slice(0, 10).join(', ');
            const consumesSplit = scope.consumes.slice(0, 10)
              .map(dep => splitCamelCase(dep))
              .join(', ');

            enrichments.push(`Uses: ${consumesOriginal}`);

            // Add split version if different to help with tokenization
            if (consumesSplit !== consumesOriginal) {
              enrichments.push(`Uses (expanded): ${consumesSplit}`);
            }
          }

          // Append enrichments to source
          if (scope.source && enrichments.length > 0) {
            enrichedSource = `${scope.source}\n\n${enrichments.join('\n')}`;
          }

          // Generate BOTH embeddings in parallel
          const [signatureEmbedding, sourceEmbedding] = await Promise.all([
            scope.signature ? vectorSearch.generateEmbedding(scope.signature) : Promise.resolve(null),
            enrichedSource ? vectorSearch.generateEmbedding(enrichedSource) : Promise.resolve(null)
          ]);

          // Update Neo4j
          const updates: string[] = [];
          const params: any = { uuid: scope.uuid };

          if (signatureEmbedding) {
            updates.push('s.embedding_signature = $sig_emb');
            params.sig_emb = signatureEmbedding;
          }

          if (sourceEmbedding) {
            updates.push('s.embedding_source = $src_emb');
            params.src_emb = sourceEmbedding;
          }

          if (updates.length > 0) {
            await neo4jClient.run(
              `
              MATCH (s:Scope {uuid: $uuid})
              SET ${updates.join(', ')}
              `,
              params
            );

            return { status: 'success', scope: scope.name, count: updates.length };
          }

          return { status: 'skipped', scope: scope.name };
        })
      );

      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const value = result.value as any;
          if (value.status === 'success') {
            console.log(`  ✅ ${value.scope} - ${value.count} embedding(s)`);
            processed++;
          } else if (value.status === 'skipped') {
            console.log(`  ⏭️  ${value.scope} - skipped`);
            skipped++;
          }
        } else {
          console.log(`  ❌ Error: ${result.reason?.message || 'Unknown error'}`);
          errors++;
        }
      }

      console.log(`  Progress: ${processed + skipped + errors}/${scopes.length}\n`);

      // Small delay between batches to avoid overwhelming the API
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 3. Summary
    console.log('─'.repeat(60));
    console.log('📊 Reindexing Summary\n');
    console.log(`  ✅ Processed: ${processed}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log(`  📝 Total: ${scopes.length}`);
    console.log('');

    // 4. Verify a sample
    console.log('🔍 Verifying sample scope...\n');

    const sampleResult = await neo4jClient.run(`
      MATCH (s:Scope)
      WHERE s.embedding_signature IS NOT NULL
      RETURN s.name AS name,
             size(s.embedding_signature) AS sig_dim,
             size(s.embedding_source) AS src_dim
      LIMIT 1
    `);

    if (sampleResult.records.length > 0) {
      const sample = sampleResult.records[0];
      console.log(`  Scope: ${sample.get('name')}`);
      console.log(`  Signature embedding dimension: ${sample.get('sig_dim') || 'N/A'}`);
      console.log(`  Source embedding dimension: ${sample.get('src_dim') || 'N/A'}`);
    }

    console.log('');
    console.log('✅ Reindexing complete!\n');
    console.log('🎯 Next step: Test semantic search');
    console.log('   npx tsx examples/test-dual-semantic-search.ts');
    console.log('');

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    throw error;
  } finally {
    await neo4jClient.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
