# Kuzu Vector Extension

The VECTOR extension provides an on-disk HNSW-based vector index for accelerating similarity search over float array columns in tables.

## Current Status / Limitations

- **FLOAT Array Support Only**: Currently only supports 32-bit FLOAT type array columns. Support for 64-bit floats (DOUBLE) coming soon.
- **Single Node Table Column Indexing**: Limited to indexing a single column in node tables.
- **Immutable Index**: Once created, the index cannot be modified. You must drop and re-create the index to reflect changes in the underlying tables.

## Functions

| Function | Description |
|----------|-------------|
| `CREATE_VECTOR_INDEX` | Create the index |
| `QUERY_VECTOR_INDEX` | Query the index |
| `DROP_VECTOR_INDEX` | Drop the index |

## Installation

```cypher
INSTALL VECTOR;
LOAD VECTOR;
```

> Note: In v0.11.3, the vector extension is pre-installed.

## Basic Usage

### Create Vector Index

```cypher
CALL CREATE_VECTOR_INDEX(
    'table_name',      // Name of the table containing the vector column
    'index_name',      // Name to identify the vector index
    'column_name',     // Name of the column containing vector embeddings
    [option_name := option_value]  // Optional parameters for index configuration
);
```

#### Creation Options

| Option | Description | Default |
|--------|-------------|---------|
| `mu` | Max degree of nodes in upper graph. Should be smaller than `ml`. Higher = more accurate but larger index. | 30 |
| `ml` | Max degree of nodes in lower graph. Should be larger than `mu`. Higher = more accurate but larger index. | 60 |
| `pu` | Percentage of nodes sampled into upper graph [0.0, 1.0]. | 0.05 |
| `metric` | Distance function: `cosine`, `l2`, `l2sq`, `dotproduct` | `cosine` |
| `efc` | Number of candidate vertices during construction. Higher = more accurate but slower build. | 200 |

#### Example

```cypher
CALL CREATE_VECTOR_INDEX(
    'Book',
    'title_vec_index',
    'title_embedding'
);
```

### Query Vector Index

```cypher
CALL QUERY_VECTOR_INDEX(
    'table_name',      // Name of the table
    'index_name',      // Name of the vector index
    query_vector,      // Vector to search for
    k,                 // Number of nearest neighbors to return
    [option_name := option_value]  // Optional parameters
) RETURN node.id ORDER BY distance;
```

Returns:
- `node` - The matched node
- `distance` - Distance from the query vector

#### Query Options

| Option | Description | Default |
|--------|-------------|---------|
| `efs` | Number of candidate vertices during search. Higher = more accurate but slower. | 200 |

#### Example with Python

```python
import kuzu
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")
db = kuzu.Database("ex_kuzu_db")
conn = kuzu.Connection(db)

conn.execute("INSTALL VECTOR;")
conn.execute("LOAD VECTOR;")

query_vector = model.encode("quantum machine learning").tolist()
result = conn.execute(
    """
    CALL QUERY_VECTOR_INDEX(
        'Book',
        'title_vec_index',
        $query_vector,
        2
    )
    RETURN node.title ORDER BY distance;
    """,
    {"query_vector": query_vector})
print(result.get_as_pl())
```

Result:
```
┌───────────────────┐
│ node.title        │
├───────────────────┤
│ The Quantum World │
│ Learning Machines │
└───────────────────┘
```

### Combining Vector Search with Graph Traversal

```python
result = conn.execute(
    """
    CALL QUERY_VECTOR_INDEX('Book', 'title_vec_index', $query_vector, 2)
    WITH node AS n, distance
    MATCH (n)-[:PublishedBy]->(p:Publisher)
    RETURN p.name AS publisher, n.title AS book, distance
    ORDER BY distance LIMIT 5;
    """,
    {"query_vector": query_vector})
```

Result:
```
┌──────────────────────────┬───────────────────┬──────────┐
│ publisher                │ book              │ distance │
├──────────────────────────┼───────────────────┼──────────┤
│ Harvard University Press │ The Quantum World │ 0.311872 │
│ Pearson                  │ Learning Machines │ 0.415366 │
└──────────────────────────┴───────────────────┴──────────┘
```

## Index Management

### Drop an Index

```cypher
CALL DROP_VECTOR_INDEX('Book', 'title_vec_index');
```

### List All Indexes

```cypher
CALL SHOW_INDEXES() RETURN *;
```

## Advanced: Filtered Vector Search

Kuzu allows vector similarity search with filter predicates using projected graphs.

### Create a Projected Graph

```cypher
CALL CREATE_PROJECTED_GRAPH(
    'projected_graph_name',
    {
        'table_name': {
            'filter': 'predicate'  // Use 'n' for node properties
        }
    },
    ['relationship_table_name']
);
```

### Example: Filtered Search

```python
# Create projected graph filtering books by publication year
conn.execute("""
    CALL CREATE_PROJECTED_GRAPH(
        'filtered_book',
        {'Book': {'filter': 'n.published_year > 2010'}},
        []
    );
""")

# Search on filtered subset
query_vector = model.encode("quantum world").tolist()
result = conn.execute("""
    CALL QUERY_VECTOR_INDEX(
        'filtered_book',
        'title_vec_index',
        $query_vector,
        2
    )
    WITH node AS n, distance as dist
    MATCH (n)-[:PublishedBy]->(p:Publisher)
    RETURN n.title AS book,
           n.published_year AS year,
           p.name AS publisher
    ORDER BY dist;
    """,
    {"query_vector": query_vector})
```

Result (excludes "The Quantum World" published in 2005):
```
┌────────────────────────────┬──────┬───────────────────────┐
│ book                       │ year │ publisher             │
├────────────────────────────┼──────┼───────────────────────┤
│ Chronicles of the Universe │ 2022 │ Independent Publisher │
│ Learning Machines          │ 2019 │ Pearson               │
└────────────────────────────┴──────┴───────────────────────┘
```

### Drop Projected Graph

```cypher
CALL DROP_PROJECTED_GRAPH('projected_graph_name');
```

### Projected Graph Notes

- Predicates must depend only on their node/relationship table
- Use `n` for node properties: `n.property_name`
- Use `r` for relationship properties: `r.property_name`
- Projected graphs are kept until explicitly dropped or connection closed
- Uses lazy evaluation (predicate evaluated at query time)
