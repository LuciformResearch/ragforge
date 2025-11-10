/**
 * Debug QueryBuilder to find where properties are lost
 */
import { Neo4jClient, QueryBuilder } from '@luciformresearch/ragforge-runtime';
import dotenv from 'dotenv';

dotenv.config({ path: './generated/.env' });

async function main() {
  console.log('🔍 Debugging QueryBuilder...\n');

  const client = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7688',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'neo4j123'
  });

  try {
    // Test 1: Direct Cypher query (baseline - should work)
    console.log('1️⃣ Direct Cypher query (baseline):');
    const directResult = await client.run(`
      MATCH (s:Scope)
      WHERE s.name = 'CodeSourceAdapter'
      RETURN s.name AS name, s.type AS type, s.extends AS extends
      LIMIT 1
    `);

    if (directResult.records.length > 0) {
      const record = directResult.records[0];
      console.log('  ✅ Direct Cypher works:');
      console.log('    name:', record.get('name'));
      console.log('    type:', record.get('type'));
      console.log('    extends:', record.get('extends'));
    }

    // Test 2: QueryBuilder simple query with where()
    console.log('\n2️⃣ QueryBuilder with where():');
    const qb = new QueryBuilder(client, 'Scope');
    const results = await qb.where({ name: 'CodeSourceAdapter' }).limit(1).execute();

    console.log('  Results count:', results.length);
    if (results.length > 0) {
      console.log('  Result[0]:', results[0]);
      console.log('  Result[0].name:', results[0].name);
      console.log('  Result[0].type:', results[0].type);
      console.log('  Result[0].extends:', results[0].extends);
    }

    // Test 3: Check what Cypher is generated
    console.log('\n3️⃣ Check generated Cypher:');

    // Patch QueryBuilder temporarily to log the query
    const originalRun = client.run.bind(client);
    client.run = async function(query, params) {
      console.log('  Generated Cypher:');
      console.log('  ', query.replace(/\n/g, '\n   '));
      console.log('  Params:', JSON.stringify(params, null, 2));
      return originalRun(query, params);
    };

    const qb2 = new QueryBuilder(client, 'Scope');
    await qb2.where({ name: 'CodeSourceAdapter' }).limit(1).execute();

    client.run = originalRun;

    // Test 4: Check the actual RETURN clause
    console.log('\n4️⃣ Verify RETURN clause includes all properties:');
    const testQuery = `
      MATCH (n:Scope)
      WHERE n.name = 'CodeSourceAdapter'
      RETURN n
      LIMIT 1
    `;
    const fullResult = await client.run(testQuery);

    if (fullResult.records.length > 0) {
      const node = fullResult.records[0].get('n');
      console.log('  Node properties:', node.properties);
      console.log('  Has "extends":', 'extends' in node.properties);
      console.log('  Value of "extends":', node.properties.extends);
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
