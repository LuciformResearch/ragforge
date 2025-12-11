# Roadmap : Extracteur de Hiérarchie de Dépendances depuis Grep

## Vue d'ensemble

Cette roadmap couvre l'implémentation d'un outil qui extrait la hiérarchie de dépendances (CONSUMES/CONSUMED_BY) depuis les résultats de grep, permettant de comprendre le contexte et les impacts d'un changement.

## Objectifs

- **Compréhension du contexte** : Comprendre quelles fonctions/classes dépendent d'un scope trouvé
- **Analyse d'impact** : Voir quels scopes seraient affectés par une modification
- **Enrichissement automatique** : Enrichir les résultats de recherche avec leur contexte de dépendances

---

## Feature : Extracteur de Hiérarchie de Dépendances

### ✅ État Actuel

**Infrastructure disponible** :
- Relations `CONSUMES` et `CONSUMED_BY` stockées dans Neo4j
- Méthodes `whereConsumesScope()` et `whereConsumedByScope()` dans QueryBuilder
- Traversals récursifs possibles avec Cypher (`[:CONSUMES*1..depth]`)

**Problème** :
- Les résultats de grep ne contiennent que `file` et `line`
- Pas d'extraction automatique de la hiérarchie de dépendances
- L'agent doit faire des recherches supplémentaires pour comprendre le contexte

### Description

Créer un outil `extract_dependency_hierarchy` qui :
1. Prend des résultats de grep (file + line)
2. Trouve le scope correspondant dans Neo4j (comme dans `enrichSearchResultWithScope`)
3. Construit la hiérarchie de dépendances (CONSUMES et CONSUMED_BY)
4. Retourne un graphe structuré avec les dépendances

### Implémentation

#### Étape 1 : Créer l'outil dans brain-tools.ts

```typescript
// Dans packages/core/src/tools/brain-tools.ts

export function generateExtractDependencyHierarchyTool(): GeneratedToolDefinition {
  return {
    name: 'extract_dependency_hierarchy',
    section: 'brain_ops',
    description: `Extract dependency hierarchy (CONSUMES/CONSUMED_BY) from grep results.

Takes grep results (file + line) and builds a dependency graph showing:
- What the scope consumes (dependencies)
- What consumes the scope (consumers)
- Recursive traversal up to specified depth

Parameters:
- file: File path (relative to project root)
- line: Line number in the file
- depth: Maximum depth for recursive traversal (default: 2)
- direction: 'both' (default), 'consumes' (dependencies), or 'consumed_by' (consumers)
- max_nodes: Maximum number of nodes to return (default: 50)

Returns a structured dependency graph with:
- root: The scope found at file:line
- dependencies: Scopes that root consumes (recursive)
- consumers: Scopes that consume root (recursive)
- graph: Full graph structure for visualization

Example: extract_dependency_hierarchy({ file: "src/auth.ts", line: 42, depth: 2 })`,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File path (relative to project root)',
        },
        line: {
          type: 'number',
          description: 'Line number in the file',
        },
        depth: {
          type: 'number',
          description: 'Maximum depth for recursive traversal (default: 2)',
          default: 2,
        },
        direction: {
          type: 'string',
          enum: ['both', 'consumes', 'consumed_by', 'inherits'],
          description: 'Direction of traversal: both (default), consumes (dependencies), consumed_by (consumers), or inherits (inheritance hierarchy)',
          default: 'both',
        },
        include_inheritance: {
          type: 'boolean',
          description: 'Include INHERITS_FROM relationships in addition to CONSUMES (default: false)',
          default: false,
        },
        max_nodes: {
          type: 'number',
          description: 'Maximum number of nodes to return (default: 50)',
          default: 50,
        },
      },
      required: ['file', 'line'],
    },
  };
}
```

#### Étape 2 : Implémenter le handler

```typescript
export function generateExtractDependencyHierarchyHandler(ctx: BrainToolsContext) {
  return async (params: {
    file: string;
    line: number;
    depth?: number;
    direction?: 'both' | 'consumes' | 'consumed_by';
    max_nodes?: number;
  }) => {
    const { file, line, depth = 2, direction = 'both', max_nodes = 50 } = params;

    try {
      // 1. Trouver le scope correspondant à file:line
      const scopeResult = await ctx.neo4j.run(
        `MATCH (s:Scope)
         WHERE s.file = $file
           AND s.startLine IS NOT NULL
           AND s.endLine IS NOT NULL
           AND s.startLine <= $line
           AND s.endLine >= $line
           AND NOT s:MarkdownSection
           AND NOT s:WebPage
           AND NOT s:DocumentFile
         RETURN s.uuid AS uuid, s.name AS name, s.type AS type, 
                s.startLine AS startLine, s.endLine AS endLine,
                s.file AS file, s.source AS source
         ORDER BY (s.endLine - s.startLine) ASC
         LIMIT 1`,
        { file, line: neo4j.int(line) }
      );

      if (scopeResult.records.length === 0) {
        return {
          error: `No scope found at ${file}:${line}`,
          root: null,
          dependencies: [],
          consumers: [],
          graph: { nodes: [], edges: [] }
        };
      }

      const rootRecord = scopeResult.records[0];
      const rootUuid = rootRecord.get('uuid') as string;
      const rootName = rootRecord.get('name') as string;
      const rootType = rootRecord.get('type') as string;

      // 2. Construire la requête Cypher pour extraire la hiérarchie
      // ⚠️ Gestion des cycles : utiliser DISTINCT et limiter la profondeur
      let cypher = '';
      const params: Record<string, any> = { rootUuid, depth: neo4j.int(depth), maxNodes: neo4j.int(max_nodes) };

      if (direction === 'both' || direction === 'consumes') {
        // Dependencies: ce que le scope consomme (récursif)
        // ⚠️ Utiliser DISTINCT pour éviter les cycles, et limiter avec LIMIT
        cypher += `
        // Dependencies (what root consumes)
        MATCH path = (root:Scope {uuid: $rootUuid})-[:CONSUMES*1..${depth}]->(dep:Scope)
        WHERE NOT dep.uuid = $rootUuid  // Éviter les auto-références
        WITH root, dep, length(path) AS depth_level
        ORDER BY depth_level, dep.name
        LIMIT $maxNodes
        RETURN DISTINCT dep.uuid AS uuid, dep.name AS name, dep.type AS type,
               dep.file AS file, dep.startLine AS startLine, dep.endLine AS endLine,
               depth_level AS depth
        `;
      }

      if (direction === 'both') {
        cypher += '\nUNION\n';
      }

      if (direction === 'both' || direction === 'consumed_by') {
        // Consumers: ce qui consomme le scope (récursif)
        cypher += `
        // Consumers (what consumes root)
        MATCH path = (consumer:Scope)-[:CONSUMES*1..${depth}]->(root:Scope {uuid: $rootUuid})
        WHERE NOT consumer.uuid = $rootUuid  // Éviter les auto-références
        WITH root, consumer, length(path) AS depth_level
        ORDER BY depth_level, consumer.name
        LIMIT $maxNodes
        RETURN DISTINCT consumer.uuid AS uuid, consumer.name AS name, consumer.type AS type,
               consumer.file AS file, consumer.startLine AS startLine, consumer.endLine AS endLine,
               depth_level AS depth
        `;
      }

      // Si include_inheritance est activé, ajouter les relations INHERITS_FROM
      if (include_inheritance) {
        if (cypher.length > 0) {
          cypher += '\nUNION\n';
        }
        cypher += `
        // Inheritance hierarchy (children)
        MATCH path = (root:Scope {uuid: $rootUuid})-[:INHERITS_FROM*1..${depth}]->(parent:Scope)
        WITH root, parent, length(path) AS depth_level
        ORDER BY depth_level, parent.name
        LIMIT $maxNodes
        RETURN DISTINCT parent.uuid AS uuid, parent.name AS name, parent.type AS type,
               parent.file AS file, parent.startLine AS startLine, parent.endLine AS endLine,
               depth_level AS depth, 'INHERITS_FROM' AS relationType
        
        UNION
        
        // Inheritance hierarchy (descendants)
        MATCH path = (child:Scope)-[:INHERITS_FROM*1..${depth}]->(root:Scope {uuid: $rootUuid})
        WITH root, child, length(path) AS depth_level
        ORDER BY depth_level, child.name
        LIMIT $maxNodes
        RETURN DISTINCT child.uuid AS uuid, child.name AS name, child.type AS type,
               child.file AS file, child.startLine AS startLine, child.endLine AS endLine,
               depth_level AS depth, 'INHERITED_BY' AS relationType
        `;
      }

      const hierarchyResult = await ctx.neo4j.run(cypher, params);

      // 3. Construire le graphe structuré
      const dependencies: Array<{
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
        depth: number;
      }> = [];

      const consumers: Array<{
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
        depth: number;
      }> = [];

      const nodes = new Map<string, {
        uuid: string;
        name: string;
        type: string;
        file: string;
        startLine: number;
        endLine: number;
      }>();

      const edges: Array<{
        from: string;
        to: string;
        type: 'CONSUMES' | 'CONSUMED_BY';
        depth: number;
      }> = [];

      // Ajouter le root
      nodes.set(rootUuid, {
        uuid: rootUuid,
        name: rootName,
        type: rootType,
        file,
        startLine: rootRecord.get('startLine') as number,
        endLine: rootRecord.get('endLine') as number,
      });

      let isDependencies = true;
      for (const record of hierarchyResult.records) {
        const uuid = record.get('uuid') as string;
        const name = record.get('name') as string;
        const type = record.get('type') as string;
        const file = record.get('file') as string;
        const startLine = toNumber(record.get('startLine'));
        const endLine = toNumber(record.get('endLine'));
        const depth = toNumber(record.get('depth'));

        // Détecter si on est dans la section dependencies ou consumers
        // (basé sur l'ordre des résultats UNION)
        if (uuid === rootUuid) {
          isDependencies = false;
          continue;
        }

        nodes.set(uuid, { uuid, name, type, file, startLine, endLine });

        if (isDependencies) {
          dependencies.push({ uuid, name, type, file, startLine, endLine, depth });
          edges.push({ from: rootUuid, to: uuid, type: 'CONSUMES', depth });
        } else {
          consumers.push({ uuid, name, type, file, startLine, endLine, depth });
          edges.push({ from: uuid, to: rootUuid, type: 'CONSUMED_BY', depth });
        }
      }

      // 4. Construire les relations entre dépendances (si depth > 1)
      if (depth > 1 && dependencies.length > 0) {
        const depUuids = dependencies.map(d => d.uuid);
        const relationsResult = await ctx.neo4j.run(
          `MATCH (from:Scope)-[:CONSUMES]->(to:Scope)
           WHERE from.uuid IN $depUuids AND to.uuid IN $depUuids
           RETURN from.uuid AS from, to.uuid AS to`,
          { depUuids }
        );

        for (const record of relationsResult.records) {
          const from = record.get('from') as string;
          const to = record.get('to') as string;
          edges.push({ from, to, type: 'CONSUMES', depth: 0 });
        }
      }

      return {
        root: {
          uuid: rootUuid,
          name: rootName,
          type: rootType,
          file,
          startLine: rootRecord.get('startLine') as number,
          endLine: rootRecord.get('endLine') as number,
        },
        dependencies: dependencies.sort((a, b) => a.depth - b.depth),
        consumers: consumers.sort((a, b) => a.depth - b.depth),
        graph: {
          nodes: Array.from(nodes.values()),
          edges,
        },
        stats: {
          total_nodes: nodes.size,
          dependencies_count: dependencies.length,
          consumers_count: consumers.length,
          max_depth_reached: Math.max(
            ...dependencies.map(d => d.depth),
            ...consumers.map(c => c.depth),
            0
          ),
        },
      };
    } catch (error: any) {
      return {
        error: error.message,
        root: null,
        dependencies: [],
        consumers: [],
        graph: { nodes: [], edges: [] },
      };
    }
  };
}
```

#### Étape 3 : Intégrer dans l'agent de contexte initial

```typescript
// Dans searchCodeWithContextInitialAgent(), après enrichissement des résultats
// Si un scope a été trouvé, extraire sa hiérarchie de dépendances

if (enriched.scopeId && !enriched.scopeId.startsWith('file-')) {
  // Scope trouvé dans Neo4j → extraire la hiérarchie
  const hierarchy = await this.extractDependencyHierarchy(
    enriched.file,
    enriched.startLine,
    options.projectRoot,
    { depth: 1, direction: 'both', max_nodes: 20 }
  );

  if (hierarchy && !hierarchy.error) {
    // Ajouter les dépendances au contexte
    enriched.dependencies = hierarchy.dependencies;
    enriched.consumers = hierarchy.consumers;
  }
}
```

#### Étape 4 : Créer helper dans storage.ts

```typescript
/**
 * Extrait la hiérarchie de dépendances depuis un scope trouvé
 */
private async extractDependencyHierarchy(
  file: string,
  line: number,
  projectRoot: string,
  options: {
    depth?: number;
    direction?: 'both' | 'consumes' | 'consumed_by';
    max_nodes?: number;
  } = {}
): Promise<{
  root: any;
  dependencies: any[];
  consumers: any[];
  graph: { nodes: any[]; edges: any[] };
  error?: string;
} | null> {
  if (!this.brainManager) {
    return null;
  }

  try {
    // Utiliser le brain manager pour accéder à Neo4j
    const neo4j = this.brainManager.getNeo4jClient();
    if (!neo4j) {
      return null;
    }

    // Appeler la même logique que le handler
    // (réutiliser le code du handler ou créer une fonction partagée)
    return await this.buildDependencyHierarchy(neo4j, file, line, options);
  } catch (error: any) {
    console.debug(`[ConversationStorage] Error extracting dependency hierarchy: ${error.message}`);
    return null;
  }
}
```

### Utilisation dans l'Agent de Contexte Initial

**Intégration automatique** :
- Après enrichissement avec scope Neo4j
- Si scope trouvé → extraire automatiquement la hiérarchie (depth=1)
- Ajouter dépendances/consumers au contexte

**Utilisation manuelle** :
- L'agent peut appeler `extract_dependency_hierarchy` explicitement
- Utile pour comprendre l'impact d'un changement
- Utile pour explorer le code autour d'une fonction trouvée

### Exemple d'Utilisation

**Résultat de grep** :
```json
{
  "file": "src/auth.ts",
  "line": 42,
  "content": "function authenticateUser(token: string) {"
}
```

**Appel de l'outil** :
```typescript
extract_dependency_hierarchy({
  file: "src/auth.ts",
  line: 42,
  depth: 2,
  direction: "both"
})
```

**Résultat** :
```json
{
  "root": {
    "uuid": "scope:auth.ts:authenticateUser",
    "name": "authenticateUser",
    "type": "function",
    "file": "src/auth.ts",
    "startLine": 42,
    "endLine": 58
  },
  "dependencies": [
    {
      "uuid": "scope:utils.ts:validateToken",
      "name": "validateToken",
      "type": "function",
      "file": "src/utils.ts",
      "startLine": 10,
      "endLine": 25,
      "depth": 1
    },
    {
      "uuid": "scope:db.ts:getUser",
      "name": "getUser",
      "type": "function",
      "file": "src/db.ts",
      "startLine": 5,
      "endLine": 15,
      "depth": 1
    }
  ],
  "consumers": [
    {
      "uuid": "scope:routes.ts:loginHandler",
      "name": "loginHandler",
      "type": "function",
      "file": "src/routes.ts",
      "startLine": 20,
      "endLine": 35,
      "depth": 1
    }
  ],
  "graph": {
    "nodes": [/* ... */],
    "edges": [/* ... */]
  },
  "stats": {
    "total_nodes": 4,
    "dependencies_count": 2,
    "consumers_count": 1,
    "max_depth_reached": 1
  }
}
```

### Fichiers à modifier

- `packages/core/src/tools/brain-tools.ts` :
  - Ajouter `generateExtractDependencyHierarchyTool()`
  - Ajouter `generateExtractDependencyHierarchyHandler()`
  - Exposer dans `generateBrainTools()` et `generateBrainToolHandlers()`

- `packages/core/src/runtime/conversation/storage.ts` :
  - Ajouter `extractDependencyHierarchy()` helper
  - Intégrer dans `enrichSearchResultWithScope()` pour enrichissement automatique
  - Optionnel : Ajouter dans `enrichSearchResultsBatch()` pour batch processing

### Tests

- Test avec scope trouvé → hiérarchie extraite
- Test avec scope non trouvé → erreur claire
- Test avec depth=1 → seulement dépendances directes
- Test avec depth=2 → dépendances récursives
- Test avec direction='consumes' → seulement dépendances
- Test avec direction='consumed_by' → seulement consumers
- Test avec max_nodes → limite respectée
- Test avec gros graphe → performance acceptable

### Optimisations

1. **Cache des hiérarchies** : Mettre en cache les hiérarchies pour scopes fréquents
2. **Batch extraction** : Extraire plusieurs hiérarchies en une requête Neo4j
3. **Limite intelligente** : Arrêter le traversal si trop de nodes
4. **Filtrage par projet** : Filtrer les dépendances selon le projet actuel

### Avantages

- **Meilleur contexte** : Comprendre les dépendances d'un scope trouvé
- **Analyse d'impact** : Voir quels scopes seraient affectés
- **Exploration** : Explorer le code autour d'une fonction
- **Enrichissement automatique** : Ajouté automatiquement au contexte

---

## Métriques de Succès

- **Contexte enrichi** : +50% de contexte utile avec dépendances
- **Compréhension** : Meilleure compréhension des impacts
- **Performance** : Extraction <500ms pour depth=2

---

## Notes

Cet outil transforme les résultats de grep en graphes de dépendances complets, permettant à l'agent de mieux comprendre le contexte et les impacts d'un changement.

**Pattern réutilisé** :
- Utilise les relations CONSUMES déjà stockées dans Neo4j
- Réutilise la logique de `enrichSearchResultWithScope()` pour trouver le scope
- Utilise les traversals Cypher récursifs (`[:CONSUMES*1..depth]`)

**Complexité** : Faible à moyenne (2-3h)
- Infrastructure déjà en place (CONSUMES, Neo4j)
- Juste besoin de construire la requête Cypher et parser les résultats

**Découvertes de l'analyse Cypher** (voir `CYPHER_ANALYSIS_GEMINI_CLI_OPENCODE.md`) :
- ⚠️ **Gestion des cycles** : Gemini CLI a des cycles de dépendances (buildSettingSchema, etc.) → doit être géré
- ✅ **Support INHERITS_FROM** : Les hiérarchies d'héritage sont importantes (BaseToolInvocation → 24 enfants)
- ✅ **Depth ajustable** : OpenCode a des chaînes plus profondes (depth 4-5) → paramètre `depth` doit être ajustable
- ✅ **Priorisation** : Les hubs (scopes très consommés) devraient être enrichis en priorité
- ✅ **Optimisation** : Les scopes isolés n'ont pas besoin d'enrichissement
