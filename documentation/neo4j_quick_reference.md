# Neo4j Database Operations - Quick Reference

## Core Classes & Functions

### Neo4jClient - Connection & Query Execution
**Location:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/client/neo4j-client.ts`

| Method | Signature | Purpose |
|--------|-----------|---------|
| `constructor()` | `(config: Neo4jConfig)` | Initialize driver with connection params |
| `run()` | `async (cypher: string \| CypherQuery, params?) => QueryResult` | Execute Cypher query |
| `transaction()` | `async <T>(fn: (tx) => Promise<T>) => T` | Execute write transaction |
| `readTransaction()` | `async <T>(fn: (tx) => Promise<T>) => T` | Execute read-only transaction |
| `explain()` | `async (cypher: string, params?) => QueryPlan` | Get query execution plan |
| `vectorSearch()` | `async (indexName, embedding, topK?) => VectorSearchResult[]` | Vector similarity search |
| `fullTextSearch()` | `async (indexName, query, options?) => any[]` | Full-text keyword search |
| `verifyConnectivity()` | `async () => boolean` | Check connection health |
| `close()` | `async () => void` | Close driver connections |

---

### QueryBuilder - Query Building API
**Location:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/query/query-builder.ts`

| Method | Signature | Purpose |
|--------|-----------|---------|
| `where()` | `(filter: Record<string, FilterValue>) => this` | Add field filters |
| `semantic()` | `(query: string, options?) => this` | Add semantic search |
| `expand()` | `(relType: string, options?) => this` | Add relationship expansion |
| `limit()` | `(n: number) => this` | Set result limit |
| `offset()` | `(n: number) => this` | Set result offset |
| `orderBy()` | `(field: string, direction?) => this` | Set ordering |
| `whereUuidIn()` | `(uuids: string[]) => this` | Filter by UUID list |
| `whereConsumesScope()` | `(scopeName: string) => this` | Find referencing scopes |
| `whereConsumedByScope()` | `(scopeName: string) => this` | Find referenced scopes |
| `whereRelatedTo()` | `(scopeName: string, options) => this` | Generic relationship filter |
| `execute()` | `async () => SearchResult<T>[]` | Execute query and return results |
| `count()` | `async () => number` | Count matching entities |
| `explain()` | `async () => QueryPlan` | Get execution plan |

---

### VectorSearch - Semantic Search
**Location:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/vector/vector-search.ts`

| Method | Signature | Purpose |
|--------|-----------|---------|
| `constructor()` | `(neo4jClient, options?)` | Initialize with Neo4j client |
| `generateEmbedding()` | `async (text: string) => number[]` | Generate text embedding (Vertex AI) |
| `search()` | `async (query: string, options) => VectorSearchResult[]` | Search vector index |
| `generateEmbeddings()` | `async (texts: string[]) => number[][]` | Batch generate embeddings |
| `getModelInfo()` | `() => {model, dimension, provider}` | Get embedding model info |

---

### SchemaIntrospector - Database Analysis
**Location:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/schema/introspector.ts`

| Method | Signature | Purpose |
|--------|-----------|---------|
| `constructor()` | `(uri: string, username: string, password: string)` | Initialize with connection params |
| `introspect()` | `async (database?) => GraphSchema` | Analyze full database schema |
| `close()` | `async () => void` | Close introspector connection |

---

## Type Definitions

### Connection & Configuration
```typescript
interface Neo4jConfig {
  uri: string;                         // Connection URL
  username: string;
  password: string;
  database?: string;
  maxConnectionPoolSize?: number;      // Default: 50
  connectionTimeout?: number;          // Default: 30000ms
}

interface RuntimeConfig {
  neo4j: Neo4jConfig;
  embeddings?: EmbeddingsConfig;
  reranking?: RerankingConfig;
}
```

### Query Types
```typescript
interface CypherQuery {
  query: string;
  params: Record<string, any>;
}

interface FilterOperators<T> {
  equals?: T;
  contains?: string;     // String only
  startsWith?: string;   // String only
  endsWith?: string;     // String only
  gt?: number;          // Number only
  gte?: number;         // Number only
  lt?: number;          // Number only
  lte?: number;         // Number only
  in?: T[];
}
```

### Result Types
```typescript
interface SearchResult<T = any> {
  entity: T;
  score: number;                    // 0-1
  scoreBreakdown?: {
    semantic?: number;
    topology?: number;
    custom?: Record<string, number>;
  };
  context?: {
    related?: RelatedEntity[];
    snippet?: string;
    distance?: number;
  };
}

interface QueryPlan {
  cypher: string;
  params: Record<string, any>;
  estimatedRows?: number;
  indexesUsed?: string[];
  executionSteps?: string[];
}
```

### Schema Types
```typescript
interface GraphSchema {
  nodes: NodeSchema[];
  relationships: RelationshipSchema[];
  indexes: IndexSchema[];
  constraints: ConstraintSchema[];
  vectorIndexes: VectorIndexSchema[];
}

interface NodeSchema {
  label: string;
  properties: PropertySchema[];
  count?: number;
}

interface VectorIndexSchema {
  name: string;
  label: string;
  property: string;
  dimension: number;
  similarity: 'cosine' | 'euclidean';
}
```

---

## Common Patterns

### Initialize Client
```typescript
import { createClient } from '@ragforge/runtime';

const client = createClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password'
  }
});
```

### Simple Filter Query
```typescript
const results = await client.query('Scope')
  .where({ type: 'function' })
  .limit(10)
  .execute();
```

### Complex Filter Query
```typescript
const results = await client.query('Scope')
  .where({
    type: 'function',
    name: { contains: 'auth' },
    startLine: { gte: 100 }
  })
  .orderBy('name', 'ASC')
  .limit(20)
  .execute();
```

### Semantic Search
```typescript
const results = await client.query('Scope')
  .semantic('authentication logic', {
    topK: 20,
    vectorIndex: 'scopeEmbeddings'
  })
  .execute();
```

### Combined Query
```typescript
const results = await client.query('Scope')
  .where({ type: 'function' })
  .semantic('auth handler', { vectorIndex: 'scopeEmbeddings' })
  .expand('CONSUMES', { depth: 2 })
  .limit(10)
  .execute();
```

### Relationship Queries
```typescript
// Find scopes that consume a specific scope
const consumers = await client.query('Scope')
  .whereConsumesScope('loadEnvironment')
  .execute();

// Find scopes that are consumed by a specific scope
const dependencies = await client.query('Scope')
  .whereConsumedByScope('main')
  .execute();

// Find related scopes
const related = await client.query('Scope')
  .whereRelatedTo('target', { 
    relationship: 'CONSUMES', 
    direction: 'incoming' 
  })
  .execute();
```

### Transaction Example
```typescript
const neo4jClient = new Neo4jClient(config);

const result = await neo4jClient.transaction(async (tx) => {
  const r1 = await tx.run(
    'CREATE (n:Scope {name: $name}) RETURN n',
    { name: 'test' }
  );
  const r2 = await tx.run('MATCH (n:Scope) RETURN count(n)');
  return r2.records[0].get(0);
});
```

### Query Explanation
```typescript
const plan = await client.query('Scope')
  .where({ type: 'function' })
  .explain();

console.log(plan.cypher);
console.log(plan.indexesUsed);
console.log(plan.estimatedRows);
```

### Raw Cypher
```typescript
const result = await client.raw(
  'MATCH (n:Scope) WHERE n.type = $type RETURN n.name, n.file LIMIT $limit',
  { type: 'function', limit: 10 }
);

result.records.forEach(record => {
  console.log(record.get('name'));
});
```

### Schema Introspection
```typescript
const introspector = new SchemaIntrospector(uri, username, password);
const schema = await introspector.introspect('neo4j');

console.log('Node labels:', schema.nodes.map(n => n.label));
console.log('Relationships:', schema.relationships.map(r => r.type));
console.log('Vector indexes:', schema.vectorIndexes.map(v => v.name));

await introspector.close();
```

### Connection Cleanup
```typescript
// Always close when done
await client.close();
```

---

## Filter Operator Cheat Sheet

```typescript
// String operators
.where({ name: 'exact' })                    // Exact match
.where({ name: { equals: 'exact' } })        // Exact match (explicit)
.where({ name: { contains: 'auth' } })       // Substring
.where({ name: { startsWith: 'load' } })     // Prefix
.where({ name: { endsWith: 'Handler' } })    // Suffix

// Numeric operators
.where({ startLine: 100 })                   // Exact match
.where({ startLine: { gt: 100 } })           // Greater than
.where({ startLine: { gte: 100 } })          // Greater or equal
.where({ startLine: { lt: 50 } })            // Less than
.where({ startLine: { lte: 50 } })           // Less or equal

// Array operators
.where({ type: { in: ['function', 'class'] } })  // Match any

// Multiple filters (AND logic)
.where({
  type: 'function',
  file: { contains: 'auth' },
  startLine: { gte: 100 }
})
```

---

## Performance Tips

1. **Use vector indexes** for semantic search over full-text scan
2. **Use readTransaction()** for read-heavy operations
3. **Call `.explain()`** to verify index usage
4. **Set appropriate `.limit()`** to avoid large result sets
5. **Use relationship `.expand()` judiciously** - deep traversals are expensive
6. **Batch vector embedding generation** if available
7. **Close connections** with `.close()` before process exit
8. **Use `.count()`** instead of full query for entity counts

---

## Relationship Operators

```typescript
// Relationship expansion
.expand('CONSUMES', { depth: 1 })              // Single level
.expand('CONSUMES', { depth: 2 })              // Multi-level
.expand('CONSUMES', { depth: 1, direction: 'outgoing' })

// Semantic search operator weights
// Vector score: 70% (semantic relevance)
// Filter score: 30% (field matching)

// Results merged by UUID matching
```

---

## Environment Variables (Legacy Client)

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password
NEO4J_DATABASE=neo4j
```

---

## Key Implementation Files

- **Neo4jClient:** `/ragforge/packages/runtime/src/client/neo4j-client.ts`
- **QueryBuilder:** `/ragforge/packages/runtime/src/query/query-builder.ts`
- **VectorSearch:** `/ragforge/packages/runtime/src/vector/vector-search.ts`
- **SchemaIntrospector:** `/ragforge/packages/core/src/schema/introspector.ts`
- **Public API:** `/ragforge/packages/runtime/src/index.ts`
- **Legacy Client:** `/src/lib/neo4j/client.ts`

