# Session Notes - 9 Dec 2025

## Résumé de la session

Cette session a porté sur l'amélioration du système d'agent RagForge, notamment:
- Correction des outils pour fonctionner sans projet chargé
- Nettoyage des outils de gestion de projet redondants
- Ajout de `get_schema` et `run_cypher` aux brain tools
- Enrichissement de `NODE_SCHEMAS` avec les propriétés optionnelles
- Ajout de l'identité agent (name, color, language, persona) persistée dans le brain
- Roadmap pour un système de personas multiples

---

## Fichiers clés modifiés

### Core - Brain Manager
**`packages/core/src/brain/brain-manager.ts`**
- `BrainConfig.agentSettings` ajouté (ligne ~96-108):
  - `language`, `name`, `color`, `persona`, `personaTemplate`
- Nouvelles méthodes (fin du fichier ~2595-2620):
  - `getAgentSettings()` - récupère les settings
  - `setAgentSettings(settings)` - sauvegarde (+ saveConfig)
  - `hasAgentSettings()` - vérifie si configuré
- `saveConfig()` et `loadConfig()` mis à jour pour persister `agentSettings`

### Core - Node Schema (Source de vérité)
**`packages/core/src/utils/node-schema.ts`**
- `NodeTypeSchema` interface ajoutée (ligne ~212-220):
  - `required: string[]`
  - `optional?: string[]`
  - `description?: string`
- `NODE_SCHEMAS` enrichi avec TOUS les champs optionnels pour chaque type de node
- C'est LA source de vérité pour les schémas de nodes

### Core - Brain Tools
**`packages/core/src/tools/brain-tools.ts`**
- Import de `NODE_SCHEMAS`, `CONTENT_NODE_LABELS`, `NodeTypeSchema`
- `generateGetSchemaTool()` et `generateGetSchemaHandler()` ajoutés (~2307-2417)
  - Retourne `required`, `optional`, `description` pour chaque type
  - Liste les relationships communes
  - Tips pour écrire des requêtes Cypher
- `generateRunCypherTool()` enrichi avec hint vers `get_schema`
- `generateRunCypherHandler()` attend maintenant le lock d'ingestion (comme brain_search)
- `get_schema` et `run_cypher` ajoutés à `generateBrainTools()` et `generateBrainToolHandlers()`

### Core - RagAgent
**`packages/core/src/runtime/agents/rag-agent.ts`**
- `AgentIdentitySettings` interface exportée (ligne ~711-720):
  ```typescript
  interface AgentIdentitySettings {
    name: string;      // default: 'Ragnarök'
    color: string;     // default: 'magenta'
    language?: string;
    persona: string;
  }
  ```
- `DEFAULT_AGENT_IDENTITY` constant exportée
- `DEFAULT_PERSONA_TEMPLATE` (alias pour compatibilité)
- `getAgentIdentity(brainSettings?)` helper exporté
- `translatePersona(template, lang, llm)` fonction prête à utiliser
- `RagAgent.identity` - champ public readonly
- Constructeur initialise `identity` depuis brain settings ou defaults
- Log au démarrage: `✶ {name} initialized` + liste des projets brain
- System prompt inclut maintenant la liste des projets du brain

### Core - FS Tools
**`packages/core/src/tools/fs-tools.ts`**
- `grep_files` et `search_files` utilisent maintenant `process.cwd()` comme fallback si pas de projet chargé (lignes ~659, ~735)

### Fichier supprimé
**`packages/core/src/tools/project-management-tools.ts`** - SUPPRIMÉ
- `list_projects`, `switch_project`, `unload_project` retirés
- Remplacés par `list_brain_projects` de brain-tools.ts

---

## Architecture des Tools

### Hiérarchie des outils
```
generateBrainTools()        → Outils pour agents (knowledge base)
├── list_brain_projects
├── brain_search
├── ingest_directory
├── ingest_web_page
├── forget_path
├── exclude_project / include_project
├── list_watchers / start_watcher / stop_watcher
├── read_file, write_file, edit_file, create_file, delete_path (brain-aware)
├── get_schema                 ← NOUVEAU
└── run_cypher                 ← NOUVEAU (+ wait for ingestion)

generateSetupTools()        → Outils pour MCP users (config)
├── set_api_key
├── get_brain_status
├── cleanup_brain
└── run_cypher
```

### Contexte des outils
- `BrainToolsContext` = `{ brain: BrainManager }`
- Passé à `generateBrainToolHandlers(ctx)`
- Le brain donne accès à Neo4j, embeddings, projets, etc.

---

## Schéma des Nodes (NODE_SCHEMAS)

### Types de nodes avec leurs propriétés

| Node Type | Required | Optional (exemples) |
|-----------|----------|---------------------|
| Scope | name, type, file, language, startLine, endLine, linesOfCode, source, signature | returnType, parameters, parent, parentUUID, modifiers, complexity, extends, implements, decorators, docstring, *Embedding |
| MarkdownDocument | file, type, title, sectionCount, codeBlockCount, linkCount, imageCount, wordCount | frontMatter, sections |
| MarkdownSection | title, level, content, file, startLine, endLine, slug | ownContent, rawText, parentTitle, *Embedding |
| CodeBlock | file, language, code, rawText, startLine, endLine | index, linesOfCode, contentEmbedding |
| WebPage | url, title, textContent, headingCount, linkCount, depth, crawledAt | description, headingsJson, rawHtml, contentEmbedding |
| ImageFile | file, path, format, category, sizeBytes | width, height, analyzed, description, ocrText |
| ThreeDFile | file, path, format, category, sizeBytes | meshCount, materialCount, textureCount, animationCount, gltfVersion |
| File | path, name, directory, extension | contentHash, rawContentHash, mtime |
| Directory | path, depth | - |
| Project | name, rootPath | gitRemote, indexedAt |

---

## Flow d'initialisation Agent

```
createRagAgent(options)
  │
  ├─ Load config (yaml ou options.config)
  ├─ Generate tools from config
  ├─ Add file tools (if enabled)
  ├─ Add image tools (if enabled)
  ├─ Add 3D tools (if enabled)
  ├─ Add project tools (if enabled)
  ├─ Add web tools (if enabled)
  ├─ Add fs tools (if enabled) ← list_directory, glob_files, etc.
  ├─ Add shell tools (if enabled)
  ├─ Add context tools (if enabled)
  ├─ Add brain tools (if enabled) ← brain_search, get_schema, run_cypher, etc.
  ├─ Add planning tools (if enabled)
  │
  └─ new RagAgent(config, tools, handlers, llm, options)
       │
       ├─ Initialize identity from brain settings
       ├─ Log brain projects
       └─ Ready!
```

---

## Points d'attention

### Ingestion Lock
- `brain_search` et `run_cypher` attendent que l'ingestion soit terminée
- Utilisent `ctx.brain.getIngestionLock()` et `ctx.brain.hasPendingEdits()`
- Timeout de 30s avant de continuer avec données potentiellement stales

### System Prompt
- Construit dynamiquement dans `RagAgent.buildSystemPrompt()`
- Inclut:
  - Capabilities disponibles
  - Workflow recommandé
  - Instruction de répondre dans la langue de l'utilisateur
  - Liste des projets du brain (si brainToolsContext présent)
  - Task context (si sub-agent)

### Persona actuel (Ragnarök)
- Défini dans `DEFAULT_AGENT_IDENTITY.persona`
- Ton mystique/roleplay - certains utilisateurs préfèrent plus sobre
- La roadmap persona-system prévoit des alternatives

---

## Prochaines étapes (Persona System)

Voir `persona-system-roadmap.md` dans ce même dossier.

1. **Phase 1**: Structure `personas[]` + `activePersonaId` dans BrainConfig
2. **Phase 2**: LLM enhancer pour générer des personas
3. **Phase 3**: Commandes `/list-personas`, `/set-persona`, `/create-persona`
4. **Phase 4**: Intégration TUI avec nom/couleur dynamique

---

## Commandes utiles

```bash
# Build
npm run build

# Test TUI
cd packages/cli && node dist/esm/index.js tui

# Test agent
cd packages/cli && node dist/esm/index.js agent

# Voir les projets du brain
# (dans l'agent) list_brain_projects()

# Voir le schema
# (dans l'agent) get_schema() ou get_schema({ node_type: "Scope" })
```
