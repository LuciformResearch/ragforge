# Neo4j Compatibility Issues

Ce document liste les problèmes de compatibilité identifiés avec certaines versions de Neo4j.

## 1. Vector Indexes - Syntaxe non supportée

**Problème**: La création d'index vectoriels échoue avec l'erreur :
```
Invalid input 'VECTOR': expected "(", "ALL", "ANY" or "SHORTEST"
```

**Commande qui échoue**:
```cypher
CREATE VECTOR INDEX scope_source_embeddings IF NOT EXISTS
FOR (n:Scope) ON (n.embedding_source)
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}}
```

**Cause**: La syntaxe `CREATE VECTOR INDEX` n'est pas supportée par toutes les versions de Neo4j. Les index vectoriels nécessitent Neo4j 5.11+ avec le plugin approprié.

**Impact**:
- Les scripts `embeddings:index` et `embeddings:generate` échouent
- Les queries avec `.semanticSearch()` ne fonctionnent pas
- Les exemples utilisant la recherche sémantique échouent

**Solution temporaire**:
- Utiliser uniquement les queries basées sur les propriétés (`.where()`, `.whereName()`, etc.)
- Désactiver les embeddings dans la config

**TODO**:
- [ ] Détecter la version Neo4j avant de créer les index vectoriels
- [ ] Fournir une syntaxe alternative pour les versions anciennes
- [ ] Documenter les prérequis de version Neo4j dans le README

---

## 2. Expand Operation - Erreur de syntaxe Cypher

**Problème**: L'opération `.expand()` génère une requête Cypher invalide :
```
Juxtaposition is currently only supported for quantified path patterns.
MATCH (n)(related:`Scope`)
```

**Code qui échoue**:
```typescript
await rag.scope()
  .whereName('CodeSourceAdapter')
  .expand('INHERITS_FROM', { targetLabel: 'Scope', direction: 'out', depth: 1 })
  .execute();
```

**Cause**: Le QueryBuilder génère une syntaxe Cypher incorrecte pour Neo4j 5.x. La juxtaposition de nodes `(n)(related:Scope)` n'est pas valide.

**Syntaxe générée (invalide)**:
```cypher
MATCH (n)(related:`Scope`)
WHERE ...
```

**Syntaxe correcte attendue**:
```cypher
MATCH (n)-[:INHERITS_FROM]->(related:Scope)
WHERE ...
```

**Impact**:
- Les queries avec `.expand()` échouent systématiquement
- Les exemples de navigation de graphe ne fonctionnent pas
- Impossible d'utiliser les relationships pour enrichir les résultats

**Fichier concerné**: `packages/runtime/src/query/query-builder.ts` (méthode `executeExpand()`)

**TODO**:
- [ ] Corriger la génération de Cypher dans `executeExpand()`
- [ ] Ajouter des tests pour vérifier la syntaxe générée
- [ ] Tester avec différentes versions de Neo4j

---

## 3. Propriétés manquantes dans les résultats de query

**Problème**: Les résultats des queries ne contiennent pas les propriétés des entités (tous les champs sont `undefined`).

**Code qui échoue**:
```typescript
const results = await rag.scope()
  .whereName('CodeSourceAdapter')
  .execute();

console.log(results[0].name);  // undefined
console.log(results[0].type);  // undefined
console.log(results[0].extends); // undefined
```

**Observation**: La query Cypher s'exécute sans erreur mais les propriétés ne sont pas mappées correctement dans les résultats.

**Cause probable**:
- Le mapping des résultats Neo4j vers les objets TypeScript ne fonctionne pas
- Les propriétés ne sont pas extraites du `Record` Neo4j
- Problème dans `QueryBuilder.execute()` ou `QueryBuilder.executePipeline()`

**Impact**:
- Les queries retournent des objets vides
- Impossible d'accéder aux données via le client généré
- Les exemples affichent `undefined` partout

**Fichier concerné**: `packages/runtime/src/query/query-builder.ts` (méthode `execute()` ou `mapResults()`)

**TODO**:
- [ ] Debugger le mapping des résultats Neo4j
- [ ] Vérifier que les propriétés sont bien dans le `RETURN` Cypher
- [ ] Ajouter des logs pour voir la structure exacte des résultats Neo4j

---

## 4. Version Neo4j testée

**Version utilisée pour les tests**:
```
Neo4j 5.x (exact version TBD)
Driver: neo4j-driver@5.x
```

**Recommandations**:
- Documenter les versions Neo4j supportées
- Ajouter des tests de compatibilité pour différentes versions
- Créer une matrice de compatibilité (Neo4j 4.x, 5.x, AuraDB, etc.)

---

## Prochaines étapes

1. **Priorité haute**: Corriger le mapping des propriétés (problème #3)
   - Sans cela, le client généré est inutilisable

2. **Priorité moyenne**: Corriger `.expand()` (problème #2)
   - Nécessaire pour la navigation de graphe

3. **Priorité basse**: Support des vector indexes (problème #1)
   - Peut être contourné en désactivant les embeddings
   - Nécessite de documenter les prérequis de version

---

## Workaround actuel

Pour utiliser RagForge avec Phase 3 en attendant les fixes :

```typescript
// 1. Utiliser directement le client Neo4j pour les queries custom
const client = new Neo4jClient({ /* config */ });
const result = await client.run(`
  MATCH (s:Scope)
  WHERE s.name = 'CodeSourceAdapter'
  RETURN s.name AS name, s.extends AS extends, s.heritageClauses AS heritageClauses
`);

// Accéder aux propriétés via record.get()
const name = result.records[0].get('name');
const extends = result.records[0].get('extends');

// 2. Ne pas utiliser les embeddings pour l'instant
// Commenter les scripts embeddings:* dans package.json

// 3. Éviter .expand() - utiliser des queries Cypher custom pour la navigation
```
