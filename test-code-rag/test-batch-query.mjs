import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

const session = driver.session();

try {
  // First test: What relationships exist between File and Scope?
  const test1 = await session.run(`
    MATCH (file:File)-[r]-(n:Scope)
    RETURN type(r) AS relType, count(*) AS count
  `);
  console.log(`Relationships between File and Scope:`);
  test1.records.forEach(r => {
    console.log(`  ${r.get('relType')}: ${r.get('count')}`);
  });

  // Second test: With all conditions
  const result = await session.run(`
    MATCH (file:File)-[:CONTAINS]->(n:Scope)
    WHERE n.source IS NOT NULL
      AND size(n.source) > $threshold
    WITH file, n
    ORDER BY file.path, n.startLine
    RETURN n.uuid AS uuid, file.path AS file_path
    LIMIT 10
  `, { threshold: neo4j.int(300) });

  console.log(`Found ${result.records.length} scopes`);
  result.records.forEach((r, i) => {
    console.log(`  ${i+1}. UUID: ${r.get('uuid')}, File: ${r.get('file_path')}`);
  });
} catch (error) {
  console.error('Query error:', error);
} finally {
  await session.close();
  await driver.close();
}
