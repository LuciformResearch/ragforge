import kuzu from 'kuzu';
import fs from 'fs';

async function main() {
  const dbPath = '/tmp/kuzu-test-literal';
  
  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  console.log('Creating table...');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, projectId STRING, name STRING, PRIMARY KEY(uuid))');
  
  console.log('\nTesting with literal 0 as nodeCount (empty table)...');
  try {
    const ps = await conn.prepare('MATCH (p:Project) RETURN p.projectId as id, 0 as nodeCount');
    const result = await conn.execute(ps, {});
    console.log('Result:', await result.getAll());
  } catch (e: any) {
    console.error('Failed:', e.message);
  }
  
  console.log('\nInserting data...');
  await conn.query("CREATE (p:Project {uuid: 'p1', projectId: 'proj-1', name: 'Project 1'})");
  
  console.log('\nTesting with literal 0 as nodeCount (with data)...');
  try {
    const ps = await conn.prepare('MATCH (p:Project) RETURN p.projectId as id, 0 as nodeCount');
    const result = await conn.execute(ps, {});
    console.log('Result:', await result.getAll());
  } catch (e: any) {
    console.error('Failed:', e.message);
  }
  
  console.log('\nDone!');
  db.close();
}

main().catch(console.error);
