# Kuzu Full-Text Search (FTS) Extension

The FTS extension enables full-text search capabilities using the **BM25 scoring algorithm** in Kuzu. Introduced in v0.8.0.

## Overview

- Native implementation (no external libraries)
- Based on the paper "Old Dogs Are Great at New Tricks"
- Words stored as node table, occurrences as relationship table
- CSR join index serves as inverted index
- Sub-second query latencies on large datasets

## Current Limitations

- FTS indices can only be built on **node tables**
- Indices are **immutable** - drop and recreate to refresh
- Only works on **STRING** properties

## Functions

| Function | Description |
|----------|-------------|
| `CREATE_FTS_INDEX` | Create the FTS index |
| `QUERY_FTS_INDEX` | Query the FTS index |
| `DROP_FTS_INDEX` | Drop the FTS index |

## Installation

```cypher
INSTALL fts;
LOAD EXTENSION fts;
```

> Note: In v0.11.3, the fts extension is pre-installed.

## Basic Usage

### Create FTS Index

```cypher
CALL CREATE_FTS_INDEX(
    'table_name',           // Table name
    'index_name',           // Index name
    ['prop1', 'prop2'],     // Properties to index (STRING columns)
    stemmer := 'porter'     // Optional: stemmer to use
)
```

#### Creation Options

| Option | Description | Default |
|--------|-------------|---------|
| `stemmer` | Stemmer algorithm: `'porter'`, `'snowball'` (English) | English snowball |

### Query FTS Index

```cypher
CALL QUERY_FTS_INDEX('table_name', 'index_name', 'search query')
RETURN node.property, score
ORDER BY score DESC;
```

Returns:
- `node` - The matched node
- `score` - BM25 relevance score (higher = more relevant)

#### Query Options

| Option | Description |
|--------|-------------|
| `conjunctive` | If true, requires ALL keywords to be present |

## Complete Example

```cypher
// Create the book table and insert data
CREATE NODE TABLE Book (
    ID SERIAL,
    abstract STRING,
    author STRING,
    title STRING,
    PRIMARY KEY (ID)
);

CREATE (b:Book {
    abstract: 'An exploration of quantum mechanics.',
    author: 'Alice Johnson',
    title: 'The Quantum World'
});
CREATE (b:Book {
    abstract: 'An introduction to machine learning techniques.',
    author: 'Emma Brown',
    title: 'Learning Machines'
});
CREATE (b:Book {
    abstract: 'A fantasy tale of dragons and magic.',
    author: 'Charlotte Harris',
    title: 'The Dragon\'s Call'
});

// Build FTS index on multiple properties
CALL CREATE_FTS_INDEX(
    'Book',
    'book_index',
    ['abstract', 'author', 'title'],
    stemmer := 'porter'
)

// Query the index
CALL QUERY_FTS_INDEX('Book', 'book_index', 'quantum machine')
RETURN node.title, score
ORDER BY score DESC;
```

Result:
```
┌───────────────────┬──────────┐
│ node.title        │ score    │
├───────────────────┼──────────┤
│ The Quantum World │ 0.857996 │
│ Learning Machines │ 0.827832 │
└───────────────────┴──────────┘
```

## Drop FTS Index

```cypher
CALL DROP_FTS_INDEX('Book', 'book_index');
```

## Performance Benchmarks

Tested on ms-passage dataset (8.8M documents, 2.9GB raw):
- Machine: 2x AMD EPYC 7551 (64 cores), 409GB buffer
- Index creation: ~16 minutes
- Query latency: ~0.5s (sub-second)

## Comparison with Vector Search

| Feature | FTS (BM25) | Vector Search |
|---------|------------|---------------|
| Search type | Keyword matching | Semantic similarity |
| Scoring | BM25 (term frequency) | Cosine/L2 distance |
| Best for | Exact keyword queries | Conceptual similarity |
| Index size | Smaller | Larger (embeddings) |
| Query speed | Very fast | Fast (with HNSW) |

## Combining FTS with Graph Traversal

```cypher
CALL QUERY_FTS_INDEX('Book', 'book_index', 'machine learning')
WITH node AS book, score
MATCH (book)-[:WRITTEN_BY]->(author:Author)
RETURN book.title, author.name, score
ORDER BY score DESC
LIMIT 10;
```

## Notes for RagForge Integration

To use FTS in RagForge's KuzuSearchProvider:

1. Create FTS indexes during schema initialization:
```cypher
CALL CREATE_FTS_INDEX('Scope', 'scope_fts', ['name', 'signature', 'docstring', 'source']);
CALL CREATE_FTS_INDEX('File', 'file_fts', ['name', 'path']);
CALL CREATE_FTS_INDEX('MarkdownSection', 'markdown_fts', ['title', 'heading', 'content']);
```

2. Query using native FTS instead of CONTAINS:
```cypher
CALL QUERY_FTS_INDEX('Scope', 'scope_fts', $searchQuery)
RETURN node, score
ORDER BY score DESC
LIMIT $limit;
```

This replaces the current brute-force CONTAINS approach with native BM25 scoring.
