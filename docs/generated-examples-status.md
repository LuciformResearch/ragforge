# État des Exemples Générés

**Date**: 2025-11-10
**Projet test**: ragforge-self-analysis

## 📊 Résumé

Sur 10 exemples générés:
- ✅ **7 fonctionnent** (70%)
- ❌ **3 échouent** (30%)

## ✅ Exemples qui fonctionnent

| # | Nom | Description | Status |
|---|-----|-------------|--------|
| 02 | semantic-search-signature | Recherche sémantique par signature | ✅ |
| 03 | semantic-search-name | Recherche sémantique par nom | ✅ |
| 06 | conditional-search | Stratégie de recherche conditionnelle | ✅ |
| 07 | breadth-first | Recherche breadth-first | ✅ |
| 08 | stopping-criteria | Critères d'arrêt | ✅ |
| 09 | mutations-crud | CRUD operations | ✅ |
| 10 | batch-mutations | Batch operations | ✅ |

## ❌ Exemples qui échouent

| # | Nom | Erreur | Cause | Priorité |
|---|-----|--------|-------|----------|
| 01 | semantic-search-source | Unterminated string literal | Multiline query non échappée | 🔴 HAUTE |
| 04 | llm-reranking | Unterminated string literal | Multiline query non échappée | 🔴 HAUTE |
| 05 | metadata-tracking | Unterminated string literal | Multiline query non échappée | 🔴 HAUTE |

## 🔍 Analyse du problème

### Cause racine

Le générateur d'exemples (`packages/core/src/generator/code-generator.ts`) utilise des exemples de queries depuis le schéma introspected (`schema.workingExamples`).

Quand ces exemples contiennent du code source multiline (comme une fonction complète), le générateur les insère directement dans les exemples TypeScript **sans les échapper**.

**Exemple de code généré (INVALIDE)**:
```typescript
console.log('🔎 Semantic search for: "function createClient(config: RuntimeConfig) {
  const neo4jClient = new Neo4jClient(config.neo4j);
  return {
    /**
     * Create a query builder...
```

Le string n'est pas fermé correctement → **syntax error**.

### Fichiers concernés

**Générateur**: `packages/core/src/generator/code-generator.ts`
- Ligne ~1699: `const query = index.example_query || this.getFieldExample(...)`
- Ligne ~2119: Le query est inséré tel quel dans le template

**Introspector**: `packages/core/src/schema/introspector.ts`
- Méthode `getWorkingExample()` qui extrait les exemples depuis Neo4j
- Retourne du code source complet sans vérifier la longueur/format

## 🔧 Solutions possibles

### Option A: Échapper les newlines (rapide)
```typescript
// Dans code-generator.ts, ligne ~2119
const escapedQuery = query.replace(/\n/g, '\\n').replace(/"/g, '\\"');
const bodyCode = `console.log('🔎 Semantic search for: "${escapedQuery}"');`;
```

**Avantages**:
- Fix rapide
- Garde les exemples réels

**Inconvénients**:
- Peut créer des strings très longs et illisibles
- Ne résout pas le problème fondamental

### Option B: Limiter la longueur des exemples (recommandé)
```typescript
// Dans code-generator.ts
private static sanitizeQueryExample(query: string): string {
  // Remove newlines
  let sanitized = query.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Escape quotes
  sanitized = sanitized.replace(/"/g, '\\"');

  // Limit length
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 97) + '...';
  }

  return sanitized;
}

// Utiliser:
const query = this.sanitizeQueryExample(
  index.example_query || this.getFieldExample(...) || 'your query'
);
```

**Avantages**:
- Résout le problème de syntaxe
- Garde les exemples lisibles
- Fonctionnel pour tous types d'exemples

**Inconvénients**:
- Perd l'exemple complet (mais c'était illisible de toute façon)

### Option C: Utiliser des exemples génériques
```typescript
// Dans code-generator.ts
// Ne jamais utiliser de code source comme exemple de query
const query = index.example_query
  || 'your search query'  // Toujours fallback sur un string simple
  || this.getGenericExample(sourceField); // Exemples génériques par type
```

**Avantages**:
- Toujours fonctionnel
- Prévisible

**Inconvénients**:
- Perd les exemples réels du projet
- Moins utile pour comprendre

## ✅ Solution recommandée

**Combinaison des options B et C**:

1. Ajouter une méthode `sanitizeQueryExample()` qui:
   - Enlève les newlines
   - Échappe les quotes
   - Limite à 80-100 caractères
   - Ajoute `...` si tronqué

2. Modifier `getFieldExample()` pour:
   - Préférer des exemples courts (< 50 chars)
   - Fallback sur des exemples génériques si trop long

3. Dans les templates:
   ```typescript
   const query = this.sanitizeQueryExample(
     index.example_query
     || this.getFieldExample(schema, entityName, fieldName)
     || `search ${fieldName}`
   );
   ```

## 📝 Implémentation

### Étape 1: Ajouter la méthode sanitize
```typescript
// packages/core/src/generator/code-generator.ts

private static sanitizeQueryExample(query: string | null | undefined, maxLength: number = 80): string {
  if (!query) return '';

  // Remove newlines and extra spaces
  let sanitized = query
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Escape quotes
  sanitized = sanitized.replace(/'/g, "\\'");

  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength - 3) + '...';
  }

  return sanitized;
}
```

### Étape 2: Utiliser dans les générateurs d'exemples

**Dans `generateSemanticSearchExample()` (ligne ~2119)**:
```typescript
const sanitizedQuery = this.sanitizeQueryExample(query);
const bodyCode = `  console.log('🔎 Semantic search for: "${sanitizedQuery}"');
  const results = await rag.${entityMethod}()
    .${searchMethod}('${sanitizedQuery}', { topK: ${topK} })
    .execute();
  ...
```

**Dans `generateLLMRerankExample()` (ligne ~2230)**:
```typescript
const sanitizedSemanticQuery = this.sanitizeQueryExample(semanticQuery);
const sanitizedLlmQuestion = this.sanitizeQueryExample(llmQuestion, 120);
...
```

**Dans `generateMetadataExample()` et autres**:
```typescript
const sanitizedQuery = this.sanitizeQueryExample(query);
```

### Étape 3: Rebuild et test
```bash
cd packages/core && npm run build
cd packages/cli && npm run build
cd test-self-analysis && rm -rf generated
node ../packages/cli/dist/esm/index.js init --force --dev
cd generated && bash ../test-all-examples.sh
```

## 🎯 Résultat attendu

Après le fix, **tous les 10 exemples doivent passer** ✅

## 📋 TODO

- [ ] Implémenter `sanitizeQueryExample()`
- [ ] Modifier `generateSemanticSearchExample()`
- [ ] Modifier `generateLLMRerankExample()`
- [ ] Modifier `generateMetadataExample()`
- [ ] Rebuild core et CLI
- [ ] Régénérer le projet test
- [ ] Vérifier que les 10 exemples passent
- [ ] Commit et push

## 🔗 Références

- Code generator: `packages/core/src/generator/code-generator.ts`
- Schema introspector: `packages/core/src/schema/introspector.ts`
- Test script: `test-self-analysis/test-all-examples.sh`
