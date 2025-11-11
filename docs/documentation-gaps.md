# Documentation Gaps - Nouvelles fonctionnalités non documentées

## 📋 Analyse des docs générées

### Fichiers existants:
1. `QUICKSTART.md` - Guide de démarrage rapide
2. `docs/client-reference.md` - Référence complète API client
3. `docs/agent-reference.md` - Référence pour agents LLM

### ✅ Ce qui est bien documenté:

- ✅ API client (queries, mutations)
- ✅ Semantic search methods
- ✅ Relationship expansion
- ✅ LLM reranking
- ✅ Structure des résultats (dans agent-reference.md)

### ❌ Ce qui manque complètement:

#### 1. **Scripts autonomes générés** (CRITIQUE)

Les scripts suivants sont générés mais jamais mentionnés:
- `scripts/ingest-from-source.ts`
- `scripts/setup.ts`
- `scripts/clean-db.ts`

**Où ils devraient être documentés**:
- Dans QUICKSTART.md (section "Database Setup")
- Dans client-reference.md (nouvelle section "Project Scripts")

#### 2. **Ingestion incrémentale** (IMPORTANT)

La feature d'ingestion incrémentale est implémentée mais pas documentée:
- Comment fonctionne la détection de changements (hash-based)
- Quand utiliser `npm run ingest` vs setup complet
- Stats d'ingestion (created/updated/unchanged/deleted)

#### 3. **Configuration source** (IMPORTANT)

La section `source:` dans `ragforge.config.yaml` n'est pas expliquée:
```yaml
source:
  type: code
  adapter: typescript
  root: .
  include:
    - "src/**/*.ts"
  exclude:
    - "**/node_modules/**"
```

#### 4. **Workflow de setup initial** (CRITIQUE)

Pas de guide clair sur:
```bash
# Nouveau projet - que faire?
npm run setup  # ← Pas documenté!
# vs
npm run ingest  # ← Pas documenté!
npm run embeddings:generate  # ← Documenté mais pas dans un workflow
```

#### 5. **Scripts npm disponibles** (IMPORTANT)

Les scripts suivants sont ajoutés au package.json mais pas listés:
- `npm run ingest` - Parse et ingère le code source
- `npm run ingest:clean` - Clean DB + ingest
- `npm run setup` - Workflow complet (ingest → indexes → embeddings)
- `npm run clean:db` - Nettoie la base de données

---

## 🔧 Corrections proposées

### Fix 1: QUICKSTART.md - Ajouter section "Database Setup"

Après "Installation", ajouter:

```markdown
## 🗄️ Database Setup

### First-time setup

If this is a new project with code to ingest:

\`\`\`bash
npm run setup
\`\`\`

This will:
1. ✅ Parse your source code (configured in \`ragforge.config.yaml\`)
2. ✅ Ingest code into Neo4j (incremental - only changed files)
3. ✅ Create vector indexes
4. ✅ Generate embeddings

### Subsequent updates

When your code changes, just run:

\`\`\`bash
npm run ingest
\`\`\`

This uses **incremental ingestion** - only re-processes files that changed!

### Clean slate

To wipe the database and start fresh:

\`\`\`bash
npm run clean:db  # Removes all data
npm run setup     # Re-ingest everything
\`\`\`
```

### Fix 2: QUICKSTART.md - Corriger la structure des résultats

Ajouter après "Basic Usage":

```markdown
## 📦 Understanding Results

**Important**: Query results have a specific structure:

\`\`\`typescript
{
  entity: {
    // All node properties here
    name: "scopeName",
    type: "function",
    file: "index.ts",
    source: "function foo() { ... }",
    // ...
  },
  score?: number,  // Relevance score (only for semantic/vector search)
  // ... other metadata
}
\`\`\`

**Always access node properties via `.entity`**:

\`\`\`typescript
const results = await rag.scope().whereName('foo').execute();

// ✅ Correct
console.log(results[0].entity.name);
console.log(results[0].entity.file);

// ❌ Wrong - returns undefined!
console.log(results[0].name);
console.log(results[0].file);
\`\`\`

For semantic searches, you also get a relevance score:

\`\`\`typescript
const results = await rag.scope()
  .semanticSearchBySource("database connection")
  .execute();

results.forEach(r => {
  console.log(\`\${r.entity.name}: \${r.score.toFixed(2)}\`);
});
\`\`\`
```

### Fix 3: QUICKSTART.md - Ajouter semantic search

Après la section "Understanding Results":

```markdown
## 🔍 Semantic Search

Search by concepts, not just exact names:

\`\`\`typescript
const results = await rag.scope()
  .semanticSearchBySource("how to connect to database")
  .limit(5)
  .execute();

// Returns code scopes semantically similar to your query
results.forEach(r => {
  const scope = r.entity;
  console.log(\`\${scope.name} in \${scope.file}:\${scope.startLine}\`);
  console.log(\`  Relevance: \${r.score.toFixed(2)}\`);
});
\`\`\`

This is more powerful than keyword search because it understands:
- **Synonyms**: "database" matches "Neo4j", "DB", "data store"
- **Concepts**: "connection" matches "client", "driver", "initialize"
- **Context**: Finds relevant code even if exact words don't appear
```

### Fix 4: client-reference.md - Ajouter section "Project Scripts"

Ajouter au début, après "Quickstart":

```markdown
## 📜 Available Scripts

This project includes auto-generated scripts for database management:

### `npm run setup`
**Complete setup workflow** - Run this for first-time setup:
1. Parses code from configured source paths
2. Ingests into Neo4j (creates Scope, File nodes)
3. Creates vector indexes
4. Generates embeddings

**When to use**: New project, or when you want a clean slate

### `npm run ingest`
**Incremental code ingestion** - Only re-processes changed files:
- Detects file changes using content hashing
- Only updates modified scopes
- Much faster than full re-ingestion

**When to use**: After code changes, for quick updates

**Example output**:
\`\`\`
🔍 Analyzing changes...
   Created: 5
   Updated: 2
   Unchanged: 143
   Deleted: 0
\`\`\`

### `npm run ingest:clean`
Clean database + fresh ingestion:
\`\`\`bash
npm run ingest:clean
\`\`\`

### `npm run clean:db`
Removes all data from Neo4j:
\`\`\`bash
npm run clean:db
\`\`\`
**⚠️ Warning**: This deletes everything!

### How ingestion works

The code is parsed using the configuration in \`ragforge.config.yaml\`:

\`\`\`yaml
source:
  type: code
  adapter: typescript  # or 'python'
  root: .
  include:
    - "src/**/*.ts"
  exclude:
    - "**/node_modules/**"
    - "**/dist/**"
\`\`\`

Each scope (function, class, method, etc.) gets:
- A unique UUID
- A content hash (for change detection)
- Relationships (DEFINED_IN, CALLS, IMPORTS, etc.)
```

### Fix 5: QUICKSTART.md - Fixer le nom de variable

Remplacer ligne 20:
```typescript
// ❌ AVANT (erreur de syntaxe)
const test-code-rag = createRagClient();

// ✅ APRÈS
const rag = createRagClient();
```

Et remplacer toutes les occurrences de `test-code-rag.scope()` par `rag.scope()`

### Fix 6: QUICKSTART.md - Corriger les noms de scripts npm

Remplacer:
```bash
# ❌ AVANT (n'existent pas)
npm run examples:01-basic-query
npm run examples:02-filters

# ✅ APRÈS (noms réels)
npm run examples:01-semantic-search-source
npm run examples:02-relationship-defined_in
npm run examples:07-llm-reranking
```

---

## 📊 Priorités d'implémentation

### P0 - CRITIQUE (bloque l'usage)
1. ✅ Ajouter section "Database Setup" dans QUICKSTART.md
2. ✅ Ajouter section "Understanding Results" (`.entity`)
3. ✅ Fixer le nom de variable invalide (`test-code-rag` → `rag`)
4. ✅ Ajouter section "Project Scripts" dans client-reference.md

### P1 - IMPORTANT (améliore beaucoup l'expérience)
5. Ajouter section "Semantic Search" dans QUICKSTART.md
6. Corriger les noms de scripts npm dans QUICKSTART
7. Documenter la config `source:` dans client-reference.md

### P2 - Nice to have
8. Ajouter exemples inline d'ingestion dans client-reference
9. Diagramme du workflow (setup → ingest → query)
10. Troubleshooting section (common errors)

---

## 🎯 Template changes nécessaires

### Fichiers à modifier dans `packages/core/src/generator/`:

1. **`generateQuickstart()` method**
   - Fix variable name generation (sanitize project name)
   - Add "Database Setup" section
   - Add "Understanding Results" section
   - Add "Semantic Search" example
   - Fix npm scripts references

2. **`generateDeveloperDocumentation()` method**
   - Add "Project Scripts" section
   - Document source configuration
   - Add incremental ingestion details

3. **Exemples générés**
   - Ajouter commentaire sur `.entity` structure
   - Utiliser `const rag` au lieu de nom de projet

---

## ✅ Ce qui est déjà bon

1. ✅ agent-reference.md documente bien la structure des résultats
2. ✅ client-reference.md documente bien l'API
3. ✅ Exemples sont exécutables et bien structurés
4. ✅ Auto-install des dépendances fonctionne

Avec ces corrections, la documentation sera **complète et à jour** avec toutes les nouvelles features! 🎯
