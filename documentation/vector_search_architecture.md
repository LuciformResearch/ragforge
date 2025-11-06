# Vector Search Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Application                            │
│                                                                  │
│  const results = await rag.scope()                              │
│    .semanticSearchBySource('environment config', { topK: 5 })   │
│    .withConsumes(1)                                             │
│    .execute()                                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         v                               v
   ┌─────────────────┐          ┌──────────────────┐
   │ @ragforge/      │          │ Generated Client │
   │ runtime         │          │ (code-generated) │
   │                 │          │                  │
   │ createClient()  │          │ ScopeQuery       │
   │ QueryBuilder    │          │ (extends         │
   │ VectorSearch    │          │  QueryBuilder)   │
   │ Neo4jClient     │          └────────┬─────────┘
   └────────┬────────┘                   │
            │                            │
            │   Fluent API               │
            │   ├─ semantic()            │
            │   ├─ where()               │
            │   ├─ expand()              │
            │   └─ execute()             │
            │                            │
            └────────────┬───────────────┘
                         │
                         v
                  ┌──────────────────────────────────────────┐
                  │   QueryBuilder.execute()                 │
                  │                                          │
                  │  Determines execution path:              │
                  │  • Pure semantic search                  │
                  │  • Filter + semantic merge               │
                  │  • Semantic + relationship expansion     │
                  └────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        v                  v                  v
    [Path 1]          [Path 2]            [Path 3]
  Semantic-Only     Filter+Semantic    Semantic+Expand
```

---

## Core Search Flow

### Path 1: Pure Semantic Search

```
User Input: "environment configuration"
        │
        v
QueryBuilder.semantic(query, {
  vectorIndex: 'scopeEmbeddingsSource',
  topK: 10
})
        │
        v
execute() → hasSemanticOnly = true
        │
        v
VectorSearch.search(query, options)
        │
        ├─→ generateEmbedding(query)
        │       │
        │       v
        │   GoogleAuth.getClient()
        │       │
        │       v
        │   POST /v1beta/models/text-embedding-004:embedContent
        │       │
        │       v
        │   Returns: 768-dim vector [0.123, -0.456, ...]
        │
        ├─→ Neo4jClient.run(CALL db.index.vector.queryNodes(...))
        │       │
        │       v
        │   Neo4j Vector Index Query
        │       │
        │       v
        │   Returns: nodes with cosine similarity scores
        │
        └─→ Parse VectorSearchResult[]
                │
                v
        Optional: expandRelationshipsForResults()
                │
                v
        SearchResult<T>[]
        {
          entity: { name, type, file, ... },
          score: 0.92,
          scoreBreakdown: { semantic: 0.92 },
          context: { related: [...] }  // if expanded
        }
```

### Path 2: Filter + Semantic Merge

```
User Input: where({ type: 'function' })
            semantic('dotenv')

        │
        v
QueryBuilder.execute()
        │
        ├─→ Traditional Cypher Query
        │   MATCH (n:Scope)
        │   WHERE n.type = 'function'
        │   RETURN n
        │   │
        │   v
        │   filterResults = [scope1, scope2, scope3]
        │
        ├─→ VectorSearch.search('dotenv', ...)
        │   │
        │   v
        │   vectorResults = [
        │     { nodeId, score: 0.95, properties: {} },
        │     { nodeId, score: 0.87, properties: {} },
        │     { nodeId, score: 0.73, properties: {} }
        │   ]
        │
        └─→ mergeResults(filterResults, vectorResults)
                │
                v
            For each filterResult:
                Find matching vectorScore
                │
                v
            finalScore = filterScore * 0.3 + vectorScore * 0.7
                │
                v
            scoreBreakdown = {
              filter: 1.0,
              semantic: 0.95
            }
                │
                v
            Combined SearchResult[]
```

### Path 3: Semantic + Relationship Expansion

```
User Input: semantic(query)
            expand('CONSUMES', { depth: 1 })
            expand('CONSUMED_BY', { depth: 1 })

        │
        v
execute() → applySemanticSearch()
        │
        v
VectorSearch.search() → [scope1, scope2, scope3]
        │
        v
expandRelationshipsForResults()
        │
        ├─ For scope1:
        │  MATCH (n:Scope {uuid: uuid1})
        │  OPTIONAL MATCH (n)-[:CONSUMES*1..1]->(related_0)
        │  OPTIONAL MATCH (n)-[:CONSUMED_BY*1..1]->(related_1)
        │  RETURN n, related_0_list, related_1_list
        │  │
        │  v
        │  Fetch and attach:
        │  context: {
        │    related: [
        │      { entity: {...}, relationshipType: 'CONSUMES', ... },
        │      { entity: {...}, relationshipType: 'CONSUMED_BY', ... }
        │    ]
        │  }
        │
        ├─ For scope2: [similar process]
        │
        └─ For scope3: [similar process]
                │
                v
        SearchResult[] with populated context.related
```

---

## VectorSearch Class Internal Flow

```
┌──────────────────────────────────────────────────────────┐
│              VectorSearch Class                          │
│                                                          │
│  Properties:                                            │
│  • authClient: GoogleAuth (cached)                      │
│  • embeddingModel: 'text-embedding-004'                 │
│  • neo4jClient: Neo4jClient reference                   │
└──────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        v               v               v
   ┌─────────────┐ ┌──────────┐ ┌──────────────┐
   │ getAuth     │ │generate  │ │ search()     │
   │ Client()    │ │Embedding │ │              │
   │             │ │()        │ │              │
   │ GoogleAuth  │ │          │ │ Orchestrates │
   │ w/ scopes   │ │POST to   │ │ full flow    │
   │             │ │Vertex AI │ │              │
   │ Token mgmt  │ │          │ │              │
   │             │ │768-dim   │ │              │
   │             │ │vector    │ │              │
   └─────────────┘ └──────────┘ └──────────────┘
        │               │               │
        └───────────────┬───────────────┘
                        │
                        v
        ┌───────────────────────────────┐
        │ Query Neo4j Vector Index      │
        │                               │
        │ CALL db.index.vector.         │
        │   queryNodes(                 │
        │     $indexName,               │
        │     $topK,                    │
        │     $embedding                │
        │   )                           │
        │ YIELD node, score             │
        │ WHERE score >= $minScore      │
        │ RETURN elementId(node),       │
        │        score, node            │
        │ ORDER BY score DESC           │
        └───────────┬───────────────────┘
                    │
                    v
        ┌───────────────────────────────┐
        │ Parse Results                 │
        │                               │
        │ VectorSearchResult[] {        │
        │   nodeId: string,             │
        │   score: number,              │
        │   properties: object          │
        │ }                             │
        └───────────────────────────────┘
```

---

## Query Execution Decision Tree

```
                    execute()
                        │
                        v
        ┌───────────────────────────────┐
        │ Analyze query builder state   │
        └───────────────────┬───────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
    hasFieldFilters  hasStructuralFilters  hasSemanticOnly
         │                  │                  │
         v                  v                  v
      filters?           UUID/Rel?        Semantic only?
        yes                yes              yes
         │                  │                │
         └──────────┬───────┴────────┬───────┘
                    │                │
              hasSemanticOnly = false │ hasSemanticOnly = true
                    │                │
                    v                v
            Traditional Path    Pure Semantic Path
                    │                │
                    ├─┐              ├─ VectorSearch.search()
                    │ └─ MATCH       │
                    │   WHERE        ├─ Optional:
                    │   Return       │   expandRelationships()
                    │   │            │
                    ├─ Parse         └─ Sort by score
                    │   results      └─ Limit/offset
                    │   │            └─ Return results
                    └─ If semantic:
                       mergeResults()
                        │
                    Sort & Limit
                        │
                    Return results
```

---

## Scoring System

### Semantic Score (Vector Similarity)

```
Query Text → generateEmbedding() → Query Vector [768 dims]
                                        │
                                        v
                        Neo4j Vector Index
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
              Document1            Document2            Document3
              Vector[768]           Vector[768]         Vector[768]
                    │                   │                   │
                    v                   v                   v
             Cosine Similarity   Cosine Similarity   Cosine Similarity
                    │                   │                   │
                    v                   v                   v
                 0.95               0.87                0.73
             (excellent)          (good)              (fair)

Score Range: [0.0 - 1.0]
  • 1.0 = Perfect semantic match
  • 0.7 - 1.0 = Good semantic match
  • 0.5 - 0.7 = Moderate match
  • < 0.5 = Poor match (usually filtered)
```

### Composite Score (Filter + Semantic)

```
Filter Score (binary)     Semantic Score (0-1)
     1.0                        0.95
      │                          │
      v                          v
  Matches         +         Vector Similarity
  criteria                   Score
      │                          │
      └────┬─────────────────────┘
           v
    30% weight       70% weight
    0.3 * 1.0   +    0.7 * 0.95
      │                  │
      └────┬─────────────┘
           v
        0.30 + 0.665 = 0.965

Final Score: 0.965
  
scoreBreakdown = {
  filter: 1.0,      // Passed filter criteria
  semantic: 0.95,   // Vector similarity
  'custom': 0.0     // Optional custom scoring
}

Weighting Strategy:
  • Filters are binary (match/no-match)
  • Semantic is more nuanced (0-1 range)
  • Semantic weighted 70% as more meaningful
  • Filter weighted 30% to narrow scope
```

---

## Data Types Flow

```
User Query String
    │
    v
VectorSearchOptions {
  indexName: string,
  topK: number,
  minScore: number
}
    │
    v
generateEmbedding() returns: number[] (768 elements)
    │
    v
Neo4j Query Parameters {
  indexName: string,
  topK: number,
  embedding: number[],
  minScore: number
}
    │
    v
Neo4j returns: QueryResult
    │
    v
VectorSearchResult[] {
  nodeId: string,
  score: number (0-1),
  properties: Record<string, any>
}
    │
    v
SearchResult<T>[] {
  entity: T,
  score: number (0-1),
  scoreBreakdown?: {
    semantic?: number,
    topology?: number,
    custom?: Record<string, number>
  },
  context?: {
    related?: RelatedEntity[],
    snippet?: string,
    distance?: number
  }
}
```

---

## Multi-Index Architecture (Dual Embeddings)

```
┌─────────────────────────────────────────────────────────────┐
│                  Scope Entity                               │
│                                                             │
│  name: string                                              │
│  type: string                                              │
│  signature: string        ─────┐                           │
│  source: string           ─────┤                           │
│  file: string                  │                           │
│  uuid: string                  │                           │
│  embedding_signature: number[] │                           │
│  embedding_source: number[]    │                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                v                             v
         ┌─────────────────┐         ┌─────────────────┐
         │ Vector Index 1  │         │ Vector Index 2  │
         │                 │         │                 │
         │ scopeEmbeddings │         │ scopeEmbeddings │
         │ Signature       │         │ Source          │
         │                 │         │                 │
         │ Indexed on:     │         │ Indexed on:     │
         │ signature       │         │ source code     │
         │ 768 dimensions  │         │ 768 dimensions  │
         │ Cosine sim      │         │ Cosine sim      │
         └────────┬────────┘         └────────┬────────┘
                  │                           │
                  v                           v
    semanticSearchBySignature()  semanticSearchBySource()
    
    Query: "function takes      Query: "dotenv config"
           path returns void"   
                  │                           │
                  v                           v
         Find functions by            Find functions by
         their API signature           their implementation


Example Usage:
  // Same entity, different indexes
  const [sig, src] = await Promise.all([
    rag.scope()
      .semanticSearchBySignature('parse file', { topK: 5 })
      .execute(),
    rag.scope()
      .semanticSearchBySource('parse file', { topK: 5 })
      .execute()
  ]);

Results may differ because:
  • Signature search focuses on function interface
  • Source search focuses on implementation details
```

---

## Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│                @ragforge/runtime Package                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            QueryBuilder                              │  │
│  │  (fluent API, combines filters + semantic)           │  │
│  │                                                      │  │
│  │  • where()                                           │  │
│  │  • semantic()                                        │  │
│  │  • expand()                                          │  │
│  │  • execute()                                         │  │
│  │  • applySemanticSearch()                             │  │
│  │  • mergeResults()                                    │  │
│  │  • expandRelationshipsForResults()                   │  │
│  └────────┬──────────────────────────────────────────────┘  │
│           │                                                 │
│           └─────────┬──────────────────┬──────────────────┐ │
│                     │                  │                  │ │
│           ┌─────────v────────┐  ┌──────v────────┐  ┌─────v────────┐ │
│           │ VectorSearch     │  │ Neo4jClient    │  │ Types        │ │
│           │                  │  │                │  │ (SearchResult,│ │
│           │ • getAuthClient()│  │ • run()        │  │  VectorSearch│ │
│           │ • generate       │  │ • vectorSearch │  │  Options)    │ │
│           │   Embedding()    │  │ • fullText     │  │              │ │
│           │ • search()       │  │   Search()     │  │              │ │
│           │ • generate       │  │ • transaction()│  │              │ │
│           │   Embeddings()   │  │ • explain()    │  │              │ │
│           │ • getModelInfo() │  │                │  │              │ │
│           └────────┬─────────┘  └────────┬───────┘  └──────────────┘ │
│                    │                     │                            │
│                    └──────────┬──────────┘                            │
│                               │                                      │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
                v                               v
        ┌─────────────────┐          ┌──────────────────┐
        │  Vertex AI API  │          │  Neo4j Database  │
        │                 │          │                  │
        │  text-embedding │          │ Vector Indexes   │
        │  -004 model     │          │ (pre-existing)   │
        │                 │          │                  │
        │ POST /v1beta/   │          │ CALL db.index.   │
        │   models/...:   │          │ vector.queryNodes│
        │   embedContent  │          │                  │
        └─────────────────┘          └──────────────────┘
```

---

## Performance Considerations

### Query Latency Breakdown

```
User Query
    │
    ├─ Parse query builder state: ~1ms
    │
    ├─ Generate embedding: ~200-500ms
    │  (Includes: GoogleAuth token, HTTP request to Vertex AI)
    │
    ├─ Query Neo4j vector index: ~50-200ms
    │  (Depends on: topK value, index size, network)
    │
    ├─ Parse results: ~1-10ms
    │  (Depends on: topK, result object sizes)
    │
    ├─ Relationship expansion: ~50-500ms per result
    │  (Parallel: queries executed in parallel)
    │
    ├─ Result merging: ~1-10ms
    │  (Depends on: result count)
    │
    └─ Sort & limit: <1ms
    
Total: ~300ms - 1.2s (typical range)
  • Bottleneck: Embedding generation (Google Vertex AI latency)
  • Second bottleneck: Relationship expansion (if enabled)
  • Neo4j queries: Usually <200ms with proper indexing
```

### Optimization Opportunities

```
1. Embedding Caching
   • Cache generated embeddings
   • Avoid regenerating for same query text
   
2. Batch Embeddings
   • TODO: Implement Vertex AI batch API
   • Currently: Sequential with 100ms delays
   
3. Connection Pooling
   • Neo4jClient already supports pool sizing
   • Max pool: 50 connections (configurable)
   
4. Query Optimization
   • Vector index must be created in Neo4j
   • topK parameter limits returned results
   • minScore filters low-relevance results
   
5. Relationship Expansion Batching
   • Currently: Parallel Promise.all()
   • Already optimized for concurrent requests
```

---

## Error Handling Flow

```
VectorSearch.search(query, options)
    │
    └─ Try:
       ├─ generateEmbedding()
       │  │
       │  └─ Catch: "Failed to generate embedding: {error.message}"
       │     Return: throw Error
       │
       ├─ Neo4jClient.run(cypher)
       │  │
       │  └─ Catch: Database connection error
       │     Return: throw Error
       │
       └─ Parse results
          │
          └─ Catch: Missing/invalid response data
             Return: Empty array or throw Error

QueryBuilder.applySemanticSearch()
    │
    └─ Try:
       ├─ Check: vectorIndex specified?
       │  └─ No: console.warn(), return original results
       │
       ├─ Call: VectorSearch.search()
       │
       └─ Catch: VectorSearch error
          Return: console.error(), return original results
          (Gracefully falls back to filter-only results)

Result Handling:
  • Vector search failures → gracefully fall back
  • Missing vectorIndex → warning logged, original results used
  • Invalid embeddings → error thrown, operation fails
  • Neo4j connection errors → propagated to caller
```

