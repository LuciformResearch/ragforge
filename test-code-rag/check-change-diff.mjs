import { createRagClient } from './client.js';

const client = createRagClient();

try {
  // Find the testFunction scope
  const scopeResult = await client.client.run(`
    MATCH (s:Scope {name: 'testFunction'})
    RETURN s.uuid, s.name, s.file
  `);

  if (scopeResult.records.length === 0) {
    console.log('❌ testFunction not found');
    process.exit(1);
  }

  const scopeUuid = scopeResult.records[0].get('s.uuid');
  console.log('🔍 Found testFunction:', scopeUuid);

  // Get recent changes for this scope
  const changesResult = await client.client.run(`
    MATCH (s:Scope {uuid: $uuid})-[:HAS_CHANGE]->(c:Change)
    RETURN c.changeType, c.timestamp, c.linesAdded, c.linesRemoved, c.diff
    ORDER BY c.timestamp DESC
    LIMIT 2
  `, { uuid: scopeUuid });

  console.log(`\n📝 Change history (${changesResult.records.length} changes):\n`);

  for (const record of changesResult.records) {
    const changeType = record.get('c.changeType');
    const timestamp = new Date(record.get('c.timestamp').toString()).toLocaleString();
    const linesAdded = record.get('c.linesAdded');
    const linesRemoved = record.get('c.linesRemoved');
    const diff = record.get('c.diff');

    console.log(`📅 ${timestamp} | ${changeType}`);
    console.log(`   +${linesAdded} -${linesRemoved}`);
    console.log('\n🔄 Diff:');
    console.log(diff);
    console.log('\n' + '='.repeat(80) + '\n');
  }

} catch (error) {
  console.error('Error:', error);
} finally {
  await client.close();
}
