# Points à Unifier (notés pendant Phase 5)

## 🔄 À UNIFIER

### 1. AgentProjectContext (CLI) et LoadedProject → même structure
**Status**: ✅ RÉSOLU dans Phase 5
- `AgentProjectContext` dans `packages/cli/src/commands/agent.ts`
- `LoadedProject` dans `packages/core/src/runtime/projects/project-registry.ts`
- Solution implémentée: `AgentProjectContext` contient un `ProjectRegistry` et `syncContextFromRegistry()` synchronise les champs

### 2. Création Neo4jClient dispersée
**Locations**:
- `agent.ts:loadProjectIntoContext()` - crée client + ragClient
- `embeddings.ts:runEmbeddingsGenerate()` - crée son propre client
- `project-tools.ts` handlers - via context
**Solution à terme**: Centraliser dans `ProjectRegistry` ou `BrainManager`

### 3. Config loading dupliqué
**Locations**:
- `agent.ts:loadProjectIntoContext()` - charge config
- `agent.ts:startFileWatcherForProject()` - recharge config
- `embeddings.ts` - charge config
- `quickstart.ts` - charge/écrit config
**Solution**: `LoadedProject.config` dans le registry, une seule source de vérité

### 4. getEnv / ensureEnvLoaded → logique incohérente
**Problème**:
- `ensureEnvLoaded()` charge les .env et retourne rootDir
- `getEnv()` lit une variable avec fallback
- Parfois on utilise `process.env.VAR` directement
- Parfois on lit le .env du projet, parfois celui de ~/.ragforge
**Solution à terme**: Hiérarchie claire:
1. `~/.ragforge/.env` (global)
2. `projectPath/.ragforge/generated/.env` (projet)
3. `process.env` (runtime/override)