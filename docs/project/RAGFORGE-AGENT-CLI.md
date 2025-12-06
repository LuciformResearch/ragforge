# RagForge Agent CLI

**Date**: 2025-12-06
**Status**: Planned
**Author**: Lucie Defraiteur

---

## Vision

Un seul point d'entrée pour tout faire avec RagForge:

```bash
ragforge agent
```

L'agent peut:
1. Créer des projets
2. Setup Neo4j + ingestion
3. Re-ingérer le code
4. Générer des embeddings
5. Travailler sur le code (read/write/edit)
6. Requêter le knowledge graph (RAG tools)

---

## User Experience

```bash
# Lancer l'agent (mode interactif)
$ ragforge agent

🤖 RagForge Agent ready!
   Project: (no project loaded)
   Commands: create, setup, ingest, embeddings, or ask anything

> Create a new TypeScript project called "my-api" with express

Creating project "my-api"...
✓ Project created at ./my-api
✓ Neo4j container started
✓ Code ingested (15 files, 42 scopes)
✓ Embeddings generated

Project loaded: my-api
You can now ask me about the code or make changes.

> Add a health check endpoint to the server

Reading src/server.ts...
Found Express app initialization at line 12.
Adding health check endpoint...
✓ Modified src/server.ts
✓ Re-ingested src/server.ts

> What functions call the database?

Searching for database-related code...
Found 3 functions that interact with the database:
1. getUserById (src/services/user.ts:24)
2. createUser (src/services/user.ts:45)
3. updateUser (src/services/user.ts:67)
```

---

## Architecture

### Agent Tools

| Tool | Description | Source |
|------|-------------|--------|
| `create_project` | Create new ragforge project | CLI command |
| `setup_project` | Setup Neo4j + initial ingestion | CLI command |
| `ingest_code` | Re-ingest code into graph | CLI command |
| `generate_embeddings` | Generate vector embeddings | CLI command |
| `query_entities` | Query entities with filters | RAG tools |
| `semantic_search` | Vector similarity search | RAG tools |
| `explore_relationships` | Navigate graph | RAG tools |
| `get_schema` | Get graph schema | RAG tools |
| `read_file` | Read file contents | File tools |
| `write_file` | Write/create files | File tools |
| `edit_file` | Edit existing files | File tools |
| `glob_search` | Search by file pattern | File tools |

### Two Modes

#### 1. Standalone Mode (no project)

```bash
ragforge agent
```

- Only project management tools available
- Can create/setup projects
- Once project is loaded, RAG tools become available

#### 2. Project Mode (with project)

```bash
cd my-project
ragforge agent
# or
ragforge agent --project ./my-project
```

- All tools available
- RAG tools connected to project's Neo4j
- File tools scoped to project root

---

## Implementation Plan

### Phase 1: CLI Infrastructure

1. Create `packages/cli/src/commands/agent.ts`
2. Setup readline/terminal interface
3. Implement tool routing

### Phase 2: Project Management Tools

Create `packages/core/src/tools/project-tools.ts`:

```typescript
export interface ProjectToolsContext {
  currentProject: string | null;
  workingDirectory: string;
}

export function generateProjectTools(context: ProjectToolsContext) {
  return {
    create_project: {
      description: "Create a new ragforge project",
      parameters: {
        name: { type: "string", description: "Project name" },
        language: { type: "string", enum: ["typescript", "python"], default: "typescript" },
        template: { type: "string", enum: ["minimal", "express", "fastapi"], optional: true }
      },
      handler: async (params) => {
        // Equivalent to: ragforge create <name> --language <lang>
      }
    },

    setup_project: {
      description: "Setup Neo4j and run initial ingestion",
      parameters: {
        embeddings: { type: "boolean", default: true, description: "Generate embeddings" }
      },
      handler: async (params) => {
        // Equivalent to: ragforge quickstart
      }
    },

    ingest_code: {
      description: "Re-ingest code into Neo4j graph",
      parameters: {
        files: { type: "array", items: { type: "string" }, optional: true }
      },
      handler: async (params) => {
        // Equivalent to: npm run ingest (or single file)
      }
    },

    generate_embeddings: {
      description: "Generate vector embeddings for semantic search",
      parameters: {
        entity: { type: "string", default: "Scope" },
        force: { type: "boolean", default: false }
      },
      handler: async (params) => {
        // Equivalent to: npm run embeddings
      }
    }
  };
}
```

### Phase 3: Agent Integration

1. Combine project tools + RAG tools + file tools
2. Create `RagForgeAgent` class extending `RagAgent`
3. Handle project state transitions

```typescript
// packages/runtime/src/agents/ragforge-agent.ts

export class RagForgeAgent {
  private projectPath: string | null = null;
  private ragClient: RagClient | null = null;
  private neo4jClient: Neo4jClient | null = null;

  constructor(options: RagForgeAgentOptions) {
    // Initialize with project management tools only
  }

  async loadProject(projectPath: string): Promise<void> {
    // Load project config
    // Connect to Neo4j
    // Add RAG tools and file tools
  }

  async ask(prompt: string): Promise<AgentResponse> {
    // Route to appropriate tools based on context
  }
}
```

### Phase 4: Terminal UI

1. Rich terminal interface with colors
2. Progress indicators for long operations
3. Auto-complete for common commands
4. Session persistence (remember last project)

---

## Tool Dependencies

```
┌─────────────────────────────────────────────────────────┐
│                    RagForge Agent                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │   Project    │   │     RAG      │   │    File      │ │
│  │   Tools      │   │    Tools     │   │   Tools      │ │
│  ├──────────────┤   ├──────────────┤   ├──────────────┤ │
│  │create_project│   │query_entities│   │  read_file   │ │
│  │setup_project │   │semantic_searc│   │ write_file   │ │
│  │ ingest_code  │   │explore_relat │   │  edit_file   │ │
│  │gen_embeddings│   │ get_schema   │   │ glob_search  │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
│         │                   │                 │         │
│         ▼                   ▼                 ▼         │
│  ┌──────────────────────────────────────────────────┐   │
│  │                  CLI Commands                    │   │
│  │  (create.ts, quickstart.ts, ingest, embeddings)  │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │                    Neo4j                          │   │
│  │           (Knowledge Graph + Vectors)             │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `packages/cli/src/commands/agent.ts` | Create | Main agent command |
| `packages/core/src/tools/project-tools.ts` | Create | Project management tools |
| `packages/runtime/src/agents/ragforge-agent.ts` | Create | Full agent with all tools |
| `packages/cli/src/index.ts` | Modify | Register agent command |

---

## Example Session

```typescript
// What happens internally

// User: "Create a new TypeScript project called my-api"
agent.handleMessage({
  tool: "create_project",
  params: { name: "my-api", language: "typescript" }
});
// → Executes create command
// → Returns: "Project created at ./my-api"

// Agent auto-decides to setup
agent.handleMessage({
  tool: "setup_project",
  params: { embeddings: true }
});
// → Starts Neo4j
// → Runs ingestion
// → Generates embeddings
// → Returns: "Setup complete"

// User: "Add a health check endpoint"
agent.handleMessage({
  tool: "read_file",
  params: { path: "src/server.ts" }
});
// → Reads file content

agent.handleMessage({
  tool: "edit_file",
  params: {
    path: "src/server.ts",
    old_string: "app.listen",
    new_string: "app.get('/health', (req, res) => res.json({ status: 'ok' }));\n\napp.listen"
  }
});
// → Edits file
// → Triggers re-ingestion via onFileModified callback
```

---

## Configuration

```yaml
# .ragforge/agent.config.yaml (optional)

agent:
  model: gemini-2.0-flash
  verbose: false
  auto_ingest: true  # Re-ingest on file changes
  auto_embed: false  # Embeddings on demand

defaults:
  language: typescript
  template: minimal
```

---

## Future Enhancements

1. **Multi-project support**: Work on multiple projects simultaneously
2. **Git integration**: Commit changes, create branches
3. **Test runner**: Run tests after code changes
4. **CI/CD integration**: Deploy from agent
5. **Collaborative mode**: Multiple agents working together

---

## Related Documents

- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - RagForge architecture
- [AGENT-TESTING.md](./AGENT-TESTING.md) - Current agent testing
- [dynamic-node-schema.md](./dynamic-node-schema.md) - Dynamic schema for new types
