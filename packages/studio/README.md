# RagForge Studio

**The easiest way to get started with RagForge** - A desktop app that guides you through setup and lets you explore your knowledge graph visually.

## What is RagForge Studio?

RagForge Studio is a desktop application that:

1. **Guides installation** - Walks you through Docker and Neo4j setup
2. **Manages the brain** - Start/stop Neo4j, configure API keys
3. **Visual graph explorer** - Browse and search your knowledge graph
4. **Integrated search** - Test brain_search with semantic and keyword modes

## Quick Start

### Option 1: Install from npm

```bash
npm install -g @luciformresearch/ragforge-studio
```

This will also install `@luciformresearch/ragforge-cli` which provides the `ragforge` command.

### Option 2: Run from source

```bash
git clone https://github.com/LuciformResearch/ragforge
cd ragforge
npm install
npm run build
npm run studio:dev
```

## First Launch

When you first open RagForge Studio, it will guide you through:

1. **Docker Check** - Verifies Docker is installed and running
   - If not installed, provides download links for your OS

2. **Neo4j Setup** - Pulls and starts the Neo4j container
   - Creates `ragforge-neo4j` container automatically
   - Configures ports (7687 for Bolt, 7474 for HTTP)

3. **API Keys** - Configure your Gemini API key
   - Required for semantic search and embeddings
   - Stored securely in `~/.ragforge/.env`

## Features

### Setup Wizard

The setup wizard ensures all prerequisites are met before you start using RagForge:

- Docker installation check
- Neo4j container management (pull, start, stop)
- API key configuration
- Connection testing

### Graph Explorer

Visually explore your knowledge graph:

- **Search** - Use brain_search with semantic or keyword modes
- **Node Types** - View Scopes (functions, classes), Files, Documents, WebPages
- **Relationships** - See CONSUMES, DEFINED_IN, LINKS_TO connections
- **Code Preview** - Expand nodes to see source code with syntax highlighting
- **Depth Exploration** - Discover related nodes automatically

### Dashboard

Monitor your RagForge brain:

- Project statistics
- Node counts by type
- Recent activity

## Using with Claude (MCP)

Once Studio has set up your environment, you can use RagForge with Claude:

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

Then ask Claude:
```
"Ingest the ./src directory"
"Use brain_search to find authentication code"
"Call the research agent to explain the API layer"
```

## Requirements

- **Node.js** >= 18
- **Docker** - For Neo4j database
- **Gemini API Key** - For embeddings and semantic search (get one at [Google AI Studio](https://makersuite.google.com/app/apikey))

## Related Packages

- [`@luciformresearch/ragforge`](https://www.npmjs.com/package/@luciformresearch/ragforge) - Core library
- [`@luciformresearch/ragforge-cli`](https://www.npmjs.com/package/@luciformresearch/ragforge-cli) - CLI and MCP server

## License

**Luciform Research Source License (LRSL) v1.1**

- Free for research, education, personal projects, and small-scale commercial use (≤ €100k/month revenue)
- Commercial use above threshold requires separate agreement
- Contact: [legal@luciformresearch.com](mailto:legal@luciformresearch.com)

---

**[GitHub](https://github.com/LuciformResearch/ragforge)** | **[npm](https://www.npmjs.com/package/@luciformresearch/ragforge-studio)**
