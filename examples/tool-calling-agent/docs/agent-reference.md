# packages RAG Client - Agent Reference

Simplified reference for LLM agent usage.

## ⭐ Custom Methods

### Semantic Search

- **`scope().semanticSearchBySource(query, { topK?, minScore? })`**

### Relationships

- **`scope().whereFileName(targetName)`** - Filter scopes defined in the provided file
- **`scope().withDefinedIn(depth?)`** - Expand DEFINED_IN relationships
- **`scope().whereConsumesScope(targetName)`** - Filter scopes that consume the provided scope
- **`scope().whereConsumedByScope(targetName)`** - Filter scopes consumed by the provided scope
- **`scope().withConsumes(depth?)`** - Expand CONSUMES relationships
- **`scope().whereParentScope(targetName)`** - Filter scopes with the provided parent scope
- **`scope().withHasParent(depth?)`** - Expand HAS_PARENT relationships
- **`scope().whereUsesLibrary(targetName)`** - Filter scopes that use the provided library
- **`scope().withUsesLibrary(depth?)`** - Expand USES_LIBRARY relationships
- **`scope().whereInheritsFrom(targetName)`** - Filter scopes that inherit from the provided scope
- **`scope().withInheritsFrom(depth?)`** - Expand INHERITS_FROM relationships

### Advanced

- **`.llmRerank(question, { topK?, minScore? })`** - Rerank results using LLM reasoning
- **`.executeWithMetadata()`** - Get pipeline execution details

## 🔧 Core Query Methods

Available on ALL entity builders:

### Filtering
- **`.where(filter: EntityFilter)`** - Complex filter with AND/OR logic
- **`.limit(n: number)`** - Limit results to n items
- **`.offset(n: number)`** - Skip first n items
- **`.orderBy(field: string, direction: 'asc' | 'desc')`** - Sort results

### Relationship Expansion
- **`.expand(relType: string, { depth?, direction? })`** - Generic relationship traversal
- **`.withXxx(depth?: number)`** - Expand specific relationships (auto-generated)

### Execution
- **`.execute()`** - Execute query and return SearchResult[]
- **`.executeWithMetadata()`** - Execute with detailed pipeline information

## 📦 Result Structure

All queries return `SearchResult<T>[]`:

```typescript
interface SearchResult<T> {
  entity: T;              // The entity object
  score: number;          // Relevance score (0-1)
  scoreBreakdown?: {
    semantic?: number;    // Semantic similarity score
    llm?: number;         // LLM reranking score
    llmReasoning?: string; // Why this result is relevant
  };
  context?: {
    related?: RelatedEntity[]; // Connected nodes from withXxx() expansion
  };
}

interface RelatedEntity {
  entity: T;
  relationshipType: string;  // e.g., "CONSUMES", "DEFINED_IN"
  depth: number;             // How many hops away
}
```

**Accessing results:**
```typescript
const results = await rag.scope()
  .semanticSearchBySource('query', { topK: 10 })
  .withDefinedIn(1)
  .execute();

results.forEach(r => {
  console.log(r.entity.name);          // Scope name
  console.log(r.entity.name);        // name
  console.log(r.score);                // Relevance score

  // Access related entities from expansion
  const related = r.context?.related?.filter(rel =>
    rel.relationshipType === 'DEFINED_IN'
  );
});
```

## 📚 Entity Reference

### Scope (1191 nodes)
**Usage:** `rag.scope()`

**Available Fields:**
- `name: string`
- `file: string`
- `source: string`

**Key Filters:**
- `whereName(value)`
- `whereFile(value)`
- `whereSource(value)`
- `semanticSearchBySource(query, options)` - Search by source
- `withDefinedIn(depth?)` - Expand DEFINED_IN relationships
- `withConsumes(depth?)` - Expand CONSUMES relationships
- `withHasParent(depth?)` - Expand HAS_PARENT relationships

## 🎨 Pipeline Patterns

### Pattern 1: Broad → Narrow (Recommended)
Start with high topK, progressively filter and rerank:
```typescript
await rag.scope()
  .semanticSearchBySource('query', { topK: 100 })  // Cast wide net
  .whereName('value')      // Focus
  .llmRerank('specific question', { topK: 10 })  // Quality
  .withDefinedIn(1)                            // Context
  .execute();
```

### Pattern 2: Known Entry → Expand
Start with exact match, explore relationships:
```typescript
// Find specific entity
await rag.scope().whereName('TargetName').execute();

// Map relationships
await rag.scope()
  .whereName('TargetName')
  .withDefinedIn(2)  // Get DEFINED_IN (2 levels)
  .withConsumes(1)  // Get CONSUMES (1 level)
  .execute();
```

### Decision Guidelines

**When to stop:**
- ✅ Found 5-10 high-quality results (score > 0.8)
- ✅ Results directly answer the question
- ✅ Expanding more yields diminishing returns

**When to continue:**
- 🔄 Results on-topic but incomplete
- 🔄 Scores mediocre (0.5-0.7) - try different query
- 🔄 Only 1-2 results - query too narrow

**When to pivot:**
- 🔀 No results → Broaden query or use relationships
- 🔀 Too many (>50) → Add filters or llmRerank
- 🔀 Wrong results → Different query or entity type

## 📚 Generated Examples

### Semantic search by source
*Find code scopes by semantic similarity to source*

```typescript
console.log('🔎 Semantic search for: "function printRootHelp..."');
  const results = await rag.scope()
    .semanticSearchBySource('function printRootHelp...', { topK: 50 })
    .execute();

  console.log(`\nFound ${results.length} results:`);
  results.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name + ' (score: ' + r.score.toFixed(3) + ')');
  });
  if (results.length > 5) {
    console.log(`  ... and ${results.length - 5} more`);
  }}

export { semanticSearchBySource };
  // ... (14 more lines)
```

### Filter and expand by DEFINED_IN
*Find code scopes related through DEFINED_IN*

```typescript
console.log('🔍 Filtering by DEFINED_IN relationship...');
  const filtered = await rag.scope()
    .whereFileName('structured-llm-executor.ts')
    .execute();

  console.log(`\nFound ${filtered.length} items with DEFINED_IN relationship:`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (filtered.length > 5) {
    console.log(`  ... and ${filtered.length - 5} more`);
  }

  console.log('\n🔗 Expanding relationships from "CodeSourceAdapter"...');
  // ... (29 more lines)
```

### Filter and expand by CONSUMES
*Find code scopes related through CONSUMES*

```typescript
console.log('🔍 Filtering by CONSUMES relationship...');
  const filtered = await rag.scope()
    .whereConsumesScope('AddRelationshipConfig')
    .execute();

  console.log(`\nFound ${filtered.length} items with CONSUMES relationship:`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (filtered.length > 5) {
    console.log(`  ... and ${filtered.length - 5} more`);
  }

  console.log('\n🔗 Expanding relationships from "CodeSourceAdapter"...');
  // ... (29 more lines)
```

### Filter and expand by HAS_PARENT
*Find code scopes related through HAS_PARENT*

```typescript
console.log('🔍 Filtering by HAS_PARENT relationship...');
  const filtered = await rag.scope()
    .whereParentScope('CodeGenerator')
    .execute();

  console.log(`\nFound ${filtered.length} items with HAS_PARENT relationship:`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (filtered.length > 5) {
    console.log(`  ... and ${filtered.length - 5} more`);
  }

  console.log('\n🔗 Expanding relationships from "discoverFiles"...');
  // ... (29 more lines)
```

### Filter and expand by USES_LIBRARY
*Find code scopes related through USES_LIBRARY*

```typescript
console.log('🔍 Filtering by USES_LIBRARY relationship...');
  const filtered = await rag.scope()
    .whereUsesLibrary('path')
    .execute();

  console.log(`\nFound ${filtered.length} items with USES_LIBRARY relationship:`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (filtered.length > 5) {
    console.log(`  ... and ${filtered.length - 5} more`);
  }

  console.log('\n🔗 Expanding relationships from "CodeSourceAdapter"...');
  // ... (29 more lines)
```

### Filter and expand by INHERITS_FROM
*Find code scopes related through INHERITS_FROM*

```typescript
console.log('🔍 Filtering by INHERITS_FROM relationship...');
  const filtered = await rag.scope()
    .whereInheritsFrom('AddRelationshipConfig')
    .execute();

  console.log(`\nFound ${filtered.length} items with INHERITS_FROM relationship:`);
  filtered.slice(0, 5).forEach(r => {
    const entity = r.entity as any;
    console.log('  - ' + entity.name);
  });
  if (filtered.length > 5) {
    console.log(`  ... and ${filtered.length - 5} more`);
  }

  console.log('\n🔗 Expanding relationships from "CodeSourceAdapter"...');
  // ... (29 more lines)
```

### LLM reranking for better relevance
*Find most relevant code scopes using AI reasoning*

```typescript
console.log('🔎 Semantic search: "function printRootHelp..."');
  console.log('🤖 Then reranking with LLM: "find the most relevant code scopes around this semantic search: function printRootHelp(): void {..."');

  // NOTE: llmRerank() can be used after ANY operation that returns results.
  // In this example, we use it after .semanticSearchBySource(), but you can also use it after:
  //   - Filters: .whereFileName(), .whereName(), .whereFile()
  //   - Relationships: .withDefinedIn(), .withConsumes()
  //   - Or even directly without prior operations
  const results = await rag.scope()
    .semanticSearchBySource('function printRootHelp...', { topK: 50 })
    .llmRerank('find the most relevant code scopes around this semantic search: function printRootHelp(): void {...', {
      topK: 10,
      minScore: 0.7
    })
    .execute();
  // ... (32 more lines)
```

### Pipeline metadata and observability
*Debug and optimize query pipelines*

```typescript
const { results, metadata } = await rag.scope()
    .semanticSearchBySource('function printRootHelp...', { topK: 50 })
    .llmRerank('find code scopes related to: function printRootHelp...', { topK: 10 })
    .executeWithMetadata();

  console.log(`Pipeline executed in ${metadata.totalDuration}ms`);
  console.log(`Final result count: ${metadata.finalCount}`);

  metadata.operations.forEach((op, idx) => {
    console.log(`\n[${idx + 1}] ${op.type.toUpperCase()}`);
    console.log(`  Duration: ${op.duration}ms`);
    console.log(`  Results: ${op.inputCount} → ${op.outputCount}`);

    if (op.type === 'semantic' && op.metadata) {
      console.log(`  Index: ${op.metadata.vectorIndex}`);
  // ... (24 more lines)
```

### Complex multi-stage pipeline
*Build sophisticated queries with multiple operations*

```typescript
// Multi-stage pipeline:
  // 1. Semantic search (broad)
  // 2. Filter (focus)
  // 3. LLM rerank (quality)
  // 4. Expand relationships (complete context)
  // 5. Track metadata (observe)
  const { results, metadata } = await rag.scope()
    .semanticSearchBySource('function printRootHelp...', { topK: 100 })
    .whereFileName('index.ts')
    .llmRerank('find the most relevant code scopes', { topK: 20 })
    .withDefinedIn(1)
    .executeWithMetadata();

  console.log(`\n🎯 Pipeline Results`);
  console.log(`Total time: ${metadata.totalDuration}ms`);
  // ... (30 more lines)
```

### Conditional search strategy
*Demonstrate decision-making based on result count and quality*

```typescript
// Initial broad search
  let results = await rag.scope()
    .semanticSearchBySource('query', { topK: 50 })
    .execute();

  console.log(`Found ${results.length} initial results`);

  // Decision 1: Too few results? Broaden query
  if (results.length < 5) {
    console.log('Too few results, broadening query...');
    results = await rag.scope()
      .semanticSearchBySource('broader query terms', { topK: 50 })
      .execute();
  }

  // ... (32 more lines)
```

### Breadth-first context exploration
*Map local context by exploring 1-hop relationships*

```typescript
// Find entry point
  const entry = await rag.scope()
    .whereName('CodeSourceAdapter')
    .execute();

  if (entry.length === 0) {
    console.log('Entry point not found');  }

  // Breadth-first: Get immediate neighborhood
  const context = await rag.scope()
    .whereName('CodeSourceAdapter')
    .withDefinedIn(1)
    .withConsumes(1)
    .withHasParent(1)
    .execute();
  // ... (24 more lines)
```

### Stopping criteria logic
*Show decision logic for iterative search with quality thresholds*

```typescript
const MAX_ITERATIONS = 3;
  const TARGET_RESULTS = 5;
  const MIN_SCORE = 0.8;

  let allResults: any[] = [];
  let iteration = 0;
  let shouldContinue = true;

  while (shouldContinue && iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\nIteration ${iteration}`);

    // Progressive search strategy
    const query = iteration === 1 ? 'initial query' : 'refined query';

  // ... (40 more lines)
```

### CRUD operations with mutations
*mutation, crud, create, update, delete, relationships*

```typescript
console.log('📚 Testing CRUD mutations\n');

  // 1. Create a new scope
  console.log('1️⃣ Creating a new scope...');
  const newScope: ScopeCreate = {
    uuid: 'scope-test-001',
    name: 'Sample name 1',
    file: 'Sample file 2',
    source: 'Sample source 3'
  };

  const createdScope = await rag.scopeMutations().create(newScope);
  console.log('✅ Scope created:', createdScope);
  console.log();

  // ... (48 more lines)
```

### Batch mutations
*mutation, batch, createBatch, performance, transaction*

```typescript
console.log('📦 Testing batch mutations\n');

  // 1. Create multiple Scope entities in batch
  console.log('1️⃣ Creating multiple scope entities in batch...');
  const newScopes: ScopeCreate[] = [
    {
      uuid: 'scope-batch-001',
      name: 'Sample Scope 1 name',
      file: 'Sample Scope 1 file'
    },
    {
      uuid: 'scope-batch-002',
      name: 'Sample Scope 2 name',
      file: 'Sample Scope 2 file'
    },
  // ... (41 more lines)
```

## Best Practices

- Start broad with semantic search (topK: 50-100), then filter or rerank to top 5-10
- Use `.llmRerank()` for complex reasoning queries
- Chain operations: semantic → filter → llmRerank → expand
- Use `.executeWithMetadata()` to debug pipeline performance
