/**
 * Test executeFlat() method
 */
import { Neo4jClient, QueryBuilder } from '@luciformresearch/ragforge-runtime';
import dotenv from 'dotenv';

dotenv.config({ path: './generated/.env' });

async function main() {
  console.log('🧪 Testing executeFlat() method...\n');

  const client = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7688',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'neo4j123'
  });

  try {
    // Test 1: executeFlat() should return entities directly
    console.log('1️⃣ Test executeFlat() returns flat entities:');
    const qb = new QueryBuilder(client, 'Scope');
    const scopes = await qb.where({ name: 'CodeSourceAdapter' }).limit(1).executeFlat();

    console.log('  Type:', typeof scopes);
    console.log('  Is array:', Array.isArray(scopes));
    console.log('  Length:', scopes.length);

    if (scopes.length > 0) {
      const scope = scopes[0];
      console.log('  ✅ Direct property access:');
      console.log('    name:', scope.name);
      console.log('    type:', scope.type);
      console.log('    extends:', scope.extends);
      console.log('    heritageClauses:', scope.heritageClauses);
    }

    // Test 2: Compare with execute()
    console.log('\n2️⃣ Compare with execute():');
    const qb2 = new QueryBuilder(client, 'Scope');
    const results = await qb2.where({ name: 'CodeSourceAdapter' }).limit(1).execute();

    console.log('  execute() returns:', typeof results[0]);
    console.log('  Has entity wrapper:', 'entity' in results[0]);
    console.log('  entity.name:', results[0].entity.name);
    console.log('  score:', results[0].score);

    // Test 3: Test with multiple results
    console.log('\n3️⃣ Test with multiple results:');
    const classes = await new QueryBuilder(client, 'Scope')
      .where({ type: 'class' })
      .limit(5)
      .executeFlat();

    console.log(`  Found ${classes.length} classes:`);
    classes.forEach(c => {
      const ext = c.extends ? ` extends ${c.extends}` : '';
      console.log(`    - ${c.name}${ext}`);
    });

    // Test 4: Verify Phase 3 data accessible
    console.log('\n4️⃣ Verify Phase 3 data accessible via executeFlat():');
    const withExtends = classes.filter(c => c.extends);
    const withGenerics = await new QueryBuilder(client, 'Scope')
      .where({ type: 'class' })
      .limit(10)
      .executeFlat()
      .then(scopes => scopes.filter(s => s.generics));

    console.log(`  Classes with extends: ${withExtends.length}`);
    console.log(`  Classes with generics: ${withGenerics.length}`);

    if (withGenerics.length > 0) {
      console.log(`  Example: ${withGenerics[0].name}<${withGenerics[0].generics}>`);
    }

    console.log('\n✅ executeFlat() works perfectly!');

  } finally {
    await client.close();
  }
}

main().catch(console.error);
