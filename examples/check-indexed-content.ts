/**
 * Check what's actually indexed in Neo4j
 */

import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USER || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  console.log('🔍 Checking indexed content in Neo4j...\n');

  // Get overall stats
  const statsResult = await (rag as any).runtime.raw(`
    MATCH (s:Scope)
    RETURN
      count(DISTINCT s) as totalScopes,
      count(DISTINCT s.file) as totalFiles
  `);

  const stats = statsResult.records[0];
  console.log('📊 Overall Stats:');
  console.log(`  Total Scopes: ${stats.get('totalScopes').toString()}`);
  console.log(`  Total Files: ${stats.get('totalFiles').toString()}`);
  console.log('');

  // Get sample file paths
  const filesResult = await (rag as any).runtime.raw(`
    MATCH (s:Scope)
    RETURN DISTINCT s.file as file
    ORDER BY file
    LIMIT 20
  `);

  console.log('📁 Sample indexed files (first 20):');
  filesResult.records.forEach((r: any) => {
    console.log(`  ${r.get('file')}`);
  });
  console.log('');

  // Get directory breakdown
  const dirsResult = await (rag as any).runtime.raw(`
    MATCH (s:Scope)
    WITH s.file as file
    WITH split(file, '/')[0] as rootDir
    RETURN rootDir, count(*) as count
    ORDER BY count DESC
  `);

  console.log('📂 Directory breakdown:');
  dirsResult.records.forEach((r: any) => {
    console.log(`  ${r.get('rootDir')}: ${r.get('count').toString()} scopes`);
  });
  console.log('');

  // Get scope types
  const typesResult = await (rag as any).runtime.raw(`
    MATCH (s:Scope)
    RETURN s.type as type, count(*) as count
    ORDER BY count DESC
  `);

  console.log('🏷️  Scope types:');
  typesResult.records.forEach((r: any) => {
    console.log(`  ${r.get('type')}: ${r.get('count').toString()}`);
  });

  await rag.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
