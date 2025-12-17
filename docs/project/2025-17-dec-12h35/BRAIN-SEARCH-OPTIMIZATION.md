# Brain Search Performance Optimization

## Current Performance Breakdown

Based on daemon logs analysis for a single `brain_search` call:

| Phase | Duration |
|-------|----------|
| Embedding generation | ~258ms |
| Vector + BM25 hybrid search | ~9.1s |
| **Search execution total** | **~9.4s** |
| Summarization LLM call | ~22.4s |
| **Total** | **~32s** |

## Current Configuration

Summarization uses:
- Model: `gemini-2.0-flash`
- `maxOutputTokens: 32000`
- Temperature: 0.3

## Optimization Suggestions

### 1. Summarization Optimizations (High Impact)

**A. Use lighter model for summarization**
- Switch from `gemini-2.0-flash` to `gemini-2.0-flash-lite`
- Expected improvement: 50-70% faster summarization

**B. Reduce maxOutputTokens**
- Current: 32000 tokens
- Suggested: 8000 tokens (summaries rarely need more)
- Benefit: Faster response generation, lower cost

**C. Simplify summarization prompt**
- Current prompt may be too detailed
- Focus on extracting key information only

**D. Make summarization conditional**
- Only summarize if results exceed threshold (e.g., > 10 results or > 20KB)
- For small result sets, send directly to agent

### 2. Search Execution Optimizations (Medium Impact)

**A. Reduce parallel Neo4j queries**

Current issue: When `embeddingType = 'all'`, the vector search creates:
- 4 embedding properties (name, content, description, legacy)
- × 6+ node labels (Scope, File, MarkdownSection, CodeBlock, MarkdownDocument, EmbeddingChunk)
- = **24+ parallel Neo4j queries**

Even though queries run in parallel, Neo4j becomes the bottleneck.

**Suggestions:**
1. Default to `embeddingType: 'content'` instead of `'all'` (most searches are content-based)
2. Use a single unified vector index across all node types (requires schema change)
3. Limit search to primary node types (Scope, File) for simple queries

**B. BM25 + Hybrid optimization**
- Hybrid search already runs vector + BM25 in parallel (good)
- Consider reducing `candidateLimit` from `limit * 3` to `limit * 2`

**C. Result caching**
- Cache frequent queries with TTL
- Reuse embedding computations for similar queries
- Cache at the hybrid search level (query → results)

### 3. Alternative Strategies

**A. Progressive disclosure**
- Send first N results immediately
- Summarize remaining in background
- Allow agent to request more if needed

**B. Graph depth exploration**
- Instead of summarizing all results
- Send top results with their graph relationships (depth 1-2)
- Provides context without LLM summarization cost

**C. Streaming responses**
- Stream summarization output as it's generated
- Agent can start processing before full summary ready

## Priority Order

1. **Quick wins**: Reduce maxOutputTokens, make summarization conditional
2. **Medium effort**: Switch to flash-lite, simplify prompt
3. **Larger changes**: Graph depth strategy, progressive disclosure

## Evaluation: Was Summarization Necessary?

**Test case**: "What is the purpose of the ResearchAgent class?"
- **Raw results**: 20 nodes from vector+BM25 hybrid search
- **Summarized output**: 5 snippets + findings + 5 suggestions
- **Cost**: ~22 seconds LLM time

### What summarization provided:
1. Class declaration (`research-agent.ts:661-662`)
2. Factory function `createResearchAgent` (`research-agent.ts:1544-1657`)
3. Options interface `ResearchAgentOptions` (`research-agent.ts:67-146`)
4. MCP tool definition (`brain-tools.ts:4053-4113`)
5. Handler function (`brain-tools.ts:4119-4195`)

Plus: synthesized findings paragraph and 5 actionable suggestions.

### Was it worth 22 seconds?
**For this query type (conceptual question)**: Probably **not strictly necessary**.

- Top 5 raw results ranked by score would likely contain the same key information
- The agent could do its own filtering with much less latency
- The "suggestions" feature is nice but optional

### Recommendation: Conditional summarization

```typescript
// Only summarize if:
// 1. Result count > threshold (e.g., 15)
// 2. OR total content size > threshold (e.g., 30KB)
// 3. OR explicit user request

const shouldSummarize =
  summarize &&
  (results.length > 15 || totalContentSize > 30000);
```

**Alternative: Smart truncation without LLM**
- Return top 10 results
- Include only: uuid, file, lines, name/signature, score
- Let agent request full content via `read_file` if needed

## Query Quality Issue: Abstract Terms

**Observation**: L'agent a cherché "ResearchAgent class purpose" mais le mot **"purpose"** est un terme abstrait qui ne matche aucun code.

### Problème
Les LLMs ont tendance à utiliser des termes abstraits/conceptuels dans leurs recherches:
- "purpose" → n'existe pas dans le code
- "functionality" → idem
- "implementation details" → idem

### Solution: Query Expansion avec termes relatifs

Enseigner à l'agent (via le prompt ou des exemples) à **enrichir ses requêtes** avec des termes techniques liés au domaine:

| Concept recherché | Termes à ajouter |
|-------------------|------------------|
| **Agent** | tools, executor, handler, runtime, iterate, loop |
| **Shader** | material, texture, render, uniforms, vertex, fragment |
| **API endpoint** | route, handler, controller, request, response |
| **Database** | query, model, schema, repository, connection |
| **Auth** | login, token, session, permission, middleware |
| **Component** | props, state, render, hook, lifecycle |

### Implémentation suggérée

```typescript
// Dans le prompt de l'agent ou dans brain_search:
const DOMAIN_EXPANSIONS = {
  'agent': ['tools', 'executor', 'handler', 'runtime', 'iterate'],
  'shader': ['material', 'texture', 'render', 'uniform', 'glsl'],
  'api': ['route', 'endpoint', 'handler', 'controller', 'middleware'],
  // ...
};

// Ou: utiliser un LLM léger pour générer les termes relatifs
// avant de faire la recherche sémantique
```

### Alternative: Few-shot examples dans le prompt

```
When searching for code, use technical terms that appear in code:
- BAD: "purpose of authentication"
- GOOD: "auth login token middleware"
- BAD: "how the agent works"
- GOOD: "agent tools executor iterate loop"
```

## Next Steps

- [ ] Implement conditional summarization based on result count/size
- [ ] Add query expansion with domain-related terms
- [ ] Add few-shot examples in ResearchAgent prompt for better queries
- [ ] Profile Neo4j query performance for multi-index vector search
- [ ] Consider defaulting `embeddingType` to 'content' instead of 'all'
