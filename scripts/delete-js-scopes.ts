/**
 * Delete all .js scopes from Neo4j
 */

import neo4j from 'neo4j-driver';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  console.log('🗑️  Deleting .js scopes from Neo4j\n');

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || ''
    )
  );

  const session = driver.session({ database: 'neo4j' });

  try {
    // Count before
    const beforeResult = await session.run(`
      MATCH (s:Scope)
      WHERE s.file ENDS WITH '.js'
      RETURN count(s) AS total
    `);

    const totalBefore = beforeResult.records[0].get('total').toNumber();

    console.log(`📊 Found ${totalBefore} .js scopes to delete\n`);

    if (totalBefore === 0) {
      console.log('✅ No .js scopes to delete');
      return;
    }

    // Delete scopes and their relationships
    console.log('🗑️  Deleting .js scopes and their relationships...');

    const deleteResult = await session.run(`
      MATCH (s:Scope)
      WHERE s.file ENDS WITH '.js'
      DETACH DELETE s
      RETURN count(s) AS deleted
    `);

    const deleted = deleteResult.records[0]?.get('deleted')?.toNumber() || 0;

    console.log(`✅ Deleted ${deleted} .js scopes\n`);

    // Verify
    const afterResult = await session.run(`
      MATCH (s:Scope)
      RETURN count(s) AS total
    `);

    const totalAfter = afterResult.records[0].get('total').toNumber();

    console.log(`📊 Scopes remaining: ${totalAfter}`);
    console.log(`   Before: ${totalBefore + totalAfter}`);
    console.log(`   Deleted: ${deleted}`);
    console.log(`   After: ${totalAfter}`);
    console.log('');

    // Show extensions
    const extResult = await session.run(`
      MATCH (s:Scope)
      WITH s,
        CASE
          WHEN s.file ENDS WITH '.ts' THEN '.ts'
          WHEN s.file ENDS WITH '.tsx' THEN '.tsx'
          ELSE 'other'
        END AS extension
      RETURN extension, count(s) AS count
      ORDER BY count DESC
    `);

    console.log('📊 Remaining scopes by extension:\n');
    extResult.records.forEach(record => {
      const ext = record.get('extension');
      const count = record.get('count').toNumber();
      console.log(`  ${ext.padEnd(10)} ${count} scopes`);
    });

    console.log('');
    console.log('✅ Cleanup complete!\n');
    console.log('💡 Next steps:');
    console.log('   - Reindex embeddings if needed');
    console.log('   - Update ingestion to exclude .js files');
    console.log('');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
