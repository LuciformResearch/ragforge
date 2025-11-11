# RagForge Roadmap

Cette roadmap découle de `todo.md` et analyse le code existant pour proposer une progression structurée.

## 🎯 Vision

**RagForge doit rester un meta-framework générique** qui peut:
1. Introspect n'importe quelle base Neo4j
2. Générer des clients TypeScript typés
3. Supporter différents domaines (code, documents, chat, etc.) via des adapters

---

## 📦 Phase 1: Quickstart amélioré (Foundation)

**Objectif**: Simplifier l'onboarding avec un seul argument

### ✅ Déjà fait
- ✅ `ragforge quickstart` avec Docker, ports auto-détectés
- ✅ Génération complète (client, examples, scripts)
- ✅ Auto-detect des champs avec LLM
- ✅ Embeddings par défaut

### 🎯 TODO: Simplifié avec arguments CLI

```bash
# Objectif: Une seule commande
ragforge quickstart --source-type=code --language=typescript --root=../my-project
```

**Implémentation**:
1. Arguments CLI obligatoires pour v1:
   - `--source-type` (obligatoire): `code`, `documents`, ou `chat`
   - `--language` (optionnel pour code): auto-détecté via package.json/tsconfig.json/requirements.txt
   - `--root` (obligatoire): chemin vers le projet

2. Auto-détection du langage (quand `--language` omis):
   - Présence de `package.json` + `tsconfig.json` → typescript
   - Présence de `requirements.txt` + `*.py` → python
   - Présence de `Cargo.toml` → rust
   - Sinon: demander à l'utilisateur

3. Inférer la config depuis les arguments CLI:
   ```typescript
   // packages/cli/src/commands/quickstart.ts
   interface QuickstartArgs {
     sourceType: 'code' | 'documents' | 'chat';
     language?: 'typescript' | 'python' | 'rust';
     root: string;
     include?: string[];
     exclude?: string[];
   }

   function generateMinimalConfig(args: QuickstartArgs): RagForgeConfig {
     return {
       name: path.basename(args.root),
       source: {
         type: args.sourceType,
         adapter: args.language,
         root: args.root,
         // defaults from adapter
       }
     };
   }
   ```

3. Générer automatiquement le fichier `ragforge.config.yaml` minimal

**Abstractions nécessaires**:
- `LanguageDetector` class pour détecter le langage depuis les fichiers de config
- Extension de `parseQuickstartOptions()` pour parser nouveaux args CLI
- Validation des arguments avec messages d'erreur clairs

---

## 📚 Phase 2: Génération automatique complète (DX++)

**Objectif**: Générer TOUS les filtres et expands possibles avec `--complete`

### 🔍 Analyse de l'existant

**Déjà généré automatiquement**:
```typescript
// packages/core/src/generator/code-generator.ts

generateFieldMethod()      // ✅ Génère .whereName(), .whereFile(), etc.
generateRelationshipMethod()  // ✅ Génère .withDefinedIn(), .withConsumes(), etc.
generateInverseRelationshipMethod() // ✅ Génère méthodes inverses
```

**Ce qui manque**:
- Filtres avancés (`.whereNameContains()`, `.whereNameMatches()`)
- Expands conditionnels (`.withDefinedInWhere()`)
- Méthodes de pagination (`.page()`, `.cursor()`)
- Agrégations (`.count()`, `.groupBy()`)

### 🎯 TODO: Option `--complete`

```bash
ragforge generate --complete
```

**Génère automatiquement**:

```typescript
// Pour chaque string field
.whereName(value)           // ✅ existe
.whereNameContains(value)   // ⏳ à ajouter
.whereNameMatches(regex)    // ⏳ à ajouter
.whereNameIn(values[])      // ✅ existe (whereIn)

// Pour chaque relationship
.withDefinedIn(depth)                    // ✅ existe
.withDefinedInWhere(filter, depth)       // ⏳ à ajouter
.withDefinedInSelect(fields, depth)      // ⏳ à ajouter
```

**Implémentation**:

```typescript
// packages/core/src/generator/code-generator.ts

private static generateAdvancedFilterMethods(
  entityName: string,
  field: SearchableField
): string[] {
  const methods: string[] = [];

  if (field.type === 'string') {
    methods.push(...[
      this.generateContainsMethod(entityName, field),
      this.generateMatchesMethod(entityName, field),
      this.generateStartsWithMethod(entityName, field),
    ]);
  }

  if (field.type === 'number') {
    methods.push(...[
      this.generateRangeMethod(entityName, field),
      this.generateGreaterThanMethod(entityName, field),
    ]);
  }

  return methods;
}

private static generateConditionalExpands(
  rel: RelationshipConfig
): string[] {
  return [
    this.generateExpandWithFilterMethod(rel),
    this.generateExpandWithSelectMethod(rel),
    this.generateExpandWithLimitMethod(rel),
  ];
}
```

**Abstractions nécessaires**:
- Flag `complete: boolean` dans `GeneratorOptions`
- Refactoring de `generateFieldMethod()` en méthodes plus petites
- Templates pour chaque type de méthode avancée

---

## 🤖 Phase 3: Chat & Hierarchical Compression

**Objectif**: Support natif pour agents conversationnels avec compression hiérarchique

### 🏗️ Architecture

**Nouveau adapter**: `chat` (à côté de `code`, `documents`)

```yaml
# ragforge.config.yaml
source:
  type: chat
  adapter: generic  # Supporte n'importe quel format de chat

entities:
  - name: ChatTurn
    fields:
      - name: message
        type: string
      - name: role
        type: enum
        values: [user, assistant, system]
      - name: timestamp
        type: datetime
    relationships:
      - type: PART_OF
        target: ChatSession
      - type: REFERENCES  # Pour RAG results utilisés
        target: CodeScope

  - name: ChatSession
    fields:
      - name: sessionId
        type: string
    relationships:
      - type: HAS_SUMMARY
        target: SessionSummary

  - name: SessionSummary
    fields:
      - name: level  # L1, L2, L3
        type: string
      - name: content
        type: string
      - name: token_count
        type: number
```

### 📊 Compression hiérarchique

**Infrastructure existante**:
```typescript
// packages/runtime/src/summarization/
generic-summarizer.ts     // ✅ Peut déjà résumer n'importe quel champ
summary-storage.ts        // ✅ Stockage générique des summaries
default-strategies.ts     // ✅ Stratégies configurables
```

**Nouveau**: `HierarchicalCompressor`

```typescript
// packages/runtime/src/summarization/hierarchical-compressor.ts

export class HierarchicalCompressor {
  constructor(
    private summarizer: GenericSummarizer,
    private storage: SummaryStorage
  ) {}

  /**
   * Compresse automatiquement en niveaux L1, L2, L3
   */
  async compressSession(
    sessionId: string,
    options: {
      l1Threshold: number; // tokens
      l2Threshold: number;
      l3Threshold: number;
    }
  ): Promise<void> {
    const turns = await this.getChatTurns(sessionId);

    // L1: Résumé de chaque groupe de N messages
    if (turns.tokenCount > options.l1Threshold) {
      await this.createL1Summaries(sessionId, turns);
    }

    // L2: Résumé des résumés L1
    const l1Summaries = await this.getL1Summaries(sessionId);
    if (l1Summaries.tokenCount > options.l2Threshold) {
      await this.createL2Summary(sessionId, l1Summaries);
    }

    // L3: Résumé global ultra-condensé
    const l2Summary = await this.getL2Summary(sessionId);
    if (l2Summary.tokenCount > options.l3Threshold) {
      await this.createL3Summary(sessionId, l2Summary);
    }
  }

  /**
   * Génère les embeddings à la volée si nécessaire
   */
  async ensureEmbeddings(
    entityType: string,
    records: any[]
  ): Promise<void> {
    const withoutEmbeddings = records.filter(r => !r.embedding);

    if (withoutEmbeddings.length > 0) {
      await this.vectorSearch.generateEmbeddings(
        entityType,
        withoutEmbeddings
      );
    }
  }
}
```

### 🎯 API générée pour chat

```typescript
// Généré automatiquement par ragforge
const chat = createRagClient();

// Enregistrer un tour de chat
await chat.chatTurnMutations().create({
  message: "Comment fonctionne QueryBuilder?",
  role: "user",
  sessionId: "session-123",
  timestamp: new Date()
});

// RAG sur l'historique
const relevantTurns = await chat.chatTurn()
  .semanticSearchByMessage("QueryBuilder", { topK: 10 })
  .execute();

// RAG sur les summaries (plus rapide)
const relevantSummaries = await chat.l1Summary()
  .semanticSearchByContent("QueryBuilder", { topK: 5 })
  .execute();

// Compression automatique
await chat.compressSession("session-123", {
  l1Threshold: 4000,
  l2Threshold: 16000,
  l3Threshold: 32000
});
```

**Abstractions nécessaires**:
- `HierarchicalCompressor` class (nouveau)
- Extension de `GenericSummarizer` pour supporter niveaux
- Auto-génération embeddings dans `VectorSearch`
- Nouveau adapter `chat` dans `packages/runtime/src/adapters/chat-adapter.ts`

---

## 🧩 Phase 4: Structured LLM Answers

**Objectif**: `.generateStructuredAnswer()` pour extraire infos structurées

### 🔍 Analyse de l'existant

**Infrastructure LLM existante**:
```typescript
// packages/runtime/src/reranking/llm-reranker.ts
LLMReranker.rerank()  // ✅ Déjà intégré dans pipeline

// packages/runtime/src/llm/
structured-prompt-builder.ts  // ✅ Existe déjà!
```

**Ce qui manque**: Intégration dans QueryBuilder

### 🎯 TODO: Method `.generateStructuredAnswer()`

```typescript
// Objectif: extraire des infos structurées depuis les résultats
interface AuthorInfo {
  name: string;
  expertise: string[];
  contributions: number;
}

const authorInfo = await rag.scope()
  .semanticSearchBySource("authentication code", { topK: 20 })
  .generateStructuredAnswer<AuthorInfo>({
    structure: {
      name: "Extract the primary author's name from git blame or comments",
      expertise: "List technical domains based on code they wrote",
      contributions: "Count number of scopes they authored"
    },
    model: "gemini-2.0-flash-exp",
    temperature: 0.1
  });

console.log(authorInfo.name);  // "John Doe"
console.log(authorInfo.expertise);  // ["authentication", "security", "OAuth"]
```

**Implémentation**:

```typescript
// packages/runtime/src/query/query-builder.ts

export class QueryBuilder<T = any> {
  // ... existing methods

  async generateStructuredAnswer<S>(
    config: StructuredAnswerConfig<S>
  ): Promise<S> {
    // 1. Exécuter la query pour obtenir les résultats
    const results = await this.execute();

    // 2. Construire le prompt avec les résultats
    const promptBuilder = new StructuredPromptBuilder<S>();
    const prompt = promptBuilder.build({
      results,
      structure: config.structure,
      entityContext: this.entityContext
    });

    // 3. Appeler le LLM
    const llmProvider = this.getLLMProvider(config.model);
    const response = await llmProvider.generateStructured(
      prompt,
      config.structure
    );

    // 4. Parser et valider la réponse
    return this.parseAndValidate<S>(response, config.structure);
  }
}
```

**Abstractions nécessaires**:
- Extension de `StructuredPromptBuilder` pour supporter templates complexes
- Méthode `generateStructured()` dans `LLMProvider`
- Type-safety avec generics TypeScript

---

## 🔗 Phase 5: Result Transformations (Chain/Traverse)

**Objectif**: Méthodes pour transformer les résultats dans le pipeline

### 🎯 TODO: `.chain()` et `.traverse()`

```typescript
// .chain() - transforme l'ensemble des résultats
const topAuthors = await rag.scope()
  .semanticSearchBySource("authentication", { topK: 50 })
  .chain(results => {
    // Group by file, count, sort
    const byFile = results.reduce((acc, r) => {
      const file = r.entity.file;
      acc[file] = (acc[file] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  });

// .traverse() - transforme chaque résultat
const enrichedResults = await rag.scope()
  .whereName("QueryBuilder")
  .withConsumes(2)
  .traverse(async (result) => {
    // Enrichir avec des infos externes
    const gitBlame = await getGitBlame(result.entity.file);
    return {
      ...result,
      author: gitBlame.author,
      lastModified: gitBlame.date
    };
  });
```

**Implémentation**:

```typescript
// packages/runtime/src/query/query-builder.ts

export class QueryBuilder<T = any> {
  chain<R>(fn: (results: SearchResult<T>[]) => R | Promise<R>): ChainBuilder<R> {
    return new ChainBuilder(this, fn);
  }

  traverse<R>(
    fn: (result: SearchResult<T>) => R | Promise<R>
  ): TraverseBuilder<R> {
    return new TraverseBuilder(this, fn);
  }
}

class ChainBuilder<R> {
  constructor(
    private query: QueryBuilder,
    private transformFn: (results: any[]) => R | Promise<R>
  ) {}

  async execute(): Promise<R> {
    const results = await this.query.execute();
    return this.transformFn(results);
  }
}

class TraverseBuilder<R> {
  constructor(
    private query: QueryBuilder,
    private transformFn: (result: any) => R | Promise<R>
  ) {}

  async execute(): Promise<R[]> {
    const results = await this.query.execute();
    return Promise.all(results.map(this.transformFn));
  }
}
```

**Abstractions nécessaires**:
- Classes `ChainBuilder` et `TraverseBuilder` (nouveaux)
- Support async dans les transformations
- Type-safety avec generics

---

## 🎨 Phase 6: Web Search & Multi-Source RAG

**Objectif**: Intégrer recherche web dans le pipeline RAG

### 🎯 TODO: `.withWebSearch()`

```typescript
// Recherche combinée: code local + docs web
const answer = await rag.scope()
  .semanticSearchBySource("OAuth 2.0 implementation", { topK: 10 })
  .withWebSearch({
    query: "OAuth 2.0 best practices 2024",
    sources: ["stackoverflow.com", "oauth.net"],
    maxResults: 5
  })
  .llmRerank(
    "Find the most relevant information about implementing OAuth 2.0 securely",
    { topK: 8 }
  )
  .generateStructuredAnswer<OAuthGuide>({
    structure: {
      steps: "List implementation steps",
      security: "Security considerations",
      codeExamples: "Extract relevant code snippets"
    }
  });
```

**Architecture**:

```typescript
// packages/runtime/src/query/operations.ts

export interface WebSearchOperation extends PipelineOperation {
  type: 'webSearch';
  query: string;
  sources?: string[];
  maxResults: number;
}

// packages/runtime/src/web/web-search-provider.ts

export interface WebSearchProvider {
  search(query: string, options: WebSearchOptions): Promise<WebResult[]>;
}

export class GoogleSearchProvider implements WebSearchProvider {
  // Implémentation avec Google Custom Search API
}

export class BraveSearchProvider implements WebSearchProvider {
  // Implémentation avec Brave Search API
}
```

**Abstractions nécessaires**:
- Interface `WebSearchProvider` (abstraction pour différents providers)
- Nouvelle operation `webSearch` dans pipeline
- Merge de résultats locaux + web dans `executePipeline()`

---

## 📅 Priorités recommandées

### 🚀 Sprint 1 (1-2 semaines)
- [x] Phase 1.1: Quickstart simplifié avec détection auto
- [ ] Phase 2.1: Option `--complete` pour génération avancée

### 🎯 Sprint 2 (2-3 semaines)
- [ ] Phase 5: Chain/Traverse (fondation pour le reste)
- [ ] Phase 4: Structured LLM Answers

### 💬 Sprint 3 (3-4 semaines)
- [ ] Phase 3.1: Adapter chat
- [ ] Phase 3.2: Hierarchical compression
- [ ] Phase 3.3: Auto-embeddings

### 🌐 Sprint 4 (2-3 semaines)
- [ ] Phase 6: Web search integration

---

## 🏗️ Principes d'architecture

### 1. **Rester générique**
- Chaque feature doit fonctionner sur **n'importe quelle base Neo4j**
- Pas de hardcoding spécifique au domaine (code, chat, etc.)
- Utiliser des **adapters** pour les spécificités

### 2. **Pipeline extensible**
```typescript
// Le pipeline doit supporter de nouvelles operations facilement
PipelineOperation =
  | SemanticSearchOperation
  | FilterOperation
  | ExpandOperation
  | LLMRerankOperation
  | WebSearchOperation      // ✅ Facile à ajouter
  | ChainOperation          // ✅ Facile à ajouter
  | CustomOperation         // ✅ Users peuvent étendre
```

### 3. **Génération > Configuration**
- Préférer **auto-générer** le code plutôt que configurer
- Exemple: Générer `.whereName()` au lieu de `.where('name', value)`
- Meilleure DX avec autocomplete TypeScript

### 4. **Composition > Inheritance**
- Utiliser des **builders** et **operations** plutôt que des classes complexes
- Facilite l'ajout de features sans casser l'API existante

### 5. **Type-safety partout**
```typescript
// Les résultats doivent être typés correctement
const result: ChainResult<AuthorStats> = await rag.scope()
  .chain<AuthorStats>(computeAuthorStats);
```

---

## 🎓 Migration path

### Pour chaque phase
1. **Backward compatible**: Les APIs existantes continuent de fonctionner
2. **Progressive enhancement**: Les nouvelles features sont optionnelles
3. **Documentation**: Chaque feature a des exemples générés automatiquement
4. **Testing**: Tests unitaires + exemples fonctionnels

### Deprecation policy
- Aucune breaking change dans minor versions
- Deprecation warnings 2 versions avant removal
- Migration guides automatiques via CLI
