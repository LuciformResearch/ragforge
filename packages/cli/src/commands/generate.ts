/**
 * Implements the `ragforge generate` command.
 *
 * Regenerates TypeScript client artifacts from an existing RagForge
 * configuration. Optionally re-introspects Neo4j when no schema
 * snapshot is provided.
 */

import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import {
  ConfigLoader,
  TypeGenerator,
  CodeGenerator,
  SchemaIntrospector,
  type RagForgeConfig,
  type GraphSchema
} from '@luciformresearch/ragforge-core';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { prepareOutputDirectory, persistGeneratedArtifacts, writeGeneratedEnv, type ConnectionEnv } from '../utils/io.js';
import { ensureGeminiKey, validateGeminiSchema } from '../utils/gemini.js';
import { FieldDetector } from '../utils/field-detector.js';

export interface GenerateOptions {
  configPath: string;
  schemaPath?: string;
  outDir: string;
  force: boolean;
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
  rootDir: string;
  geminiKey: string;
  preserveEmbeddingsConfig: boolean;
  autoDetectFields: boolean;
}

export function printGenerateHelp(): void {
  console.log(`Usage:
  ragforge generate [options]

Options:
  --config <file>         Path to RagForge YAML config (default: ./ragforge.config.yaml)
  --schema <file>         Optional schema JSON snapshot. If omitted, introspection runs.
  --out <dir>             Output directory for generated client (default: ./generated)
  --uri <bolt-uri>        Neo4j Bolt URI (used when --schema is absent)
  --username <user>       Neo4j username (used when --schema is absent)
  --password <password>   Neo4j password (used when --schema is absent)
  --database <name>       Optional Neo4j database
  --force                 Overwrite output directory when not empty
  --reset-embeddings-config     Regenerate generated/embeddings/load-config.js even if it exists
  --auto-detect-fields    Use LLM to auto-detect optimal field mappings (display_name_field, unique_field, etc.)
  -h, --help              Show this message
`);
}

export function parseGenerateOptions(args: string[]): GenerateOptions {
  const rootDir = ensureEnvLoaded(import.meta.url);
  const geminiKey = ensureGeminiKey(getEnv(['GEMINI_API_KEY']));

  const opts: Partial<GenerateOptions> = {
    force: false,
    preserveEmbeddingsConfig: true,
    autoDetectFields: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--config':
        opts.configPath = args[++i];
        break;
      case '--schema':
        opts.schemaPath = args[++i];
        break;
      case '--out':
        opts.outDir = args[++i];
        break;
      case '--uri':
        opts.uri = args[++i];
        break;
      case '--username':
        opts.username = args[++i];
        break;
      case '--password':
        opts.password = args[++i];
        break;
      case '--database':
        opts.database = args[++i];
        break;
      case '--force':
        opts.force = true;
        break;
      case '--reset-embeddings-config':
        opts.preserveEmbeddingsConfig = false;
        break;
      case '--auto-detect-fields':
        opts.autoDetectFields = true;
        break;
      case '-h':
      case '--help':
        printGenerateHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option for generate command: ${arg}`);
    }
  }

  const configPath = path.resolve(opts.configPath || 'ragforge.config.yaml');
  const outDir = opts.outDir ? path.resolve(opts.outDir) : path.resolve(process.cwd(), 'generated');
  const schemaPath = opts.schemaPath ? path.resolve(opts.schemaPath) : undefined;

  return {
    configPath,
    schemaPath,
    outDir,
    force: opts.force ?? false,
    uri: opts.uri,
    username: opts.username,
    password: opts.password,
    database: opts.database,
    rootDir,
    geminiKey,
    preserveEmbeddingsConfig: opts.preserveEmbeddingsConfig ?? false,
    autoDetectFields: opts.autoDetectFields ?? false
  };
}

function isPlaceholder(value?: string): boolean {
  return value ? /^\$\{.+\}$/.test(value) : false;
}

function resolveConnection(
  options: GenerateOptions,
  config: RagForgeConfig
): ConnectionEnv | undefined {
  const uri = options.uri
    || (!isPlaceholder(config.neo4j.uri) ? config.neo4j.uri : undefined)
    || getEnv(['NEO4J_URI', 'NEO4J_BOLT_URI']);
  const username = options.username
    || (!isPlaceholder(config.neo4j.username) ? config.neo4j.username : undefined)
    || getEnv(['NEO4J_USERNAME', 'NEO4J_USER']);
  const password = options.password
    || (!isPlaceholder(config.neo4j.password) ? config.neo4j.password : undefined)
    || getEnv(['NEO4J_PASSWORD', 'NEO4J_PASS']);
  const database = options.database
    || (!isPlaceholder(config.neo4j.database) ? config.neo4j.database : undefined)
    || getEnv(['NEO4J_DATABASE']);

  if (uri && username && password) {
    return { uri, username, password, database };
  }

  return undefined;
}

async function loadSchema(
  options: GenerateOptions,
  config: RagForgeConfig
): Promise<{ schema: GraphSchema; connection?: ConnectionEnv }> {
  if (options.schemaPath) {
    const raw = await fs.readFile(options.schemaPath, 'utf-8');
    return { schema: JSON.parse(raw) as GraphSchema, connection: resolveConnection(options, config) };
  }

  const connection = resolveConnection(options, config);

  if (!connection) {
    throw new Error('Schema path not provided and Neo4j credentials unavailable. Pass --uri/--username/--password or create a .env file with NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.');
  }

  console.log('🛰️  Re-introspecting Neo4j to obtain schema...');
  const introspector = new SchemaIntrospector(connection.uri, connection.username, connection.password);

  try {
    const schema = await introspector.introspect(connection.database);
    return { schema, connection };
  } finally {
    await introspector.close();
  }
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  ensureEnvLoaded(import.meta.url);

  console.log('⚙️  RagForge generate starting...\n');

  let config = await ConfigLoader.load(options.configPath);

  const { schema, connection } = await loadSchema(options, config);
  validateGeminiSchema(schema);
  console.log(`✅  Using schema with ${schema.nodes.length} node types`);

  // Auto-detect field mappings if requested
  if (options.autoDetectFields) {
    const conn = connection ?? resolveConnection(options, config);
    if (!conn) {
      throw new Error('--auto-detect-fields requires Neo4j connection. Pass --uri/--username/--password or use .env file.');
    }

    const detector = new FieldDetector(conn.uri, conn.username, conn.password, options.geminiKey);

    try {
      const mappings = await detector.detectFieldMappingsBatch(config.entities, conn.database);

      // Update config with detected mappings
      config = {
        ...config,
        entities: config.entities.map(entity => {
          const detected = mappings.get(entity.name);
          if (detected) {
            return {
              ...entity,
              display_name_field: detected.display_name_field,
              unique_field: detected.unique_field,
              query_field: detected.query_field,
              example_display_fields: detected.example_display_fields
            };
          }
          return entity;
        })
      };
    } finally {
      await detector.close();
    }
  }

  const typesContent = TypeGenerator.generate(schema, config);
  const generated = CodeGenerator.generate(config, schema);

  let preservedEmbeddingsConfig: string | undefined;
  if (options.preserveEmbeddingsConfig) {
    try {
      preservedEmbeddingsConfig = await fs.readFile(path.join(options.outDir, 'embeddings', 'load-config.js'), 'utf-8');
    } catch {
      preservedEmbeddingsConfig = undefined;
    }
  }
  await prepareOutputDirectory(options.outDir, options.force);
  await persistGeneratedArtifacts(
    options.outDir,
    generated,
    typesContent,
    options.rootDir,
    config.name,
    options.preserveEmbeddingsConfig,
    preservedEmbeddingsConfig
  );

  console.log(`\n✨  Generation complete. Artifacts available in ${options.outDir}`);
  console.log(`   - Client: ${path.join(options.outDir, 'client.ts')}`);
  console.log(`   - Agent wrapper: ${path.join(options.outDir, 'agent.ts')}`);
  console.log(`   - Documentation: ${path.join(options.outDir, 'docs/client-reference.md')}`);

  const connectionForEnv = connection ?? resolveConnection(options, config);
  if (connectionForEnv) {
    await writeGeneratedEnv(options.outDir, connectionForEnv, options.geminiKey);
    console.log(`   - Neo4j env: ${path.join(options.outDir, '.env')}`);
  } else {
    console.log('   - Neo4j env: skipped (credentials not available)');
  }
}
