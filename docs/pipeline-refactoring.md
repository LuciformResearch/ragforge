# QueryBuilder Pipeline Refactoring

## Overview

Refactored the QueryBuilder from a fixed execution path into a flexible **operation pipeline** architecture. This enables truly composable RAG queries where operations can be chained in any order.

## What Changed

### Before (❌ Limited Flexibility)
```typescript
// ❌ IMPOSSIBLE: Can't chain two semantic searches
rag.scope()
  .semanticSearchBySignature('...')
  .semanticSearchBySource('...')  // Second overwrites first!

// ❌ IMPOSSIBLE: Can't do semantic AFTER expansion
rag.scope()
  .expand('CALLS')
  .semanticSearchBySource('...')  // Doesn't filter expanded results
```

### After (✅ Full Flexibility)
```typescript
// ✅ WORKS: Progressive semantic refinement
rag.scope()
  .semanticSearchBySignature('neo4j driver', { topK: 50 })
  .semanticSearchBySource('constructor init', { topK: 10 })
  // First finds 50 by signature, then filters those 10 by source

// ✅ WORKS: Semantic after expansion
rag.scope()
  .relatedTo('Neo4jClient', 'IMPORTS', 'incoming')
  .expand('CALLS')
  .semanticSearchBySource('database query', { topK: 5 })
  // Expands relationships THEN semantically filters results

// ✅ WORKS: Complex multi-stage pipelines
rag.scope()
  .semanticSearchBySource('query builder', { topK: 100 })
  .semanticSearchBySignature('async execute', { topK: 30 })
  .expand('CALLS')
  .semanticSearchBySource('neo4j cypher', { topK: 10 })
  .llmRerank(question, llmProvider, { topK: 5 })
```

## Architecture

### Operation Types (`operations.ts`)
```typescript
export type PipelineOperation =
  | FetchOperation      // Initial data retrieval
  | ExpandOperation     // Follow relationships
  | SemanticOperation   // Vector search / filtering
  | LLMRerankOperation  // LLM-based reranking
  | FilterOperation;    // Post-processing filters
```

### Key Innovation: `executeSemantic()`
The critical operation that enables chaining:

```typescript
private async executeSemantic(
  currentResults: SearchResult<T>[],
  operation: SemanticOperation
): Promise<SearchResult<T>[]> {
  // Extract UUIDs from current results for filtering
  const filterUuids = currentResults.length > 0
    ? currentResults.map(r => r.entity.uuid).filter(Boolean)
    : undefined;

  // Perform vector search (with optional UUID filtering)
  const vectorResults = await this.vectorSearch.search(query, {
    indexName: vectorIndex,
    topK: Math.floor(topK),
    minScore,
    filterUuids  // ← Magic! Filter to existing results
  });

  // ... merge scores with previous results
}
```

**How it works:**
1. If `currentResults` is **empty**: Do normal vector search across all data
2. If `currentResults` **exists**: Only search within those specific UUIDs

This enables **progressive refinement** through the pipeline!

### Execution Flow

```typescript
async execute(): Promise<SearchResult<T>[]> {
  // NEW: Pipeline-based execution
  if (this.operations.length > 0) {
    return this.executePipeline();
  }

  // LEGACY: Backward compatibility
  // ... existing code path
}

private async executePipeline(): Promise<SearchResult<T>[]> {
  let currentResults: SearchResult<T>[] = [];

  // Process each operation in sequence
  for (const operation of this.operations) {
    switch (operation.type) {
      case 'fetch':
        currentResults = await this.executeFetch(operation);
        break;
      case 'expand':
        currentResults = await this.executeExpand(currentResults, operation);
        break;
      case 'semantic':
        currentResults = await this.executeSemantic(currentResults, operation);
        break;
      case 'llmRerank':
        currentResults = await this.executeLLMRerank(currentResults, operation);
        break;
      case 'filter':
        currentResults = await this.executeFilter(currentResults, operation);
        break;
    }
  }

  return currentResults;
}
```

## Files Changed

### Core Runtime
- `ragforge/packages/runtime/src/query/operations.ts` (NEW)
  - Operation type definitions for pipeline

- `ragforge/packages/runtime/src/query/query-builder.ts`
  - Added `operations: PipelineOperation[]` field
  - Modified `semantic()`, `expand()`, `llmRerank()` to add operations to pipeline
  - New `executePipeline()` method
  - New executor methods: `executeFetch()`, `executeExpand()`, `executeSemantic()`, `executeLLMRerank()`, `executeFilter()`
  - Kept legacy fields for backward compatibility

- `ragforge/packages/runtime/src/vector/vector-search.ts`
  - Added `filterUuids?: string[]` to `VectorSearchOptions`
  - Modified `search()` to support UUID filtering
  - Fixed topK to always be integer for Neo4j

- `ragforge/packages/runtime/src/reranking/llm-reranker.ts`
  - Added `topK?: number` to `LLMRerankOptions`
  - Implemented topK filtering in `rerank()` method

## Benefits

1. **Composability**: Chain any operations in any order
2. **Progressive Refinement**: Each operation refines previous results
3. **Backward Compatible**: Legacy queries still work
4. **Flexible**: Easy to add new operation types
5. **Clear**: Operation types make query intent explicit

## Use Cases

### 1. Double Semantic Search
```typescript
// Find by signature, then refine by source content
rag.scope()
  .semanticSearchBySignature('auth function', { topK: 50 })
  .semanticSearchBySource('jwt token validation', { topK: 10 })
```

### 2. Expand → Semantic
```typescript
// Find related scopes, then semantically filter
rag.scope()
  .relatedTo('AuthService', 'IMPORTS', 'incoming')
  .expand('CALLS', { depth: 2 })
  .semanticSearchBySource('password hashing', { topK: 10 })
```

### 3. Multi-Stage RAG
```typescript
// Complex pipeline with LLM reranking
rag.scope()
  .semanticSearchBySource('database query', { topK: 100 })  // Broad search
  .expand('CALLS')                                           // Find related
  .semanticSearchBySource('transaction handling', { topK: 30 })  // Refine
  .llmRerank(userQuestion, llm, { topK: 10 })               // LLM picks best
```

## Testing

Created test files:
- `ragforge/examples/test-pipeline-chaining.ts` - Complex chaining scenarios
- `ragforge/examples/test-double-semantic.ts` - Double semantic search focus
- `ragforge/packages/runtime/test-pipeline-direct.ts` - Direct pipeline test

## Next Steps

1. ✅ Pipeline architecture implemented
2. ✅ Semantic filtering with UUID support
3. ✅ Backward compatibility maintained
4. ✅ Tests created
5. ⏳ Update generated clients (optional - they already work via inheritance)
6. ⏳ Add more operation types (e.g., `aggregate`, `deduplicate`)
7. ⏳ Performance optimization for large pipelines

## Technical Notes

### Integer Conversion for Neo4j
Neo4j requires integer values for `LIMIT`. We ensure this in three places:
1. `semantic()` method: `topK: Math.floor(options.topK || 10)`
2. `executeSemantic()`: `topK: Math.floor(topK)`
3. `VectorSearch.search()`: `const topKInt = Math.floor(topK)`

### Score Merging Strategy
When chaining semantic searches, scores are merged using weighted combination:
```typescript
const combinedScore = prevResult.score * 0.3 + semanticScore * 0.7;
```

This gives more weight to the latest semantic score while preserving previous relevance.

### Backward Compatibility
The `execute()` method checks if `operations.length > 0`:
- If yes: Use new pipeline execution
- If no: Use legacy execution path

This ensures existing code continues to work without modification.

---

**Date**: November 3, 2025
**Author**: Claude + Lucie
**Status**: ✅ Complete
