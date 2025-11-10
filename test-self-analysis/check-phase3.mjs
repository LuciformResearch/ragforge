import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7688',
  neo4j.auth.basic('neo4j', 'neo4j123')
);

const session = driver.session();

try {
  // Check heritage clauses
  console.log('🎯 Phase 3 Features in Neo4j:\n');

  const heritageResult = await session.run(`
    MATCH (s:Scope)
    WHERE s.heritageClauses IS NOT NULL
    RETURN s.name AS name, s.extends AS extends, s.implements AS implements, s.heritageClauses AS raw
    ORDER BY s.name
    LIMIT 10
  `);

  console.log(`📋 Scopes with heritage clauses: ${heritageResult.records.length}`);
  for (const record of heritageResult.records) {
    const ext = record.get('extends') || '';
    const impl = record.get('implements') || '';
    console.log(`  ${record.get('name')}: ${ext ? `extends ${ext}` : ''}${ext && impl ? ', ' : ''}${impl ? `implements ${impl}` : ''}`);
  }

  // Check INHERITS_FROM relationships
  const inheritsResult = await session.run(`
    MATCH (a:Scope)-[r:INHERITS_FROM]->(b:Scope)
    RETURN a.name AS child, b.name AS parent, r.explicit AS explicit
    ORDER BY a.name
    LIMIT 10
  `);

  console.log(`\n🔗 INHERITS_FROM relationships: ${inheritsResult.records.length}`);
  for (const record of inheritsResult.records) {
    const explicit = record.get('explicit') ? '(explicit)' : '(heuristic)';
    console.log(`  ${record.get('child')} -> ${record.get('parent')} ${explicit}`);
  }

  // Check generic parameters
  const genericsResult = await session.run(`
    MATCH (s:Scope)
    WHERE s.genericParameters IS NOT NULL
    RETURN s.name AS name, s.generics AS generics
    ORDER BY s.name
    LIMIT 10
  `);

  console.log(`\n🎯 Scopes with generic parameters: ${genericsResult.records.length}`);
  for (const record of genericsResult.records) {
    console.log(`  ${record.get('name')}<${record.get('generics')}>`);
  }

  // Summary
  const summary = await session.run(`
    MATCH (s:Scope)
    RETURN
      count(s) AS total,
      count(CASE WHEN s.heritageClauses IS NOT NULL THEN 1 END) AS withHeritage,
      count(CASE WHEN s.genericParameters IS NOT NULL THEN 1 END) AS withGenerics,
      count(CASE WHEN s.decoratorDetails IS NOT NULL THEN 1 END) AS withDecorators,
      count(CASE WHEN s.enumMembers IS NOT NULL THEN 1 END) AS withEnums
  `);

  const stats = summary.records[0];
  console.log('\n📊 Summary:');
  console.log(`  Total Scopes: ${stats.get('total')}`);
  console.log(`  With heritage clauses: ${stats.get('withHeritage')}`);
  console.log(`  With generic parameters: ${stats.get('withGenerics')}`);
  console.log(`  With decorators: ${stats.get('withDecorators')}`);
  console.log(`  With enum members: ${stats.get('withEnums')}`);

} finally {
  await session.close();
  await driver.close();
}
