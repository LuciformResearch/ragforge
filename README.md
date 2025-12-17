# RagForge

**Universal RAG Agent with Persistent Local Brain**

> Transform any codebase, documents, or web content into a searchable knowledge graph with AI-powered tools.

### License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

- **Free to use for:** Research, education, personal projects, freelance/small-scale (≤ €100k/month revenue)
- **Commercial use above threshold** requires separate agreement
- **Contact:** [legal@luciformresearch.com](mailto:legal@luciformresearch.com)
- **Full text:** [LICENSE](./LICENSE)

---

## What is RagForge?

RagForge is an **AI agent framework** with a **local persistent brain** (`~/.ragforge`):

- **Daemon architecture** - Wakes on demand, shuts down cleanly
- **File watching** - Incremental ingestion on file changes
- **Diff-aware updates** - Only re-parse what changed
- **Multi-project support** - Work on multiple codebases simultaneously
- **Optimized for scale** - Handles very large projects efficiently

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT BRAIN (~/.ragforge)              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Neo4j + Embeddings               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │Project A │ │Quick     │ │Web Pages │            │   │
│  │  │(code)    │ │Ingest    │ │(docs)    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │                     ↓                               │   │
│  │         Unified Semantic Search                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  FILE WATCHER → Incremental Ingestion → Graph Update       │
└─────────────────────────────────────────────────────────────┘
```

---

## Ingestion Capabilities

### Code
| Language | Parser |
|----------|--------|
| TypeScript, TSX | Full AST with scope extraction |
| JavaScript, JSX | Full AST parsing |
| Python | AST with class/function extraction |
| Vue, Svelte | SFC parsing with script extraction |
| HTML, CSS, SCSS | Structure extraction |
| Other languages | Regex-based fallback parser |

### Documents
| Format | Method |
|--------|--------|
| PDF | Tika + Gemini Vision fallback |
| DOCX | Native parsing |
| XLSX | Sheet/cell extraction |
| Markdown | Section/heading parsing |
| JSON, YAML | Structure extraction |
| CSV | Row/column parsing |

### 3D & Media
| Format | Features |
|--------|----------|
| glTF, GLB | Metadata + multi-view rendering |
| OBJ | Geometry extraction |
| Images (PNG, JPG...) | OCR + Vision + Embeddings |

### Web
| Feature | Description |
|---------|-------------|
| Web crawling | Recursive depth with link following |
| JS rendering | Playwright for dynamic pages |
| Grounding | Web search for real-time info |
| LRU cache | Last 6 pages for quick re-access |

---

## Search & Understanding

| Feature | Description |
|---------|-------------|
| **Semantic Search** | Ultra-fast vector embeddings via Gemini |
| **Fuzzy Search** | Levenshtein matching without ingestion |
| **Smart Grep** | Regex search across all files |
| **Signature filtering** | Filter by function signature, docstring, type |
| **Custom Cypher** | Direct graph queries |
| **Consistency locks** | Search blocked during ingestion for coherence |

---

## Agentic Capabilities

Compatible with local models and cloud APIs:

| Feature | Description |
|---------|-------------|
| **Structured queries** | Prompts applied to responses |
| **Batch processing** | Efficient bulk operations |
| **File editing** | Read/write/edit with auto-ingest |
| **Shell execution** | Whitelisted commands |
| **Recursive sub-agents** | Spawn agents for complex tasks |
| **MCP exposure** | Full tool access for advanced models |

### ResearchAgent

The **ResearchAgent** is an autonomous agent optimized for codebase exploration and documentation.

**Usage via MCP** (from Claude or other clients):
```
call_research_agent({ question: "How does authentication work?" })
```

**What it does:**
- Searches the knowledge graph with `brain_search`
- Reads relevant files automatically
- Explores code relationships with `explore_node`
- Builds a comprehensive markdown report with citations
- Returns confidence level (high/medium/low)

**Example output:**
```
{
  "report": "# Authentication System\n\n## Overview\n...",
  "confidence": "high",
  "sourcesUsed": ["src/auth.ts", "src/middleware/jwt.ts"],
  "toolsUsed": ["brain_search", "read_file", "explore_node"],
  "iterations": 3
}
```

---

## Media Generation

| Tool | Description |
|------|-------------|
| `generate_image` | Text-to-image via Gemini |
| `edit_image` | AI-powered image editing |
| `generate_multiview_images` | 4 coherent views for 3D |
| `generate_3d_from_text` | Full text-to-3D pipeline |
| `generate_3d_from_image` | Image-to-3D via Trellis |
| `render_3d_asset` | Multi-view 3D rendering |
| `analyze_3d_model` | Vision analysis of 3D assets |

---

## Quick Start

### Prerequisites

- **Docker** - Required for Neo4j database
  - [Install Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS)
  - Or `sudo apt install docker.io` (Linux)

### 1. Install

```bash
npm install -g @luciformresearch/ragforge-cli
```

### 2. Setup (Docker + Neo4j)

```bash
ragforge setup
```

This will:
- ✅ Check Docker is installed and running
- ✅ Create a Neo4j container (`ragforge-neo4j`)
- ✅ Configure `~/.ragforge/.env` automatically

**Options:**
```bash
ragforge setup --password myPassword  # Custom Neo4j password
ragforge setup --force                # Recreate container
```

### 3. Add your API key

```bash
# Add to ~/.ragforge/.env
GEMINI_API_KEY=your-gemini-key        # Required for embeddings & search
REPLICATE_API_TOKEN=your-token        # Optional, for 3D generation
```

### 4. Use with Claude (MCP)

Add RagForge to your Claude configuration (see [MCP Server](#mcp-server) section), then ask Claude:

```
"Use brain_search to find authentication code"
"Ingest the ./src directory"
"Call the research agent to explain the database layer"
```

---

## MCP Server

RagForge exposes all tools via **Model Context Protocol** for use with Claude, GPT, and other MCP-compatible clients.

### Setup for Claude Code (CLI)

1. **Build RagForge** (if from source):
```bash
cd ragforge && npm install && npm run build
```

2. **Add to Claude Code config** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ragforge": {
      "command": "node",
      "args": ["/path/to/ragforge/packages/cli/dist/mcp.js"],
      "env": {
        "GEMINI_API_KEY": "your-key"
      }
    }
  }
}
```

3. **Restart Claude Code** and verify tools are available:
```
/mcp
```

### Setup for Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

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

### Using RagForge from Claude

Once connected, you can ask Claude to use RagForge tools:

```
"Use brain_search to find authentication code in my project"
"Ingest the ./src directory and search for API endpoints"
"Call the research agent to explain how the database layer works"
```

**Key tools available via MCP:**

| Category | Tools |
|----------|-------|
| **Search** | `brain_search`, `grep_files`, `search_files` |
| **Files** | `read_file`, `write_file`, `edit_file`, `delete_path` |
| **Ingestion** | `ingest_directory`, `ingest_web_page`, `forget_path` |
| **Agent** | `call_research_agent` (autonomous research) |
| **Git** | `run_command`, `git_status`, `git_diff` |
| **Media** | `generate_image`, `generate_3d_from_text`, `render_3d_asset` |
| **Web** | `fetch_web_page`, `search_web` |
| **Admin** | `exclude_project`, `include_project`, `list_brain_projects` |

---

## Project Structure

```
ragforge/
├── packages/
│   ├── core/              # Main package
│   │   ├── src/
│   │   │   ├── brain/           # BrainManager, knowledge persistence
│   │   │   ├── runtime/
│   │   │   │   ├── adapters/    # File parsers (code, docs, media, web)
│   │   │   │   ├── agents/      # RAG agent implementation
│   │   │   │   ├── projects/    # ProjectRegistry, multi-project
│   │   │   │   └── ingestion/   # Incremental ingestion, file watcher
│   │   │   └── tools/           # Agent tools (file, image, 3D, web, brain)
│   │   └── defaults/            # Default YAML configs
│   │
│   └── cli/               # CLI commands (agent, mcp, ingest)
│
├── docs/project/          # Design docs and session notes
└── examples/              # Example projects
```

---

## Roadmap

- [x] Persistent brain with Neo4j
- [x] Universal file ingestion
- [x] Semantic search with embeddings
- [x] Web crawling & grounding
- [x] Image & 3D generation
- [x] MCP server integration
- [x] Project exclusion from search
- [ ] Local model support (Ollama)
- [ ] API crawler (Swagger/OpenAPI)
- [ ] Database crawler (schema extraction)
- [ ] Terminal UI with Ink (React)
- [ ] Collaborative multi-agent workflows

---

## Development

```bash
# Clone and install
git clone https://github.com/LuciformResearch/ragforge
cd ragforge
npm install

# Build all packages
npm run build

# Run tests
npm test
```

---

## Links

- [GitHub Repository](https://github.com/LuciformResearch/ragforge)
- [npm Packages](https://www.npmjs.com/search?q=%40luciformresearch%2Fragforge)

---

**#RAGForge #LuciformResearch #RAG #LLM #Agentic #DevTools #AIEngineering #Neo4j #MCP**
