# QueryBuilder Result Structure - Decision

## Contexte

Le QueryBuilder retourne actuellement :
```typescript
type SearchResult<T> = {
  entity: T;      // L'entité complète avec toutes ses propriétés
  score: number;  // Score de pertinence (1.0 pour queries normales, 0-1 pour semantic)
  scoreBreakdown?: Record<string, number>;
  context?: any;
}
```

Mais les exemples générés accèdent directement aux propriétés : `results[0].name`

## Options évaluées

### ❌ Option A : Aplatir conditionnellement
```typescript
if (useSemanticSearch || useLLMRerank) {
  return results; // { entity, score, ... }
} else {
  return results.map(r => r.entity); // T[]
}
```

**Problème** : Type de retour différent selon la query → casse le typage TypeScript, confusion.

### ✅ Option B : Structure explicite cohérente (RECOMMANDÉE)
```typescript
// TOUJOURS retourner SearchResult<T>
return results; // { entity, score, scoreBreakdown, context }[]
```

**Avantages** :
- ✅ **Type de retour prévisible** : toujours `SearchResult<T>[]`
- ✅ **Générique** : fonctionne avec ou sans embeddings
- ✅ **Score toujours accessible** : utile pour debugger même sans semantic search
- ✅ **Cohérent** : semantic search et queries normales ont la même structure
- ✅ **Extensible** : facile d'ajouter des métadonnées (context, breakdown, etc.)

**Code actuel déjà correct** : Le QueryBuilder fait déjà ça ! C'est juste les exemples générés qui sont incorrects.

### ❌ Option C : Mélanger au top-level
```typescript
return results.map(r => ({ ...r.entity, score: r.score, ... }));
```

**Problèmes** :
- ❌ Conflit si l'entité a une propriété "score" native
- ❌ Pollue le namespace de l'entité
- ❌ Rend les types confus

## ✅ DÉCISION : Option B avec helper optionnel

**Structure principale** : Garder `SearchResult<T>` cohérent
```typescript
const results = await rag.scope().whereName('CodeSourceAdapter').execute();
// results[0] = { entity: {...}, score: 1.0, ... }

// Accès explicite (recommandé)
console.log(results[0].entity.name);
console.log(results[0].entity.extends); // Phase 3 data
console.log(results[0].score);
```

**Helper optionnel** : Ajouter `.executeFlat()` pour les cas simples
```typescript
// Pour ceux qui veulent juste les entités
const entities = await rag.scope().whereName('CodeSourceAdapter').executeFlat();
// entities[0] = { name: '...', extends: '...', ... }
console.log(entities[0].name); // Direct access
```

## Implémentation

### 1. Garder `.execute()` tel quel
Retourne toujours `SearchResult<T>[]` - **déjà fait** ✅

### 2. Ajouter `.executeFlat()` (optionnel)
```typescript
// Dans QueryBuilder
async executeFlat(): Promise<T[]> {
  const results = await this.execute();
  return results.map(r => r.entity);
}
```

### 3. Mettre à jour les exemples générés
```typescript
// Dans code-generator.ts - générer les exemples comme ça :

// Pour semantic search (besoin du score)
const results = await rag.scope()
  .semanticSearchBySource('query')
  .execute();

results.forEach(r => {
  console.log(`${r.entity.name} (score: ${r.score.toFixed(3)})`);
});

// Pour queries simples (pas besoin du score)
const scopes = await rag.scope()
  .whereName('CodeSourceAdapter')
  .executeFlat(); // ← Utiliser executeFlat()

scopes.forEach(s => {
  console.log(s.name, s.extends); // Direct access
});
```

### 4. Mettre à jour les types générés
```typescript
// Dans types.ts - documenter la structure
export interface Scope {
  name?: string;
  type?: string;
  extends?: string;        // Phase 3
  implements?: string;     // Phase 3
  heritageClauses?: string; // Phase 3 (JSON)
  generics?: string;       // Phase 3
  genericParameters?: string; // Phase 3 (JSON)
  // ... autres propriétés
}

// SearchResult est déjà exporté par @luciformresearch/ragforge-runtime
```

## Avantages de cette approche

### 1. **Générique pour tous types de projets**
- Code source (TypeScript, Python, etc.)
- Documents (PDF, Markdown)
- Données structurées (JSON, CSV)
- N'importe quelle entité Neo4j

### 2. **Fonctionne avec embeddings**
```typescript
// Semantic search - score utile
const results = await rag.scope()
  .semanticSearchBySource('authentication logic')
  .execute();

results.forEach(r => {
  console.log(`${r.entity.name}: ${r.score.toFixed(3)}`);
  if (r.entity.extends) {
    console.log(`  Extends: ${r.entity.extends}`); // Phase 3
  }
});
```

### 3. **Fonctionne sans embeddings**
```typescript
// Query simple - score ignoré ou utilisé pour debug
const results = await rag.scope()
  .whereType('class')
  .execute();

// Ou plus simple avec executeFlat()
const classes = await rag.scope()
  .whereType('class')
  .executeFlat();

classes.forEach(c => {
  console.log(`${c.name} extends ${c.extends || 'none'}`);
});
```

### 4. **Typage TypeScript prévisible**
```typescript
// Type toujours le même, pas de conditionnelle
type Result = Awaited<ReturnType<typeof rag.scope().execute>>;
// Result = SearchResult<Scope>[]

type Entity = Awaited<ReturnType<typeof rag.scope().executeFlat>>;
// Entity = Scope[]
```

### 5. **Debugging facilité**
```typescript
const results = await rag.scope().whereName('X').execute();
console.log('Score:', results[0].score); // Toujours accessible
console.log('Breakdown:', results[0].scoreBreakdown);
```

## Migration des exemples existants

**Avant** (incorrect) :
```typescript
const results = await rag.scope().whereName('X').execute();
console.log(results[0].name); // undefined ❌
```

**Après** (option 1 - explicite) :
```typescript
const results = await rag.scope().whereName('X').execute();
console.log(results[0].entity.name); // ✅
console.log(results[0].score); // ✅ Bonus: voir le score
```

**Après** (option 2 - flat) :
```typescript
const scopes = await rag.scope().whereName('X').executeFlat();
console.log(scopes[0].name); // ✅ Plus simple pour queries basiques
```

## TODO

- [x] Décision documentée
- [ ] Implémenter `.executeFlat()` dans QueryBuilder
- [ ] Mettre à jour `code-generator.ts` pour générer les bons exemples
- [ ] Mettre à jour les types générés pour documenter la structure
- [ ] Tester tous les exemples générés
- [ ] Mettre à jour la documentation client

## Compatibilité

**Breaking change** : Non si on ajoute `.executeFlat()` en plus
**Backward compatible** : `.execute()` ne change pas, juste les exemples générés

Cette approche est **la plus générique** car elle fonctionne pour :
- ✅ N'importe quel type d'entité
- ✅ Avec ou sans embeddings
- ✅ Avec ou sans semantic search
- ✅ Queries simples ou complexes
- ✅ Besoin du score ou non
