# Vector Search - Code Reference Guide

## File Locations

All vector search related files are located in:

```
/home/luciedefraiteur/LR_CodeRag/ragforge/
├── packages/
│   └── runtime/
│       └── src/
│           ├── vector/
│           │   └── vector-search.ts          [Core VectorSearch class]
│           ├── client/
│           │   └── neo4j-client.ts           [Neo4j connection & vector queries]
│           ├── query/
│           │   └── query-builder.ts          [QueryBuilder with semantic methods]
│           └── types/
│               ├── result.ts                 [SearchResult, VectorSearchResult types]
│               ├── query.ts                  [SemanticSearchOptions type]
│               ├── config.ts                 [EmbeddingsConfig type]
│               └── index.ts                  [Type exports]
└── examples/
    ├── test-vector-search-direct.ts         [VectorSearch direct usage]
    ├── test-dual-semantic-search.ts         [Multi-index semantic search]
    ├── test-simplified-semantic-search.ts   [Semantic search on related scopes]
    └── lr-coderag-dual-embeddings.yaml      [Configuration with vector indexes]
```

---

## Core Implementation - VectorSearch

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/vector/vector-search.ts`

### Interfaces

```typescript
export interface VectorSearchOptions {
  /** Vector index name to query */
  indexName: string;
  /** Number of results to return */
  topK?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
}

export interface VectorSearchResult {
  nodeId: string;
  score: number;
  properties: Record<string, any>;
}
```

### VectorSearch Class Structure

```typescript
export class VectorSearch {
  private authClient: any;
  private embeddingModel: string;

  constructor(
    private neo4jClient: Neo4jClient,
    options: { embeddingModel?: string } = {}
  ) {
    this.embeddingModel = options.embeddingModel || 'text-embedding-004';
  }

  // Initialize Google Auth client
  private async getAuthClient()

  // Generate embedding for text using Vertex AI
  async generateEmbedding(text: string): Promise<number[]>

  // Search Neo4j vector index
  async search(
    query: string,
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]>

  // Batch generate embeddings for multiple texts
  async generateEmbeddings(texts: string[]): Promise<number[][]>

  // Get embedding model info
  getModelInfo()
}
```

### Key Method: generateEmbedding()

```typescript
async generateEmbedding(text: string): Promise<number[]> {
  const client = await this.getAuthClient();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.embeddingModel)}:embedContent`;

  try {
    const response = await client.request({
      url,
      method: 'POST',
      data: {
        content: {
          role: 'user',
          parts: [{ text }]
        }
      }
    });

    const embedding = response?.data?.embedding?.values;

    if (!Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from Vertex AI');
    }

    return embedding;
  } catch (error: any) {
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}
```

**What it does:**
1. Gets authenticated Google client
2. Makes POST request to Vertex AI embedding endpoint
3. Sends text in Generative API format
4. Returns 768-dimensional vector

### Key Method: search()

```typescript
async search(
  query: string,
  options: VectorSearchOptions
): Promise<VectorSearchResult[]> {
  const {
    indexName,
    topK = 10,
    minScore = 0.0
  } = options;

  // 1. Generate embedding for query
  const queryEmbedding = await this.generateEmbedding(query);

  // 2. Query Neo4j vector index
  const cypher = `
    CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
    YIELD node, score
    WHERE score >= $minScore
    RETURN elementId(node) AS nodeId, score, node
    ORDER BY score DESC
  `;

  const result = await this.neo4jClient.run(cypher, {
    indexName,
    topK,
    embedding: queryEmbedding,
    minScore
  });

  // 3. Parse results
  return result.records.map(record => ({
    nodeId: record.get('nodeId'),
    score: record.get('score'),
    properties: record.get('node').properties
  }));
}
```

**Execution Flow:**
1. Generates embedding for the input query text
2. Queries Neo4j's vector index using the embedding
3. Filters results by minScore threshold
4. Orders by semantic similarity (highest first)
5. Returns parsed results with scores

### Batch Operations: generateEmbeddings()

```typescript
async generateEmbeddings(texts: string[]): Promise<number[][]> {
  // TODO: Implement batch API if available, for now do sequential
  const embeddings: number[][] = [];

  for (const text of texts) {
    const embedding = await this.generateEmbedding(text);
    embeddings.push(embedding);

    // Rate limiting - wait a bit between requests
    if (texts.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return embeddings;
}
```

---

## QueryBuilder Integration

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/query/query-builder.ts`

### VectorSearch Integration in Constructor

```typescript
export class QueryBuilder<T = any> {
  private filters: Record<string, FilterValue<any>> = {};
  private semanticQuery?: { text: string; options: SemanticSearchOptions };
  private expansions: Array<{ relType: string; options: ExpandOptions }> = [];
  private vectorSearch: VectorSearch;

  constructor(
    protected client: Neo4jClient,
    protected entityType: string
  ) {
    this.vectorSearch = new VectorSearch(client);
  }
```

### Semantic Search API Method

```typescript
/**
 * Semantic search by text
 *
 * @example
 * query.semantic('authentication code', { topK: 20, vectorIndex: 'scopeEmbeddings' })
 */
semantic(query: string, options: SemanticSearchOptions = {}): this {
  this.semanticQuery = { text: query, options };
  return this;
}
```

### Execute() Method - Path Selection

```typescript
async execute(): Promise<SearchResult<T>[]> {
  let results: SearchResult<T>[] = [];

  // 1. Determine execution path
  const hasFieldFilters = Object.keys(this.filters).length > 0;
  const hasStructuralFilters = this.uuidFilter || this.relatedToFilter;
  const hasSemanticOnly = this.semanticQuery && !hasFieldFilters && !hasStructuralFilters;

  if (hasSemanticOnly) {
    // Pure semantic search (with optional expansions)
    results = await this.applySemanticSearch([]);

    // Handle relationship expansion after semantic search
    if (this.expansions.length > 0) {
      results = await this.expandRelationshipsForResults(results);
    }
  } else {
    // Traditional Cypher query (with optional semantic enhancement)
    const cypherQuery = this.buildCypher();
    const rawResult = await this.client.run(cypherQuery.query, cypherQuery.params);
    results = this.parseResults(rawResult.records);

    // Apply semantic search if specified (merge with filter results)
    if (this.semanticQuery) {
      results = await this.applySemanticSearch(results);
    }
  }

  // 2. Apply reranking strategies
  for (const strategy of this.rerankStrategies) {
    results = await this.applyReranking(results, strategy);
  }

  // 3. Sort by score (descending)
  results.sort((a, b) => b.score - a.score);

  // 4. Apply offset and limit
  return results.slice(this._offset, this._offset + this._limit);
}
```

### Core Method: applySemanticSearch()

```typescript
private async applySemanticSearch(
  results: SearchResult<T>[]
): Promise<SearchResult<T>[]> {
  if (!this.semanticQuery) {
    return results;
  }

  const { text, options } = this.semanticQuery;
  const indexName = options.vectorIndex;

  if (!indexName) {
    console.warn('Semantic search requires vectorIndex option');
    return results;
  }

  try {
    // Perform vector search
    const vectorResults = await this.vectorSearch.search(text, {
      indexName,
      topK: options.topK || 20,
      minScore: options.minScore || 0.0
    });

    // If we have filter results, merge them with vector results
    if (results.length > 0) {
      return this.mergeResults(results, vectorResults);
    }

    // Otherwise, use vector results directly
    return vectorResults.map(vr => ({
      entity: vr.properties as T,
      score: vr.score,
      scoreBreakdown: {
        semantic: vr.score
      },
      context: undefined
    }));
  } catch (error: any) {
    console.error('Semantic search failed:', error.message);
    return results;
  }
}
```

### Result Merging Strategy

```typescript
private mergeResults(
  filterResults: SearchResult<T>[],
  vectorResults: any[]
): SearchResult<T>[] {
  // Create a map of vector scores by node properties
  const vectorScoreMap = new Map<string, number>();

  for (const vr of vectorResults) {
    // Use UUID or name as key for matching
    const key = vr.properties.uuid || vr.properties.name || vr.nodeId;
    vectorScoreMap.set(key, vr.score);
  }

  // Enhance filter results with vector scores
  return filterResults.map(result => {
    const key = (result.entity as any).uuid || (result.entity as any).name;
    const vectorScore = vectorScoreMap.get(key);

    if (vectorScore !== undefined) {
      // Combine scores: filter 30%, semantic 70%
      return {
        ...result,
        score: result.score * 0.3 + vectorScore * 0.7,
        scoreBreakdown: {
          ...result.scoreBreakdown,
          filter: result.score,
          semantic: vectorScore
        }
      };
    }

    // No vector match, lower the score
    return {
      ...result,
      score: result.score * 0.3,
      scoreBreakdown: {
        ...result.scoreBreakdown,
        filter: result.score,
        semantic: 0
      }
    };
  });
}
```

### Relationship Expansion

```typescript
private async expandRelationshipsForResults(
  results: SearchResult<T>[]
): Promise<SearchResult<T>[]> {
  // For each result, fetch its relationships
  const expandedResults = await Promise.all(
    results.map(async (result) => {
      const uuid = (result.entity as any).uuid;

      if (!uuid) {
        return result;
      }

      // Build relationship query
      let cypher = `MATCH (n:\`${this.entityType}\` {uuid: $uuid})`;

      for (let i = 0; i < this.expansions.length; i++) {
        const { relType, options } = this.expansions[i];
        const depth = options.depth || 1;
        const varName = `related_${i}`;

        cypher += `\nOPTIONAL MATCH (n)-[:${relType}*1..${depth}]->(${varName})`;

        const withItems = ['n'];
        for (let j = 0; j < i; j++) {
          withItems.push(`related_${j}_list`);
        }
        withItems.push(`collect(DISTINCT ${varName}) AS ${varName}_list`);

        cypher += `\nWITH ${withItems.join(', ')}`;
      }

      cypher += `\nRETURN n`;

      for (let i = 0; i < this.expansions.length; i++) {
        cypher += `, related_${i}_list`;
      }

      const relResult = await this.client.run(cypher, { uuid });

      if (relResult.records.length > 0) {
        const record = relResult.records[0];
        const related = this.parseRelatedEntities(record);

        return {
          ...result,
          context: related.length > 0 ? { related } : result.context
        };
      }

      return result;
    })
  );

  return expandedResults;
}
```

---

## Type Definitions

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/types/result.ts`

```typescript
export interface SearchResult<T = any> {
  /** The entity that matched */
  entity: T;

  /** Overall relevance score (0-1) */
  score: number;

  /** Score breakdown by strategy */
  scoreBreakdown?: {
    semantic?: number;
    topology?: number;
    custom?: Record<string, number>;
  };

  /** Additional context */
  context?: {
    /** Related entities (if expand was used) */
    related?: RelatedEntity[];

    /** Text snippet highlighting match */
    snippet?: string;

    /** Graph distance from query origin */
    distance?: number;
  };
}

export interface RelatedEntity {
  entity: any;
  relationshipType: string;
  direction: 'outgoing' | 'incoming';
  distance: number;
}

export interface VectorSearchResult {
  node: any;
  score: number;
}
```

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/types/query.ts`

```typescript
export interface SemanticSearchOptions {
  topK?: number;
  vectorIndex?: string;
  threshold?: number;
  minScore?: number;
}

export interface ExpandOptions {
  depth?: number;
  direction?: 'outgoing' | 'incoming' | 'both';
}
```

---

## Neo4jClient Vector Methods

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/client/neo4j-client.ts`

### Vector Search Method

```typescript
/**
 * Vector similarity search
 */
async vectorSearch(
  indexName: string,
  embedding: number[],
  topK: number = 10
): Promise<VectorSearchResult[]> {
  const cypher = `
    CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
    YIELD node, score
    RETURN node, score
    ORDER BY score DESC
  `;

  const result = await this.run(cypher, {
    indexName,
    topK,
    embedding
  });

  return result.records.map(record => ({
    node: record.get('node').properties,
    score: record.get('score')
  }));
}
```

### Full-Text Search Alternative

```typescript
/**
 * Full-text search
 */
async fullTextSearch(
  indexName: string,
  query: string,
  options: { limit?: number } = {}
): Promise<any[]> {
  const cypher = `
    CALL db.index.fulltext.queryNodes($indexName, $query)
    YIELD node, score
    RETURN node, score
    ORDER BY score DESC
    LIMIT $limit
  `;

  const result = await this.run(cypher, {
    indexName,
    query,
    limit: options.limit || 10
  });

  return result.records.map(record => ({
    node: record.get('node').properties,
    score: record.get('score')
  }));
}
```

---

## Generated Client Example

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/examples/generated-dual-client/queries/scope.ts`

### Generated Semantic Search Methods

```typescript
/**
 * Semantic search using scopeEmbeddingsSignature
 * Searches by signature embeddings
 */
semanticSearchBySignature(query: string, options?: { topK?: number; minScore?: number }): this {
  return this.semantic(query, {
    ...options,
    vectorIndex: 'scopeEmbeddingsSignature'
  });
}

/**
 * Semantic search using scopeEmbeddingsSource
 * Searches by source embeddings
 */
semanticSearchBySource(query: string, options?: { topK?: number; minScore?: number }): this {
  return this.semantic(query, {
    ...options,
    vectorIndex: 'scopeEmbeddingsSource'
  });
}
```

### Relationship Expansion Methods

```typescript
/**
 * Include related entities via CONSUMES
 * Scope CONSUMES Scope
 */
withConsumes(depth: number = 1): this {
  return this.expand('CONSUMES', { depth });
}

/**
 * Include related entities via CONSUMED_BY
 * Scope CONSUMED_BY Scope
 */
withConsumedBy(depth: number = 1): this {
  return this.expand('CONSUMED_BY', { depth });
}
```

---

## Usage Examples

### Example 1: Direct VectorSearch

```typescript
import { VectorSearch } from '@ragforge/runtime';
import { Neo4jClient } from '@ragforge/runtime';

const neo4jClient = new Neo4jClient({
  uri: 'bolt://localhost:7687',
  username: 'neo4j',
  password: 'password'
});

const vectorSearch = new VectorSearch(neo4jClient);

// Generate embedding
const embedding = await vectorSearch.generateEmbedding(
  'function that takes a path and returns void'
);

// Search vector index
const results = await vectorSearch.search(
  'function that takes a path and returns void',
  {
    indexName: 'scopeEmbeddingsSignature',
    topK: 5,
    minScore: 0.0
  }
);

console.log(`Found ${results.length} results`);
results.forEach(r => {
  console.log(`${r.properties.name} (score: ${r.score.toFixed(3)})`);
});
```

### Example 2: QueryBuilder Semantic Search

```typescript
const rag = createClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password'
  }
});

// Pure semantic search
const results = await rag.scope()
  .semantic('environment configuration', { 
    vectorIndex: 'scopeEmbeddingsSource',
    topK: 10
  })
  .limit(5)
  .execute();

// Semantic search with relationship expansion
const resultsWithContext = await rag.scope()
  .semantic('file system utilities', {
    vectorIndex: 'scopeEmbeddingsSource',
    topK: 10
  })
  .expand('CONSUMES', { depth: 1 })
  .expand('CONSUMED_BY', { depth: 1 })
  .limit(3)
  .execute();

resultsWithContext.forEach(result => {
  console.log(result.entity.name);
  if (result.context?.related) {
    result.context.related.forEach(rel => {
      console.log(`  -> ${rel.entity.name} (${rel.relationshipType})`);
    });
  }
});
```

### Example 3: Generated Client API

```typescript
// Filter + Semantic Search
const results = await rag.scope()
  .whereType('function')
  .semanticSearchBySource('dotenv configuration', { topK: 20 })
  .limit(10)
  .execute();

// Semantic search on related scopes
const consumers = await rag.scope()
  .whereConsumesScope('loadEnvironment')
  .semanticSearchBySource('configuration and setup code', { topK: 50 })
  .limit(5)
  .execute();

// Dual index comparison
const [bySignature, bySource] = await Promise.all([
  rag.scope()
    .semanticSearchBySignature('parse TypeScript file', { topK: 3 })
    .execute(),
  rag.scope()
    .semanticSearchBySource('parse TypeScript file', { topK: 3 })
    .execute()
]);
```

---

## Configuration Files

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/examples/lr-coderag-dual-embeddings.yaml`

```yaml
name: lr-coderag
version: 2.0.0
description: Generated RAG framework for code with dual embeddings

neo4j:
  uri: ${NEO4J_URI}
  database: neo4j
  username: ${NEO4J_USER}
  password: ${NEO4J_PASSWORD}

entities:
  - name: Scope
    description: Code scope with dual embeddings (signature + source)
    
    vector_indexes:
      - name: scopeEmbeddingsSignature
        field: embedding_signature
        source_field: signature
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

---

## Key Implementation Notes

1. **Embedding Generation**: Uses Vertex AI `text-embedding-004` model exclusively
2. **Vector Dimension**: Fixed at 768 dimensions for all embeddings
3. **Similarity Metric**: Cosine similarity used for all vector indexes
4. **Query Pattern**: `CALL db.index.vector.queryNodes()` for Neo4j vector operations
5. **Score Range**: 0-1, where 1.0 is perfect similarity
6. **Result Merging**: Filter results weighted at 0.3, semantic at 0.7
7. **Batch Processing**: Sequential with 100ms delays (TODO: batch API)
8. **Authentication**: GoogleAuth with automatic token management

