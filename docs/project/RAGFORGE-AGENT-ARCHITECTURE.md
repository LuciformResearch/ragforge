# RagForge Agent Architecture

## Overview

The RagForge Agent is an AI-powered CLI tool that can:
- Create and manage RagForge projects
- Edit code with file tools
- Query the knowledge graph with RAG tools
- Self-heal (detect missing embeddings and generate them)

## Key Components

### 1. Mutable Context (`AgentProjectContext`)

```typescript
interface AgentProjectContext {
  currentProjectPath: string | null;
  generatedPath: string | null;
  ragClient: RagClient | null;
  isProjectLoaded: boolean;
  dev: boolean;
  rootDir: string;
}
```

The context is **shared by all tools** and allows dynamic project switching:
- `create_project` → auto-loads the new project into context
- `setup_project` → auto-loads after setup
- `load_project` → explicitly loads an existing project
- File tools check `ctx.isProjectLoaded` before executing

### 2. Project Tools

| Tool | Description | Updates Context |
|------|-------------|-----------------|
| `create_project` | Creates new TypeScript project with RAG | ✅ Auto-loads |
| `setup_project` | Runs quickstart (Neo4j, ingestion) | ✅ Auto-loads |
| `load_project` | Loads existing project | ✅ |
| `ingest_code` | Re-ingests code into graph | ❌ |
| `generate_embeddings` | Creates vector indexes + embeddings | ❌ |

### 3. Self-Healing Behaviors

#### Missing Embeddings Detection
When `semantic_search` fails with "no such vector schema index":
```json
{
  "error": "Embeddings not found for index \"scopeSourceEmbeddings\"...",
  "suggestion": "generate_embeddings",
  "index_missing": "scopeSourceEmbeddings"
}
```
The agent understands this and calls `generate_embeddings` automatically.

#### Future: Docker Auto-Restart
TODO: Detect Neo4j connection failures and offer to restart Docker.

### 4. Logging System

Logs are written to `.ragforge/generated/logs/agent-{timestamp}.json`:

```json
{
  "sessionId": "session_1765025559091",
  "question": "What functions exist?",
  "startTime": "2025-12-06T13:52:39.091+01:00",
  "endTime": "2025-12-06T13:53:11.040+01:00",
  "mode": "structured",
  "tools": ["get_schema", "semantic_search", ...],
  "toolsUsed": ["get_schema", "semantic_search"],
  "entries": [
    {
      "timestamp": "2025-12-06T13:52:41.690+01:00",
      "type": "tool_call",
      "data": { "toolName": "get_schema", "arguments": {} }
    },
    {
      "timestamp": "2025-12-06T13:52:41.690+01:00",
      "type": "tool_result",
      "data": { "toolName": "get_schema", "result": {...}, "durationMs": 5 }
    },
    {
      "timestamp": "2025-12-06T13:53:11.040+01:00",
      "type": "tool_result",
      "data": {
        "toolName": "semantic_search",
        "error": "Authentication failure",
        "durationMs": 272,
        "success": false
      }
    }
  ]
}
```

Key features:
- **Local timestamps** with timezone offset (`+01:00`)
- **Error logging** - tool errors and final errors are captured
- **Written on error** - log is saved even if agent fails
- Uses `formatLocalDate()` from `runtime/utils/timestamp.ts`

## File Structure

```
packages/cli/src/commands/agent.ts
├── AgentProjectContext          # Mutable shared context
├── loadProjectIntoContext()     # Load project into context
├── createProjectHandler()       # Wraps runCreate + auto-loads
├── createSetupHandler()         # Wraps runQuickstart + auto-loads
├── createLoadProjectHandler()   # Load existing project
├── createIngestHandler()        # Run npm run ingest
├── createEmbeddingsHandler()    # Run embeddings:index + generate
├── createDummyRagClient()       # Proxy that uses mutable context
└── createRagForgeAgent()        # Main factory function

packages/core/src/tools/project-tools.ts
├── generateCreateProjectTool()
├── generateSetupProjectTool()
├── generateIngestCodeTool()
├── generateEmbeddingsTool()
├── generateLoadProjectTool()    # NEW
└── generateProjectTools()       # Combines all with handlers

packages/core/src/runtime/agents/rag-agent.ts
├── AgentLogger                  # Session logging
│   ├── logToolCall()
│   ├── logToolResult()
│   ├── logToolError()           # NEW - logs errors immediately
│   ├── logError()               # NEW - logs final errors
│   └── flush()                  # NEW - force write
├── GeneratedToolExecutor        # Executes tools with error handling
└── RagAgent.ask()               # Main entry with try/catch logging
```

## Usage

### Create and work on a new project
```bash
cd /path/to/workspace
ragforge agent --dev --ask "Create a new TypeScript project called my-api, then add a hello world function"
```

### Query an existing project
```bash
cd /path/to/existing-project
ragforge agent --ask "Find all functions that handle authentication"
```

### Load a different project
```bash
ragforge agent --ask "Load project at /path/to/other-project, then show me the schema"
```

## Known Issues / TODO

1. **File tools path resolution** - After `create_project`, file tools may use wrong `projectRoot`
2. **API key propagation** - GEMINI_API_KEY not always copied to project .env in dev mode
3. **Docker restart** - Agent should detect Neo4j down and offer to restart Docker

## Timestamp Utilities

```typescript
import { formatLocalDate, getFilenameTimestamp, getLocalTimestamp } from '@luciformresearch/ragforge';

// Returns: "2025-12-06T13:52:39.091+01:00"
formatLocalDate();

// Returns: "2025-12-06T13-52-39-091+01-00" (safe for filenames)
getFilenameTimestamp();
```
