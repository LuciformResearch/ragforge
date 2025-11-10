# Summarization System - Improvement Suggestions

## Executive Summary

The current summarization system works but has room for improvement in:
1. **Output quality**: 60% of items in test batch returned empty summaries
2. **Context awareness**: Items analyzed in isolation without graph context
3. **Schema richness**: Basic schema doesn't capture code-specific metadata
4. **Intelligent batching**: Random ordering instead of graph-aware grouping

This document proposes improvements that keep RagForge generic while enabling better results for code and other domains.

---

## 1. Current Issues

### Issue 1.1: Empty Summaries (6 out of 10)

**Observation**: In test run with `--limit=10`, only 4 summaries were generated successfully. 6 returned empty objects `{}`.

**Root Causes**:
- LLM may have hit max_tokens limit (1000 configured)
- Prompt may be too long (~881 lines, ~7-8k tokens)
- XML parsing may have failed silently
- LLM may not be generating all requested items

**Evidence**:
```json
{
  "uuid": "123FF1FB-0F12-46FB-B7B4-DA7BF79B197C",
  "summary": {}  // Empty!
}
```

### Issue 1.2: Lack of Graph Context

**Observation**: Items are analyzed in isolation without knowing:
- Which file they belong to
- What other scopes they import/call
- What scopes call them
- Their position in the dependency graph

**Example**: A function `createClient` is analyzed without knowing:
- It's in `packages/runtime/src/index.ts`
- It's exported as a public API
- It's called by `client.ts` and `agent.ts`
- It imports `Neo4jClient` from `./client/neo4j-client`

### Issue 1.3: Basic Schema for Code

**Current schema**:
```yaml
output_schema:
  fields:
    - purpose (string)
    - operation (array)
    - dependency (array)  # Just strings, not structured
    - concept (array)
    - complexity (string)
    - suggestion (array)
```

**Missing for code**:
- `scope_type`: function | class | interface | type | variable | constant
- `file_path`: Where this scope lives
- `export_status`: exported | internal
- `api_surface`: Parameters, return type, visibility
- `related_scopes`: Structured references to other scopes in graph
- `line_range`: Start and end line numbers
- `parent_scope`: Enclosing class/namespace if any

### Issue 1.4: Random Batching

**Current behavior**: Items fetched in arbitrary Neo4j query order.

**Problem**: No semantic grouping. A batch might contain:
- Item 0: Function from `file-a.ts`
- Item 1: Interface from `file-z.ts`
- Item 2: Function from `file-a.ts` (related to Item 0, but LLM doesn't know!)
- Item 3: Class from `file-m.ts`

**Better approach**: Group by:
- Same file (items 0 and 2 together)
- Same module/package
- Dependency relationships (dependencies before consumers)
- Topological ordering

---

## 2. Proposed Improvements

### 2.1 Enhanced Schema for Code (Domain-Specific)

**File**: `ragforge/examples/code-rag/ragforge.config.yaml`

```yaml
summarization_strategies:
  code_analysis_enhanced:
    name: "Enhanced Code Analysis for TypeScript/Python"
    description: "Extracts structured information from code with graph context"

    system_prompt: |
      You are an expert code analyst. You analyze code with knowledge of its context in the codebase graph.

      For each code scope, you'll be provided:
      - The source code
      - File path and location
      - Graph context (imports, exports, callers, etc.)

      Your analysis must be:
      - Accurate: Only describe what the code actually does
      - Context-aware: Use the provided graph relationships
      - Specific: Use concrete names, APIs, patterns from the code
      - Actionable: Provide specific, implementable suggestions

    output_schema:
      root: "analysis"
      fields:
        # Basic identification
        - name: "scope_type"
          type: "string"
          description: "Type of code element: function, class, interface, type, variable, constant, method"
          required: true

        - name: "file_path"
          type: "string"
          description: "Path to the file containing this scope"
          required: true

        - name: "line_range"
          type: "string"
          description: "Line range like '45-78'"
          required: false

        # Semantic analysis
        - name: "purpose"
          type: "string"
          description: "One-sentence description of what this code does"
          required: true

        - name: "operation"
          type: "array"
          description: "Key operations performed (2-5 bullets)"
          required: true

        # API surface (for functions/methods/classes)
        - name: "api_surface"
          type: "object"
          description: "Public API information"
          required: false
          nested:
            - name: "exported"
              type: "boolean"
              description: "Whether this is exported from the module"
            - name: "visibility"
              type: "string"
              description: "public, private, protected, internal"
            - name: "parameters"
              type: "array"
              description: "Parameter names and types"
            - name: "return_type"
              type: "string"
              description: "Return type if known"

        # Dependencies and relationships
        - name: "imports"
          type: "array"
          description: "External libraries and modules imported"
          required: false

        - name: "calls_internal"
          type: "array"
          description: "Other scopes in this codebase that this scope calls"
          required: false

        - name: "called_by"
          type: "array"
          description: "Other scopes that call this one (from graph context)"
          required: false

        - name: "extends_implements"
          type: "array"
          description: "Classes/interfaces extended or implemented"
          required: false

        # Technical metadata
        - name: "concepts"
          type: "array"
          description: "Key technical concepts (e.g., 'database access', 'error handling', 'async/await')"
          required: true

        - name: "patterns"
          type: "array"
          description: "Design patterns used (e.g., 'factory', 'singleton', 'builder')"
          required: false

        - name: "complexity"
          type: "string"
          description: "Low, Medium, High, or specific metric like 'O(n log n)'"
          required: true

        # Quality and suggestions
        - name: "code_smells"
          type: "array"
          description: "Detected issues: long function, deep nesting, duplicated code, etc."
          required: false

        - name: "security_concerns"
          type: "array"
          description: "Security issues: injection risk, hardcoded secrets, etc."
          required: false

        - name: "suggestions"
          type: "array"
          description: "Specific, actionable improvements"
          required: false

    instructions: |
      For each code scope:

      1. Identify the scope_type from the code structure
      2. Extract file_path and line_range from the metadata
      3. Write a clear, concise purpose statement
      4. List 2-5 key operations the code performs
      5. If it's a function/method/class, extract API surface (exported?, parameters, return type)
      6. Extract import statements and identify external dependencies
      7. Use the graph context to identify internal calls and callers
      8. Identify technical concepts and design patterns
      9. Assess complexity (consider loops, conditions, recursion)
      10. Identify code smells and security concerns if any
      11. Provide 0-3 actionable suggestions for improvement
```

### 2.2 Context-Enriched Prompts (Generic Feature)

**Problem**: Current prompts only include the field value, no graph context.

**Solution**: Add optional `context_query` to field config that fetches related data.

**Example config**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: source
        summarization:
          enabled: true
          strategy: code_analysis_enhanced
          threshold: 300

          # NEW: Optional context query to enrich each item
          context_query: |
            MATCH (file:File)-[:CONTAINS]->(n:Scope {uuid: $uuid})
            OPTIONAL MATCH (n)-[:IMPORTS]->(imported:Scope)
            OPTIONAL MATCH (caller:Scope)-[:CALLS]->(n)
            OPTIONAL MATCH (n)-[:CALLS]->(called:Scope)
            OPTIONAL MATCH (n)-[:INHERITS_FROM|IMPLEMENTS]->(parent:Scope)
            RETURN
              file.path as file_path,
              n.type as scope_type,
              n.startLine as start_line,
              n.endLine as end_line,
              n.exported as is_exported,
              collect(DISTINCT imported.name) as imports_internal,
              collect(DISTINCT caller.name) as called_by,
              collect(DISTINCT called.name) as calls_internal,
              collect(DISTINCT parent.name) as extends_implements
```

**Implementation in `generate-summaries.ts`**:
```typescript
// If context query is configured, fetch context for each entity
let enrichedBatchInput = batchInput;

if (sumConfig.context_query) {
  enrichedBatchInput = await Promise.all(
    batchInput.map(async (item) => {
      const context = await neo4jClient.run(
        sumConfig.context_query,
        { uuid: item.entity.uuid }
      );

      return {
        ...item,
        graphContext: context.records[0]?.toObject() || {}
      };
    })
  );
}

// Build prompts with context
const prompts = summarizer.buildPrompts(enrichedBatchInput);
```

**Modified prompt template**:
```
[Item 0]
Type: Scope
File: packages/runtime/src/index.ts
Lines: 45-78
Exported: true
Called by: agent.ts:createAgent, client.ts:main
Calls: Neo4jClient.constructor, QueryBuilder.constructor

Source code:
function createClient(config: RuntimeConfig) {
  ...
}
```

### 2.3 Intelligent Graph-Aware Batching (Generic Feature)

**Problem**: Items are batched randomly.

**Solution**: Add `batch_strategy` option to order items intelligently.

**Config**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: source
        summarization:
          enabled: true
          strategy: code_analysis_enhanced
          threshold: 300

          # NEW: Batching strategy
          batch_strategy: "by_file"  # or "by_dependency_cluster", "topological", "random"

          # NEW: Optional batch ordering query
          batch_order_query: |
            MATCH (file:File)-[:CONTAINS]->(n:Scope)
            WHERE n.source IS NOT NULL
              AND size(n.source) > $threshold
              AND n.source_summary_hash IS NULL
            WITH file, n
            ORDER BY file.path, n.startLine
            RETURN n.uuid AS uuid,
                   n.source AS fieldValue,
                   file.path AS file_path
```

**Strategies**:

1. **`by_file`**: Group scopes from the same file together
   - Benefit: LLM sees related code in context
   - Implementation: `ORDER BY file.path, n.startLine`

2. **`by_dependency_cluster`**: Group scopes that import each other
   - Benefit: LLM understands how components interact
   - Implementation: Community detection algorithm on IMPORTS/CALLS graph

3. **`topological`**: Dependencies before consumers
   - Benefit: LLM analyzes low-level utilities first, then high-level code
   - Implementation: Topological sort on dependency graph

4. **`by_module`**: Group by package/directory
   - Benefit: Respects architectural boundaries
   - Implementation: `ORDER BY substring(file.path, 0, indexOf(file.path, '/'))`

### 2.4 Better Error Handling and Diagnostics

**Problem**: Silent failures - empty summaries with no explanation.

**Solutions**:

1. **Validate LLM responses before storing**:
```typescript
// In GenericSummarizer
for (const [i, summary] of summaries.entries()) {
  if (!summary || Object.keys(summary).length === 0) {
    console.warn(`    ⚠️  Item ${i} (uuid: ${entities[i].uuid}) returned empty summary`);
    console.warn(`       Consider increasing max_tokens or reducing batch size`);
  }
}
```

2. **Save raw LLM responses**:
```typescript
if (flags.savePrompts) {
  const rawResponseFile = path.resolve(__dirname,
    `../logs/prompts/${entityConfig.name}_${field.name}_batch${batchNum}_${timestamp}_raw_response.txt`);
  await fs.writeFile(rawResponseFile, rawLLMResponse);
}
```

3. **Add retry logic for empty responses**:
```typescript
const MAX_RETRIES = 2;
let retries = 0;
let summaries;

while (retries < MAX_RETRIES) {
  summaries = await summarizer.summarizeBatch(batchInput);

  const emptyCount = summaries.filter(s => !s || Object.keys(s).length === 0).length;

  if (emptyCount === 0) break;

  if (retries < MAX_RETRIES - 1) {
    console.warn(`    ⚠️  ${emptyCount} empty summaries, retrying with smaller batch...`);
    // Reduce batch size and try again
    batchInput = batchInput.slice(0, Math.floor(batchInput.length / 2));
  }

  retries++;
}
```

4. **Token budget warnings**:
```typescript
const estimate = summarizer.estimateTokens(batchInput);

if (estimate.totalResponseTokens > config.summarization_llm.max_tokens) {
  console.warn(`    ⚠️  Estimated response tokens (${estimate.totalResponseTokens}) exceeds max_tokens (${config.summarization_llm.max_tokens})`);
  console.warn(`       Some summaries may be truncated. Consider increasing max_tokens or reducing batch size.`);
}
```

### 2.5 Incremental Summarization (Efficiency)

**Problem**: Currently regenerates all summaries even if code hasn't changed.

**Solution**: Use content hashing (already implemented!) but add smart invalidation.

**Enhancement - Cascade invalidation**:
```typescript
// When a scope's summary is regenerated, invalidate summaries of:
// - Scopes that import this one
// - Scopes that call this one
// Because their context may have changed

async invalidateDependentSummaries(
  entityId: string,
  fieldName: string
): Promise<number> {
  const result = await this.client.run(`
    MATCH (n:${this.config.entityLabel} {${this.config.uniqueField}: $entityId})
    MATCH (dependent)-[:IMPORTS|CALLS]->(n)
    SET dependent.${fieldName}_summary_hash = NULL
    RETURN count(dependent) as invalidated
  `, { entityId });

  return result.records[0]?.get('invalidated')?.toNumber() || 0;
}
```

### 2.6 Multi-Strategy Support (Domain Flexibility)

**Problem**: One strategy per field. What if different scopes need different strategies?

**Solution**: Allow strategy selection based on node properties.

**Example**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: source
        summarization:
          enabled: true

          # NEW: Strategy selector
          strategy_selector:
            default: "code_analysis"
            rules:
              - condition: "type = 'interface' OR type = 'type'"
                strategy: "type_definition_analysis"
              - condition: "type = 'class'"
                strategy: "class_analysis"
              - condition: "type = 'function' AND complexity > 100"
                strategy: "complex_function_analysis"

summarization_strategies:
  code_analysis:
    # General purpose

  type_definition_analysis:
    # Specialized for interfaces/types
    system_prompt: "You analyze TypeScript type definitions..."
    output_schema:
      fields:
        - name: "type_category"
          description: "data model, configuration, API contract, utility type"
        - name: "usage_examples"
          description: "Common use cases"

  class_analysis:
    # Specialized for classes
    output_schema:
      fields:
        - name: "responsibilities"
          description: "Single Responsibility Principle check"
        - name: "public_methods"
        - name: "private_methods"
        - name: "state_management"

  complex_function_analysis:
    # Extra detail for complex functions
    output_schema:
      fields:
        - name: "cyclomatic_complexity"
        - name: "refactoring_suggestions"
        - name: "testability_concerns"
```

---

## 3. Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
- [ ] Fix empty summaries issue (increase max_tokens, add validation)
- [ ] Add better error reporting and diagnostics
- [ ] Save raw LLM responses for debugging
- [ ] Implement `by_file` batch ordering for code

### Phase 2: Context Enrichment (2-3 days)
- [ ] Add `context_query` support to field config
- [ ] Modify prompt builder to include graph context
- [ ] Update code_analysis strategy with enhanced schema
- [ ] Test with enriched prompts

### Phase 3: Intelligent Batching (3-4 days)
- [ ] Implement `batch_strategy` option
- [ ] Add `by_file`, `topological`, `by_module` strategies
- [ ] Add configurable `batch_order_query`
- [ ] Performance testing

### Phase 4: Advanced Features (1 week)
- [ ] Multi-strategy support with selectors
- [ ] Cascade invalidation for incremental updates
- [ ] Specialized strategies for different code elements
- [ ] Comprehensive testing and documentation

### Phase 5: Generalization (ongoing)
- [ ] Document patterns for other domains (documents, logs, etc.)
- [ ] Create example configs for different use cases
- [ ] Add to RagForge examples

---

## 4. Example: Perfect Config for Code RAG

Here's what the ideal `ragforge.config.yaml` would look like for code:

```yaml
name: "my-codebase"
version: "1.0.0"

neo4j:
  uri: "${NEO4J_URI}"
  username: "${NEO4J_USERNAME}"
  password: "${NEO4J_PASSWORD}"

# LLM for summarization
summarization_llm:
  provider: "gemini"
  model: "gemini-2.0-flash-exp"
  temperature: 0.3
  max_tokens: 2000  # Increased from 1000
  api_key: "${GEMINI_API_KEY}"

# Strategies
summarization_strategies:
  code_analysis_enhanced:
    name: "Enhanced Code Analysis"
    system_prompt: |
      You are an expert code analyst analyzing TypeScript/Python code with full graph context.

      You'll receive:
      - Source code
      - File path and line numbers
      - Graph relationships (what this code imports, what imports it, what calls it)

      Provide accurate, context-aware analysis focusing on facts extracted from the code and graph.

    output_schema:
      root: "analysis"
      fields:
        - name: "scope_type"
          type: "string"
          description: "function, class, interface, type, variable, constant, method"
        - name: "file_path"
          type: "string"
          description: "Full file path"
        - name: "purpose"
          type: "string"
          description: "One-sentence description"
        - name: "operation"
          type: "array"
          description: "Key operations (2-5 items)"
        - name: "api_surface"
          type: "object"
          nested:
            - name: "exported"
              type: "boolean"
            - name: "parameters"
              type: "array"
            - name: "return_type"
              type: "string"
        - name: "imports"
          type: "array"
          description: "External dependencies"
        - name: "calls_internal"
          type: "array"
          description: "Internal scopes called"
        - name: "called_by"
          type: "array"
          description: "Scopes that call this (from context)"
        - name: "concepts"
          type: "array"
          description: "Technical concepts"
        - name: "complexity"
          type: "string"
          description: "Low, Medium, High, or specific metric"
        - name: "suggestions"
          type: "array"
          description: "Actionable improvements"

entities:
  - name: Scope
    unique_field: uuid

    searchable_fields:
      - name: source
        type: string
        indexed: true
        description: "Source code of this scope"

        # Summarization config
        summarization:
          enabled: true
          strategy: code_analysis_enhanced
          threshold: 300
          cache: true

          # Context enrichment
          context_query: |
            MATCH (file:File)-[:CONTAINS]->(n:Scope {uuid: $uuid})
            OPTIONAL MATCH (n)-[:IMPORTS]->(imported:Scope)
            OPTIONAL MATCH (caller:Scope)-[:CALLS]->(n)
            OPTIONAL MATCH (n)-[:CALLS]->(called:Scope)
            RETURN
              file.path as file_path,
              n.type as scope_type,
              n.startLine as start_line,
              n.endLine as end_line,
              n.exported as is_exported,
              collect(DISTINCT imported.name)[..5] as imports_internal,
              collect(DISTINCT caller.name)[..5] as called_by,
              collect(DISTINCT called.name)[..5] as calls_internal

          # Intelligent batching
          batch_strategy: "by_file"
          batch_order_query: |
            MATCH (file:File)-[:CONTAINS]->(n:Scope)
            WHERE n.source IS NOT NULL
              AND size(n.source) > $threshold
              AND n.source_summary_hash IS NULL
            WITH file, n
            ORDER BY file.path, n.startLine
            RETURN n.uuid AS uuid,
                   n.source AS fieldValue

          # When to use summary in reranking
          rerank_use: "prefer_summary"  # Use summary for initial ranking, full source for final rerank
```

---

## 5. Keeping RagForge Generic

All proposed features are **opt-in** and **configurable**:

1. **Context queries** - Optional, works for any graph structure
2. **Batch strategies** - Optional, with sensible defaults
3. **Enhanced schemas** - Domain-specific, provided as examples
4. **Strategy selectors** - Optional advanced feature

**Core principle**: RagForge provides the *mechanism*, users provide the *configuration*.

**Examples to ship**:
- `examples/code-rag/` - Full-featured code analysis config
- `examples/document-rag/` - Document summarization config
- `examples/log-analysis/` - Log event summarization config

Each example shows best practices for that domain while using the same generic RagForge runtime.

---

## 6. Metrics and Success Criteria

**Before improvements**:
- 60% empty summaries (6/10)
- No graph context in analysis
- Random batch ordering
- Basic schema

**After improvements**:
- 95%+ successful summaries
- Rich graph context in prompts
- Intelligent file/dependency-based ordering
- Domain-specific enhanced schemas
- Clear error messages and diagnostics

**Testing plan**:
1. Run on test-code-rag with `--limit=50`
2. Manually review 10 random summaries for quality
3. Measure: empty rate, accuracy, context-awareness
4. Compare reranking performance with/without summaries

---

## 7. Questions for Discussion

1. Should `context_query` and `batch_order_query` be required or optional?
2. What's the priority: fix empty summaries first, or add context enrichment?
3. Should we implement all batch strategies or just `by_file` initially?
4. Do we want cascade invalidation for incremental updates?
5. Should enhanced schema be in core or examples?
