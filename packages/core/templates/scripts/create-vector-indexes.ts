import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Neo4jClient, neo4j } from '@luciformresearch/ragforge';

import { EMBEDDINGS_CONFIG } from '../embeddings/load-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

async function main(): Promise<void> {
  const client = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: process.env.NEO4J_DATABASE
  });

  try {
    for (const entity of EMBEDDINGS_CONFIG.entities) {
      for (const pipeline of entity.pipelines) {
        const rawDimension = pipeline.dimension ?? EMBEDDINGS_CONFIG.defaults?.dimension ?? 768;
        const dimension = Number.isFinite(rawDimension) ? Math.max(1, Math.trunc(Number(rawDimension))) : 768;
        const similarity = pipeline.similarity ?? EMBEDDINGS_CONFIG.defaults?.similarity ?? 'cosine';

        console.log(`Creating vector index ${pipeline.name} for ${entity.entity}.${pipeline.targetProperty} (dim=${dimension}, similarity=${similarity})`);

        await client.run(`DROP INDEX ${pipeline.name} IF EXISTS`);
        await client.run(
          `CREATE VECTOR INDEX ${pipeline.name} IF NOT EXISTS
           FOR (n:\`${entity.entity}\`)
           ON n.\`${pipeline.targetProperty}\`
           OPTIONS {
             indexConfig: {
               \`vector.dimensions\`: $dimension,
               \`vector.similarity_function\`: $similarity
             }
           }`,
          { dimension: neo4j.int(dimension), similarity }
        );
      }
    }

    console.log('✅ Vector indexes created successfully');
  } catch (error) {
    console.error('❌ Failed to create vector indexes', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void main();
