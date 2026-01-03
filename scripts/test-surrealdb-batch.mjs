/**
 * Test SurrealDB batch operations and upsert performance
 */

import { Surreal } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';

function createEmbeddedSurreal() {
  return new Surreal({
    engines: createNodeEngines(),
  });
}

async function testBatchInsert() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST: Batch INSERT (équivalent UNWIND CREATE)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();
  await db.connect('mem://');
  await db.use({ namespace: 'test', database: 'batch' });

  // Générer 1000 nodes
  const nodes = Array.from({ length: 1000 }, (_, i) => ({
    uuid: `scope-${i}`,
    name: `function_${i}`,
    type: 'function',
    file: `/src/file_${i % 10}.ts`,
    startLine: i * 10,
    endLine: i * 10 + 5,
  }));

  // Test 1: INSERT batch (une seule requête)
  console.log('\n--- INSERT batch (1000 nodes) ---');
  const start1 = performance.now();

  const result1 = await db.query(`INSERT INTO scope $nodes`, { nodes });

  const time1 = performance.now() - start1;
  console.log(`✅ INSERT batch: ${time1.toFixed(2)}ms`);

  // Vérifier
  const count1 = await db.query('SELECT count() FROM scope GROUP ALL');
  console.log(`   Nodes créés: ${JSON.stringify(count1)}`);

  // Cleanup
  await db.query('DELETE scope');

  // Test 2: Queries individuelles (pour comparaison)
  console.log('\n--- CREATE individuel (100 nodes seulement) ---');
  const start2 = performance.now();

  for (let i = 0; i < 100; i++) {
    await db.query(`CREATE scope SET
      uuid = $uuid, name = $name, type = $type,
      file = $file, startLine = $startLine, endLine = $endLine
    `, nodes[i]);
  }

  const time2 = performance.now() - start2;
  console.log(`✅ CREATE individuel (100): ${time2.toFixed(2)}ms`);
  console.log(`   Estimé pour 1000: ${(time2 * 10).toFixed(2)}ms`);

  await db.close();
  return { batch: time1, individual: time2 * 10 };
}

async function testUpsert() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST: UPSERT (équivalent MERGE)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();
  await db.connect('mem://');
  await db.use({ namespace: 'test', database: 'upsert' });

  // Créer quelques nodes initiaux
  await db.query(`INSERT INTO scope [
    { uuid: 'scope-1', name: 'auth', version: 1 },
    { uuid: 'scope-2', name: 'utils', version: 1 }
  ]`);
  console.log('✅ Créé 2 nodes initiaux');

  // Test UPSERT - devrait update scope-1 et créer scope-3
  console.log('\n--- Test UPSERT ---');

  const upsertResult = await db.query(`
    UPSERT scope:[\`scope-1\`] SET name = 'auth_updated', version = 2, updatedAt = time::now();
    UPSERT scope:[\`scope-3\`] SET name = 'new_scope', version = 1, createdAt = time::now();
  `);
  console.log('✅ UPSERT result:', JSON.stringify(upsertResult, null, 2));

  // Vérifier
  const all = await db.query('SELECT * FROM scope');
  console.log('✅ All nodes:', JSON.stringify(all, null, 2));

  await db.close();
}

async function testBatchUpsert() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST: Batch UPSERT (équivalent UNWIND + MERGE)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();
  await db.connect('mem://');
  await db.use({ namespace: 'test', database: 'batch_upsert' });

  // Créer quelques nodes initiaux
  const initial = Array.from({ length: 500 }, (_, i) => ({
    uuid: `scope-${i}`,
    name: `function_${i}`,
    version: 1,
  }));
  await db.query(`INSERT INTO scope $nodes`, { nodes: initial });
  console.log('✅ Créé 500 nodes initiaux');

  // Préparer batch upsert: 250 updates + 250 creates
  const upsertNodes = Array.from({ length: 500 }, (_, i) => ({
    uuid: `scope-${i + 250}`, // 250-499 = update, 500-749 = create
    name: `function_${i + 250}_updated`,
    version: 2,
  }));

  console.log('\n--- Batch UPSERT (500 nodes: 250 updates + 250 creates) ---');
  const start = performance.now();

  // SurrealDB n'a pas de batch UPSERT direct, testons différentes approches

  // Approche 1: FOR loop en SurrealQL
  const result = await db.query(`
    FOR $node IN $nodes {
      UPSERT scope:[$node.uuid] SET
        name = $node.name,
        version = $node.version,
        updatedAt = time::now()
    }
  `, { nodes: upsertNodes });

  const time = performance.now() - start;
  console.log(`✅ Batch UPSERT via FOR: ${time.toFixed(2)}ms`);

  // Vérifier
  const count = await db.query('SELECT count() FROM scope GROUP ALL');
  console.log(`   Total nodes: ${JSON.stringify(count)}`);

  await db.close();
  return time;
}

async function testBatchRelationships() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST: Batch RELATE (équivalent UNWIND + MERGE relations)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();
  await db.connect('mem://');
  await db.use({ namespace: 'test', database: 'batch_rel' });

  // Créer des nodes
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    uuid: `scope-${i}`,
    name: `function_${i}`,
  }));
  await db.query(`INSERT INTO scope $nodes`, { nodes });
  console.log('✅ Créé 100 nodes');

  // Préparer relations (chaque node consumes le suivant)
  const relations = Array.from({ length: 99 }, (_, i) => ({
    from: `scope-${i}`,
    to: `scope-${i + 1}`,
    line: i * 10,
  }));

  console.log('\n--- Batch RELATE (99 relations) ---');
  const start = performance.now();

  // Approche: FOR loop
  const result = await db.query(`
    FOR $rel IN $relations {
      RELATE scope:[$rel.from]->consumes->scope:[$rel.to] SET line = $rel.line
    }
  `, { relations });

  const time = performance.now() - start;
  console.log(`✅ Batch RELATE via FOR: ${time.toFixed(2)}ms`);

  // Vérifier
  const relCount = await db.query('SELECT count() FROM consumes GROUP ALL');
  console.log(`   Relations créées: ${JSON.stringify(relCount)}`);

  // Test traversal
  const traversal = await db.query(`
    SELECT name, ->consumes->scope.name AS calls
    FROM scope
    WHERE name = 'function_0'
  `);
  console.log(`   Traversal test: ${JSON.stringify(traversal)}`);

  await db.close();
  return time;
}

async function main() {
  console.log('🚀 SurrealDB Batch Performance Tests');
  console.log('=====================================\n');

  try {
    const insertResults = await testBatchInsert();
    await testUpsert();
    const upsertTime = await testBatchUpsert();
    const relateTime = await testBatchRelationships();

    console.log('\n' + '='.repeat(60));
    console.log('📊 RÉSUMÉ PERFORMANCE');
    console.log('='.repeat(60));
    console.log(`INSERT batch 1000 nodes:    ${insertResults.batch.toFixed(2)}ms`);
    console.log(`CREATE individuel (estimé): ${insertResults.individual.toFixed(2)}ms`);
    console.log(`Speedup INSERT batch:       ${(insertResults.individual / insertResults.batch).toFixed(1)}x`);
    console.log(`UPSERT batch 500 nodes:     ${upsertTime.toFixed(2)}ms`);
    console.log(`RELATE batch 99 relations:  ${relateTime.toFixed(2)}ms`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

main();
