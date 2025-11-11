# Quickstart Implementation Roadmap

**Date**: 2025-11-11
**Objectif**: Rendre RagForge "plug-and-play" pour le mode code avec auto-remplissage du YAML

## 🎯 Vision

### Before (Expérience actuelle)
```bash
# 1. Créer manuellement 172 lignes de YAML
# 2. Setup Neo4j manuellement
# 3. Configurer les credentials
# 4. Generate + ingest manuellement
```

### After (Expérience cible)
```bash
# 1. YAML minimal (5 lignes)
$ cat ragforge.config.yaml
name: my-project
source:
  type: code
  adapter: typescript
  include: ["src/**/*.ts"]

# 2. Une commande
$ ragforge quickstart

# 3. Le YAML se remplit automatiquement avec les defaults
$ cat ragforge.config.yaml  # Maintenant 172 lignes avec commentaires!
name: my-project
source:
  type: code
  adapter: typescript
  root: .
  include: ["src/**/*.ts"]
  exclude:  # Auto-ajouté depuis defaults
    - "**/node_modules/**"
    - "**/dist/**"
    # ...
  track_changes: true  # Auto-ajouté

# Entities auto-générées avec commentaires pédagogiques
entities:
  - name: Scope  # Représente une fonction, classe, méthode, etc.
    unique_field: uuid
    # ...

# 4. Tout est setup et prêt à utiliser!
```

## 📋 Phases d'Implémentation

### Phase 1: Infrastructure des Defaults ✅ (Foundation)

**Objectif**: Créer le système de defaults par adapter

#### 1.1 Créer les fichiers de defaults
- [ ] `packages/core/src/defaults/base.yaml`
- [ ] `packages/core/src/defaults/code-typescript.yaml`
- [ ] `packages/core/src/defaults/code-python.yaml`
- [ ] `packages/core/src/defaults/code-javascript.yaml`

**Contenu de `code-typescript.yaml`**:
```yaml
# Default configuration for TypeScript projects
# These settings are optimized for TypeScript codebases

exclude:
  - "**/node_modules/**"    # Node.js dependencies
  - "**/dist/**"            # Build output
  - "**/build/**"           # Alternative build output
  - "**/.next/**"           # Next.js build
  - "**/coverage/**"        # Test coverage
  - "**/*.test.ts"          # Test files
  - "**/*.spec.ts"          # Spec files
  - "**/*.d.ts"             # Type definitions
  - "**/.git/**"            # Git directory

track_changes: true         # Enable change tracking with diffs

entities:
  - name: Scope
    unique_field: uuid
    vector_indexes:
      - name: scopeSourceEmbeddings
        field: source_embedding
        source_field: source
        dimension: 768
        similarity: cosine
        provider: gemini
        model: text-embedding-004
    searchable_fields:
      - name: name
        type: string
      - name: file
        type: string
      - name: source
        type: string
        summarization:
          enabled: true
          strategy: code_analysis
          threshold: 300
          output_fields:
            - purpose      # What this code does
            - operation    # How it works
            - dependency   # What it depends on
            - concept      # Key concepts used
            - complexity   # Complexity assessment
            - suggestion   # Improvement suggestions
          rerank_use: prefer_summary
    relationships:
      - type: DEFINED_IN
        direction: outgoing
        target: File
        description: Scope DEFINED_IN File
      - type: CONSUMES
        direction: outgoing
        target: Scope
        description: Scope CONSUMES Scope
      - type: HAS_PARENT
        direction: outgoing
        target: Scope
        description: Scope HAS_PARENT Scope
      - type: USES_LIBRARY
        direction: outgoing
        target: ExternalLibrary
        description: Scope USES_LIBRARY ExternalLibrary
      - type: INHERITS_FROM
        direction: outgoing
        target: Scope
        description: Scope INHERITS_FROM Scope

summarization_llm:
  provider: gemini
  model: gemini-2.0-flash-exp
  temperature: 0.3
  max_tokens: 8000

embeddings:
  provider: gemini
  defaults:
    model: text-embedding-004
    dimension: 768
    similarity: cosine
  entities:
    - entity: Scope
      pipelines:
        - name: scopeSourceEmbeddings
          source: source
          target_property: source_embedding
          model: text-embedding-004
          dimension: 768
          similarity: cosine
          batch_size: 10
          concurrency: 3
          throttle_ms: 300

watch:
  enabled: true
  batch_interval: 1000
  verbose: true
  auto_embed: false
```

#### 1.2 Créer le config merger
- [ ] `packages/core/src/config/merger.ts`

```typescript
import { deepMerge } from './utils';
import type { RagForgeConfig } from '../types/config';

export interface MergerOptions {
  preserveComments?: boolean;
  addComments?: boolean;
}

export async function mergeWithDefaults(
  userConfig: Partial<RagForgeConfig>,
  options: MergerOptions = { addComments: true }
): Promise<RagForgeConfig> {
  const defaults = await loadDefaultsForConfig(userConfig);
  const merged = deepMerge(defaults, userConfig);

  if (options.addComments) {
    addInlineComments(merged);
  }

  return merged;
}

async function loadDefaultsForConfig(
  userConfig: Partial<RagForgeConfig>
): Promise<Partial<RagForgeConfig>> {
  let defaults: Partial<RagForgeConfig> = {};

  // 1. Load base defaults
  const baseDefaults = await loadYamlDefaults('base.yaml');
  defaults = deepMerge(defaults, baseDefaults);

  // 2. Load adapter-specific defaults
  if (userConfig.source?.type === 'code') {
    const adapter = userConfig.source.adapter;
    const adapterDefaults = await loadYamlDefaults(`code-${adapter}.yaml`);
    defaults = deepMerge(defaults, adapterDefaults);
  }

  return defaults;
}
```

#### 1.3 Modifier le config loader
- [ ] Modifier `packages/core/src/config/loader.ts`
- [ ] Ajouter merge automatique avec defaults
- [ ] Garder compatibilité avec configs existantes

---

### Phase 2: YAML Auto-Remplissage 🎯 (Core Feature)

**Objectif**: Réécrire le YAML avec les defaults explicités

#### 2.1 Créer le YAML writer avec commentaires
- [ ] `packages/core/src/config/writer.ts`

```typescript
import yaml from 'yaml';
import type { RagForgeConfig } from '../types/config';

export interface WriteOptions {
  addComments?: boolean;
  preserveUserComments?: boolean;
  indentSize?: number;
}

export async function writeConfigWithDefaults(
  originalPath: string,
  mergedConfig: RagForgeConfig,
  options: WriteOptions = {}
): Promise<void> {
  // 1. Parse original YAML to preserve user comments
  const original = await fs.readFile(originalPath, 'utf-8');
  const originalDoc = yaml.parseDocument(original);

  // 2. Create new document with merged config
  const doc = yaml.parseDocument(yaml.stringify(mergedConfig));

  // 3. Add inline comments for auto-generated fields
  addDefaultComments(doc, originalDoc);

  // 4. Write back to file
  await fs.writeFile(originalPath, doc.toString());
}

function addDefaultComments(
  doc: yaml.Document,
  originalDoc: yaml.Document
): void {
  // Mark fields that were auto-added
  // Example: "# Auto-added from typescript defaults"

  // Add helpful comments
  // Example: "# Node.js dependencies" next to node_modules
}
```

#### 2.2 Intégrer dans le flow
- [ ] Après merge, réécrire le YAML
- [ ] Backup du YAML original (`.backup`)
- [ ] Message informatif à l'utilisateur

```typescript
console.log('📝 Expanding configuration with defaults...');
console.log('   Original config saved to: ragforge.config.yaml.backup');
await writeConfigWithDefaults(configPath, mergedConfig);
console.log('✓ Configuration expanded with TypeScript defaults');
console.log('   Review ragforge.config.yaml to see what was added');
```

---

### Phase 3: Commande Quickstart 🚀 (User Experience)

**Objectif**: Commande tout-en-un pour démarrer

#### 3.1 Créer la commande quickstart
- [ ] `packages/cli/src/commands/quickstart.ts`

```typescript
interface QuickstartOptions {
  adapter?: string;      // typescript, python, javascript
  docker?: boolean;      // Setup Neo4j avec Docker
  ingest?: boolean;      // Lancer l'ingestion initiale
  embeddings?: boolean;  // Générer les embeddings
  force?: boolean;       // Overwrite existing config
}

export async function quickstart(
  projectPath: string,
  options: QuickstartOptions
): Promise<void> {
  console.log('🚀 RagForge Quickstart');
  console.log('═'.repeat(60));

  // 1. Détecter ou valider l'adapter
  const adapter = options.adapter || await detectAdapter(projectPath);
  console.log(`✓ Detected ${adapter} project`);

  // 2. Vérifier si config existe
  const configPath = path.join(projectPath, 'ragforge.config.yaml');
  if (fs.existsSync(configPath) && !options.force) {
    console.log('⚠️  Config already exists. Use --force to overwrite');

    // Proposer de juste merger
    const answer = await prompt('Expand existing config with defaults? (y/n)');
    if (answer === 'y') {
      await expandExistingConfig(configPath);
      return;
    }
    return;
  }

  // 3. Load et merge config
  const userConfig = await loadConfig(configPath); // Minimal
  const mergedConfig = await mergeWithDefaults(userConfig);

  // 4. Réécrire le YAML avec defaults
  await writeConfigWithDefaults(configPath, mergedConfig);
  console.log('✓ Configuration expanded');

  // 5. Docker setup (optionnel)
  if (options.docker) {
    await setupDocker(projectPath, mergedConfig);
  }

  // 6. Generate code client
  console.log('\n📦 Generating TypeScript client...');
  await generateClient(configPath, projectPath);
  console.log('✓ Client generated');

  // 7. Install dependencies
  console.log('\n📦 Installing dependencies...');
  await installDependencies(projectPath);
  console.log('✓ Dependencies installed');

  // 8. Ingest (optionnel)
  if (options.ingest) {
    console.log('\n📥 Running initial ingestion...');
    await runIngest(projectPath);
    console.log('✓ Ingestion complete');
  }

  // 9. Embeddings (optionnel)
  if (options.embeddings && options.ingest) {
    console.log('\n🔢 Generating embeddings...');
    await runEmbeddings(projectPath);
    console.log('✓ Embeddings generated');
  }

  // 10. Success message
  printSuccessMessage(projectPath, options);
}
```

#### 3.2 Register la commande
- [ ] Ajouter dans `packages/cli/src/index.ts`

```typescript
program
  .command('quickstart [path]')
  .description('Quick setup for code RAG project with sensible defaults')
  .option('--adapter <type>', 'Code adapter (typescript, python, javascript)')
  .option('--docker', 'Setup Neo4j with Docker Compose')
  .option('--ingest', 'Run initial code ingestion')
  .option('--embeddings', 'Generate embeddings after ingestion')
  .option('--force', 'Overwrite existing configuration')
  .action(async (projectPath, options) => {
    await quickstart(projectPath || '.', options);
  });
```

---

### Phase 4: Docker Integration 🐳 (Infrastructure)

**Objectif**: Setup Neo4j automatique avec Docker

#### 4.1 Créer le Docker manager
- [ ] `packages/cli/src/utils/docker-manager.ts`

```typescript
export async function setupDocker(
  projectPath: string,
  config: RagForgeConfig
): Promise<void> {
  // 1. Vérifier Docker installé
  if (!await isDockerInstalled()) {
    console.log('⚠️  Docker not found. Install Docker to continue.');
    return;
  }

  // 2. Générer docker-compose.yml
  const composeContent = generateDockerCompose(config);
  await fs.writeFile(
    path.join(projectPath, 'docker-compose.yml'),
    composeContent
  );
  console.log('✓ Generated docker-compose.yml');

  // 3. Générer .env avec credentials
  const envContent = generateEnvFile(config);
  await fs.writeFile(
    path.join(projectPath, '.env'),
    envContent
  );
  console.log('✓ Created .env with auto-generated credentials');

  // 4. Lancer Docker Compose
  console.log('🐳 Starting Neo4j...');
  await exec('docker compose up -d', { cwd: projectPath });

  // 5. Attendre que Neo4j soit ready
  console.log('⏳ Waiting for Neo4j to be ready...');
  await waitForNeo4j(config.neo4j);
  console.log('✓ Neo4j ready at', config.neo4j.uri);
}
```

#### 4.2 Template Docker Compose
- [ ] `packages/core/templates/docker/docker-compose.yml`

```yaml
version: '3.8'
services:
  neo4j:
    image: neo4j:5.23-community
    container_name: ${PROJECT_NAME:-ragforge}-neo4j
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD}
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_server_memory_heap_initial__size: 512m
      NEO4J_server_memory_heap_max__size: 2G
      NEO4J_dbms_security_procedures_unrestricted: apoc.*
    ports:
      - "${NEO4J_PORT:-7687}:7687"
      - "${NEO4J_HTTP_PORT:-7474}:7474"
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "${NEO4J_PASSWORD}", "RETURN 1"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  neo4j_data:
  neo4j_logs:
```

#### 4.3 Template .env
```env
# Auto-generated by RagForge Quickstart
# You can customize these values

PROJECT_NAME=my-project

# Neo4j Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_DATABASE=neo4j
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<auto-generated-password>
NEO4J_PORT=7687
NEO4J_HTTP_PORT=7474

# LLM API Keys (add your keys here)
# GEMINI_API_KEY=your-api-key-here
# OPENAI_API_KEY=your-api-key-here
```

---

### Phase 5: Auto-Detection & Smart Defaults 🧠 (Intelligence)

**Objectif**: Détecter automatiquement l'environnement

#### 5.1 Adapter detector
- [ ] `packages/cli/src/utils/adapter-detector.ts`

```typescript
export async function detectAdapter(projectPath: string): Promise<string | null> {
  // 1. Check package.json
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

    // TypeScript detection
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      return 'typescript';
    }

    // Check tsconfig.json as secondary signal
    if (fs.existsSync(path.join(projectPath, 'tsconfig.json'))) {
      return 'typescript';
    }

    return 'javascript';
  }

  // 2. Check Python
  if (fs.existsSync(path.join(projectPath, 'pyproject.toml'))) {
    return 'python';
  }
  if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
    return 'python';
  }

  // 3. Check Go
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    return 'go';
  }

  // 4. Fallback to file extensions
  const files = await globby(['**/*.ts', '**/*.py', '**/*.go'], {
    cwd: projectPath,
    ignore: ['**/node_modules/**'],
    onlyFiles: true
  });

  if (files.some(f => f.endsWith('.ts'))) return 'typescript';
  if (files.some(f => f.endsWith('.py'))) return 'python';
  if (files.some(f => f.endsWith('.go'))) return 'go';

  return null;
}
```

#### 5.2 Smart include/exclude detection
```typescript
export async function detectIncludes(
  projectPath: string,
  adapter: string
): Promise<string[]> {
  const extensions = {
    typescript: ['**/*.ts', '**/*.tsx'],
    javascript: ['**/*.js', '**/*.jsx'],
    python: ['**/*.py'],
    go: ['**/*.go']
  };

  // Detect source directories
  const commonSrcDirs = ['src', 'lib', 'app', 'packages'];
  const existingSrcDirs = [];

  for (const dir of commonSrcDirs) {
    if (fs.existsSync(path.join(projectPath, dir))) {
      existingSrcDirs.push(dir);
    }
  }

  if (existingSrcDirs.length > 0) {
    return existingSrcDirs.flatMap(dir =>
      extensions[adapter].map(ext => `${dir}/${ext}`)
    );
  }

  // Fallback: root level
  return extensions[adapter];
}
```

---

## 🎯 Priorité d'Implémentation

### Sprint 1 (1-2 jours) - Foundation
1. ✅ Phase 1: Créer les fichiers de defaults
2. ✅ Phase 2: Config merger + YAML writer

### Sprint 2 (1 jour) - Core Feature
3. ✅ Phase 2.2: Auto-remplissage du YAML
4. ✅ Test avec config minimal → expanded

### Sprint 3 (1-2 jours) - UX
5. ✅ Phase 3: Commande quickstart
6. ✅ Phase 5: Auto-detection

### Sprint 4 (1 jour) - Infrastructure
7. ✅ Phase 4: Docker integration

## 📦 Dépendances Nécessaires

```json
{
  "dependencies": {
    "yaml": "^2.x.x",        // Manipulation YAML avec comments
    "dockerode": "^4.x.x",   // Docker API (optionnel)
    "prompts": "^2.x.x"      // User prompts interactifs
  }
}
```

## 🧪 Critères de Succès

### Test Case 1: YAML minimal → expanded
```yaml
# Input
name: test
source:
  type: code
  adapter: typescript
  include: ["src/**/*.ts"]

# Output (après quickstart)
name: test
source:
  type: code
  adapter: typescript
  root: .
  include: ["src/**/*.ts"]
  exclude:  # Auto-added from typescript defaults
    - "**/node_modules/**"
    # ... (tous les excludes)
  track_changes: true  # Auto-added

entities:  # Auto-added
  - name: Scope
    # ... (toute la config)
```

### Test Case 2: Commande quickstart
```bash
$ ragforge quickstart --docker --ingest
✓ Detected TypeScript project
✓ Configuration expanded
✓ Generated docker-compose.yml
✓ Neo4j ready
✓ Client generated
✓ Ingestion complete (1,234 scopes in 8.6s)

🎉 Setup complete!
```

### Test Case 3: Pas d'overwrite accidentel
```bash
$ ragforge quickstart  # Config déjà existe
⚠️  Config already exists. Use --force to overwrite
   Or expand existing config with defaults? (y/n)
```

## 🚀 Impact Utilisateur

**Avant**:
- 30+ minutes de setup manuel
- Besoin de lire la doc extensive
- Configuration error-prone

**Après**:
- 2 minutes de setup automatique
- Le YAML devient une documentation interactive
- Learning by example (voir les defaults appliqués)

## 📝 Documentation Associée

À créer:
- [ ] `docs/quickstart-guide.md` - Guide utilisateur
- [ ] `docs/defaults-customization.md` - Comment customiser les defaults
- [ ] `docs/docker-setup.md` - Setup Docker manuel si besoin
- [ ] Update `README.md` avec exemple quickstart

---

## 🎯 Design Decisions

1. **Commande**: `ragforge quickstart` est un **alias** de `ragforge init --code`
   - `init --code` reste la commande principale
   - `quickstart` pour la découvrabilité

2. **Provider**: **Gemini uniquement** pour l'instant
   - Simplifie l'implémentation initiale
   - Multi-provider sera ajouté plus tard

3. **Docker**: **Obligatoire** (pas de flag `--docker`)
   - Toujours générer `docker-compose.yml`
   - Évite de toucher à une DB existante du dev
   - Plus simple pour le quickstart

4. **Auto-ingest**: **Oui par défaut**, avec option `--no-ingest` pour skip
   - Experience "batteries included"
   - Option pour skip si le dev veut configurer d'abord

## 📝 Notes d'Implémentation

- Gemini API key required (détecté via `GEMINI_API_KEY` env var)
- Si pas de key: avertissement + skip embeddings/summarization
- Docker required: vérification au début de la commande

---

**Next Step**: Commencer par Phase 1 (Infrastructure des Defaults) 🎯
