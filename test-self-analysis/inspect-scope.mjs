import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7688',
  neo4j.auth.basic('neo4j', 'neo4j123')
);

const session = driver.session();

try {
  // Get one scope with all its properties
  const result = await session.run(`
    MATCH (s:Scope)
    WHERE s.name = 'CodeSourceAdapter'
    RETURN s
    LIMIT 1
  `);

  if (result.records.length > 0) {
    const scope = result.records[0].get('s');
    console.log('📋 CodeSourceAdapter scope properties:');
    console.log(JSON.stringify(scope.properties, null, 2));
  } else {
    console.log('❌ CodeSourceAdapter not found');
  }

} finally {
  await session.close();
  await driver.close();
}
