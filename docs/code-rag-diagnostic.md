# Diagnostic Code RAG Integration - État Actuel

**Date**: 2025-11-07
**Status**: Phase 1.1 et 1.2 complètes, non testées
**Branch**: `rag-doll`

---

## 📋 État de l'implémentation

### ✅ Complété

#### 1. Architecture des Adapters (`packages/runtime/src/adapters/`)

**Fichiers créés**:
- `types.ts` - Types et interfaces pour le système d'adapters
- `code-source-adapter.ts` - Implémentation adapter TypeScript/Python
- `index.ts` - Exports publics

**Fonctionnalités**:
- ✅ Interface `SourceAdapter` abstraite
- ✅ `CodeSourceAdapter` avec support TypeScript/Python
- ✅ Utilisation de `@luciformresearch/codeparsers`
- ✅ Validation de configuration
- ✅ Progress reporting
- ✅ Génération de graphe Neo4j (nodes + relationships)

#### 2. Intégration CLI (`packages/cli/src/commands/init.ts`)

**Modifications (+146 lignes)**:
- ✅ `checkForSourceConfig()` - Détecte section `source` dans YAML
- ✅ `parseAndIngestSource()` - Parse code → Neo4j
- ✅ Appel automatique dans `runInit()` avant introspection

**Flow actuel**:
```
ragforge init
  ↓
checkForSourceConfig()
  ↓ (si source présente)
parseAndIngestSource()
  ├── CodeSourceAdapter.parse()
  │   ├── découvrir fichiers (globby)
  │   ├── parser avec codeparsers
  │   └── construire graphe
  ↓
ingest dans Neo4j
  ├── clear existing data
  ├── create nodes (loop)
  └── create relationships (loop)
  ↓
introspection Neo4j (flow normal)
```

#### 3. Dépendances

**Ajoutées à `packages/runtime/package.json`**:
- `@luciformresearch/codeparsers: ^0.1.2`
- `globby: ^14.0.0`
- `fast-xml-parser: ^4.3.0`

---

## 🔴 Problèmes Critiques

### 1. Performance - Ingestion Séquentielle (init.ts:343-373)

**Problème**:
```typescript
// Ligne 343-353: Create nodes - une requête par nœud
for (const node of graph.nodes) {
  const labels = node.labels.join(':');
  const propsString = Object.entries(node.properties)
    .map(([key, value]) => `${key}: $${key}`)
    .join(', ');

  await client.run(
    `CREATE (n:${labels} {${propsString}})`,
    node.properties
  );
}
```

**Impact**:
- Pour 10,000 fichiers avec ~50,000 scopes:
  - **50,000 requêtes CREATE séquentielles**
  - Temps estimé: ~2-5 minutes (selon latence réseau)
  - Charge réseau inutile

**Solution recommandée**:
```typescript
// Batch avec UNWIND (500-1000 nœuds par batch)
const batchSize = 500;
for (let i = 0; i < graph.nodes.length; i += batchSize) {
  const batch = graph.nodes.slice(i, i + batchSize);

  await client.run(
    `UNWIND $nodes AS node
     CALL apoc.create.node(node.labels, node.properties) YIELD node AS n
     RETURN count(n)`,
    { nodes: batch }
  );
}
```

**Gain estimé**:
- De 50,000 requêtes → 100 requêtes (batch 500)
- Temps réduit de **~3 min → 10-15 secondes**

---

### 2. Requêtes de Relationships Inefficaces (init.ts:362-366)

**Problème**:
```typescript
await client.run(
  `MATCH (a), (b)
   WHERE a.uuid = $from OR a.path = $from OR id(a) = $from
   AND b.uuid = $to OR b.path = $to OR id(b) = $to
   CREATE (a)-[r:${rel.type} ${propsString}]->(b)`,
  { from: rel.from, to: rel.to, ... }
);
```

**Problèmes multiples**:

#### 2.1 Cartesian Product
- `MATCH (a), (b)` sans contrainte = **produit cartésien**
- Si 50,000 nœuds: 50k × 50k = **2.5 milliards de combinaisons**
- Neo4j va parcourir toutes les paires avant d'appliquer WHERE

#### 2.2 Pas d'index utilisé
- `OR` empêche l'utilisation d'index
- Même avec index sur `uuid`, le OR oblige un scan complet
- `OR a.path = $from` force un scan sur tous les nœuds

#### 2.3 Confusion des identifiants
- Mix de 3 types d'ID:
  - `uuid` (string généré par adapter)
  - `path` (string file path - seulement pour File nodes)
  - `id(a)` (internal Neo4j ID - instable)
- `$from` et `$to` sont toujours des UUID ou `file:${path}`
- Les `id(a)` ne sont jamais utilisés mais sont checkés

#### 2.4 Ambiguïté potentielle
- Si par hasard un `uuid` match un `path`, on crée deux relations
- Pas de validation que `a` et `b` sont uniques

**Solution recommandée**:
```typescript
// 1. Créer des index AVANT ingestion
await client.run('CREATE INDEX scope_uuid IF NOT EXISTS FOR (s:Scope) ON (s.uuid)');
await client.run('CREATE INDEX file_path IF NOT EXISTS FOR (f:File) ON (f.path)');

// 2. Utiliser des requêtes précises
for (const rel of graph.relationships) {
  const fromIsFile = rel.from.startsWith('file:');
  const toIsFile = rel.to.startsWith('file:');

  const fromMatch = fromIsFile
    ? 'MATCH (a:File {path: $fromId})'
    : 'MATCH (a:Scope {uuid: $fromId})';

  const toMatch = toIsFile
    ? 'MATCH (b:File {path: $toId})'
    : 'MATCH (b:Scope {uuid: $toId})';

  await client.run(
    `${fromMatch}
     ${toMatch}
     CREATE (a)-[r:${rel.type}]->(b)`,
    {
      fromId: fromIsFile ? rel.from.replace('file:', '') : rel.from,
      toId: toIsFile ? rel.to.replace('file:', '') : rel.to
    }
  );
}

// 3. Ou mieux: batch avec UNWIND
await client.run(
  `UNWIND $rels AS rel
   MATCH (a:Scope {uuid: rel.from})
   MATCH (b:Scope {uuid: rel.to})
   CREATE (a)-[r:\${rel.type}]->(b)`,
  { rels: graph.relationships.filter(r => !r.from.startsWith('file:')) }
);
```

**Gain estimé**:
- De ~1 min pour 10k relationships → **2-3 secondes**

---

### 3. Absence de Transactions et Gestion d'Erreurs

**Problème**:
```typescript
try {
  await client.verifyConnectivity();
  await client.run('MATCH (n) WHERE n:Scope OR n:File DETACH DELETE n');

  // Create nodes - peut échouer au milieu
  for (const node of graph.nodes) {
    await client.run(...); // ❌ Si échoue à node 5000/10000?
  }

  // Create relationships - peut échouer au milieu
  for (const rel of graph.relationships) {
    await client.run(...); // ❌ Si échoue à rel 500/1000?
  }

  console.log(`✅  Graph ingestion complete!`);
} finally {
  await client.close();
}
```

**Problèmes**:

#### 3.1 Pas de transaction atomique
- Si échec au nœud 5000/10000:
  - 5000 nœuds créés
  - 5000 nœuds manquants
  - Base dans un état incohérent
- **Pas de rollback**

#### 3.2 Clear data brutal
- Ligne 339: `DETACH DELETE` sans backup
- Si ingestion échoue après clear → **perte de données**

#### 3.3 Gestion d'erreurs limitée
- `try/finally` ne catch pas les erreurs individuelles
- Pas de retry logic
- Pas de logging détaillé des échecs

#### 3.4 Pas de validation pre-ingestion
- Ne vérifie pas que tous les UUIDs sont valides
- Ne détecte pas les références cassées
- Ne valide pas les propriétés

**Solution recommandée**:
```typescript
// 1. Backup optionnel avant clear
if (options.backup) {
  await client.run(`
    CALL apoc.export.cypher.all("backup-${Date.now()}.cypher", {})
  `);
}

// 2. Transaction avec retry
const maxRetries = 3;
for (let attempt = 0; attempt < maxRetries; attempt++) {
  const session = driver.session({
    database: neo4jDatabase,
    defaultAccessMode: neo4j.session.WRITE
  });

  try {
    await session.executeWrite(async (tx) => {
      // Clear (dans la transaction)
      await tx.run('MATCH (n:Scope) DETACH DELETE n');

      // Batch nodes
      for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        await tx.run(`UNWIND $batch AS node ...`, { batch });
      }

      // Batch relationships
      for (let i = 0; i < rels.length; i += batchSize) {
        const batch = rels.slice(i, i + batchSize);
        await tx.run(`UNWIND $batch AS rel ...`, { batch });
      }
    });

    // Success - sortir de la boucle retry
    break;

  } catch (error) {
    if (attempt === maxRetries - 1) {
      throw error; // Dernier essai, propager l'erreur
    }
    console.warn(`⚠️  Attempt ${attempt + 1} failed, retrying...`);
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  } finally {
    await session.close();
  }
}

// 3. Validation pre-ingestion
function validateGraph(graph: ParsedGraph): ValidationResult {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const errors: string[] = [];

  // Vérifier que toutes les relationships pointent vers des nœuds existants
  for (const rel of graph.relationships) {
    if (!nodeIds.has(rel.from) && !rel.from.startsWith('file:')) {
      errors.push(`Relationship ${rel.type} references unknown node: ${rel.from}`);
    }
    if (!nodeIds.has(rel.to) && !rel.to.startsWith('file:')) {
      errors.push(`Relationship ${rel.type} references unknown node: ${rel.to}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

### 4. Autres Problèmes

#### 4.1 Pas de Progress Tracking Détaillé
```typescript
console.log(`📝  Creating ${graph.nodes.length} nodes...`);
for (const node of graph.nodes) {
  await client.run(...); // ❌ Pas d'indication de progression
}
```

**Impact**: Pour 50k nœuds prenant 3 minutes, l'utilisateur ne sait pas si c'est bloqué ou en cours.

**Solution**:
```typescript
const progressInterval = Math.max(1, Math.floor(nodes.length / 20)); // Log tous les 5%
for (let i = 0; i < nodes.length; i++) {
  await client.run(...);
  if (i % progressInterval === 0) {
    const percent = Math.round((i / nodes.length) * 100);
    console.log(`  ${i}/${nodes.length} nodes (${percent}%)`);
  }
}
```

#### 4.2 Pas de Support Incrémental
- Ligne 337-339: Clear complet à chaque fois
- La roadmap mentionne l'incrémental (Q2) mais pas implémenté
- Pour un gros projet, re-parser tout le code à chaque changement = inefficace

#### 4.3 Pas de Création d'Index
- Les vector indexes pour embeddings ne sont pas créés
- Les indexes sur uuid/path ne sont pas créés
- L'utilisateur doit les créer manuellement après

---

## ⚠️ Problèmes dans CodeSourceAdapter

### 5. Détection de Relations CONSUMES Simpliste

**Code actuel** (code-source-adapter.ts:368-388):
```typescript
// CONSUMES relationships from imports/references
if (scope.identifierReferences && scope.identifierReferences.length > 0) {
  for (const ref of scope.identifierReferences) {
    // Try to find target scope by name
    const targetScope = this.findScopeByName(scopeMap, ref.identifier);
    if (targetScope) {
      const [targetUuid] = targetScope;
      relationships.push({
        type: 'CONSUMES',
        from: sourceUuid,
        to: targetUuid
      });

      // Also create inverse CONSUMED_BY
      relationships.push({
        type: 'CONSUMED_BY',
        from: targetUuid,
        to: sourceUuid
      });
    }
  }
}
```

**Problèmes**:

#### 5.1 Recherche par nom uniquement
- `findScopeByName()` cherche juste par `scope.name`
- Dans un gros projet, beaucoup de fonctions ont le même nom
- Exemple: 50 fonctions nommées `render()` dans différents composants
- Va créer des fausses relations

#### 5.2 Pas de résolution d'imports
- Ne vérifie pas d'où vient l'identifiant
- Ne suit pas les imports
- `ref.identifier` peut être:
  - Variable locale
  - Import externe
  - Global built-in
- Toutes sont traitées pareil

#### 5.3 Relations CONSUMED_BY redondantes
- Crée l'inverse de chaque relation
- Double la taille du graphe
- Pas nécessaire - Neo4j peut traverser dans les deux sens

**Solution**:
```typescript
// 1. Utiliser file + nom pour matching
private findScopeByReference(
  scopeMap: Map<string, ScopeInfo>,
  ref: IdentifierReference,
  currentFile: string,
  imports: ImportReference[]
): string | undefined {
  // 1. Check if it's a local reference in same file
  for (const [uuid, scope] of scopeMap) {
    if (scope.filePath === currentFile && scope.name === ref.identifier) {
      return uuid;
    }
  }

  // 2. Check imports
  const importRef = imports.find(imp =>
    imp.imported === ref.identifier || imp.alias === ref.identifier
  );

  if (importRef && importRef.isLocal) {
    // Resolve local import path
    const resolvedPath = resolvePath(currentFile, importRef.source);
    for (const [uuid, scope] of scopeMap) {
      if (scope.filePath === resolvedPath && scope.name === importRef.imported) {
        return uuid;
      }
    }
  }

  return undefined;
}

// 2. Ne créer que CONSUMES (pas CONSUMED_BY)
relationships.push({
  type: 'CONSUMES',
  from: sourceUuid,
  to: targetUuid
});
// Neo4j peut faire: MATCH (a)-[:CONSUMES]->(b) et MATCH (a)<-[:CONSUMES]-(b)
```

---

## 📊 Estimation d'Impact

### Scénario: Projet TypeScript moyen
- 1,000 fichiers
- ~5,000 scopes (fonctions, classes, méthodes)
- ~15,000 relationships (CONSUMES, DEFINED_IN)

### Temps d'ingestion actuel (estimé)
| Étape | Requêtes | Temps estimé |
|-------|----------|--------------|
| Clear data | 1 | ~1s |
| Create nodes | 5,000 | ~1-2 min |
| Create relationships | 15,000 | ~3-5 min |
| **TOTAL** | **20,001** | **~4-7 min** |

### Temps avec optimisations (estimé)
| Étape | Requêtes | Temps estimé |
|-------|----------|--------------|
| Clear data | 1 | ~1s |
| Create nodes (batch 500) | 10 | ~2-3s |
| Create relationships (batch 1000) | 15 | ~3-5s |
| **TOTAL** | **26** | **~10-15s** |

**Gain**: **25-40x plus rapide**

---

## 🎯 Priorités de Correction

### P0 - Bloquant
1. **Fixer les requêtes relationships** (problème #2)
   - Cartesian product = peut bloquer Neo4j sur gros projets
   - Urgence: CRITIQUE

2. **Ajouter transactions** (problème #3)
   - État incohérent en cas d'erreur
   - Urgence: HAUTE

### P1 - Performance
3. **Batch ingestion** (problème #1)
   - Actuel: 4-7 min pour projet moyen
   - Urgence: HAUTE

4. **Progress tracking** (problème #4.1)
   - UX: utilisateur ne sait pas si c'est bloqué
   - Urgence: MOYENNE

### P2 - Qualité des données
5. **Améliorer détection CONSUMES** (problème #5)
   - Fausses relations sur projets réels
   - Urgence: MOYENNE

6. **Validation pre-ingestion** (problème #3.3)
   - Détection précoce d'erreurs
   - Urgence: BASSE

### P3 - Features futures
7. **Support incrémental** (problème #4.2)
   - Roadmap Phase 2
   - Urgence: BASSE

---

## 🧪 Plan de Test

### Test 1: Petit projet
- 10 fichiers, ~50 scopes
- Vérifier que l'ingestion fonctionne
- Valider les relations DEFINED_IN

### Test 2: Projet moyen
- 100 fichiers, ~500 scopes
- Mesurer temps d'ingestion
- Vérifier les relations CONSUMES

### Test 3: Gros projet (stress test)
- 1,000+ fichiers, ~5,000 scopes
- Identifier les bottlenecks
- Vérifier la stabilité

### Test 4: Cas edge
- Fichiers avec erreurs de parsing
- Références circulaires
- Imports cassés

---

## 📝 Recommandations

### Court terme (avant merge)
1. **Fixer P0** - Relations query et transactions
2. **Tester sur petit projet** - Valider le flow basique
3. **Documenter limitations** - Warning utilisateur sur performance

### Moyen terme (après merge)
4. **Implémenter batching** - Améliorer performance
5. **Ajouter progress tracking** - Meilleure UX
6. **Tests sur projets réels** - Valider sur ragforge lui-même

### Long terme (Phase 2+)
7. **Support incrémental** - Hash-based updates
8. **Améliorer détection relations** - Import resolution
9. **Monitoring et metrics** - Tracking de performance

---

## 🔗 Fichiers Concernés

- `packages/cli/src/commands/init.ts` (lignes 320-379)
- `packages/runtime/src/adapters/code-source-adapter.ts` (lignes 291-402)
- `packages/runtime/src/client/neo4j-client.ts` (potentiellement)

---

## ✅ Next Steps

1. **Review ce diagnostic** avec l'équipe
2. **Décider priorités** (tout fixer vs MVP minimal?)
3. **Créer issues** pour chaque problème
4. **Implémenter fixes P0** (relations + transactions)
5. **Tester sur projet test** avant production
