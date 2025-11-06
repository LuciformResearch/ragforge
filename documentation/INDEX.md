# Neo4j Database Operations - Complete Reference Index

This comprehensive guide covers ALL Neo4j database operations in the codebase.

## Quick Navigation

### Start Here
- **New to the system?** Read the [Executive Summary](#executive-summary) below
- **Need code examples?** Jump to [Usage Examples](#quick-usage-examples)
- **Looking for a specific class?** See [Classes & Functions Directory](#classes--functions-directory)
- **Want to understand architecture?** Check [Architecture Overview](#architecture-overview)

---

## Executive Summary

The codebase contains a sophisticated Neo4j abstraction layer built on three main components:

1. **Neo4jClient** - Low-level driver management and direct query execution
2. **QueryBuilder** - High-level fluent API with filtering, semantic search, and relationship expansion
3. **VectorSearch** - Semantic search via Vertex AI embeddings integrated with Neo4j vector indexes
4. **SchemaIntrospector** - Runtime database schema discovery and introspection

### What Makes This Implementation Special

- Dual query modes: traditional Cypher-based AND semantic vector-based
- Automatic score merging when combining filter + semantic results (70% vector, 30% filter)
- Fluent builder API for intuitive query construction
- Automatic session management with guaranteed cleanup
- Support for multi-level relationship traversal (OPTIONAL MATCH patterns)
- Complete type inference for schema discovery

---

## Classes & Functions Directory

### Core Classes

| Class | File | Purpose | Key Methods |
|-------|------|---------|-------------|
| **Neo4jClient** | `/ragforge/packages/runtime/src/client/neo4j-client.ts` | Connection & query execution | `run()`, `transaction()`, `readTransaction()`, `vectorSearch()`, `explain()`, `close()` |
| **QueryBuilder<T>** | `/ragforge/packages/runtime/src/query/query-builder.ts` | Fluent query API | `where()`, `semantic()`, `expand()`, `execute()`, `count()`, `explain()` |
| **VectorSearch** | `/ragforge/packages/runtime/src/vector/vector-search.ts` | Semantic search | `generateEmbedding()`, `search()`, `generateEmbeddings()` |
| **SchemaIntrospector** | `/ragforge/packages/core/src/schema/introspector.ts` | Schema discovery | `introspect()` |

### Factory Functions

| Function | File | Returns | Purpose |
|----------|------|---------|---------|
| **createClient()** | `/ragforge/packages/runtime/src/index.ts` | `RagClient` | Create RAG client instance |

### Legacy Helper Functions

| Function | File | Purpose |
|----------|------|---------|
| `createNeo4jDriver()` | `/src/lib/neo4j/client.ts` | Create driver instance |
| `getNeo4jDriver()` | `/src/lib/neo4j/client.ts` | Get cached driver (singleton) |
| `getNeo4jSession()` | `/src/lib/neo4j/client.ts` | Create session |
| `getNeo4jConfig()` | `/src/lib/neo4j/client.ts` | Load config from environment |
| `closeNeo4jDriver()` | `/src/lib/neo4j/client.ts` | Close driver |

---

## Architecture Overview

### Component Relationships

```
Application
    |
    v
createClient(config)
    |
    +---> Neo4jClient
    |     ├─ Driver management
    |     ├─ Session handling
    |     └─ Query execution
    |
    +---> QueryBuilder
    |     ├─ Cypher building
    |     ├─ VectorSearch integration
    |     └─ Result aggregation
    |
    +---> VectorSearch
    |     ├─ Embedding generation (Vertex AI)
    |     └─ Vector index querying
    |
    +---> Direct database access via client methods
```

### Data Flow

**Simple Filter Query:**
```
where() -> buildCypher() -> run() -> parseResults() -> SearchResult[]
```

**Semantic Query:**
```
semantic() -> VectorSearch.search() -> embedding generation -> 
vector index query -> merge with filters -> SearchResult[]
```

**Relationship Expansion:**
```
execute() -> OPTIONAL MATCH expansion -> parseRelatedEntities() -> 
enrich results -> SearchResult[] with context.related
```

---

## Quick Usage Examples

### Initialize
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

### Basic Query
```typescript
const results = await client.query('Scope')
  .where({ type: 'function' })
  .limit(10)
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

### Complex Query
```typescript
const results = await client.query('Scope')
  .where({ 
    type: 'function',
    name: { contains: 'auth' },
    startLine: { gte: 100 }
  })
  .semantic('login handler', { vectorIndex: 'embeddings' })
  .expand('CONSUMES', { depth: 2 })
  .orderBy('name', 'ASC')
  .limit(10)
  .execute();
```

### Relationships
```typescript
// Find what references this scope
const consumers = await client.query('Scope')
  .whereConsumesScope('loadEnvironment')
  .execute();

// Find what this scope references
const dependencies = await client.query('Scope')
  .whereConsumedByScope('main')
  .execute();
```

### Transactions
```typescript
const result = await neo4jClient.transaction(async (tx) => {
  const r1 = await tx.run('CREATE (n:Node {id: $id})', {id: 1});
  const r2 = await tx.run('MATCH (n) RETURN count(n)');
  return r2.records[0].get(0);
});
```

### Raw Cypher
```typescript
const result = await client.raw(
  'MATCH (n:Scope) WHERE n.type = $type RETURN n LIMIT $limit',
  { type: 'function', limit: 10 }
);
```

### Schema Discovery
```typescript
const introspector = new SchemaIntrospector(uri, username, password);
const schema = await introspector.introspect();
console.log(schema.nodes.map(n => n.label));
console.log(schema.vectorIndexes.map(v => v.name));
```

---

## Key Concepts

### Filter Operators
```typescript
.where({ name: 'exact' })                  // Exact match
.where({ name: { equals: 'exact' } })      // Explicit equals
.where({ name: { contains: 'auth' } })     // Substring
.where({ name: { startsWith: 'load' } })   // Prefix
.where({ name: { endsWith: 'er' } })       // Suffix
.where({ line: { gt: 100 } })              // Greater than
.where({ line: { gte: 100 } })             // Greater or equal
.where({ line: { lt: 50 } })               // Less than
.where({ line: { lte: 50 } })              // Less or equal
.where({ type: { in: ['fn', 'class'] } })  // In array
```

### Execution Modes

**Filter-Only:** Traditional Cypher-based query
```typescript
.where({ type: 'function' })
.execute()
```

**Semantic-Only:** Pure vector search with optional expansions
```typescript
.semantic('query', { vectorIndex: 'embeddings' })
.execute()
```

**Combined:** Filter results + semantic merging
```typescript
.where({ type: 'function' })
.semantic('query', { vectorIndex: 'embeddings' })
.execute()
// Score = filter_score * 0.3 + vector_score * 0.7
```

### Session Types

**Regular Session:**
- Created per operation
- Automatically cleaned up
- Single query execution

**Write Transaction:**
- `executeWrite()`
- ACID compliant
- Automatic retry on failures

**Read Transaction:**
- `executeRead()`
- Can route to replicas
- Optimized for analytics

---

## Result Types

### SearchResult<T>
```typescript
interface SearchResult<T = any> {
  entity: T;                             // Matched node data
  score: number;                         // 0-1 relevance
  scoreBreakdown?: {
    semantic?: number;                   // Vector search score
    topology?: number;                   // Graph structure
    custom?: Record<string, number>;     // Custom scores
  };
  context?: {
    related?: RelatedEntity[];           // Expanded relationships
    snippet?: string;                    // Match context
    distance?: number;                   // Graph distance
  };
}
```

### QueryPlan
```typescript
interface QueryPlan {
  cypher: string;
  params: Record<string, any>;
  estimatedRows?: number;
  indexesUsed?: string[];
  executionSteps?: string[];
}
```

### GraphSchema
```typescript
interface GraphSchema {
  nodes: NodeSchema[];           // All node labels
  relationships: RelationshipSchema[];  // All relationship types
  indexes: IndexSchema[];        // All indexes
  constraints: ConstraintSchema[];     // All constraints
  vectorIndexes: VectorIndexSchema[];  // Vector indexes
}
```

---

## Configuration Reference

### RuntimeConfig
```typescript
interface RuntimeConfig {
  neo4j: Neo4jConfig;
  embeddings?: EmbeddingsConfig;
  reranking?: RerankingConfig;
}

interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
  maxConnectionPoolSize?: number;  // Default: 50
  connectionTimeout?: number;      // Default: 30000ms
}
```

---

## Important Implementation Details

1. **Session Management Pattern:**
   - Sessions created per operation
   - Always closed in finally block
   - No session reuse across operations
   - Prevents connection leaks

2. **Parameter Binding:**
   - All parameters are named ($field_name)
   - No positional parameters
   - Safe from injection attacks
   - Automatically escaped

3. **Query Building:**
   - Cypher constructed step-by-step
   - Entity names backtick-quoted
   - WHERE conditions combined with AND
   - OPTIONAL MATCH for expansions

4. **Semantic Search:**
   - Text embedded via Vertex AI API
   - Results scored by cosine similarity
   - Merged with filter results
   - UUID-based entity matching

5. **Type Inference:**
   - Conservative approach
   - All properties nullable
   - Sample-based (100 nodes max)
   - Handles Neo4j-specific types

---

## Performance Tips

- Use vector indexes for semantic search
- Call `explain()` to verify index usage
- Set appropriate `limit()` to avoid large result sets
- Use `readTransaction()` for read-heavy operations
- Batch `expand()` operations judiciously
- Close connections with `close()`
- Use `count()` instead of full queries for pagination

---

## File Structure

```
/ragforge/packages/
├── runtime/                    # Main runtime library
│   ├── src/
│   │   ├── client/neo4j-client.ts
│   │   ├── query/query-builder.ts
│   │   ├── vector/vector-search.ts
│   │   ├── types/
│   │   │   ├── config.ts
│   │   │   ├── query.ts
│   │   │   ├── result.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   └── example.ts

└── core/                       # Schema generation
    ├── src/
    │   ├── schema/introspector.ts
    │   └── types/
    │       ├── config.ts
    │       └── schema.ts

/src/lib/neo4j/
├── client.ts                   # Legacy helpers
└── index.ts
```

---

## Additional Resources

### Comprehensive Documentation
- **Main Reference:** `/tmp/neo4j_db_operations_summary.md` (650+ lines)
  - Complete class/function documentation
  - All type definitions
  - Implementation details
  - Usage examples

### Quick Lookup
- **Cheat Sheet:** `/tmp/neo4j_quick_reference.md` (400+ lines)
  - Method tables
  - Common patterns
  - Filter operator reference
  - Performance tips

### Architecture Diagrams
- **Visual Guide:** `/tmp/neo4j_architecture_summary.txt` (400+ lines)
  - Component relationships
  - Data flow diagrams
  - Execution patterns
  - Configuration hierarchy

---

## Support & Debugging

### Verify Connection
```typescript
const isHealthy = await client.ping();
```

### Explain Query Plan
```typescript
const plan = await client.query('Scope')
  .where({ type: 'function' })
  .explain();
console.log(plan.indexesUsed);  // Check index usage
```

### Count Results
```typescript
const total = await client.query('Scope').count();
```

### Introspect Schema
```typescript
const schema = new SchemaIntrospector(uri, user, pass).introspect();
console.log(schema.nodes);  // Available node labels
console.log(schema.indexes);  // Available indexes
```

---

## Key Takeaways

1. Neo4jClient is the foundation - manages driver, sessions, transactions
2. QueryBuilder provides intuitive query API - filtering, semantic search, expansion
3. VectorSearch bridges text queries to Neo4j vector indexes
4. SchemaIntrospector enables runtime schema discovery
5. Sessions auto-cleanup - no manual resource management needed
6. Named parameters ensure safe query execution
7. Semantic + filter results merge with configurable weights (70%/30%)
8. Relationship expansion supports multi-level traversal
9. Connection pooling enabled by default (50 connections)
10. All results strongly-typed with score breakdown and context

---

**Last Updated:** 2025-11-03
**Coverage:** Comprehensive - All database operations explored
**Total Lines of Documentation:** 1600+
