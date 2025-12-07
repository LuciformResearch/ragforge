# Roadmap: Agent Integration & Real-time Ingestion

**Created**: 2025-12-07
**Status**: In Progress (Phase 5)
**Author**: Lucie Defraiteur

---

## Progress Summary (Updated 2025-12-07)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Media Ingestion | ✅ Done | image-tools.ts, threed-tools.ts updated |
| Phase 2: File Tracker Auto-Start | ✅ Done | FileWatcher starts on project load, AgentLogger integrated |
| Phase 3: Embedding Auto-Trigger | ✅ Done | afterIngestion callback in IngestionQueue, uses runEmbeddingPipelines |
| Phase 4: Deletion Cascade | ✅ Done | deleteNodesForFile/Files in IncrementalIngestionManager, pendingDeletes queue |
| Phase 5: Multi-Project Registry | ✅ Done | ProjectRegistry + tools + agent.ts integration + syncContextFromRegistry |
| Phase 6: Quick Directory Ingestion | ⏳ Pending | |
| Phase 7: Testing | ⏳ Pending | |

---

## Executive Summary

This roadmap covers the complete integration between the RAG agent, file tracking, incremental ingestion, and multi-project support. The goal is a seamless experience where:

1. **Everything the agent creates/modifies is automatically ingested**
2. **Manual file changes trigger the same pipeline**
3. **Queries are blocked during ingestion (with visible feedback)**
4. **Multiple projects can be loaded/unloaded dynamically**
5. **All features are testable via defined test paths**

---

## Current State Analysis

### What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| `write_file` / `edit_file` with lock | ✅ Complete | `file-tools.ts` |
| `IngestionLock` (query blocking) | ✅ Complete | `ingestion-lock.ts` |
| `FileWatcher` (chokidar) | ✅ Complete | `file-watcher.ts` |
| `IngestionQueue` (batching) | ✅ Complete | `ingestion-queue.ts` |
| `ChangeTracker` (Neo4j diffs) | ✅ Complete | `change-tracker.ts` |
| Incremental ingestion (all node types) | ✅ Complete | `incremental-ingestion.ts` |
| Incremental embeddings (dirty only) | ✅ Complete | `pipeline.ts` |
| Project tools (create/load) | ⚠️ Partial | `project-tools.ts` |
| Multi-project concurrent | ❌ Missing | - |

### What's Missing

1. **Media tool ingestion** - Images/3D created by agent not ingested
2. **File tracker auto-start** - Not started when agent loads project
3. **Visible logging** - Lock status not shown in agent logs
4. **Multi-project registry** - Only sequential load, no concurrent
5. **Embedding auto-trigger** - After ingestion, embeddings not auto-generated
6. **Related node invalidation** - Deleted files don't cascade to related nodes

---

## Phase 1: Media & Document Ingestion Integration

**Goal**: Everything the agent creates (code, images, 3D, documents) gets ingested.

### 1.1 Image Tool Integration

**File**: `packages/core/src/tools/image-tools.ts`

```typescript
// After image generation/modification, call:
async function ingestMediaFile(filePath: string, ctx: ToolGenerationContext) {
  if (!ctx.incrementalManager) return;

  const graph = await parseMediaFile(filePath);
  await ctx.incrementalManager.ingestIncremental(graph, {
    cleanupRelationships: true
  });
}
```

**Tools to update**:
- `generate_image` → ingest after Gemini/Replicate generation
- `edit_image` → ingest after modification
- `analyze_visual` → no ingestion needed (read-only)

### 1.2 3D Tool Integration

**File**: `packages/core/src/tools/threed-tools.ts`

**Tools to update**:
- `generate_3d_from_text` → ingest GLB after Trellis generation
- `generate_3d_from_image` → ingest GLB after multiview pipeline

### 1.3 Document Tool Integration

**Future tools**:
- `create_pdf_from_html` → ingest PDF after creation
- `convert_document` → ingest output document

### 1.4 Implementation Pattern

```typescript
// Generic pattern for all creation tools
interface CreationToolContext {
  filePath: string;
  fileType: 'image' | '3d' | 'document' | 'code';
  incrementalManager: IncrementalIngestionManager;
  ingestionLock: IngestionLock;
}

async function withIngestionAfterCreation<T>(
  ctx: CreationToolContext,
  createFn: () => Promise<T>
): Promise<T> {
  await ctx.ingestionLock.acquire(ctx.filePath);
  try {
    const result = await createFn();
    await ingestFile(ctx.filePath, ctx.fileType, ctx.incrementalManager);
    return result;
  } finally {
    ctx.ingestionLock.release();
  }
}
```

### Testing Path 1.x

```
Test: "Generate an image of a sunset and describe what you created"

Expected flow:
1. Agent calls generate_image → lock acquired
2. Image generated → saved to project
3. MediaFile node created in Neo4j with hash
4. Lock released
5. Agent can query "what images are in the project?" → finds new image
```

---

## Phase 2: File Tracker Auto-Start & Logging

**Goal**: File tracker starts automatically when agent loads a project, with visible logs.

### 2.1 Auto-Start on Project Load

**File**: `packages/core/src/tools/project-tools.ts`

```typescript
// In load_project handler
async function loadProject(params: { path: string }, ctx: ToolGenerationContext) {
  const projectPath = params.path;

  // 1. Load project config
  const config = await ConfigLoader.load(path.join(projectPath, 'ragforge.config.yaml'));

  // 2. Connect to Neo4j
  ctx.ragClient = await createRagClient(config);

  // 3. Start file watcher for this project
  ctx.fileWatcher = await startFileWatcher({
    projectRoot: projectPath,
    config,
    incrementalManager: ctx.incrementalManager,
    ingestionLock: ctx.ingestionLock,
    onLog: (message) => ctx.agentLogger?.log('file-tracker', message)
  });

  return { success: true, message: `Loaded project: ${projectPath}` };
}
```

### 2.2 Visible Logging in Agent

**New**: `AgentLogger` interface

```typescript
interface AgentLogger {
  log(source: 'file-tracker' | 'ingestion' | 'lock' | 'agent', message: string): void;
  getRecentLogs(count?: number): LogEntry[];
}

interface LogEntry {
  timestamp: Date;
  source: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}
```

**Integration points**:

| Event | Log Message |
|-------|-------------|
| File watcher started | `[file-tracker] Watching: src/**/*.ts (42 files)` |
| File change detected | `[file-tracker] Changed: src/utils/helper.ts` |
| Ingestion started | `[ingestion] Processing 3 files...` |
| Lock acquired | `[lock] Acquired for: src/utils/helper.ts` |
| Query blocked | `[lock] Query blocked (ingestion in progress)` |
| Lock released | `[lock] Released, queries resumed` |
| Embeddings dirty | `[ingestion] 5 scopes marked dirty` |

### 2.3 Lock Status in RAG Responses

When a query is blocked:

```typescript
// Instead of just waiting silently
{
  blocked: true,
  message: "Query paused while ingesting: src/utils/helper.ts (2s remaining)",
  willRetry: true
}
```

### Testing Path 2.x

```
Test: "Load project at /path/to/myproject, then manually edit a file"

Expected flow:
1. Agent loads project → file watcher starts
2. Log: "[file-tracker] Watching: src/**/*.ts (42 files)"
3. User edits file manually (outside agent)
4. Log: "[file-tracker] Changed: src/utils/helper.ts"
5. Log: "[lock] Acquired for batch (1 file)"
6. Agent query during ingestion → "[lock] Query blocked..."
7. Log: "[ingestion] Completed: 1 file, 3 scopes updated"
8. Log: "[lock] Released"
9. Query resumes with updated data
```

---

## Phase 3: Embedding Auto-Trigger

**Goal**: After incremental ingestion, automatically regenerate embeddings for dirty nodes.

### 3.1 Automatic Embedding Pipeline

**Option A**: Synchronous (blocks until embeddings done)
```typescript
// In ingestion-queue.ts processBatch()
const stats = await manager.ingestIncremental(graph, { cleanupRelationships: true });

if (stats.created + stats.updated > 0) {
  await generateDirtyEmbeddings(manager, embeddingProvider);
}
```

**Option B**: Async (non-blocking, eventual consistency)
```typescript
// Queue embedding job for background processing
if (stats.created + stats.updated > 0) {
  embeddingQueue.add({ projectId, dirtyCount: stats.created + stats.updated });
}
```

### 3.2 Embedding Provider in Context

```typescript
interface ToolGenerationContext {
  // Existing
  ragClient: RagClient;
  incrementalManager: IncrementalIngestionManager;
  ingestionLock: IngestionLock;

  // New
  embeddingProvider?: GeminiEmbeddingProvider;
  embeddingConfig?: GeneratedEmbeddingEntityConfig[];
}
```

### 3.3 Cost Awareness

Since embeddings cost money:
- Track embedding costs per session
- Option to defer embeddings until explicit trigger
- Batch embeddings (don't regenerate on every file save)

```typescript
interface EmbeddingPolicy {
  mode: 'immediate' | 'batched' | 'manual';
  batchInterval?: number; // ms, for batched mode
  maxCostPerSession?: number; // USD limit
}
```

### Testing Path 3.x

```
Test: "Create a new TypeScript file with a function, then search for it"

Expected flow:
1. Agent creates file → ingestion runs
2. Scope nodes created with embeddingsDirty=true
3. Embedding pipeline auto-triggers (dirty only)
4. Log: "[embeddings] Generated 2 embeddings ($0.001)"
5. Nodes marked embeddingsDirty=false
6. Semantic search finds new function
```

---

## Phase 4: Related Node Invalidation

**Goal**: When files are deleted or significantly modified, cascade invalidation.

### 4.1 Deletion Cascade

```typescript
// When a file is deleted:
async function handleFileDeletion(filePath: string) {
  // 1. Find all nodes that reference this file
  const query = `
    MATCH (f:File {path: $path})
    OPTIONAL MATCH (f)<-[:IN_FILE]-(s:Scope)
    OPTIONAL MATCH (f)<-[:CONTAINS]-(d:Directory)
    OPTIONAL MATCH (s)-[:CALLS|IMPORTS|REFERENCES]->(related)
    RETURN f, collect(s) as scopes, collect(related) as related
  `;

  // 2. Delete file and its scopes
  await deleteNodes([fileId, ...scopeIds]);

  // 3. Mark related nodes as potentially stale
  await markRelatedNodesForRevalidation(relatedIds);
}
```

### 4.2 Relationship Cleanup Matrix

| When | Action | Related Nodes |
|------|--------|---------------|
| File deleted | Delete scopes, mark callers | CALLS, IMPORTS relationships |
| Function renamed | Update references | All CALLS to old name |
| Import removed | Mark importers | IMPORTS relationships |
| Export removed | Mark consumers | EXPORTS relationships |

### 4.3 Stale Reference Detection

```typescript
interface StaleReferenceCheck {
  nodeId: string;
  referenceType: 'CALLS' | 'IMPORTS' | 'REFERENCES';
  targetId: string;
  targetExists: boolean;
  lastChecked: Date;
}

// Periodic check or on-demand
async function validateReferences(scopeId: string): Promise<StaleReferenceCheck[]> {
  // Query all outgoing references and verify targets still exist
}
```

### Testing Path 4.x

```
Test: "Delete a utility file that other files import"

Expected flow:
1. Agent deletes utils/helper.ts
2. File node and Scope nodes deleted
3. All files that IMPORTS helper.ts identified
4. Those files marked for re-validation
5. Log: "[ingestion] Deleted: utils/helper.ts (3 scopes)"
6. Log: "[validation] 5 files have stale imports"
7. Agent can query "which files have broken imports?" → gets list
```

---

## Phase 5: Multi-Project Support

**Goal**: Agent can work with multiple projects simultaneously.

### 5.1 Project Registry

```typescript
interface ProjectRegistry {
  projects: Map<string, LoadedProject>;
  activeProject: string | null;

  load(path: string): Promise<LoadedProject>;
  unload(projectId: string): Promise<void>;
  switch(projectId: string): void;
  getAll(): LoadedProject[];
}

interface LoadedProject {
  id: string;
  path: string;
  config: RagforgeConfig;
  ragClient: RagClient;
  fileWatcher: FileWatcher;
  incrementalManager: IncrementalIngestionManager;
  ingestionLock: IngestionLock;
  status: 'active' | 'background' | 'unloading';
}
```

### 5.2 Project Context Switching

```typescript
// New tools
const multiProjectTools = [
  {
    name: 'list_projects',
    description: 'List all loaded projects',
    handler: () => registry.getAll().map(p => ({
      id: p.id,
      path: p.path,
      status: p.status,
      isActive: p.id === registry.activeProject
    }))
  },
  {
    name: 'switch_project',
    description: 'Switch active project context',
    handler: ({ projectId }) => registry.switch(projectId)
  },
  {
    name: 'unload_project',
    description: 'Unload project from memory',
    handler: ({ projectId }) => registry.unload(projectId)
  }
];
```

### 5.3 Cross-Project Queries

```typescript
// Query across all loaded projects
async function searchAllProjects(query: string): Promise<CrossProjectResult[]> {
  const results = await Promise.all(
    registry.getAll()
      .filter(p => p.status === 'active')
      .map(async (project) => ({
        projectId: project.id,
        results: await project.ragClient.search(query)
      }))
  );
  return results.flat();
}
```

### 5.4 Memory Management

```typescript
interface ProjectMemoryPolicy {
  maxLoadedProjects: number;  // Default: 3
  idleUnloadTimeout: number;  // ms before unloading inactive project
  backgroundWatcherLimit: number;  // Max watchers for background projects
}

// Auto-unload least recently used projects
function enforceMemoryPolicy(registry: ProjectRegistry, policy: ProjectMemoryPolicy) {
  const projects = registry.getAll()
    .sort((a, b) => a.lastAccessed - b.lastAccessed);

  while (projects.length > policy.maxLoadedProjects) {
    const oldest = projects.shift();
    if (oldest.id !== registry.activeProject) {
      registry.unload(oldest.id);
    }
  }
}
```

### Testing Path 5.x

```
Test: "Load two projects, query both, then unload one"

Expected flow:
1. Agent loads project A → file watcher starts
2. Agent loads project B → second watcher starts
3. Log: "[projects] 2 projects loaded"
4. Query "find all API endpoints" → searches both projects
5. Results from both projects returned with project labels
6. Agent unloads project A → watcher stopped, connection closed
7. Query again → only project B results
8. Log: "[projects] Unloaded: project-a"
```

---

## Phase 6: Quick Directory Ingestion

**Goal**: Allow ingesting any directory without full project setup.

### 6.1 Use Case

```bash
# User wants to analyze a random codebase without creating a ragforge.config.yaml
ragforge ingest /path/to/random-code

# Or via agent
"Ingest and analyze the code in ~/Downloads/some-library"
```

### 6.2 Minimal Project Bootstrap

When ingesting a directory that isn't a RagForge project:

```typescript
async function ingestCustomDirectory(dirPath: string, options?: QuickIngestOptions) {
  // 1. Create minimal .ragforge folder
  const ragforgeDir = path.join(dirPath, '.ragforge');
  await fs.mkdir(ragforgeDir, { recursive: true });

  // 2. Auto-generate config based on detected file types
  const detectedTypes = await detectFileTypes(dirPath);
  const autoConfig = generateMinimalConfig(detectedTypes);
  await fs.writeFile(
    path.join(ragforgeDir, 'auto-config.yaml'),
    yaml.stringify(autoConfig)
  );

  // 3. Connect to shared/project-specific Neo4j
  const neo4j = options?.sharedNeo4j ?? await createTempNeo4jConnection();

  // 4. Ingest everything found
  const manager = new IncrementalIngestionManager(neo4j);
  const stats = await manager.ingestFromPaths({
    root: dirPath,
    include: detectedTypes.patterns, // e.g., ['**/*.ts', '**/*.py', '**/*.md']
    exclude: ['node_modules', '.git', 'dist']
  });

  return { stats, configPath: path.join(ragforgeDir, 'auto-config.yaml') };
}
```

### 6.3 Auto-Detection Logic

```typescript
interface DetectedFileTypes {
  patterns: string[];
  primaryLanguage: string | null;
  hasPackageJson: boolean;
  hasRequirementsTxt: boolean;
  hasCargoToml: boolean;
  mediaFiles: number;
  documentFiles: number;
}

async function detectFileTypes(dirPath: string): Promise<DetectedFileTypes> {
  // Scan directory and detect:
  // - Programming languages (by extension)
  // - Build/package files
  // - Media files (images, 3D, audio)
  // - Documents (PDF, DOCX, MD)
}

function generateMinimalConfig(detected: DetectedFileTypes): RagForgeConfig {
  return {
    source: {
      type: detected.primaryLanguage ?? 'mixed',
      root: '.',
      include: detected.patterns,
      exclude: ['node_modules', '.git', 'dist', '__pycache__', 'target']
    },
    neo4j: {
      // Use environment defaults or embedded
      uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687'
    },
    embeddings: {
      // Minimal embedding config
      defaults: { model: 'text-embedding-004' }
    }
  };
}
```

### 6.4 CLI Command

```typescript
// packages/cli/src/commands/ingest.ts
program
  .command('ingest <directory>')
  .description('Quick-ingest any directory (creates .ragforge/ if needed)')
  .option('-w, --watch', 'Keep watching for changes after initial ingest')
  .option('--no-embeddings', 'Skip embedding generation')
  .option('-p, --project <name>', 'Project name for Neo4j namespace')
  .action(async (directory, options) => {
    const result = await ingestCustomDirectory(directory, {
      watch: options.watch,
      generateEmbeddings: options.embeddings !== false,
      projectName: options.project
    });

    console.log(`Ingested ${result.stats.total} files`);
    if (options.watch) {
      console.log('Watching for changes... (Ctrl+C to stop)');
    }
  });
```

### 6.5 Agent Tool

```typescript
const ingestDirectoryTool = {
  name: 'ingest_directory',
  description: `Quickly ingest and index any directory for RAG queries.

Creates a minimal .ragforge/ folder if the directory isn't already a RagForge project.
Auto-detects file types and configures ingestion accordingly.

Parameters:
- path: Directory path to ingest
- watch: Keep watching for changes (default: false)

Example: ingest_directory({ path: "~/code/some-library" })`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path' },
      watch: { type: 'boolean', description: 'Watch for changes' }
    },
    required: ['path']
  }
};
```

### Testing Path 6.x

```
Test: "Ingest ~/Downloads/random-code and tell me what it contains"

Expected flow:
1. Agent calls ingest_directory({ path: "~/Downloads/random-code" })
2. .ragforge/ folder created with auto-config.yaml
3. Files detected: 15 .py, 3 .md, 2 .json
4. All files ingested → 42 Scope nodes created
5. Agent can now query: "What functions are defined?"
6. Results returned from the ingested code
```

---

## Phase 7: Testing Infrastructure

### 6.1 Integration Test Suite

```typescript
// packages/core/src/__tests__/integration/
describe('Agent Integration', () => {
  describe('File Modification Flow', () => {
    it('should ingest after write_file', async () => {
      const agent = await createTestAgent();
      await agent.ask('Create a file src/test.ts with a hello function');

      const nodes = await queryNeo4j('MATCH (s:Scope {name: "hello"}) RETURN s');
      expect(nodes.length).toBe(1);
    });

    it('should block queries during ingestion', async () => {
      // Start long-running ingestion
      const ingestionPromise = ingestLargeCodebase();

      // Try to query immediately
      const queryPromise = agent.ask('Find all functions');

      // Verify query waited
      expect(queryPromise.blockedDuration).toBeGreaterThan(0);
    });
  });

  describe('Media Creation Flow', () => {
    it('should ingest generated images', async () => {
      await agent.ask('Generate an image of a cat');

      const images = await queryNeo4j('MATCH (i:ImageFile) RETURN i');
      expect(images.length).toBe(1);
    });
  });

  describe('Multi-Project Flow', () => {
    it('should handle multiple projects', async () => {
      await agent.ask('Load project A and project B');
      await agent.ask('Find TODO comments in both projects');

      expect(results).toContainProjectResults(['project-a', 'project-b']);
    });
  });
});
```

### 6.2 Manual Test Checklist

#### Test Path A: Agent File Modification
```
1. [ ] Start agent with empty project
2. [ ] Ask: "Create a TypeScript file with a utility function"
3. [ ] Verify: File created, Scope nodes in Neo4j
4. [ ] Ask: "What functions exist in the project?"
5. [ ] Verify: New function appears in results
6. [ ] Ask: "Add a parameter to that function"
7. [ ] Verify: Scope hash changed, embeddingsDirty=true
8. [ ] Verify: Embeddings regenerated automatically
```

#### Test Path B: Manual File Changes
```
1. [ ] Start agent with loaded project
2. [ ] Verify: File watcher logs "Watching: ..."
3. [ ] Manually create new file outside agent
4. [ ] Verify: Log shows "Changed: newfile.ts"
5. [ ] Verify: Lock acquired, ingestion runs
6. [ ] Ask agent about new file
7. [ ] Verify: Agent knows about it
```

#### Test Path C: Query Blocking
```
1. [ ] Prepare large codebase (100+ files)
2. [ ] Trigger full re-ingestion
3. [ ] Immediately ask a RAG query
4. [ ] Verify: Log shows "[lock] Query blocked..."
5. [ ] Verify: Query waits and returns correct result
6. [ ] Verify: No race conditions or stale data
```

#### Test Path D: Media Creation
```
1. [ ] Ask: "Generate an image of a mountain landscape"
2. [ ] Verify: Image file saved
3. [ ] Verify: ImageFile node in Neo4j with dimensions
4. [ ] Ask: "What images are in this project?"
5. [ ] Verify: New image appears
6. [ ] Ask: "Generate a 3D model of a chair"
7. [ ] Verify: GLB file saved, ThreeDFile node created
```

#### Test Path E: Multi-Project
```
1. [ ] Create two test projects
2. [ ] Ask: "Load both projects"
3. [ ] Verify: Both file watchers running
4. [ ] Ask: "Find all classes across projects"
5. [ ] Verify: Results from both projects
6. [ ] Ask: "Unload project A"
7. [ ] Verify: Watcher stopped, query only returns project B
```

#### Test Path F: Deletion Cascade
```
1. [ ] Create file that is imported by others
2. [ ] Verify: IMPORTS relationships exist
3. [ ] Delete the file
4. [ ] Verify: Scope nodes deleted
5. [ ] Verify: Importing files marked for revalidation
6. [ ] Ask: "Which files have broken imports?"
7. [ ] Verify: Correct files listed
```

---

## Implementation Priority

### Sprint 1 (High Priority)
1. **Media ingestion** - Images/3D created by agent get ingested
2. **File tracker auto-start** - Start watcher on project load
3. **Visible logging** - Lock status in agent logs

### Sprint 2 (Medium Priority)
4. **Embedding auto-trigger** - Generate embeddings after ingestion
5. **Deletion cascade** - Invalidate related nodes

### Sprint 3 (Lower Priority)
6. **Multi-project registry** - Load/unload multiple projects
7. **Cross-project queries** - Search across projects

### Sprint 4 (Polish)
8. **Memory management** - Auto-unload idle projects
9. **Cost tracking** - Embedding cost per session
10. **Test suite** - Full integration tests

---

## Dependencies

### Required
- `chokidar`: Already installed (file watching)
- `p-limit`: Already installed (concurrency control)

### Optional
- `winston` or `pino`: For structured logging (currently using console)

---

## Related Documents

- [INCREMENTAL-INGESTION.md](./INCREMENTAL-INGESTION.md) - Hash-based change detection
- [UNIVERSAL-FILE-INGESTION.md](./UNIVERSAL-FILE-INGESTION.md) - File type parsers
- [TODO-UNIVERSAL-INGESTION.md](./TODO-UNIVERSAL-INGESTION.md) - Current status
- [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) - Image/3D/Music generation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| File change → query ready | < 3s for single file |
| Query block duration | < 5s wait time |
| Embedding generation | < 1s per 10 scopes |
| Multi-project switch | < 500ms |
| Memory per project | < 50MB when idle |
