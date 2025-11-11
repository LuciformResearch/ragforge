import { createRagClient } from './client.js';

const client = createRagClient();

try {
  const result = await client.client.run('MATCH (s:Scope) RETURN count(s) as scopeCount');
  const count = result.records[0].get('scopeCount').toNumber();
  console.log(`📊 Scopes in database: ${count}`);

  if (count > 0) {
    const sample = await client.client.run('MATCH (s:Scope) RETURN s.uuid, s.name, s.contentHash LIMIT 3');
    console.log('\n🔍 Sample scopes:');
    for (const record of sample.records) {
      console.log(`  - ${record.get('s.name')} (${record.get('s.uuid')})`);
      console.log(`    Hash: ${record.get('s.contentHash')}`);
    }
  }
} catch (error) {
  console.error('Error:', error);
} finally {
  await client.close();
}
