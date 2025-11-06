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
import { FieldDetector } from '../utils/field-detector.js';
import type { VectorIndexConfig, EntityConfig } from '@luciformresearch/ragforge-core';

export interface InitOptions {
  uri: string;
  username: string;
  password: string;
  database?: string;
  project: string;
  projectWasExplicit: boolean;  // Track if project name was explicitly provided
  outDir: string;
  outDirWasExplicit: boolean;  // Track if output dir was explicitly provided
  force: boolean;
  rootDir: string;
  geminiKey?: string;
  autoDetectFields: boolean;
}

export function printInitHelp(): void {
  console.log(`Usage:
  ragforge init [options]

Description:
  Complete RagForge setup: introspect Neo4j schema, generate config, and create TypeScript client.

Connection defaults from .env in current directory:
  NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE, GEMINI_API_KEY

Options:
  --uri <bolt-uri>        Neo4j Bolt URI (or NEO4J_URI from .env)
  --username <user>       Neo4j username (or NEO4J_USERNAME from .env)
  --password <password>   Neo4j password (or NEO4J_PASSWORD from .env)
  --database <name>       Neo4j database (or NEO4J_DATABASE from .env)
  --project <name>        Project name (default: current directory name)
  --out <dir>             Output directory (default: ./generated)
  --auto-detect-fields    Use LLM to detect best fields (needs GEMINI_API_KEY)
  --force                 Overwrite existing files
  -h, --help              Show this help

Examples:
  # Simple - uses .env in current directory
  ragforge init

  # With LLM field auto-detection
  ragforge init --auto-detect-fields

  # Custom project name and output
  ragforge init --project bookstore --out ./generated

  # Override connection (instead of .env)
  ragforge init --uri bolt://localhost:7687 --username neo4j --password secret --project myapp
`);
}

export async function parseInitOptions(args: string[]): Promise<InitOptions> {
  const rootDir = ensureEnvLoaded(import.meta.url);

  const options: Partial<InitOptions> = {
    force: false,
    autoDetectFields: false
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
      case '--auto-detect-fields':
        options.autoDetectFields = true;
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

  // Track if project name was explicitly provided (not from env or auto-derived)
  const projectWasExplicit = !!(options.project || envProject);
  // Track if output directory was explicitly provided
  const outDirWasExplicit = !!options.outDir;

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
    projectWasExplicit,
    outDir: naming.outputDir,
    outDirWasExplicit,
    force: options.force ?? false,
    rootDir,
    geminiKey,
    autoDetectFields: options.autoDetectFields ?? false
  };
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

function slugifyIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
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

  // Auto-detect project metadata if requested and not explicitly provided
  let projectName = options.project;
  let projectDescription: string | undefined;

  if (options.autoDetectFields && !options.projectWasExplicit) {
    if (!options.geminiKey) {
      throw new Error('--auto-detect-fields requires GEMINI_API_KEY. Add it to your .env file or set it in your environment.');
    }

    console.log('🤖  Auto-detecting project metadata using LLM...');
    const detector = new FieldDetector(options.uri, options.username, options.password, options.geminiKey);

    try {
      const entityNames = schema.nodes.map(node => node.label);
      const metadata = await detector.detectProjectMetadata(entityNames);
      projectName = metadata.name;
      projectDescription = metadata.description;
    } catch (error) {
      console.warn('⚠️  Failed to auto-detect project metadata, using default');
    } finally {
      await detector.close();
    }
  }

  // Determine final output directory
  // If outputDir wasn't explicitly provided and we have a detected project name, use it
  let finalOutputDir: string;
  if (!options.outDirWasExplicit && projectName !== options.project) {
    // Project name was auto-detected, use it for the output directory
    finalOutputDir = path.resolve(process.cwd(), projectName);
    console.log(`📁  Using output directory: ${finalOutputDir}`);
  } else {
    finalOutputDir = path.resolve(options.outDir);
  }

  await prepareOutputDirectory(finalOutputDir, options.force);

  console.log('🧠  Generating project config from schema...');
  let config = ConfigGenerator.generate(schema, projectName);

  // Update description if LLM provided one
  if (projectDescription) {
    config = {
      ...config,
      description: projectDescription
    };
  }

  // Auto-detect field mappings if requested
  if (options.autoDetectFields) {
    if (!options.geminiKey) {
      throw new Error('--auto-detect-fields requires GEMINI_API_KEY. Add it to your .env file or set it in your environment.');
    }

    const detector = new FieldDetector(options.uri, options.username, options.password, options.geminiKey);

    try {
      const mappings = await detector.detectFieldMappingsBatch(config.entities, options.database);

      // Update config with detected mappings
      config = {
        ...config,
        entities: config.entities.map(entity => {
          const detected = mappings.get(entity.name);
          if (detected) {
            console.log(`✅  ${entity.name}:`, {
              display_name_field: detected.display_name_field,
              unique_field: detected.unique_field,
              query_field: detected.query_field,
              example_display_fields: detected.example_display_fields,
              embedding_fields: detected.embedding_fields
            });
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

  await persistConfig(finalOutputDir, projectName, config, schema);

  console.log('🛠️  Generating TypeScript types and client...');
  const typesContent = TypeGenerator.generate(schema, config);
  const generated = CodeGenerator.generate(config, schema);

  await persistGeneratedArtifacts(
    finalOutputDir,
    generated,
    typesContent,
    options.rootDir,
    projectName
  );
  console.log(`📦  Generated client written to ${finalOutputDir}`);
  await writeGeneratedEnv(finalOutputDir, {
    uri: options.uri,
    username: options.username,
    password: options.password,
    database: options.database
  }, options.geminiKey);

  console.log('📥  Installing dependencies in generated project...');
  await installDependencies(finalOutputDir);
  console.log('✅  Dependencies installed.');

  console.log('\n✨  Init complete! Next steps:');
  console.log(`   - Review config: ${path.join(finalOutputDir, 'ragforge.config.yaml')}`);
  console.log(`   - Inspect generated client: ${path.join(finalOutputDir, 'client.ts')}`);
  console.log(`   - Explore documentation: ${path.join(finalOutputDir, 'docs/client-reference.md')}`);
  console.log(`   - Use the iterative agent helper: ${path.join(finalOutputDir, 'agent.ts')}`);
  console.log(`   - Neo4j env: ${path.join(finalOutputDir, '.env')}`);
  console.log('   - Update Neo4j credentials in your runtime config before running generated code.');
}
