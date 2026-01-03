/**
 * Test Kuzu integration end-to-end
 *
 * Tests: schema creation, node/relationship ingestion, embeddings, search
 */

import { BrainManager } from '../packages/core/src/brain/brain-manager.js';
import path from 'path';

async function main() {
  console.log('=== Testing Kuzu Full Integration ===\n');

  // Force a fresh BrainManager instance
  const brain = await BrainManager.getInstance();

  // IMPORTANT: Initialize loads config from ~/.ragforge/config.yaml
  console.log('Initializing BrainManager...');
  await brain.initialize();

  // Get the database provider being used
  const config = (brain as any).config;
  console.log('Database provider:', config?.databaseProvider || 'neo4j (default)');
  console.log('Kuzu path:', config?.kuzu?.path || '~/.ragforge/kuzu');

  if (config?.databaseProvider !== 'kuzu') {
    console.error('\n❌ Config says databaseProvider is not kuzu!');
    console.log('Edit ~/.ragforge/config.yaml and set: databaseProvider: kuzu');
    process.exit(1);
  }

  console.log('\n--- 1. Testing ingestDirectory ---');
  const testDir = path.join(process.cwd(), 'packages/core/src/utils');

  try {
    // quickIngest(path: string, options: QuickIngestOptions)
    const result = await brain.quickIngest(testDir, {
      generateEmbeddings: true,
    });

    console.log('Ingest result:', JSON.stringify(result, null, 2).slice(0, 1000));
  } catch (err: any) {
    console.error('Ingest failed:', err.message);
    console.error(err.stack);
  }

  console.log('\n--- 2. Testing brain search ---');
  try {
    // search(query: string, options: BrainSearchOptions)
    const searchResult = await brain.search('schema definition', {
      limit: 5,
      semantic: false, // Text search first
    });

    console.log(`Found ${searchResult.results?.length || 0} results`);
    for (const r of searchResult.results?.slice(0, 3) || []) {
      console.log(`  - ${r.node?.name || r.filePath} (${r.node?.type || 'unknown'}) score: ${r.score?.toFixed(3)}`);
    }
  } catch (err: any) {
    console.error('Search failed:', err.message);
  }

  console.log('\n--- 3. Testing semantic search ---');
  try {
    const semanticResult = await brain.search('how to create nodes in the graph', {
      limit: 5,
      semantic: true,
    });

    console.log(`Found ${semanticResult.results?.length || 0} semantic results`);
    for (const r of semanticResult.results?.slice(0, 3) || []) {
      console.log(`  - ${r.node?.name || r.filePath} (${r.node?.type || 'unknown'}) score: ${r.score?.toFixed(3)}`);
    }
  } catch (err: any) {
    console.error('Semantic search failed:', err.message);
  }

  console.log('\n--- 4. Listing projects ---');
  try {
    const projects = await brain.listProjects();
    console.log(`Found ${projects.length} projects:`);
    for (const p of projects) {
      console.log(`  - ${p.projectId} (${p.type || 'unknown'})`);
    }
  } catch (err: any) {
    console.error('List projects failed:', err.message);
  }

  console.log('\n=== Test Complete ===');

  // Shutdown cleanly
  await brain.shutdown();
}

main().catch(console.error);
