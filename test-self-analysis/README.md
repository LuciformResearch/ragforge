# RagForge Self-Analysis Test

Test project that analyzes the ragforge runtime package itself using the code source adapter.

## Phase 2 Features Tested

This project tests all Phase 2 features:
- ✅ Directory nodes with IN_DIRECTORY and PARENT_OF relationships
- ✅ ExternalLibrary nodes with USES_LIBRARY relationships
- ✅ Project node with BELONGS_TO relationships
- ✅ INHERITS_FROM relationships for class inheritance
- ✅ HAS_PARENT relationships with parentUUID property
- ✅ File metadata (directory, extension, contentHash)

## Quick Start

```bash
# Start Neo4j database
npm run db:start

# Initialize and ingest ragforge source code
npm run init

# Verify Phase 2 features
npm run verify

# View Neo4j browser
open http://localhost:7474
# Login: neo4j/neo4j123
```

## Available Commands

```bash
npm run db:start   # Start Neo4j in Docker
npm run db:stop    # Stop Neo4j
npm run db:clean   # Stop and remove all data
npm run db:logs    # View Neo4j logs
npm run db:status  # Check container status
npm run init       # Run ragforge init (ingests code)
npm run test       # Full test: start DB + init + verify
```

## What Gets Analyzed

This test analyzes the `ragforge/packages/runtime/src` directory, which contains:
- Source adapters (code, database, documents)
- Query builder and execution engine
- Embedding pipeline
- Reranking strategies
- Neo4j client abstractions
- Utility functions (ImportResolver, UniqueIDHelper, etc.)

## Expected Results

After running `npm run init`, you should see:
- ~20-50 Scope nodes (functions, classes, interfaces)
- ~10-15 File nodes
- ~5-10 Directory nodes
- ~5-15 ExternalLibrary nodes (neo4j-driver, @google/genai, etc.)
- 1 Project node
- Multiple relationships connecting everything

Run `npm run verify` to get a detailed report.
