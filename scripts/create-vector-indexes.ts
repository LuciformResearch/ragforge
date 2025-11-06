/**
 * Create vector indexes in Neo4j for dual embeddings
 */

import neo4j from 'neo4j-driver';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🔧 Creating Vector Indexes in Neo4j\n');

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || ''
    )
  );

  const session = driver.session({ database: 'neo4j' });

  try {
    // 1. Drop existing indexes if they exist
    console.log('🗑️  Dropping existing vector indexes (if any)...\n');

    try {
      await session.run('DROP INDEX scopeEmbeddingsSignature IF EXISTS');
      console.log('  ✓ Dropped scopeEmbeddingsSignature');
    } catch (e) {
      // Index might not exist
    }

    try {
      await session.run('DROP INDEX scopeEmbeddingsSource IF EXISTS');
      console.log('  ✓ Dropped scopeEmbeddingsSource');
    } catch (e) {
      // Index might not exist
    }

    try {
      await session.run('DROP INDEX scopeEmbeddings IF EXISTS');
      console.log('  ✓ Dropped old scopeEmbeddings');
    } catch (e) {
      // Index might not exist
    }

    console.log('');

    // 2. Create signature embeddings index
    console.log('📊 Creating scopeEmbeddingsSignature index...');

    await session.run(`
      CREATE VECTOR INDEX scopeEmbeddingsSignature IF NOT EXISTS
      FOR (s:Scope)
      ON s.embedding_signature
      OPTIONS {
        indexConfig: {
          \`vector.dimensions\`: 768,
          \`vector.similarity_function\`: 'cosine'
        }
      }
    `);

    console.log('  ✅ scopeEmbeddingsSignature created');
    console.log('     - Node label: Scope');
    console.log('     - Property: embedding_signature');
    console.log('     - Dimensions: 768');
    console.log('     - Similarity: cosine\n');

    // 3. Create source embeddings index
    console.log('📊 Creating scopeEmbeddingsSource index...');

    await session.run(`
      CREATE VECTOR INDEX scopeEmbeddingsSource IF NOT EXISTS
      FOR (s:Scope)
      ON s.embedding_source
      OPTIONS {
        indexConfig: {
          \`vector.dimensions\`: 768,
          \`vector.similarity_function\`: 'cosine'
        }
      }
    `);

    console.log('  ✅ scopeEmbeddingsSource created');
    console.log('     - Node label: Scope');
    console.log('     - Property: embedding_source');
    console.log('     - Dimensions: 768');
    console.log('     - Similarity: cosine\n');

    // 4. Verify indexes
    console.log('🔍 Verifying indexes...\n');

    const result = await session.run(`
      SHOW INDEXES
      YIELD name, type, labelsOrTypes, properties, options
      WHERE type = 'VECTOR'
      RETURN name, labelsOrTypes, properties, options
    `);

    if (result.records.length > 0) {
      console.log('✅ Vector indexes found:');
      result.records.forEach(record => {
        const name = record.get('name');
        const labels = record.get('labelsOrTypes');
        const props = record.get('properties');
        console.log(`   - ${name} on ${labels.join(', ')} (${props.join(', ')})`);
      });
    } else {
      console.log('⚠️  No vector indexes found');
    }

    console.log('');
    console.log('✅ Index creation complete!\n');
    console.log('🎯 Next step: Run reindexing script to generate embeddings');
    console.log('   npx tsx scripts/reindex-embeddings.ts');
    console.log('');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
