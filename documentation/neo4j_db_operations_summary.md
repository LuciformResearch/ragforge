# Neo4j Database Operations - Comprehensive Reference

## Overview
The codebase contains two primary Neo4j client implementations and a comprehensive query building system with semantic search capabilities. The main components are organized in:
- `/ragforge/packages/runtime/` - Main runtime library
- `/src/lib/neo4j/` - Legacy client implementation
- `/ragforge/packages/core/` - Schema introspection and code generation

---

## 1. NEO4J CONNECTION & CLIENT SETUP

### 1.1 Neo4jClient (Primary - Runtime)
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/client/neo4j-client.ts`

**Class:** `Neo4jClient`

**Purpose:** 
Main client for managing Neo4j connections, executing queries, and handling transactions with support for vector search and query planning.

**Key Methods:**

#### Constructor
```typescript
constructor(config: Neo4jConfig)
```
- Initializes Neo4j driver with connection parameters
- Supports optional connection pooling (default: 50 connections)
- Supports connection timeout configuration (default: 30 seconds)

**Parameters:**
- `config.uri`: Connection string (e.g., "bolt://localhost:7687")
- `config.username`: Database user
- `config.password`: Database password
- `config.maxConnectionPoolSize`: Optional connection pool size
- `config.connectionTimeout`: Optional timeout in milliseconds
- `config.database`: Optional database name

#### Query Execution: `async run(cypher, params?)`
```typescript
async run(
  cypher: string | CypherQuery,
  params?: Record<string, any>
): Promise<QueryResult>
```
**Importance:** Core method for executing Cypher queries
- Accepts raw Cypher strings or CypherQuery objects
- Handles parameter binding safely
- Automatically creates and closes sessions
- Returns Neo4j QueryResult with records and summary

**Usage Example:**
```typescript
const result = await neo4jClient.run(
  'MATCH (n:Scope) WHERE n.type = $type RETURN n',
  { type: 'function' }
);
```

#### Transaction Support: `async transaction<T>(fn)`
```typescript
async transaction<T>(
  fn: (tx: any) => Promise<T>
): Promise<T>
```
**Importance:** Manages write transactions with automatic rollback on errors
- Executes write operations in a transaction block
- Ensures ACID compliance
- Automatically closes session after completion
- Typical use: Batch inserts, updates with dependencies

**Usage Example:**
```typescript
const result = await neo4jClient.transaction(async (tx) => {
  const r1 = await tx.run('CREATE (n:Scope {name: $name}) RETURN n', {name: 'test'});
  const r2 = await tx.run('MATCH (n:Scope) RETURN count(n)');
  return r2.records[0].get(0);
});
```

#### Read-Only Transactions: `async readTransaction<T>(fn)`
```typescript
async readTransaction<T>(
  fn: (tx: any) => Promise<T>
): Promise<T>
```
**Importance:** Optimizes read-heavy operations
- Uses read-only transaction mode
- Neo4j can route to read replicas
- Automatic session cleanup
- Best for analytics and large scans

#### Query Explanation: `async explain(cypher, params?)`
```typescript
async explain(
  cypher: string,
  params: Record<string, any> = {}
): Promise<QueryPlan>
```
**Returns:**
```typescript
interface QueryPlan {
  cypher: string;
  params: Record<string, any>;
  estimatedRows?: number;
  indexesUsed?: string[];
  executionSteps?: string[];
}
```
**Importance:** Query performance analysis and optimization
- Extracts execution plan from EXPLAIN clause
- Shows index usage
- Reports estimated row counts
- Helps identify performance bottlenecks

#### Vector Similarity Search: `async vectorSearch(indexName, embedding, topK?)`
```typescript
async vectorSearch(
  indexName: string,
  embedding: number[],
  topK: number = 10
): Promise<VectorSearchResult[]>
```
**Returns:** Array of `{node: any, score: number}`
**Importance:** Semantic search capability
- Queries Neo4j vector index directly
- Requires pre-computed embeddings
- Returns results ranked by similarity score
- Used internally by VectorSearch class

#### Full-Text Search: `async fullTextSearch(indexName, query, options?)`
```typescript
async fullTextSearch(
  indexName: string,
  query: string,
  options: { limit?: number } = {}
): Promise<any[]>
```
**Importance:** Text-based keyword search
- Uses Neo4j full-text indexes
- Supports keyword queries
- Returns scored results
- Default limit: 10 results

#### Connection Health Check: `async verifyConnectivity()`
```typescript
async verifyConnectivity(): Promise<boolean>
```
**Importance:** Connection validation
- Verifies driver can reach Neo4j
- Returns boolean status
- Useful for health checks and startup validation

#### Connection Cleanup: `async close()`
```typescript
async close(): Promise<void>
```
**Importance:** Resource management
- Closes driver and all connections
- Must be called before process exit
- Prevents connection leaks

### 1.2 Legacy Neo4j Client
**File:** `/home/luciedefraiteur/LR_CodeRag/src/lib/neo4j/client.ts`

**Functions:**
- `createNeo4jDriver(config?)` - Creates a Neo4j driver instance
- `getNeo4jDriver()` - Gets cached driver (singleton pattern)
- `getNeo4jSession(config?)` - Creates a session with database config
- `getNeo4jConfig()` - Loads and caches config from environment
- `closeNeo4jDriver()` - Closes cached driver
- `resetNeo4jConfig()` - Resets cached configuration

**Purpose:** Legacy utility functions for simpler use cases
**Environment Variables:** `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`

---

## 2. QUERY EXECUTION METHODS

### 2.1 QueryBuilder Class
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/query/query-builder.ts`

**Class:** `QueryBuilder<T = any>`

**Purpose:** 
Fluent API for building complex Neo4j queries with support for filtering, semantic search, relationship expansion, and reranking.

**Constructor:**
```typescript
constructor(
  protected client: Neo4jClient,
  protected entityType: string
)
```

#### Filter Operations: `where(filter)`
```typescript
where(filter: Record<string, FilterValue<any>>): this
```
**Supported Operators:**
- `equals`: Exact match
- `contains`: Substring match (strings only)
- `startsWith`: Prefix match (strings only)
- `endsWith`: Suffix match (strings only)
- `gt`, `gte`, `lt`, `lte`: Numeric comparisons
- `in`: Match any value in array

**Usage Examples:**
```typescript
query.where({ 
  type: 'function',
  name: { contains: 'auth' },
  startLine: { gte: 100 }
})
```

#### Semantic Search: `semantic(query, options?)`
```typescript
semantic(
  query: string, 
  options: SemanticSearchOptions = {}
): this
```
**Options:**
- `topK`: Number of vector results (default: 20)
- `vectorIndex`: Name of Neo4j vector index (required)
- `minScore`: Minimum similarity threshold (default: 0.0)

**Importance:** Enables semantic/similarity-based search
- Generates embeddings for query text
- Searches vector index
- Merges results with other filters if present

**Usage Example:**
```typescript
query.semantic('authentication code', {
  topK: 20,
  vectorIndex: 'scopeEmbeddings'
})
```

#### Relationship Expansion: `expand(relType, options?)`
```typescript
expand(
  relType: string, 
  options: ExpandOptions = {}
): this
```
**Options:**
- `depth`: Traversal depth (default: 1)
- `direction`: 'outgoing' | 'incoming' | 'both'

**Importance:** Graph traversal for related entities
- Fetches connected nodes via specified relationship
- Supports multi-level depth
- Results included in `context.related` of SearchResult

**Usage Example:**
```typescript
query.expand('CONSUMES', { depth: 2, direction: 'outgoing' })
```

#### Relationship Filters: Built-in helpers
```typescript
whereConsumesScope(scopeName: string): this
whereConsumedByScope(scopeName: string): this
whereRelatedTo(scopeName: string, options): this
whereUuidIn(uuids: string[]): this
```

**Importance:** Specialized relationship queries
- `whereConsumesScope`: Find scopes that reference a target
- `whereConsumedByScope`: Find scopes referenced by a target
- `whereRelatedTo`: Generic relationship query
- `whereUuidIn`: Filter by UUID list

#### Result Limiting & Ordering: `limit()`, `offset()`, `orderBy()`
```typescript
limit(n: number): this
offset(n: number): this
orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this
```

#### Query Execution: `async execute()`
```typescript
async execute(): Promise<SearchResult<T>[]>
```
**Returns:** Array of typed search results with scores and context
**Process:**
1. Determines execution path (semantic-only, filter-based, or combined)
2. Executes primary query (Cypher or vector search)
3. Applies relationship expansions if specified
4. Applies reranking strategies
5. Sorts by score (descending)
6. Applies offset and limit

#### Count Results: `async count()`
```typescript
async count(): Promise<number>
```
**Importance:** Efficient entity counting
- Uses COUNT query (no full result fetch)
- Respects WHERE conditions
- Useful for pagination

#### Query Planning: `async explain()`
```typescript
async explain(): Promise<QueryPlan>
```
**Returns:** Execution plan with indexes and estimated rows
**Importance:** Performance optimization and debugging

#### Cypher Query Building: `protected buildCypher()`
```typescript
protected buildCypher(): CypherQuery
```
**Important Implementation Details:**
- Builds MATCH clause (with optional relationship matching)
- Adds WHERE conditions from filters
- Includes UUID filtering
- Adds OPTIONAL MATCH for expansions
- Constructs WITH and RETURN clauses
- Returns `{query: string, params: Record}`

---

## 3. DATABASE SESSION MANAGEMENT

### 3.1 Session Lifecycle in Neo4jClient

**Session Creation Pattern:**
```typescript
const session = this.driver.session({ database: this.database });
try {
  // Execute operations
  return await session.run(cypher, params);
} finally {
  await session.close();
}
```

**Key Characteristics:**
- **Automatic cleanup:** Sessions always closed in finally block
- **Database routing:** Respects configured database name
- **Transaction support:** Sessions support read/write transactions

### 3.2 Transaction Handling

**Write Transactions:**
```typescript
async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const session = this.driver.session({ database: this.database });
  try {
    return await session.executeWrite(fn);
  } finally {
    await session.close();
  }
}
```
- Uses `executeWrite()` for write operations
- Automatic retry on transient failures
- ACID compliant

**Read Transactions:**
```typescript
async readTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const session = this.driver.session({ database: this.database });
  try {
    return await session.executeRead(fn);
  } finally {
    await session.close();
  }
}
```
- Uses `executeRead()` for read operations
- Can be routed to read replicas
- Lower latency for read-heavy operations

### 3.3 Connection Pooling

**Configuration:**
- `maxConnectionPoolSize`: Default 50 connections
- `connectionTimeout`: Default 30 seconds
- Automatic connection reuse across queries

---

## 4. QUERY BUILDING & PARSING

### 4.1 CypherQuery Type
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/types/query.ts`

```typescript
interface CypherQuery {
  query: string;      // Cypher query string
  params: Record<string, any>;  // Query parameters
}
```

### 4.2 Filter Building Process

**FilterValue Type:**
```typescript
type FilterValue<T> = T | FilterOperators<T>;

interface FilterOperators<T> {
  equals?: T;
  contains?: T extends string ? string : never;
  startsWith?: T extends string ? string : never;
  endsWith?: T extends string ? string : never;
  gt?: T extends number ? number : never;
  gte?: T extends number ? number : never;
  lt?: T extends number ? number : never;
  lte?: T extends number ? number : never;
  in?: T[];
}
```

**Building WHERE Conditions:**
```typescript
private buildWhereConditions(params: Record<string, any>): string[]
```
- Maps filter operators to Cypher operators
- Sanitizes parameter names
- Builds WHERE condition strings
- Handles null/undefined values

**Generated Cypher Examples:**
```cypher
WHERE n.type = $type
WHERE n.name CONTAINS $name_contains
WHERE n.startLine >= $startLine_gte
WHERE n.uuid IN $uuidList
```

### 4.3 Relationship Expansion Parsing

**Expansion Building:**
```typescript
for (let i = 0; i < this.expansions.length; i++) {
  const { relType, options } = this.expansions[i];
  const depth = options.depth || 1;
  
  cypher += `\nOPTIONAL MATCH path${i} = (n)-[:${relType}*1..${depth}]->(related_${i})`;
  cypher += `\nWITH n, collect(DISTINCT related_${i}) AS related_${i}_list`;
}
```

**Parsed Results:**
```typescript
private parseRelatedEntities(record: any): any[]
```
- Extracts related entity lists from records
- Associates with relationship type
- Includes direction information

### 4.4 Result Parsing

**Parse Results Method:**
```typescript
private parseResults(records: any[]): SearchResult<T>[]
```
**Process:**
1. Extracts node properties as entity
2. Parses related entities if expansions used
3. Sets base score to 1.0
4. Attaches context with related entities

**SearchResult Structure:**
```typescript
interface SearchResult<T = any> {
  entity: T;
  score: number;                    // 0-1 relevance score
  scoreBreakdown?: {
    semantic?: number;
    topology?: number;
    custom?: Record<string, number>;
  };
  context?: {
    related?: RelatedEntity[];      // Expanded entities
    snippet?: string;               // Match context
    distance?: number;              // Graph distance
  };
}
```

### 4.5 Vector Search Integration

**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/vector/vector-search.ts`

**Class:** `VectorSearch`

**Purpose:** Bridge between text queries and Neo4j vector indexes via Vertex AI embeddings

**Key Methods:**

#### Generate Embedding: `async generateEmbedding(text)`
```typescript
async generateEmbedding(text: string): Promise<number[]>
```
- Uses Vertex AI API (text-embedding-004 model)
- Returns 768-dimensional vectors
- Requires Google Cloud authentication

#### Vector Search: `async search(query, options)`
```typescript
async search(
  query: string,
  options: VectorSearchOptions
): Promise<VectorSearchResult[]>
```
**Process:**
1. Generates embedding for query text
2. Calls Neo4j vector index
3. Filters by minimum similarity score
4. Returns top K results

**Cypher Used:**
```cypher
CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
YIELD node, score
WHERE score >= $minScore
RETURN elementId(node) AS nodeId, score, node
ORDER BY score DESC
```

#### Result Merging: `private mergeResults(filterResults, vectorResults)`
**Scoring Strategy:**
```typescript
score = result.score * 0.3 + vectorScore * 0.7  // Vector score weighted 70%
```
- Combines filter-based and vector scores
- Higher weight on semantic relevance
- Lower score if not in vector results

---

## 5. SCHEMA INTROSPECTION & DISCOVERY

### 5.1 SchemaIntrospector Class
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/schema/introspector.ts`

**Class:** `SchemaIntrospector`

**Purpose:** 
Analyzes Neo4j database schema to extract nodes, relationships, indexes, constraints, and vector indexes.

**Constructor:**
```typescript
constructor(uri: string, username: string, password: string)
```

#### Main Introspection: `async introspect(database?)`
```typescript
async introspect(database?: string): Promise<GraphSchema>
```

**Returns:**
```typescript
interface GraphSchema {
  nodes: NodeSchema[];
  relationships: RelationshipSchema[];
  indexes: IndexSchema[];
  constraints: ConstraintSchema[];
  vectorIndexes: VectorIndexSchema[];
}
```

**Process:**
1. Calls `db.labels()` to get all node labels
2. For each label:
   - Samples nodes to infer property types
   - Counts total nodes
3. Calls `db.relationshipTypes()` for all relationship types
4. Parses relationship start/end nodes
5. Queries all indexes with `SHOW INDEXES`
6. Queries all constraints with `SHOW CONSTRAINTS`
7. Extracts vector index metadata

#### Node Introspection: `private async introspectNodes()`
**Process:**
- Gets all node labels
- Samples up to 100 nodes per label
- Infers property types from sample values
- Type inference: String, Integer, Float, Boolean, List, Map, Date, DateTime

#### Relationship Introspection: `private async introspectRelationships()`
**Process:**
- Gets all relationship types
- For each type, finds start/end node labels
- Collects relationship properties
- Counts relationships

#### Index Discovery: `private async introspectIndexes()`
**Returns:** All BTREE, FULLTEXT, and VECTOR indexes
**Maps Neo4j types:**
- FULLTEXT indexes
- VECTOR indexes (including metadata)
- Standard property indexes

#### Constraint Discovery: `private async introspectConstraints()`
**Constraint Types:**
- UNIQUE constraints
- EXISTENCE constraints
- NODE_KEY constraints

#### Vector Index Details: `private async introspectVectorIndexes()`
**Extracts:**
- Index name
- Target label
- Property field
- Dimension (TODO: currently hardcoded as 1536)
- Similarity metric (TODO: currently hardcoded as 'cosine')

#### Type Inference: `private inferType(value)`
**Logic:**
- JavaScript `typeof` checks
- Neo4j-specific type detection
- Fallback to String type

---

## 6. CONFIGURATION TYPES

### 6.1 Runtime Configuration
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/types/config.ts`

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
  maxConnectionPoolSize?: number;    // Default: 50
  connectionTimeout?: number;        // Default: 30000ms
}

interface EmbeddingsConfig {
  provider: 'openai' | 'vertex' | 'custom';
  apiKey?: string;
  endpoint?: string;
  model?: string;
  dimension?: number;
}
```

### 6.2 RAG Configuration (Core)
**File:** `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/types/config.ts`

```typescript
interface RagForgeConfig {
  name: string;
  version: string;
  neo4j: Neo4jConfig;
  entities: EntityConfig[];           // Queryable entity types
  reranking?: RerankingConfig;
  mcp?: McpConfig;
  generation?: GenerationConfig;
}

interface EntityConfig {
  name: string;
  searchable_fields: FieldConfig[];
  vector_indexes?: VectorIndexConfig[];  // Multiple index support
  relationships?: RelationshipConfig[];
}

interface VectorIndexConfig {
  name: string;
  field: string;                     // Embedding property (e.g., 'embedding_signature')
  source_field: string;              // Text property (e.g., 'signature')
  dimension: number;
  similarity?: 'cosine' | 'euclidean' | 'dot';
  provider?: 'openai' | 'vertex' | 'custom';
  model?: string;
}
```

---

## 7. USAGE PATTERNS & BEST PRACTICES

### 7.1 Creating a RAG Client
```typescript
import { createClient } from '@ragforge/runtime';

const client = createClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password',
    database: 'neo4j'
  }
});
```

### 7.2 Basic Query
```typescript
const results = await client.query<Scope>('Scope')
  .where({ type: 'function' })
  .limit(10)
  .execute();
```

### 7.3 Semantic Search
```typescript
const results = await client.query<Scope>('Scope')
  .semantic('authentication logic', {
    topK: 20,
    vectorIndex: 'scopeEmbeddings'
  })
  .limit(10)
  .execute();
```

### 7.4 Relationship Expansion
```typescript
const results = await client.query<Scope>('Scope')
  .where({ type: 'function' })
  .expand('CONSUMES', { depth: 2, direction: 'outgoing' })
  .execute();

results[0].context?.related?.forEach(rel => {
  console.log(rel.entity.name, rel.relationshipType);
});
```

### 7.5 Transaction Example
```typescript
const neo4jClient = new Neo4jClient(config);

await neo4jClient.transaction(async (tx) => {
  // Multiple operations in transaction
  const result1 = await tx.run('CREATE (n:Node {id: $id})', {id: 1});
  const result2 = await tx.run('MATCH (n:Node) RETURN count(n)');
  return result2.records[0].get(0);
});
```

### 7.6 Raw Cypher
```typescript
const result = await client.raw(`
  MATCH (n:Scope)-[:CONSUMES]->(m:Scope)
  RETURN n.name, m.name
  LIMIT 10
`);
```

### 7.7 Connection Cleanup
```typescript
await client.close();  // Must be called before process exit
```

---

## 8. IMPORTANT IMPLEMENTATION DETAILS

### 8.1 Session Management Best Practice
- Always use try/finally to ensure session cleanup
- One session per query (created and closed per operation)
- Sessions not reused across operations

### 8.2 Cypher Query Building
- All parameters are named (not positional)
- Parameters safely escaped in query strings
- Entity names backtick-quoted for Neo4j reserved words
- Relationship patterns use OPTIONAL MATCH for expansions

### 8.3 Vector Search Integration
- Embeddings generated server-side via Vertex AI
- Query text embedded before vector search
- Results merged with filter results using weighted scoring
- Vector score weighted 70% vs filter score 30%

### 8.4 Type Inference
- Property types inferred from sample values
- Conservative approach (all properties marked nullable)
- Handles Neo4j-specific types (Integer, DateTime, etc.)

### 8.5 Query Explanation
- Uses EXPLAIN prefix to get execution plan
- Extracts indexes from plan.arguments
- Traverses plan tree recursively to find all children
- Reports estimated row counts and operator types

---

## 9. KEY FILE LOCATIONS SUMMARY

| Component | File Path | Class/Function |
|-----------|-----------|-----------------|
| **Main Client** | `ragforge/packages/runtime/src/client/neo4j-client.ts` | `Neo4jClient` |
| **Query Builder** | `ragforge/packages/runtime/src/query/query-builder.ts` | `QueryBuilder<T>` |
| **Vector Search** | `ragforge/packages/runtime/src/vector/vector-search.ts` | `VectorSearch` |
| **Runtime Config** | `ragforge/packages/runtime/src/types/config.ts` | Type definitions |
| **Schema Introspector** | `ragforge/packages/core/src/schema/introspector.ts` | `SchemaIntrospector` |
| **Schema Types** | `ragforge/packages/core/src/types/schema.ts` | Type definitions |
| **Legacy Client** | `src/lib/neo4j/client.ts` | Helper functions |
| **Public API** | `ragforge/packages/runtime/src/index.ts` | `createClient()` |

---

## 10. DEPENDENCY FLOW

```
Application
    ↓
createClient() ← RuntimeConfig
    ↓
Neo4jClient ← Neo4jConfig
    ├─ Creates driver (neo4j-driver)
    └─ Manages sessions & transactions
    
QueryBuilder
    ├─ Builds Cypher queries
    ├─ Uses Neo4jClient.run()
    ├─ Uses VectorSearch for semantic queries
    └─ Returns SearchResult<T>[]

VectorSearch
    ├─ Generates embeddings (Vertex AI)
    └─ Calls Neo4jClient.vectorSearch()

SchemaIntrospector
    └─ Introspects database schema
        ├─ Node labels & properties
        ├─ Relationships
        ├─ Indexes
        ├─ Constraints
        └─ Vector indexes
```

