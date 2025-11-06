/**
 * Implements the `ragforge init` command.
 *
 * Responsibilities:
 * - Introspect a Neo4j database
 * - Generate a RagForge config (YAML) and persist it
 * - Generate client code + types via CodeGenerator / TypeGenerator
 * - Persist raw schema (JSON) for reference
 */

import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import YAML from 'yaml';
import {
  SchemaIntrospector,
  ConfigGenerator,
  TypeGenerator,
  CodeGenerator,
  type RagForgeConfig,
  type GraphSchema
} from '@luciformresearch/ragforge-core';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import {
  prepareOutputDirectory,
  writeFileIfChanged,
  persistGeneratedArtifacts,
  writeGeneratedEnv,
  installDependencies
} from '../utils/io.js';
import { deriveProjectNaming } from '../utils/project-name.js';
import { ensureGeminiKey, validateGeminiSchema } from '../utils/gemini.js';

export interface InitOptions {
  uri: string;
  username: string;
  password: string;
  database?: string;
  project: string;
  outDir: string;
  force: boolean;
  rootDir: string;
  geminiKey?: string;
}

export function printInitHelp(): void {
  console.log(`Usage:
  ragforge init --uri <bolt-uri> --username <user> --password <password> --project <name> [options]

Options:
  --uri <bolt-uri>        Neo4j Bolt URI (e.g. bolt://localhost:7687)
  --username <user>       Neo4j username
  --password <password>   Neo4j password
  --database <name>       Optional database (defaults to Neo4j default)
  --project <name>        Project name used for generated artifacts
  --out <dir>             Output directory (default: ./ragforge-<project>)
  --force                 Recreate the entire project tree even if files already exist
  -h, --help              Show this help

Note: All artefacts—including ragforge.config.yaml and the TypeScript client—are written directly to \`--out\`.

Examples:
  ragforge init --uri bolt://localhost:7687 --username neo4j --password secret \\
                --project my-rag --out ./ragforge-my-rag

  ragforge init --project demo --out ./ragforge-demo --force
      Useful when re-initializing a playground directory and you want fresh templates.
`);
}

export async function parseInitOptions(args: string[]): Promise<InitOptions> {
  const rootDir = ensureEnvLoaded(import.meta.url);

  const options: Partial<InitOptions> = {
    force: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    switch (arg) {
      case '--uri':
        options.uri = args[++i];
        break;
      case '--username':
        options.username = args[++i];
        break;
      case '--password':
        options.password = args[++i];
        break;
      case '--database':
        options.database = args[++i];
        break;
      case '--project':
        options.project = args[++i];
        break;
      case '--out':
        options.outDir = args[++i];
        break;
      case '--force':
        options.force = true;
        break;
      case '-h':
      case '--help':
        printInitHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option for init command: ${arg}`);
    }
  }

  const envUri = getEnv(['NEO4J_URI', 'NEO4J_BOLT_URI']);
  const envUser = getEnv(['NEO4J_USERNAME', 'NEO4J_USER']);
  const envPass = getEnv(['NEO4J_PASSWORD', 'NEO4J_PASS']);
  const envDatabase = getEnv(['NEO4J_DATABASE']);
  const envProject = getEnv(['RAGFORGE_PROJECT']);
  const geminiKey = getEnv(['GEMINI_API_KEY'], true); // Only from local .env

  const uri = options.uri || envUri;
  const username = options.username || envUser;
  const password = options.password || envPass;
  const database = options.database || envDatabase;
  const naming = await deriveProjectNaming(options.project || envProject, options.outDir);
  const project = naming.project;

  if (!uri) {
    throw new Error('Missing Neo4j URI. Provide --uri or create a .env file with NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.');
  }
  if (!username) {
    throw new Error('Missing Neo4j username. Provide --username or create a .env file with NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.');
  }
  if (!password) {
    throw new Error('Missing Neo4j password. Provide --password or create a .env file with NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.');
  }
  if (!project) throw new Error('Missing project name. Provide --project or set RAGFORGE_PROJECT.');

  return {
    uri,
    username,
    password,
    database,
    project,
    outDir: naming.outputDir,
    force: options.force ?? false,
    rootDir,
    geminiKey
  };
}

async function persistConfig(outDir: string, project: string, config: RagForgeConfig, schema: GraphSchema): Promise<void> {
  const configPath = path.join(outDir, 'ragforge.config.yaml');
  const schemaPath = path.join(outDir, 'schema.json');

  await writeFileIfChanged(configPath, YAML.stringify(config, { indent: 2 }));
  await writeFileIfChanged(schemaPath, JSON.stringify(schema, null, 2));

  console.log(`📝  Config saved to ${configPath}`);
  console.log(`🧩  Schema snapshot saved to ${schemaPath}`);
}

export async function runInit(options: InitOptions): Promise<void> {
  ensureEnvLoaded(import.meta.url);

  console.log('🚀  RagForge init starting...\n');

  const outputDir = path.resolve(options.outDir);
  await prepareOutputDirectory(outputDir, options.force);

  console.log(`🔌  Connecting to Neo4j at ${options.uri}...`);
  const introspector = new SchemaIntrospector(options.uri, options.username, options.password);

  let schema: GraphSchema;
  try {
    schema = await introspector.introspect(options.database);
  } finally {
    await introspector.close();
  }

  console.log(`✅  Schema introspected: ${schema.nodes.length} node types, ${schema.relationships.length} relationships.`);

  validateGeminiSchema(schema);

  console.log('🧠  Generating project config from schema...');
  const config = ConfigGenerator.generate(schema, options.project);

  await persistConfig(outputDir, options.project, config, schema);

  console.log('🛠️  Generating TypeScript types and client...');
  const typesContent = TypeGenerator.generate(schema, config);
  const generated = CodeGenerator.generate(config, schema);

  await persistGeneratedArtifacts(
    outputDir,
    generated,
    typesContent,
    options.rootDir,
    options.project
  );
  console.log(`📦  Generated client written to ${outputDir}`);
  await writeGeneratedEnv(outputDir, {
    uri: options.uri,
    username: options.username,
    password: options.password,
    database: options.database
  }, options.geminiKey);

  console.log('📥  Installing dependencies in generated project...');
  await installDependencies(outputDir);
  console.log('✅  Dependencies installed.');

  console.log('\n✨  Init complete! Next steps:');
  console.log(`   - Review config: ${path.join(outputDir, 'ragforge.config.yaml')}`);
  console.log(`   - Inspect generated client: ${path.join(outputDir, 'client.ts')}`);
  console.log(`   - Explore documentation: ${path.join(outputDir, 'docs/client-reference.md')}`);
  console.log(`   - Use the iterative agent helper: ${path.join(outputDir, 'agent.ts')}`);
  console.log(`   - Neo4j env: ${path.join(outputDir, '.env')}`);
  console.log('   - Update Neo4j credentials in your runtime config before running generated code.');
}
