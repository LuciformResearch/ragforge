# @luciformresearch/ragforge-cli

Command-line interface for RagForge. Introspect Neo4j schemas, generate type-safe clients, manage embeddings, and bootstrap RAG projects from YAML configs.

### ⚖️ License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

✅ **Free to use for:**
- 🧠 Research, education, personal exploration
- 💻 Freelance or small-scale projects (≤ €100,000 gross monthly revenue)
- 🏢 Internal tools (if your company revenue ≤ €100,000/month)

🔒 **Commercial use above this threshold** requires a separate agreement.

📧 Contact for commercial licensing: [legal@luciformresearch.com](mailto:legal@luciformresearch.com)

⏰ **Grace period:** 60 days after crossing the revenue threshold

📜 Full text: [LICENSE](./LICENSE)

---

**Note:** This is a custom "source-available" license, NOT an OSI-approved open source license.

## Installation

```bash
npm install -g @luciformresearch/ragforge-cli
```

Or use directly with npx:

```bash
npx @luciformresearch/ragforge-cli --help
```

## Quick Start

```bash
# Initialize a new RAG project
ragforge init --project my-rag --out ./my-rag-project

# Or generate from existing config
ragforge generate --config ./ragforge.config.yaml --out ./generated

# Create vector indexes
ragforge embeddings:index --config ./ragforge.config.yaml

# Generate embeddings
ragforge embeddings:generate --config ./ragforge.config.yaml
```

## Commands

### `ragforge init`

Bootstrap a new RAG project by introspecting Neo4j and generating everything.

```bash
ragforge init \
  --project my-project \
  --out ./my-rag-project \
  [--uri bolt://localhost:7687] \
  [--username neo4j] \
  [--password password] \
  [--force]
```

**Options:**
- `--project <name>` - Project name
- `--out <dir>` - Output directory
- `--uri` - Neo4j URI (or set `NEO4J_URI` env)
- `--username` - Neo4j username (or set `NEO4J_USERNAME` env)
- `--password` - Neo4j password (or set `NEO4J_PASSWORD` env)
- `--force` - Overwrite existing files
- `--auto-detect-fields` - Auto-detect searchable fields using LLM

**Generates:**
- `ragforge.config.yaml` - Configuration file
- `schema.json` - Introspected Neo4j schema
- `generated/` - Type-safe client and utilities
- `.env` - Environment variables template

---

### `ragforge introspect`

Introspect Neo4j database and generate schema JSON.

```bash
ragforge introspect \
  --project my-project \
  --out ./output \
  [--uri bolt://localhost:7687] \
  [--username neo4j] \
  [--password password] \
  [--force]
```

**Generates:**
- `schema.json` - Database schema
- `ragforge.config.yaml` - Initial configuration template

---

### `ragforge generate`

Generate type-safe client from YAML configuration.

```bash
ragforge generate \
  --config ./ragforge.config.yaml \
  --out ./generated \
  [--schema ./schema.json] \
  [--force] \
  [--auto-detect-fields] \
  [--reset-embeddings-config]
```

**Options:**
- `--config <path>` - Path to ragforge.config.yaml
- `--out <dir>` - Output directory
- `--schema <path>` - Path to schema.json (optional, will introspect if not provided)
- `--force` - Overwrite existing files
- `--auto-detect-fields` - Use LLM to suggest searchable fields
- `--reset-embeddings-config` - Overwrite customized embedding loader

**Generates:**
- `client.ts` - Type-safe RAG client
- `types.ts` - TypeScript types
- `queries/*.ts` - Entity-specific query builders
- `scripts/*.js` - Embedding management scripts
- `embeddings/load-config.js` - Runtime config loader
- `docs/client-reference.md` - API documentation
- `agent.ts` - MCP agent template
- `packages/runtime/` - Standalone runtime copy

---

### `ragforge embeddings:index`

Create vector indexes in Neo4j from YAML configuration.

```bash
ragforge embeddings:index \
  --config ./ragforge.config.yaml \
  [--out ./generated]
```

**Note:** Reads Neo4j credentials from environment variables or `.env` file.

---

### `ragforge embeddings:generate`

Generate embeddings for all configured vector indexes.

```bash
ragforge embeddings:generate \
  --config ./ragforge.config.yaml \
  [--out ./generated]
```

**Note:** Requires `GEMINI_API_KEY` environment variable.

---

## Configuration

Create a `.env` file with your credentials:

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
GEMINI_API_KEY=your-api-key
```

## Example Workflow

### 1. Initialize Your RAG Project

```bash
# Introspect your Neo4j database and bootstrap a project
ragforge init --project my-rag --out ./my-rag-project

cd my-rag-project
```

This creates:
- `ragforge.config.yaml` - Configuration template from your Neo4j schema
- `schema.json` - Snapshot of your database schema
- `generated/` - Type-safe client and utilities
- `.env` - Environment variable template

### 2. Configure Your RAG

Edit `ragforge.config.yaml` to:
- Define which entities are searchable
- Configure vector indexes (field, model, dimension)
- Specify relationship filters
- Set up reranking strategies

Example config:
```yaml
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
        model: gemini-embedding-001
        dimension: 768
    relationships:
      - type: REFERENCES
        direction: outgoing
        target: Document
        filters:
          - { name: whereReferences, direction: outgoing }
```

### 3. Generate Your Client

```bash
# Regenerate with your custom config
ragforge generate \
  --config ./ragforge.config.yaml \
  --out ./generated \
  --force

# Or use auto-detection for searchable fields
ragforge generate \
  --config ./ragforge.config.yaml \
  --out ./generated \
  --auto-detect-fields
```

### 4. Setup Vector Indexes

```bash
# Create vector indexes in Neo4j
npm run embeddings:index

# Generate embeddings for your data
npm run embeddings:generate
```

### 5. Use Your RAG Framework

```typescript
// Import the generated client
import { createRagClient } from './generated/client.js';

// Initialize
const rag = createRagClient({
  neo4j: {
    uri: process.env.NEO4J_URI,
    username: process.env.NEO4J_USERNAME,
    password: process.env.NEO4J_PASSWORD
  }
});

// Semantic search
const docs = await rag
  .document()
  .semanticSearch('machine learning algorithms', { topK: 10 })
  .whereCategory('technical')
  .execute();

// Relationship traversal
const relatedDocs = await rag
  .document()
  .semanticSearch('neural networks', { topK: 5 })
  .whereReferences('deep-learning-guide')
  .execute();

// Close when done
await rag.close();
```

### 6. Run Examples

```bash
# Try the generated examples
npm run examples:basic
npm run examples:semantic

# Or create your own
tsx ./my-query.ts
```

## Generated Project Structure

When you run `ragforge init` or `ragforge generate`, a complete RAG framework is created:

```
my-rag-project/
├── ragforge.config.yaml           # Your RAG configuration
├── schema.json                     # Introspected Neo4j schema
├── .env                            # Environment variables
├── package.json                    # Ready to use with npm scripts
├── generated/
│   ├── client.ts                  # Type-safe RAG client
│   ├── index.ts                   # Main exports
│   ├── types.ts                   # TypeScript type definitions
│   │
│   ├── queries/                   # Entity-specific query builders
│   │   ├── scope.ts              # Example: Scope query builder
│   │   ├── file.ts               # Example: File query builder
│   │   └── ...                   # One per entity
│   │
│   ├── scripts/                   # Maintenance scripts
│   │   ├── create-vector-indexes.js    # Setup Neo4j vector indexes
│   │   ├── generate-embeddings.js      # Generate/update embeddings
│   │   └── rebuild-agent.ts            # Rebuild MCP agent docs
│   │
│   ├── embeddings/                # Embedding configuration
│   │   └── load-config.js        # Runtime config loader
│   │
│   ├── docs/                      # Generated documentation
│   │   ├── client-reference.md   # Complete API reference
│   │   └── agent-reference.md    # Agent integration guide
│   │
│   ├── examples/                  # Ready-to-run examples
│   │   ├── 01-semantic-search-*.ts      # Semantic search demos
│   │   ├── 02-relationship-*.ts         # Relationship traversal
│   │   ├── 03-llm-reranking.ts          # LLM-based reranking
│   │   └── ...                          # Many more examples
│   │
│   ├── agent.ts                   # MCP agent factory
│   ├── documentation.ts           # Embedded documentation
│   └── packages/runtime/          # Standalone runtime copy
│
└── node_modules/                  # Dependencies (auto-installed)
```

### What You Get

**Type-Safe Client** (`client.ts`):
```typescript
import { createRagClient } from './generated/client.js';

const rag = createRagClient({
  neo4j: {
    uri: process.env.NEO4J_URI,
    username: process.env.NEO4J_USERNAME,
    password: process.env.NEO4J_PASSWORD
  }
});

// Fluent API with autocomplete
const results = await rag
  .scope()
  .semanticSearchBySource('authentication logic', { topK: 10 })
  .whereType('function')
  .execute();
```

**Query Builders** (`queries/*.ts`):
- One file per entity type
- Semantic search methods for each vector index
- Relationship filters based on your graph
- Type-safe parameters with autocomplete

**Embedding Scripts** (`scripts/*.js`):
```bash
# Create vector indexes in Neo4j
npm run embeddings:index

# Generate embeddings for all entities
npm run embeddings:generate
```

**Examples** (`examples/*.ts`) - **Auto-generated from YOUR data**:

RagForge introspects your actual database and generates working examples with real data:

- **`01-semantic-search-*.ts`** - One per vector index (e.g., `01-semantic-search-content.ts`, `02-semantic-search-title.ts`)
- **`0X-relationship-*.ts`** - One per relationship type (e.g., `03-relationship-references.ts`, `04-relationship-authored_by.ts`)
- **`0X-llm-reranking.ts`** - Semantic search + LLM-based relevance reranking
- **`0X-metadata-tracking.ts`** - Pipeline observability and debugging
- **`0X-complex-pipeline.ts`** - Multi-stage queries combining all features
- **`0X-conditional-search.ts`** - Dynamic search strategies
- **`0X-breadth-first.ts`** - Graph exploration patterns
- **`0X-stopping-criteria.ts`** - Advanced result filtering

**All examples use**:
- Real entity names from your database
- Actual field values that exist in your data
- Working relationship examples guaranteed to return results
- Your configured vector index names

**How to run examples**:
```bash
# Using npm scripts (available: basic, semantic)
npm run examples:basic
npm run examples:semantic

# Or run any generated example directly
tsx examples/01-semantic-search-content.ts
tsx examples/03-relationship-references.ts
tsx examples/08-llm-reranking.ts
# ... and all the others!
```

**Documentation** (`docs/*.md`):
- Complete API reference
- All available methods and filters
- Example queries for each entity
- MCP agent integration guide

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Test
npm test

# Lint
npm run lint
```

## Part of RagForge

This package is part of the [RagForge](https://github.com/LuciformResearch/ragforge) meta-framework.

**Related Packages:**
- [`@luciformresearch/ragforge-core`](https://www.npmjs.com/package/@luciformresearch/ragforge-core) - Schema analysis and code generation
- [`@luciformresearch/ragforge-runtime`](https://www.npmjs.com/package/@luciformresearch/ragforge-runtime) - Runtime library for executing RAG queries

## License

LRSL v1.1 - See [LICENSE](./LICENSE) file for details.
