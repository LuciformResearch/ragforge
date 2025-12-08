# @luciformresearch/ragforge-core

Core library for RagForge - YAML config parsing, Neo4j schema introspection, and TypeScript code generation for domain-specific RAG frameworks.

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
## Features

> **TEST_MARKDOWN_WATCHER_ZEPHYR_2024** - Cette phrase unique teste l'indexation temps réel des fichiers markdown.

- **Schema Introspection**: Analyze Neo4j databases to extract schema information
- **Config Loading**: Load and validate RagForge YAML configurations
- **Type Definitions**: Complete TypeScript types for configs and schemas

## Usage

### Schema Introspection

```typescript
import { SchemaIntrospector } from '@luciformresearch/ragforge-core';

const introspector = new SchemaIntrospector(
  'bolt://localhost:7687',
  'neo4j',
  'password'
);

const schema = await introspector.introspect();

console.log('Nodes:', schema.nodes);
console.log('Relationships:', schema.relationships);
console.log('Vector Indexes:', schema.vectorIndexes);

await introspector.close();
```

### Configuration Loading

```typescript
import { ConfigLoader } from '@luciformresearch/ragforge-core';

// Load from YAML file
const config = await ConfigLoader.load('./ragforge.config.yaml');

// With environment variable substitution
const config = await ConfigLoader.loadWithEnv('./ragforge.config.yaml');

// Validate programmatic config
const validated = ConfigLoader.validate(myConfig);
```

## Types

All types are exported from the package:

```typescript
import type {
  RagForgeConfig,
  GraphSchema,
  EntityConfig,
  // ... etc
} from '@luciformresearch/ragforge-core';
```

## Installation

```bash
npm install @luciformresearch/ragforge-core
```

## Part of RagForge

This package is part of the [RagForge](https://github.com/LuciformResearch/ragforge) meta-framework.

**Related Packages:**
- [`@luciformresearch/ragforge-runtime`](https://www.npmjs.com/package/@luciformresearch/ragforge-runtime) - Runtime library for executing RAG queries
- [`@luciformresearch/ragforge-cli`](https://www.npmjs.com/package/@luciformresearch/ragforge-cli) - Command-line interface

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

## License

LRSL v1.1 - See [LICENSE](./LICENSE) file for details.
