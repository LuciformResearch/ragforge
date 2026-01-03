/**
 * SurrealDB Prototype - Test embedded mode with graph, vector, and full-text search
 *
 * Run with: node scripts/test-surrealdb.mjs
 */

import { Surreal } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test data directory
const DATA_DIR = path.join(process.cwd(), '.surrealdb-test');

// Create Surreal instance with embedded Node.js engines
function createEmbeddedSurreal() {
  return new Surreal({
    engines: createNodeEngines(),
  });
}

async function cleanupTestData() {
  try {
    await fs.rm(DATA_DIR, { recursive: true, force: true });
    console.log('🧹 Cleaned up test data directory');
  } catch {
    // Ignore if doesn't exist
  }
}

async function testInMemory() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST 1: In-Memory Mode');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();

  try {
    // Connect to in-memory database
    await db.connect('mem://');
    console.log('✅ Connected to in-memory SurrealDB');

    // Use namespace and database
    await db.use({ namespace: 'test', database: 'ragforge' });
    console.log('✅ Using namespace: test, database: ragforge');

    // Create a simple record (v2 syntax: use query or create with explicit ID)
    const result = await db.query('CREATE test SET name = "hello", value = 42');
    console.log('✅ Created record:', JSON.stringify(result, null, 2));

    // Query it back
    const query = await db.query('SELECT * FROM test');
    console.log('✅ Query result:', JSON.stringify(query, null, 2));

    return true;
  } catch (error) {
    console.error('❌ In-memory test failed:', error.message);
    return false;
  } finally {
    await db.close();
  }
}

async function testPersistent() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST 2: Persistent Mode (surrealkv)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();

  try {
    // Create data directory
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Connect to persistent database
    const connectionString = `surrealkv://${DATA_DIR}`;
    await db.connect(connectionString);
    console.log(`✅ Connected to persistent SurrealDB at ${connectionString}`);

    await db.use({ namespace: 'ragforge', database: 'main' });

    // Create some data
    const now = new Date().toISOString();
    await db.query(`CREATE persistent_test SET created = "${now}"`);
    console.log('✅ Created persistent record');

    // Close and reconnect to verify persistence
    await db.close();
    console.log('✅ Closed connection');

    // Reconnect
    const db2 = createEmbeddedSurreal();
    await db2.connect(connectionString);
    await db2.use({ namespace: 'ragforge', database: 'main' });

    const result = await db2.query('SELECT * FROM persistent_test');
    console.log('✅ Data persisted across reconnection:', result);

    await db2.close();
    return true;
  } catch (error) {
    console.error('❌ Persistent test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  } finally {
    try { await db.close(); } catch {}
  }
}

async function testGraphOperations() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST 3: Graph Operations (Nodes & Relationships)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();

  try {
    await db.connect('mem://');
    await db.use({ namespace: 'test', database: 'graph' });

    // Create File nodes
    await db.query(`CREATE file:auth SET path = '/src/auth.ts', name = 'auth.ts', language = 'typescript'`);
    console.log('✅ Created File node: file:auth');

    await db.query(`CREATE file:utils SET path = '/src/utils.ts', name = 'utils.ts', language = 'typescript'`);

    // Create Scope nodes with explicit IDs
    await db.query(`CREATE scope:authenticate SET name = 'authenticate', type = 'function', file = '/src/auth.ts', startLine = 10, endLine = 50`);
    console.log('✅ Created Scope node: scope:authenticate');

    await db.query(`CREATE scope:hashPassword SET name = 'hashPassword', type = 'function', file = '/src/utils.ts', startLine = 5, endLine = 20`);

    // Create relationships using RELATE with explicit IDs
    const relation = await db.query(`
      RELATE scope:authenticate->consumes->scope:hashPassword SET
        type = 'function_call',
        line = 25
    `);
    console.log('✅ Created CONSUMES relationship:', JSON.stringify(relation, null, 2));

    // Query graph: Find what authenticate consumes
    const consumers = await db.query(`
      SELECT
        name,
        ->consumes->scope.name AS consumes
      FROM scope
      WHERE name = 'authenticate'
    `);
    console.log('✅ Graph query (what authenticate consumes):', JSON.stringify(consumers, null, 2));

    // Query graph: Find what consumes hashPassword
    const consumed = await db.query(`
      SELECT
        name,
        <-consumes<-scope.name AS consumed_by
      FROM scope
      WHERE name = 'hashPassword'
    `);
    console.log('✅ Graph query (what consumes hashPassword):', JSON.stringify(consumed, null, 2));

    // Multi-hop traversal
    const multiHop = await db.query(`
      SELECT
        name,
        ->consumes->scope->consumes->scope.name AS consumes_of_consumes
      FROM scope
    `);
    console.log('✅ Multi-hop traversal:', JSON.stringify(multiHop, null, 2));

    return true;
  } catch (error) {
    console.error('❌ Graph test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  } finally {
    await db.close();
  }
}

async function testVectorSearch() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST 4: Vector Search (HNSW)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();

  try {
    await db.connect('mem://');
    await db.use({ namespace: 'test', database: 'vectors' });

    // Define a schema with vector field
    await db.query(`
      DEFINE TABLE scope SCHEMAFULL;
      DEFINE FIELD name ON scope TYPE string;
      DEFINE FIELD embedding ON scope TYPE array<float>;
      DEFINE INDEX idx_embedding ON scope FIELDS embedding HNSW DIMENSION 4 DIST COSINE;
    `);
    console.log('✅ Created HNSW vector index');

    // Create some scopes with embeddings (fake 4-dimensional vectors for testing)
    await db.query(`CREATE scope SET name = 'authenticate', embedding = [0.1, 0.2, 0.8, 0.9]`);
    await db.query(`CREATE scope SET name = 'validateToken', embedding = [0.15, 0.25, 0.75, 0.85]`);
    await db.query(`CREATE scope SET name = 'parseJSON', embedding = [0.9, 0.1, 0.1, 0.2]`);
    await db.query(`CREATE scope SET name = 'formatDate', embedding = [0.8, 0.2, 0.15, 0.25]`);
    console.log('✅ Created 4 scopes with embeddings');

    // Vector similarity search: find scopes similar to "auth-like" embedding
    const searchVector = [0.12, 0.22, 0.78, 0.88];
    const vectorResults = await db.query(`
      SELECT name, vector::similarity::cosine(embedding, $vector) AS score
      FROM scope
      WHERE embedding <|3|> $vector
      ORDER BY score DESC
    `, { vector: searchVector });
    console.log('✅ Vector search results (auth-like query):', JSON.stringify(vectorResults, null, 2));

    // Another search: find scopes similar to "utility-like" embedding
    const utilityVector = [0.85, 0.15, 0.12, 0.22];
    const utilityResults = await db.query(`
      SELECT name, vector::similarity::cosine(embedding, $vector) AS score
      FROM scope
      WHERE embedding <|3|> $vector
      ORDER BY score DESC
    `, { vector: utilityVector });
    console.log('✅ Vector search results (utility-like query):', JSON.stringify(utilityResults, null, 2));

    return true;
  } catch (error) {
    console.error('❌ Vector search test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  } finally {
    await db.close();
  }
}

async function testFullTextSearch() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST 5: Full-Text Search (BM25)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();

  try {
    await db.connect('mem://');
    await db.use({ namespace: 'test', database: 'fulltext' });

    // Define schema with full-text index
    await db.query(`
      DEFINE TABLE scope SCHEMAFULL;
      DEFINE FIELD name ON scope TYPE string;
      DEFINE FIELD content ON scope TYPE string;
      DEFINE FIELD docstring ON scope TYPE string;
      DEFINE ANALYZER custom_analyzer TOKENIZERS blank, class FILTERS lowercase, snowball(english);
      DEFINE INDEX idx_content ON scope FIELDS content SEARCH ANALYZER custom_analyzer BM25;
      DEFINE INDEX idx_docstring ON scope FIELDS docstring SEARCH ANALYZER custom_analyzer BM25;
    `);
    console.log('✅ Created BM25 full-text indexes');

    // Create scopes with content
    await db.query(`CREATE scope SET
      name = 'authenticate',
      content = 'async function authenticate(user, password) { return await validateCredentials(user, password); }',
      docstring = 'Authenticates a user with username and password credentials'
    `);
    await db.query(`CREATE scope SET
      name = 'validateToken',
      content = 'function validateToken(token) { return jwt.verify(token, SECRET); }',
      docstring = 'Validates a JWT token and returns the decoded payload'
    `);
    await db.query(`CREATE scope SET
      name = 'parseJSON',
      content = 'function parseJSON(str) { try { return JSON.parse(str); } catch { return null; } }',
      docstring = 'Safely parses a JSON string, returns null on error'
    `);
    await db.query(`CREATE scope SET
      name = 'hashPassword',
      content = 'async function hashPassword(password) { return await bcrypt.hash(password, 10); }',
      docstring = 'Hashes a password using bcrypt with salt rounds'
    `);
    console.log('✅ Created 4 scopes with content');

    // Full-text search on content
    const contentSearch = await db.query(`
      SELECT name, search::score(1) AS score
      FROM scope
      WHERE content @1@ 'password'
      ORDER BY score DESC
    `);
    console.log('✅ Full-text search on content ("password"):', JSON.stringify(contentSearch, null, 2));

    // Full-text search on docstring
    const docSearch = await db.query(`
      SELECT name, search::score(1) AS score
      FROM scope
      WHERE docstring @1@ 'token JWT'
      ORDER BY score DESC
    `);
    console.log('✅ Full-text search on docstring ("token JWT"):', JSON.stringify(docSearch, null, 2));

    // Combined search (content OR docstring)
    const combinedSearch = await db.query(`
      SELECT name,
        search::score(1) + search::score(2) AS combined_score
      FROM scope
      WHERE content @1@ 'user' OR docstring @2@ 'user'
      ORDER BY combined_score DESC
    `);
    console.log('✅ Combined search ("user"):', JSON.stringify(combinedSearch, null, 2));

    return true;
  } catch (error) {
    console.error('❌ Full-text search test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  } finally {
    await db.close();
  }
}

async function testComplexScenario() {
  console.log('\n' + '='.repeat(60));
  console.log('📝 TEST 6: Complex Scenario (Graph + Vector + Full-Text)');
  console.log('='.repeat(60));

  const db = createEmbeddedSurreal();

  try {
    await db.connect('mem://');
    await db.use({ namespace: 'test', database: 'complex' });

    // Define comprehensive schema
    await db.query(`
      DEFINE TABLE file SCHEMAFULL;
      DEFINE FIELD path ON file TYPE string;
      DEFINE FIELD name ON file TYPE string;
      DEFINE INDEX idx_path ON file FIELDS path UNIQUE;

      DEFINE TABLE scope SCHEMAFULL;
      DEFINE FIELD name ON scope TYPE string;
      DEFINE FIELD type ON scope TYPE string;
      DEFINE FIELD file ON scope TYPE record<file>;
      DEFINE FIELD content ON scope TYPE string;
      DEFINE FIELD embedding ON scope TYPE array<float>;

      DEFINE ANALYZER scope_analyzer TOKENIZERS blank, class FILTERS lowercase;
      DEFINE INDEX idx_content ON scope FIELDS content SEARCH ANALYZER scope_analyzer BM25;
      DEFINE INDEX idx_embedding ON scope FIELDS embedding HNSW DIMENSION 4 DIST COSINE;

      -- Relations are created automatically by RELATE, no need to pre-define
    `);
    console.log('✅ Created comprehensive schema with graph, vector, and full-text');

    // Create files with explicit IDs
    await db.query(`CREATE file:auth SET path = '/src/auth.ts', name = 'auth.ts'`);
    await db.query(`CREATE file:utils SET path = '/src/utils.ts', name = 'utils.ts'`);
    console.log('✅ Created file nodes');

    // Create scopes with all fields and explicit IDs
    await db.query(`
      CREATE scope:authenticate SET
        name = 'authenticate',
        type = 'function',
        file = file:auth,
        content = 'async function authenticate(user, password) { const hash = await hashPassword(password); }',
        embedding = [0.1, 0.2, 0.8, 0.9]
    `);

    await db.query(`
      CREATE scope:hashPassword SET
        name = 'hashPassword',
        type = 'function',
        file = file:utils,
        content = 'function hashPassword(password) { return bcrypt.hash(password, 10); }',
        embedding = [0.15, 0.25, 0.75, 0.85]
    `);

    await db.query(`
      CREATE scope:parseJSON SET
        name = 'parseJSON',
        type = 'function',
        file = file:utils,
        content = 'function parseJSON(str) { return JSON.parse(str); }',
        embedding = [0.9, 0.1, 0.1, 0.2]
    `);
    console.log('✅ Created scope nodes with embeddings');

    // Create relationships with explicit IDs
    await db.query(`RELATE scope:authenticate->consumes->scope:hashPassword SET line = 25`);
    console.log('✅ Created CONSUMES relationship');

    // Complex query: Find scopes similar to "auth", with full-text on content, and graph traversal
    const complexQuery = await db.query(`
      SELECT
        name,
        type,
        file.path AS file_path,
        vector::similarity::cosine(embedding, [0.12, 0.22, 0.78, 0.88]) AS vector_score,
        ->consumes->scope.name AS consumes,
        <-consumes<-scope.name AS consumed_by
      FROM scope
      WHERE embedding <|10|> [0.12, 0.22, 0.78, 0.88]
      ORDER BY vector_score DESC
    `);
    console.log('✅ Complex query (vector + graph):', JSON.stringify(complexQuery, null, 2));

    // Full-text + graph
    const textGraphQuery = await db.query(`
      SELECT
        name,
        search::score(1) AS text_score,
        ->consumes->scope.name AS calls
      FROM scope
      WHERE content @1@ 'password'
      ORDER BY text_score DESC
    `);
    console.log('✅ Full-text + graph query:', JSON.stringify(textGraphQuery, null, 2));

    return true;
  } catch (error) {
    console.error('❌ Complex scenario test failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  } finally {
    await db.close();
  }
}

async function main() {
  console.log('🚀 SurrealDB Prototype Tests');
  console.log('============================');
  console.log('Testing @surrealdb/node embedded mode\n');

  const results = {};

  // Run tests
  results['In-Memory'] = await testInMemory();
  results['Persistent'] = await testPersistent();
  results['Graph Operations'] = await testGraphOperations();
  results['Vector Search'] = await testVectorSearch();
  results['Full-Text Search'] = await testFullTextSearch();
  results['Complex Scenario'] = await testComplexScenario();

  // Cleanup
  await cleanupTestData();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));

  for (const [test, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${test}`);
  }

  const allPassed = Object.values(results).every(v => v);
  console.log('\n' + (allPassed ? '🎉 All tests passed!' : '⚠️ Some tests failed'));

  process.exit(allPassed ? 0 : 1);
}

main();
