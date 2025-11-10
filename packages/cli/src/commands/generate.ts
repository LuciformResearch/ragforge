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
import { spawn } from 'child_process';
import {
  ConfigLoader,
  TypeGenerator,
  CodeGenerator,
  SchemaIntrospector,
  ConfigGenerator,
  type RagForgeConfig,
  type GraphSchema,
  type VectorIndexConfig,
  type EntityConfig
} from '@luciformresearch/ragforge-core';
import YAML from 'yaml';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { prepareOutputDirectory, persistGeneratedArtifacts, writeGeneratedEnv, type ConnectionEnv } from '../utils/io.js';
import { ensureGeminiKey, validateGeminiSchema } from '../utils/gemini.js';
import { FieldDetector } from '../utils/field-detector.js';

export interface GenerateOptions {
  configPath: string;
  schemaPath?: string;
  outDir: string;
  force: boolean;
  rewriteConfig: boolean;
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
  rootDir: string;
  geminiKey?: string;
  autoDetectFields: boolean;
  dev: boolean;
}

export function printGenerateHelp(): void {
  console.log(`Usage:
  ragforge generate [options]

Options:
  --config <file>         Path to RagForge YAML config (default: ./ragforge.config.yaml)
  --schema <file>         Optional schema snapshot to skip live introspection
  --out <dir>             Output directory for ragforge.config.yaml + client (default: ./generated)
  --uri <bolt-uri>        Neo4j Bolt URI (required when --schema is omitted)
  --username <user>       Neo4j username (used when --schema is absent)
  --password <password>   Neo4j password (used when --schema is absent)
  --database <name>       Optional Neo4j database
  --force                 Recreate files managed by the generator even if they exist
  --rewrite-config        Regenerate ragforge.config.yaml from the current schema before emitting code
  --auto-detect-fields    Ask the LLM to refine display/query/embedding fields before generation
  --dev                   Development mode: use local file: dependencies instead of npm versions
  -h, --help              Show this message

Note: The CLI copies ragforge.config.yaml + schema.json into \`--out\` so embeddings scripts can run in isolation.

Common flows:
  ragforge generate --config ./ragforge.config.yaml --out ./generated
      Regenerate TypeScript artifacts from an existing YAML.

  ragforge generate --schema ./schema.json --config ./ragforge.config.yaml --out ./generated
      Use a saved schema snapshot (no live Neo4j connection needed).

  ragforge generate --config ./ragforge.config.yaml --force
      Force-overwrite any managed files, including the embeddings loader/scripts.

  ragforge generate --config ./ragforge.config.yaml --rewrite-config
      Reapply the heuristic config generator to refresh ragforge.config.yaml before codegen.

  ragforge generate --config ./ragforge.config.yaml --auto-detect-fields
      Run the LLM field detector (needs GEMINI_API_KEY and Neo4j creds) before writing files.
`);
}

export function parseGenerateOptions(args: string[]): GenerateOptions {
  const rootDir = ensureEnvLoaded(import.meta.url);
  const geminiKey = getEnv(['GEMINI_API_KEY'], true); // Only from local .env

  const opts: Partial<GenerateOptions> = {
    force: false,
    rewriteConfig: false,
    autoDetectFields: false,
    dev: false
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
      case '--rewrite-config':
        opts.rewriteConfig = true;
        break;
      case '--auto-detect-fields':
        opts.autoDetectFields = true;
        break;
      case '--dev':
        opts.dev = true;
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
    rewriteConfig: opts.rewriteConfig ?? false,
    uri: opts.uri,
    username: opts.username,
    password: opts.password,
    database: opts.database,
    rootDir,
    geminiKey,
    autoDetectFields: opts.autoDetectFields ?? false,
    dev: opts.dev ?? false
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

async function installDependencies(outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install'], {
      cwd: outDir,
      stdio: 'inherit',
      shell: true
    });

    proc.on('exit', code => {
      if (code === 0) {
        console.log('✅ Dependencies installed successfully\n');
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });

    proc.on('error', error => {
      reject(new Error(`Failed to run npm install: ${error.message}`));
    });
  });
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  ensureEnvLoaded(import.meta.url);

  console.log('⚙️  RagForge generate starting...\n');

  let config = await ConfigLoader.load(options.configPath);

  const { schema, connection } = await loadSchema(options, config);
  validateGeminiSchema(schema);
  console.log(`✅  Using schema with ${schema.nodes.length} node types`);

  if (options.rewriteConfig) {
    console.log('🧠  Rewriting ragforge.config.yaml from current schema...');
    const projectName = config.name || path.basename(path.dirname(options.configPath)) || 'ragforge-project';
    const regenerated = ConfigGenerator.generate(schema, projectName);
    const yamlContent = YAML.stringify(regenerated, { indent: 2 });
    await fs.writeFile(options.configPath, yamlContent, 'utf-8');
    config = regenerated;
    console.log(`📝  Updated ${options.configPath}`);
  }

  // Auto-detect field mappings if requested
  if (options.autoDetectFields) {
    const conn = connection ?? resolveConnection(options, config);
    if (!conn) {
      throw new Error('--auto-detect-fields requires Neo4j connection. Pass --uri/--username/--password or use .env file.');
    }

    if (!options.geminiKey) {
      throw new Error('--auto-detect-fields requires GEMINI_API_KEY. Add it to your .env file or set it in your environment.');
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
            const mergedVectorIndexes = mergeVectorIndexes(entity, detected.embedding_fields || []);
            return {
              ...entity,
              display_name_field: detected.display_name_field,
              unique_field: detected.unique_field,
              query_field: detected.query_field,
              example_display_fields: detected.example_display_fields,
              vector_index: mergedVectorIndexes[0],
              vector_indexes: mergedVectorIndexes.length ? mergedVectorIndexes : undefined
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

  await prepareOutputDirectory(options.outDir, options.force);
  await persistGeneratedArtifacts(
    options.outDir,
    generated,
    typesContent,
    options.rootDir,
    config.name,
    options.dev
  );
  await syncProjectConfigArtifacts(options.outDir, options.configPath, schema, options.schemaPath);

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

  // Auto-install dependencies
  console.log('\n📦 Installing dependencies...');
  await installDependencies(options.outDir);

  // Show next steps
  printNextSteps(config, generated, connectionForEnv !== null);
}

function printNextSteps(config: RagForgeConfig, generated: any, hasConnection: boolean): void {
  console.log('\n' + '='.repeat(60));
  console.log('📋 Next Steps:');
  console.log('='.repeat(60) + '\n');

  let step = 1;

  // Step 1: Environment setup
  if (!hasConnection) {
    console.log(`${step}. Set up your environment variables:`);
    console.log('   echo "NEO4J_URI=bolt://localhost:7687" >> .env');
    console.log('   echo "NEO4J_USERNAME=neo4j" >> .env');
    console.log('   echo "NEO4J_PASSWORD=your-password" >> .env');
    console.log('   echo "NEO4J_DATABASE=neo4j" >> .env');
    if (generated.embeddings || generated.summarization) {
      console.log('   echo "GEMINI_API_KEY=your-key" >> .env');
    }
    console.log('');
    step++;
  }

  // Step 3: Vector indexes (if embeddings configured)
  if (generated.embeddings) {
    console.log(`${step}. Create vector indexes:`);
    console.log('   npm run embeddings:index');
    console.log('');
    step++;

    console.log(`${step}. Generate embeddings:`);
    console.log('   npm run embeddings:generate');
    console.log('   # Or limit for testing: npm run embeddings:generate -- --limit=10');
    console.log('');
    step++;
  }

  // Step 4: Summaries (if configured)
  if (generated.summarization) {
    console.log(`${step}. Generate field summaries:`);
    console.log('   npm run summaries:generate');
    console.log('   # Or limit for testing: npm run summaries:generate -- --limit=20');
    console.log('');
    step++;
  }

  // Step 5: Test
  console.log(`${step}. Test your setup:`);
  console.log('   # Create a test script, e.g.:');
  console.log('   # import { createRagClient } from \'./client.js\';');
  console.log('   # const client = createRagClient();');
  console.log('   # const results = await client.scope().limit(5).execute();');
  console.log('');

  // Documentation links
  console.log('📚 Documentation:');
  console.log('   - Client API: ./docs/client-reference.md');
  console.log('   - Agent API: ./docs/agent-reference.md');

  if (generated.embeddings || generated.summarization) {
    console.log('\n💡 Tips:');
    if (generated.embeddings) {
      console.log('   - Vector search requires Neo4j 5.15+ for VECTOR INDEX support');
    }
    if (generated.summarization) {
      console.log('   - Summaries improve LLM reranking by providing structured context');
      console.log('   - Use preferSummary: true in EntityContext to use summaries over raw fields');
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

function mergeVectorIndexes(entity: EntityConfig, embeddingFields: string[]): VectorIndexConfig[] {
  const baseIndexes: VectorIndexConfig[] = [];
  if (entity.vector_indexes && entity.vector_indexes.length > 0) {
    baseIndexes.push(...entity.vector_indexes);
  } else if (entity.vector_index) {
    baseIndexes.push(entity.vector_index);
  }

  const bySource = new Map<string, VectorIndexConfig>();
  for (const idx of baseIndexes) {
    if (idx?.source_field) {
      bySource.set(idx.source_field, idx);
    }
  }

  for (const field of embeddingFields) {
    const trimmed = field?.trim();
    if (!trimmed || bySource.has(trimmed)) {
      continue;
    }
    bySource.set(trimmed, createVectorIndexFromField(entity.name, trimmed));
  }

  return Array.from(bySource.values());
}

function createVectorIndexFromField(entityName: string, field: string): VectorIndexConfig {
  const entitySlug = slugifyIdentifier(entityName);
  const fieldSlug = slugifyIdentifier(field) || 'field';

  return {
    name: `${entitySlug}_${fieldSlug}_embeddings`,
    field: `embedding_${fieldSlug}`,
    source_field: field,
    dimension: 768,
    similarity: 'cosine',
    provider: 'gemini',
    model: 'gemini-embedding-001'
  };
}

async function syncProjectConfigArtifacts(
  outDir: string,
  sourceConfigPath: string,
  schema: GraphSchema,
  schemaPath?: string
): Promise<void> {
  const targetConfig = path.join(outDir, 'ragforge.config.yaml');
  if (path.resolve(targetConfig) !== path.resolve(sourceConfigPath)) {
    await fs.copyFile(sourceConfigPath, targetConfig);
  }

  const targetSchema = path.join(outDir, 'schema.json');
  if (schemaPath && path.resolve(schemaPath) !== path.resolve(targetSchema)) {
    await fs.copyFile(schemaPath, targetSchema);
  } else if (!schemaPath) {
    await fs.writeFile(targetSchema, JSON.stringify(schema, null, 2));
  }
}

function slugifyIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}
