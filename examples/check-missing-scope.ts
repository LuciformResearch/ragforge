import { createRagClient } from './generated-dual-client/index.js';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

async function main() {
  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  const result = await rag.scope()
    .whereName('getNeo4jDriver')
    .execute();

  console.log('getNeo4jDriver exists?', result.length > 0);
  if (result.length > 0) {
    console.log('Found:', result[0].entity.name, 'in', result[0].entity.file);
    console.log('Has embedding_source?', !!result[0].entity.embedding_source);
    console.log('Source length:', result[0].entity.source?.length || 0);
  }

  await rag.close();
}

main().catch(console.error);
