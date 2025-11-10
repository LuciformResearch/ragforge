# test-code-rag RAG Client - Agent Reference

Simplified reference for LLM agent usage.

## ⭐ Custom Methods

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
  .semantic('query', { topK: 10 })
  .execute();

results.forEach(r => {
  console.log(r.entity.name);          // Scope name
  console.log(r.entity.source);        // source
  console.log(r.score);                // Relevance score
});
```

## 📚 Entity Reference

### Scope (268 nodes)
**Usage:** `rag.scope()`

**Available Fields:**
- `source: string`

**Key Filters:**
- `whereSource(value)`

## 🎨 Pipeline Patterns

### Pattern 1: Broad → Narrow (Recommended)
Start with high topK, progressively filter and rerank:
```typescript
```

### Pattern 2: Known Entry → Expand
Start with exact match, explore relationships:
```typescript
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

## Best Practices

- Start broad with semantic search (topK: 50-100), then filter or rerank to top 5-10
- Use `.llmRerank()` for complex reasoning queries
- Chain operations: semantic → filter → llmRerank → expand
- Use `.executeWithMetadata()` to debug pipeline performance
