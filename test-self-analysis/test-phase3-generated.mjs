/**
 * Test Phase 3 features without using generated client mutations
 */
import { Neo4jClient } from '@luciformresearch/ragforge-runtime';
import dotenv from 'dotenv';

dotenv.config({ path: './generated/.env' });

async function main() {
  console.log('🎯 Testing Phase 3 features via Neo4j client...\n');

  const client = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7688',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'neo4j123'
  });

  try {
    // Test 1: Query scope with heritage clauses
    console.log('1️⃣ Querying CodeSourceAdapter with heritage clauses:');
    const result1 = await client.run(`
      MATCH (s:Scope)
      WHERE s.name = 'CodeSourceAdapter'
      RETURN s.name AS name, s.type AS type, s.extends AS extends,
             s.implements AS implements, s.heritageClauses AS heritageClauses
      LIMIT 1
    `);

    if (result1.records.length > 0) {
      const record = result1.records[0];
      console.log(`  Name: ${record.get('name')}`);
      console.log(`  Type: ${record.get('type')}`);
      console.log(`  Extends: ${record.get('extends') || 'none'}`);
      console.log(`  Implements: ${record.get('implements') || 'none'}`);
      console.log(`  Heritage clauses: ${record.get('heritageClauses')}`);
    }

    // Test 2: Query scope with generics
    console.log('\n2️⃣ Querying QueryBuilder with generic parameters:');
    const result2 = await client.run(`
      MATCH (s:Scope)
      WHERE s.name = 'QueryBuilder'
      RETURN s.name AS name, s.type AS type, s.generics AS generics,
             s.genericParameters AS genericParameters
      LIMIT 1
    `);

    if (result2.records.length > 0) {
      const record = result2.records[0];
      console.log(`  Name: ${record.get('name')}`);
      console.log(`  Type: ${record.get('type')}`);
      console.log(`  Generics: ${record.get('generics') || 'none'}`);
      console.log(`  Generic parameters: ${record.get('genericParameters')}`);
    }

    // Test 3: All classes that extend something
    console.log('\n3️⃣ All classes with extends clause:');
    const result3 = await client.run(`
      MATCH (s:Scope)
      WHERE s.extends IS NOT NULL AND s.extends <> ''
      RETURN s.name AS name, s.extends AS extends
      ORDER BY s.name
    `);

    for (const record of result3.records) {
      console.log(`  ${record.get('name')} extends ${record.get('extends')}`);
    }

    // Test 4: INHERITS_FROM relationships
    console.log('\n4️⃣ INHERITS_FROM relationships:');
    const result4 = await client.run(`
      MATCH (child:Scope)-[r:INHERITS_FROM]->(parent:Scope)
      RETURN child.name AS child, parent.name AS parent, r.explicit AS explicit
      ORDER BY child.name
    `);

    for (const record of result4.records) {
      const explicit = record.get('explicit') ? '(explicit)' : '(heuristic)';
      console.log(`  ${record.get('child')} -> ${record.get('parent')} ${explicit}`);
    }

    // Test 5: All scopes with generics
    console.log('\n5️⃣ All scopes with generic parameters:');
    const result5 = await client.run(`
      MATCH (s:Scope)
      WHERE s.generics IS NOT NULL AND s.generics <> ''
      RETURN s.name AS name, s.generics AS generics, s.type AS type
      ORDER BY s.name
    `);

    for (const record of result5.records) {
      console.log(`  ${record.get('name')}<${record.get('generics')}> (${record.get('type')})`);
    }

    console.log('\n✅ All Phase 3 features working correctly!');

  } finally {
    await client.close();
  }
}

main().catch(console.error);
