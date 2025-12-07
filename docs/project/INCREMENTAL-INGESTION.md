# Incremental Ingestion System

**Last Updated**: 2025-12-06
**Status**: Partially Implemented
**Author**: Lucie Defraiteur

---

## Overview

RagForge supports incremental ingestion to efficiently update the knowledge graph when files change. This avoids re-indexing the entire codebase on every modification.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         TRIGGERS                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Agent modifies file (write_file, edit_file tools)           │
│     └─> Immediately triggers reIngestFile()                     │
│                                                                  │
│  2. User modifies file externally                               │
│     └─> FileWatcher detects change                              │
│     └─> Adds to IngestionQueue                                  │
│     └─> Batched ingestion after 1s delay                        │
│                                                                  │
│  3. Manual ingestion (CLI command)                              │
│     └─> Full or incremental based on flags                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IngestionQueue                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  - Batches file changes (batchInterval: 1000ms)                 │
│  - Queues new changes while ingestion in progress               │
│  - Acquires IngestionLock before processing                     │
│                                                                  │
│  pendingFiles: Set<string>    // Current batch                  │
│  queuedBatch: Set<string>     // Queued for next batch          │
│  isIngesting: boolean         // Processing flag                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IngestionLock                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Blocks RAG queries while ingestion is in progress              │
│                                                                  │
│  acquire(reason: string): Promise<ReleaseFunction>              │
│  waitIfLocked(): Promise<void>  // Called by RAG client         │
│                                                                  │
│  When locked:                                                   │
│  - RAG queries wait until released                              │
│  - Agent is notified "Ingestion in progress..."                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               IncrementalIngestionManager                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ingestIncremental(graph):                                      │
│    1. Fetch existing hashes from DB                             │
│    2. Compare with new hashes                                   │
│    3. Classify: created | updated | unchanged | deleted         │
│    4. Delete orphaned nodes                                     │
│    5. Upsert changed nodes (MERGE)                              │
│    6. Mark embeddingsDirty = true                               │
│    7. Track changes (optional)                                  │
│                                                                  │
│  reIngestFile(filePath):                                        │
│    - Optimized for single file re-ingestion                     │
│    - Used by agent file tools                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Trigger Flows

### Flow 1: Agent Modifies File

```
Agent calls write_file("src/utils.ts", content)
    │
    ▼
File tool writes to disk
    │
    ▼
File tool calls reIngestFile("src/utils.ts")
    │
    ▼
IngestionLock.acquire("agent:write_file")
    │
    ▼
Parse single file
    │
    ▼
Compare hashes, upsert nodes
    │
    ▼
IngestionLock.release()
    │
    ▼
Return result to agent (scopes created/updated/deleted)
```

**Important**: Agent modifications are **synchronous** - the agent waits for ingestion to complete before continuing. This ensures the graph is always up-to-date when the agent queries.

### Flow 2: User Modifies File Externally

```
User edits file in their editor
    │
    ▼
chokidar detects change event
    │
    ▼
FileWatcher.handleFileEvent()
    │
    ▼
IngestionQueue.addFile(path)
    │
    ▼
Reset batch timer (1s)
    │
    ├─── More changes within 1s?
    │         │
    │         ▼
    │    Add to batch, reset timer
    │
    ▼ (after 1s of no changes)
IngestionQueue.processBatch()
    │
    ▼
IngestionLock.acquire("batch:N files")
    │
    ▼
IncrementalIngestionManager.ingestFromPaths()
    │
    ▼
IngestionLock.release()
    │
    ▼
Agent notified (if waiting on query)
```

**Important**: User modifications are **batched** - multiple changes within 1 second are processed together. The agent is notified if it tries to query during ingestion.

---

## Query Blocking

When ingestion is in progress, RAG queries are blocked:

```typescript
// In RAG client
async query(cypher: string) {
  // Wait if ingestion is in progress
  await this.ingestionLock?.waitIfLocked();

  // Execute query
  return await this.client.run(cypher);
}
```

The agent sees:
```
⏳ Waiting for ingestion to complete...
   Reason: batch:3 files
```

---

## Hash-Based Change Detection

Each node has a `hash` property computed from its content:

```typescript
// For Scope nodes
hash = SHA256(parent + name + type + content).substring(0, 8)

// For File nodes
hash = SHA256(content).substring(0, 16)
```

**Classification:**
- `created`: UUID not in DB
- `updated`: UUID in DB but hash differs
- `unchanged`: UUID in DB and hash matches
- `deleted`: UUID in DB but not in new parse

---

## Current Limitations

### 1. Scope-Centric

The current implementation focuses on `Scope` nodes. Other node types (File, Directory, etc.) are treated as "structural" and always upserted.

**TODO**: Extend to all node types:
- DataFile, DataSection
- MediaFile
- WebDocument, VueSFC, SvelteComponent
- MarkupDocument, CodeBlock
- Stylesheet

### 2. No Cross-File Relationship Updates

When file A changes and its references to file B change:
- ✅ File A's nodes are updated
- ❌ Old relationships from A are NOT deleted
- ❌ New relationships to B are NOT created

**TODO**: Track relationships by source node and delete/recreate on change.

### 3. No Cascade Invalidation

When file B changes, files that reference B are NOT re-processed:
- B's hash changes
- References TO B might be stale
- Embeddings for "who uses B" are not updated

**TODO**: Consider optional cascade invalidation for critical changes.

### 4. ExternalURL Deduplication

ExternalURL nodes should be deduplicated by URL, but currently might be recreated.

**TODO**: Use MERGE on URL field instead of UUID.

---

## Planned Improvements

### Phase 1: Extend to All Node Types

```typescript
// Current (Scope only)
const scopeNodes = nodes.filter(n => n.labels.includes('Scope'));

// Planned (all content nodes)
const contentNodes = nodes.filter(n =>
  !['File', 'Directory', 'Project'].includes(n.labels[0])
);
```

### Phase 2: Relationship Cleanup

When a node is updated, delete its outgoing relationships and recreate:

```cypher
// Before upserting node
MATCH (n {uuid: $uuid})-[r:REFERENCES|IMPORTS_STYLE|LINKS_TO]->()
DELETE r

// Then create new relationships
```

### Phase 3: Cross-File Reference Tracking

Store which files reference which files:

```typescript
interface FileReferenceIndex {
  // file -> files it references
  outgoing: Map<string, Set<string>>;
  // file -> files that reference it
  incoming: Map<string, Set<string>>;
}
```

When file A changes:
1. Get old `outgoing[A]`
2. Parse new A, get new references
3. For removed references: delete relationships
4. For added references: create relationships

### Phase 4: Optional Cascade Invalidation

For critical changes (e.g., API signature change), optionally invalidate dependents:

```typescript
interface IncrementalOptions {
  // Re-process files that reference changed files
  cascadeInvalidation?: boolean;
  // Only cascade for certain relationship types
  cascadeRelationships?: string[];
}
```

---

## Integration Points

### Agent File Tools

```typescript
// In write_file tool handler
const result = await writeFile(path, content);

// Trigger re-ingestion
await ingestionManager.reIngestFile(path, sourceConfig, {
  trackChanges: true,
  verbose: false
});

return {
  ...result,
  scopesCreated: ...,
  scopesUpdated: ...,
  scopesDeleted: ...
};
```

### RAG Client

```typescript
class RagClient {
  constructor(
    private neo4j: Neo4jClient,
    private ingestionLock?: IngestionLock
  ) {}

  async query(cypher: string) {
    await this.ingestionLock?.waitIfLocked();
    return await this.neo4j.run(cypher);
  }
}
```

### FileWatcher Setup

```typescript
const watcher = new FileWatcher(
  ingestionManager,
  sourceConfig,
  {
    batchInterval: 1000,
    ingestionLock: ragClient.getLock(),
    verbose: true,
    onBatchComplete: (stats) => {
      console.log(`Ingested: +${stats.created} ~${stats.updated} -${stats.deleted}`);
    }
  }
);

await watcher.start();
```

---

## Impact on Cross-File Relationships

With the new cross-file relationships (see CROSS-FILE-RELATIONSHIPS.md), incremental ingestion needs to:

### When DataFile Changes

1. Delete old `REFERENCES` relationships from this DataFile
2. Re-detect references in new content
3. Create new `REFERENCES` relationships
4. Update `DataSection` nodes

### When HTML/Vue/Svelte Changes

1. Delete old `IMPORTS_STYLE`, `IMPORTS_SCRIPT`, `REFERENCES_IMAGE`, `LINKS_TO`
2. Re-parse document
3. Create new relationships

### When Markdown Changes

1. Delete old `LINKS_TO`, `REFERENCES_IMAGE`, `CONTAINS_CODE`
2. Delete old `CodeBlock` nodes
3. Re-parse document
4. Create new nodes and relationships

### When Stylesheet Changes

1. Delete old `IMPORTS`, `REFERENCES_IMAGE`
2. Re-parse stylesheet
3. Create new relationships

---

## Summary: What Happens When

| Trigger | Lock | Batch | Wait |
|---------|------|-------|------|
| Agent writes file | ✅ Acquired immediately | ❌ Single file | Agent waits for completion |
| User edits file | ✅ Acquired after batch | ✅ 1s delay | Agent waits if querying |
| Manual CLI ingest | ✅ Acquired | ❌ Full run | N/A |

| Node Type | Current | Planned |
|-----------|---------|---------|
| Scope | ✅ Incremental | ✅ |
| File/Directory | ✅ Always upsert | ✅ |
| DataFile | ❌ Not implemented | ✅ Incremental |
| MediaFile | ❌ Not implemented | ✅ Incremental |
| WebDocument/Vue/Svelte | ❌ Not implemented | ✅ Incremental |
| MarkupDocument | ❌ Not implemented | ✅ Incremental |
| Stylesheet | ❌ Not implemented | ✅ Incremental |
| Relationships | ❌ Not cleaned up | ✅ Delete & recreate |

---

## Related Documents

- [CROSS-FILE-RELATIONSHIPS.md](./CROSS-FILE-RELATIONSHIPS.md) - Relationship types
- [UNIVERSAL-FILE-INGESTION.md](./UNIVERSAL-FILE-INGESTION.md) - File type support
