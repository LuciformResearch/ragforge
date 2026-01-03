/**
 * Test Kuzu quickIngest integration
 */
import { BrainManager } from '../packages/core/dist/esm/brain/brain-manager.js';

async function main() {
  console.log('1. Getting instance and initializing...');
  const brain = await BrainManager.getInstance();
  await brain.initialize();

  console.log('\n2. Quick-ingesting a small directory...');
  const result = await brain.quickIngest(
    '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/utils',
    { projectName: 'test-kuzu' }
  );

  console.log('   Ingestion result:');
  console.log('   - Project ID:', result.projectId);
  console.log('   - Files processed:', result.filesProcessed);
  console.log('   - Scopes found:', result.scopesCreated);
  console.log('   - Duration:', result.durationMs, 'ms');

  console.log('\n3. Listing projects...');
  const projects = await brain.listProjects();
  console.log('   Projects:', projects.length);
  for (const p of projects) {
    console.log('   -', p.name, `(${p.id})`);
  }

  console.log('\n4. Querying nodes...');
  const nodeCount = await brain.runQuery('MATCH (n) RETURN labels(n)[0] as label, count(n) as cnt ORDER BY cnt DESC LIMIT 10');
  console.log('   Node counts:');
  for (const row of nodeCount) {
    console.log(`   - ${row.label}: ${row.cnt}`);
  }

  console.log('\n5. Cleanup...');
  await brain.shutdown();
  console.log('   Done!');
}

main().catch(console.error);
