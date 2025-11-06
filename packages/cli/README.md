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

```bash
# 1. Initialize project (introspects database)
ragforge init --project code-rag --out ./my-code-rag

cd my-code-rag

# 2. Edit ragforge.config.yaml to customize entities, fields, etc.

# 3. Regenerate client with auto-detection
ragforge generate \
  --config ./ragforge.config.yaml \
  --out ./generated \
  --auto-detect-fields

# 4. Create vector indexes
ragforge embeddings:index --config ./ragforge.config.yaml

# 5. Generate embeddings
ragforge embeddings:generate --config ./ragforge.config.yaml

# 6. Use the generated client
npm install
tsx ./examples/basic-query.ts
```

## Generated Project Structure

```
my-rag-project/
├── ragforge.config.yaml       # Configuration
├── schema.json                 # Neo4j schema
├── .env                        # Credentials
├── package.json                # Dependencies
├── generated/
│   ├── client.ts              # Main client
│   ├── types.ts               # TypeScript types
│   ├── queries/               # Entity query builders
│   ├── scripts/               # Embedding scripts
│   ├── embeddings/            # Config loader
│   ├── docs/                  # API documentation
│   ├── agent.ts               # MCP agent template
│   └── packages/runtime/      # Standalone runtime
└── examples/
    ├── basic-query.ts
    └── semantic-search.ts
```

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
