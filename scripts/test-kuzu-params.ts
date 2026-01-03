import kuzu from 'kuzu';
import fs from 'fs';

async function main() {
  const dbPath = '/tmp/kuzu-test-params';
  
  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  console.log('Creating table...');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, projectId STRING, name STRING, PRIMARY KEY(uuid))');
  
  console.log('\nTesting prepared statement with no params (empty table)...');
  try {
    const ps = await conn.prepare('MATCH (p:Project) RETURN p.projectId as id');
    const result = await conn.execute(ps, {});
    console.log('Prepared query result:', await result.getAll());
  } catch (e: any) {
    console.error('Prepared query failed:', e.message);
  }
  
  console.log('\nInserting data...');
  await conn.query("CREATE (p:Project {uuid: 'p1', projectId: 'proj-1', name: 'Project 1'})");
  
  console.log('\nTesting prepared statement with positional param...');
  try {
    const ps = await conn.prepare('MATCH (p:Project {projectId: $1}) RETURN p.name as name');
    const result = await conn.execute(ps, { '1': 'proj-1' });
    console.log('With param result:', await result.getAll());
  } catch (e: any) {
    console.error('With param failed:', e.message);
  }
  
  console.log('\nDone!');
  db.close();
}

main().catch(console.error);
