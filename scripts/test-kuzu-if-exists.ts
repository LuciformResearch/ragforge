import kuzu from 'kuzu';
import fs from 'fs';

async function main() {
  const dbPath = '/tmp/kuzu-test-ifexists';
  
  // Clean up first
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  console.log('Creating table first time...');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, projectId STRING, PRIMARY KEY(uuid))');
  
  console.log('Creating table second time (IF NOT EXISTS)...');
  try {
    await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, projectId STRING, PRIMARY KEY(uuid))');
    console.log('Second creation: OK');
  } catch (e: any) {
    console.log('Second creation error:', e.message);
  }
  
  console.log('\nQuerying after second creation attempt...');
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
