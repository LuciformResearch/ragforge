import { createRagClient } from './client.js';

const client = createRagClient();

try {
  const result = await client.client.run(`
    MATCH (s:Scope)
    RETURN s.uuid, s.name, s.hash, s.contentHash
    LIMIT 5
  `);

  console.log('🔍 Checking hash fields in Scope nodes:\n');
  for (const record of result.records) {
    console.log(`  - ${record.get('s.name')}`);
    console.log(`    hash: ${record.get('s.hash')}`);
    console.log(`    contentHash: ${record.get('s.contentHash')}`);
  }
} catch (error) {
  console.error('Error:', error);
} finally {
  await client.close();
}
