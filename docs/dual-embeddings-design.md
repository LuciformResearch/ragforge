# Dual Embeddings Architecture

## Motivation

Avoir deux types d'embeddings par scope permet des recherches sémantiques plus précises:

1. **`embedding_signature`** - Embedding de la signature seulement
   - Exemple: `function loadEnvironment(rootPath?: string): void`
   - Usage: Trouver des fonctions avec des noms/paramètres similaires
   - Cas d'usage: "fonction qui prend un path et retourne void"

2. **`embedding_source`** - Embedding du code source complet
   - Exemple: Tout le corps de la fonction incluant l'implémentation
   - Usage: Trouver des implémentations similaires
   - Cas d'usage: "code qui utilise dotenv pour charger des variables"

## Schema Changes

### Neo4j Node Properties
```cypher
(:Scope {
  name: string,
  type: string,
  signature: string,
  source: string,
  embedding_signature: float[768],  // NEW
  embedding_source: float[768],     // NEW
  ...
})
```

### Vector Indexes
```cypher
// Index 1: Signature embeddings
CREATE VECTOR INDEX scopeEmbeddingsSignature IF NOT EXISTS
FOR (s:Scope)
ON s.embedding_signature
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}}

// Index 2: Source embeddings
CREATE VECTOR INDEX scopeEmbeddingsSource IF NOT EXISTS
FOR (s:Scope)
ON s.embedding_source
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}}
```

## API Design

### Generated Client API
```typescript
// Option 1: Unified with selector
rag.scope().semanticSearch('load environment variables', {
  index: 'signature',  // or 'source'
  topK: 10
})

// Option 2: Explicit methods (better for type-safety)
rag.scope().semanticSearchBySignature('function(path): void')
rag.scope().semanticSearchBySource('dotenv config resolution')

// Combined usage
const results = await rag.scope()
  .semanticSearchBySource('environment configuration')
  .withConsumes(1)
  .withConsumedBy(1)
  .rerankByCodeQuality()
  .limit(5)
  .execute();
```

### Config YAML Schema
```yaml
entities:
  - name: Scope
    vector_indexes:
      - name: scopeEmbeddingsSignature
        field: embedding_signature
        dimension: 768
        similarity: cosine
        provider: vertex-ai
        model: text-embedding-004
        source_field: signature  # Which property to embed

      - name: scopeEmbeddingsSource
        field: embedding_source
        dimension: 768
        similarity: cosine
        provider: vertex-ai
        model: text-embedding-004
        source_field: source  # Which property to embed
```

## Implementation Steps

1. **Update Config Schema** - Support multiple vector_indexes per entity
2. **Implement VectorSearch Module** - Support index selection
3. **Update CodeGenerator** - Generate both semanticSearchBy* methods
4. **Create Reindexing Script** - Generate both embeddings per scope
5. **Update QueryBuilder** - Support dual index queries

## Embedding Generation

```typescript
// Pseudo-code for reindexing
for (const scope of scopes) {
  const signatureEmbedding = await embedText(scope.signature);
  const sourceEmbedding = await embedText(scope.source);

  await neo4j.run(`
    MATCH (s:Scope {uuid: $uuid})
    SET s.embedding_signature = $sig_emb,
        s.embedding_source = $src_emb
  `, {
    uuid: scope.uuid,
    sig_emb: signatureEmbedding,
    src_emb: sourceEmbedding
  });
}
```

## Benefits

✅ **Precision**: Search by signature for API discovery
✅ **Context**: Search by source for implementation patterns
✅ **Flexibility**: Combine both with reranking strategies
✅ **Performance**: Two specialized indexes vs one generic
