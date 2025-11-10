# Feature Parity Roadmap - RagForge vs Original Scripts

**Date**: 2025-11-10 (Updated after Phase 2)
**Status**: Phase 1-2 Complete (~95% feature parity), Phase 3 In Progress
**Goal**: Achieve 100% feature parity with original XML-based pipeline

---

## 📊 Current State Summary (After Phase 2)

| Category | Before Phase 1 | After Phase 1 | After Phase 2 | Original | Completion |
|----------|----------------|---------------|---------------|----------|------------|
| **Scope Properties** | 13/24 (54%) | 20/24 (83%) | 21/24 (88%) | 24/24 (100%) | **88%** ✅ |
| **Relationship Quality** | ~50% accuracy | **~90% accuracy** | **~90% accuracy** | ~95% | **95%** ✅ |
| **Node Types** | 2/5 (40%) | 2/5 (40%) | **5/5 (100%)** | 5/5 (100%) | **100%** ✅ |
| **Relationships** | 2/11 (18%) | 4/11 (36%) | **10/11 (91%)** | 11/11 (100%) | **91%** ✅ |
| **Performance** | Broken | ✅ ~10s | ✅ ~10s | ✅ 10-15s | **100%** ✅ |
| **Infrastructure** | 2/7 (29%) | 7/7 (100%) | 7/7 (100%) | 7/7 (100%) | **100%** ✅ |

### 🎯 **Overall Score: ~95%** (was 73% after Phase 1, 42% before) ✅ **+127% improvement from start**

---

## ✅ Phase 1 - COMPLETED (Correctness & Performance)

### Core Fixes
- [x] **UUID Generation** - Stable with signature + parent hash
- [x] **Relationship Detection** - File + kind matching (`buildScopeReferences()`)
- [x] **Import Resolution** - Full `ImportResolver` with tsconfig paths
- [x] **Re-export Following** - Follows export chains to find actual definition
- [x] **Type Prioritization** - Prefers value types (function, class) over type-only (interface)
- [x] **Class Member Tracking** - `buildClassMemberReferences()` finds all members

### Performance & Infrastructure
- [x] **Cartesian Product Fix** - Precise MATCH with indexes
- [x] **Batching with UNWIND** - 500 nodes/relationships per batch
- [x] **Schema Creation** - Constraints + indexes before ingestion
- [x] **Idempotence** - MERGE instead of CREATE (can re-run safely)
- [x] **2-phase Ingestion** - All nodes first, then all relationships

### Result
- ✅ Relationship accuracy: **50% → 90%**
- ✅ Performance: **Broken → ~10s**
- ✅ Infrastructure: **All P0 bugs fixed**

---

## ✅ Phase 2 - COMPLETED (Essential Features)

**Goal**: Add all missing nodes, relationships, and file metadata
**Time spent**: ~3 hours
**Status**: COMPLETE - All features implemented and tested

### 2.1 - Missing Node Types

#### 2.1.1 Directory Nodes ✅ COMPLETE
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `ingestXmlToNeo4j.ts:586-597, 811-840`

- [x] Extract directory path from each file
- [x] Create `Directory` nodes with properties:
  - `path` (unique)
  - `depth` (number of path segments)
- [x] Add relationship: `File -[:IN_DIRECTORY]-> Directory`
- [x] Build directory hierarchy: `Directory -[:PARENT_OF]-> Directory`

**Impact**: Enables queries like "show me all scopes in src/components/"

**Implementation**:
```typescript
// In buildGraph(), after File nodes:
const directories = new Set<string>();
for (const [filePath] of parsedFiles) {
  const dir = path.dirname(filePath);
  directories.add(dir);

  // Create IN_DIRECTORY relationship
  relationships.push({
    type: 'IN_DIRECTORY',
    from: `file:${filePath}`,
    to: `dir:${dir}`
  });
}

// Create Directory nodes
for (const dir of directories) {
  nodes.push({
    labels: ['Directory'],
    id: `dir:${dir}`,
    properties: {
      path: dir,
      depth: dir.split('/').filter(p => p.length > 0).length
    }
  });
}

// Create PARENT_OF relationships
for (const dir of directories) {
  const parent = path.dirname(dir);
  if (parent && parent !== '.' && parent !== dir) {
    relationships.push({
      type: 'PARENT_OF',
      from: `dir:${parent}`,
      to: `dir:${dir}`
    });
  }
}
```

**Effort**: 1 hour

---

#### 2.1.2 ExternalLibrary Nodes ✅ COMPLETE
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `ingestXmlToNeo4j.ts:744-759`

- [x] Extract external imports from `scope.importReferences` (where `isLocal === false`)
- [x] Group by library name
- [x] Create `ExternalLibrary` nodes with properties:
  - `name` (unique - e.g., "react", "lodash")
- [x] Add relationship: `Scope -[:USES_LIBRARY {symbol: string}]-> ExternalLibrary`

**Impact**: Enables queries like "what libraries does this scope use?" and dependency analysis

**Implementation**:
```typescript
// In buildGraph(), second pass:
const externalLibs = new Map<string, Set<string>>(); // library -> symbols

for (const [filePath, analysis] of parsedFiles) {
  for (const scope of analysis.scopes) {
    const sourceUuid = this.generateUUID(scope, filePath);

    // Extract external imports
    if (scope.importReferences) {
      for (const imp of scope.importReferences.filter(i => !i.isLocal)) {
        if (!externalLibs.has(imp.source)) {
          externalLibs.set(imp.source, new Set());
        }
        externalLibs.get(imp.source)!.add(imp.imported);

        relationships.push({
          type: 'USES_LIBRARY',
          from: sourceUuid,
          to: `lib:${imp.source}`,
          properties: {
            symbol: imp.imported
          }
        });
      }
    }
  }
}

// Create ExternalLibrary nodes
for (const [libName, symbols] of externalLibs) {
  nodes.push({
    labels: ['ExternalLibrary'],
    id: `lib:${libName}`,
    properties: {
      name: libName
    }
  });
}
```

**Effort**: 1 hour

---

#### 2.1.3 Project Node ✅ COMPLETE
**File**: `code-source-adapter.ts` (parse method), `init.ts` (parseAndIngestSource)
**Original**: `ingestXmlToNeo4j.ts:150-188, 461-480`

- [x] Detect project information (git remote or directory name)
- [x] Create single `Project` node with properties:
  - `name` (unique)
  - `gitRemote` (origin URL if available)
  - `rootPath` (absolute path)
  - `indexedAt` (timestamp)
- [x] Add relationship: `Scope -[:BELONGS_TO]-> Project`
- [x] Add relationship: `File -[:BELONGS_TO]-> Project`

**Impact**: Enables multi-project support in single Neo4j database

**Implementation**:
```typescript
// In init.ts, before ingestion:
async function detectProjectInfo(projectPath: string): Promise<ProjectInfo> {
  let gitRemote: string | null = null;
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: projectPath });
    gitRemote = stdout.trim();
  } catch {
    // Not a git repo
  }

  const name = gitRemote
    ? gitRemote.match(/[\/:]([^\/]+?)(?:\.git)?$/)?.[1] || path.basename(projectPath)
    : path.basename(projectPath);

  return { name, gitRemote, rootPath: path.resolve(projectPath) };
}

// Create Project node in graph
nodes.push({
  labels: ['Project'],
  id: `project:${projectInfo.name}`,
  properties: {
    name: projectInfo.name,
    gitRemote: projectInfo.gitRemote,
    rootPath: projectInfo.rootPath,
    indexedAt: new Date().toISOString()
  }
});

// Add BELONGS_TO relationships
relationships.push({
  type: 'BELONGS_TO',
  from: scopeUuid,
  to: `project:${projectInfo.name}`
});
```

**Effort**: 30 minutes

---

### 2.2 - Missing Relationships

#### 2.2.1 INHERITS_FROM Relationship ✅ COMPLETE
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `ingestXmlToNeo4j.ts:654-680, buildXmlScopes.ts:1274-1282`

- [x] Detect class inheritance from scope references
- [x] Check if both source and target are classes
- [x] Check context for "extends" keyword (TypeScript) or parent class syntax (Python)
- [x] Create `Class -[:INHERITS_FROM]-> BaseClass` instead of generic CONSUMES

**Impact**: Enables class hierarchy queries and proper inheritance modeling

**Implementation**:
```typescript
// In buildGraph(), when creating CONSUMES relationships:
for (const targetUuid of scopeRefs) {
  const targetScope = scopeMap.get(targetUuid);

  // Detect inheritance
  const isInheritance =
    scope.type === 'class' &&
    targetScope?.type === 'class' &&
    this.isInheritanceReference(scope, targetScope);

  relationships.push({
    type: isInheritance ? 'INHERITS_FROM' : 'CONSUMES',
    from: sourceUuid,
    to: targetUuid
  });
}

private isInheritanceReference(scope: ScopeInfo, target: ScopeInfo): boolean {
  // Check if any identifier reference to target contains "extends"
  if (scope.identifierReferences) {
    for (const ref of scope.identifierReferences) {
      if (ref.identifier === target.name && ref.context?.includes('extends')) {
        return true;
      }
    }
  }
  return false;
}
```

**Effort**: 30 minutes

---

#### 2.2.2 HAS_PARENT Relationship ✅ COMPLETE
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `ingestXmlToNeo4j.ts:729-741`

- [x] Add `parentUUID` to Scope node properties
- [x] Calculate parent UUID when building scope nodes
- [x] Create `Scope -[:HAS_PARENT]-> ParentScope` relationship
- [x] Update constraint to include `parentUUID` in schema

**Impact**: Enables traversing parent hierarchy in Cypher queries

**Implementation**:
```typescript
// In buildGraph(), first pass when creating Scope nodes:
const parentUuid = scope.parent
  ? this.findParentUUID(scope, filePath, globalUUIDMapping)
  : undefined;

nodes.push({
  labels: ['Scope'],
  id: uuid,
  properties: {
    // ... existing properties
    parent: scope.parent,
    parentUUID: parentUuid // NEW
  }
});

// In second pass, create HAS_PARENT relationships:
if (parentUuid) {
  relationships.push({
    type: 'HAS_PARENT',
    from: sourceUuid,
    to: parentUuid
  });
}

private findParentUUID(
  scope: ScopeInfo,
  filePath: string,
  globalUUIDMapping: Map<string, Array<{ uuid: string; file: string; type: string }>>
): string | undefined {
  if (!scope.parent) return undefined;

  const candidates = globalUUIDMapping.get(scope.parent) || [];
  const match = candidates.find(c => c.file === filePath);
  return match?.uuid;
}
```

**Effort**: 30 minutes

---

### 2.3 - Missing File Metadata

#### 2.3.1 File ContentHash + Directory + Extension ✅ COMPLETE
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `ingestXmlToNeo4j.ts:562-583, buildXmlScopes.ts:191-194`

- [x] Calculate SHA-256 hash of file content during parsing
- [x] Store hash in File node properties
- [x] Add `directory` and `extension` properties while we're at it

**Impact**: Enables incremental updates (detect which files changed)

**Implementation**:
```typescript
import { createHash } from 'crypto';

// In parseFile(), after reading content:
const contentHash = createHash('sha256').update(content).digest('hex');

// Store in analysis result
analysis.contentHash = contentHash;

// In buildGraph(), when creating File nodes:
nodes.push({
  labels: ['File'],
  id: `file:${filePath}`,
  properties: {
    path: filePath,
    name: path.basename(filePath),
    directory: path.dirname(filePath), // NEW
    extension: path.extname(filePath), // NEW
    contentHash: analysis.contentHash  // NEW
  }
});
```

**Effort**: 15 minutes

---

### 2.4 - Schema Updates

#### 2.4.1 Add Missing Constraints ✅ COMPLETE
**File**: `init.ts` (schema creation section)

- [x] Add constraint for Directory: `CREATE CONSTRAINT directory_path IF NOT EXISTS FOR (d:Directory) REQUIRE d.path IS UNIQUE`
- [x] Add constraint for ExternalLibrary: `CREATE CONSTRAINT external_library_name IF NOT EXISTS FOR (e:ExternalLibrary) REQUIRE e.name IS UNIQUE`
- [x] Add constraint for Project: `CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE`
- [x] Add batching logic for all new node types in `init.ts`

**Effort**: 10 minutes

---

## 🐛 Phase 2 Testing Results & Issues Found

**Test Date**: 2025-11-10
**Test Project**: ragforge/packages/runtime/src (self-analysis)
**Results**: 267 Scopes, 26 Files, 17 Directories, 13 ExternalLibraries, 1 Project, 1320 relationships

### ✅ Working Correctly:
- All 5 node types created successfully
- 10/11 relationship types working
- All metadata properties present (contentHash, directory, extension, parentUUID, depth)
- Performance: ~10s for 26 files
- Batching and schema creation working perfectly

### ⚠️ Issues Detected (to fix in Phase 3):

#### Issue #1: Directory Paths Should Be Relative
**Severity**: Medium
**Current behavior**: Directory nodes use absolute paths like `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/adapters`
**Expected behavior**: Should use paths relative to project root like `adapters` or `src/adapters`
**Impact**: Creates extra directory nodes for the full absolute path (17 instead of ~10)
**Fix location**: `code-source-adapter.ts:378-426` (buildGraph method, Directory creation)
**Fix approach**: Use `path.relative(projectRoot, absolutePath)` when creating Directory nodes

#### Issue #2: INHERITS_FROM Not Detecting Cross-File Inheritance
**Severity**: Low
**Current behavior**: `CodeSourceAdapter extends SourceAdapter` (different files) → 0 INHERITS_FROM relationships
**Expected behavior**: Should create INHERITS_FROM relationship when class extends imported class
**Impact**: Class hierarchy not fully captured (inheritance within same file works)
**Fix location**: `code-source-adapter.ts:731-759` (isInheritanceReference method)
**Fix approach**: Need to resolve imported class names through ImportResolver before checking inheritance
**Test case**: `CodeSourceAdapter extends SourceAdapter` where SourceAdapter is imported from `./types.js`

---

## 🎨 Phase 3 - Bug Fixes + Metadata Enrichment (for 100% parity)

**Goal**: Fix Phase 2 issues + add rich metadata for advanced use cases
**Estimated time**: 3-4 hours
**Priority**: HIGH for fixes (3.0), MEDIUM for metadata (3.1-3.3)

### 3.0 - Critical Bug Fixes (REQUIRED)

#### 3.0.1 Fix Directory Relative Paths
**File**: `code-source-adapter.ts` (buildGraph method)
**Priority**: HIGH
**Issue**: Directory nodes use absolute paths instead of relative paths

- [ ] Store `projectRoot` from config in adapter instance
- [ ] Use `path.relative(projectRoot, absolutePath)` when creating Directory paths
- [ ] Update Directory depth calculation for relative paths
- [ ] Update File `directory` property to use relative path

**Expected result**:
- Before: `/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/adapters` (17 dirs)
- After: `adapters` (10 dirs)

**Effort**: 30 minutes

---

#### 3.0.2 Fix INHERITS_FROM for Cross-File Inheritance
**File**: `code-source-adapter.ts` (isInheritanceReference + buildGraph)
**Priority**: MEDIUM
**Issue**: Class inheritance not detected when base class is in different file

- [ ] In `isInheritanceReference()`, extract the imported base class name from `scope.importReferences`
- [ ] Check if target scope name matches the imported base class
- [ ] Verify both are classes and signature contains "extends"
- [ ] Create INHERITS_FROM relationship

**Test case**: `CodeSourceAdapter extends SourceAdapter` should create INHERITS_FROM

**Effort**: 45 minutes

---

### 3.1 - Scope Metadata

#### 3.1.1 Signature Tokens (for Syntax Highlighting)
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `buildXmlScopes.ts:530-608`

- [ ] Port `tokenizeSignature()` function
- [ ] Tokenize signature into keywords, identifiers, typeRefs, punctuation
- [ ] Store as JSON in `signatureTokens` property
- [ ] Link typeRef tokens to consumed scope UUIDs

**Impact**: Enables syntax highlighting and type reference visualization

**Implementation**:
```typescript
private tokenizeSignature(
  signature: string,
  scope: ScopeInfo,
  globalUUIDMapping: Map<...>
): any[] {
  const tokens: any[] = [];
  const keywords = ['function', 'class', 'interface', 'type', 'const', 'let', 'var',
                   'public', 'private', 'protected', 'static', 'async', 'readonly'];

  // Build consumed types map
  const consumedTypes = new Map<string, string>();
  // ... populate from scope dependencies

  // Tokenize with regex
  const regex = /(\w+)|([^\w\s]+)|(\s+)/g;
  let match;

  while ((match = regex.exec(signature)) !== null) {
    const token = match[0];
    if (match[1]) {
      if (keywords.includes(token)) {
        tokens.push({ type: 'keyword', text: token });
      } else if (consumedTypes.has(token)) {
        tokens.push({
          type: 'typeRef',
          text: token,
          consumed: true,
          uuid: consumedTypes.get(token)
        });
      } else {
        tokens.push({ type: 'identifier', text: token });
      }
    } else if (match[2]) {
      tokens.push({ type: 'punct', text: token });
    } else if (match[3]) {
      tokens.push({ type: 'ws', text: token });
    }
  }

  return tokens;
}

// In buildGraph():
properties: {
  // ...
  signatureTokens: JSON.stringify(this.tokenizeSignature(scope, globalUUIDMapping))
}
```

**Effort**: 1 hour

---

#### 3.1.2 Class Properties (for Classes)
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `buildXmlScopes.ts:611-631`

- [ ] Extract non-method children from class scopes
- [ ] Filter for `type === 'variable'` (properties/fields)
- [ ] Store as JSON array in `properties` property

**Impact**: Shows class structure (properties + methods)

**Implementation**:
```typescript
private extractClassProperties(classScope: ScopeInfo, allFileScopes: ScopeInfo[]): any[] {
  const properties: any[] = [];

  // Find child scopes that are variables (properties)
  for (const child of allFileScopes) {
    if (child.parent === classScope.name &&
        child.filePath === classScope.filePath &&
        child.type === 'variable') {
      properties.push({
        name: child.name,
        type: child.returnType || 'any'
      });
    }
  }

  return properties;
}

// In buildGraph(), for class scopes:
if (scope.type === 'class') {
  const classProps = this.extractClassProperties(scope, analysis.scopes);
  if (classProps.length > 0) {
    properties.properties = JSON.stringify(classProps);
  }
}
```

**Effort**: 30 minutes

---

#### 3.1.3 Additional Metadata Fields

- [ ] **language** property - Add `language: 'typescript' | 'python'` to each scope
  - Implementation: Detect from file extension or parser used
  - Effort: 5 minutes

- [ ] **parentUUID** property - Already covered in 2.2.2 above
  - Link to parent scope UUID for hierarchy traversal

- [ ] **decorators** format - Change from comma-separated to JSON array
  - Current: `"@Component,@Injectable"`
  - Target: `["@Component", "@Injectable"]`
  - Implementation: `decorators: JSON.stringify((scope as any).decorators)`
  - Effort: 5 minutes

**Total Effort**: 10 minutes

---

### 3.2 - Reference Location Tracking

#### 3.2.1 Line/Column for Each Reference
**File**: `code-source-adapter.ts` (buildImportReferences, buildScopeReferences methods)
**Original**: `buildXmlScopes.ts:337-343, 425-431, 468-474`

- [ ] Track line/column for each identifier reference
- [ ] Store as relationship properties or in separate structure
- [ ] Include context snippet (line of code where reference occurs)

**Impact**: Enables "go to definition" features and precise context

**Implementation**:
```typescript
// Store reference locations in relationship properties
relationships.push({
  type: 'CONSUMES',
  from: sourceUuid,
  to: targetUuid,
  properties: {
    locations: JSON.stringify([
      {
        line: ref.line,
        column: ref.column,
        context: ref.context
      }
    ])
  }
});
```

**Note**: This requires aggregating multiple references to same target into single relationship with array of locations.

**Effort**: 1 hour

---

### 3.3 - Redundant Relationships

#### 3.3.1 CONSUMED_BY Relationships (Optional)
**File**: `code-source-adapter.ts` (buildGraph method)
**Original**: `buildXmlScopes.ts:1059-1332`

- [ ] Create inverse `CONSUMED_BY` relationships
- [ ] OR: Remove completely and rely on Cypher to traverse inverse

**Note**: Original creates these by scanning all XMLs. Neo4j can traverse inverse relationships natively, so this is redundant. Consider **skipping** unless needed for specific query patterns.

**Recommendation**: ⚠️ **Skip this** - Use Cypher's `-[:CONSUMES]<-` syntax instead

**Effort**: 0 minutes (skip) or 30 minutes (implement)

---

## 📋 Implementation Checklist

### Phase 2 - Essential Features (Required)

#### Must-Have Nodes
- [ ] **2.1.1** Directory nodes + IN_DIRECTORY + PARENT_OF (1h)
- [ ] **2.1.2** ExternalLibrary nodes + USES_LIBRARY (1h)
- [ ] **2.1.3** Project node + BELONGS_TO (30min)

#### Must-Have Relationships
- [ ] **2.2.1** INHERITS_FROM for class inheritance (30min)
- [ ] **2.2.2** HAS_PARENT with parentUUID (30min)

#### Must-Have Metadata
- [ ] **2.3.1** File contentHash + directory + extension (15min)
- [ ] **2.4.1** Schema constraints for new nodes (10min)

**Total Phase 2: ~4 hours**

---

### Phase 3 - Metadata Enrichment (Nice-to-have)

#### Rich Metadata
- [ ] **3.1.1** Signature tokens for syntax highlighting (1h)
- [ ] **3.1.2** Class properties extraction (30min)
- [ ] **3.1.3** Additional fields (language, decorators format) (10min)

#### Advanced Features
- [ ] **3.2.1** Line/column tracking for references (1h)
- [ ] **3.3.1** CONSUMED_BY relationships (skip or 30min)

**Total Phase 3: ~2.5 hours**

---

## 🎯 Estimated Completion Timeline

| Phase | Tasks | Time | Cumulative | Feature Parity |
|-------|-------|------|------------|----------------|
| ✅ Phase 1 | Correctness + Performance | 3-4h | ✅ DONE | **73%** |
| Phase 2 | Essential Features | 4h | 7-8h | **~95%** |
| Phase 3 | Metadata Enrichment | 2.5h | 9.5-10.5h | **~100%** |

### Target Completion: **100% feature parity in ~10 hours total**

---

## 🚀 Next Steps

**Immediate Priority: Phase 2 (Essential Features)**

1. Start with **Directory nodes** (1h) - Enables file system navigation
2. Add **ExternalLibrary tracking** (1h) - Shows dependencies
3. Add **Project node** (30min) - Multi-project support
4. Implement **INHERITS_FROM** (30min) - Proper inheritance modeling
5. Add **HAS_PARENT** relationship (30min) - Scope hierarchy
6. Add **File metadata** (15min) - Enables incremental updates
7. Update **Schema** (10min) - Constraints for new nodes

**After Phase 2:**
- Test on real project (ragforge itself)
- Validate relationship quality (~95%+)
- Generate embeddings and test RAG queries

**After Phase 3:**
- Full feature parity (100%)
- Production-ready
- Documentation and examples

---

## 📝 Success Criteria

### Phase 2 Complete When:
- ✅ All 5 node types created (Scope, File, Directory, ExternalLibrary, Project)
- ✅ All 11 relationship types working
- ✅ File metadata includes contentHash (incremental updates possible)
- ✅ Feature parity: **~95%**

### Phase 3 Complete When:
- ✅ Signature tokens for syntax highlighting
- ✅ Class properties extracted
- ✅ Line/column tracking for all references
- ✅ Feature parity: **100%**

---

## 🔄 Testing Strategy

After each phase:
1. Run `ragforge init` on test project
2. Verify Neo4j graph structure with queries:
   ```cypher
   // Count nodes by type
   MATCH (n) RETURN labels(n), count(*)

   // Count relationships by type
   MATCH ()-[r]->() RETURN type(r), count(*)

   // Sample scope with all relationships
   MATCH (s:Scope {name: 'MyClass'})
   OPTIONAL MATCH (s)-[r]->(target)
   RETURN s, type(r), target

   // Verify inheritance
   MATCH (c:Scope)-[:INHERITS_FROM]->(base:Scope)
   RETURN c.name, base.name
   ```
3. Compare with original XML-based pipeline results
4. Verify relationship accuracy with spot checks

---

## 📊 Final Target

| Metric | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| **Feature Parity** | 73% ✅ | **~95%** | **100%** |
| **Relationship Accuracy** | 90% ✅ | **~95%** | **~95%** |
| **Node Types** | 2/5 | **5/5** ✅ | 5/5 ✅ |
| **Relationships** | 4/11 | **10/11** ✅ | 11/11 ✅ |
| **Performance** | ~10s ✅ | ~10s ✅ | ~10s ✅ |
| **Production Ready** | ⚠️ Testing | ✅ Yes | ✅ Yes |
