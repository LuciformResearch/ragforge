# Embeddings Generation Design (Draft)

## Goals

We need a portable way for RagForge-generated projects to:
- Decide **which fields/entities** should have embeddings.
- **Create vector indexes** in Neo4j (correct dimension & similarity).
- **Generate and maintain embeddings** based on configurable pipelines.
- Support project-specific customization (e.g., LR_CodeRag camelcase splitting, relationship enrichment) without forking core logic.

## Key Requirements

1. **Config-driven**: a single source of truth (likely part of ragforge.config.yaml) describing embeddings per entity/field, dimensions, text preprocessing, extra context fields, etc.
2. **Generator support**: generated client should surface helper types, default pipelines, and scripts.
3. **Runtime tooling**: provide reusable utilities (e.g., embedding generators, content builders) so generated scripts are thin wrappers.
4. **Extensibility**: allow overrides for custom preprocessing (camelcase, relationship expansion) per entity.
5. **Operational story**: CLI/scripts to (a) create vector indexes, (b) compute embeddings, (c) reindex incremental changes.
6. **Fail fast if unsupported provider**: v1 is Gemini-only; if config specifies another provider we throw.

## Proposed Architecture

### 1. Embedding config schema

Extend `ragforge.config.yaml` with an `embeddings` section:

```yaml
embeddings:
  provider: gemini  # only supported option in v1
  defaults:
    model: gemini-embedding-001
    dimension: 768
    similarity: cosine
  entities:
    - entity: Scope
      pipelines:
        - name: signature
          source: signature
          target_property: embedding_signature
          dimension: 512        # override per pipeline
          similarity: dot
          preprocessors: ["camelCaseSplit"]
          include_relationships:
            - type: CONSUMES
              direction: outgoing
              fields: ["name"]
        - name: source-with-context
          source: source
          target_property: embedding_source
          dimension: 768
          preprocessors: ["camelCaseSplit", "stripComments"]
          include_fields: ["docstring"]
```

### 2. Code generation output

Generated client gets:
- `embeddings/load-config.{js,d.ts}` for loading the structured config directly from `ragforge.config.yaml`.
- `scripts/create-vector-indexes.ts` generated from config (dimensions/similarity per pipeline).
- `scripts/generate-embeddings.ts` leveraging runtime helpers with per-pipeline preprocessing.
- `package.json` scripts: `embeddings:index`, `embeddings:generate`.

### 3. Runtime helpers

In `@ragforge/runtime` add modules:
- `embedding/providers/gemini.ts` (wrapper around `@google/genai`, handles batching, retry, `outputDimensionality`).
- `embedding/pipeline.ts` (ingests entity config, fetches data via Neo4j queries, applies preprocessors, writes embeddings).
- Preprocessors (camelCaseSplit, normalizeWhitespace, combineFields, etc.).
- Relationship expanders (e.g., fetch related nodes and inject fields into embedding text).

### 4. CLI integration

Extend RagForge CLI with:
- `ragforge embeddings:index` → create indexes using config.
- `ragforge embeddings:generate` → generate embeddings via runtime helpers (requires `GEMINI_API_KEY`).
- These commands respect `.env` (NEO4J + GEMINI API key).

### 5. Customization story

Projects can:
- Edit the `embeddings` section in `ragforge.config.yaml` for advanced tweaks.
- Implement custom preprocessors by exporting functions in `generated/embeddings/pipelines/custom.ts` which the generated script imports.

### 6. Backwards compatibility

- If legacy configs (vector_index) exist without embedding section, generator produces a minimal config for backward compatibility, but warns if dimensions != expected provider.

## Next Steps

1. Define full TypeScript types for embedding config (core package).
2. Implement runtime embedding pipeline with Gemini provider.
3. Update generator to emit config + scripts + runtime wiring.
4. Create CLI commands for embeddings.
5. Test on LR_CodeRag (signature & source pipelines) and document migration path.
