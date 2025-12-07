# Roadmap: Agent Brain Architecture

**Created**: 2025-12-07 11:29
**Status**: Planning
**Author**: Lucie Defraiteur
**Related**: [ROADMAP-AGENT-INTEGRATION.md](./ROADMAP-AGENT-INTEGRATION.md)

---

## Vision

Transformer RagForge d'un outil de RAG sur code en un **agent universel avec mémoire persistante**.

L'agent peut:
- Explorer et ingérer n'importe quel contenu (code, documents, médias, web)
- Se souvenir de tout ce qu'il a exploré
- Faire des liens entre différentes sources
- Créer du contenu (code, images, 3D, documents)
- Travailler sur plusieurs projets/contextes simultanément

**Comme Claude Code, mais avec une mémoire persistante sur disque.**

---

## Architecture: Hybrid Brain + Links

### Structure Globale

```
~/.ragforge/                          # Agent Brain (global)
  brain/
    neo4j/                            # Base de données centrale
    embeddings-cache/                 # Cache des embeddings
  config.yaml                         # Config globale agent
  projects.yaml                       # Registry des projets connus
  history/                            # Historique des conversations

/path/to/project-a/                   # Projet RagForge "officiel"
  ragforge.config.yaml                # Config complète
  .ragforge/
    local-cache/                      # Cache local (optionnel)

/path/to/random-code/                 # Quick ingest
  .ragforge/
    brain-link.yaml                   # Juste un pointeur vers le brain
    auto-config.yaml                  # Config auto-générée
```

### Namespacing dans le Brain

```
Brain Neo4j:
├── project:project-a/
│   ├── File nodes
│   ├── Scope nodes
│   └── relationships
├── project:random-code-abc123/
│   └── ...
├── web:https-docs-python-org/
│   └── WebPage nodes
└── conversation:session-xyz/
    └── Message nodes (optionnel)
```

---

## Phase 1: Brain Bootstrap

### 1.1 Structure du Brain

```typescript
// packages/core/src/brain/brain-manager.ts

interface BrainConfig {
  path: string;              // ~/.ragforge par défaut
  neo4j: {
    type: 'embedded' | 'external';
    uri?: string;            // Pour external
    embeddedDataPath?: string;
  };
  embeddings: {
    provider: 'gemini' | 'openai';
    cacheEnabled: boolean;
  };
}

class BrainManager {
  private neo4j: Neo4jClient;
  private projects: ProjectRegistry;

  static async initialize(config?: Partial<BrainConfig>): Promise<BrainManager>;

  // Project management
  async registerProject(path: string, config: RagForgeConfig): Promise<string>;
  async getProject(projectId: string): Promise<RegisteredProject | null>;
  async listProjects(): Promise<RegisteredProject[]>;

  // Quick ingest
  async quickIngest(path: string, options?: QuickIngestOptions): Promise<IngestResult>;

  // Unified query across all knowledge
  async search(query: string, options?: SearchOptions): Promise<UnifiedSearchResult>;

  // Cleanup
  async forgetPath(path: string): Promise<void>;
  async gc(): Promise<GCStats>;  // Garbage collect orphaned nodes
}
```

### 1.2 Fichier projects.yaml

```yaml
# ~/.ragforge/projects.yaml
version: 1
projects:
  - id: "project-a"
    path: "/home/user/code/project-a"
    type: "ragforge-project"
    lastAccessed: "2025-12-07T11:29:00Z"
    nodeCount: 1250

  - id: "random-code-abc123"
    path: "/home/user/Downloads/some-lib"
    type: "quick-ingest"
    lastAccessed: "2025-12-06T15:00:00Z"
    nodeCount: 42
    autoCleanup: true  # Supprimer après 30 jours sans accès

  - id: "web-python-docs"
    path: "https://docs.python.org/3/"
    type: "web-crawl"
    lastAccessed: "2025-12-05T10:00:00Z"
    nodeCount: 500
```

### 1.3 CLI Global

```bash
# Initialisation du brain
ragforge brain init

# Status du brain
ragforge brain status
# Output:
# Brain: ~/.ragforge/brain
# Neo4j: embedded (running)
# Projects: 3 registered
# Total nodes: 1,792
# Disk usage: 45 MB

# Lister les projets
ragforge brain projects

# Nettoyer
ragforge brain gc              # Garbage collect
ragforge brain forget <path>   # Oublier un path
```

---

## Phase 2: Context Resolution

### 2.1 Logique de Résolution

Quand l'agent/CLI reçoit un path, déterminer le contexte:

```typescript
// packages/core/src/brain/context-resolver.ts

type IngestionContext =
  | { type: 'ragforge-project'; config: RagForgeConfig; projectId: string }
  | { type: 'subdir-of-project'; parent: RagForgeConfig; parentId: string; relativePath: string }
  | { type: 'quick-ingest'; namespace: string; autoConfig: AutoConfig }
  | { type: 'already-ingested'; projectId: string; lastIngest: Date };

async function resolveContext(targetPath: string): Promise<IngestionContext> {
  const absolutePath = path.resolve(targetPath);

  // 1. Chercher ragforge.config.yaml dans le path ou parents
  const projectRoot = await findRagforgeProject(absolutePath);

  if (projectRoot) {
    if (projectRoot === absolutePath) {
      // C'est la racine du projet
      return {
        type: 'ragforge-project',
        config: await loadConfig(projectRoot),
        projectId: await getOrCreateProjectId(projectRoot)
      };
    } else {
      // C'est un sous-dossier d'un projet
      return {
        type: 'subdir-of-project',
        parent: await loadConfig(projectRoot),
        parentId: await getOrCreateProjectId(projectRoot),
        relativePath: path.relative(projectRoot, absolutePath)
      };
    }
  }

  // 2. Vérifier si déjà ingéré dans le brain
  const existing = await brain.findByPath(absolutePath);
  if (existing) {
    return {
      type: 'already-ingested',
      projectId: existing.id,
      lastIngest: existing.lastIngest
    };
  }

  // 3. Quick ingest - auto-detect et créer namespace
  const detected = await detectFileTypes(absolutePath);
  return {
    type: 'quick-ingest',
    namespace: generateNamespace(absolutePath),
    autoConfig: generateAutoConfig(detected)
  };
}
```

### 2.2 Sous-dossier de Projet

Quand on ingère un sous-dossier d'un projet existant:

```typescript
async function handleSubdirIngest(ctx: SubdirContext): Promise<IngestResult> {
  // 1. Vérifier que le parent n'exclut pas ce path
  const isExcluded = matchesAnyPattern(ctx.relativePath, ctx.parent.source.exclude);

  if (isExcluded) {
    // Le parent l'exclut - ingérer séparément dans le brain
    return await brain.quickIngest(ctx.absolutePath, {
      namespace: `${ctx.parentId}:excluded:${ctx.relativePath}`
    });
  }

  // 2. Le parent devrait l'avoir - vérifier si à jour
  const parentNodes = await brain.getNodesInPath(ctx.parentId, ctx.relativePath);

  if (parentNodes.length === 0) {
    // Pas encore ingéré - trigger ingestion du parent pour ce path
    return await triggerParentIncrementalIngest(ctx.parentId, ctx.relativePath);
  }

  // 3. Déjà ingéré via parent - retourner les nodes existants
  return {
    type: 'already-covered',
    parentProject: ctx.parentId,
    nodeCount: parentNodes.length
  };
}
```

### 2.3 Auto-Exclusion Intelligente

```typescript
// Quand on ingère un parent, exclure les sous-dossiers déjà ingérés séparément
async function getEffectiveExcludes(projectPath: string, config: RagForgeConfig): Promise<string[]> {
  const baseExcludes = config.source.exclude || [];

  // Trouver les sous-dossiers qui ont leur propre .ragforge/
  const subdirProjects = await findSubdirWithRagforge(projectPath);

  // Les exclure pour éviter duplication
  return [...baseExcludes, ...subdirProjects.map(p => p.relativePath)];
}
```

---

## Phase 3: Unified Search

### 3.1 Cross-Project Queries

```typescript
interface UnifiedSearchOptions {
  // Filtrer par projet(s)
  projects?: string[];         // IDs ou 'all'
  projectTypes?: ('ragforge-project' | 'quick-ingest' | 'web-crawl')[];

  // Types de nodes
  nodeTypes?: string[];        // 'Scope', 'File', 'WebPage', etc.

  // Recherche
  semantic?: boolean;          // Utiliser embeddings
  textMatch?: string;          // Pattern texte

  // Pagination
  limit?: number;
  offset?: number;
}

interface UnifiedSearchResult {
  results: Array<{
    node: any;
    score: number;
    projectId: string;
    projectPath: string;
    projectType: string;
  }>;
  totalCount: number;
  searchedProjects: string[];
}

// Usage
const results = await brain.search("authentication logic", {
  projects: 'all',
  nodeTypes: ['Scope', 'Function'],
  semantic: true,
  limit: 20
});

// Résultats de tous les projets, triés par pertinence
```

### 3.2 Agent Tool: brain_search

```typescript
const brainSearchTool = {
  name: 'brain_search',
  description: `Search across all knowledge in the agent's brain.

This searches everything the agent has ever explored:
- Code projects (RagForge projects)
- Quick-ingested directories
- Web pages crawled
- Documents analyzed

Parameters:
- query: What to search for (semantic search)
- projects: Limit to specific projects (optional)
- types: Limit to node types like 'Function', 'Class', 'WebPage' (optional)

Example: brain_search({ query: "how to handle authentication" })
Returns results from all known sources.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      projects: { type: 'array', items: { type: 'string' } },
      types: { type: 'array', items: { type: 'string' } }
    },
    required: ['query']
  }
};
```

---

## Phase 4: Web Knowledge

### 4.1 Web Crawl & Ingest

```typescript
// packages/core/src/brain/web-crawler.ts

interface WebCrawlOptions {
  url: string;
  depth?: number;           // Combien de niveaux de liens suivre
  maxPages?: number;        // Limite de pages
  includePatterns?: string[]; // URLs à inclure
  excludePatterns?: string[]; // URLs à exclure
}

async function crawlAndIngest(options: WebCrawlOptions): Promise<CrawlResult> {
  const pages: WebPage[] = [];

  // 1. Crawler avec Playwright
  for await (const page of crawl(options)) {
    // 2. Extraire contenu (HTML → Markdown)
    const content = await extractContent(page.html);

    // 3. Créer nodes
    pages.push({
      url: page.url,
      title: page.title,
      content: content.markdown,
      links: content.links,
      lastCrawled: new Date()
    });
  }

  // 4. Ingérer dans le brain avec namespace web:
  await brain.ingestWeb(options.url, pages);

  return { pagesIngested: pages.length };
}
```

### 4.2 Agent Tool: explore_web

```typescript
const exploreWebTool = {
  name: 'explore_web',
  description: `Crawl and ingest web pages into the agent's knowledge base.

After crawling, the content becomes searchable via brain_search.

Parameters:
- url: Starting URL to crawl
- depth: How many link levels to follow (default: 1)
- max_pages: Maximum pages to crawl (default: 10)

Example: explore_web({ url: "https://docs.python.org/3/library/asyncio.html", depth: 2 })`,
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      depth: { type: 'number' },
      max_pages: { type: 'number' }
    },
    required: ['url']
  }
};
```

---

## Phase 5: Conversation Memory (Optional)

### 5.1 Persistent Conversation Context

```typescript
// Optionnel: stocker les conversations importantes dans le brain

interface ConversationNode {
  sessionId: string;
  timestamp: Date;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  relatedNodes?: string[];  // IDs des nodes référencés
}

// L'agent peut se souvenir de conversations passées
await brain.search("what did we discuss about authentication?", {
  nodeTypes: ['Conversation'],
  projects: ['conversation:*']
});
```

### 5.2 Knowledge Graph Links

```typescript
// Créer des liens entre conversations et knowledge

// Quand l'agent répond en citant du code:
await brain.createRelationship({
  from: { type: 'Conversation', id: messageId },
  to: { type: 'Scope', id: scopeId },
  type: 'REFERENCES'
});

// Plus tard: "Show me what we discussed about this function"
```

---

## Phase 6: Agent Personality & Preferences

### 6.1 Config Globale Agent

```yaml
# ~/.ragforge/config.yaml
agent:
  name: "RagForge Agent"

  # Préférences de recherche
  search:
    defaultLimit: 20
    semanticWeight: 0.7

  # Auto-ingestion
  autoIngest:
    enabled: true
    watchInterval: 5000  # ms

  # Cleanup policy
  cleanup:
    autoGC: true
    quickIngestRetention: 30  # jours
    webCrawlRetention: 7      # jours

  # Cost limits
  costs:
    maxEmbeddingsPerDay: 10000
    warnThreshold: 1.00  # USD

  # Providers
  providers:
    llm: "gemini-2.0-flash"
    embeddings: "text-embedding-004"
    imageGen: "imagen-3"
    threeD: "trellis"
```

---

## Implementation Priority

### Sprint 1: Brain Foundation
1. `BrainManager` class avec Neo4j singleton
2. `projects.yaml` registry
3. `ragforge brain init/status` CLI
4. Context resolution (project vs quick-ingest)

### Sprint 2: Quick Ingest
5. `ingest_directory` tool & CLI
6. Auto-detect file types
7. Subdir-of-project handling
8. `.ragforge/brain-link.yaml` marker

### Sprint 3: Unified Search
9. Cross-project semantic search
10. `brain_search` tool
11. Result ranking across sources

### Sprint 4: Web Knowledge
12. Web crawler with Playwright
13. `explore_web` tool
14. Web content → nodes pipeline

### Sprint 5: Polish
15. Conversation memory (optional)
16. Garbage collection
17. Cost tracking
18. Agent config/preferences

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Brain init time | < 2s |
| Quick ingest (100 files) | < 10s |
| Cross-project search | < 500ms |
| Web crawl (10 pages) | < 30s |
| Memory per 1000 nodes | < 10 MB |

---

## Related Documents

- [ROADMAP-AGENT-INTEGRATION.md](./ROADMAP-AGENT-INTEGRATION.md) - File tracking & incremental ingestion
- [../UNIVERSAL-FILE-INGESTION.md](../UNIVERSAL-FILE-INGESTION.md) - File type parsers
- [../MEDIA-TOOLS.md](../MEDIA-TOOLS.md) - Image/3D generation
