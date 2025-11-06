import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Neo4jClient,
  GeminiEmbeddingProvider,
  runEmbeddingPipelines
} from '@luciformresearch/ragforge-runtime';

import { EMBEDDINGS_CONFIG } from '../embeddings/load-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to generate embeddings.');
  }

  const client = new Neo4jClient({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: process.env.NEO4J_DATABASE
  });

  const defaults = EMBEDDINGS_CONFIG.defaults ?? {};
  const providerCache = new Map();

  const getProvider = (model, dimension) => {
    const resolvedModel = model ?? defaults.model;
    const resolvedDimension = dimension ?? defaults.dimension;
    const cacheKey = `${resolvedModel ?? 'default'}::${resolvedDimension ?? 'none'}`;

    if (providerCache.has(cacheKey)) {
      return providerCache.get(cacheKey);
    }

    const provider = new GeminiEmbeddingProvider({
      apiKey,
      model: resolvedModel,
      dimension: resolvedDimension
    });

    providerCache.set(cacheKey, provider);
    return provider;
  };

  try {
    for (const entity of EMBEDDINGS_CONFIG.entities) {
      console.log(`🔄 Generating embeddings for ${entity.entity}`);
      for (const pipeline of entity.pipelines) {
        const provider = getProvider(pipeline.model, pipeline.dimension);
        await runEmbeddingPipelines({
          neo4j: client,
          entity: {
            entity: entity.entity,
            pipelines: [pipeline]
          },
          provider,
          defaults: EMBEDDINGS_CONFIG.defaults
        });
      }
    }

    console.log('✅ Embeddings generated successfully');
  } catch (error) {
    console.error('❌ Failed to generate embeddings', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
