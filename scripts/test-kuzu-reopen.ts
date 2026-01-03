import kuzu from 'kuzu';
import fs from 'fs';

async function main() {
  const dbPath = '/tmp/kuzu-test-reopen';
  
  // Clean up first
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  console.log('=== First session ===');
  {
    const db = new kuzu.Database(dbPath);
    const conn = new kuzu.Connection(db);
    
    console.log('Creating table...');
    await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, projectId STRING, PRIMARY KEY(uuid))');
    
    console.log('Inserting data...');
    await conn.query("CREATE (p:Project {uuid: 'p1', projectId: 'test-proj'})");
    
    console.log('Closing first session...');
    db.close();
  }
  
  console.log('\n=== Second session (reopen) ===');
  {
    const db = new kuzu.Database(dbPath);
    const conn = new kuzu.Connection(db);
    
    console.log('Running IF NOT EXISTS on existing table...');
    try {
      await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, projectId STRING, PRIMARY KEY(uuid))');
      console.log('IF NOT EXISTS: OK');
    } catch (e: any) {
      console.log('IF NOT EXISTS error:', e.message);
    }
    
    console.log('\nQuerying...');
    try {
      const ps = await conn.prepare('MATCH (p:Project) RETURN p.projectId as id');
      const result = await conn.execute(ps, {});
      console.log('Query result:', await result.getAll());
    } catch (e: any) {
      console.error('Query failed:', e.message);
    }
    
    db.close();
  }
  
  console.log('\nDone!');
}

main().catch(console.error);
