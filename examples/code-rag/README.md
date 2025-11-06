# Code RAG Example

This is the configuration for our first RagForge use case: **code search and analysis**.

## Configuration

See [ragforge.config.yaml](./ragforge.config.yaml) for the complete configuration.

## Key Features

- **Entities**: Scope, File, Project
- **Semantic Search**: Embeddings on scope signatures/source
- **Graph Traversal**: Follow CONSUMES/CONSUMED_BY relationships
- **Reranking Strategies**:
  - Popularity (usage count)
  - Centrality (PageRank)
  - Code quality (docs, size, tests)
  - File locality (prefer nearby code)

## Usage (once RagForge is implemented)

```bash
# Generate the framework
npx ragforge generate ragforge.config.yaml

# Use the generated framework
cd generated/code-rag
npm install
npm run dev
```

```typescript
// Search API
const rag = new CodeRAG();

const results = await rag
  .search('JWT authentication', {
    filters: { type: 'function' },
    limit: 5
  });

// Advanced hybrid search
const advanced = await rag
  .semantic('user login handler')
  .where({
    type: 'function',
    file: { startsWith: 'src/api/' }
  })
  .expand('CONSUMES', { depth: 2 })
  .rerank({
    strategy: 'hybrid',
    weights: {
      semantic: 0.6,
      'topology-popularity': 0.3,
      'code-quality': 0.1
    }
  })
  .execute();
```

## Integration with LR_CodeRag

This config is based on the actual Neo4j schema from `../../` (LR_CodeRag project).

The schema includes:
- Scope nodes with embeddings
- CONSUMES/CONSUMED_BY relations
- File and Project organization
- Rich metadata (signatures, docstrings, etc.)
