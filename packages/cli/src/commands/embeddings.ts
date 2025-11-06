import path from 'path';
import process from 'process';
import { ConfigLoader, SchemaIntrospector } from '@luciformresearch/ragforge-core';
import {
  Neo4jClient,
  runEmbeddingPipelines,
  GeminiEmbeddingProvider
} from '@luciformresearch/ragforge-runtime';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { ensureGeminiKey, validateGeminiSchema } from '../utils/gemini.js';
import { toRuntimeEmbeddingsConfig } from '../utils/embedding-transform.js';

interface EmbeddingOptions {
  configPath: string;
  uri: string;
  username: string;
  password: string;
  database?: string;
  rootDir: string;
  geminiKey: string;
}

export async function parseEmbeddingsOptions(args: string[]): Promise<EmbeddingOptions> {
  const rootDir = ensureEnvLoaded(import.meta.url);

  let configPath: string | undefined;
  let uri: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let database: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--config':
        configPath = args[++i];
        break;
      case '--uri':
        uri = args[++i];
        break;
      case '--username':
        username = args[++i];
        break;
      case '--password':
        password = args[++i];
        break;
      case '--database':
        database = args[++i];
        break;
      case '-h':
      case '--help':
        printEmbeddingsHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option for embeddings command: ${arg}`);
    }
  }

  const envUri = getEnv(['NEO4J_URI', 'NEO4J_BOLT_URI']);
  const envUser = getEnv(['NEO4J_USERNAME', 'NEO4J_USER']);
  const envPass = getEnv(['NEO4J_PASSWORD', 'NEO4J_PASS']);
  const envDatabase = getEnv(['NEO4J_DATABASE']);
  const geminiKey = ensureGeminiKey(getEnv(['GEMINI_API_KEY']));

  const finalUri = uri || envUri;
  const finalUsername = username || envUser;
  const finalPassword = password || envPass;

  if (!finalUri) {
    throw new Error('Missing Neo4j URI. Provide --uri or set NEO4J_URI.');
  }
  if (!finalUsername) {
    throw new Error('Missing Neo4j username. Provide --username or set NEO4J_USERNAME.');
  }
  if (!finalPassword) {
    throw new Error('Missing Neo4j password. Provide --password or set NEO4J_PASSWORD.');
  }

  return {
    configPath: path.resolve(configPath || 'ragforge.config.yaml'),
    uri: finalUri,
    username: finalUsername,
    password: finalPassword,
    database: database || envDatabase,
    rootDir,
    geminiKey
  };
}

export function printEmbeddingsHelp(): void {
  console.log(`Usage:
  ragforge embeddings:index [options]
  ragforge embeddings:generate [options]

Options:
  --config <file>    Path to ragforge.config.yaml (default: ./ragforge.config.yaml)
  --uri <bolt-uri>   Neo4j Bolt URI
  --username <user>  Neo4j username
  --password <pass>  Neo4j password
  --database <name>  Neo4j database (optional)
`);
}

export async function runEmbeddingsIndex(options: EmbeddingOptions): Promise<void> {
  const config = await ConfigLoader.load(options.configPath);
  const embeddingsConfig = toRuntimeEmbeddingsConfig(config.embeddings);
  if (!embeddingsConfig) {
    throw new Error('Embeddings section is missing in configuration.');
  }

  const client = new Neo4jClient({
    uri: options.uri,
    username: options.username,
    password: options.password,
    database: options.database
  });

  try {
    for (const entity of embeddingsConfig.entities) {
      for (const pipeline of entity.pipelines) {
        const dimension = pipeline.dimension ?? embeddingsConfig.defaults?.dimension ?? 768;
        const similarity = pipeline.similarity ?? embeddingsConfig.defaults?.similarity ?? 'cosine';

        console.log(`Creating vector index ${pipeline.name} for ${entity.entity}.${pipeline.targetProperty}`);
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
          { dimension, similarity }
        );
      }
    }

    console.log('✅ Vector indexes created successfully');
  } finally {
    await client.close();
  }
}

export async function runEmbeddingsGenerate(options: EmbeddingOptions): Promise<void> {
  const config = await ConfigLoader.load(options.configPath);
  const embeddingsConfig = toRuntimeEmbeddingsConfig(config.embeddings);
  if (!embeddingsConfig) {
    throw new Error('Embeddings section is missing in configuration.');
  }

  // Optional: validate schema compatibility
  const introspector = new SchemaIntrospector(options.uri, options.username, options.password);
  try {
    const schema = await introspector.introspect(options.database);
    validateGeminiSchema(schema);
  } finally {
    await introspector.close();
  }

  const client = new Neo4jClient({
    uri: options.uri,
    username: options.username,
    password: options.password,
    database: options.database
  });

  const provider = new GeminiEmbeddingProvider({
    apiKey: options.geminiKey,
    model: embeddingsConfig.defaults?.model,
    dimension: embeddingsConfig.defaults?.dimension
  });

  try {
    for (const entity of embeddingsConfig.entities) {
      console.log(`🔄 Generating embeddings for ${entity.entity}`);
      await runEmbeddingPipelines({
        neo4j: client,
        entity,
        provider,
        defaults: embeddingsConfig.defaults
      });
    }

    console.log('✅ Embeddings generated successfully');
  } finally {
    await client.close();
  }
}
