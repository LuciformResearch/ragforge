import kuzu from 'kuzu';

async function main() {
  console.log('Deleting old database...');
  const fs = await import('fs');
  fs.rmSync('/home/luciedefraiteur/.ragforge/kuzu', { recursive: true, force: true });

  console.log('Creating new database...');
  const db = new kuzu.Database('/home/luciedefraiteur/.ragforge/kuzu');
  const conn = new kuzu.Connection(db);

  // Create required node tables first
  console.log('Creating node tables...');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS Project(uuid STRING, name STRING, path STRING, PRIMARY KEY(uuid))');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS File(uuid STRING, path STRING, name STRING, PRIMARY KEY(uuid))');
  await conn.query('CREATE NODE TABLE IF NOT EXISTS Scope(uuid STRING, name STRING, file STRING, type STRING, PRIMARY KEY(uuid))');
  console.log('Node tables created.');

  // Try REL TABLE GROUP
  const stmt = 'CREATE REL TABLE GROUP IF NOT EXISTS BELONGS_TO(FROM File TO Project, FROM Scope TO Project)';
  console.log('Executing:', stmt);
  try {
    await conn.query(stmt);
    console.log('REL TABLE GROUP: SUCCESS!');
  } catch(e: any) {
    console.log('REL TABLE GROUP ERROR:', e.message);
  }

  // Check if it exists now
  console.log('Testing BELONGS_TO query...');
  try {
    await conn.query('MATCH ()-[r:BELONGS_TO]->() RETURN r LIMIT 1');
    console.log('BELONGS_TO query: OK');
  } catch(e: any) {
    console.log('BELONGS_TO query failed:', e.message);
  }

  await db.close();
  console.log('Done.');
}

main().catch(console.error);
