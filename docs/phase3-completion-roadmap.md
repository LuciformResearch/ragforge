# Phase 3 Completion Roadmap

**Objectif**: Faire fonctionner tous les exemples générés avec les features Phase 3 (heritage clauses, generics, decorators, enums)

**État actuel**:
- ✅ Parser extrait correctement les métadonnées Phase 3
- ✅ CodeSourceAdapter mappe les données vers Neo4j
- ✅ Données correctement stockées en Neo4j (vérifié avec Cypher direct)
- ❌ Exemples générés ne fonctionnent pas
- ❌ QueryBuilder retourne des propriétés undefined
- ❌ Vector indexes échouent
- ❌ `.expand()` génère du Cypher invalide

---

## Problème 1: QueryBuilder retourne des résultats dans `.entity` au lieu de directement

**Priorité**: 🔴 CRITIQUE (bloque tous les exemples)

**Symptôme**:
```typescript
const results = await rag.scope().whereName('CodeSourceAdapter').execute();
console.log(results[0].name); // undefined ❌
console.log(results[0].extends); // undefined ❌
```

**Cause identifiée**: ✅
Le QueryBuilder retourne une structure `{ entity, score, scoreBreakdown, context }` mais les exemples générés accèdent directement aux propriétés.

**Structure réelle retournée**:
```javascript
results[0] = {
  entity: {
    name: 'CodeSourceAdapter',  // ✅ Les données sont ICI
    type: 'class',
    extends: 'SourceAdapter',
    heritageClauses: '[{"clause":"extends"...}]',
    ...
  },
  score: 1,
  scoreBreakdown: {},
  context: undefined
}
```

**Structure attendue par les exemples**:
```javascript
results[0] = {
  name: 'CodeSourceAdapter',  // ❌ Devrait être ici
  type: 'class',
  extends: 'SourceAdapter',
  ...
}
```

**Fichiers concernés**:
- `packages/runtime/src/query/query-builder.ts` (méthode `execute()`, `executePipeline()`)
- `packages/core/src/generator/code-generator.ts` (génération des exemples)

**Solutions possibles**:

**Option A** (recommandée): Aplatir les résultats quand il n'y a pas de score
```typescript
// Dans QueryBuilder.execute()
if (useSemanticSearch || useLLMRerank) {
  // Retourner { entity, score, scoreBreakdown, context }
  return results;
} else {
  // Retourner directement les entités
  return results.map(r => r.entity);
}
```

**Option B**: Modifier les exemples générés pour accéder à `.entity`
```typescript
// Dans code-generator.ts - exemples
const results = await rag.scope().whereName('CodeSourceAdapter').execute();
console.log(results[0].entity.name);  // Accès explicite à .entity
```

**Option C**: Mélanger les propriétés au top-level (backward compatible)
```typescript
// Retourner { ...entity, score, scoreBreakdown, context }
return results.map(r => ({ ...r.entity, score: r.score, ... }));
```

**Action requise**:
1. Choisir l'option A ou C (préférer A pour la cohérence)
2. Modifier `QueryBuilder.execute()` ou `executePipeline()`
3. Mettre à jour les types générés si nécessaire
4. Tester tous les exemples

**Tests de validation**:
```typescript
// Test simple qui doit passer
const results = await rag.scope().whereName('CodeSourceAdapter').execute();
assert(results[0].name === 'CodeSourceAdapter');  // ✅ Doit passer
assert(results[0].type === 'class');
assert(results[0].extends === 'SourceAdapter');  // ✅ Phase 3 data
```

---

## Problème 2: Vector indexes incompatibles

**Priorité**: 🟡 MOYENNE (bloque semantic search)

**Symptôme**:
```
Invalid input 'VECTOR': expected "(", "ALL", "ANY" or "SHORTEST"
```

**Contexte**:
- Version Neo4j: 5.14.0 (devrait supporter les vector indexes)
- Syntaxe utilisée: `CREATE VECTOR INDEX ... FOR (n:Label) ON (n.property)`

**Cause probable**:
- Mauvaise syntaxe pour Neo4j 5.14
- Besoin du plugin vector ou configuration manquante

**Fichier concerné**:
- `packages/core/templates/scripts/create-vector-indexes.ts`

**Action requise**:
1. Vérifier la documentation Neo4j 5.14 pour la syntaxe exacte des vector indexes
2. Tester différentes syntaxes:
   ```cypher
   // Option 1: Syntaxe Neo4j 5.13+
   CREATE VECTOR INDEX index_name FOR (n:Label) ON (n.property)
   OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}

   // Option 2: Syntaxe alternative
   CALL db.index.vector.createNodeIndex('index_name', 'Label', 'property', 768, 'cosine')
   ```
3. Vérifier si le plugin vector est activé dans Neo4j
4. Documenter les prérequis Neo4j

**Tests de validation**:
```bash
npm run embeddings:index  # Doit réussir
npm run embeddings:generate  # Doit générer des embeddings
npm run examples:01-semantic-search-source  # Doit fonctionner
```

---

## Problème 3: `.expand()` génère du Cypher invalide

**Priorité**: 🟠 HAUTE (bloque navigation de graphe)

**Symptôme**:
```
Juxtaposition is currently only supported for quantified path patterns.
MATCH (n)(related:`Scope`)
```

**Syntaxe générée (invalide)**:
```cypher
MATCH (n)(related:`Scope`)  // ❌ Invalide
```

**Syntaxe correcte**:
```cypher
MATCH (n)-[:INHERITS_FROM]->(related:Scope)  // ✅ Valide
```

**Fichier concerné**:
- `packages/runtime/src/query/query-builder.ts` (méthode `executeExpand()`)

**Action requise**:
1. Localiser la génération du MATCH dans `executeExpand()`
2. Corriger pour inclure le pattern de relationship: `(n)-[:REL_TYPE]->(related:Label)`
3. Gérer les directions: `out` = `->`, `in` = `<-`, `both` = `-`
4. Tester avec depth > 1

**Tests de validation**:
```typescript
// Test simple
const results = await rag.scope()
  .whereName('CodeSourceAdapter')
  .expand('INHERITS_FROM', { targetLabel: 'Scope', direction: 'out', depth: 1 })
  .execute();

assert(results[0].inheritsFromCount === 1);
```

---

## Problème 4: Types générés ne contiennent pas les propriétés Phase 3

**Priorité**: 🟢 BASSE (cosmétique, n'empêche pas l'usage)

**Symptôme**:
```typescript
// types.ts ne contient pas extends, implements, generics, etc.
export interface Scope {
  language?: string;
  type?: string;
  // ❌ Manque: extends, implements, heritageClauses, generics, genericParameters
}
```

**Fichier concerné**:
- `packages/core/src/generator/type-generator.ts`

**Action requise**:
1. Vérifier si le schema introspector détecte les propriétés Phase 3
2. S'assurer que le TypeGenerator inclut toutes les propriétés du schéma
3. Régénérer les types après fix

**Tests de validation**:
```typescript
// Les types générés doivent permettre l'autocomplétion
const scope: Scope = results[0];
scope.extends;  // ✅ Doit être typé comme string | undefined
scope.heritageClauses; // ✅ Doit être typé comme string | undefined
```

---

## Plan d'action par priorité

### Phase 1: Débloquer les exemples (URGENT)
**Durée estimée**: 2-4 heures

1. **Fix QueryBuilder mapping** (Problème #1)
   - Debugger `execute()` avec logs détaillés
   - Identifier où les propriétés sont perdues
   - Corriger le mapping
   - Tester avec tous les exemples

2. **Validation**:
   ```bash
   npm run examples:06-conditional-search  # Doit fonctionner
   npm run examples:09-mutations-crud  # Doit fonctionner
   ```

### Phase 2: Corriger la navigation de graphe
**Durée estimée**: 1-2 heures

3. **Fix `.expand()` Cypher generation** (Problème #3)
   - Corriger le pattern MATCH
   - Tester avec différentes directions et depths
   - Valider avec exemples utilisant expand

4. **Validation**:
   ```typescript
   // Créer un nouvel exemple test-expand.ts
   const results = await rag.scope()
     .whereName('CodeSourceAdapter')
     .expand('INHERITS_FROM', { direction: 'out' })
     .execute();
   ```

### Phase 3: Activer la recherche sémantique
**Durée estimée**: 2-3 heures

5. **Fix vector indexes** (Problème #2)
   - Rechercher la syntaxe correcte pour Neo4j 5.14
   - Tester la création d'index
   - Vérifier les prérequis (plugins, config)

6. **Validation**:
   ```bash
   npm run embeddings:index
   npm run embeddings:generate
   npm run examples:01-semantic-search-source
   ```

### Phase 4: Améliorer les types
**Durée estimée**: 1 heure

7. **Ajouter propriétés Phase 3 aux types générés** (Problème #4)
   - Modifier TypeGenerator
   - Régénérer et vérifier

---

## Checklist de validation finale

Une fois tous les problèmes corrigés, valider que :

### Exemples générés fonctionnent
- [ ] `examples/01-semantic-search-source.ts`
- [ ] `examples/02-semantic-search-signature.ts`
- [ ] `examples/03-semantic-search-name.ts`
- [ ] `examples/04-llm-reranking.ts`
- [ ] `examples/05-metadata-tracking.ts`
- [ ] `examples/06-conditional-search.ts`
- [ ] `examples/07-breadth-first.ts`
- [ ] `examples/08-stopping-criteria.ts`
- [ ] `examples/09-mutations-crud.ts`
- [ ] `examples/10-batch-mutations.ts`

### Queries retournent les bonnes données
- [ ] `.whereName()` retourne des objets avec toutes les propriétés
- [ ] `.whereType('class')` filtre correctement
- [ ] `.limit()` et `.offset()` fonctionnent
- [ ] Les propriétés Phase 3 sont accessibles: `extends`, `implements`, `generics`

### Navigation de graphe fonctionne
- [ ] `.expand('INHERITS_FROM')` fonctionne
- [ ] `.expand('HAS_PARENT')` fonctionne
- [ ] Count des relationships est correct

### Semantic search fonctionne
- [ ] Vector indexes se créent sans erreur
- [ ] Embeddings se génèrent
- [ ] `.semanticSearchBySource()` retourne des résultats
- [ ] Scores de similarité sont corrects

### Mutations fonctionnent
- [ ] `scopeMutations().create()` fonctionne
- [ ] `scopeMutations().update()` fonctionne
- [ ] `scopeMutations().delete()` fonctionne

---

## Configuration Docker Neo4j

Si les vector indexes ne marchent toujours pas, vérifier la config Docker :

```yaml
# docker-compose.yml (ou équivalent)
services:
  neo4j:
    image: neo4j:5.14.0
    environment:
      - NEO4J_AUTH=neo4j/neo4j123
      - NEO4J_PLUGINS=["apoc", "graph-data-science"]  # Ajouter si nécessaire
    ports:
      - "7688:7687"
      - "7475:7474"
```

Commandes pour redémarrer avec la bonne config:
```bash
docker-compose down
docker-compose up -d
```

---

## Notes de développement

**Logs utiles pour le debug**:
```typescript
// Dans QueryBuilder.execute()
console.log('Cypher query:', cypherQuery);
console.log('Neo4j result:', result);
console.log('Mapped results:', mappedResults);
```

**Test rapide des données Phase 3**:
```cypher
// Dans Neo4j Browser
MATCH (s:Scope)
WHERE s.name = 'CodeSourceAdapter'
RETURN s
```

Doit retourner toutes les propriétés dont `extends`, `heritageClauses`, etc.

---

## Contact & Documentation

- Issues: https://github.com/LuciformResearch/ragforge/issues
- Problèmes de compatibilité: `docs/neo4j-compatibility-issues.md`
- Tests Phase 3: `test-self-analysis/test-phase3-generated.mjs`
