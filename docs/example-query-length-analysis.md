# Analyse : Longueur des exemples de queries

## 🔍 Le problème actuel

Le générateur récupère des exemples depuis Neo4j via `schema.workingExamples`. Pour un champ `source` (code source), il peut récupérer **une fonction entière** :

```typescript
// Ce que getFieldExample() retourne actuellement :
"function createClient(config: RuntimeConfig) {
  const neo4jClient = new Neo4jClient(config.neo4j);

  return {
    /**
     * Create a query builder for an entity type
     */
    query<T = any>(entityType: string, options?: { enrichment?: RelationshipConfig[]; context?: EntityContext }): QueryBuilder<T> {
      return new QueryBuilder<T>(neo4jClient, entityType, options?.enrichment, options?.context);
    },
    // ... 20+ lignes de plus
  }
}"
```

Puis il l'insère dans un template :
```typescript
console.log('🔎 Semantic search for: "function createClient...');
//                                  ↑ String non fermé!
```

## 🎯 Pourquoi limiter la longueur ?

### Raison 1 : Lisibilité du code généré

**Sans limite** :
```typescript
const results = await rag.scope()
  .semanticSearchBySource('function createClient(config: RuntimeConfig) { const neo4jClient = new Neo4jClient(config.neo4j); return { query<T = any>(entityType: string, options?: { enrichment?: RelationshipConfig[]; context?: EntityContext }): QueryBuilder<T> { return new QueryBuilder<T>(neo4jClient, entityType, options?.enrichment, options?.context); }, async raw(cypher: string, params?: Record<string, any>) { return neo4jClient.run(cypher, params); }, async close() { return neo4jClient.close(); }, async ping() { return neo4jClient.verifyConnectivity(); }, _getClient() { return neo4jClient; } }; }')
  .execute();
```
→ **Illisible**, dépasse largement l'écran, difficile à comprendre

**Avec limite 80 chars** :
```typescript
const results = await rag.scope()
  .semanticSearchBySource('function createClient(config: RuntimeConfig) { const neo4jClient = ne...')
  .execute();
```
→ **Lisible**, on comprend que c'est un bout de code, pas besoin du reste

### Raison 2 : Exemples pédagogiques

Un exemple devrait montrer **COMMENT utiliser** l'API, pas **QUOI chercher exactement**.

**Mauvais exemple** (trop spécifique) :
```typescript
// L'utilisateur va copier-coller cet exemple et chercher exactement cette fonction
.semanticSearchBySource('function createClient(config: RuntimeConfig) { const neo4jClient = new Neo4jClient(config.neo4j); return { query<T = any>...')
```

**Bon exemple** (générique et adaptable) :
```typescript
// L'utilisateur comprend qu'il doit mettre SA propre query
.semanticSearchBySource('authentication logic')
// ou
.semanticSearchBySource('function createClient...')  // Tronqué, donc l'utilisateur comprend que c'est un exemple
```

### Raison 3 : Performance de l'embedding

Pour semantic search, des queries **trop longues** peuvent :
- Saturer le modèle d'embedding (limite de tokens)
- Donner des résultats moins pertinents (trop de contexte = bruit)
- Coûter plus cher en API calls

**Queries efficaces** : 5-50 mots
**Queries longues** : 100+ mots → moins efficaces

## 🤔 Mais alors, pourquoi 80 ?

### Option A : 80 caractères (ma proposition initiale)

**Pourquoi 80 ?**
- Standard de largeur de ligne historique (terminaux 80 colonnes)
- Convention de style (ESLint, Prettier par défaut)
- Lisible sur tous les écrans

**Problème** : Trop court pour certains exemples utiles
```typescript
'Find classes that implement authentication with OAuth2 provider integration'
// ↑ 78 chars - utile et complet

'function createClient(config: RuntimeConfig) { const neo4jClient = ne...'
// ↑ 80 chars - tronqué et moins utile
```

### Option B : 120-150 caractères (meilleur compromis)

**Avantages** :
- Assez long pour des phrases complètes
- Assez court pour rester lisible
- Permet de garder des exemples utiles

```typescript
'function createClient(config: RuntimeConfig) { const neo4jClient = new Neo4jClient(config.neo4j); return { query...'
// ↑ ~120 chars - on voit le début de la fonction, c'est suffisant
```

### Option C : Pas de limite (juste échapper)

**Si on échappe correctement** :
```typescript
const results = await rag.scope()
  .semanticSearchBySource(`function createClient(config: RuntimeConfig) {
  const neo4jClient = new Neo4jClient(config.neo4j);

  return {
    query<T = any>(entityType: string, options?: ...): QueryBuilder<T> {
      return new QueryBuilder<T>(...);
    },
    ...
  }
}`)
  .execute();
```

**Problèmes** :
- ❌ Exemples très longs = difficile à lire
- ❌ Pollue le code généré
- ❌ Pas pratique pour semantic search (trop de tokens)
- ❌ L'utilisateur va copier-coller sans adapter

## 💡 Solution optimale

### Approche hybride intelligente :

1. **Détecter le type d'exemple** :
   - Court (< 100 chars) → garder tel quel
   - Long (> 100 chars) → traiter différemment

2. **Pour les exemples longs** :
   - Extraire un résumé intelligent au lieu de tronquer brutalement
   - Exemples :
     ```typescript
     'function createClient...'  // Juste le nom + ...
     'authentication logic'       // Concept, pas le code
     'parse TypeScript files'     // Intent, pas l'implémentation
     ```

3. **Limite raisonnable** :
   - Soft limit : 100 chars (idéal)
   - Hard limit : 150 chars (max)
   - Si dépassement : résumer intelligemment

### Code proposé :

```typescript
private static sanitizeQueryExample(query: string | null | undefined): string {
  if (!query) return '';

  // Remove newlines and extra spaces
  let sanitized = query
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Escape quotes
  sanitized = sanitized.replace(/'/g, "\\'");

  // Intelligent truncation
  const SOFT_LIMIT = 100;
  const HARD_LIMIT = 150;

  if (sanitized.length <= SOFT_LIMIT) {
    // Perfect length, keep as-is
    return sanitized;
  }

  if (sanitized.length <= HARD_LIMIT) {
    // Acceptable length, but prefer to truncate at word boundary
    const lastSpace = sanitized.lastIndexOf(' ', SOFT_LIMIT);
    if (lastSpace > 60) {  // Don't truncate too early
      return sanitized.substring(0, lastSpace) + '...';
    }
    return sanitized;  // Keep full if we can't find good boundary
  }

  // Too long - intelligent extraction
  // If it looks like code (has 'function', '{', etc.), extract just the signature
  if (sanitized.match(/^(function|class|interface|const|let|var)\s+\w+/)) {
    const match = sanitized.match(/^[^{(]+/);  // Get everything before { or (
    if (match) {
      return match[0].trim() + '...';
    }
  }

  // Otherwise just truncate at word boundary
  const truncateAt = sanitized.lastIndexOf(' ', SOFT_LIMIT);
  if (truncateAt > 60) {
    return sanitized.substring(0, truncateAt) + '...';
  }

  // Last resort: hard cut
  return sanitized.substring(0, SOFT_LIMIT - 3) + '...';
}
```

## 📊 Exemples de résultats

| Input | Output (100 char soft limit) |
|-------|------------------------------|
| `"authentication logic"` | `"authentication logic"` (34 chars) ✅ |
| `"Find classes that implement OAuth2 authentication with provider integration"` | `"Find classes that implement OAuth2 authentication with provider integration"` (78 chars) ✅ |
| `"function createClient(config: RuntimeConfig) { const neo4jClient = new Neo4jClient(config.neo4j); return { query..."` (300 chars) | `"function createClient(config: RuntimeConfig)..."` (49 chars) ✅ |
| `"const exampleQuery = 'SELECT * FROM users WHERE authenticated = true AND provider = \"oauth2\"';"` (150+ chars) | `"const exampleQuery = 'SELECT * FROM users WHERE authenticated = true AND provider..."` (86 chars) ✅ |

## ✅ Conclusion

**Réponse à ta question "Pourquoi 80 chars ?"** :

En fait, **80 est trop court** pour ce cas d'usage. Je recommande :

- **100 caractères** comme soft limit (idéal pour lisibilité + utilité)
- **150 caractères** comme hard limit (acceptable mais on tronque à une frontière de mot)
- **Troncature intelligente** : détecter si c'est du code et extraire juste la signature

Cela permet :
1. ✅ Garder les exemples courts utiles intacts
2. ✅ Résumer intelligemment les exemples longs
3. ✅ Éviter la pollution du code généré
4. ✅ Rester lisible et pédagogique

**La vraie solution n'est pas une limite arbitraire, mais une troncature intelligente** selon le contenu.
