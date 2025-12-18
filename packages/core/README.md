# @luciformresearch/ragforge

**Core library for RagForge - Universal RAG Agent with Persistent Local Brain**

### License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

- **Free to use for:** Research, education, personal projects, freelance/small-scale (≤ €100k/month revenue)
- **Commercial use above threshold** requires separate agreement
- **Contact:** [legal@luciformresearch.com](mailto:legal@luciformresearch.com)
- **Full text:** [LICENSE](./LICENSE)

---

## Features

### Brain Manager
Persistent knowledge graph with Neo4j:
- Multi-project support with automatic switching
- File watching with incremental ingestion
- Diff-aware updates (only re-parse what changed)
- Daemon architecture (wakes on demand, shuts down cleanly)
- Project exclusion from search

### Universal Ingestion

**Code:**
- TypeScript, JavaScript, TSX, JSX (full AST)
- Python (AST with scope extraction)
- Vue, Svelte (SFC parsing)
- HTML, CSS, SCSS
- Regex-based fallback for exotic types

**Documents:**
- PDF (Tika + Gemini Vision fallback)
- DOCX, XLSX (native parsing)
- Markdown (section/heading extraction)
- JSON, YAML, CSV

**Media:**
- Images (OCR + Vision + Embeddings)
- 3D models (glTF, GLB, OBJ) with multi-view rendering

**Web:**
- Recursive crawling with depth control
- JS rendering via Playwright
- Grounding for web search
- LRU cache (last 6 pages)

### Search & Understanding

- **Semantic Search** - Ultra-fast vector embeddings via Gemini
- **Fuzzy Search** - Levenshtein matching without ingestion
- **Smart Grep** - Regex search across all files
- **Signature filtering** - Filter by function signature, docstring, type
- **Custom Cypher** - Direct Neo4j graph queries
- **Consistency locks** - Search blocked during ingestion

### Agent Tools

| Category | Tools |
|----------|-------|
| **Brain** | `brain_search`, `ingest_directory`, `ingest_web_page`, `forget_path` |
| **Files** | `read_file`, `write_file`, `edit_file`, `create_file`, `delete_path` |
| **Shell** | `run_command`, `run_npm_script`, `git_status`, `git_diff` |
| **Media** | `generate_image`, `edit_image`, `read_image`, `describe_image` |
| **3D** | `generate_3d_from_text`, `generate_3d_from_image`, `render_3d_asset`, `analyze_3d_model` |
| **Web** | `fetch_web_page`, `search_web` |
| **Project** | `create_project`, `list_projects`, `switch_project`, `exclude_project` |

### Agentic Capabilities

- Structured queries with prompts applied to responses
- Batch processing for efficient bulk operations
- Recursive sub-agents for complex tasks
- MCP exposure for advanced model integration
- Compatible with local and cloud models

---

## Installation

```bash
npm install @luciformresearch/ragforge
```

---

## Usage

### BrainManager

```typescript
import { BrainManager } from '@luciformresearch/ragforge';

// Get singleton instance
const brain = await BrainManager.getInstance();

// Ingest a directory
await brain.quickIngest('/path/to/project', {
  projectName: 'my-project',
  generateEmbeddings: true,
});

// Search across all projects
const results = await brain.search({
  query: 'authentication handler',
  semantic: true,
  limit: 10,
});

// Exclude a project from search
await brain.excludeProject('noisy-project-id');
```

### RagAgent

```typescript
import { createRagAgent } from '@luciformresearch/ragforge';

const agent = await createRagAgent({
  brain: await BrainManager.getInstance(),
  model: 'gemini-2.0-flash',
});

// Chat with the agent
const response = await agent.chat('What functions handle user login?');
```

### MCP Tools

```typescript
import { generateBrainTools, generateBrainToolHandlers } from '@luciformresearch/ragforge';

const brain = await BrainManager.getInstance();
const tools = generateBrainTools();
const handlers = generateBrainToolHandlers({ brain });

// Use with MCP server
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name];
  return handler(request.params.arguments);
});
```

---

## Project Structure

```
src/
├── brain/              # BrainManager, project registry
├── runtime/
│   ├── adapters/       # File parsers (code, docs, media, web)
│   ├── agents/         # RagAgent implementation
│   ├── embedding/      # Gemini embedding provider
│   ├── ingestion/      # Incremental ingestion, file watcher
│   └── projects/       # ProjectRegistry, project switching
├── tools/              # All agent tools
│   ├── brain-tools.ts
│   ├── file-tools.ts
│   ├── shell-tools.ts
│   ├── media-tools.ts
│   └── web-tools.ts
└── defaults/           # Default YAML configs
```

---

## Related Packages

- [`@luciformresearch/ragforge-cli`](https://www.npmjs.com/package/@luciformresearch/ragforge-cli) - Command-line interface and MCP server
- [`@luciformresearch/ragforge-studio`](https://www.npmjs.com/package/@luciformresearch/ragforge-studio) - Desktop app with setup wizard and graph explorer

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

## License

LRSL v1.1 - See [LICENSE](./LICENSE) file for details.
