# Ingestion Incrémentale & Exemples Autonomes

Date: 2025-11-10

## 🎯 Objectifs

1. **Ingestion incrémentale**: Ne réingérer que les scopes modifiés (basé sur hash)
2. **Exemples autonomes**: Setup complet en une commande (DB + ingestion + indexes + embeddings)

---

## 📊 État Actuel

### ✅ Ce qui existe déjà

#### 1. Système de Hash pour Scopes

**Localisation**: `/packages/runtime/src/adapters/code-source-adapter.ts:747-807`

```typescript
/**
 * Calculate signature hash for a scope
 * Hash is stable across builds if the scope signature doesn't change
 */
private getSignatureHash(scope: ScopeInfo): string {
  const parentPrefix = scope.parent ? `${scope.parent}.` : '';
  const baseInput = scope.signature ||
    `${scope.name}:${scope.type}:${scope.contentDedented || scope.content}`;

  let hashInput = `${parentPrefix}${baseInput}`;

  // For variables: include line number to differentiate same-name vars
  if (scope.type === 'variable' || scope.type === 'constant') {
    hashInput += `:line${scope.startLine}`;
  }

  return createHash('sha256')
    .update(hashInput)
    .digest('hex')
    .substring(0, 8); // 8-char hash
}

/**
 * Hash scope content for incremental updates
 */
private hashScope(scope: ScopeInfo): string {
  return this.getSignatureHash(scope);
}
```

**Propriétés stockées dans Neo4j** (ligne 411):
```typescript
properties: {
  uuid,
  name: scope.name,
  type: scope.type,
  file: relPath,
  source: scope.content,
  signature: this.extractSignature(scope),
  hash: this.hashScope(scope),  // ✅ Hash stocké!
  // ...
}
```

#### 2. Système de Cache pour Summaries

**Localisation**: `/packages/runtime/src/summarization/summary-storage.ts`

Fonctionnalités complètes d'ingestion incrémentale:
- `storeSummary()` - Stocke le hash avec le summary
- `loadSummary()` - Charge le summary en cache
- `needsRegeneration()` - Compare hash actuel vs hash en cache
- `findEntitiesNeedingSummaries()` - Trouve les entités à summarizer
- `getStatistics()` - Stats sur l'avancement

**Structure des propriétés**:
```
source_summary_purpose
source_summary_operations
source_summary_suggestions
source_summary_hash          ← Hash pour détecter les changements
source_summarized_at
```

#### 3. File Hash

**Localisation**: `/packages/runtime/src/adapters/code-source-adapter.ts:488`

```typescript
const contentHash = createHash('sha256')
  .update(analysis.scopes.map(s => s.content || '').join(''))
  .digest('hex');

nodes.push({
  labels: ['File'],
  properties: {
    path: relPath,
    contentHash  // ✅ Hash du fichier entier
  }
});
```

---

### ❌ Ce qui manque

#### 1. Ingestion incrémentale des Scopes

**Problème actuel**: `CodeSourceAdapter.ingestBatch()` crée TOUJOURS les nodes, même si le hash n'a pas changé.

**Ce qu'il faut**:
```typescript
// Pseudo-code
async ingestIncremental(nodes, relationships) {
  // 1. Query tous les hash existants pour ces scopes
  const existingHashes = await this.getExistingHashes(nodeIds);

  // 2. Filtrer seulement les nodes modifiés
  const modifiedNodes = nodes.filter(n => {
    const existing = existingHashes.get(n.id);
    return !existing || existing.hash !== n.properties.hash;
  });

  // 3. Supprimer les nodes obsolètes (fichiers supprimés)
  const deletedNodes = Array.from(existingHashes.keys())
    .filter(id => !nodes.find(n => n.id === id));

  await this.deleteNodes(deletedNodes);

  // 4. Upsert seulement les nodes modifiés
  await this.upsertNodes(modifiedNodes);

  // 5. Recréer les relationships pour les nodes touchés
  await this.updateRelationships(modifiedNodes, relationships);
}
```

#### 2. Script d'ingestion autonome

**Ce qui manque dans le projet généré**:
```
scripts/
  ├── ingest-from-source.ts    ❌ N'existe pas
  ├── setup.ts                  ❌ N'existe pas (orchestrateur)
  └── clean-db.ts               ❌ N'existe pas
```

#### 3. Config pour définir la source

**Manque dans `ragforge.config.yaml`**:
```yaml
# Proposition:
source:
  type: code
  paths:
    - "../../packages/runtime/src"
    - "../../packages/core/src"
  languages: [typescript]
  exclude:
    - "**/node_modules/**"
    - "**/*.test.ts"
```

---

## 🛠️ Plan d'Implémentation

### Phase 1: Ingestion Incrémentale (Core Runtime)

**Localisation**: `/packages/runtime/src/adapters/code-source-adapter.ts`

#### Étape 1.1: Ajouter `getExistingHashes()`

```typescript
/**
 * Get existing hashes for a set of node IDs
 * Used for incremental ingestion
 */
async getExistingHashes(
  nodeIds: string[]
): Promise<Map<string, { uuid: string; hash: string }>> {
  const result = await this.client.run(`
    MATCH (n:Scope)
    WHERE n.uuid IN $nodeIds
    RETURN n.uuid AS uuid, n.hash AS hash
  `, { nodeIds });

  const hashes = new Map();
  for (const record of result.records) {
    hashes.set(record.get('uuid'), {
      uuid: record.get('uuid'),
      hash: record.get('hash')
    });
  }
  return hashes;
}
```

#### Étape 1.2: Ajouter `ingestIncremental()`

```typescript
/**
 * Incremental ingestion - only updates changed scopes
 *
 * Strategy:
 * 1. Fetch existing hashes from DB
 * 2. Filter nodes: only keep changed/new ones
 * 3. Delete orphaned nodes (files removed from codebase)
 * 4. Upsert changed nodes
 * 5. Update relationships for affected nodes
 */
async ingestIncremental(
  nodes: Node[],
  relationships: Relationship[],
  options: { dryRun?: boolean } = {}
): Promise<{
  unchanged: number;
  updated: number;
  created: number;
  deleted: number;
}> {
  // 1. Get existing hashes
  const scopeNodes = nodes.filter(n => n.labels.includes('Scope'));
  const nodeIds = scopeNodes.map(n => n.properties.uuid);
  const existingHashes = await this.getExistingHashes(nodeIds);

  // 2. Classify nodes
  const unchanged: string[] = [];
  const modified: Node[] = [];
  const created: Node[] = [];

  for (const node of scopeNodes) {
    const existing = existingHashes.get(node.properties.uuid);

    if (!existing) {
      created.push(node);
    } else if (existing.hash !== node.properties.hash) {
      modified.push(node);
    } else {
      unchanged.push(node.properties.uuid);
    }
  }

  // 3. Find deleted nodes (in DB but not in current parse)
  const currentIds = new Set(nodeIds);
  const deleted = Array.from(existingHashes.keys())
    .filter(id => !currentIds.has(id));

  if (options.dryRun) {
    return {
      unchanged: unchanged.length,
      updated: modified.length,
      created: created.length,
      deleted: deleted.length
    };
  }

  // 4. Delete orphaned nodes
  if (deleted.length > 0) {
    await this.deleteNodes(deleted);
  }

  // 5. Upsert modified + created nodes
  const nodesToUpsert = [...modified, ...created];
  if (nodesToUpsert.length > 0) {
    // Include File nodes too
    const fileNodes = nodes.filter(n => n.labels.includes('File'));
    await this.ingestBatch([...nodesToUpsert, ...fileNodes], relationships);
  }

  return {
    unchanged: unchanged.length,
    updated: modified.length,
    created: created.length,
    deleted: deleted.length
  };
}
```

#### Étape 1.3: Ajouter `deleteNodes()`

```typescript
/**
 * Delete nodes and their relationships
 */
async deleteNodes(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;

  await this.client.run(`
    MATCH (n:Scope)
    WHERE n.uuid IN $uuids
    DETACH DELETE n
  `, { uuids });
}
```

---

### Phase 2: Config Source (Core)

**Localisation**: `/packages/core/src/types/config.ts`

#### Étape 2.1: Ajouter le type `SourceConfig`

```typescript
export interface SourceConfig {
  /** Type of source to ingest */
  type: 'code';

  /** Paths to parse (relative to project root) */
  paths: string[];

  /** Languages to parse */
  languages: ('typescript' | 'python')[];

  /** Glob patterns to exclude */
  exclude?: string[];

  /** Base path for resolving relative paths */
  basePath?: string;
}

export interface RagForgeConfig {
  name: string;
  neo4j: Neo4jConfig;
  entities: EntityConfig[];
  embeddings?: EmbeddingsConfig;
  summarization?: SummarizationConfig;
  source?: SourceConfig;  // ← NOUVEAU
}
```

#### Étape 2.2: Validation dans ConfigLoader

```typescript
// Dans /packages/core/src/config/loader.ts
static validate(config: any): void {
  // ... existing validation

  if (config.source) {
    if (config.source.type !== 'code') {
      throw new Error('Only source.type="code" is supported');
    }
    if (!Array.isArray(config.source.paths) || config.source.paths.length === 0) {
      throw new Error('source.paths must be a non-empty array');
    }
    if (!Array.isArray(config.source.languages) || config.source.languages.length === 0) {
      throw new Error('source.languages must be a non-empty array');
    }
  }
}
```

---

### Phase 3: Scripts Générés (CLI)

**Localisation**: `/packages/core/src/generator/code-generator.ts`

#### Étape 3.1: Générer `scripts/ingest-from-source.ts`

```typescript
// Dans CodeGenerator.generate()
const generated: GeneratedCode = {
  // ... existing
  scripts: {
    ingestFromSource: this.generateIngestScript(config),
    setup: this.generateSetupScript(config),
    cleanDb: this.generateCleanDbScript()
  }
};

// Nouvelle méthode
private static generateIngestScript(config: RagForgeConfig): string {
  if (!config.source) {
    return ''; // Skip if no source config
  }

  const { paths, languages, exclude = [] } = config.source;

  return `
/**
 * Ingest code from configured source paths
 * Generated by RagForge
 */

import { CodeSourceAdapter } from '@luciformresearch/ragforge-runtime';
import { createRagClient } from '../client.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const rag = createRagClient();

console.log('🔄 Starting code ingestion...\\n');

const adapter = new CodeSourceAdapter(rag.client);

// Source configuration (from ragforge.config.yaml)
const config = {
  basePath: projectRoot,
  paths: ${JSON.stringify(paths)},
  languages: ${JSON.stringify(languages)},
  exclude: ${JSON.stringify(exclude)},
  adapter: '${languages[0]}' // Primary language
};

try {
  // Parse and ingest (incremental by default)
  const stats = await adapter.ingestFromPaths(config, {
    incremental: true,
    verbose: true
  });

  console.log('\\n✅ Ingestion complete!');
  console.log(\`   Created: \${stats.created}\`);
  console.log(\`   Updated: \${stats.updated}\`);
  console.log(\`   Unchanged: \${stats.unchanged}\`);
  console.log(\`   Deleted: \${stats.deleted}\`);

} catch (error) {
  console.error('❌ Ingestion failed:', error);
  process.exit(1);
} finally {
  await rag.close();
}
  `.trim();
}
```

#### Étape 3.2: Générer `scripts/setup.ts`

```typescript
private static generateSetupScript(config: RagForgeConfig): string {
  const hasSource = !!config.source;
  const hasEmbeddings = !!config.embeddings;
  const hasSummarization = !!config.summarization;

  return `
/**
 * Complete setup script
 * Runs: ingestion → indexes → embeddings → summaries
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(\`Command failed with code \${code}\`));
    });
  });
}

async function main() {
  console.log('🚀 RagForge Setup - Complete Initialization\\n');
  console.log('='.repeat(60));

  ${hasSource ? `
  // Step 1: Ingest code
  console.log('\\n📥 Step 1/4: Ingesting code...\\n');
  await runCommand('npm', ['run', 'ingest']);
  ` : ''}

  ${hasEmbeddings ? `
  // Step 2: Create vector indexes
  console.log('\\n📊 Step 2/4: Creating vector indexes...\\n');
  await runCommand('npm', ['run', 'embeddings:index']);

  // Step 3: Generate embeddings
  console.log('\\n🔢 Step 3/4: Generating embeddings...\\n');
  await runCommand('npm', ['run', 'embeddings:generate']);
  ` : ''}

  ${hasSummarization ? `
  // Step 4: Generate summaries
  console.log('\\n📝 Step 4/4: Generating summaries...\\n');
  await runCommand('npm', ['run', 'summaries:generate']);
  ` : ''}

  console.log('\\n' + '='.repeat(60));
  console.log('✅ Setup complete! Your RAG system is ready.\\n');
}

main().catch(error => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
  `.trim();
}
```

#### Étape 3.3: Persister les scripts

```typescript
// Dans /packages/cli/src/utils/io.ts:persistGeneratedArtifacts()

// Après les scripts existants (ligne ~190)
if (generated.scripts) {
  if (generated.scripts.ingestFromSource) {
    await writeFileIfChanged(
      path.join(scriptsDir, 'ingest-from-source.ts'),
      generated.scripts.ingestFromSource
    );
    logGenerated('scripts/ingest-from-source.ts');
  }

  if (generated.scripts.setup) {
    await writeFileIfChanged(
      path.join(scriptsDir, 'setup.ts'),
      generated.scripts.setup
    );
    logGenerated('scripts/setup.ts');
  }

  if (generated.scripts.cleanDb) {
    await writeFileIfChanged(
      path.join(scriptsDir, 'clean-db.ts'),
      generated.scripts.cleanDb
    );
    logGenerated('scripts/clean-db.ts');
  }
}
```

#### Étape 3.4: Ajouter les scripts npm

```typescript
// Dans writeGeneratedPackageJson()
const baseScripts: Record<string, string> = {
  build: 'echo "Nothing to build"',
  start: 'tsx ./client.ts',

  // Ingestion
  ...(generated.scripts?.ingestFromSource ? {
    ingest: 'tsx ./scripts/ingest-from-source.ts',
    'ingest:clean': 'npm run clean:db && npm run ingest'
  } : {}),

  // Setup
  ...(generated.scripts?.setup ? {
    setup: 'tsx ./scripts/setup.ts'
  } : {}),

  // Database management
  ...(generated.scripts?.cleanDb ? {
    'clean:db': 'tsx ./scripts/clean-db.ts'
  } : {}),

  // Existing scripts
  'rebuild:agent': 'tsx ./scripts/rebuild-agent.ts',
  'embeddings:index': 'tsx ./scripts/create-vector-indexes.ts',
  'embeddings:generate': 'tsx ./scripts/generate-embeddings.ts'
};
```

---

### Phase 4: Docker Support (Optionnel)

#### Générer `docker-compose.yml`

```typescript
private static generateDockerCompose(config: RagForgeConfig): string {
  return `
version: '3.8'

services:
  neo4j:
    image: neo4j:5.15-enterprise
    container_name: ragforge-neo4j
    environment:
      NEO4J_AUTH: neo4j/ragforge-password
      NEO4J_ACCEPT_LICENSE_AGREEMENT: "yes"
      NEO4J_PLUGINS: '["apoc"]'
    ports:
      - "7474:7474"  # HTTP
      - "7687:7687"  # Bolt
    volumes:
      - neo4j-data:/data
      - neo4j-logs:/logs
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "ragforge-password", "RETURN 1"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  neo4j-data:
  neo4j-logs:
  `.trim();
}
```

---

## 📋 Workflow Final

### Pour un nouvel exemple

```bash
# 1. Créer la config YAML avec section "source"
cat > ragforge.config.yaml <<EOF
name: my-rag-project
source:
  type: code
  paths:
    - "../my-codebase/src"
  languages: [typescript]
  exclude:
    - "**/*.test.ts"

entities:
  - name: Scope
    # ...
EOF

# 2. Générer le projet
ragforge generate --config ragforge.config.yaml --out ./generated --dev

# 3. Setup complet en une commande
cd generated
npm run setup

# 4. Tester
npm run start
```

### Ingestion incrémentale (après modifications du code)

```bash
# Réingère seulement les fichiers modifiés
npm run ingest

# Régénère les embeddings pour les nouveaux/modifiés scopes
npm run embeddings:generate

# Régénère les summaries pour les nouveaux/modifiés scopes
npm run summaries:generate
```

---

## 🎯 Roadmap

### Phase 1: MVP Incrémental ✅ (À implémenter)
- [ ] `CodeSourceAdapter.ingestIncremental()`
- [ ] `CodeSourceAdapter.getExistingHashes()`
- [ ] `CodeSourceAdapter.deleteNodes()`
- [ ] Tests unitaires

### Phase 2: Config Source ✅ (À implémenter)
- [ ] Type `SourceConfig` dans `/packages/core/src/types/config.ts`
- [ ] Validation dans `ConfigLoader`
- [ ] Documentation dans YAML schema

### Phase 3: Scripts Générés ✅ (À implémenter)
- [ ] `generateIngestScript()`
- [ ] `generateSetupScript()`
- [ ] `generateCleanDbScript()`
- [ ] Persist dans `io.ts`
- [ ] Ajouter npm scripts

### Phase 4: Docker (Optionnel) 🟡
- [ ] Générer `docker-compose.yml`
- [ ] Script `start-neo4j.sh`
- [ ] Documentation Docker

### Phase 5: CLI Bootstrap (Future) 🔵
- [ ] `ragforge bootstrap` command
- [ ] Auto-detect source paths
- [ ] Interactive setup wizard

---

## 🧪 Tests Requis

### Test 1: Ingestion incrémentale - Détection de changements

```typescript
// Parse initial
const nodes1 = await adapter.parseFile('test.ts');
await adapter.ingestIncremental(nodes1, []);
// → created: 10, updated: 0, unchanged: 0

// Modifier un scope (changer le contenu d'une fonction)
// Parse à nouveau
const nodes2 = await adapter.parseFile('test.ts');
await adapter.ingestIncremental(nodes2, []);
// → created: 0, updated: 1, unchanged: 9
```

### Test 2: Suppression de scopes

```typescript
// Parse avec 10 scopes
await adapter.ingestIncremental(nodes, []);

// Supprimer une fonction du fichier
// Parse à nouveau (9 scopes)
await adapter.ingestIncremental(nodes2, []);
// → deleted: 1
```

### Test 3: Dry run

```typescript
const stats = await adapter.ingestIncremental(nodes, [], { dryRun: true });
// Aucune modification dans Neo4j, mais retourne les stats
```

### Test 4: Setup script complet

```bash
# Dans un projet fraîchement généré
npm run setup
# → Devrait tout initialiser sans erreur
```

---

## 📝 Documentation Utilisateur

### Dans QUICKSTART.md généré

```markdown
## 🚀 Quick Setup

### Option 1: Complete Setup (Recommended)

Run everything in one command:

\`\`\`bash
npm run setup
\`\`\`

This will:
1. ✅ Ingest your code into Neo4j
2. ✅ Create vector indexes
3. ✅ Generate embeddings
4. ✅ Generate field summaries

### Option 2: Step by Step

\`\`\`bash
# 1. Ingest code
npm run ingest

# 2. Create vector indexes
npm run embeddings:index

# 3. Generate embeddings
npm run embeddings:generate

# 4. Generate summaries (optional)
npm run summaries:generate
\`\`\`

### Incremental Updates

After modifying your codebase:

\`\`\`bash
# Re-ingest (only processes changed files)
npm run ingest

# Regenerate embeddings for changed entities
npm run embeddings:generate

# Regenerate summaries for changed entities
npm run summaries:generate
\`\`\`

The ingestion is **incremental** - only changed scopes are re-processed!
```

---

## 🔍 Optimisations Futures

### 1. File-level Change Detection

Actuellement: Compare tous les scopes individuellement.

**Optimisation**: Comparer d'abord le `contentHash` du File node. Si inchangé, skip tout le fichier.

```typescript
// Pseudo-code
const fileHashes = await this.getFileHashes(filePaths);

for (const file of files) {
  const existing = fileHashes.get(file.path);

  if (existing?.contentHash === file.contentHash) {
    // Skip - file unchanged
    continue;
  }

  // File changed - process scopes
  await this.processFile(file);
}
```

### 2. Parallel Processing

```typescript
// Traiter plusieurs fichiers en parallèle
const results = await Promise.all(
  files.map(file => adapter.processFile(file))
);
```

### 3. Incremental Embeddings

Réutiliser les embeddings existants pour les scopes inchangés:

```typescript
// Dans generate-embeddings.ts
const unchangedScopes = await findUnchangedScopes();
// Skip embedding generation for these
```

### 4. Watch Mode

```bash
npm run ingest:watch
# → Surveille les fichiers, réingère automatiquement
```

---

## 💡 Exemples d'Utilisation

### Exemple 1: test-code-rag (test sur RagForge lui-même)

**Avant** (manuel):
```bash
# Setup manuel complexe
# 1. Créer la DB
# 2. Parser le code manuellement
# 3. Ingérer avec script custom
# 4. Créer indexes
# 5. Générer embeddings
```

**Après** (autonome):
```bash
# Dans test-code-rag/ragforge.config.yaml
source:
  type: code
  paths:
    - "../packages/runtime/src"
    - "../packages/core/src"
  languages: [typescript]

# Setup complet
npm run setup
```

### Exemple 2: Ingestion incrémentale pendant le dev

```bash
# Développer une feature
vim ../packages/runtime/src/query/query-builder.ts

# Réingérer seulement ce qui a changé
npm run ingest
# → Output: "Updated: 1, Unchanged: 245"

# Tester immédiatement
npm run start
```

---

## 🎉 Bénéfices

1. **DX améliorée**: Setup en une commande
2. **Performance**: Ingestion incrémentale = 10x plus rapide
3. **Autonomie**: Exemples self-contained
4. **Maintenance**: Facile de régénérer après modifs
5. **Généricité**: Tout reste config-driven

---

## 📌 Notes Techniques

### Hash Stability

Le hash est stable tant que:
- Le nom du scope ne change pas
- Le type ne change pas
- Le contenu ne change pas
- Le parent ne change pas (pour methods)

**Cas qui invalident le hash**:
- Renommer une fonction → Nouveau hash
- Modifier le code → Nouveau hash
- Déplacer une méthode vers une autre classe → Nouveau hash

### UUID Stability

Les UUIDs sont générés à partir du hash de signature → Stables entre runs si la signature ne change pas.

Cela permet de:
- Préserver les relationships
- Garder les embeddings
- Garder les summaries

### Cypher Query Performance

L'ingestion incrémentale utilise des queries optimisées:
```cypher
// Bon: Fetch hashes en batch
MATCH (n:Scope)
WHERE n.uuid IN $uuids
RETURN n.uuid, n.hash

// Mauvais: Loop individuel
// (évité grâce aux batch operations)
```

---

## 🚀 Conclusion

Avec ces implémentations, RagForge devient:
- **Autonome**: Setup complet en `npm run setup`
- **Incrémental**: Réingestion ultra-rapide
- **Générique**: Tout config-driven (source, embeddings, summaries)
- **Production-ready**: Gère les cas edge (deletion, renaming, etc.)

**Impact estimé**:
- Setup time: ~5 minutes → **30 secondes**
- Re-ingestion: ~2 minutes → **~5 secondes** (incrémental)
- DX: Complexe → **Trivial**
