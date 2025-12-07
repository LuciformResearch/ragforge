# RagForge Roadmaps - 7 December 2025

Session de planning pour la prochaine phase de RagForge.

## Documents

| Roadmap | Description | Status |
|---------|-------------|--------|
| [Agent Integration](./ROADMAP-AGENT-INTEGRATION.md) | File tracking, incremental ingestion, multi-project | ✅ Done (Phase 1-5) |
| [Agent Brain](./ROADMAP-AGENT-BRAIN.md) | Architecture globale "cerveau persistant" | ✅ Done (Phase 1-4) |
| [Universal Source Adapter](./UNIVERSAL-SOURCE-ADAPTER.md) | Refonte SourceConfig, auto-détection, multi-sources | ✅ Done |
| [Points à Unifier](./additionnal_problems.md) | Dettes techniques identifiées | Reference |

## Vision

Transformer RagForge d'un outil CLI de RAG sur code en un **agent universel avec mémoire persistante**.

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT BRAIN                            │
│  ~/.ragforge/brain/                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Neo4j                             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │Project A │ │Quick     │ │Web Crawl │            │   │
│  │  │(code)    │ │Ingest    │ │(docs)    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │       ↓            ↓            ↓                   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │         Unified Semantic Search              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↑                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   AGENT                              │   │
│  │  - brain_search: chercher dans tout                 │   │
│  │  - ingest_directory: ingérer n'importe quoi         │   │
│  │  - explore_web: crawler et ingérer le web           │   │
│  │  - write_file / generate_image / generate_3d        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Ordre d'implémentation

1. **Agent Integration** (en cours)
   - Media ingestion dans les tools
   - File watcher auto-start
   - Logging visible
   - Embedding auto-trigger
   - Deletion cascade

2. **Agent Brain** (après)
   - Brain manager singleton
   - Context resolution (project vs quick-ingest)
   - Quick ingest CLI/tool
   - Unified cross-project search
   - Web crawler

## Prochaines étapes immédiates

### Agent Integration ✅ DONE
- [x] Phase 1: Media ingestion (image/3D tools)
- [x] Phase 2: File tracker auto-start & logging
- [x] Phase 3: Embedding auto-trigger
- [x] Phase 4: Deletion cascade
- [x] Phase 5: Multi-project registry

### Brain + Universal Source Adapter ✅ DONE
- [x] `BrainManager` créé (structure de base)
- [x] **Universal Source Adapter** - Refonte `SourceConfig`:
  - [x] Enlever `adapter` obligatoire
  - [x] `type: 'files' | 'database' | 'api' | 'web'`
  - [x] `UniversalSourceAdapter` avec dispatch par type
  - [x] Auto-détection du parser basé sur extension (via CodeSourceAdapter)
- [x] Quick ingest (`ingest_directory` tool)
- [x] `brain_search` tool (cross-project)
- [x] `forget_path` + `list_brain_projects` tools
- [x] DatabaseAdapter (placeholder - throws "not yet implemented")
- [x] WebAdapter (crawler avec Playwright) - créé mais non utilisé directement
- [x] APIAdapter (placeholder - throws "not yet implemented")

### Web Ingestion ✅ DONE
- [x] **LRU Cache** pour `fetch_web_page` (6 dernières pages)
- [x] Option `ingest: true` sur `fetch_web_page` pour ingérer direct
- [x] Option `force: true` pour bypass cache
- [x] Tool `ingest_web_page` dans brain-tools.ts
- [x] UUID déterministe basé sur URL (`UniqueIDHelper.GenerateDeterministicUUID`)
- [x] `BrainManager.ingestWebPage()` avec node WebPage + rawHtml stocké

### Recursive Web Crawling ✅ DONE
- [x] **Param `depth`** sur `fetch_web_page` (0=page unique, 1+=suivre les liens)
- [x] **Param `maxPages`** pour limiter le nombre de pages (défaut: 10)
- [x] **Params `includePatterns` / `excludePatterns`** (regex) pour filtrer les URLs
- [x] Résultat avec `children[]` contenant les pages enfants
- [x] Même params sur `ingest_web_page` pour ingestion récursive
- [x] Sécurité: reste sur le même domaine uniquement

### Tool Schema Improvements ✅ DONE
- [x] **`ToolPropertySchema.optional`** - champ pour marquer les params optionnels
- [x] **`processToolSchema()`** - enrichit les descriptions avec "(optional)"
- [x] **`processToolSchemas()`** - traitement par lot
- [x] Support `oneOf`/`anyOf` dans les schemas (type optionnel)

### À Faire
- [ ] DatabaseAdapter complet (PostgreSQL, MySQL, etc.)
- [ ] Tests end-to-end
- [ ] Sub-agent tool subsets (permettre de limiter les outils d'un sous-agent)

### Résumé Phase 5
- `ProjectRegistry` dans `packages/core/src/runtime/projects/`
- Tools `list_projects`, `switch_project`, `unload_project`
- `AgentProjectContext` intégré avec le registry
- `syncContextFromRegistry()` synchronise l'état
- Cleanup via `registry.dispose()`
