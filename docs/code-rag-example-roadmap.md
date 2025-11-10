# Code RAG Example - Roadmap

## Overview

Integrate the existing code analysis pipeline (buildXmlScopes + ingestXmlToNeo4j) into RagForge as a first-class feature, enabling automatic RAG framework generation from codebases and other sources.

**Vision**: RagForge should automatically build RAG frameworks from various sources:
- 📁 **Codebases** (TypeScript, Python, Java, Go, etc.)
- 📄 **Documents** (PDFs, Markdown, Word docs)
- 🗄️ **Databases** (existing schemas)
- 🌐 **APIs** (OpenAPI specs, GraphQL schemas)

This roadmap focuses on **code as a source** but establishes patterns for future source types.

---

## Current State

### Existing Infrastructure ✅

#### 1. **@luciformresearch/codeparsers** (npm package)
- **Status**: Published as official npm package ✅
- **Installation**: `npm install @luciformresearch/codeparsers`
- **Purpose**: Parse TypeScript/Python files with tree-sitter
- **Key APIs**:
  - `TypeScriptLanguageParser` / `PythonLanguageParser`
  - `ScopeExtractionParser` - extracts scopes (classes, functions, methods)
  - `ImportResolver` - resolves import statements
- **Output**: `ScopeInfo` objects with rich metadata

#### 2. **Existing RagForge Code RAG Setup** ✅
- **Location**: `/ragforge-LR_CodeRag/`
- **Config**: `ragforge.config.yaml` ([see config](../../ragforge-LR_CodeRag/ragforge.config.yaml))
- **Features demonstrated**:
  - Entity: `Scope` with vector indexes on `source` and `signature`
  - Relationships: CONSUMES, CONSUMED_BY, DEFINED_IN, USES_LIBRARY
  - Embeddings: Gemini with preprocessing pipelines (configured in YAML)
  - MCP server configuration
  - Custom reranking strategies (topology, code quality, recency)
- **Status**: Working but based on older RagForge version - needs migration to latest

#### 3. **buildXmlScopes.ts** (`/scripts/buildXmlScopes.ts`)
- **Purpose**: Generate `.LR_RAG_SCOPES/` directory with XML scope files
- **Process**:
  1. Discovers all source files (via globby)
  2. Parses each file with codeparsers
  3. Generates UUID for each scope
  4. Creates individual XML files per scope with metadata
  5. Generates `manifest.xml` with file hashes and scope index
  6. Builds `<consumedBy>` relationships by scanning all XMLs
- **Dependencies**:
  - `@luciformresearch/codeparsers` ✅
  - `fast-xml-parser`, `globby`, `p-limit`
  - Custom utils: `UniqueIDHelper`, `ImportResolver`, `timestamp`
- **Output**:
  - `.LR_RAG_SCOPES/<file-path>/<scope>.xml` for each scope
  - `.LR_RAG_SCOPES/manifest.xml` (index of all scopes)

#### 4. **ingestXmlToNeo4j.ts** (`/scripts/ingestXmlToNeo4j.ts`)
- **Purpose**: Read XML scopes and create Neo4j graph
- **Process**:
  1. Reads manifest.xml to discover all scopes
  2. Parses each XML file
  3. Creates Neo4j nodes and relationships
- **Schema**:
  - **Nodes**: `Scope` with properties (uuid, name, type, file, startLine, endLine, source, etc.)
  - **Relationships**:
    - `CONSUMES` - scope uses another scope
    - `CONSUMED_BY` - inverse of CONSUMES
    - `INHERITS_FROM` - class inheritance
    - `DEFINED_IN` - scope defined in file
    - `IN_DIRECTORY` - file hierarchy
- **Dependencies**:
  - `neo4j-driver`
  - `fast-xml-parser`

---

## Architecture Proposals

### 🎯 Approach 1: Integrated CLI Commands (Recommended)

**Concept**: Add source parsing as built-in `ragforge` CLI commands

#### Structure
```bash
ragforge source:parse <directory>    # Parse code into Neo4j directly
ragforge source:watch <directory>    # Watch for changes and auto-update
ragforge init --from-source code     # Parse + generate in one command
```

#### Implementation
- **Location**: `ragforge/packages/cli/src/commands/source.ts`
- **Dependencies**: Add `@luciformresearch/codeparsers` to CLI package
- **Flow**:
  1. User runs `ragforge source:parse ./my-project`
  2. CLI parses codebase with codeparsers
  3. CLI ingests directly to Neo4j (no XML intermediary)
  4. User runs `ragforge init` to generate framework
  5. Embeddings auto-generated via config YAML

#### Pros
- ✅ Clean, unified CLI experience
- ✅ No intermediate XML files (direct to Neo4j)
- ✅ Built into core RagForge
- ✅ Easy discovery for users

#### Cons
- ⚠️ Tight coupling with codeparsers
- ⚠️ CLI package grows larger

---

### 🔌 Approach 2: Plugin System

**Concept**: Extensible plugin architecture for different source types

#### Structure
```bash
npm install @luciformresearch/ragforge-plugin-code
npm install @luciformresearch/ragforge-plugin-docs
npm install @luciformresearch/ragforge-plugin-openapi

ragforge plugins:install code
ragforge plugins:use code --dir ./my-project
ragforge init
```

#### Plugin Interface
```typescript
interface RagForgePlugin {
  name: string;
  version: string;

  // Parse source and return nodes/relationships
  parse(options: ParseOptions): Promise<GraphData>;

  // Suggest optimal config for this source type
  suggestConfig(): RagForgeConfig;

  // Validate source before parsing
  validate(options: ParseOptions): Promise<ValidationResult>;
}
```

#### Implementation
- **Location**:
  - Core: `ragforge/packages/core/src/plugins/`
  - Plugins: `ragforge/packages/plugin-code/`, `plugin-docs/`, etc.
- **Plugin Registry**: Load plugins dynamically
- **Config**: Plugins declare their capabilities

#### Pros
- ✅ Highly extensible
- ✅ Clean separation of concerns
- ✅ Community can create custom plugins
- ✅ Core stays lean

#### Cons
- ⚠️ More complex architecture
- ⚠️ Plugin discovery/management overhead
- ⚠️ Versioning complexity

---

### 🔀 Approach 3: Source Adapters

**Concept**: Adapter pattern for different source types, integrated into `init`

#### Structure
```yaml
# ragforge.config.yaml
source:
  type: code
  adapter: typescript  # or python, java, etc.
  include:
    - "src/**/*.ts"
  exclude:
    - "**/node_modules/**"
  options:
    parseComments: true
    resolveImports: true
```

```bash
ragforge init --from-config ragforge.config.yaml
# Automatically detects source.type and uses appropriate adapter
```

#### Adapter Interface
```typescript
interface SourceAdapter {
  type: string; // 'code', 'documents', 'database', 'api'

  // Parse source into standardized graph structure
  parse(config: SourceConfig): Promise<ParsedGraph>;

  // Get recommended entity config for this source
  getEntitySchema(): EntityConfig[];
}

// Implementations
class CodeSourceAdapter implements SourceAdapter { ... }
class DocumentSourceAdapter implements SourceAdapter { ... }
class OpenAPISourceAdapter implements SourceAdapter { ... }
```

#### Implementation
- **Location**: `ragforge/packages/core/src/adapters/`
- **Registry**: Built-in adapter registry
- **Config-driven**: Everything specified in YAML

#### Pros
- ✅ Config-first approach (declarative)
- ✅ Adapters bundled with RagForge
- ✅ Clear, simple mental model
- ✅ Easy to test (just adapters)

#### Cons
- ⚠️ All adapters shipped with core
- ⚠️ Less flexible than plugins

---

## Recommended Implementation Plan

### Phase 1: Proof of Concept with Approach 3 (Source Adapters)

**Why Approach 3 first?**
- Most aligned with RagForge's config-driven philosophy
- Simpler to implement initially
- Can evolve into plugin system later

#### Step 1.1: Create CodeSourceAdapter
- **Location**: `ragforge/packages/core/src/adapters/code-adapter.ts`
- **Dependencies**: Add `@luciformresearch/codeparsers` to core
- **Actions**:
  - Implement parse() method using codeparsers
  - Convert ScopeInfo → Neo4j nodes/relationships
  - Handle incremental updates

#### Step 1.2: Integrate into `ragforge init`
- **Modify**: `ragforge/packages/cli/src/commands/init.ts`
- **Flow**:
  1. Check if config has `source` section
  2. Load appropriate adapter
  3. Parse source → Neo4j
  4. Continue with normal init flow
  5. Embeddings auto-configured via YAML

#### Step 1.3: Update existing code-rag example
- **Location**: `/ragforge-LR_CodeRag/`
- **Actions**:
  - Update `ragforge.config.yaml` to latest format
  - Add `source` section
  - Re-generate with new CLI
  - Test embeddings pipeline

---

### Phase 2: Refine and Extend

#### Step 2.1: Add CLI convenience commands
```bash
ragforge source:validate   # Validate source config
ragforge source:dry-run    # Preview what would be parsed
ragforge source:update     # Incremental update only
```

#### Step 2.2: Add more adapters
- `DocumentSourceAdapter` - PDFs, Markdown, etc.
- `DatabaseSourceAdapter` - Existing DB schemas
- `OpenAPISourceAdapter` - REST API specs

#### Step 2.3: Consider plugin system
- If community requests custom adapters
- Extract adapters into optional plugins
- Keep core adapters (code, docs) built-in

---

## Implementation Details

### Config Format (Extended)

```yaml
# ragforge.config.yaml
name: my-code-rag
version: 1.0.0
description: RAG framework for my codebase

# NEW: Source specification
source:
  type: code
  adapter: typescript  # or python, java
  root: ./src
  include:
    - "**/*.ts"
    - "**/*.tsx"
  exclude:
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/*.test.ts"
  options:
    parseComments: true      # Extract JSDoc/docstrings
    resolveImports: true     # Build import graph
    extractTypes: true       # Extract type definitions
    includeTests: false      # Skip test files

neo4j:
  uri: ${NEO4J_URI}
  database: neo4j
  username: ${NEO4J_USER}
  password: ${NEO4J_PASSWORD}

entities:
  - name: Scope
    # RagForge auto-detects fields from parsed code
    display_name_field: name
    unique_field: uuid
    query_field: name
    example_display_fields:
      - file
      - type

    # Vector indexes for semantic search
    vector_indexes:
      - name: scopeSourceEmbeddings
        field: embedding
        source_field: source         # Code content
        dimension: 768
        similarity: cosine
        provider: gemini
        model: gemini-embedding-001

      - name: scopeSignatureEmbeddings
        field: signatureEmbedding
        source_field: signature      # Function/class signature
        dimension: 512
        similarity: cosine
        provider: gemini
        model: gemini-embedding-001

    # Relationships auto-detected by code parser
    relationships:
      - type: CONSUMES
        direction: outgoing
        target: Scope
        description: Scope uses another scope

      - type: DEFINED_IN
        direction: outgoing
        target: File
        description: Scope defined in file

  - name: File
    display_name_field: name
    unique_field: path
    relationships:
      - type: IN_DIRECTORY
        direction: outgoing
        target: Directory

# Embeddings configuration (same as before)
embeddings:
  provider: gemini
  entities:
    - entity: Scope
      pipelines:
        - name: scopeSourceEmbeddings
          source: source
          target_property: embedding
          preprocessors:
            - camelCaseSplit
            - normalizeWhitespace
          include_relationships:
            - type: CONSUMES
              direction: outgoing
              fields: [signature, name]
              depth: 1
              max_items: 5
          batch_size: 12
          concurrency: 2

# Reranking (same as before)
reranking:
  llm:
    provider: gemini
    model: gemini-3n-e2b-it
  strategies:
    - name: topology-centrality
      type: builtin
      algorithm: pagerank
    - name: code-quality
      type: custom
      scorer: |-
        (scope) => {
          let score = 0;
          if (scope.docstring) score += 0.4;
          const loc = scope.endLine - scope.startLine;
          if (loc < 100) score += 0.3;
          return score;
        }
```

### User Flow

```bash
# 1. Create config with source section
cat > ragforge.config.yaml << EOF
source:
  type: code
  adapter: typescript
  root: ./my-project
  include: ["**/*.ts"]
  exclude: ["**/node_modules/**"]
# ... rest of config
EOF

# 2. Init (auto-parses source and generates framework)
ragforge init --config ragforge.config.yaml

# 3. Generated framework is ready to use
cd generated/
npm install
npm run embeddings:generate  # Generate embeddings for code
npm start                     # Use the RAG framework
```

---

## Migration of Existing Setup

### Update `/ragforge-LR_CodeRag/` to Latest RagForge

**Steps**:
1. ✅ Update `ragforge.config.yaml` with `source` section
2. ✅ Remove old XML parsing scripts
3. ✅ Run `ragforge init --config ragforge.config.yaml`
4. ✅ Test generated framework
5. ✅ Generate embeddings via new pipeline
6. ✅ Verify semantic search works

**Benefits**:
- Single command setup
- No XML intermediary
- Auto-generates embeddings
- Up-to-date with latest RagForge features (mutations, MCP, etc.)

---

## Success Criteria

1. ✅ **One-command setup**: `ragforge init` with source config
2. ✅ **No manual steps**: Parsing → Neo4j → Framework generation → Embeddings (all automatic)
3. ✅ **Extensible**: Easy to add new source types (documents, APIs, etc.)
4. ✅ **Production-ready**: Handles large codebases (10k+ files) efficiently
5. ✅ **Config-driven**: Everything specified in YAML
6. ✅ **Demonstrates RagForge vision**: "RAG framework from any source"

---

## Timeline Estimate

### Approach 3 (Source Adapters) - Recommended
- **Phase 1.1**: CodeSourceAdapter implementation - 3 days
- **Phase 1.2**: Integrate into `init` command - 2 days
- **Phase 1.3**: Update existing code-rag example - 1 day
- **Phase 2**: Polish, docs, additional adapters - 3-4 days

**Total MVP**: ~6-7 days

### Future (Phase 2+)
- Document adapter: 2-3 days
- OpenAPI adapter: 2 days
- Plugin system (if needed): 4-5 days

---

## Decisions Made ✅

### Q1: XML intermediary - keep or remove?
**Decision**: ✅ **Hybrid approach**
- Parse directly to Neo4j by default (no XML)
- Add `--export-xml` flag to optionally generate XML for debugging
- XML output useful for:
  - Debugging parser output
  - Version control / diff checking
  - Caching for faster re-runs
  - Manual inspection of parsed structure

**Implementation**:
```yaml
source:
  type: code
  adapter: typescript
  options:
    exportXml: false  # Optional: set to true to generate .LR_RAG_SCOPES/
```

### Q2: Incremental updates - how to handle?
**Decision**: ✅ **Scope-level incremental**
- Track content hash for each scope
- On update, compare scope signatures and source
- Only update changed scopes + their dependents
- Cascade dirty flag through CONSUMES/CONSUMED_BY relationships

**Benefits**:
- Fastest possible updates
- Minimal Neo4j writes
- Preserves embeddings for unchanged scopes

### Q3: Neo4j schema - one label or multiple?
**Decision**: ✅ **Single `Scope` label for now**
- Keep it simple: One `Scope` label with `type` property
- Query by type: `WHERE scope.type = 'function'`
- Revisit later if performance issues arise

**Rationale**:
- Simpler schema
- More flexible (can add new scope types without schema changes)
- Good enough for MVP
- Can migrate to multiple labels later if needed

### Q4: Should codeparsers be a dependency of core or CLI?
**Decision**: ✅ **Core package dependency**
- Add `@luciformresearch/codeparsers` to core package.json
- Adapters live in core (`ragforge/packages/core/src/adapters/`)
- CLI just orchestrates, core does the parsing

**Rationale**:
- Adapters are part of RagForge's core functionality
- Other packages (e.g., runtime, MCP) might need adapter access
- Clean separation: CLI = commands, Core = business logic

---

## Related Resources

- **Existing code-rag config**: `/ragforge-LR_CodeRag/ragforge.config.yaml`
- **codeparsers npm**: https://www.npmjs.com/package/@luciformresearch/codeparsers
- **codeparsers README**: `/packages/codeparsers/README.md`
- **buildXmlScopes**: `/scripts/buildXmlScopes.ts`
- **ingestXmlToNeo4j**: `/scripts/ingestXmlToNeo4j.ts`
- **RagForge docs**: `/ragforge/docs/`
