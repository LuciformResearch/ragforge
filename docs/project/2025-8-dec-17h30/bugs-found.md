# Bugs Trouvés - Session 8 Dec 2025

## 1. `install_package` - Pas de paramètre `path`

**Problème:** L'outil installe dans le `projectRoot` du contexte sans possibilité de spécifier un chemin.

**Impact:** On ne sait pas où ça installe, risque d'installer au mauvais endroit.

**Solution:** Ajouter param `path` avec hint: "Recommended to specify explicitly unless you've verified the current working directory"

**Fichier:** `packages/core/src/tools/file-tools.ts:1023-1142`

---

## 2. `brain_search` - Filtre `types` ne marche pas avec semantic search

**Problème:** Quand on utilise `types: ["Function"]` ou `types: ["function"]` avec `semantic: true`, ça retourne 0 résultats même si les nodes existent.

**Reproduction:**
```typescript
// Retourne 0 résultats
brain_search({ query: "install_package", semantic: true, types: ["Function"] })
brain_search({ query: "install_package", semantic: true, types: ["function"] })

// Retourne des résultats (sans types filter)
brain_search({ query: "install_package", semantic: true })
```

**Impact:** Impossible de filtrer par type de node en recherche sémantique.

**Cause racine:** Le code utilise `n:${t}` qui cherche des **labels Neo4j**, mais les nodes ont une **propriété** `type: "function"`, pas un label.

```javascript
// Code actuel (FAUX)
const labels = options.nodeTypes.map(t => `n:${t}`).join(' OR ');
nodeTypeFilter = `AND (${labels})`;

// Fix requis
nodeTypeFilter = `AND n.type IN $nodeTypes`;
params.nodeTypes = options.nodeTypes.map(t => t.toLowerCase());
```

**Fichier:** `packages/core/src/brain/brain-manager.ts:1518-1521`

---

## 3. `brain_search` - Description `types` manque hint sur casing

**Problème:** La description du param `types` dit `"Function", "Class", "File"` mais les nodes stockent en minuscule (`function`, `class`, `file`).

**Impact:** Confusion utilisateur, 0 résultats inattendus.

**Solution:** 
1. Normaliser en lowercase dans le handler
2. OU mettre à jour la description: `types are lowercase: "function", "class", "file", "method", "variable"`

---

## 4. `list_brain_projects` - Projet avec 0 nodes après ingestion

**Observation:** `ragforge-packages-lveh` affichait `nodeCount: 0` mais contenait bien des nodes (la recherche fonctionnait).

**À investiguer:** Le count est-il mis à jour correctement après ingestion?

---

---

## 5. Watcher s'arrête tout seul

**Problème:** Le file watcher semble s'arrêter sans notification après un certain temps.

**Impact:** Les modifications ne sont plus détectées automatiquement.

**À investiguer:** 
- Timeout? 
- Crash silencieux?
- Logs à vérifier

---

## 6. `edit_file` ne trigger pas d'ingestion

**Problème:** Quand on édite un fichier via le MCP tool `edit_file`, ça ne semble pas déclencher de ré-ingestion du fichier modifié.

**Cause identifiée:** 
- Le handler `edit_file` appelle bien `ctx.onFileModified()` (file-tools.ts:612-614)
- MAIS `onFileModified` est `undefined` si `ctx.brainManager` est null (mcp-server.ts:324/367)
- `brainManager` est initialisé à la ligne 226, mais si ça échoue silencieusement ou si on appelle des tools avant init...

**Solution proposée - Auto-init & Auto-watch:**

```typescript
// Middleware avant chaque tool call
async function ensureBrainReady(ctx: McpContext, filePath?: string) {
  // 1. Auto-init brainManager si pas fait
  if (!ctx.brainManager) {
    ctx.brainManager = await BrainManager.getInstance();
    await ctx.brainManager.initialize();
  }
  
  // 2. Auto-start watcher si le fichier est dans un projet connu
  if (filePath) {
    const project = ctx.brainManager.findProjectForPath(filePath);
    if (project && !ctx.brainManager.hasWatcher(project.id)) {
      await ctx.brainManager.startWatcher(project.path);
    }
  }
}
```

**Avantages:**
- UX streamlinée - pas besoin de lancer manuellement les watchers
- Résilience - reconnexion auto si brainManager déconnecté
- Lazy init - init seulement quand on utilise vraiment les tools

---

---

## 7. `brain_search` text search - Ajouter hint dans description

**Problème:** La description de brain_search ne précise pas que pour des recherches textuelles exactes, il vaut mieux utiliser `grep_files` ou `search_files` (fuzzy).

**Solution:** Ajouter dans la description:
> "For exact text/filename searches, prefer grep_files or search_files (fuzzy) instead of brain_search with semantic=false"

---

## 8. ~~Fix types filter non pris en compte après rebuild~~ RESOLU

**Cause:** Il fallait rebuild AUSSI le CLI (`packages/cli`) car il importe `@luciformresearch/ragforge` depuis `file:../core`. Rebuild core seul ne suffit pas.

**Solution:** `npm run build` dans les deux packages (core puis cli).

---

## Prochaines étapes

1. [x] Fix `install_package` - ajouter param `path` (FAIT dans le code)
2. [x] Fix filtre `types` dans brain_search (FAIT dans le code)
3. [x] Mettre à jour description `types` avec hint lowercase (FAIT)
4. [ ] Vérifier pourquoi le fix types n'est pas pris en compte après restart
5. [ ] Vérifier le nodeCount dans list_brain_projects
6. [ ] Investiguer watcher qui s'arrête
7. [ ] Investiguer edit_file qui ne trigger pas d'ingestion
