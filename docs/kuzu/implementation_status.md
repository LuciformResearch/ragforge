# Kuzu Integration - Implementation Status

> Last updated: 2026-01-03

## Overview

Kuzu is being integrated as an **alternative embedded database** to Neo4j. The goal is to provide a zero-dependency option that doesn't require Docker.

| Feature | Neo4j | Kuzu | Status |
|---------|-------|------|--------|
| Docker required | Yes | No | ✅ |
| Embedded mode | No | Yes | ✅ |
| Cypher support | Full | Partial | ⚠️ |
| Vector indexes | Native HNSW | Extension (immutable) | ⚠️ |
| FTS indexes | Native Lucene | Extension (immutable) | ⚠️ |
| Real-time indexing | Yes | No (lazy rebuild) | ⚠️ |

## Files Modified

### Core Client
- `packages/core/src/runtime/client/kuzu-client.ts` - Main Kuzu client implementation
- `packages/core/src/runtime/client/database-client.ts` - Common interface (type only)

### Search Provider Abstraction
- `packages/core/src/brain/search-provider.ts` - Database-agnostic search interface
  - `SearchClient` interface with optional `markIndexesDirty()` methods
  - `Neo4jSearchProvider` - Neo4j-specific implementation
  - `KuzuSearchProvider` - Kuzu-specific implementation with brute-force fallbacks

### Brain Manager
- `packages/core/src/brain/brain-manager.ts`
  - Added `databaseProvider?: 'neo4j' | 'kuzu'` config
  - Added `kuzu?: { path?: string }` config
  - `connectDatabase()` replaces `connectNeo4j()` - handles both backends
  - Skip index creation for Kuzu (auto-indexes primary keys)
  - Skip schema checks for Kuzu (different Cypher syntax)
  - Kuzu-safe queries (no `OPTIONAL MATCH` with property matching)
  - `markIndexesDirty()` called after data modifications
  - `vectorSearchWithProvider()` for Kuzu vector search
  - `toNum()` helper for Neo4j Integer vs native number compatibility

### Touched Files Watcher
- `packages/core/src/brain/touched-files-watcher.ts`
  - Calls `markIndexesDirty()` after processing files

### Schema
- `packages/core/src/utils/node-schema.ts`
  - `convertTypeForKuzu()` converts `DOUBLE[]` to `FLOAT[]` (Kuzu vector extension requirement)
  - `VECTOR_INDEX_CONFIG` defines which node types/properties have vector indexes
  - `RagForgeMetadata` node type for storing dirty flags in DB

## Kuzu-Specific Limitations

### 1. Immutable Indexes
Both FTS and Vector indexes in Kuzu are **immutable**. After data changes:
- Indexes must be dropped and recreated
- We use **lazy rebuild**: mark dirty, rebuild before next search

```typescript
// Dirty flag storage in DB (survives restarts)
const METADATA_FTS_DIRTY = 'indexes.fts.dirty';
const METADATA_VECTOR_DIRTY = 'indexes.vector.dirty';

// Called after data modifications
markIndexesDirty(): void {
  this.markFtsIndexesDirty();
  this.markVectorIndexesDirty();
}

// Called before search
async ensureFtsIndexesFresh(): Promise<void> {
  const isDirty = await this.getMetadataBool(METADATA_FTS_DIRTY);
  if (!isDirty) return;
  await this.rebuildFtsIndexes();
}
```

### 2. Cypher Dialect Differences
Kuzu's Cypher is not 100% compatible with Neo4j:

| Feature | Neo4j | Kuzu |
|---------|-------|------|
| `OPTIONAL MATCH` with property filter | ✅ | ❌ Limited |
| `SHOW INDEXES` | ✅ | Different syntax |
| Index creation syntax | `CREATE INDEX ... IF NOT EXISTS` | `CALL CREATE_FTS_INDEX(...)` |
| Integer return type | `Integer` object with `.toNumber()` | Native JS `number` |

### 3. Vector Indexes
- Kuzu requires `FLOAT[]` (32-bit), not `DOUBLE[]` (64-bit)
- Schema auto-converts: `convertTypeForKuzu('DOUBLE[]')` → `'FLOAT[]'`
- Vector extension uses HNSW algorithm

### 4. Query Adaptations
```typescript
// Kuzu-safe query (no OPTIONAL MATCH with property matching)
const isKuzu = this.config.databaseProvider === 'kuzu';

const query = isKuzu
  ? `MATCH (p:Project)
     RETURN p.projectId as id, p.rootPath as path, ...
     0 as nodeCount`  // Can't count related nodes easily
  : `MATCH (p:Project)
     OPTIONAL MATCH (n {projectId: p.projectId})
     WITH p, count(n) as nodeCount
     RETURN ...`;
```

## Current Status

### ✅ Completed
1. **KuzuClient** - Full implementation with Neo4j-compatible interface
2. **Schema generation** - Auto-generates Kuzu DDL from node schema
3. **SearchProvider abstraction** - Database-agnostic search interface
4. **Dual backend support** - `databaseProvider: 'kuzu' | 'neo4j'`
5. **Config persistence** - `databaseProvider` and `kuzu.path` saved in config.yaml
6. **toNum() compatibility** - Handles both Neo4j Integer and native numbers
7. **Lazy index rebuild** - FTS and Vector indexes marked dirty, rebuilt before search
8. **Dirty flags in DB** - `RagForgeMetadata` table survives restarts

### ⚠️ In Progress / Known Issues
1. **Initial sync error** - Was getting `toNumber is not a function` (now fixed with `toNum()`)
2. **MERGE queries** - Fixed: All MERGE now use `uuid` as primary key for Kuzu ✅
   - `ensureDirectoryHierarchy()` - Split into Kuzu-safe queries
   - `touchFile()` - Uses uuid instead of absolutePath
   - `createMentionedFile()` - Split into multiple simple queries
   - `registerWebProject()` - Uses uuid for Project MERGE
   - `ingestWebPage()` - Uses uuid for WebPage MERGE
3. **Vector search** - Using brute-force via SearchProvider, not native QUERY_VECTOR_INDEX yet
4. **FTS search** - Using brute-force, not native QUERY_FTS_INDEX yet
5. **Embeddings** - Need to verify FLOAT[] schema is properly applied

### ❌ Not Yet Implemented
1. **Native QUERY_VECTOR_INDEX** - Currently using brute-force cosine similarity
2. **Native QUERY_FTS_INDEX** - Currently using CONTAINS text matching
3. **Projected graphs** - For filtered vector search
4. **Index rebuild optimization** - Currently rebuilds all indexes, could be incremental

## Testing

### Manual Test Steps
```bash
# 1. Clean brain data
mcp: cleanup_brain({ mode: "data_only", confirm: true })

# 2. Set database provider to kuzu (in ~/.ragforge/config.yaml)
databaseProvider: kuzu

# 3. Restart daemon
# 4. Ingest a directory
mcp: ingest_directory({ path: "/path/to/project" })

# 5. Check logs
cat ~/.ragforge/logs/daemon.log
```

### Expected Log Output
```
[Brain] Connected to Kuzu (/home/user/.ragforge/kuzu)
[Brain] SearchProvider initialized (kuzu)
[Brain] Skipping index creation (Kuzu auto-indexes primary keys)
[Brain] Skipping schema version checks (Kuzu mode)
```

## Configuration

### Enable Kuzu
Edit `~/.ragforge/config.yaml`:
```yaml
databaseProvider: kuzu
kuzu:
  path: /home/user/.ragforge/kuzu  # Optional, defaults to ~/.ragforge/kuzu
```

### Revert to Neo4j
```yaml
databaseProvider: neo4j  # or remove the line (default is neo4j)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BrainManager                           │
│  - connectDatabase() → Neo4j or Kuzu                        │
│  - markIndexesDirty() → triggers lazy rebuild               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     SearchProvider                          │
│  - textSearch() → FTS or CONTAINS fallback                  │
│  - vectorSearch() → HNSW or brute-force fallback            │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│      Neo4jClient        │     │       KuzuClient        │
│  - Native indexes       │     │  - Embedded DB          │
│  - Real-time updates    │     │  - Lazy index rebuild   │
│  - Docker required      │     │  - No external deps     │
└─────────────────────────┘     └─────────────────────────┘
```

## Next Steps

1. **Test ingest_directory** - Verify files are properly ingested with Kuzu
2. **Verify embeddings** - Check FLOAT[] vectors are stored correctly
3. **Enable native indexes** - Switch from brute-force to QUERY_VECTOR_INDEX / QUERY_FTS_INDEX
4. **Performance benchmarks** - Compare Kuzu vs Neo4j for search operations
5. **Error handling** - Improve error messages for Kuzu-specific failures

## References

- [Kuzu Documentation](https://docs.kuzudb.com/)
- [Kuzu FTS Extension](./fts-extension.md)
- [Kuzu Vector Extension](./vector-extension.md)
