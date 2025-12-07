# Universal Source Adapter

**Created**: 2025-12-07
**Status**: ✅ Done (adapters créés, database/api en placeholder)
**Related**: [ROADMAP-AGENT-BRAIN.md](./ROADMAP-AGENT-BRAIN.md)

---

## Problème Actuel

Le `SourceConfig` actuel requiert un champ `adapter` explicite:

```typescript
interface SourceConfig {
  type: 'code' | 'document';
  adapter: 'typescript' | 'python' | 'tika';  // ← Obligatoire, rigide
  root?: string;
  include?: string[];
  exclude?: string[];
}
```

**Problèmes:**
1. L'utilisateur doit savoir quel adapter utiliser
2. Un projet mixte (TS + Python + docs) nécessite plusieurs configs
3. Le quick-ingest du Brain ne peut pas fonctionner sans spécifier un adapter
4. Pas extensible pour d'autres sources (BDD, API, web)

---

## Solution: Universal Source Adapter

### Nouveau `SourceConfig`

```typescript
interface SourceConfig {
  /**
   * Type de source
   * - 'files': Fichiers locaux (code, documents, médias)
   * - 'database': Base de données (PostgreSQL, Neo4j, MySQL, MongoDB)
   * - 'api': API REST/GraphQL
   * - 'web': Pages web (crawler)
   */
  type: 'files' | 'database' | 'api' | 'web';

  // ============================================
  // Options pour type: 'files'
  // ============================================

  /** Répertoire racine */
  root?: string;

  /** Patterns glob à inclure (auto-détecté si omis) */
  include?: string[];

  /** Patterns glob à exclure */
  exclude?: string[];

  // ============================================
  // Options pour type: 'database'
  // ============================================

  connection?: {
    /** Driver auto-détecté depuis l'URI si possible */
    driver?: 'postgresql' | 'neo4j' | 'mysql' | 'mongodb' | 'sqlite';

    /** URI de connexion */
    uri: string;

    /** Tables/collections à inclure (toutes si omis) */
    tables?: string[];

    /** Tables/collections à exclure */
    excludeTables?: string[];
  };

  // ============================================
  // Options pour type: 'api'
  // ============================================

  api?: {
    /** URL de base */
    baseUrl: string;

    /** Endpoints à ingérer */
    endpoints?: string[];

    /** Headers d'authentification */
    headers?: Record<string, string>;

    /** Type d'API */
    format?: 'rest' | 'graphql' | 'openapi';
  };

  // ============================================
  // Options pour type: 'web'
  // ============================================

  web?: {
    /** URL de départ */
    url: string;

    /** Profondeur de crawl */
    depth?: number;

    /** Nombre max de pages */
    maxPages?: number;

    /** Patterns d'URL à inclure */
    includePatterns?: string[];

    /** Patterns d'URL à exclure */
    excludePatterns?: string[];
  };
}
```

---

## Ce qui existe déjà

### Web Tools (`tools/web-tools.ts`)

Deux tools déjà implémentés pour le web:

| Tool | Description | Backend |
|------|-------------|---------|
| `search_web` | Recherche web via Google Search | Gemini 2.0 Flash + grounding |
| `fetch_web_page` | Rend et extrait contenu d'une page | Playwright (headless Chrome) |

```typescript
// search_web - retourne answer + sources
interface WebSearchResult {
  query: string;
  answer: string;
  sources: { title: string; url: string }[];
  searchedAt: string;
}

// fetch_web_page - retourne contenu structuré
interface FetchWebPageResult {
  url: string;
  title: string;
  textContent?: string;
  html?: string;
  links?: { text: string; href: string }[];
  images?: { src: string; alt: string }[];
  headings?: { level: number; text: string }[];
  metaTags?: Record<string, string>;
  screenshotBase64?: string;
}
```

### Pour l'ingestion web (`type: 'web'`)

On réutilisera `fetch_web_page` en mode crawler:
1. Fetch la page de départ
2. Extraire les liens
3. Filtrer par patterns
4. Crawler récursivement jusqu'à `depth` ou `maxPages`
5. Créer des nodes `WebPage` dans Neo4j

### File Parsers existants

| Fichier | Description | Status |
|---------|-------------|--------|
| `code-source-adapter.ts` | Parse TypeScript/Python → AST → Scope nodes | ✅ Complet |
| `document-file-parser.ts` | Parse PDF/DOCX via Tika ou Gemini | ✅ Complet |
| `media-file-parser.ts` | Parse images (OCR/description), 3D (metadata) | ✅ Complet |
| `data-file-parser.ts` | Parse JSON/YAML/CSV → schema + data | ✅ Complet |
| `document/` | TikaSourceAdapter, TikaParser, Chunker | ✅ Complet |

### Ce qu'il reste à faire

1. **Créer `UniversalFileAdapter`** qui dispatch vers ces parsers existants
2. **Modifier `SourceConfig`** pour enlever `adapter` obligatoire
3. **Intégrer dans `BrainManager`** pour quick-ingest

---

## Auto-Détection pour `type: 'files'`

Quand `type: 'files'`, le système auto-détecte le parser basé sur l'extension:

### Mapping Extension → Parser

| Extension | Parser | Output Nodes |
|-----------|--------|--------------|
| `.ts`, `.tsx`, `.js`, `.jsx` | TypeScriptParser | File, Scope (function, class, etc.) |
| `.py` | PythonParser | File, Scope |
| `.go` | GoParser (future) | File, Scope |
| `.rs` | RustParser (future) | File, Scope |
| `.java` | JavaParser (future) | File, Scope |
| `.md` | MarkdownParser | Document, Section |
| `.pdf` | PDFParser (Tika/Gemini) | Document, Page |
| `.docx`, `.doc` | DocxParser (Tika) | Document, Section |
| `.txt`, `.rst` | TextParser | Document |
| `.json` | JSONParser | DataFile, Schema |
| `.yaml`, `.yml` | YAMLParser | DataFile, Schema |
| `.csv` | CSVParser | DataFile, Row (sample) |
| `.png`, `.jpg`, `.jpeg`, `.webp` | ImageParser (Gemini Vision) | MediaFile, description |
| `.glb`, `.gltf`, `.obj` | ThreeDParser | MediaFile, metadata |
| `.mp3`, `.wav`, `.m4a` | AudioParser (future) | MediaFile, transcription |

### Implémentation

```typescript
class UniversalFileAdapter {
  private parsers: Map<string, FileParser> = new Map();

  constructor() {
    // Register parsers by extension
    this.registerParser(['.ts', '.tsx', '.js', '.jsx'], new TypeScriptParser());
    this.registerParser(['.py'], new PythonParser());
    this.registerParser(['.md'], new MarkdownParser());
    this.registerParser(['.pdf'], new PDFParser());
    this.registerParser(['.json'], new JSONParser());
    this.registerParser(['.png', '.jpg', '.jpeg'], new ImageParser());
    // ... etc
  }

  async parseDirectory(config: SourceConfig): Promise<ParsedGraph> {
    const files = await this.discoverFiles(config.root, config.include, config.exclude);
    const allNodes: ParsedNode[] = [];
    const allRelationships: ParsedRelationship[] = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const parser = this.parsers.get(ext) || this.defaultParser;

      const result = await parser.parseFile(file);
      allNodes.push(...result.nodes);
      allRelationships.push(...result.relationships);
    }

    return { nodes: allNodes, relationships: allRelationships, metadata: {...} };
  }
}
```

---

## Auto-Détection pour `type: 'database'`

Le driver peut être détecté depuis l'URI:

```typescript
function detectDatabaseDriver(uri: string): string {
  if (uri.startsWith('postgresql://') || uri.startsWith('postgres://')) return 'postgresql';
  if (uri.startsWith('bolt://') || uri.startsWith('neo4j://')) return 'neo4j';
  if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) return 'mongodb';
  if (uri.startsWith('mysql://')) return 'mysql';
  if (uri.endsWith('.db') || uri.endsWith('.sqlite')) return 'sqlite';
  throw new Error(`Cannot detect database driver from URI: ${uri}`);
}
```

### Database Ingestion

```typescript
class DatabaseAdapter {
  async ingest(config: SourceConfig): Promise<ParsedGraph> {
    const driver = config.connection?.driver || detectDatabaseDriver(config.connection!.uri);

    switch (driver) {
      case 'postgresql':
        return this.ingestPostgres(config);
      case 'neo4j':
        return this.ingestNeo4j(config);
      case 'mongodb':
        return this.ingestMongoDB(config);
      // ...
    }
  }

  private async ingestPostgres(config: SourceConfig): Promise<ParsedGraph> {
    // 1. Connect to PostgreSQL
    // 2. List tables (filtered by config.connection.tables)
    // 3. For each table:
    //    - Create TableSchema node
    //    - Create Column nodes
    //    - Sample rows for data types
    //    - Detect relationships (foreign keys)
    // 4. Return graph
  }
}
```

---

## Migration

### Avant (config actuelle)

```yaml
source:
  type: code
  adapter: typescript  # ← À enlever
  root: ./src
  include:
    - "**/*.ts"
  exclude:
    - node_modules
```

### Après (nouvelle config)

```yaml
source:
  type: files  # Plus générique
  root: ./src
  include:
    - "**/*.ts"
    - "**/*.md"      # Peut mixer les types maintenant!
    - "**/*.json"
  exclude:
    - node_modules
```

### Backward Compatibility

Pour la transition, on peut supporter l'ancien format:

```typescript
function normalizeSourceConfig(config: any): SourceConfig {
  // Old format with adapter
  if (config.adapter) {
    console.warn('Deprecated: "adapter" field is ignored. Auto-detection is used.');
    return {
      type: 'files',
      root: config.root,
      include: config.include,
      exclude: config.exclude,
    };
  }

  // Old type: 'code' or 'document'
  if (config.type === 'code' || config.type === 'document') {
    return {
      type: 'files',
      ...config,
    };
  }

  return config;
}
```

---

## Implémentation Plan

### Phase 1: Core Changes ✅ DONE
1. [x] Modifier `SourceConfig` dans `types/config.ts` - enlever `adapter`, ajouter nouveaux types
2. [x] Modifier `SourceConfig` dans `runtime/adapters/types.ts` - même chose
3. [x] Créer `UniversalSourceAdapter` qui dispatch vers les parsers existants
4. [x] Ajouter `normalizeSourceConfig()` pour backward compatibility

### Phase 2: File Parsers ✅ ALREADY EXISTS
5. [x] `CodeSourceAdapter` gère déjà tous les types de fichiers (TS, Python, Vue, etc.)
6. [x] `document-file-parser.ts` intégré (PDF, DOCX, XLSX)
7. [x] `media-file-parser.ts` intégré (images, 3D)
8. [x] `data-file-parser.ts` intégré (JSON, YAML, XML)

### Phase 3: Other Sources ✅ DONE (placeholders)
9. [x] `DatabaseAdapter` créé (`runtime/adapters/database-adapter.ts`) - placeholder "not yet implemented"
10. [x] `WebAdapter` créé (`runtime/adapters/web-adapter.ts`) - crawler Playwright complet
11. [x] `APIAdapter` créé (`runtime/adapters/api-adapter.ts`) - placeholder "not yet implemented"
12. [x] `database-tools.ts` créé avec `query_database`, `describe_table`, `list_tables` - placeholders

**Note**: L'approche web a changé: au lieu d'un crawler automatique, l'agent contrôle l'ingestion:
- `fetch_web_page` avec cache LRU (6 dernières pages)
- `ingest_web_page` pour sauvegarder en mémoire long-terme
- Option `ingest: true` sur fetch pour ingestion directe
- UUID déterministe basé sur URL (`UniqueIDHelper.GenerateDeterministicUUID`)
- **Crawl récursif**: params `depth`, `maxPages`, `includePatterns`, `excludePatterns` sur les deux tools
- Sécurité: reste sur même domaine uniquement

### Phase 4: Brain Integration ✅ DONE
12. [x] `BrainManager.quickIngest()` utilise `UniversalSourceAdapter`
13. [x] Tool `ingest_directory` créé
14. [x] Tool `brain_search` créé
15. [x] Tools `forget_path` et `list_brain_projects` créés

---

## Fichiers à Modifier

| Fichier | Action |
|---------|--------|
| `types/config.ts` | Modifier `SourceConfig` |
| `runtime/adapters/types.ts` | Modifier `SourceConfig` |
| `runtime/adapters/index.ts` | Exporter `UniversalFileAdapter` |
| `brain/brain-manager.ts` | Utiliser le nouvel adapter |
| `defaults/code-typescript.yaml` | Enlever `adapter` |
| `defaults/code-python.yaml` | Enlever `adapter` |

---

## Questions Ouvertes

1. **Namespacing dans Neo4j**: Comment distinguer les nodes de différentes sources?
   - Option A: Label préfixé (`Code_File`, `Doc_Document`, `DB_Table`)
   - Option B: Propriété `sourceType` sur chaque node
   - Option C: Database/namespace séparé par source

2. **Parsing async**: Les gros fichiers (PDF, vidéo) devraient-ils être parsés en background?

3. **Coût**: L'ImageParser utilise Gemini Vision (payant). Limiter par défaut?

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Quick ingest (100 files mixtes) | < 15s |
| Auto-détection accuracy | 100% (basé sur extension) |
| Memory usage | < 100MB pour 1000 fichiers |
| Backward compatibility | 100% des anciens configs fonctionnent |
