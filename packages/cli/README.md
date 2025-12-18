# @luciformresearch/ragforge-cli

**Command-line interface for RagForge - Universal RAG Agent with Persistent Local Brain**

### License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

- **Free to use for:** Research, education, personal projects, freelance/small-scale (≤ €100k/month revenue)
- **Commercial use above threshold** requires separate agreement
- **Contact:** [legal@luciformresearch.com](mailto:legal@luciformresearch.com)
- **Full text:** [LICENSE](./LICENSE)

---

## Installation

```bash
npm install -g @luciformresearch/ragforge-cli
```

Or use directly with npx:

```bash
npx @luciformresearch/ragforge-cli --help
```

---

## Commands

### `ragforge mcp`

Start the MCP (Model Context Protocol) server for integration with Claude, GPT, and other MCP-compatible clients.

```bash
ragforge mcp
```

**MCP Configuration (claude_desktop_config.json):**

```json
{
  "mcpServers": {
    "ragforge": {
      "command": "ragforge",
      "args": ["mcp"]
    }
  }
}
```

**Available MCP Tools:**

| Category | Tools |
|----------|-------|
| **Brain** | `brain_search`, `ingest_directory`, `ingest_web_page`, `forget_path`, `list_brain_projects` |
| **Files** | `read_file`, `write_file`, `edit_file`, `create_file`, `delete_path`, `move_file`, `copy_file` |
| **Directory** | `list_directory`, `glob_files`, `grep_files`, `search_files`, `file_exists`, `get_file_info` |
| **Shell** | `run_command`, `run_npm_script`, `git_status`, `git_diff` |
| **Media** | `generate_image`, `edit_image`, `read_image`, `describe_image`, `list_images` |
| **3D** | `generate_3d_from_text`, `generate_3d_from_image`, `generate_multiview_images`, `render_3d_asset`, `analyze_3d_model` |
| **Web** | `fetch_web_page`, `search_web` |
| **Project** | `create_project`, `list_projects`, `switch_project`, `unload_project`, `exclude_project`, `include_project` |
| **Config** | `get_working_directory`, `get_environment_info`, `get_project_info`, `get_brain_status` |
| **Admin** | `set_api_key`, `cleanup_brain`, `run_cypher` |

---

### `ragforge agent`

Run the AI agent for natural language interaction with your codebase.

```bash
# Ask a question
ragforge agent --ask "What functions handle authentication?"

# Create a project
ragforge agent --ask "Create a TypeScript project called my-api"

# Use a specific model
ragforge agent --model gemini-2.0-flash --ask "Explain this codebase"

# Verbose mode
ragforge agent --verbose --ask "Find all TODO comments"
```

**Options:**
- `--ask <prompt>` - Question or task for the agent
- `--project <path>` - Project directory (default: current directory)
- `--model <name>` - Model to use (default: gemini-2.0-flash)
- `--persona <text>` - Custom persona for the agent
- `--verbose` - Enable verbose logging

---

### `ragforge ingest`

Manually ingest a directory into the brain.

```bash
# Ingest current directory
ragforge ingest

# Ingest specific path
ragforge ingest --path /path/to/project

# With custom name
ragforge ingest --path ./docs --name my-docs

# Generate embeddings
ragforge ingest --path ./src --embeddings
```

**Options:**
- `--path <dir>` - Directory to ingest (default: current directory)
- `--name <name>` - Custom project name
- `--embeddings` - Generate embeddings for semantic search
- `--watch` - Watch for file changes after ingestion

---

### `ragforge setup`

Setup Docker and Neo4j for RagForge.

```bash
ragforge setup
```

This will:
- Check Docker is installed and running
- Create a Neo4j container (`ragforge-neo4j`)
- Configure `~/.ragforge/.env` automatically

**Options:**
```bash
ragforge setup --password myPassword  # Custom Neo4j password
ragforge setup --force                # Recreate container
```

> **Tip:** For a visual guided setup, use [RagForge Studio](https://www.npmjs.com/package/@luciformresearch/ragforge-studio) instead.

---

## Configuration

### Environment Variables

Create `~/.ragforge/.env` (global) or `.ragforge/.env` (project-local):

```env
# Neo4j (required)
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password

# Gemini (required for embeddings, search, image generation)
GEMINI_API_KEY=your-gemini-key

# Replicate (optional, for 3D generation)
REPLICATE_API_TOKEN=your-replicate-token
```

### Brain Location

The brain persists in `~/.ragforge/`:
- `projects.yaml` - Registered projects
- `neo4j/` - Docker container data (if using auto-setup)
- `.env` - Global credentials

---

## Features

### Persistent Local Brain
- **Daemon architecture** - Wakes on demand, shuts down cleanly
- **File watching** - Incremental ingestion on file changes
- **Diff-aware updates** - Only re-parse what changed
- **Multi-project support** - Work on multiple codebases simultaneously
- **Project exclusion** - Temporarily hide projects from search

### Universal Ingestion

**Code:** TypeScript, JavaScript, Python, Vue, Svelte, HTML, CSS, and more (with regex fallback)

**Documents:** PDF, DOCX, XLSX, Markdown, JSON, YAML, CSV

**Media:** Images (OCR + Vision), 3D models (glTF, GLB, OBJ)

**Web:** Recursive crawling, JS rendering, grounding search

### Search & Understanding

- **Semantic Search** - Vector embeddings via Gemini
- **Fuzzy Search** - Levenshtein matching
- **Smart Grep** - Regex across all files
- **Custom Cypher** - Direct Neo4j queries

### Media Generation

- **Images** - Text-to-image, editing via Gemini
- **3D Models** - Text/image-to-3D via Trellis

---

## Legacy Commands

These commands are for the legacy code generation workflow:

### `ragforge init`

Bootstrap a new RAG project by introspecting Neo4j.

```bash
ragforge init --project my-project --out ./output
```

### `ragforge introspect`

Analyze Neo4j database and generate YAML configuration.

```bash
ragforge introspect --project my-project --out ./output
```

### `ragforge generate`

Generate type-safe client from YAML configuration.

```bash
ragforge generate --config ./ragforge.config.yaml --out ./generated
```

### `ragforge embeddings:index`

Create vector indexes in Neo4j.

```bash
ragforge embeddings:index --config ./ragforge.config.yaml
```

### `ragforge embeddings:generate`

Generate embeddings for configured indexes.

```bash
ragforge embeddings:generate --config ./ragforge.config.yaml
```

---

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Test
npm test
```

---

## Part of RagForge

This package is part of the [RagForge](https://github.com/LuciformResearch/ragforge) framework.

**Related Packages:**
- [`@luciformresearch/ragforge`](https://www.npmjs.com/package/@luciformresearch/ragforge) - Core library
- [`@luciformresearch/ragforge-studio`](https://www.npmjs.com/package/@luciformresearch/ragforge-studio) - Desktop app with setup wizard and graph explorer

---

## License

LRSL v1.1 - See [LICENSE](./LICENSE) file for details.
