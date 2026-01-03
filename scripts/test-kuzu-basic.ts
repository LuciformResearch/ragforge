import kuzu from 'kuzu';
import fs from 'fs';

async function main() {
  const dbPath = '/tmp/kuzu-test';
  
  // Clean up
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true });
  }
  
  // Create database
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  
  console.log('Creating simple table...');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS Test(uuid STRING, name STRING, PRIMARY KEY(uuid))');
  
  console.log('Querying empty table...');
  try {
    const result = await conn.query('MATCH (t:Test) RETURN t.uuid, t.name');
    console.log('Query succeeded:', await result.getAll());
  } catch (e: any) {
    console.error('Query failed:', e.message);
  }
  
  console.log('Inserting data...');
  await conn.query("CREATE (t:Test {uuid: 'test-1', name: 'Test Node'})");
  
  console.log('Querying after insert...');
  const result2 = await conn.query('MATCH (t:Test) RETURN t.uuid, t.name');
  console.log('Result:', await result2.getAll());
  
  console.log('Done!');
  db.close();
}

main().catch(console.error);
