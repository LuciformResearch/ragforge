# Documentation Updates Needed for v0.2.0

**Date**: 2025-11-11
**Focus**: Update all documentation to reflect the new `quickstart` command

## Files That Need Updates

### ✅ Already Updated
- [x] `packages/cli/src/index.ts` (printRootHelp) - Already mentions quickstart prominently

### ❌ Need Updates

## 1. Main README (`/home/luciedefraiteur/LR_CodeRag/ragforge/README.md`)

**Current State**: Shows old workflow with `ragforge introspect` → customize YAML → `ragforge generate`

**Needed Changes**:

### Quick Start Section (lines 44-108)
Replace the entire "Quick Start" section with:

```markdown
## Quick Start

**Two ways to get started:**

### Option 1: Quickstart (Recommended for Code RAG)

The quickstart command automatically sets up everything for code analysis:

```bash
# Install CLI
npm install -g @luciformresearch/ragforge-cli

# Run quickstart in your project directory
cd /path/to/your/typescript/or/python/project
ragforge quickstart

# Or point to source code from elsewhere
mkdir my-rag-project && cd my-rag-project
ragforge quickstart --root /path/to/code --language typescript
```

**What it does:**
- ✅ Auto-detects project type (TypeScript/Python)
- ✅ Generates config merged with smart defaults
- ✅ Sets up Neo4j via Docker Compose
- ✅ Ingests your codebase into the graph
- ✅ Generates embeddings with Gemini
- ✅ Creates type-safe TypeScript client with 14 examples
- ✅ Ready to query in under 5 minutes

**What you need:**
- Docker (for Neo4j)
- Gemini API key in `.env`: `GEMINI_API_KEY=your-key`

Generated structure:
```
your-project/
├── .env                    # Neo4j credentials + your Gemini key
├── docker-compose.yml      # Neo4j container config
├── ragforge.config.yaml    # Expanded with defaults & comments
└── generated/
    ├── client.ts           # Type-safe RAG client
    ├── queries/            # Query helpers
    ├── examples/           # 14 working examples
    └── scripts/            # Ingestion, embeddings, watch mode
```

Try the examples:
```bash
cd generated
npm install
npx tsx examples/01-semantic-search-source.ts
npx tsx examples/02-relationship-defined_in.ts
npx tsx examples/07-llm-reranking.ts
```

### Option 2: Manual Setup (For Custom Neo4j Schemas)

If you already have a Neo4j database with a custom schema:

```bash
# Create .env with your Neo4j credentials
cat > .env <<EOF
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
GEMINI_API_KEY=your-gemini-key
EOF

# Introspect and generate
ragforge init --project my-rag --out ./my-rag-project

# Or with LLM-assisted field detection
ragforge init --auto-detect-fields
```

**Then customize the generated config:**

```yaml
# ragforge.config.yaml (auto-generated, then you can customize)
name: my-rag
entities:
  - name: Document
    searchable_fields:
      - { name: title, type: string }
      - { name: category, type: string }
    vector_indexes:
      - name: documentEmbeddings
        field: embedding
        source_field: content
        model: text-embedding-004
        dimension: 768
    relationships:
      - type: REFERENCES
        direction: outgoing
        target: Document
        filters:
          - { name: whereReferences, direction: outgoing }
```

**Regenerate after editing:**
```bash
ragforge generate --config ./my-rag-project/ragforge.config.yaml
```
```

### Update CLI Workflow Section (lines 167-201)
Replace with:

```markdown
## CLI Commands

### Primary Commands

**`ragforge quickstart`** - Complete setup for code RAG (TypeScript/Python)
- Auto-detects project type
- Generates config with defaults
- Sets up Docker Neo4j
- Ingests code + generates embeddings
- Creates working client with examples

```bash
ragforge quickstart [options]

Options:
  --root <path>        Path to source code (default: current directory)
  --language <lang>    Force language (typescript|python)
  --no-embeddings      Skip embedding generation
  --no-docker          Skip Docker setup (use existing Neo4j)
```

**`ragforge init`** - Introspect existing Neo4j + generate client
- Reads from existing Neo4j database
- Auto-detects entities and relationships
- Generates type-safe client

```bash
ragforge init [options]

Options:
  --project <name>         Project name
  --out <path>             Output directory
  --auto-detect-fields     Use LLM to detect relevant fields
  --uri <uri>              Neo4j URI (or NEO4J_URI in .env)
  --username <user>        Neo4j username (or NEO4J_USERNAME)
  --password <pass>        Neo4j password (or NEO4J_PASSWORD)
```

### Advanced Commands

**`ragforge generate`** - Regenerate client from config
```bash
ragforge generate --config ragforge.config.yaml --out ./generated
```

**`ragforge introspect`** - Just introspection, no generation
```bash
ragforge introspect --project my-project --out ./output
```

**`ragforge embeddings:index`** - Create vector indexes
```bash
ragforge embeddings:index --config ragforge.config.yaml
```

**`ragforge embeddings:generate`** - Generate embeddings
```bash
ragforge embeddings:generate --config ragforge.config.yaml
```

### Getting Help

```bash
ragforge --help              # Show all commands
ragforge help quickstart     # Detailed help for quickstart
ragforge help init           # Detailed help for init
```
```

## 2. CLI README (`/home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/README.md`)

**Current State**: Unknown (need to read)

**Needed Additions**:
- Add quickstart command to the command reference
- Add quickstart examples
- Document `--root`, `--language`, `--no-embeddings`, `--no-docker` options
- Add workflow comparison: quickstart vs init
- Add generated project structure explanation

## 3. Core README (`/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/README.md`)

**Current State**: Unknown (need to read)

**Needed Additions**:
- Document the defaults system
  - `src/defaults/base.yaml`
  - `src/defaults/code-typescript.yaml`
- Document config merging (`merger.ts`)
- Document config writer with educational comments (`writer.ts`)
- Add examples of minimal configs that get expanded
- Document how to add new adapter defaults

Example section to add:
```markdown
## Config Defaults System

RagForge includes smart defaults for common use cases. When you provide a minimal config, it automatically merges with adapter-specific defaults.

### Minimal Config Example
```yaml
name: my-project
source:
  type: code
  adapter: typescript
  root: ./packages
```

### Auto-Expanded Result
The system automatically adds:
- Exclude patterns (node_modules, dist, test files)
- Entity definitions (Scope, File, ExternalLibrary, etc.)
- Vector indexes with embeddings config
- Searchable fields
- Relationship definitions with filters
- Watch mode configuration
- Summarization settings

All auto-added fields are marked with comments like:
```yaml
exclude:
  # Auto-added from TypeScript defaults
  - "**/node_modules/**"
  - "**/dist/**"
```

### Adding Custom Defaults

Create `src/defaults/code-yourLanguage.yaml`:
```yaml
source:
  exclude:
    - "**/vendor/**"
    - "**/build/**"

entities:
  - name: Class
    searchable_fields:
      - name: name
        type: string
```
```

## 4. Runtime README (`/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/README.md`)

**Current State**: Unknown (need to read)

**Needed Additions**:
- Document `CodeSourceAdapter`
- Document incremental ingestion with change detection
- Document file watching
- Document summarization system
- Add usage examples for each

Example sections:
```markdown
## Code Source Adapter

The `CodeSourceAdapter` handles ingestion of source code from TypeScript/Python projects.

### Features
- **Incremental Ingestion**: Only re-processes changed files
- **Change Detection**: Tracks file hashes to detect modifications
- **File Watching**: Auto-regenerates on file changes
- **Import Resolution**: Resolves TypeScript imports and creates CONSUMES relationships

### Usage
```typescript
import { CodeSourceAdapter } from '@luciformresearch/ragforge-runtime';

const adapter = new CodeSourceAdapter({
  type: 'code',
  adapter: 'typescript',
  root: '/path/to/code',
  include: ['**/src/**/*.ts'],
  exclude: ['**/node_modules/**']
});

const graph = await adapter.parse();
```

## Incremental Ingestion

```typescript
import { IncrementalIngestionManager } from '@luciformresearch/ragforge-runtime';

const manager = new IncrementalIngestionManager(neo4jClient);

const stats = await manager.ingestFromPaths(sourceConfig, {
  incremental: true,  // Only ingest changed files
  verbose: true       // Show progress
});

console.log(`Ingested: ${stats.nodesCreated} nodes, ${stats.relationshipsCreated} relationships`);
```

## Field Summarization

Automatically generate summaries for large text fields using LLMs.

```typescript
import { GenericSummarizer } from '@luciformresearch/ragforge-runtime';

const summarizer = new GenericSummarizer({
  neo4jClient,
  llmProvider: new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY })
});

await summarizer.generateSummaries('Scope', {
  fieldName: 'source',
  outputFields: ['purpose', 'operation', 'dependency'],
  threshold: 300,  // Only summarize if > 300 chars
  strategy: 'code_analysis'
});
```
```

## 5. Generated QUICKSTART.md

**Current State**: Generated by quickstart command

**Action**: Verify it's comprehensive and up-to-date
- [ ] Check if examples are accurate
- [ ] Check if it explains all generated files
- [ ] Check if it has troubleshooting section

## 6. CHANGELOG Files (Need to Create)

### `ragforge/CHANGELOG.md` (Workspace-level)
```markdown
# Changelog

## [0.2.0] - 2025-11-XX

### Added
- **Quickstart Command**: Complete onboarding experience for code RAG
  - Auto-detects TypeScript/Python projects
  - Generates configs with smart defaults
  - Sets up Docker Neo4j automatically
  - Performs full ingestion + embeddings
  - Creates working client with 14 examples
- **Config Defaults System**: Base defaults + adapter-specific defaults
  - Educational comments distinguish user vs auto-added fields
  - Minimal configs automatically expanded
- **Workspace/Source Separation**: Generate projects in empty directories
  - Point to source code elsewhere via `--root`
  - Proper path resolution across boundaries
  - Monorepo detection and pattern generation
- **Code Source Adapter**: Incremental ingestion with change detection
  - File watching with auto-regeneration
  - TypeScript import resolution
  - Hash-based change tracking
- **Field Summarization**: LLM-based code summarization
  - Configurable output fields
  - Context-aware summarization with Neo4j queries
  - Reranking integration with summaries

### Changed
- CLI help text updated to prominently feature quickstart

### Known Issues
- LLM reranking can hit Gemini API quota limits with large result sets
  - Workaround: Use `prefer_summary` or reduce topK
  - Future: Switch to Gemini Flash for reranking

## [0.1.16] - 2025-11-XX (Previous release)
...
```

### `packages/cli/CHANGELOG.md`
```markdown
# @luciformresearch/ragforge-cli Changelog

## [0.2.0] - 2025-11-XX

### Added
- **Quickstart command** (`ragforge quickstart`)
  - Options: `--root`, `--language`, `--no-embeddings`, `--no-docker`
  - Auto-detects project type
  - Generates expanded configs with defaults
  - Sets up Neo4j via Docker Compose
  - Performs full ingestion workflow

### Changed
- Updated help text to feature quickstart prominently
- Dependencies updated: @luciformresearch/ragforge-core@^0.2.0, ragforge-runtime@^0.2.0
```

### `packages/core/CHANGELOG.md`
```markdown
# @luciformresearch/ragforge-core Changelog

## [0.2.0] - 2025-11-XX

### Added
- Config defaults system
  - `src/defaults/base.yaml` - Base defaults for all projects
  - `src/defaults/code-typescript.yaml` - TypeScript-specific defaults
- Config merging (`src/config/merger.ts`)
  - Deep merge of user config with defaults
  - Preserves user values, adds missing fields
- Config writer with educational comments (`src/config/writer.ts`)
  - `writeConfigWithDefaults()` - Annotates auto-added fields
  - `writeMinimalConfig()` - Strips defaults for clean output
- Template updates for generated projects
  - `load-config.ts` template for runtime config loading
  - `generate-summaries.ts` script template
  - `change-stats.ts` script template

### Changed
- Code generator creates projects that read from config files instead of hardcoding paths
```

### `packages/runtime/CHANGELOG.md`
```markdown
# @luciformresearch/ragforge-runtime Changelog

## [0.2.0] - 2025-11-XX

### Added
- Code source adapter (`src/adapters/code-source-adapter.ts`)
  - Parses TypeScript/Python source code
  - Extracts scopes, imports, relationships
  - Import resolution for CONSUMES relationships
- Change tracking (`src/adapters/change-tracker.ts`)
  - Hash-based change detection
  - Tracks file modifications
- Incremental ingestion (`src/adapters/incremental-ingestion.ts`)
  - Only re-processes changed files
  - Efficient updates for large codebases
- File watching (`src/adapters/file-watcher.ts`)
  - Monitors source files for changes
  - Auto-triggers regeneration
- Ingestion queue (`src/adapters/ingestion-queue.ts`)
  - Batched ingestion with progress tracking
- Field summarization (`src/summarization/`)
  - Generic summarizer for any entity/field
  - Code-specific strategies
  - Summary storage and retrieval
  - Integration with reranking

### Changed
- Query builder supports summary-based reranking
```

## Priority Order

**High Priority** (blocking release):
1. ✅ Main README - Most visible, needs quickstart front and center
2. ✅ CLI CHANGELOG - Required for npm publish
3. ✅ Core CHANGELOG - Required for npm publish
4. ✅ Runtime CHANGELOG - Required for npm publish

**Medium Priority** (should do before release):
5. CLI README - Detailed command reference
6. Core README - Developer documentation
7. Runtime README - Developer documentation

**Low Priority** (can do after release):
8. Workspace-level CHANGELOG
9. Additional guides and tutorials

## Documentation Standards

### Command Examples
- Always show both options: with and without flags
- Include expected output
- Show error cases and how to fix them

### Code Examples
- Must be copy-paste runnable
- Include all imports
- Show type annotations
- Add comments for clarity

### Config Examples
- Show minimal → expanded transformation
- Explain what each auto-added field does
- Provide templates for common use cases

## Next Steps

1. Read existing CLI/Core/Runtime READMEs
2. Update main README with quickstart
3. Create CHANGELOGs for all packages
4. Update package READMEs as needed
5. Test all examples in documentation
6. Proofread for accuracy and consistency
