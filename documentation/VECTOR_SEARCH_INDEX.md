# Vector Search in RagForge - Complete Index

This document provides a comprehensive overview of all vector/semantic search functionality in the RagForge codebase.

## Quick Navigation

- [Core Implementation](#core-implementation)
- [Key Components](#key-components)
- [Usage Patterns](#usage-patterns)
- [Configuration](#configuration)
- [Type System](#type-system)
- [File Structure](#file-structure)
- [Performance Guide](#performance-guide)

---

## Core Implementation

### VectorSearch Class (Most Important)
**Location:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/vector/vector-search.ts`

**Why Important:** Core class that handles all vector embedding and semantic search operations.

**Key Methods:**
1. `generateEmbedding(text: string): Promise<number[]>` - Creates 768-dim embeddings via Vertex AI
2. `search(query, options): Promise<VectorSearchResult[]>` - Executes semantic similarity search on Neo4j vector index
3. `generateEmbeddings(texts): Promise<number[][]>` - Batch embedding generation with rate limiting
4. `getModelInfo()` - Returns embedding model info (768 dimensions, Vertex AI provider)

**Key Properties:**
- `embeddingModel`: 'text-embedding-004' (Vertex AI)
- `neo4jClient`: Reference to Neo4j connection
- `authClient`: GoogleAuth client for API access

**Critical Implementation Details:**
- Uses Google Vertex AI API endpoint: `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent`
- Queries Neo4j vector index using: `CALL db.index.vector.queryNodes($indexName, $topK, $embedding)`
- Authentication: GoogleAuth with 'cloud-platform' and 'generative-language.retriever' scopes
- Returns cosine similarity scores (0-1 range)

---

## Key Components

### 1. VectorSearch
**File:** `/ragforge/packages/runtime/src/vector/vector-search.ts` (157 lines)

Standalone vector search class. Used by QueryBuilder internally, but can also be used directly.

```typescript
// Direct usage example
const vectorSearch = new VectorSearch(neo4jClient);
const embedding = await vectorSearch.generateEmbedding('text');
const results = await vectorSearch.search('query', {
  indexName: 'scopeEmbeddings',
  topK: 10,
  minScore: 0.7
});
```

### 2. QueryBuilder
**File:** `/ragforge/packages/runtime/src/query/query-builder.ts` (590 lines)

High-level fluent API that integrates VectorSearch with traditional Cypher querying.

**Key Methods:**
- `semantic(query, options)` - Add semantic search
- `where(filters)` - Add field filters
- `expand(relType, options)` - Add relationship expansion
- `execute()` - Run the query with auto-detection of execution path

**Internal Methods (Important for Understanding):**
- `applySemanticSearch()` - Calls VectorSearch and merges with filter results
- `mergeResults()` - Combines filter scores (0.3) with semantic scores (0.7)
- `expandRelationshipsForResults()` - Fetches related entities post-search

### 3. Neo4jClient
**File:** `/ragforge/packages/runtime/src/client/neo4j-client.ts` (210 lines)

Low-level database access. Executes Cypher queries with vector operations.

**Vector-related Methods:**
- `vectorSearch(indexName, embedding, topK)` - Direct vector index query
- `fullTextSearch(indexName, query)` - Alternative full-text search
- `run(cypher, params)` - Execute any Cypher query

### 4. Type Definitions

**SearchResult<T>** - Final result returned to user
```typescript
interface SearchResult<T> {
  entity: T;                          // The matched entity
  score: number;                      // Overall relevance (0-1)
  scoreBreakdown?: {
    semantic?: number;                // Vector similarity
    filter?: number;                  // Field match score
    custom?: Record<string, number>;
  };
  context?: {
    related?: RelatedEntity[];        // Related entities from expand()
    snippet?: string;                 // Text highlight (optional)
    distance?: number;                // Graph distance (optional)
  };
}
```

**VectorSearchOptions** - Options for vector search
```typescript
interface VectorSearchOptions {
  indexName: string;      // Which vector index to query
  topK?: number;          // How many results (default 10)
  minScore?: number;      // Similarity threshold (default 0.0)
}
```

**SemanticSearchOptions** - Options for semantic search in QueryBuilder
```typescript
interface SemanticSearchOptions {
  vectorIndex?: string;   // Required: index name
  topK?: number;          // Results to fetch
  minScore?: number;      // Similarity threshold
  threshold?: number;     // Alternative threshold
}
```

---

## Usage Patterns

### Pattern 1: Direct VectorSearch Usage

```typescript
import { VectorSearch, Neo4jClient } from '@ragforge/runtime';

const neo4j = new Neo4jClient({ uri, username, password });
const vectorSearch = new VectorSearch(neo4j);

// Step 1: Generate embedding
const embedding = await vectorSearch.generateEmbedding('find auth functions');

// Step 2: Search vector index
const results = await vectorSearch.search('find auth functions', {
  indexName: 'scopeEmbeddingsSignature',
  topK: 5,
  minScore: 0.0
});

// Results: VectorSearchResult[]
results.forEach(r => {
  console.log(`${r.properties.name}: ${r.score}`);
});
```

### Pattern 2: QueryBuilder Semantic Search

```typescript
import { createClient } from '@ragforge/runtime';

const rag = createClient({ neo4j: {...} });

// Pure semantic search
const results = await rag.scope()
  .semantic('environment variables', {
    vectorIndex: 'scopeEmbeddingsSource',
    topK: 10
  })
  .limit(5)
  .execute();
```

### Pattern 3: Filter + Semantic Merge

```typescript
const results = await rag.scope()
  .where({ type: 'function' })           // Filter by type
  .semantic('authentication', {           // Score by semantics
    vectorIndex: 'scopeEmbeddings',
    topK: 20
  })
  .limit(10)
  .execute();

// Scores: 30% filter + 70% semantic combined
results.forEach(r => {
  console.log(`${r.entity.name}: ${r.score.toFixed(3)}`);
  console.log(`  Filter: ${r.scoreBreakdown.filter}`);
  console.log(`  Semantic: ${r.scoreBreakdown.semantic}`);
});
```

### Pattern 4: Semantic + Relationship Expansion

```typescript
const results = await rag.scope()
  .semantic('configuration', {
    vectorIndex: 'scopeEmbeddingsSource',
    topK: 10
  })
  .expand('CONSUMES', { depth: 1 })      // Fetch dependencies
  .expand('CONSUMED_BY', { depth: 1 })   // Fetch consumers
  .limit(3)
  .execute();

results.forEach(r => {
  console.log(`${r.entity.name}`);
  if (r.context?.related) {
    r.context.related.forEach(rel => {
      console.log(`  -> ${rel.entity.name} (${rel.relationshipType})`);
    });
  }
});
```

### Pattern 5: Dual Embeddings (Generated Client)

```typescript
import { createRagClient } from './generated-dual-client';

const rag = createRagClient({ neo4j: {...} });

// Search by function signature
const bySignature = await rag.scope()
  .semanticSearchBySignature('takes path returns void', { topK: 5 })
  .execute();

// Search by source code
const bySource = await rag.scope()
  .semanticSearchBySource('dotenv configuration', { topK: 5 })
  .execute();

// Compare results
console.log('Signature matches:', bySignature.length);
console.log('Source matches:', bySource.length);
```

---

## Configuration

### Neo4j Setup (Prerequisites)

1. **Vector indexes must exist in Neo4j**
   ```
   CALL db.index.vector.createNodeIndex(
     'scopeEmbeddings',
     ['Scope'],
     'embedding',
     768,
     'COSINE'
   )
   ```

2. **Vector fields must be populated on nodes**
   - Fields match `field` property in vector_indexes config
   - Must contain 768-dim number arrays
   - Generated/updated externally (not by RagForge)

### RagForge Configuration

**File:** `/ragforge/examples/lr-coderag-dual-embeddings.yaml`

```yaml
entities:
  - name: Scope
    vector_indexes:
      - name: scopeEmbeddingsSignature
        field: embedding_signature        # Node field name
        source_field: signature           # Source for embedding
        dimension: 768
        similarity: cosine
        provider: vertex
        model: text-embedding-004

      - name: scopeEmbeddingsSource
        field: embedding_source
        source_field: source
        dimension: 768
        similarity: cosine
        provider: vertex
        model: text-embedding-004
```

### Runtime Configuration

```typescript
import { createClient } from '@ragforge/runtime';

const rag = createClient({
  neo4j: {
    uri: process.env.NEO4J_URI,           // bolt://localhost:7687
    username: process.env.NEO4J_USER,     // neo4j
    password: process.env.NEO4J_PASSWORD, // password
    database: 'neo4j',                    // Optional
    maxConnectionPoolSize: 50,            // Optional
    connectionTimeout: 30000              // Optional
  },
  embeddings: {                            // Optional
    provider: 'vertex',
    model: 'text-embedding-004'
  }
});
```

### Environment Requirements

```bash
# Neo4j
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=password

# Google Cloud (for Vertex AI)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
# OR
gcloud auth application-default login
```

---

## Type System

### SearchResult (User-Facing Output)
```typescript
SearchResult<T> {
  entity: T;                              // Matched entity
  score: number;                          // 0-1 relevance
  scoreBreakdown?: {
    semantic?: number;                    // Vector similarity
    filter?: number;                      // Field match
    topology?: number;                    // Graph structure
    custom?: Record<string, number>;      // Custom scores
  };
  context?: {
    related?: RelatedEntity[];            // Connected entities
    snippet?: string;                     // Text excerpt
    distance?: number;                    // Graph distance
  };
}
```

### VectorSearchResult (Internal Format)
```typescript
VectorSearchResult {
  nodeId: string;                         // Neo4j node ID
  score: number;                          // 0-1 similarity
  properties: Record<string, any>;        // Node properties
}
```

### RelatedEntity (Expansion Results)
```typescript
RelatedEntity {
  entity: any;                            // The related entity
  relationshipType: string;               // e.g., 'CONSUMES'
  direction: 'outgoing' | 'incoming';     // Direction of rel
  distance: number;                       // Hops from source
}
```

---

## File Structure

### Source Files (Implementation)
```
/ragforge/packages/runtime/src/
├── vector/
│   └── vector-search.ts (157 lines)
│       Main VectorSearch class
│
├── client/
│   └── neo4j-client.ts (210 lines)
│       Neo4j connection & query execution
│
├── query/
│   └── query-builder.ts (590 lines)
│       QueryBuilder with semantic/filter/expand API
│
└── types/
    ├── result.ts (51 lines)
    │   SearchResult, VectorSearchResult types
    ├── query.ts (48 lines)
    │   SemanticSearchOptions, ExpandOptions
    ├── config.ts (39 lines)
    │   EmbeddingsConfig, RerankingConfig
    └── index.ts (8 lines)
        Type re-exports
```

### Test Files (Examples & Usage)
```
/ragforge/examples/
├── test-vector-search-direct.ts
│   Direct VectorSearch usage (embedding + search)
│
├── test-dual-semantic-search.ts
│   Multi-index search (signature vs source) with expand
│
├── test-simplified-semantic-search.ts
│   Semantic search on related scopes (high-level API)
│
├── test-semantic-with-relationships.ts
│   Documentation of intended usage patterns
│
├── generated-dual-client/
│   ├── queries/scope.ts (120 lines)
│   │   Generated query builder with semantic methods
│   ├── types.ts
│   │   Generated TypeScript type definitions
│   └── index.ts
│       Generated client factory
│
└── lr-coderag-dual-embeddings.yaml
    Configuration with dual vector indexes
```

### Generated Code Files
```
/ragforge/packages/core/src/generator/
├── code-generator.ts (400+ lines)
│   Generates semanticSearchByX() methods for each vector index
│   Generates withRelationship() expansion methods
│   Creates strongly-typed query builders
│
├── type-generator.ts
│   Generates TypeScript types from entity definitions
│
└── config-generator.ts
    Generates configuration files
```

---

## Performance Guide

### Latency Profile

| Operation | Typical Time | Bottleneck |
|-----------|--------------|-----------|
| Parse query | 1ms | N/A |
| Generate embedding | 200-500ms | Vertex AI API latency |
| Query vector index | 50-200ms | Network to Neo4j |
| Parse results | 1-10ms | Result size |
| Expand relationships | 50-500ms/result | Parallel Neo4j queries |
| Merge scores | 1-10ms | Result count |
| Sort & limit | <1ms | N/A |
| **Total (pure semantic)** | **300-700ms** | **Embedding generation** |
| **Total (semantic + expand)** | **600-1200ms** | **Relationship queries** |

### Optimization Recommendations

1. **Caching**
   - Cache embeddings for frequently searched queries
   - Re-use embeddings from previous searches

2. **Batch Operations**
   - TODO: Implement Vertex AI batch embedding API (currently sequential)
   - Currently: 100ms delay between requests

3. **Index Tuning**
   - Ensure vector indexes created on most-searched fields
   - Keep topK parameter reasonable (10-50)
   - Use minScore to filter low-relevance results

4. **Connection Pooling**
   - maxConnectionPoolSize: 50 (configurable)
   - Already optimized for concurrent requests

5. **Relationship Expansion**
   - Currently parallelized with Promise.all()
   - Limit depth parameter to avoid large expansions
   - Use expand() selectively

### Scoring Weights

```
Filter + Semantic Composite Score:
  final = (filterScore * 0.3) + (semanticScore * 0.7)

Rationale:
  • Semantic: More nuanced (0-1 continuous)
  • Filter: Binary (match/no-match)
  • Higher weight on semantic signal
  • Filter narrows scope
```

---

## Key Implementation Decisions

### 1. Embedding Model
- **Model:** text-embedding-004 (Vertex AI)
- **Dimension:** 768
- **Provider:** Google Cloud Vertex AI
- **Why:** State-of-the-art, no local inference required, managed service

### 2. Similarity Metric
- **Metric:** Cosine similarity (Neo4j native)
- **Score Range:** [0, 1]
- **Why:** Standard for semantic search, efficient in Neo4j

### 3. Multi-Index Support
- **Dual Embeddings:** Signature + Source code
- **Why:** Different aspects of code benefit from different embeddings
- **Example:** Function signature search finds API matches, source search finds implementation matches

### 4. Result Merging Strategy
- **Semantic Weight:** 70%
- **Filter Weight:** 30%
- **Why:** Semantic is more meaningful for relevance

### 5. Relationship Expansion
- **When:** Post-search (after vector index query)
- **Why:** Efficiency - only expand results you care about
- **Method:** OPTIONAL MATCH for flexibility

### 6. Authentication
- **Method:** GoogleAuth with automatic token management
- **Scopes:** cloud-platform, generative-language.retriever
- **Caching:** Auth client cached to avoid repeated initialization

---

## Known Limitations & TODOs

| Item | Status | Impact | Workaround |
|------|--------|--------|-----------|
| Batch embeddings | TODO | Slower bulk operations | Use sequential API for now |
| Embedding caching | TODO | Higher latency for repeated queries | Cache at app level |
| Reranking strategies | Placeholder | Not functional | Manually rerank if needed |
| Error messages | Basic | Hard to debug | Check logs for Vertex AI/Neo4j errors |
| Custom scoring | Limited | Can't implement custom algorithms | Contribute to reranking module |

---

## Testing & Examples

### Test Files Overview

| File | Purpose | Use Case |
|------|---------|----------|
| `test-vector-search-direct.ts` | VectorSearch direct usage | Learn VectorSearch API |
| `test-dual-semantic-search.ts` | Multi-index + relationship expansion | Real-world example |
| `test-simplified-semantic-search.ts` | High-level generated client API | User-facing API |
| `test-semantic-with-relationships.ts` | Usage documentation | Integration patterns |

### Running Tests

```bash
# Direct vector search test
npx ts-node examples/test-vector-search-direct.ts

# Dual semantic search test
npx ts-node examples/test-dual-semantic-search.ts

# Simplified API test
npx ts-node examples/test-simplified-semantic-search.ts
```

---

## Troubleshooting

### Common Issues

**Problem:** "Invalid embedding response from Vertex AI"
- Check: Google Cloud credentials are valid
- Check: GOOGLE_APPLICATION_CREDENTIALS env var is set
- Check: Vertex AI enabled in Cloud project

**Problem:** "No such index: scopeEmbeddings"
- Check: Vector index created in Neo4j with CALL db.index.vector.createNodeIndex()
- Check: Index name matches vectorIndex parameter in config
- Check: Index name matches database (not in memory DB)

**Problem:** "Semantic search requires vectorIndex option"
- Check: VectorIndex passed to semantic() or generated method
- Check: Index name is correct and exists in Neo4j

**Problem:** "Vector embedding has 0 elements"
- Check: Text input is not empty
- Check: Vertex AI API response contains valid embedding
- Check: Vector dimension matches (should be 768)

---

## Integration Checklist

- [ ] Neo4j instance running and accessible
- [ ] Vector indexes created on relevant entities
- [ ] Vector embedding fields populated on nodes
- [ ] Google Cloud project created
- [ ] Vertex AI API enabled
- [ ] Service account with credentials file
- [ ] GOOGLE_APPLICATION_CREDENTIALS env var set
- [ ] NEO4J_* env vars configured
- [ ] @ragforge/runtime package installed
- [ ] Generated client code created from config
- [ ] Tests passing locally
- [ ] Query latencies acceptable for use case

---

## Related Documentation

- VectorSearch Architecture: See vector_search_architecture.md
- Code Reference: See vector_search_code_reference.md
- Configuration Guide: See lr-coderag-dual-embeddings.yaml
- API Documentation: See @ragforge/runtime package.json exports

---

## Quick Reference Commands

### Test Embedding Generation
```typescript
const vs = new VectorSearch(neo4j);
const emb = await vs.generateEmbedding('test text');
console.log(emb.length); // Should be 768
```

### Test Vector Search
```typescript
const results = await vs.search('test query', {
  indexName: 'scopeEmbeddings',
  topK: 5
});
console.log(results.length, results[0].score);
```

### Test QueryBuilder Semantic
```typescript
const results = await rag.scope()
  .semantic('query text', { vectorIndex: 'scopeEmbeddings' })
  .execute();
```

### Generate Embeddings Batch
```typescript
const texts = ['text1', 'text2', 'text3'];
const embeddings = await vs.generateEmbeddings(texts);
console.log(embeddings.length); // 3
```

