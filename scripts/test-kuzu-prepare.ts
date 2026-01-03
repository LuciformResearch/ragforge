import kuzu from 'kuzu';
import fs from 'fs';
import { generateKuzuSchema } from '../packages/core/src/utils/node-schema.js';

async function main() {
  const dbPath = '/tmp/kuzu-test-prepare';
  
  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  // Create only Project table
  console.log('Creating Project table...');
  const statements = generateKuzuSchema();
  await conn.query(statements[0]); // Project table
  
  console.log('\nTesting with query()...');
  try {
    const result = await conn.query('MATCH (p:Project) RETURN p.uuid, p.projectId');
    console.log('query() result:', await result.getAll());
  } catch (e: any) {
    console.error('query() failed:', e.message);
  }
  
  console.log('\nTesting with prepare() + execute()...');
  try {
    const ps = await conn.prepare('MATCH (p:Project) RETURN p.uuid, p.projectId');
    const result = await conn.execute(ps, {});
    console.log('prepare/execute result:', await result.getAll());
  } catch (e: any) {
    console.error('prepare/execute failed:', e.message);
  }
  
  console.log('\nDone!');
  db.close();
}

main().catch(console.error);
