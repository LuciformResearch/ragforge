/**
 * Implements the `ragforge introspect` command.
 *
 * Produces a RagForge configuration and schema snapshot without
 * generating client code. Useful for inspecting domain detection
 * or preparing custom modifications before running `generate`.
 */

import path from 'path';
import process from 'process';
import YAML from 'yaml';
import {
  SchemaIntrospector,
  ConfigGenerator,
  type RagForgeConfig,
  type GraphSchema
} from '@luciformresearch/ragforge';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { prepareOutputDirectory, writeFileIfChanged } from '../utils/io.js';

export interface IntrospectOptions {
  uri: string;
  username: string;
  password: string;
  database?: string;
  project: string;
  outDir: string;
  configFile: string;
  schemaFile: string;
  force: boolean;
}

export function printIntrospectHelp(): void {
  console.log(`Usage:
  ragforge introspect [options]

Options:
  --uri <bolt-uri>        Neo4j Bolt URI (default: from env)
  --username <user>       Neo4j username
  --password <password>   Neo4j password
  --database <name>       Optional Neo4j database
  --project <name>        Project name (default: env RAGFORGE_PROJECT or ragforge-project)
  --out <dir>             Output directory (default: ./ragforge-<project>-schema)
  --config <file>         Config file name relative to --out (default: ragforge.config.yaml)
  --schema <file>         Schema file name relative to --out (default: schema.json)
  --force                 Overwrite existing files
  -h, --help              Show this message
`);
}

export function parseIntrospectOptions(args: string[]): IntrospectOptions {
  ensureEnvLoaded(import.meta.url);

  const opts: Partial<IntrospectOptions> = {
    force: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
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
      case '--project':
        opts.project = args[++i];
        break;
      case '--out':
        opts.outDir = args[++i];
        break;
      case '--config':
        opts.configFile = args[++i];
        break;
      case '--schema':
        opts.schemaFile = args[++i];
        break;
      case '--force':
        opts.force = true;
        break;
      case '-h':
      case '--help':
        printIntrospectHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option for introspect command: ${arg}`);
    }
  }

  const uri = opts.uri || getEnv(['NEO4J_URI', 'NEO4J_BOLT_URI']);
  const username = opts.username || getEnv(['NEO4J_USERNAME', 'NEO4J_USER']);
  const password = opts.password || getEnv(['NEO4J_PASSWORD', 'NEO4J_PASS']);
  const database = opts.database || getEnv(['NEO4J_DATABASE']);
  const project = opts.project || getEnv(['RAGFORGE_PROJECT']) || 'ragforge-project';
  const defaultOut = path.resolve(process.cwd(), `ragforge-${project}-schema`);
  const outDir = opts.outDir ? path.resolve(opts.outDir) : defaultOut;
  const configFile = opts.configFile || 'ragforge.config.yaml';
  const schemaFile = opts.schemaFile || 'schema.json';

  if (!uri) throw new Error('Missing Neo4j URI. Provide --uri or set NEO4J_URI.');
  if (!username) throw new Error('Missing Neo4j username. Provide --username or set NEO4J_USERNAME.');
  if (!password) throw new Error('Missing Neo4j password. Provide --password or set NEO4J_PASSWORD.');

  return {
    uri,
    username,
    password,
    database,
    project,
    outDir,
    configFile,
    schemaFile,
    force: opts.force ?? false
  };
}

async function persistOutputs(
  outDir: string,
  configFile: string,
  schemaFile: string,
  config: RagForgeConfig,
  schema: GraphSchema
): Promise<void> {
  const configPath = path.join(outDir, configFile);
  const schemaPath = path.join(outDir, schemaFile);

  await writeFileIfChanged(configPath, YAML.stringify(config, { indent: 2 }));
  await writeFileIfChanged(schemaPath, JSON.stringify(schema, null, 2));

  console.log(`📝  Config written to ${configPath}`);
  console.log(`🧩  Schema written to ${schemaPath}`);
}

export async function runIntrospect(options: IntrospectOptions): Promise<void> {
  ensureEnvLoaded(import.meta.url);

  console.log('🔎  Running RagForge introspection...\n');
  await prepareOutputDirectory(options.outDir, options.force);

  const introspector = new SchemaIntrospector(options.uri, options.username, options.password);

  let schema: GraphSchema;
  try {
    schema = await introspector.introspect(options.database);
  } finally {
    await introspector.close();
  }

  console.log(`✅  Schema introspected: ${schema.nodes.length} node types, ${schema.relationships.length} relationships.`);

  console.log('🧠  Generating config draft...');
  const config = ConfigGenerator.generate(schema, options.project);

  await persistOutputs(options.outDir, options.configFile, options.schemaFile, config, schema);

  console.log('\n✨  Introspection complete. You can now inspect the generated YAML and feed it to `ragforge generate`.');
}
