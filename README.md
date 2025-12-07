# RagForge

**Universal RAG Agent with Persistent Memory**

> Transform any codebase, documents, or web content into a searchable knowledge graph with AI-powered tools.

### License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

- **Free to use for:** Research, education, personal projects, freelance/small-scale (≤ €100k/month revenue)
- **Commercial use above threshold** requires separate agreement
- **Contact:** [legal@luciformresearch.com](mailto:legal@luciformresearch.com)
- **Full text:** [LICENSE](./LICENSE)

---

## What is RagForge?

RagForge is an **AI agent framework** with:

- **Persistent Brain** - Neo4j-backed knowledge graph that remembers everything
- **Universal Ingestion** - Code, documents, images, 3D models, web pages
- **Semantic Search** - Vector embeddings for meaning-based queries
- **Media Tools** - Generate images and 3D models from text
- **Web Crawling** - Fetch and ingest web pages with recursive depth
- **Multi-Project Support** - Work on multiple codebases simultaneously

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT BRAIN                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Neo4j                             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │Project A │ │Quick     │ │Web Pages │            │   │
│  │  │(code)    │ │Ingest    │ │(docs)    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │                     ↓                               │   │
│  │         Unified Semantic Search                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  AGENT TOOLS                                                │
│  • brain_search      - Search across all knowledge          │
│  • ingest_directory  - Ingest any folder                    │
│  • fetch_web_page    - Fetch & crawl web pages              │
│  • generate_image    - Text-to-image (Gemini)               │
│  • generate_3d       - Text/image-to-3D (Trellis)           │
│  • write_file        - Create/edit files with auto-ingest   │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install

```bash
npm install -g @luciformresearch/ragforge-cli
```

### 2. Setup credentials

```bash
# ~/.ragforge/.env (global) or project/.ragforge/.env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
GEMINI_API_KEY=your-gemini-key        # For embeddings & image gen
REPLICATE_API_TOKEN=your-token        # For 3D generation (optional)
```

### 3. Talk to the agent

```bash
# Ask a question about your codebase (runs in current directory)
ragforge agent --ask "What functions handle authentication?"

# Create a new project
ragforge agent --ask "Create a TypeScript project called my-api"

# Setup an existing codebase
ragforge agent --ask "Setup this codebase for RAG"

# Query the knowledge graph
ragforge agent --ask "Show me all classes that implement BaseController"

# Generate code
ragforge agent --ask "Add a new endpoint for user registration"
```

The agent will:
- Auto-load the project from current directory (if `.ragforge/` exists)
- Create/setup projects on demand via natural language
- Query Neo4j knowledge graph with semantic search
- Read/write/edit files with auto-ingestion

### Agent options

```bash
# Specify a different project directory
ragforge agent --project /path/to/project --ask "..."

# Use a specific model
ragforge agent --model gemini-2.0-flash --ask "..."

# Verbose mode for debugging
ragforge agent --verbose --ask "..."

# Custom persona
ragforge agent --persona "A friendly assistant named Raggy" --ask "..."
```

---

## Features

### Code Analysis
- **TypeScript, Python, Vue, Svelte** - Full AST parsing with scope extraction
- **Incremental ingestion** - Only re-parse changed files
- **Cross-file relationships** - Track imports, calls, references
- **Semantic search** - Find code by meaning, not just keywords

### Document Ingestion
- **PDF, DOCX, XLSX** - Via Tika or Gemini Vision
- **Markdown, JSON, YAML, CSV** - Native parsing
- **Images** - OCR + visual description via Gemini Vision
- **3D Models** - GLB/GLTF metadata extraction

### Web Knowledge
- **`fetch_web_page`** - Render JS-heavy pages with Playwright
- **Recursive crawl** - Follow links with `depth` parameter
- **LRU cache** - Last 6 pages cached for quick re-access
- **`ingest_web_page`** - Save to brain for long-term memory

### Media Generation
- **`generate_image`** - Text-to-image via Gemini
- **`generate_multiview_images`** - 4 coherent views for 3D reconstruction
- **`generate_3d_from_image`** - Image-to-3D via Trellis (Replicate)
- **`render_3d_asset`** - Render GLB to images with Three.js

### Agent Brain
- **Persistent memory** - Neo4j knowledge graph
- **Cross-project search** - Query all loaded knowledge
- **UUID deduplication** - Deterministic IDs prevent duplicates
- **File watching** - Auto-ingest on file changes

---

## Project Structure

```
ragforge/
├── packages/
│   ├── core/              # Main package (merged core + runtime)
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
│   ├── cli/               # CLI commands (agent, ingest, quickstart)
│   └── runtime/           # Shim for backwards compatibility
│
├── docs/
│   └── project/           # Design docs and roadmaps
│       └── 7-dec-11h29-2025/   # Latest session docs
│
└── examples/              # Example projects
```

---

## Key Tools

| Tool | Description |
|------|-------------|
| `brain_search` | Search across all ingested knowledge |
| `ingest_directory` | Quick-ingest any folder into the brain |
| `fetch_web_page` | Fetch & render web pages (supports `depth` for crawling) |
| `ingest_web_page` | Save web page to brain permanently |
| `generate_image` | Generate image from text prompt |
| `generate_3d_from_text` | Generate 3D model from description |
| `write_file` / `edit_file` | Create/modify files with auto-ingestion |
| `query_entities` | Query the knowledge graph with conditions |
| `semantic_search` | Vector similarity search |

---

## Documentation

- **[Session 7 Dec 2025](./docs/project/7-dec-11h29-2025/README.md)** - Latest development status
- **[Agent Brain Roadmap](./docs/project/7-dec-11h29-2025/ROADMAP-AGENT-BRAIN.md)** - Brain architecture
- **[Media Tools](./docs/project/MEDIA-TOOLS.md)** - Image & 3D generation
- **[Universal Ingestion](./docs/project/UNIVERSAL-FILE-INGESTION.md)** - File type support

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
