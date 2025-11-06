/**
 * Check how many .js files are in Neo4j
 */

import neo4j from 'neo4j-driver';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || ''
    )
  );

  const session = driver.session({ database: 'neo4j' });

  try {
    // Count by extension
    const result = await session.run(`
      MATCH (s:Scope)
      WITH s,
        CASE
          WHEN s.file ENDS WITH '.ts' THEN '.ts'
          WHEN s.file ENDS WITH '.tsx' THEN '.tsx'
          WHEN s.file ENDS WITH '.js' THEN '.js'
          WHEN s.file ENDS WITH '.jsx' THEN '.jsx'
          WHEN s.file ENDS WITH '.py' THEN '.py'
          ELSE 'other'
        END AS extension
      RETURN extension, count(s) AS count
      ORDER BY count DESC
    `);

    console.log('📊 Scopes by file extension:\n');
    result.records.forEach(record => {
      const ext = record.get('extension');
      const count = record.get('count').toNumber();
      console.log(`  ${ext.padEnd(10)} ${count} scopes`);
    });

    console.log('');

    // Show sample .js files
    const jsResult = await session.run(`
      MATCH (s:Scope)
      WHERE s.file ENDS WITH '.js'
      RETURN DISTINCT s.file AS file
      ORDER BY s.file
      LIMIT 20
    `);

    if (jsResult.records.length > 0) {
      console.log('📁 Sample .js files in database:\n');
      jsResult.records.forEach((record, i) => {
        console.log(`  ${i + 1}. ${record.get('file')}`);
      });
      console.log('');
    }

    // Count total
    const totalResult = await session.run(`
      MATCH (s:Scope)
      WHERE s.file ENDS WITH '.js'
      RETURN count(s) AS total
    `);

    const totalJs = totalResult.records[0].get('total').toNumber();

    if (totalJs > 0) {
      console.log(`⚠️  Found ${totalJs} scopes in .js files`);
      console.log('');
      console.log('💡 Options:');
      console.log('   1. Delete them: DELETE all .js scopes from Neo4j');
      console.log('   2. Filter them: Add .whereFile({ endsWith: ".ts" }) to queries');
      console.log('   3. Keep them: They might be generated output files');
      console.log('');
    } else {
      console.log('✅ No .js files found in database');
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main();
