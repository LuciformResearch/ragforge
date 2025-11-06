# RagForge - Options d'Implémentation

Ce document détaille les différentes approches pour implémenter le runtime et la génération de code de RagForge.

---

## Option A : Créer `@ragforge/runtime` avec QueryBuilder

### Concept

Le runtime est la **bibliothèque qui exécute les queries RAG**. C'est le moteur sous le capot. On crée d'abord l'infrastructure, puis on générera du code qui l'utilise.

### Architecture

```
ragforge/packages/runtime/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── client/
│   │   ├── neo4j-client.ts      # Connection Neo4j
│   │   └── config.ts             # Config management
│   ├── query/
│   │   ├── query-builder.ts      # API fluent pour queries
│   │   ├── cypher-builder.ts     # Traduit queries en Cypher
│   │   └── query-executor.ts     # Exécute et parse résultats
│   ├── vector/
│   │   ├── vector-search.ts      # Semantic search
│   │   ├── embeddings.ts         # Génération embeddings
│   │   └── hybrid-search.ts      # Combine vector + full-text
│   ├── reranking/
│   │   ├── reranking-engine.ts   # Moteur de reranking
│   │   ├── strategies.ts         # Stratégies built-in (PageRank, etc.)
│   │   └── scorer.ts             # Execute custom scorers
│   └── types/
│       ├── query.ts              # Types pour queries
│       ├── result.ts             # Types pour résultats
│       └── config.ts             # Types pour config runtime
```

### Exemple de code

**query-builder.ts** :
```typescript
export class QueryBuilder<T = any> {
  private filters: Record<string, any> = {};
  private semanticQuery?: { text: string; topK: number };
  private expansions: { relType: string; depth: number }[] = [];
  private rerankStrategy?: string;
  private _limit: number = 10;
  private _offset: number = 0;

  constructor(
    private client: Neo4jClient,
    private entityType: string
  ) {}

  /**
   * Filter by field values
   *
   * @example
   * query.where({ type: 'function', name: { contains: 'auth' } })
   */
  where(filter: Partial<T>): this {
    this.filters = { ...this.filters, ...filter };
    return this;
  }

  /**
   * Semantic search by text
   *
   * @example
   * query.semantic('authentication code', { topK: 20 })
   */
  semantic(query: string, options?: { topK?: number }): this {
    this.semanticQuery = {
      text: query,
      topK: options?.topK || 50
    };
    return this;
  }

  /**
   * Expand to related entities
   *
   * @example
   * query.expand('CONSUMES', { depth: 2 })
   */
  expand(relType: string, options?: { depth?: number }): this {
    this.expansions.push({
      relType,
      depth: options?.depth || 1
    });
    return this;
  }

  /**
   * Apply reranking strategy
   */
  rerank(strategy: string): this {
    this.rerankStrategy = strategy;
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Execute query and return results
   */
  async execute(): Promise<SearchResult<T>[]> {
    // 1. Build Cypher query
    const cypher = this.buildCypher();

    // 2. Execute on Neo4j
    const rawResults = await this.client.run(cypher);

    // 3. Apply vector search if semantic query
    let results = this.parseResults(rawResults);
    if (this.semanticQuery) {
      results = await this.applySemanticSearch(results);
    }

    // 4. Apply reranking
    if (this.rerankStrategy) {
      results = await this.applyReranking(results);
    }

    // 5. Apply limit/offset
    return results.slice(this._offset, this._offset + this._limit);
  }

  private buildCypher(): { query: string; params: any } {
    // Construit la query Cypher depuis les filtres
    let cypher = `MATCH (n:\`${this.entityType}\`)`;
    const params: any = {};

    // WHERE clause depuis filters
    if (Object.keys(this.filters).length > 0) {
      const conditions: string[] = [];

      for (const [field, value] of Object.entries(this.filters)) {
        if (typeof value === 'object' && value !== null) {
          // Opérateurs complexes: { contains: 'foo' }
          if ('contains' in value) {
            conditions.push(`n.${field} CONTAINS $${field}_contains`);
            params[`${field}_contains`] = value.contains;
          }
          if ('startsWith' in value) {
            conditions.push(`n.${field} STARTS WITH $${field}_starts`);
            params[`${field}_starts`] = value.startsWith;
          }
          // ... autres opérateurs
        } else {
          // Égalité simple
          conditions.push(`n.${field} = $${field}`);
          params[field] = value;
        }
      }

      if (conditions.length > 0) {
        cypher += `\nWHERE ` + conditions.join(' AND ');
      }
    }

    // Expansions (graph traversal)
    for (const { relType, depth } of this.expansions) {
      cypher += `
        OPTIONAL MATCH path = (n)-[:${relType}*1..${depth}]->(related)
        WITH n, collect(related) AS ${relType.toLowerCase()}_related
      `;
    }

    cypher += `\nRETURN n`;

    // Add related if expansions
    if (this.expansions.length > 0) {
      cypher += ', ' + this.expansions
        .map(e => `${e.relType.toLowerCase()}_related`)
        .join(', ');
    }

    return { query: cypher, params };
  }

  /**
   * Explain query plan (for debugging)
   */
  async explain(): Promise<QueryPlan> {
    const { query, params } = this.buildCypher();
    const plan = await this.client.explain(query, params);

    return {
      cypher: query,
      params,
      estimatedRows: plan.estimatedRows,
      indexes: plan.indexesUsed,
      steps: plan.executionSteps
    };
  }
}
```

### Utilisation

```typescript
import { createClient } from '@ragforge/runtime';

const client = createClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password'
  },
  embeddings: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY
  }
});

// Query simple
const results = await client
  .query('Scope')
  .where({ type: 'function' })
  .limit(10)
  .execute();

// Query complexe
const results = await client
  .query('Scope')
  .semantic('authentication and JWT token validation')
  .where({
    type: 'function',
    file: { contains: 'auth' }
  })
  .expand('CONSUMES', { depth: 2 })
  .rerank('code-quality')
  .limit(5)
  .execute();

console.log(results[0]);
// {
//   entity: { name: 'validateJWT', type: 'function', ... },
//   score: 0.92,
//   scoreBreakdown: {
//     semantic: 0.85,
//     'code-quality': 0.07
//   },
//   context: {
//     related: [...]
//   }
// }
```

### Avantages
- ✅ Infrastructure solide et réutilisable
- ✅ Peut être testée indépendamment
- ✅ Utilisable directement (sans génération de code)
- ✅ Fondation pour tout le reste

### Inconvénients
- ❌ Pas encore de types générés (tout est `any` ou génériques)
- ❌ Pas d'intellisense spécifique au schema
- ❌ Utilisateur doit connaître les noms d'entités/relationships

### LLM Acceleration Opportunities 🤖

**Où un LLM peut aider:**

1. **Cypher Query Optimization** (HIGH IMPACT)
   - Prompt: "Given this query intent and Neo4j schema, generate the most efficient Cypher query"
   - Gain: Meilleures performances, utilisation optimale des indexes
   - Risk: Faible - on peut valider la query générée

2. **Error Messages Generation** (MEDIUM IMPACT)
   - Prompt: "Generate helpful error message for this failed query scenario"
   - Gain: Meilleure DX, messages plus clairs
   - Risk: Très faible

3. **Test Cases Generation** (MEDIUM IMPACT)
   - Prompt: "Generate comprehensive test cases for this QueryBuilder method"
   - Gain: Meilleure couverture de tests
   - Risk: Faible - les tests peuvent échouer et on les corrige

---

## Option B : Créer le CodeGenerator

### Concept

Le CodeGenerator **analyse la config et génère du code TypeScript** qui utilise le runtime (Option A). C'est la "magie" qui transforme une config en client typé avec intellisense parfait.

### Ce qu'il génère

À partir de `ragforge.config.yaml`, génère:

```
generated/
├── client.ts          # Client principal avec méthodes typées
├── types.ts           # Types déjà générés par TypeGenerator
├── queries/
│   ├── scope.ts       # Query builder pour Scope
│   ├── file.ts        # Query builder pour File
│   └── index.ts
├── reranking/
│   ├── strategies.ts  # Stratégies de reranking
│   └── index.ts
└── index.ts           # Point d'entrée
```

### Exemple de code généré

**generated/queries/scope.ts** :
```typescript
import { QueryBuilder } from '@ragforge/runtime';
import { Scope, ScopeFilter } from '../types.js';

export class ScopeQuery extends QueryBuilder<Scope> {
  /**
   * Filter by Scope properties
   * Auto-generated from schema
   */
  where(filter: ScopeFilter): this {
    return super.where(filter);
  }

  /**
   * Filter by scope type
   * Type-safe enum values from config
   */
  whereType(type: 'function' | 'class' | 'method' | 'variable'): this {
    return this.where({ type });
  }

  /**
   * Filter by file path
   */
  whereFile(file: string | { contains?: string; startsWith?: string }): this {
    return this.where({ file });
  }

  /**
   * Semantic search on signature
   * Uses vector index 'scopeEmbeddings'
   */
  searchBySignature(query: string, topK?: number): this {
    return this.semantic(query, {
      topK,
      vectorIndex: 'scopeEmbeddings'
    });
  }

  /**
   * Expand to dependencies
   * Follows CONSUMES relationship
   */
  withDependencies(depth: number = 1): this {
    return this.expand('CONSUMES', { depth });
  }

  /**
   * Expand to consumers
   * Follows CONSUMED_BY relationship
   */
  withConsumers(depth: number = 1): this {
    return this.expand('CONSUMED_BY', { depth });
  }

  /**
   * Apply code quality reranking
   * Uses custom strategy from config
   */
  rerankByQuality(): this {
    return this.rerank('code-quality');
  }
}
```

**generated/client.ts** :
```typescript
import { Neo4jClient } from '@ragforge/runtime';
import { ScopeQuery } from './queries/scope.js';
import { FileQuery } from './queries/file.js';
import config from '../ragforge.config.json';

export class RagClient {
  private neo4j: Neo4jClient;

  constructor() {
    this.neo4j = new Neo4jClient({
      uri: config.neo4j.uri,
      username: config.neo4j.username,
      password: config.neo4j.password,
      database: config.neo4j.database
    });
  }

  /**
   * Query Scope entities
   *
   * @example
   * const scopes = await client.scope()
   *   .whereType('function')
   *   .searchBySignature('authentication')
   *   .withDependencies(2)
   *   .rerankByQuality()
   *   .limit(10)
   *   .execute();
   */
  scope(): ScopeQuery {
    return new ScopeQuery(this.neo4j, 'Scope');
  }

  /**
   * Query File entities
   */
  file(): FileQuery {
    return new FileQuery(this.neo4j, 'File');
  }

  async close(): Promise<void> {
    await this.neo4j.close();
  }
}

export async function createClient(): Promise<RagClient> {
  return new RagClient();
}
```

### Le générateur lui-même

**packages/core/src/generator/code-generator.ts** :
```typescript
export class CodeGenerator {
  static generate(
    config: RagForgeConfig,
    schema: GraphSchema
  ): GeneratedCode {
    return {
      client: this.generateClient(config),
      queries: this.generateQueries(config, schema),
      reranking: this.generateReranking(config),
      index: this.generateIndex(config)
    };
  }

  private static generateQueries(
    config: RagForgeConfig,
    schema: GraphSchema
  ): Map<string, string> {
    const queries = new Map<string, string>();

    for (const entity of config.entities) {
      const code = this.generateEntityQuery(entity, schema);
      queries.set(entity.name.toLowerCase(), code);
    }

    return queries;
  }

  private static generateEntityQuery(
    entity: EntityConfig,
    schema: GraphSchema
  ): string {
    const lines: string[] = [];

    // Imports
    lines.push(`import { QueryBuilder } from '@ragforge/runtime';`);
    lines.push(`import { ${entity.name}, ${entity.name}Filter } from '../types.js';`);
    lines.push('');

    // Class
    lines.push(`export class ${entity.name}Query extends QueryBuilder<${entity.name}> {`);

    // where() typé
    lines.push(`  where(filter: ${entity.name}Filter): this {`);
    lines.push(`    return super.where(filter);`);
    lines.push(`  }`);
    lines.push('');

    // Méthodes pour chaque searchable field
    for (const field of entity.searchable_fields) {
      if (field.type === 'enum') {
        const enumValues = field.values?.map(v => `'${v}'`).join(' | ') || 'string';
        lines.push(`  where${this.capitalize(field.name)}(value: ${enumValues}): this {`);
        lines.push(`    return this.where({ ${field.name}: value });`);
        lines.push(`  }`);
      } else if (field.type === 'string') {
        lines.push(`  where${this.capitalize(field.name)}(value: string | { contains?: string; startsWith?: string }): this {`);
        lines.push(`    return this.where({ ${field.name}: value });`);
        lines.push(`  }`);
      }
      lines.push('');
    }

    // Méthodes pour vector search
    if (entity.vector_index) {
      lines.push(`  semanticSearch(query: string, topK?: number): this {`);
      lines.push(`    return this.semantic(query, { topK, vectorIndex: '${entity.vector_index.name}' });`);
      lines.push(`  }`);
      lines.push('');
    }

    // Méthodes pour relationships
    if (entity.relationships) {
      for (const rel of entity.relationships) {
        const methodName = this.camelCase(`with_${rel.type}`);
        lines.push(`  /** ${rel.description} */`);
        lines.push(`  ${methodName}(depth: number = 1): this {`);
        lines.push(`    return this.expand('${rel.type}', { depth });`);
        lines.push(`  }`);
        lines.push('');
      }
    }

    lines.push('}');

    return lines.join('\n');
  }

  private static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private static camelCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/[_-]([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}
```

### Utilisation finale

Après génération, l'utilisateur peut faire:

```typescript
import { createClient } from './generated/index.js';

const rag = await createClient();

// Intellisense parfait! 🎉
const results = await rag.scope()
  .whereType('function')              // ← Autocomplete: 'function' | 'class' | ...
  .searchBySignature('auth')          // ← Sait que Scope a vector index
  .withDependencies(2)                // ← Sait que CONSUMES existe
  .rerankByQuality()                  // ← Sait que cette stratégie existe
  .limit(10)
  .execute();

// Types parfaits
results.forEach(r => {
  console.log(r.entity.signature);   // ← Type = string (depuis schema)
  console.log(r.entity.startLine);   // ← Type = number
  console.log(r.score);               // ← Type = number
});
```

### Avantages
- ✅ Developer Experience parfaite (intellisense, types)
- ✅ Code optimisé pour le schema spécifique
- ✅ Documentation auto-générée (JSDoc depuis config)
- ✅ Compile-time safety (erreurs TypeScript si schema change)

### Inconvénients
- ❌ Nécessite le runtime (Option A) d'abord
- ❌ Complexe à implémenter (beaucoup de template logic)
- ❌ Debugging plus difficile (code généré)

### LLM Acceleration Opportunities 🤖

**Où un LLM peut aider:**

1. **Complete Code Generation** (VERY HIGH IMPACT) 🌟
   - Prompt: "Generate complete TypeScript query builder class for entity {name} with these fields: {fields}, relationships: {rels}"
   - Gain: Accélère énormément le développement, génère du code idiomatique
   - Risk: Moyen - besoin de validation et tests, mais très prometteuse
   - **RECOMMENDED**: C'est LA use case parfaite pour LLM

2. **JSDoc Comments Generation** (MEDIUM IMPACT)
   - Prompt: "Generate comprehensive JSDoc for this method based on entity schema"
   - Gain: Documentation riche automatique
   - Risk: Très faible

3. **Method Naming Suggestions** (LOW IMPACT)
   - Prompt: "Suggest idiomatic method names for this relationship type"
   - Gain: Noms plus naturels et intuitifs
   - Risk: Très faible

---

## Option C : Proof of Concept End-to-End

### Concept

Créer un **exemple complet mais minimal** qui démontre tout le flow:
1. Config manuelle
2. Runtime minimal (hardcodé)
3. Client minimal (hardcodé)
4. Démo qui fonctionne

Pas de génération de code, juste prouver que le concept marche.

### Structure

```
ragforge/examples/proof-of-concept/
├── ragforge.config.yaml       # Config manuelle simple
├── runtime/
│   ├── query-builder.ts       # Version minimale
│   └── neo4j-client.ts        # Version minimale
├── client/
│   ├── scope-query.ts         # Hardcodé pour Scope
│   └── rag-client.ts          # Client simple
├── demo.ts                    # Démonstration
└── README.md
```

### Code minimal

**runtime/query-builder.ts** :
```typescript
// Version ultra-simplifiée
export class QueryBuilder<T> {
  private cypherParts: string[] = [];
  private params: any = {};

  constructor(
    private client: any,
    private label: string
  ) {}

  where(filter: Partial<T>): this {
    for (const [key, value] of Object.entries(filter)) {
      this.cypherParts.push(`n.${key} = $${key}`);
      this.params[key] = value;
    }
    return this;
  }

  async execute(): Promise<T[]> {
    let cypher = `MATCH (n:\`${this.label}\`)`;

    if (this.cypherParts.length > 0) {
      cypher += ` WHERE ` + this.cypherParts.join(' AND ');
    }

    cypher += ` RETURN n LIMIT 10`;

    const result = await this.client.run(cypher, this.params);
    return result.records.map(r => r.get('n').properties);
  }
}
```

**client/scope-query.ts** :
```typescript
// Hardcodé pour l'exemple
export class ScopeQuery extends QueryBuilder<Scope> {
  whereType(type: 'function' | 'class'): this {
    return this.where({ type });
  }

  whereFile(file: string): this {
    return this.where({ file });
  }
}
```

**demo.ts** :
```typescript
import neo4j from 'neo4j-driver';
import { ScopeQuery } from './client/scope-query.js';

async function main() {
  const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'password')
  );

  const session = driver.session();

  // Query simple
  const query = new ScopeQuery(session, 'Scope');
  const results = await query
    .whereType('function')
    .whereFile('auth.ts')
    .execute();

  console.log('Found', results.length, 'scopes');
  results.forEach(s => {
    console.log('-', s.name, s.signature);
  });

  await session.close();
  await driver.close();
}

main();
```

### Résultat

Quand on lance `npm run demo`:
```
Found 3 scopes
- validateToken async function validateToken(token: string)
- checkAuth function checkAuth(req, res, next)
- getUser async function getUser(id: string)
```

**C'est tout!** Ça démontre le concept sans infrastructure complexe.

### Avantages
- ✅ Rapide à implémenter (quelques heures)
- ✅ Prouve que le concept fonctionne
- ✅ Bonne base pour discuter de l'architecture
- ✅ Peut servir de test pour valider les idées

### Inconvénients
- ❌ Pas production-ready
- ❌ Pas de génération de code
- ❌ Pas réutilisable tel quel
- ❌ Beaucoup de limitations

### LLM Acceleration Opportunities 🤖

**Où un LLM peut aider:**

1. **Example Generation** (MEDIUM IMPACT)
   - Prompt: "Generate realistic example data for code RAG use case"
   - Gain: Meilleurs exemples de démonstration
   - Risk: Très faible

2. **README Documentation** (LOW IMPACT)
   - Prompt: "Generate comprehensive README for this proof of concept"
   - Gain: Documentation claire
   - Risk: Très faible

---

## Option D : Autres Approches

### D1: Focus sur MCP d'abord

Générer directement un serveur MCP minimal qui expose quelques tools, sans runtime complexe.

```typescript
// Génère directement:
const server = new McpServer({
  tools: [
    {
      name: 'search_scopes',
      handler: async (input) => {
        // Query Neo4j directement (sans abstraction)
        const result = await session.run(`
          MATCH (s:Scope)
          WHERE s.type = $type
          RETURN s
        `, { type: input.type });
        return result.records;
      }
    }
  ]
});
```

**Avantages:**
- ✅ Valeur immédiate (agent peut utiliser)
- ✅ Plus simple que runtime complet
- ✅ Démo impressionnante

**Inconvénients:**
- ❌ Pas de réutilisabilité
- ❌ Queries hardcodées
- ❌ Pas de type safety

### D2: Focus sur Weaver Phase 1

Ignorer le runtime complexe, commencer directement par Weaver avec une version simplifiée.

**Avantages:**
- ✅ Feature la plus innovante
- ✅ Démo "wow factor"
- ✅ Peut générer des configs pour tester

**Inconvénients:**
- ❌ Complexe
- ❌ Nécessite plusieurs LLM calls
- ❌ Pas de runtime pour utiliser les configs générées

### D3: Améliorer ce qu'on a

Plutôt que d'ajouter du runtime, améliorer le générateur existant.

**Avantages:**
- ✅ Améliore l'existant
- ✅ Résultats visibles rapidement
- ✅ Pas de nouvelle infrastructure

**Inconvénients:**
- ❌ Pas de code exécutable généré
- ❌ Toujours juste des configs

---

## Recommandation d'Ordre

Si je devais choisir l'ordre optimal:

### Phase 1: Validation Rapide
1. **Option C (PoC)** - 4-6 heures
   - Valide rapidement le concept
   - Identifie les problèmes potentiels
   - Fournit exemple concret pour discussion

### Phase 2: Infrastructure Solide
2. **Option A (Runtime)** - 2-3 jours
   - Infrastructure solide
   - Bien testée et documentée
   - Réutilisable pour tout

### Phase 3: Developer Experience
3. **Option B (CodeGen)** - 2 jours
   - DX parfaite
   - Production-ready
   - Démo impressionnante

### Phase 4: Innovation
4. **Weaver Phase 1** - 1-2 semaines
   - Feature différenciante
   - Cas d'usage révolutionnaire

---

## LLM Acceleration Summary 🤖

### Highest Impact Opportunities

1. **Code Generation (Option B)** ⭐⭐⭐⭐⭐
   - Générer les query builders complets
   - Gain de temps: 60-80%
   - Risk: Moyen, mais très gérable avec tests

2. **Cypher Optimization (Option A)** ⭐⭐⭐⭐
   - Optimiser les queries Cypher générées
   - Gain de temps: 30-40%
   - Risk: Faible avec validation

3. **Test Generation (All Options)** ⭐⭐⭐
   - Générer tests complets
   - Gain de temps: 50-70%
   - Risk: Très faible

4. **Documentation (All Options)** ⭐⭐
   - READMEs, JSDoc, guides
   - Gain de temps: 70-90%
   - Risk: Très faible

### Recommended LLM Strategy

Pour **Option A** (Runtime):
- LLM pour: Tests, documentation, error messages
- Manuel pour: Core logic, Cypher building (trop critique)

Pour **Option B** (CodeGen):
- LLM pour: Tout le code généré! C'est le use case parfait
- Manuel pour: Template orchestration, validation

Pour **Option C** (PoC):
- LLM pour: Exemples, documentation
- Manuel pour: Tout le code (c'est minimal)

---

## Conclusion

**Meilleur choix pour commencer:** Option C (PoC) pour valider, puis Option A (Runtime) pour l'infrastructure solide.

**Meilleur use case pour LLM:** Option B (CodeGen) - c'est exactement le type de tâche où LLM excelle (génération de code répétitif mais structuré).
