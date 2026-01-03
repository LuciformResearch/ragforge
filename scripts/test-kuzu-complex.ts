import kuzu from 'kuzu';
import fs from 'fs';

async function main() {
  const dbPath = '/tmp/kuzu-test-complex';
  
  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  console.log('Creating Project table with nullable props...');
  try {
    await conn.query(`
      CREATE NODE TABLE IF NOT EXISTS Project(
        uuid STRING, 
        projectId STRING, 
        name STRING, 
        path STRING,
        rootPath STRING,
        type STRING,
        lastAccessed STRING,
        excluded BOOLEAN,
        autoCleanup BOOLEAN,
        displayName STRING,
        PRIMARY KEY(uuid)
      )
    `);
    console.log('Table created!');
  } catch (e: any) {
    console.error('Table creation failed:', e.message);
  }
  
  console.log('\nQuerying empty Project table...');
  try {
    const result = await conn.query('MATCH (p:Project) RETURN p.projectId as id, p.rootPath as path');
    console.log('Empty query succeeded:', await result.getAll());
  } catch (e: any) {
    console.error('Empty query failed:', e.message);
  }
  
  console.log('\nInserting a project...');
  try {
    await conn.query(`
      CREATE (p:Project {
        uuid: 'project:test-1',
        projectId: 'test-project',
        name: 'Test Project',
        path: '/test/path',
        rootPath: '/test/path',
        type: 'quick-ingest',
        lastAccessed: '2024-01-01T00:00:00Z',
        excluded: false,
        autoCleanup: true,
        displayName: 'Test'
      })
    `);
    console.log('Insert succeeded!');
  } catch (e: any) {
    console.error('Insert failed:', e.message);
  }
  
  console.log('\nQuerying after insert...');
  try {
    const result = await conn.query('MATCH (p:Project) RETURN p.projectId as id, p.rootPath as path, p.type as type');
    console.log('Query result:', await result.getAll());
  } catch (e: any) {
    console.error('Query failed:', e.message);
  }
  
  console.log('\nDone!');
  db.close();
}

main().catch(console.error);
