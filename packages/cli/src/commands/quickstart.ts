/**
 * Implements the `ragforge quickstart` command.
 *
 * Quick setup for code RAG projects with sensible defaults.
 * This command:
 * 1. Auto-detects project type (TypeScript, Python, etc.)
 * 2. Creates minimal config or expands existing one
 * 3. Merges with adapter-specific defaults
 * 4. Writes expanded YAML with comments (educational)
 * 5. Sets up Docker Compose for Neo4j
 * 6. Generates TypeScript client
 * 7. Optionally runs ingestion and embeddings
 */

import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import YAML from 'yaml';
import {
  CodeGenerator,
  TypeGenerator,
  mergeWithDefaults,
  writeConfigWithDefaults,
  type RagForgeConfig,
  type GraphSchema,
  SchemaIntrospector
} from '@luciformresearch/ragforge-core';
import {
  CodeSourceAdapter,
  type SourceConfig,
  Neo4jClient
} from '@luciformresearch/ragforge-runtime';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import {
  prepareOutputDirectory,
  writeFileIfChanged,
  persistGeneratedArtifacts,
  writeGeneratedEnv,
  installDependencies
} from '../utils/io.js';
import { deriveProjectNaming } from '../utils/project-name.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface QuickstartOptions {
  sourceType?: 'code' | 'documents' | 'chat';  // Type of source (for future multi-domain support)
  language?: string;     // typescript, python, javascript (alias for adapter)
  adapter?: string;      // DEPRECATED: use language instead
  root?: string;         // Root directory to analyze (overrides cwd)
  ingest?: boolean;      // Run initial ingestion (default: true)
  embeddings?: boolean;  // Generate embeddings after ingest (default: false)
  force?: boolean;       // Overwrite existing config
  rootDir: string;       // Root directory for the generated client
  geminiKey?: string;    // Gemini API key for embeddings/summarization
}

export function printQuickstartHelp(): void {
  console.log(`Usage:
  ragforge quickstart [options]

Description:
  One-command setup for code RAG with everything included!

  The RagForge workspace (config, Docker, generated client) is created in the
  current directory. Use --root to specify a different source code location.

  This command will:
  ✓ Auto-detect your project type (TypeScript, Python, etc.)
  ✓ Create or expand your ragforge.config.yaml with best practices
  ✓ Set up and launch Neo4j with Docker Compose
  ✓ Clean/reset the database
  ✓ Parse and ingest your codebase into Neo4j
  ✓ Generate TypeScript client for querying your code
  ✓ Create vector indexes and generate embeddings (enabled by default)

Environment variables (from .env):
  GEMINI_API_KEY       Required for embeddings and summarization
  NEO4J_URI            Neo4j connection (default: bolt://localhost:7687)
  NEO4J_USERNAME       Neo4j username (default: neo4j)
  NEO4J_PASSWORD       Neo4j password (will be auto-generated if missing)

Options:
  --source-type <type> Source type: code, documents, chat (default: code)
  --root <path>        Source code directory to analyze (default: current directory)
  --language <lang>    Force language: typescript, python, javascript, go (auto-detected if omitted)
  --adapter <type>     DEPRECATED: use --language instead
  --no-ingest          Skip code ingestion (default: ingestion enabled)
  --no-embeddings      Skip embeddings generation (default: embeddings enabled)
  --force              Overwrite existing configuration
  -h, --help           Show this help

Examples:
  # Analyze code in current directory (workspace = source)
  ragforge quickstart

  # Separate workspace: analyze code from ../my-project, generate files here
  mkdir ragforge-analysis && cd ragforge-analysis
  ragforge quickstart --root ../my-project

  # Explicit language and source type
  ragforge quickstart --source-type code --language typescript --root /path/to/code

  # Skip embeddings for faster setup (semantic search won't work)
  ragforge quickstart --no-embeddings

  # Setup only (no ingestion, no embeddings)
  ragforge quickstart --no-ingest --no-embeddings
`);
}

export async function parseQuickstartOptions(args: string[]): Promise<QuickstartOptions> {
  const rootDir = ensureEnvLoaded(import.meta.url);

  const options: Partial<QuickstartOptions> = {
    sourceType: 'code',  // Default to code
    ingest: true,        // Default: run ingestion
    embeddings: true,    // Default: generate embeddings (can be slow but enables semantic search)
    force: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    switch (arg) {
      case '--source-type':
        options.sourceType = args[++i] as 'code' | 'documents' | 'chat';
        break;
      case '--root':
        options.root = args[++i];
        break;
      case '--language':
        options.language = args[++i];
        break;
      case '--adapter':
        // DEPRECATED: support for backward compatibility
        options.adapter = args[++i];
        console.warn('⚠️  --adapter is deprecated, use --language instead');
        break;
      case '--ingest':
        options.ingest = true;
        break;
      case '--no-ingest':
        options.ingest = false;
        break;
      case '--embeddings':
        options.embeddings = true;
        break;
      case '--no-embeddings':
        options.embeddings = false;
        break;
      case '--force':
        options.force = true;
        break;
      case '-h':
      case '--help':
        printQuickstartHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option for quickstart command: ${arg}`);
    }
  }

  // Validate source type
  if (options.sourceType && !['code', 'documents', 'chat'].includes(options.sourceType)) {
    throw new Error(`Invalid --source-type: ${options.sourceType}. Must be one of: code, documents, chat`);
  }

  const geminiKey = getEnv(['GEMINI_API_KEY'], true);

  // Merge language and adapter (backward compat)
  const finalLanguage = options.language || options.adapter;

  return {
    sourceType: options.sourceType ?? 'code',
    language: finalLanguage,
    adapter: finalLanguage, // Keep for backward compat
    root: options.root,
    ingest: options.ingest ?? true,
    embeddings: options.embeddings ?? true,
    force: options.force ?? false,
    rootDir,
    geminiKey
  };
}

/**
 * Auto-detect project adapter type (typescript, python, javascript, etc.)
 */
async function detectAdapter(projectPath: string): Promise<string | null> {
  // 1. Check package.json for Node.js projects
  const pkgPath = path.join(projectPath, 'package.json');
  try {
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    // TypeScript detection
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      return 'typescript';
    }

    // Check tsconfig.json as secondary signal
    try {
      await fs.access(path.join(projectPath, 'tsconfig.json'));
      return 'typescript';
    } catch {
      // No tsconfig
    }

    // Default to JavaScript for Node.js projects
    return 'javascript';
  } catch {
    // No package.json, try other languages
  }

  // 2. Check Python
  try {
    await fs.access(path.join(projectPath, 'pyproject.toml'));
    return 'python';
  } catch {
    // No pyproject.toml
  }

  try {
    await fs.access(path.join(projectPath, 'requirements.txt'));
    return 'python';
  } catch {
    // No requirements.txt
  }

  // 3. Check Go
  try {
    await fs.access(path.join(projectPath, 'go.mod'));
    return 'go';
  } catch {
    // No go.mod
  }

  return null;
}

/**
 * Check if config file already exists
 */
async function checkExistingConfig(projectPath: string): Promise<{ exists: boolean; path: string }> {
  const configPath = path.join(projectPath, 'ragforge.config.yaml');
  try {
    await fs.access(configPath);
    return { exists: true, path: configPath };
  } catch {
    return { exists: false, path: configPath };
  }
}

/**
 * Detect if source path is a monorepo
 */
async function isMonorepo(sourcePath: string): Promise<boolean> {
  // Check for monorepo indicators in source path or parent
  const indicators = [
    'lerna.json',
    'pnpm-workspace.yaml',
    'nx.json',
    'turbo.json'
  ];

  // Check in source path
  for (const indicator of indicators) {
    try {
      await fs.access(path.join(sourcePath, indicator));
      return true;
    } catch {
      // File doesn't exist
    }
  }

  // Check in parent directory
  const parentDir = path.dirname(sourcePath);
  for (const indicator of indicators) {
    try {
      await fs.access(path.join(parentDir, indicator));
      return true;
    } catch {
      // File doesn't exist
    }
  }

  // Check if sourcePath itself contains multiple package.json files (direct monorepo)
  try {
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    let packageCount = 0;
    for (const dir of subdirs) {
      try {
        await fs.access(path.join(sourcePath, dir.name, 'package.json'));
        packageCount++;
        if (packageCount >= 2) {
          return true; // Found 2+ packages, it's a monorepo
        }
      } catch {
        // No package.json in this directory
      }
    }
  } catch {
    // Can't read directory
  }

  // Check if there's a "packages" subdirectory with multiple packages
  try {
    const packagesDir = path.join(sourcePath, 'packages');
    await fs.access(packagesDir);
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    const subdirs = entries.filter(e => e.isDirectory());
    // If there are multiple subdirectories, likely a monorepo
    return subdirs.length >= 2;
  } catch {
    // No packages directory
  }

  return false;
}

/**
 * Create minimal config for new projects
 */
async function createMinimalConfig(
  projectName: string,
  adapter: string,
  sourcePath: string
): Promise<Partial<RagForgeConfig>> {
  // Check if this is a monorepo
  const monorepo = await isMonorepo(sourcePath);

  // Patterns for simple projects (src at root)
  const simplePatterns: { [key: string]: string[] } = {
    typescript: ['src/**/*.ts', 'lib/**/*.ts'],
    javascript: ['src/**/*.js', 'lib/**/*.js'],
    python: ['src/**/*.py', '**/*.py']
  };

  // Patterns for monorepos (src anywhere in tree)
  const monorepoPatterns: { [key: string]: string[] } = {
    typescript: ['**/src/**/*.ts', '**/lib/**/*.ts'],
    javascript: ['**/src/**/*.js', '**/lib/**/*.js'],
    python: ['**/src/**/*.py', '**/*.py']
  };

  const includePatterns = monorepo ? monorepoPatterns : simplePatterns;

  return {
    name: projectName,
    version: '1.0.0',
    description: `RAG-enabled codebase for ${projectName}`,
    source: {
      type: 'code',
      adapter: adapter as 'typescript' | 'python',
      root: sourcePath, // Absolute path to source code
      include: includePatterns[adapter] || (monorepo ? ['**/*.ts'] : ['src/**/*'])
    },
    neo4j: {
      uri: '${NEO4J_URI}',
      database: 'neo4j',
      username: '${NEO4J_USERNAME}',
      password: '${NEO4J_PASSWORD}'
    }
  };
}

/**
 * Main quickstart command implementation
 */
export async function runQuickstart(options: QuickstartOptions): Promise<void> {
  ensureEnvLoaded(import.meta.url);

  console.log('🚀 RagForge Quickstart');
  console.log('═'.repeat(60));
  console.log('');

  // Separate workspace (where RagForge project is generated) from source (code to analyze)
  const workspacePath = process.cwd(); // Current directory = RagForge workspace
  const sourcePath = options.root ? path.resolve(options.root) : workspacePath;

  // Validate that the source path exists
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Source directory does not exist: ${sourcePath}`);
  }

  console.log(`📁 Workspace: ${workspacePath}`);
  if (sourcePath !== workspacePath) {
    console.log(`📂 Source code: ${sourcePath}`);
  }
  console.log('');

  // Step 1: Check for existing config in workspace
  const { exists: configExists, path: configPath } = await checkExistingConfig(workspacePath);

  if (configExists && !options.force) {
    console.log('⚠️  Configuration already exists:', configPath);
    console.log('   Use --force to overwrite, or manually edit your config.');
    console.log('');
    return;
  }

  // Step 2: Load config or determine adapter
  let userConfig: Partial<RagForgeConfig> = {};
  let adapter: string = options.adapter || '';

  if (configExists) {
    console.log('📖 Loading existing config...');
    const content = await fs.readFile(configPath, 'utf-8');
    userConfig = YAML.parse(content);

    // Get adapter from config if available
    if (userConfig.source?.adapter) {
      adapter = userConfig.source.adapter;
      console.log(`✓ Using adapter from config: ${adapter}`);
    }
  } else {
    console.log('📝 Creating new config...');
  }

  // Step 3: Detect or validate adapter if still not set
  if (!adapter) {
    console.log('🔍 Auto-detecting project type...');
    const detected = await detectAdapter(sourcePath);
    if (!detected) {
      throw new Error(
        'Could not auto-detect project type. Please specify with --language (typescript, python, javascript)'
      );
    }
    adapter = detected;
    console.log(`✓ Detected ${adapter} project`);
  }

  // Step 4: Create minimal config if new project
  if (!configExists) {
    const projectName = path.basename(sourcePath);
    userConfig = await createMinimalConfig(projectName, adapter, sourcePath);
  }

  console.log('');

  // Step 5: Merge with defaults
  console.log('🔧 Merging with adapter-specific defaults...');
  const mergedConfig = await mergeWithDefaults(userConfig);
  console.log(`✓ Config expanded with ${adapter} defaults`);
  console.log('');

  // Step 6: Write expanded YAML with educational comments
  console.log('💾 Writing expanded configuration...');
  await writeConfigWithDefaults(configPath, userConfig, mergedConfig);
  console.log(`✓ Configuration saved to: ${configPath}`);
  console.log('   Fields marked as "auto-added" come from adapter defaults');
  console.log('');

  // Step 7: Check if Docker container already exists
  const containerName = `ragforge-${mergedConfig.name}-neo4j`;
  const containerExists = await checkContainerExists(containerName);

  // Step 8: Setup Neo4j credentials (smart detection)
  const envPath = path.join(workspacePath, '.env');
  let neo4jPassword = '';
  let existingEnvContent = '';
  let needsNeo4jCredentials = false;

  // Check if .env exists and load it
  try {
    existingEnvContent = await fs.readFile(envPath, 'utf-8');
    console.log('✓ Found existing .env file');

    // Reload env vars
    ensureEnvLoaded(import.meta.url);

    // Check if Neo4j credentials are present
    const hasNeo4jUri = getEnv(['NEO4J_URI'], true);
    const hasNeo4jPassword = getEnv(['NEO4J_PASSWORD'], true);

    if (!hasNeo4jUri || !hasNeo4jPassword) {
      needsNeo4jCredentials = true;
      console.log('   Neo4j credentials not found, will generate them');
    } else {
      neo4jPassword = hasNeo4jPassword;
      // If container exists, we must reuse existing password
      if (containerExists) {
        console.log('   Reusing existing Neo4j credentials for existing container');
      }
    }
  } catch {
    // .env doesn't exist, we'll create it
    needsNeo4jCredentials = true;
  }

  // Generate and add Neo4j credentials if needed (only for NEW containers)
  if (needsNeo4jCredentials && !containerExists) {
    console.log('🔐 Generating Neo4j credentials...');
    neo4jPassword = generatePassword();

    let newEnvContent = '';

    if (existingEnvContent) {
      // Append to existing .env
      newEnvContent = existingEnvContent.trim() + '\n\n';
      newEnvContent += '# Neo4j Configuration (auto-generated by quickstart)\n';
    } else {
      // Create new .env
      newEnvContent = '# RagForge Environment Configuration\n\n';
      newEnvContent += '# LLM API Keys\n';
      newEnvContent += '# GEMINI_API_KEY=your-api-key-here\n\n';
      newEnvContent += '# Neo4j Configuration (auto-generated by quickstart)\n';
    }

    newEnvContent += `NEO4J_URI=bolt://localhost:7687\n`;
    newEnvContent += `NEO4J_DATABASE=neo4j\n`;
    newEnvContent += `NEO4J_USERNAME=neo4j\n`;
    newEnvContent += `NEO4J_PASSWORD=${neo4jPassword}\n`;

    await fs.writeFile(envPath, newEnvContent, 'utf-8');
    console.log(`✓ Neo4j credentials added to .env`);
    console.log('');
  } else if (needsNeo4jCredentials && containerExists) {
    // Container exists but no credentials in .env - this shouldn't happen but handle it
    throw new Error('Container exists but no Neo4j credentials found in .env. Please remove the container or add credentials to .env');
  }

  // Reload .env to ensure we have the latest values
  ensureEnvLoaded(import.meta.url);
  let neo4jUri = getEnv(['NEO4J_URI'], true) || 'bolt://localhost:7687';
  const neo4jUsername = getEnv(['NEO4J_USERNAME'], true) || 'neo4j';
  const neo4jDatabase = getEnv(['NEO4J_DATABASE'], true) || 'neo4j';
  const geminiKey = getEnv(['GEMINI_API_KEY'], true);

  // IMPORTANT: Reload password from env after writing .env file
  // The password might have been generated and written to .env, so we need to read it back
  const envPassword = getEnv(['NEO4J_PASSWORD'], true);
  if (envPassword && envPassword !== neo4jPassword) {
    console.log(`🔍 DEBUG: Password mismatch! Variable: ${neo4jPassword.substring(0, 3)}***, Env: ${envPassword.substring(0, 3)}***`);
    neo4jPassword = envPassword;
  }
  console.log(`🔍 DEBUG: Using password: ${neo4jPassword.substring(0, 3)}*** from ${envPassword ? 'env' : 'variable'}`);

  // Step 9: Setup Docker container (reuse existing or create new)
  const dockerInfo = await setupDockerContainer(workspacePath, mergedConfig.name);

  // Update .env with correct URI if ports changed
  if (dockerInfo.uri !== neo4jUri) {
    console.log(`   Updating .env with correct URI: ${dockerInfo.uri}`);
    neo4jUri = dockerInfo.uri;

    // Read current .env and update NEO4J_URI
    const currentEnv = await fs.readFile(envPath, 'utf-8');
    const updatedEnv = currentEnv.replace(
      /NEO4J_URI=.*/,
      `NEO4J_URI=${dockerInfo.uri}`
    );
    await fs.writeFile(envPath, updatedEnv, 'utf-8');
  }
  console.log('');

  // Step 9: Wait for Neo4j to be ready
  await waitForNeo4j(neo4jUri, neo4jUsername, neo4jPassword);

  // Add extra wait time for Neo4j to fully initialize auth system
  // Neo4j might accept connection but still be configuring passwords
  console.log('   Waiting for Neo4j auth system to stabilize...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  console.log('');

  // Step 10: Clean existing database
  await cleanDatabase(neo4jUri, neo4jUsername, neo4jPassword, neo4jDatabase);
  console.log('');

  // Step 11: Ingest code if requested (default: true)
  if (options.ingest && mergedConfig.source) {
    await parseAndIngestCode(
      mergedConfig.source as SourceConfig,
      neo4jUri,
      neo4jUsername,
      neo4jPassword,
      neo4jDatabase
    );
  } else if (!mergedConfig.source) {
    console.warn('⚠️  No source configuration found, skipping ingestion');
  }

  // Step 12: Generate TypeScript client
  const generatedPath = await generateClient(
    mergedConfig,
    workspacePath,
    neo4jUri,
    neo4jUsername,
    neo4jPassword,
    neo4jDatabase,
    geminiKey
  );

  // Step 13: Copy config to generated folder with absolute paths
  const generatedConfigPath = path.join(generatedPath, 'ragforge.config.yaml');

  // Read the config and convert relative paths to absolute
  const configContent = await fs.readFile(configPath, 'utf-8');
  const configForGenerated = YAML.parse(configContent);

  // Convert root path to absolute if it's relative
  if (configForGenerated.source?.root) {
    const rootPath = configForGenerated.source.root;
    if (!path.isAbsolute(rootPath)) {
      // Resolve relative to workspace, not to generated/
      configForGenerated.source.root = path.resolve(workspacePath, rootPath);
    }
  }

  // Write adjusted config
  await fs.writeFile(generatedConfigPath, YAML.stringify(configForGenerated), 'utf-8');
  console.log('✓ Config copied to generated folder (paths adjusted)');

  // Step 14: Create vector indexes and generate embeddings if requested
  if (options.embeddings) {
    if (!geminiKey) {
      console.warn('⚠️  GEMINI_API_KEY not found, skipping embeddings generation');
      console.warn('   Add GEMINI_API_KEY to .env and run:');
      console.warn(`   cd ${generatedPath}`);
      console.warn('   npm run embeddings:index     # Create vector indexes');
      console.warn('   npm run embeddings:generate  # Generate embeddings');
    } else {
      await createVectorIndexes(generatedPath);
      await generateEmbeddings(generatedPath);
    }
  }

  // Step 15: Success message
  console.log('');
  console.log('🎉 Quickstart complete!');
  console.log('═'.repeat(60));
  console.log('');
  console.log('✅ Your RAG-enabled codebase is ready!');
  console.log('');
  console.log('📁 Generated files:');
  console.log(`   • Config:         ${configPath}`);
  console.log(`   • Client:         ${generatedPath}`);
  console.log(`   • Docker Compose: ${path.join(workspacePath, 'docker-compose.yml')}`);
  console.log(`   • Environment:    ${envPath}`);
  console.log('');

  if (options.ingest) {
    console.log('✅ Code ingestion: Complete');
  }
  if (options.embeddings && geminiKey) {
    console.log('✅ Vector indexes: Created');
    console.log('✅ Embeddings: Generated (semantic search enabled)');
  } else if (!geminiKey) {
    console.log('⚠️  Embeddings: Skipped (no GEMINI_API_KEY found)');
  } else if (!options.embeddings) {
    console.log('⚠️  Embeddings: Skipped (disabled with --no-embeddings)');
  }
  console.log('');

  console.log('🚀 Quick start:');
  console.log(`   cd ${generatedPath}`);
  console.log('   npm run query    # Start querying your code!');
  console.log('');
  console.log('🔧 Useful commands:');
  console.log('   npm run ingest              # Re-ingest code after changes');
  if (!options.embeddings || !geminiKey) {
    console.log('   npm run embeddings:index    # Create vector indexes');
    console.log('   npm run embeddings:generate # Generate embeddings');
  }
  console.log('   npm run watch               # Watch for code changes');
  console.log('');
  console.log('📚 Neo4j Browser: http://localhost:' + dockerInfo.http);
  console.log(`🔌 Neo4j Bolt:    ${neo4jUri}`);
  console.log('');
}

/**
 * Generate random password for Neo4j
 */
function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Generate docker-compose.yml for Neo4j with project-specific container name
 */
async function generateDockerCompose(
  projectPath: string,
  projectName: string,
  boltPort: number,
  httpPort: number
): Promise<void> {
  const containerName = `ragforge-${projectName}-neo4j`;

  const dockerComposeContent = `version: '3.8'

services:
  neo4j:
    image: neo4j:5.23-community
    container_name: ${containerName}
    environment:
      NEO4J_AUTH: \${NEO4J_USERNAME:-neo4j}/\${NEO4J_PASSWORD}
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_server_memory_heap_initial__size: 512m
      NEO4J_server_memory_heap_max__size: 2G
      NEO4J_dbms_security_procedures_unrestricted: apoc.*
    ports:
      - "${boltPort}:7687"  # Bolt
      - "${httpPort}:7474"  # HTTP Browser
    volumes:
      - ${projectName}_neo4j_data:/data
      - ${projectName}_neo4j_logs:/logs
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "\${NEO4J_USERNAME:-neo4j}", "-p", "\${NEO4J_PASSWORD}", "RETURN 1"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  ${projectName}_neo4j_data:
  ${projectName}_neo4j_logs:
`;

  const dockerComposePath = path.join(projectPath, 'docker-compose.yml');
  await fs.writeFile(dockerComposePath, dockerComposeContent, 'utf-8');
}

/**
 * Check if a port is available (checks both system and Docker)
 */
async function isPortAvailable(port: number): Promise<boolean> {
  try {
    // Check if port is in use by ANY process (using ss which doesn't require sudo)
    const { stdout: ssOut } = await execAsync(`ss -tuln | grep ':${port} ' || echo ""`);
    if (ssOut.trim().length > 0) {
      return false; // Port in use
    }

    // Fallback: Check with lsof (might not see all processes without sudo)
    const { stdout: lsofOut } = await execAsync(`lsof -i :${port} -t 2>/dev/null || echo ""`);
    if (lsofOut.trim().length > 0) {
      return false; // Port in use by system process
    }

    // Check if port is configured in any Docker container (running or not)
    // This is necessary because Docker won't allow two containers to have the same port binding
    const { stdout: dockerOut } = await execAsync(
      `docker ps -a --format "{{.ID}}" | xargs -I {} docker inspect {} --format '{{.HostConfig.PortBindings}}' 2>/dev/null | grep -E " ${port}\\}" || echo ""`
    );
    if (dockerOut.trim().length > 0) {
      return false; // Port configured in Docker container
    }

    return true;
  } catch {
    // If command fails, assume port is available
    return true;
  }
}

/**
 * Find available ports for Neo4j (Bolt and HTTP)
 */
async function findAvailablePorts(): Promise<{ bolt: number; http: number }> {
  const startBolt = 7687;
  const startHttp = 7474;

  for (let i = 0; i < 20; i++) {
    const boltPort = startBolt + i;
    const httpPort = startHttp + i;

    const boltAvailable = await isPortAvailable(boltPort);
    const httpAvailable = await isPortAvailable(httpPort);

    if (boltAvailable && httpAvailable) {
      return { bolt: boltPort, http: httpPort };
    }
  }

  throw new Error('Could not find available ports for Neo4j. Please free up ports 7687-7706 or 7474-7493.');
}

/**
 * Check if a Docker container exists
 */
async function checkContainerExists(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker ps -a --filter name=^${containerName}$ --format "{{.Names}}"`);
    return stdout.trim() === containerName;
  } catch {
    return false;
  }
}

/**
 * Check if a Docker container is running
 */
async function checkContainerRunning(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker ps --filter name=^${containerName}$ --format "{{.Names}}"`);
    return stdout.trim() === containerName;
  } catch {
    return false;
  }
}

/**
 * Get container ports from Docker
 */
async function getContainerPorts(containerName: string): Promise<{ bolt: number; http: number } | null> {
  try {
    const { stdout } = await execAsync(`docker port ${containerName}`);
    const lines = stdout.trim().split('\n');

    let boltPort = 7687;
    let httpPort = 7474;

    for (const line of lines) {
      // Format: "7687/tcp -> 0.0.0.0:7687"
      if (line.includes('7687/tcp')) {
        const match = line.match(/:(\d+)$/);
        if (match) boltPort = parseInt(match[1]);
      }
      if (line.includes('7474/tcp')) {
        const match = line.match(/:(\d+)$/);
        if (match) httpPort = parseInt(match[1]);
      }
    }

    return { bolt: boltPort, http: httpPort };
  } catch {
    return null;
  }
}

/**
 * Check if Docker is installed and running
 */
async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup and launch Docker container for Neo4j (reuses existing or creates new)
 */
async function setupDockerContainer(
  projectPath: string,
  projectName: string
): Promise<{ bolt: number; http: number; uri: string }> {
  console.log('🐳 Setting up Neo4j container...');

  // Check if Docker is available
  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not installed or not running. Please install Docker and try again.');
  }

  const containerName = `ragforge-${projectName}-neo4j`;

  // Check if container already exists
  const containerExists = await checkContainerExists(containerName);
  const containerRunning = containerExists ? await checkContainerRunning(containerName) : false;

  let boltPort: number;
  let httpPort: number;

  if (containerExists) {
    console.log(`✓ Found existing container: ${containerName}`);

    // Get existing ports
    const ports = await getContainerPorts(containerName);
    if (ports) {
      boltPort = ports.bolt;
      httpPort = ports.http;
      console.log(`✓ Using existing ports: ${boltPort} (Bolt), ${httpPort} (HTTP)`);
    } else {
      // Fallback to default if we can't detect
      boltPort = 7687;
      httpPort = 7474;
    }

    if (!containerRunning) {
      console.log('   Starting existing container...');
      try {
        await execAsync(`docker start ${containerName}`);
        console.log('✓ Container started');
      } catch (error: any) {
        console.warn(`⚠️  Failed to start existing container: ${error.message}`);
        console.log('   Will try to recreate container...');
        // Remove old container and continue to create new one
        try {
          await execAsync(`docker rm -f ${containerName}`);
        } catch {
          // Ignore
        }
        return setupDockerContainer(projectPath, projectName); // Retry
      }
    } else {
      console.log('✓ Container already running');
    }
  } else {
    // Container doesn't exist, find available ports and create new one
    console.log('   Finding available ports...');
    const availablePorts = await findAvailablePorts();
    boltPort = availablePorts.bolt;
    httpPort = availablePorts.http;
    console.log(`✓ Found available ports: ${boltPort} (Bolt), ${httpPort} (HTTP)`);

    // Generate docker-compose with these ports
    await generateDockerCompose(projectPath, projectName, boltPort, httpPort);
    console.log('✓ Generated docker-compose.yml');

    // Start Docker Compose with explicit env vars
    console.log('   Starting Docker Compose...');
    try {
      // Read .env to get the password we just generated
      const envContent = await fs.readFile(path.join(projectPath, '.env'), 'utf-8');
      const envVars: { [key: string]: string } = {};

      // Parse .env file
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            envVars[key] = valueParts.join('=');
          }
        }
      }

      // DEBUG: Show password being passed to docker
      if (envVars.NEO4J_PASSWORD) {
        console.log(`🔍 DEBUG: Docker will use password from .env: ${envVars.NEO4J_PASSWORD.substring(0, 3)}***`);
      }

      // Merge with current env and launch docker compose
      await execAsync('docker compose up -d', {
        cwd: projectPath,
        env: { ...process.env, ...envVars }
      });
      console.log('✓ Container created and started');
    } catch (error: any) {
      throw new Error(`Failed to start Docker Compose: ${error.message}`);
    }
  }

  const uri = `bolt://localhost:${boltPort}`;
  return { bolt: boltPort, http: httpPort, uri };
}

/**
 * Wait for Neo4j to be ready
 *
 * IMPORTANT: We only check if the port is open, NOT auth.
 * Auth verification attempts can trigger rate limiting before the password is fully configured.
 */
async function waitForNeo4j(uri: string, username: string, password: string, maxRetries = 30): Promise<void> {
  console.log('⏳ Waiting for Neo4j to be ready...');

  // Extract port from URI (bolt://localhost:7687 -> 7687)
  const port = parseInt(uri.split(':').pop() || '7687');
  const host = uri.includes('localhost') ? 'localhost' : uri.split('//')[1].split(':')[0];

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Just check if port is open with a simple TCP connection
      await execAsync(`timeout 1 bash -c 'cat < /dev/null > /dev/tcp/${host}/${port}'`);
      console.log('✓ Neo4j port is open');
      return;
    } catch {
      // Wait 1 second before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Neo4j did not become ready in time. Check Docker logs: docker compose logs neo4j');
}

/**
 * Drop/clean existing database with retry logic
 */
async function cleanDatabase(uri: string, username: string, password: string, database?: string, maxRetries = 10): Promise<void> {
  console.log('🗑️  Cleaning existing data...');
  console.log(`🔍 DEBUG: Connecting with uri=${uri}, username=${username}, password=${password.substring(0, 3)}***, database=${database}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = new Neo4jClient({ uri, username, password, database });

    try {
      console.log(`🔍 DEBUG: Attempt ${attempt}/${maxRetries} - Verifying connectivity...`);
      await client.verifyConnectivity();
      console.log(`🔍 DEBUG: Connectivity verified, running delete query...`);

      // Delete all code-related nodes
      await client.run('MATCH (n) WHERE n:Scope OR n:File OR n:Directory OR n:ExternalLibrary OR n:Project DETACH DELETE n');

      console.log('✓ Database cleaned');
      await client.close();
      return; // Success
    } catch (error: any) {
      console.log(`🔍 DEBUG: Attempt ${attempt} failed with error: ${error.message}`);
      console.log(`🔍 DEBUG: Error code: ${error.code}, name: ${error.name}`);
      await client.close();

      // If this was the last retry, throw the error
      if (attempt === maxRetries) {
        throw new Error(`Failed to clean database after ${maxRetries} attempts: ${error.message}`);
      }

      // Otherwise, wait with exponential backoff before retrying
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 seconds
      if (attempt === 1) {
        // Only show message on first retry to avoid clutter
        process.stdout.write('   Waiting for database to be ready');
      } else {
        process.stdout.write('.');
      }
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  console.log(''); // New line after dots
}

/**
 * Parse and ingest source code into Neo4j
 */
async function parseAndIngestCode(
  sourceConfig: SourceConfig,
  uri: string,
  username: string,
  password: string,
  database?: string
): Promise<void> {
  console.log('\n📦 Parsing and ingesting source code...');
  console.log(`📁 Root: ${sourceConfig.root || process.cwd()}`);
  console.log(`📝 Adapter: ${sourceConfig.adapter}`);

  // Create appropriate adapter
  const adapter = new CodeSourceAdapter(sourceConfig.adapter as 'typescript' | 'python');

  // Validate config
  const validation = await adapter.validate(sourceConfig);
  if (!validation.valid) {
    throw new Error(`Source config validation failed: ${validation.errors?.join(', ')}`);
  }

  if (validation.warnings && validation.warnings.length > 0) {
    validation.warnings.forEach(warning => console.warn(`⚠️  ${warning}`));
  }

  // Parse source with progress reporting
  const parseResult = await adapter.parse({
    source: sourceConfig,
    onProgress: (progress) => {
      const percent = Math.round(progress.percentComplete);
      if (progress.phase === 'discovering') {
        process.stdout.write(`\r🔎 Discovering files...`);
      } else if (progress.phase === 'parsing') {
        process.stdout.write(`\r📄 Parsing ${progress.filesProcessed}/${progress.totalFiles} files (${percent}%)    `);
      } else if (progress.phase === 'building_graph') {
        process.stdout.write(`\r🏗️  Building graph structure...`);
      }
    }
  });

  console.log(''); // New line after progress
  const { graph } = parseResult;
  console.log(`✅ Parsed ${graph.metadata.filesProcessed} files → ${graph.metadata.nodesGenerated} nodes, ${graph.metadata.relationshipsGenerated} relationships`);

  // Connect to Neo4j and ingest graph
  console.log(`💾 Ingesting graph into Neo4j...`);
  const client = new Neo4jClient({ uri, username, password, database });

  try {
    await client.verifyConnectivity();

    // Create schema (indexes and constraints)
    console.log(`📋 Creating indexes and constraints...`);
    await client.run('CREATE CONSTRAINT scope_uuid IF NOT EXISTS FOR (s:Scope) REQUIRE s.uuid IS UNIQUE');
    await client.run('CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE');
    await client.run('CREATE CONSTRAINT directory_path IF NOT EXISTS FOR (d:Directory) REQUIRE d.path IS UNIQUE');
    await client.run('CREATE CONSTRAINT external_library_name IF NOT EXISTS FOR (e:ExternalLibrary) REQUIRE e.name IS UNIQUE');
    await client.run('CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE');
    await client.run('CREATE INDEX scope_name IF NOT EXISTS FOR (s:Scope) ON (s.name)');
    await client.run('CREATE INDEX scope_type IF NOT EXISTS FOR (s:Scope) ON (s.type)');
    await client.run('CREATE INDEX scope_file IF NOT EXISTS FOR (s:Scope) ON (s.file)');
    console.log(`✓ Schema created`);

    // Create nodes with batching
    const BATCH_SIZE = 500;
    const scopeNodes = graph.nodes.filter(n => n.labels.includes('Scope'));
    const fileNodes = graph.nodes.filter(n => n.labels.includes('File'));
    const directoryNodes = graph.nodes.filter(n => n.labels.includes('Directory'));
    const externalLibraryNodes = graph.nodes.filter(n => n.labels.includes('ExternalLibrary'));
    const projectNodes = graph.nodes.filter(n => n.labels.includes('Project'));

    console.log(`📝 Creating ${graph.nodes.length} nodes...`);

    // Batch create Scope nodes
    for (let i = 0; i < scopeNodes.length; i += BATCH_SIZE) {
      const batch = scopeNodes.slice(i, i + BATCH_SIZE);
      await client.run(
        `UNWIND $nodes AS node
         MERGE (n:Scope {uuid: node.uuid})
         SET n += node`,
        { nodes: batch.map(n => n.properties) }
      );
      process.stdout.write(`\r  ↳ Scopes: ${Math.min(i + BATCH_SIZE, scopeNodes.length)}/${scopeNodes.length}    `);
    }
    console.log('');

    // Batch create File nodes
    for (let i = 0; i < fileNodes.length; i += BATCH_SIZE) {
      const batch = fileNodes.slice(i, i + BATCH_SIZE);
      await client.run(
        `UNWIND $nodes AS node
         MERGE (n:File {path: node.path})
         SET n += node`,
        { nodes: batch.map(n => n.properties) }
      );
      process.stdout.write(`\r  ↳ Files: ${Math.min(i + BATCH_SIZE, fileNodes.length)}/${fileNodes.length}    `);
    }
    console.log('');

    // Batch create Directory nodes
    for (let i = 0; i < directoryNodes.length; i += BATCH_SIZE) {
      const batch = directoryNodes.slice(i, i + BATCH_SIZE);
      await client.run(
        `UNWIND $nodes AS node
         MERGE (n:Directory {path: node.path})
         SET n += node`,
        { nodes: batch.map(n => n.properties) }
      );
    }

    // Batch create ExternalLibrary nodes
    for (let i = 0; i < externalLibraryNodes.length; i += BATCH_SIZE) {
      const batch = externalLibraryNodes.slice(i, i + BATCH_SIZE);
      await client.run(
        `UNWIND $nodes AS node
         MERGE (n:ExternalLibrary {name: node.name})
         SET n += node`,
        { nodes: batch.map(n => n.properties) }
      );
    }

    // Batch create Project nodes
    for (let i = 0; i < projectNodes.length; i += BATCH_SIZE) {
      const batch = projectNodes.slice(i, i + BATCH_SIZE);
      await client.run(
        `UNWIND $nodes AS node
         MERGE (n:Project {name: node.name})
         SET n += node`,
        { nodes: batch.map(n => n.properties) }
      );
    }

    // Create relationships
    console.log(`🔗 Creating ${graph.relationships.length} relationships...`);

    const getNodeType = (id: string): string => {
      if (id.startsWith('file:')) return 'file';
      if (id.startsWith('dir:')) return 'dir';
      if (id.startsWith('lib:')) return 'lib';
      if (id.startsWith('project:')) return 'project';
      return 'scope';
    };

    const getNodeInfo = (type: string): { label: string; key: string } => {
      switch (type) {
        case 'file': return { label: 'File', key: 'path' };
        case 'dir': return { label: 'Directory', key: 'path' };
        case 'lib': return { label: 'ExternalLibrary', key: 'name' };
        case 'project': return { label: 'Project', key: 'name' };
        default: return { label: 'Scope', key: 'uuid' };
      }
    };

    const stripPrefix = (id: string): string => {
      return id.replace(/^(file:|dir:|lib:|project:)/, '');
    };

    // Group relationships by type
    const relsByType = new Map<string, typeof graph.relationships>();
    for (const rel of graph.relationships) {
      const fromType = getNodeType(rel.from);
      const toType = getNodeType(rel.to);
      const key = `${rel.type}:${fromType}:${toType}`;
      if (!relsByType.has(key)) {
        relsByType.set(key, []);
      }
      relsByType.get(key)!.push(rel);
    }

    // Batch create relationships by type
    let totalRelsCreated = 0;
    for (const [key, rels] of relsByType) {
      const [relType, fromType, toType] = key.split(':');

      for (let i = 0; i < rels.length; i += BATCH_SIZE) {
        const batch = rels.slice(i, i + BATCH_SIZE);
        const batchData = batch.map(rel => ({
          from: stripPrefix(rel.from),
          to: stripPrefix(rel.to),
          props: rel.properties || {}
        }));

        const fromInfo = getNodeInfo(fromType);
        const toInfo = getNodeInfo(toType);

        await client.run(
          `UNWIND $batch AS rel
           MATCH (a:${fromInfo.label} {${fromInfo.key}: rel.from})
           MATCH (b:${toInfo.label} {${toInfo.key}: rel.to})
           MERGE (a)-[r:${relType}]->(b)
           SET r += rel.props`,
          { batch: batchData }
        );

        totalRelsCreated += batch.length;
        process.stdout.write(`\r  ↳ ${totalRelsCreated}/${graph.relationships.length} relationships    `);
      }
    }
    console.log('');

    console.log(`✅ Ingestion complete!`);
  } finally {
    await client.close();
  }
}

/**
 * Generate TypeScript client from config
 */
async function generateClient(
  config: RagForgeConfig,
  projectPath: string,
  uri: string,
  username: string,
  password: string,
  database?: string,
  geminiKey?: string
): Promise<string> {
  console.log('\n🛠️  Generating TypeScript client...');

  // Introspect schema
  const introspector = new SchemaIntrospector(uri, username, password);
  let schema: GraphSchema;

  try {
    schema = await introspector.introspect(database);
  } finally {
    await introspector.close();
  }

  console.log(`✓ Schema introspected: ${schema.nodes.length} node types, ${schema.relationships.length} relationships`);

  // Determine output directory
  const naming = await deriveProjectNaming(config.name, undefined);
  const outputDir = path.resolve(projectPath, naming.outputDir);

  // Prepare directory
  await prepareOutputDirectory(outputDir, true);

  // Calculate ragforge root for dev mode
  let ragforgeRoot: string | undefined;
  let devMode = false;

  // Check if we're running from dist/esm (development mode)
  const currentFileUrl = import.meta.url;
  const currentFilePath = new URL(currentFileUrl).pathname;
  if (currentFilePath.includes('/dist/esm/')) {
    const distEsmDir = path.dirname(currentFilePath);
    ragforgeRoot = path.resolve(distEsmDir, '../../../..');
    devMode = true;
    console.log('✓ Development mode detected, using local dependencies');
  }

  // Generate types and code
  const typesContent = TypeGenerator.generate(schema, config);
  const generated = CodeGenerator.generate(config, schema);

  // Persist artifacts
  await persistGeneratedArtifacts(
    outputDir,
    generated,
    typesContent,
    ragforgeRoot,
    config.name,
    devMode
  );

  // Write .env
  await writeGeneratedEnv(outputDir, {
    uri,
    username,
    password,
    database
  }, geminiKey);

  console.log(`✓ Client generated in: ${outputDir}`);

  // Install dependencies
  console.log('📥 Installing dependencies...');
  await installDependencies(outputDir);
  console.log('✓ Dependencies installed');

  return outputDir;
}

/**
 * Create vector indexes for embeddings
 */
async function createVectorIndexes(generatedPath: string): Promise<void> {
  console.log('\n📊 Creating vector indexes...');

  try {
    const { stdout } = await execAsync('npm run embeddings:index', {
      cwd: generatedPath,
      env: { ...process.env }
    });
    if (stdout.trim()) {
      console.log(stdout);
    }
    console.log('✓ Vector indexes created');
  } catch (error: any) {
    console.warn('⚠️  Vector index creation failed:', error.message);
    console.warn('   You can create indexes later with: cd', generatedPath, '&& npm run embeddings:index');
    throw error; // Re-throw to prevent embeddings generation without indexes
  }
}

/**
 * Generate embeddings using the generated scripts
 */
async function generateEmbeddings(generatedPath: string): Promise<void> {
  console.log('\n🔢 Generating embeddings...');

  try {
    const { stdout } = await execAsync('npm run embeddings:generate', {
      cwd: generatedPath,
      env: { ...process.env }
    });
    if (stdout.trim()) {
      console.log(stdout);
    }
    console.log('✓ Embeddings generated');
  } catch (error: any) {
    console.warn('⚠️  Embedding generation failed:', error.message);
    console.warn('   You can generate embeddings later with: cd', generatedPath, '&& npm run embeddings:generate');
  }
}
