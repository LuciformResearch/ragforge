import kuzu from 'kuzu';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateKuzuSchema } from '../packages/core/src/utils/node-schema.js';

async function main() {
  const dbPath = path.join(os.homedir(), '.ragforge', 'kuzu-test-new');
  
  console.log('Using path:', dbPath);
  console.log('Path exists:', fs.existsSync(dbPath));
  
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  console.log('\nCreating schema...');
  const statements = generateKuzuSchema();
  let errors = 0;
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (e: any) {
      errors++;
      console.log('Schema error:', e.message?.substring(0, 50));
    }
  }
  console.log(`Schema created with ${errors} errors`);
  
  console.log('\nQuerying...');
  try {
    const result = await conn.query('MATCH (p:Project) RETURN p.projectId as id');
    console.log('Result:', await result.getAll());
  } catch (e: any) {
    console.error('Query failed:', e.message);
  }
  
  console.log('\nDone!');
  db.close();
}

main().catch(console.error);
