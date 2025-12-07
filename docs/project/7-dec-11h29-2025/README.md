# RagForge Roadmaps - 7 December 2025

Session de planning pour la prochaine phase de RagForge.

## Documents

| Roadmap | Description | Status |
|---------|-------------|--------|
| [Agent Integration](./ROADMAP-AGENT-INTEGRATION.md) | File tracking, incremental ingestion, multi-project | In Progress |
| [Agent Brain](./ROADMAP-AGENT-BRAIN.md) | Architecture globale "cerveau persistant" | Planning |

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

Finir l'implémentation de ROADMAP-AGENT-INTEGRATION.md:
- [x] Phase 1: Media ingestion (image/3D tools) ✅ DONE
- [x] Phase 2: File tracker auto-start & logging ✅ DONE
- [x] Phase 3: Embedding auto-trigger ✅ DONE
- [x] Phase 4: Deletion cascade ✅ DONE
- [x] Phase 5: Multi-project registry ✅ DONE
- [ ] Phase 6: Quick directory ingestion
- [ ] Phase 7: Tests end-to-end

### Phase 5 Summary
- `ProjectRegistry` créé dans `packages/core/src/runtime/projects/`
- Tools `list_projects`, `switch_project`, `unload_project` dans `project-management-tools.ts`
- `AgentProjectContext` intégré avec le registry
- `syncContextFromRegistry()` synchronise l'état du projet actif
- Cleanup via `registry.dispose()` ferme toutes les connexions
