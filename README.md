# RagForge 🔥

**Meta-framework for generating domain-specific RAG frameworks from Neo4j schemas**

> ⚠️ **Work In Progress** - This is an early-stage project being developed alongside LR_CodeRag

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
## Vision

RagForge is a meta-framework that automatically generates type-safe, domain-specific RAG (Retrieval-Augmented Generation) frameworks from Neo4j graph schemas and YAML configurations.

**One framework generator → Infinite domain-specific frameworks**

### Why RagForge?

Instead of manually building RAG infrastructure for each domain (code search, documentation, e-commerce, legal, etc.), define your domain in YAML and let RagForge generate:

- ✅ Type-safe TypeScript APIs
- ✅ Fluent query builders
- ✅ Hybrid search (filters + embeddings)
- ✅ Configurable reranking strategies
- ✅ MCP server integration
- ✅ Complete documentation

## Quick Example

```yaml
# ragforge.config.yaml (excerpt)
name: code-rag
entities:
  - name: Scope
    searchable_fields:
      - { name: signature, type: string }
      - { name: type,       type: string }
      - { name: file,       type: string }
    vector_indexes:
      - name: scopeEmbeddings                  # Source code semantic search
        field: embedding
        source_field: source
        model: gemini-embedding-001
        dimension: 768
      - name: scopeSignatureEmbeddings         # Signature-only semantic search
        field: signatureEmbedding
        source_field: signature
        model: gemini-embedding-001
        dimension: 512
    relationships:
      - type: CONSUMES
        direction: outgoing
        target: Scope
        filters:
          - { name: whereConsumesScope,    direction: outgoing, parameter: scopeName }
          - { name: whereConsumedByScope, direction: incoming, parameter: scopeName }
```

```bash
# 1. Build RagForge CLI once from the monorepo
npm run build --workspace @ragforge/cli

# 2. Generate a ready-to-use client (introspects Neo4j if --schema not provided)
node packages/cli/dist/index.js generate \
  --config ./ragforge.config.yaml \
  --out ./generated \
  --force
```

Generated artefacts (all derived from the YAML):

- `generated/client.ts` – type-safe runtime client + vector index registration
- `generated/queries/scope.ts` – fluent helpers (`semanticSearchBySource`, `semanticSearchBySignature`, `whereConsumesScope`, …)
- `generated/scripts/*` – `create-vector-indexes.js` & `generate-embeddings.js` using the YAML loader
- `generated/embeddings/load-config.{js,d.ts}` – runtime loader around `ragforge.config.yaml`
- `generated/docs/client-reference.md` – full API reference (also consumed by the agent template)
- `generated/agent.ts` – factory that wires the runtime client into the iterative MCP agent

```typescript
// Generated API usage (compiled just after `generate`)
import { createRagClient } from './generated/client.js';

const rag = createRagClient({
  neo4j: {
    uri: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!
  }
});

const relevance = await rag
  .scope()
  .semanticSearchBySource('parser combinator for TypeScript', { topK: 10 })
  .whereType('function')
  .whereConsumesScope('parseModule')
  .execute();
```

## Project Structure

```
ragforge/
├── packages/
│   ├── core/         # YAML config types, schema analysis, code generation templates
│   ├── cli/          # CLI entrypoints (generate / init / embeddings commands)
│   └── runtime/      # Neo4j client, vector search, embedding pipeline runtime
├── docs/             # Design notes, roadmap, implementation details
└── examples/         # End-to-end samples (kept in sync with the generator)
```

## Development Status

- 🔭 **Mini Roadmap**: voir [`docs/mini-roadmap.md`](docs/mini-roadmap.md) pour le plan court terme.

- [ ] Phase 0: Proof of Concept
  - [x] Manual implementation (LR_CodeRag)
  - [ ] Identify reusable patterns
  - [ ] Extract generic logic
- [ ] Phase 1: Generator MVP
  - [ ] Config schema
  - [ ] Schema analyzer
  - [ ] Type generator
  - [ ] Query builder generator
- [ ] Phase 2: Advanced Strategies
- [ ] Phase 3: MCP Integration
- [ ] Phase 4: Ecosystem

## CLI Workflow

All commands live in `packages/cli/dist/index.js` once the workspace is built. Typical flow:

```bash
# 0. Build CLI (once per checkout)
npm run build --workspace @ragforge/cli

# 1. Init (introspection + generation in one step)
node packages/cli/dist/index.js init \
  --project my-project \
  --out ./ragforge-my-project \
  --force

# 2. Or, split the workflow:
node packages/cli/dist/index.js introspect \
  --project my-project \
  --out ./ragforge-my-project \
  --force

node packages/cli/dist/index.js generate \
  --config ./ragforge-my-project/ragforge.config.yaml \
  --schema ./ragforge-my-project/schema.json \
  --out ./ragforge-my-project/generated \
  --force

# 3. Embedding maintenance (derived from YAML)
node packages/cli/dist/index.js embeddings:index \
  --config ./ragforge-my-project/ragforge.config.yaml \
  --out ./ragforge-my-project/generated

node packages/cli/dist/index.js embeddings:generate \
  --config ./ragforge-my-project/ragforge.config.yaml \
  --out ./ragforge-my-project/generated
```

What land in `ragforge-my-project/generated/`:

- Runtime artefacts (`client.ts`, `index.ts`, `types.ts`, `queries/*`)
- Embedding loader (`embeddings/load-config.{js,d.ts}`) and scripts
- Documentation (`docs/client-reference.md`)
- MCP agent bootstrap (`agent.ts`)
- Runtime copy (`packages/runtime/`) for standalone use
- `.env` seeded with Neo4j connection information (if supplied)

> **Tips**
> - CLI reads Neo4j credentials from `.env` (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`). Override at runtime with `--uri/--username/--password`.
> - `GEMINI_API_KEY` must be set to run embedding scripts (Gemini is the provider currently wired).
> - Use `--reset-embeddings-config` if you want to overwrite a customised loader.

```typescript
// Example: wire the generated client into the iterative agent template
import { createIterativeAgent } from './generated/agent.js';
import type { LLMClient } from '@ragforge/runtime';

const llm: LLMClient = /* ... */;
const agent = createIterativeAgent({
  llm,
  workDir: './tmp',
  ragClientPath: './generated/client.js'
});
```

## Related Projects

- **LR_CodeRag**: The original code RAG implementation that inspired RagForge
- **Weaver** (future): Conversational agent that helps create RagForge configs

## License

TBD (will be open-sourced)

## Links

- [Vision Document](../docs/17-code-rag-framework.md)
- [LR_CodeRag](../)
