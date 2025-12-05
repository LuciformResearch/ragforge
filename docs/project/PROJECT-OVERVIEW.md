# RagForge Project Overview

**Last Updated**: 2025-12-05
**Status**: Production Ready for Agent Testing
**Author**: Lucie Defraiteur

---

## What is RagForge?

RagForge is a meta-framework for generating domain-specific RAG (Retrieval-Augmented Generation) frameworks from Neo4j schemas. It enables AI agents to understand and manipulate codebases with semantic search, graph relationships, and change tracking.

---

## Repository Structure

```
LR_CodeRag/                              # Root repository
├── packages/
│   └── codeparsers/                     # Tree-sitter based parsers (70KB TS, 45KB Python)
│       └── See: CODEPARSERS.md
│
├── ragforge/                            # Main RagForge monorepo
│   ├── packages/
│   │   ├── core/                        # Tool definitions, code generator, types
│   │   ├── runtime/                     # Neo4j client, query execution, agents
│   │   └── cli/                         # CLI commands (ragforge init, create, generate)
│   │
│   ├── examples/
│   │   ├── langchainjs-analysis/        # Working example: LangChain.js analysis
│   │   └── test-project/                # Test project for development
│   │
│   └── docs/                            # Documentation
│       ├── project/                     # This folder - project docs
│       └── visions/                     # Design documents
│
└── references/
    └── opencode/                        # Reference: OpenCode AI agent (gitignored)
```

---

## Package Versions

| Package | Version | NPM |
|---------|---------|-----|
| `@luciformresearch/codeparsers` | 0.1.3 | `npm i @luciformresearch/codeparsers` |
| `@luciformresearch/ragforge-core` | 0.1.0 | `npm i @luciformresearch/ragforge-core` |
| `@luciformresearch/ragforge-runtime` | 0.1.0 | `npm i @luciformresearch/ragforge-runtime` |
| `@luciformresearch/ragforge-cli` | 0.1.0 | `npm i -g @luciformresearch/ragforge-cli` |

---

## Key Concepts

### 1. Code Graph

Source code is parsed into a Neo4j graph:
- **Nodes**: Scopes (functions, classes, methods, interfaces, types)
- **Relationships**: DEFINED_IN, CALLS, IMPORTS, EXTENDS, IMPLEMENTS
- **Properties**: signature, parameters, returnType, complexity, etc.

### 2. Semantic Search

Vector embeddings enable searching by meaning:
```typescript
semantic_search({ query: "authentication logic", topK: 5 })
// → Finds code related to auth even without keyword "auth"
```

### 3. RAG Agent

AI agent with tools to query the code graph:
- `get_schema` - Graph structure
- `query_entities` - Filter entities
- `semantic_search` - Vector search
- `explore_relationships` - Navigate graph
- `glob_search` - Pattern matching
- `read_file`, `write_file`, `edit_file` - File operations

### 4. Incremental Ingestion

Only changed files are re-ingested:
- File watcher detects changes
- Hash comparison skips unchanged files
- IngestionLock coordinates with RAG queries

---

## Current Capabilities (2025-12-05)

### Working

- TypeScript/TSX/JSX parsing with full metadata extraction
- Python parsing (basic)
- Semantic search with Gemini embeddings
- Graph relationship navigation
- File read/write/edit tools with fuzzy matching
- Incremental ingestion with change tracking
- IngestionLock for RAG query coordination
- `ragforge create` command for new projects
- **Media Tools**:
  - Image: read_image (OCR), describe_image, list_images, generate_image
  - 3D: render_3d_asset (Three.js), generate_3d_from_image (Trellis)

### In Progress

- HTML/Vue parser (hybrid approach - see HTML-PARSER-DESIGN.md)

### Planned

- Full-text search tools
- Graph analytics (PageRank, community detection)
- Multi-entity join queries

---

## Environment Requirements

- Node.js >= 18
- Neo4j 5.x (or Docker: `docker-compose up -d` in .ragforge/)
- Gemini API key (for embeddings and agent)

---

## Quick Links

| Document | Description |
|----------|-------------|
| [QUICKSTART.md](./QUICKSTART.md) | Get started in 5 minutes |
| [CODEPARSERS.md](./CODEPARSERS.md) | Parser package documentation |
| [AGENT-TESTING.md](./AGENT-TESTING.md) | How to test the RAG agent |
| [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) | Image & 3D tools documentation |
| [HTML-PARSER-DESIGN.md](./HTML-PARSER-DESIGN.md) | HTML hybrid parser design |
| [CURRENT-STATE-2025-12-05.md](../visions/tool-generation/CURRENT-STATE-2025-12-05.md) | Detailed technical state |

---

## File Paths Quick Reference

### Codeparsers

```bash
# Root
/home/luciedefraiteur/LR_CodeRag/packages/codeparsers/

# Source
src/
├── index.ts                          # Main exports
├── wasm/
│   ├── WasmLoader.ts                 # WASM loading for tree-sitter
│   └── types.ts                      # SupportedLanguage type
├── scope-extraction/
│   ├── ScopeExtractionParser.ts      # TypeScript parser (2200 lines)
│   └── PythonScopeExtractionParser.ts # Python parser
├── typescript/
│   └── TypeScriptLanguageParser.ts   # High-level TypeScript API
└── python/
    └── PythonLanguageParser.ts       # High-level Python API
```

### RagForge Core

```bash
# Root
/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/

# Key files
src/
├── tools/
│   ├── tool-generator.ts             # RAG tool definitions
│   └── file-tools.ts                 # read/write/edit file tools
├── generator/
│   └── code-generator.ts             # Generated client code
└── types/
    └── index.ts                      # Type definitions
```

### RagForge Runtime

```bash
# Root
/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/

# Key files
src/
├── index.ts                          # createClient(), createRagAgent()
├── agents/
│   └── rag-agent.ts                  # RagAgent implementation
├── adapters/
│   ├── code-source-adapter.ts        # Code to Neo4j ingestion
│   ├── file-watcher.ts               # File change detection
│   ├── ingestion-queue.ts            # Batched ingestion
│   └── change-tracker.ts             # Diff tracking
└── locking/
    └── ingestion-lock.ts             # RAG/ingestion coordination
```

---

## Build Commands

```bash
# From ragforge root
cd /home/luciedefraiteur/LR_CodeRag/ragforge

# Build all packages
npm run build

# Build specific package
npm run build -w @luciformresearch/ragforge-core
npm run build -w @luciformresearch/ragforge-runtime
npm run build -w @luciformresearch/ragforge-cli

# Build codeparsers (separate repo)
cd /home/luciedefraiteur/LR_CodeRag/packages/codeparsers
npm run build
```

---

## Related Documents

- [CURRENT-STATE-2025-12-05.md](../visions/tool-generation/CURRENT-STATE-2025-12-05.md) - Full technical reference
- [AGENT-ROADMAP-2024-12-04.md](../visions/tool-generation/AGENT-ROADMAP-2024-12-04.md) - Agent development roadmap
- [RAGFORGE-VISION-2024-12-04.md](../visions/RAGFORGE-VISION-2024-12-04.md) - Project vision
