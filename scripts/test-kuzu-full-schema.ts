import kuzu from 'kuzu';
import fs from 'fs';
import { generateKuzuSchema } from '../packages/core/src/utils/node-schema.js';

async function main() {
  const dbPath = '/tmp/kuzu-test-schema';
  
  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  const statements = generateKuzuSchema();
  console.log(`Creating schema with ${statements.length} statements...`);
  
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      console.log('OK:', stmt.substring(0, 60) + '...');
    } catch (e: any) {
      console.error('FAIL:', stmt.substring(0, 60) + '...');
      console.error('      Error:', e.message);
    }
  }
  
  console.log('\nTesting MATCH on Project...');
  try {
    const result = await conn.query('MATCH (p:Project) RETURN p.uuid, p.projectId');
    console.log('Query result:', await result.getAll());
  } catch (e: any) {
    console.error('Query failed:', e.message);
  }
  
  console.log('\nDone!');
  db.close();
}

main().catch(console.error);
