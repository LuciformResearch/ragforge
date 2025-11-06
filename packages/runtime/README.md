# @luciformresearch/ragforge-runtime

Runtime library for executing RAG queries on Neo4j databases.

### ⚖️ License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

✅ **Free to use for:**
- 🧠 Research, education, personal exploration
- 💻 Freelance or small-scale projects (≤ €100,000 gross monthly revenue)
- 🏢 Internal tools (if your company revenue ≤ €100,000/month)

🔒 **Commercial use above this threshold** requires a separate agreement.

📧 Contact for commercial licensing: [legal@luciformresearch.com](mailto:legal@luciformresearch.com)

⏰ **Grace period:** 60 days after crossing the revenue threshold

📜 Full text: [LICENSE](./LICENSE)

---

**Note:** This is a custom "source-available" license, NOT an OSI-approved open source license.
## Features

- **QueryBuilder**: Fluent API for building complex queries
- **Neo4j Client**: Connection pooling and query execution
- **Vector Search**: Semantic search with embeddings (coming soon)
- **Reranking**: Custom scoring strategies (coming soon)
- **Type-safe**: Full TypeScript support

## Installation

```bash
npm install @luciformresearch/ragforge-runtime
```

## Quick Start

```typescript
import { createClient } from '@luciformresearch/ragforge-runtime';

// Create client
const rag = createClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password',
    database: 'neo4j'
  }
});

// Simple query
const results = await rag.query('Scope')
  .where({ type: 'function' })
  .limit(10)
  .execute();

console.log('Found', results.length, 'scopes');

// Complex query with filters
const functions = await rag.query('Scope')
  .where({
    type: 'function',
    file: { contains: 'auth' },
    startLine: { gte: 100, lte: 500 }
  })
  .orderBy('name', 'ASC')
  .limit(20)
  .execute();

// Query with relationship expansion
const scopesWithDeps = await rag.query('Scope')
  .where({ type: 'function' })
  .expand('CONSUMES', { depth: 2 })
  .limit(5)
  .execute();

// Access related entities
scopesWithDeps.forEach(result => {
  console.log(result.entity.name);
  console.log('Dependencies:', result.context?.related);
});

// Close connection when done
await rag.close();
```

## API Reference

### createClient(config)

Create a RAG client with Neo4j configuration.

```typescript
const rag = createClient({
  neo4j: {
    uri: string;
    username: string;
    password: string;
    database?: string;
    maxConnectionPoolSize?: number;
    connectionTimeout?: number;
  }
});
```

### QueryBuilder API

#### where(filter)

Filter entities by field values with operators:

```typescript
.where({
  // Exact match
  type: 'function',

  // String operators
  name: { contains: 'auth' },
  file: { startsWith: 'src/' },

  // Numeric operators
  startLine: { gte: 100, lt: 500 },

  // Array operators
  tags: { in: ['important', 'critical'] }
})
```

#### expand(relType, options)

Traverse relationships and include related entities:

```typescript
.expand('CONSUMES', { depth: 2 })
.expand('DEFINED_IN', { depth: 1 })
```

#### limit(n) / offset(n)

Pagination:

```typescript
.limit(20)
.offset(10)
```

#### orderBy(field, direction)

Sort results:

```typescript
.orderBy('name', 'ASC')
.orderBy('startLine', 'DESC')
```

#### execute()

Execute query and return results:

```typescript
const results: SearchResult<T>[] = await query.execute();
```

#### count()

Get count without fetching results:

```typescript
const total = await query.count();
```

#### explain()

Get query execution plan:

```typescript
const plan = await query.explain();
console.log('Cypher:', plan.cypher);
console.log('Indexes used:', plan.indexesUsed);
```

### SearchResult

```typescript
interface SearchResult<T> {
  entity: T;              // The matched entity
  score: number;          // Relevance score (0-1)
  scoreBreakdown?: {...}; // Score details
  context?: {
    related?: RelatedEntity[];  // Related entities from expand()
    snippet?: string;           // Text highlight
    distance?: number;          // Graph distance
  };
}
```

## Advanced Usage

### Raw Cypher Queries

```typescript
const result = await rag.raw(`
  MATCH (s:Scope)-[:CONSUMES]->(dep:Scope)
  WHERE s.type = $type
  RETURN s, collect(dep) AS dependencies
`, { type: 'function' });
```

### Transaction Support

```typescript
const client = new Neo4jClient(config);

await client.transaction(async (tx) => {
  await tx.run('CREATE (n:Node {name: $name})', { name: 'test' });
  await tx.run('CREATE (n:Node {name: $name})', { name: 'test2' });
  // Auto-commits if no error
});
```

### Health Check

```typescript
const isHealthy = await rag.ping();
console.log('Neo4j connection:', isHealthy ? 'OK' : 'FAILED');
```

## Coming Soon

- **Vector Search**: Semantic search with embeddings
- **Reranking**: PageRank, BM25, custom scorers
- **Aggregations**: count, sum, avg, etc.
- **Caching**: Query result caching
- **Monitoring**: Query performance metrics

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Test
npm test

# Lint
npm run lint
```

## Part of RagForge

This package is part of the [RagForge](https://github.com/LuciformResearch/ragforge) meta-framework.

**Related Packages:**
- [`@luciformresearch/ragforge-core`](https://www.npmjs.com/package/@luciformresearch/ragforge-core) - Schema analysis and code generation
- [`@luciformresearch/ragforge-cli`](https://www.npmjs.com/package/@luciformresearch/ragforge-cli) - Command-line interface

## License

LRSL v1.1 - See [LICENSE](./LICENSE) file for details.
