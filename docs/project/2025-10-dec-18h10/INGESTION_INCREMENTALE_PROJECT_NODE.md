# Problème : Nœuds Project manquants dans l'ingestion incrémentale

**Date**: 2025-12-11  
**Problème identifié**: Les projets `ragforge-docs-jc45` et `docs-project-d9nj` ont des nœuds mais pas de nœud `Project` correspondant dans Neo4j.

---

## Problème identifié

### Symptômes
- 7723 nœuds avec `projectId = 'ragforge-docs-jc45'` mais **aucun nœud Project** avec ce `projectId`
- 1499 nœuds avec `projectId = 'docs-project-d9nj'` mais **aucun nœud Project** avec ce `projectId`

### Cause racine

Dans `code-source-adapter.ts`, le nœud Project est créé avec :
```typescript
const projectId = `project:${projectInfo.name}`;  // ex: "project:ragforge-docs"
nodes.push({
  labels: ['Project'],
  id: projectId,
  properties: {
    uuid: projectId,  // "project:ragforge-docs"
    name: projectInfo.name,
    rootPath: projectInfo.rootPath,
    // ⚠️ PAS de projectId défini ici !
  }
});
```

Ensuite, dans `incremental-ingestion.ts`, le `projectId` généré par `ProjectRegistry.generateId()` est ajouté à **tous** les nœuds :
```typescript
// Add projectId to all nodes if specified
if (projectId) {  // ex: "ragforge-docs-jc45"
  for (const node of nodes) {
    node.properties.projectId = projectId;  // ✅ Ajouté au nœud Project aussi
  }
}
```

**MAIS** : Le nœud Project est créé avec `MERGE (n:Project {uuid: projectId})` où `projectId` est `"project:ragforge-docs"`, donc il cherche un nœud avec `uuid = "project:ragforge-docs"`, pas `uuid = "ragforge-docs-jc45"`.

### Le problème

Le nœud Project est créé avec :
- `uuid = "project:ragforge-docs"` (depuis `code-source-adapter.ts`)
- `projectId = "ragforge-docs-jc45"` (ajouté dans `incremental-ingestion.ts`)

Mais lors de la recherche dans `brain-manager.ts`, on cherche :
```cypher
MATCH (p:Project {projectId: $projectId})
```

Donc on cherche un nœud Project avec `projectId = "ragforge-docs-jc45"`, mais le nœud Project a `uuid = "project:ragforge-docs"` et `projectId = "ragforge-docs-jc45"`.

**Le problème est que le MERGE utilise `uuid` comme clé unique, pas `projectId` !**

---

## Solution

### Option 1 : Utiliser `projectId` comme clé unique pour Project

Modifier `code-source-adapter.ts` pour créer le nœud Project avec le `projectId` généré :

```typescript
// Dans buildGraph, recevoir le projectId généré en paramètre
private async buildGraph(
  parsedFiles: {...},
  config: CodeSourceConfig,
  resolver: ImportResolver,
  projectInfo: { name: string; gitRemote: string | null; rootPath: string },
  generatedProjectId: string  // ✅ NOUVEAU paramètre
): Promise<ParsedGraph> {
  // ...
  
  // Create Project node avec le projectId généré
  nodes.push({
    labels: ['Project'],
    id: generatedProjectId,  // ✅ Utiliser le projectId généré
    properties: {
      uuid: generatedProjectId,  // ✅ Utiliser le projectId généré
      projectId: generatedProjectId,  // ✅ Définir projectId explicitement
      name: projectInfo.name,
      gitRemote: projectInfo.gitRemote || null,
      rootPath: projectInfo.rootPath,
      indexedAt: getLocalTimestamp()
    }
  });
}
```

### Option 2 : Mettre à jour le nœud Project existant après ingestion

Dans `incremental-ingestion.ts`, après avoir ajouté `projectId` à tous les nœuds, mettre à jour le nœud Project :

```typescript
// Après avoir ajouté projectId à tous les nœuds
if (projectId) {
  // Mettre à jour le nœud Project pour qu'il ait le bon projectId
  await this.client.run(
    `MATCH (p:Project)
     WHERE p.uuid STARTS WITH 'project:' AND p.projectId IS NULL
     SET p.projectId = $projectId
     RETURN p.uuid, p.projectId`,
    { projectId }
  );
}
```

### Option 3 : Utiliser MERGE avec projectId pour Project

Modifier `ingestNodes` pour utiliser `projectId` comme clé unique pour Project :

```typescript
// Dans ingestNodes, pour les nœuds Project
if (labelsArray.includes('Project')) {
  const uniqueField = 'projectId';  // ✅ Utiliser projectId au lieu de uuid
  const uniqueValue = 'nodeData.props.projectId';
  // ...
}
```

---

## Migration des données existantes

Pour corriger les projets existants (`ragforge-docs-jc45`, `docs-project-d9nj`), créer les nœuds Project manquants :

```cypher
// Créer le nœud Project pour ragforge-docs-jc45
MERGE (p:Project {projectId: 'ragforge-docs-jc45'})
SET p.uuid = 'ragforge-docs-jc45',
    p.name = 'ragforge-docs',
    p.rootPath = '/home/luciedefraiteur/LR_CodeRag/ragforge/docs',
    p.type = 'quick-ingest',
    p.lastAccessed = datetime()
RETURN p;

// Créer le nœud Project pour docs-project-d9nj
MERGE (p:Project {projectId: 'docs-project-d9nj'})
SET p.uuid = 'docs-project-d9nj',
    p.name = 'docs-project',
    p.rootPath = '/home/luciedefraiteur/LR_CodeRag/ragforge/docs/project',
    p.type = 'quick-ingest',
    p.lastAccessed = datetime()
RETURN p;
```

---

## Recommandation

**Option 1** est la meilleure solution car elle garantit la cohérence dès la création. Le nœud Project doit être créé avec le `projectId` généré par `ProjectRegistry.generateId()`, pas avec `project:${name}`.

**Action immédiate** : Appliquer la migration Cypher pour créer les nœuds Project manquants, puis corriger le code pour éviter ce problème à l'avenir.
