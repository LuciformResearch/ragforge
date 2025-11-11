# test-code-rag RAG Client - Quick Start Guide

> Get started with the test-code-rag RAG framework in under 2 minutes

---

## 📦 Installation

```bash
npm install
```

## 🗄️ Database Setup

### First-time setup

If this is a new project with code to ingest:

```bash
npm run setup
```

This will:
1. ✅ Parse your source code (configured in `ragforge.config.yaml`)
2. ✅ Ingest code into Neo4j (incremental - only changed files)
3. ✅ Create vector indexes
4. ✅ Generate embeddings

### Subsequent updates

When your code changes, just run:

```bash
npm run ingest
```

This uses **incremental ingestion** - only re-processes files that changed!

### Watch mode (automatic ingestion)

For automatic ingestion as you code:

```bash
npm run watch
```

This watches your source files and automatically ingests changes:
- 🔄 Batches changes every 1000ms
- ⚡ Only processes modified files (incremental)
- ⚠️  Marks changed scopes with dirty embeddings flag

Press Ctrl+C to stop watching.

### Clean slate

To wipe the database and start fresh:

```bash
npm run clean:db  # Removes all data
npm run setup     # Re-ingest everything
```

---


## 🚀 Basic Usage

### 1. Create a client

```typescript
import { createRagClient } from './client.js';

const testcoderag = createRagClient();
```

### 2. Query entities

```typescript
// Find Scope by exact name
const result = await testcoderag.scope()
  .whereName('example')
  .first();

console.log(result?.entity.name);
```

### 3. Use helper methods

```typescript
// Get first result
const first = await testcoderag.scope().whereName('example').first();

// Extract single field
const names = await testcoderag.scope().limit(10).pluck('name');

// Count results
const total = await testcoderag.scope().count();
```

---

## 📦 Understanding Results

**Important**: Query results have a specific structure:

```typescript
{
  entity: {
    // All node properties here
    name: "value",
    name: "example",
    // ... other properties
  },
  score?: number,  // Relevance score (only for semantic/vector search)
  // ... other metadata
}
```

**Always access node properties via `.entity`**:

```typescript
const results = await testcoderag.scope().whereName('example').execute();

// ✅ Correct
console.log(results[0].entity.name);
console.log(results[0].entity.name);

// ❌ Wrong - returns undefined!
console.log(results[0].name);
console.log(results[0].name);
```

For semantic searches, you also get a relevance score:

```typescript
const results = await testcoderag.scope()
  .semanticSearchBySource("your search query")
  .limit(5)
  .execute();

results.forEach(r => {
  console.log(`${r.entity.name}: ${r.score?.toFixed(2)}`);
});
```

---

## 🎯 Common Patterns

Use the patterns module for common queries:

```typescript
import { createCommonPatterns } from './patterns.js';

const patterns = createCommonPatterns(testcoderag);

// Find by prefix
const results = await patterns.findScopeByPrefix('example').execute();

// Find by containing
const results2 = await patterns.findScopeByContaining('text').execute();
```

---

## 📋 Available Entities

### Scope

```typescript
testcoderag.scope()
  .whereName('value')
  .execute();
```

**Available filters:**
- `.whereName({ contains: 'text' })` - Filter by name
- `.whereFile({ contains: 'text' })` - Filter by file
- `.whereSource({ contains: 'text' })` - Filter by source

**Available relationships:**
- `.withDEFINED_IN(depth)` - Expand DEFINED_IN relationship
- `.withCONSUMES(depth)` - Expand CONSUMES relationship
- `.withHAS_PARENT(depth)` - Expand HAS_PARENT relationship
- `.withUSES_LIBRARY(depth)` - Expand USES_LIBRARY relationship
- `.withINHERITS_FROM(depth)` - Expand INHERITS_FROM relationship

---

## 🔍 Query Methods

All query builders support these methods:

### Filtering
- `.where(filter)` - Filter by field values
- `.whereName(value)` - Filter by name (exact or pattern)
- `.limit(n)` - Limit results
- `.offset(n)` - Skip results

### Execution
- `.execute()` - Get all results
- `.first()` - Get first result or undefined
- `.count()` - Count total results
- `.pluck(field)` - Extract single field from all results

### Debugging
- `.debug()` - Show generated Cypher query

---

## 📚 More Examples

Check out the `examples/` directory for more detailed examples:

```bash
npm run examples:01-semantic-search-source
npm run examples:02-relationship-defined_in
npm run examples:07-llm-reranking
npm run examples:09-complex-pipeline
```

> See all examples: `ls examples/` or check `package.json` scripts
```

---

## 🔗 Next Steps

- Read the [Client Reference](./docs/client-reference.md) for complete API documentation
- Explore [Common Patterns](./patterns.ts) for reusable queries
- Check [Agent Reference](./docs/agent-reference.md) for LLM agent integration
