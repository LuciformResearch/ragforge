# RagForge Roadmap - Executive Summary

Ce document est un résumé exécutif de la roadmap complète de RagForge.

---

## 📋 Documents de roadmap

1. **[ROADMAP.md](./ROADMAP.md)** - Vision complète et phases principales
2. **[CHAT-ADAPTER-ROADMAP.md](./roadmaps/CHAT-ADAPTER-ROADMAP.md)** - Détails du chat adapter
3. **[COMPLETE-GENERATION-ROADMAP.md](./roadmaps/COMPLETE-GENERATION-ROADMAP.md)** - Génération automatique complète

---

## 🎯 Vision

**RagForge = Meta-framework générique pour RAG sur Neo4j**

- Introspect n'importe quelle base Neo4j
- Génère des clients TypeScript typés automatiquement
- Support multi-domaines (code, documents, chat) via adapters
- DX maximale avec auto-completion et type-safety

---

## 📅 Timeline (Q1-Q2 2025)

### ✅ Déjà fait (Baseline)

- [x] Meta-framework générique
- [x] Génération de clients TypeScript
- [x] Query builder avec pipeline
- [x] Embeddings + vector search
- [x] LLM reranking
- [x] Summarization infrastructure
- [x] Quickstart command avec Docker
- [x] Auto-detect fields avec LLM
- [x] Examples auto-générés
- [x] Popular targets pour relations (fix HAS_PARENT)

---

### 🚀 Q1 2025 - Foundation & DX

#### Sprint 1 (S01-S02) - Quickstart Enhanced
**Objectif**: Simplifier l'onboarding à 1 commande

```bash
# Objectif final
ragforge quickstart --source-type=code --language=typescript --root=../my-project
# ou avec auto-détection du langage:
ragforge quickstart --source-type=code --root=../my-project
```

**Deliverables**:
- [ ] Arguments CLI: `--source-type` (obligatoire), `--language` (optionnel), `--root` (obligatoire)
- [ ] Auto-détection du langage via package.json/tsconfig.json/requirements.txt/Cargo.toml
- [ ] Génération config depuis CLI args
- [ ] Documentation + tutoriel vidéo

**Effort**: 1-2 semaines

---

#### Sprint 2 (S03-S06) - Complete Generation
**Objectif**: `--complete` pour générer TOUS les filtres/expands

**Deliverables**:
- [ ] `FilterMethodFactory` avec templates
- [ ] `ExpandMethodFactory` avec templates
- [ ] Support custom templates
- [ ] Generated methods: ~120 par entity vs 30 actuellement
- [ ] Tests + docs

**Exemples générés**:
```typescript
// String filters
.whereNameContains()
.whereNameStartsWith()
.whereNameMatches()

// Number filters
.whereLineCountBetween()
.whereLineCountGreaterThan()

// Conditional expands
.withConsumesWhere(filter, depth)
.withConsumesSelect(fields, depth)
.withConsumesLimit(n, depth)
```

**Effort**: 3-4 semaines
**Impact**: DX++, découvrabilité++

---

### 💬 Q2 2025 - Chat & Multi-Modal

#### Sprint 3 (S07-S11) - Chat Adapter
**Objectif**: Support natif pour agents conversationnels

**Architecture**:
```
ChatAdapter → HierarchicalCompressor → ContextWindowManager
     ↓                    ↓                      ↓
  Neo4j              Summaries L1/L2/L3     Smart context
```

**Deliverables**:
- [ ] `ChatAdapter` (create session, add turns, get history)
- [ ] `HierarchicalCompressor` (L1 → L2 → L3 compression)
- [ ] `ContextWindowManager` (smart context building)
- [ ] Auto-embeddings à la volée
- [ ] Generated chat client API

**Use case**:
```typescript
const chat = createRagClient();

// Ajouter un tour
await chat.chatTurnMutations().create({
  userMessage: "How does QueryBuilder work?",
  assistantMessage: "QueryBuilder uses a pipeline...",
  sessionId: "session-123"
});

// RAG sur historique
const relevant = await chat.chatTurn()
  .semanticSearchByUserMessage("QueryBuilder", { topK: 10 })
  .execute();

// RAG sur summaries (plus rapide)
const context = await chat.sessionSummary()
  .whereLevel('L1')
  .semanticSearchByContent("QueryBuilder", { topK: 5 })
  .execute();

// Compression automatique
await chat.compressSession("session-123", {
  l1Threshold: 4000,
  l2Threshold: 16000,
  l3Threshold: 32000
});
```

**Effort**: 5-7 semaines
**Impact**: Nouveau domaine d'application majeur

---

#### Sprint 4 (S12-S14) - Structured Answers
**Objectif**: `.generateStructuredAnswer()` pour extraction structurée

**Deliverables**:
- [ ] Intégration `StructuredPromptBuilder` dans QueryBuilder
- [ ] Type-safe extraction avec generics
- [ ] Support multi-LLM (OpenAI, Anthropic, Gemini)

**Use case**:
```typescript
interface AuthorInfo {
  name: string;
  expertise: string[];
  contributions: number;
}

const info = await rag.scope()
  .semanticSearchBySource("authentication code", { topK: 20 })
  .generateStructuredAnswer<AuthorInfo>({
    structure: {
      name: "Extract primary author name",
      expertise: "List technical domains",
      contributions: "Count scopes authored"
    }
  });
```

**Effort**: 2-3 semaines
**Impact**: Extraction automatique d'infos

---

#### Sprint 5 (S15-S16) - Result Transformations
**Objectif**: `.chain()` et `.traverse()` pour pipeline avancé

**Deliverables**:
- [ ] `ChainBuilder` class
- [ ] `TraverseBuilder` class
- [ ] Support async transformations
- [ ] Type-safety avec generics

**Use case**:
```typescript
// Chain - transformer l'ensemble
const topFiles = await rag.scope()
  .semanticSearchBySource("auth", { topK: 50 })
  .chain(results => {
    const byFile = groupBy(results, r => r.entity.file);
    return sortBy(byFile, f => -f.length).slice(0, 10);
  });

// Traverse - transformer chaque résultat
const enriched = await rag.scope()
  .whereName("QueryBuilder")
  .traverse(async (result) => ({
    ...result,
    author: await getGitBlame(result.entity.file)
  }));
```

**Effort**: 1-2 semaines
**Impact**: Flexibilité++

---

### 🌐 Q2 2025 - Multi-Source

#### Sprint 6 (S17-S20) - Web Search Integration
**Objectif**: `.withWebSearch()` pour combiner local + web

**Architecture**:
```typescript
interface WebSearchProvider {
  search(query: string, options: WebSearchOptions): Promise<WebResult[]>;
}

class GoogleSearchProvider implements WebSearchProvider { }
class BraveSearchProvider implements WebSearchProvider { }
```

**Use case**:
```typescript
const answer = await rag.scope()
  .semanticSearchBySource("OAuth 2.0", { topK: 10 })
  .withWebSearch({
    query: "OAuth 2.0 best practices 2024",
    sources: ["stackoverflow.com", "oauth.net"],
    maxResults: 5
  })
  .llmRerank("Find best OAuth implementation guide", { topK: 8 })
  .generateStructuredAnswer<OAuthGuide>({ ... });
```

**Effort**: 2-3 semaines
**Impact**: RAG hybride local + web

---

## 📊 Metrics de succès

### Developer Experience
- **Onboarding time**: 30min → 5min (avec quickstart simplifié)
- **API découvrabilité**: 30 methods → 120 methods (avec --complete)
- **Type errors**: Caught at compile-time (TypeScript strict mode)

### Performance
- **Query latency**: <100ms (simple), <500ms (complex)
- **Embeddings**: Batch de 20 → <2s
- **Compression**: L1 → L2 → L3 → <5s pour 1000 messages

### Adoption
- **GitHub stars**: 100 → 1000 (Q2 2025)
- **NPM downloads**: 100/week → 1000/week
- **Community examples**: 10 → 100 projets

---

## 🏗️ Architecture Principles

### 1. Generic First
- **Jamais de hardcoding** spécifique à un domaine
- Abstractions réutilisables (adapters, providers, strategies)
- Config > Code

### 2. Type-Safe
- **Generics partout** pour inference TypeScript
- Compile-time checks
- Auto-completion dans IDEs

### 3. Composable
- **Pipeline extensible** (ajout facile de nouvelles operations)
- Builders pattern
- Functional composition

### 4. Backward Compatible
- **Pas de breaking changes** dans minor versions
- Progressive enhancement
- Deprecation warnings 2 versions avant removal

### 5. Generated > Written
- **Auto-génération maximale** du code client
- Moins de maintenance
- Meilleure cohérence

---

## 🎓 Migration Strategy

### Pour les users existants

**Phase 1 → Phase 2** (Complete Generation):
- ✅ **Backward compatible**: Méthodes existantes continuent de fonctionner
- ⚠️ **Opt-in**: `--complete` flag optionnel
- 📚 **Migration guide**: Exemples de refactoring

**Phase 2 → Phase 3** (Chat Adapter):
- ✅ **Nouveau domaine**: Pas d'impact sur code existant
- ✅ **Separate config**: `source.type: chat` vs `code`
- 📚 **Examples**: Projets de démo

**Phase 3 → Phase 4+**:
- ✅ **Additive**: Nouvelles méthodes sur QueryBuilder
- ✅ **Optional**: Toutes les features sont optionnelles
- 📚 **Docs**: Guides progressifs

---

## 👥 Team & Resources

### Core Team
- **1 dev full-time**: Architecture + implementation
- **Contributors**: Open-source community
- **LLM assistance**: Claude Code pour génération + tests

### Infrastructure
- **CI/CD**: GitHub Actions
- **Testing**: Unit + Integration + E2E
- **Docs**: Docusaurus + generated examples
- **Demo**: Live playground avec Neo4j Aura

---

## 🔮 Future (Q3+ 2025)

### Exploratory Ideas
- **Python client generation** (même API que TypeScript)
- **GraphQL adapter** (expose RAG via GraphQL)
- **Real-time subscriptions** (watch changes, auto-update)
- **Multi-tenancy** (isolated graphs dans même Neo4j)
- **Observability** (traces, metrics, debugging)
- **Cloud deployment** (Vercel/Netlify edge functions)

### Community Requests
- À définir via GitHub discussions
- Vote par stars/reactions
- Roadmap publique collaborative

---

## 📞 Contact

- **GitHub**: https://github.com/luciform-research/ragforge
- **Discussions**: https://github.com/luciform-research/ragforge/discussions
- **Issues**: https://github.com/luciform-research/ragforge/issues

---

**Last updated**: 2025-01-11
**Next review**: 2025-02-01
