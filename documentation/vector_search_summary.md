# Vector/Semantic Search Architecture in RagForge

## Overview
The RagForge codebase implements a comprehensive vector/semantic search system that integrates:
- **Vertex AI embeddings** for generating vector representations
- **Neo4j vector indexes** for efficient similarity search
- **Dual embeddings** support (search on multiple fields)
- **Query builder API** for fluent semantic search queries
- **Result merging** with traditional filter-based searches
- **Relationship expansion** to augment search results with connected entities

---

## Core Components

### 1. VectorSearch Class
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/vector/vector-search.ts`

**Purpose:** Handles all vector embedding and semantic search operations

**Key Methods:**
- `generateEmbedding(text: string)` - Generate embedding for text using Vertex AI
- `search(query, options)` - Search Neo4j vector index by semantic similarity
- `generateEmbeddings(texts)` - Batch generate embeddings with rate limiting
- `getModelInfo()` - Get embedding model information

**Key Configuration:**
```typescript
- Embedding Model: text-embedding-004 (Vertex AI)
- Vector Dimension: 768
- Provider: Google Vertex AI
- Authentication: GoogleAuth with Cloud Platform scope
```

**How it works:**
1. Initializes GoogleAuth client for Vertex AI
2. Converts text to embeddings using Vertex AI API
3. Queries Neo4j with: `CALL db.index.vector.queryNodes($indexName, $topK, $embedding)`
4. Returns results with similarity scores

---

### 2. Neo4jClient Class
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/client/neo4j-client.ts`

**Purpose:** Low-level Neo4j connection and query execution

**Key Methods (for vector search):**
- `vectorSearch(indexName, embedding, topK)` - Direct vector index query
- `fullTextSearch(indexName, query)` - Full-text search alternative
- `run(cypher, params)` - Execute arbitrary Cypher queries

**Vector Query Implementation:**
```cypher
CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
YIELD node, score
RETURN node, score
ORDER BY score DESC
```

---

### 3. QueryBuilder Class
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/query/query-builder.ts`

**Purpose:** Fluent API for building complex queries combining semantic search, filters, relationships

**Key Methods:**
- `semantic(query, options)` - Add semantic search clause
- `where(filters)` - Add field-based filters
- `expand(relType, options)` - Add relationship expansion
- `execute()` - Execute query and return results

**Execution Flow:**
1. **Semantic Only Path:** Pure vector search (VectorSearch) + optional relationship expansion
2. **Filter + Semantic Path:** Traditional Cypher query + vector results merge
3. **Result Merging:** Combines filter scores (0.3 weight) with semantic scores (0.7 weight)

**Relationship Expansion:**
- Works after semantic search to fetch connected entities
- Supports depth-based traversal
- Uses optional MATCH for efficiency

---

### 4. Type Definitions

**SearchResult<T>**
```typescript
{
  entity: T;                          // The matched entity
  score: number;                      // Overall relevance (0-1)
  scoreBreakdown?: {
    semantic?: number;                // Vector similarity score
    topology?: number;                // Graph structure score
    custom?: Record<string, number>;  // Custom scoring
  };
  context?: {
    related?: RelatedEntity[];        // Related entities from expansion
    snippet?: string;                 // Text highlight
    distance?: number;                // Graph distance
  };
}
```

**VectorSearchOptions**
```typescript
{
  indexName: string;      // Vector index to query
  topK?: number;          // Number of results (default: 10)
  minScore?: number;      // Similarity threshold (default: 0.0)
}
```

**SemanticSearchOptions**
```typescript
{
  vectorIndex?: string;   // Index name for semantic search
  topK?: number;          // Results to return
  threshold?: number;     // Similarity threshold
  minScore?: number;      // Minimum score filter
}
```

---

## Multi-Index Vector Search (Dual Embeddings)

### Configuration
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/examples/lr-coderag-dual-embeddings.yaml`

```yaml
vector_indexes:
  - name: scopeEmbeddingsSignature
    field: embedding_signature
    source_field: signature          # Index on function signatures
    dimension: 768
    similarity: cosine
    provider: vertex
    model: text-embedding-004

  - name: scopeEmbeddingsSource
    field: embedding_source
    source_field: source             # Index on source code
    dimension: 768
    similarity: cosine
    provider: vertex
    model: text-embedding-004
```

### Generated API Methods
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/examples/generated-dual-client/queries/scope.ts`

```typescript
// Search by signature (API/interface)
semanticSearchBySignature(query: string, options?: { topK?: number; minScore?: number }): this

// Search by source code (implementation)
semanticSearchBySource(query: string, options?: { topK?: number; minScore?: number }): this
```

**Usage Example:**
```typescript
const results = await rag.scope()
  .semanticSearchBySignature('function that takes a path and returns void', { topK: 5 })
  .execute();
```

---

## Search Execution Paths

### Path 1: Pure Semantic Search
```
Query.semantic() -> No filters/relationships
  ↓
VectorSearch.search()
  ├── Generate query embedding (Vertex AI)
  ├── Query Neo4j vector index
  ├── Parse results
  └── Return with semantic scores
```

### Path 2: Filter + Semantic Merge
```
Query.where() + Query.semantic()
  ├─ Traditional Cypher query (filters)
  └─ VectorSearch.search() (semantic)
      ↓
  Merge results:
    - Calculate composite score: filter*0.3 + semantic*0.7
    - Combine scoreBreakdown
    - Return merged results
```

### Path 3: Semantic + Relationship Expansion
```
Query.semantic() -> Query.expand()
  ├── VectorSearch.search()
  └── For each result:
      └── Query relationships (CONSUMES, CONSUMED_BY, etc.)
          └── Fetch and attach related entities
```

---

## Key Functions & Classes Summary

| Name | Location | Purpose | Importance |
|------|----------|---------|-----------|
| **VectorSearch** | `/ragforge/packages/runtime/src/vector/vector-search.ts` | Main semantic search class | Core - handles embeddings and vector queries |
| **generateEmbedding()** | VectorSearch | Creates 768-dim vectors from text | Critical - converts text to searchable format |
| **search()** | VectorSearch | Queries Neo4j vector index | Critical - executes similarity search |
| **generateEmbeddings()** | VectorSearch | Batch embedding with rate limiting | Important - efficient bulk operations |
| **QueryBuilder.semantic()** | QueryBuilder | Fluent API for semantic queries | Important - user-facing query API |
| **QueryBuilder.applySemanticSearch()** | QueryBuilder | Executes VectorSearch + merges results | Critical - orchestrates search flow |
| **mergeResults()** | QueryBuilder | Combines filter & vector scores | Important - implements scoring strategy |
| **expandRelationshipsForResults()** | QueryBuilder | Fetches related entities post-search | Important - enriches results with context |
| **Neo4jClient.vectorSearch()** | Neo4jClient | Low-level vector index query | Important - direct index access |
| **Neo4jClient.run()** | Neo4jClient | Execute Cypher with vector ops | Important - underlying query execution |

---

## Scoring System

### Semantic Score
- **Source:** Vector similarity from `db.index.vector.queryNodes()`
- **Range:** 0-1 (typically 0.7-1.0 for good matches)
- **Calculation:** Cosine similarity between query and document embeddings

### Composite Score (when filters + semantic combined)
```
final_score = filter_score * 0.3 + semantic_score * 0.7
```
- Weights semantic search higher (0.7) as it's more meaningful
- Weights filter matching lower (0.3) as it's binary
- Allows results matching both signals to rank highest

### Score Breakdown
```typescript
scoreBreakdown: {
  semantic: 0.92,        // Vector similarity
  filter: 0.50,          // Field filter match (if applied)
  'code-quality': 0.15   // Reranking boost (future)
}
```

---

## Embedding Model Details

**Model:** `text-embedding-004` (Vertex AI)
- **Dimension:** 768
- **Provider:** Google Cloud Vertex AI
- **Similarity Metric:** Cosine similarity
- **Authentication:** GoogleAuth with `cloud-platform` and `generative-language.retriever` scopes

**Rate Limiting:**
- Sequential embedding generation with 100ms delays
- TODO: Implement batch API when available

---

## Test Coverage

| Test File | Purpose |
|-----------|---------|
| `test-vector-search-direct.ts` | Direct VectorSearch module testing (embedding + search) |
| `test-dual-semantic-search.ts` | Dual index search (signature vs source) + relationship expansion |
| `test-simplified-semantic-search.ts` | Semantic search on related scopes (single-line API) |
| `test-semantic-with-relationships.ts` | Usage documentation (semantic + relationship expansion) |

---

## Configuration & Setup

### Vector Index Declaration
```yaml
vector_indexes:
  - name: scopeEmbeddingsSignature
    field: embedding_signature
    source_field: signature
    dimension: 768
    similarity: cosine
    provider: vertex
    model: text-embedding-004
```

### Runtime Configuration
```typescript
const rag = createClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password',
    database: 'neo4j'
  }
});
```

### Environment Requirements
- `NEO4J_URI` - Neo4j database connection
- `NEO4J_USER` - Neo4j username
- `NEO4J_PASSWORD` - Neo4j password
- Google Cloud authentication for Vertex AI

---

## Data Flow Diagram

```
User Query (text)
    ↓
QueryBuilder.semantic(query, options)
    ↓
VectorSearch.generateEmbedding(query)
    ├─→ GoogleAuth client
    └─→ Vertex AI API (text-embedding-004)
        ↓
        Returns: 768-dim vector
    ↓
VectorSearch.search()
    ↓
Neo4jClient.run(CALL db.index.vector.queryNodes(...))
    ↓
    Returns: nodes with similarity scores
    ↓
Parse VectorSearchResult[]
    ├─→ nodeId, score, properties
    └─→ Optional: expand relationships
        ↓
        For each result:
            Neo4jClient.run(relationship expansion query)
            ↓
            Fetch related entities
    ↓
SearchResult<T>[]
    ├─→ entity, score, scoreBreakdown, context
    └─→ Return to user
```

---

## Important Implementation Details

1. **Vector Index Querying:**
   - Uses Neo4j's native vector index: `db.index.vector.queryNodes()`
   - Requires index to already exist in Neo4j
   - Filters by minScore for relevance thresholding

2. **Authentication:**
   - Uses `GoogleAuth` library for automatic token management
   - Scopes: `cloud-platform`, `generative-language.retriever`
   - Tokens cached for efficiency

3. **Batch Operations:**
   - Batch embedding with sequential calls (100ms delay per request)
   - TODO: Implement batch API when available from Vertex AI

4. **Result Merging Strategy:**
   - Matches results by UUID or name
   - Uses composite scoring to blend filter and semantic signals
   - Penalizes filter results not in vector search results

5. **Relationship Expansion:**
   - Performed post-search for efficiency
   - Uses OPTIONAL MATCH for flexibility
   - Supports variable depth traversal

---

## Known Limitations & TODOs

1. **Batch Embeddings:** Currently sequential, batch API not yet implemented
2. **Reranking:** Placeholder implementation, strategies not fully implemented
3. **Rate Limiting:** Fixed 100ms delay, could be optimized
4. **Error Handling:** Basic error messages, could be more granular
5. **Caching:** No caching of embeddings (could improve performance)

