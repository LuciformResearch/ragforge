# LLM Reranking - Design

## 🎯 Vision

Intégrer le reranking LLM directement dans le fluent API de RagForge, avec **parallélisation et batching** pour l'efficacité.

## Problème

La recherche sémantique (vector search) retourne des résultats basés uniquement sur la similarité des embeddings. Mais:

- ❌ Les embeddings peuvent être trompeurs (synonymes, contexte)
- ❌ Pas de compréhension du "intent" utilisateur
- ❌ Pas de feedback sur la qualité de la query
- ❌ Impossible de détecter les faux positifs

**Solution:** Demander à un LLM d'évaluer la pertinence réelle de chaque résultat.

## API Proposée

### Usage Simple

```typescript
const results = await rag.scope()
  .semanticSearchBySource('parser typescript', { topK: 100 })
  .llmRerankResults("Comment parser des fichiers TypeScript?")
  .limit(10)
  .execute();
```

### Usage Avancé

```typescript
const results = await rag.scope()
  .whereFile({ contains: 'parsers' })
  .semanticSearchBySource('extract AST functions', { topK: 50 })
  .llmRerankResults("Où trouve-t-on le code pour extraire l'AST?", {
    batchSize: 10,        // Scopes par requête LLM
    parallel: 5,          // Max requêtes LLM en parallèle
    minScore: 0.6,        // Score minimum de pertinence
    withSuggestions: true // Demander des suggestions d'amélioration
  })
  .limit(20)
  .execute();
```

## Architecture

### 1. Batching

Les résultats sont groupés en batches pour tenir dans le context LLM:

```
100 scopes → [batch1(10), batch2(10), ..., batch10(10)]
```

Chaque batch devient une requête LLM.

### 2. Parallélisation

Les batches sont traités en parallèle (avec limite):

```
Parallel limit = 5

[batch1, batch2, batch3, batch4, batch5] → LLM (en parallèle)
  ↓ results
[batch6, batch7, batch8, batch9, batch10] → LLM (en parallèle)
  ↓ results
Merge all results
```

### 3. Prompt LLM

Pour chaque batch:

```xml
<system>
You are evaluating code search results for relevance.
</system>

<user>
User question: "Comment parser des fichiers TypeScript?"

Query used to get these results:
```typescript
rag.scope()
  .whereFile({ contains: 'parsers' })
  .semanticSearchBySource('extract AST functions', { topK: 50 })
```

Evaluate if each scope below is relevant to the user's question.

<scopes>
  <scope id="1">
    <name>parseFile</name>
    <type>method</type>
    <file>src/lib/parsers/TypeScriptParser.ts</file>
    <signature>parseFile(filePath: string): FileAnalysis</signature>
    <source>
    async parseFile(filePath: string): Promise<FileAnalysis> {
      const content = await fs.readFile(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      return this.analyzeSourceFile(sourceFile);
    }
    </source>
  </scope>

  <scope id="2">
    <name>extractScopes</name>
    <type>method</type>
    <file>src/lib/parsers/TypeScriptParser.ts</file>
    <signature>extractScopes(node: ts.Node): TypeScriptScope[]</signature>
    <source>...</source>
  </scope>

  ... (8 more scopes)
</scopes>

For each scope, output:

<evaluation>
  <scope_evaluations>
    <scope id="1">
      <relevant>true|false</relevant>
      <score>0.0-1.0</score>
      <reasoning>Why this scope is/isn't relevant</reasoning>
    </scope>
    <scope id="2">
      <relevant>true|false</relevant>
      <score>0.0-1.0</score>
      <reasoning>...</reasoning>
    </scope>
    ...
  </scope_evaluations>

  <query_feedback>
    <quality>excellent|good|insufficient|poor</quality>
    <suggestions>
      <suggestion>
        <type>add_filter|change_semantic|expand_relationships|other</type>
        <description>Suggestion text here</description>
        <example_code>
          rag.scope()
            .whereFile({ contains: 'parsers/TypeScriptParser' })
            .semanticSearchBySource('parse extract AST', { topK: 30 })
        </example_code>
      </suggestion>
    </suggestions>
  </query_feedback>
</evaluation>
```

### 4. Response Processing

```typescript
interface ScopeEvaluation {
  scopeId: string;
  relevant: boolean;
  score: number;     // 0.0 - 1.0
  reasoning: string;
}

interface QueryFeedback {
  quality: 'excellent' | 'good' | 'insufficient' | 'poor';
  suggestions: QuerySuggestion[];
}

interface QuerySuggestion {
  type: 'add_filter' | 'change_semantic' | 'expand_relationships' | 'other';
  description: string;
  exampleCode?: string;
}

interface LLMRerankResult {
  evaluations: ScopeEvaluation[];
  queryFeedback?: QueryFeedback;
}
```

### 5. Score Merging

Les scores LLM sont combinés avec les scores vector search:

```typescript
// Option 1: Weighted average
finalScore = 0.3 * vectorScore + 0.7 * llmScore

// Option 2: Multiplicative
finalScore = vectorScore * llmScore

// Option 3: LLM override (si très confiant)
if (llmScore > 0.9) {
  finalScore = llmScore
} else {
  finalScore = 0.5 * vectorScore + 0.5 * llmScore
}
```

## Implementation

### QueryBuilder Extension

```typescript
export class QueryBuilder<T = any> {
  private llmReranking?: {
    userQuestion: string;
    options: LLMRerankOptions;
  };

  /**
   * Rerank results using LLM evaluation
   */
  llmRerankResults(
    userQuestion: string,
    options?: LLMRerankOptions
  ): this {
    this.llmReranking = { userQuestion, options: options || {} };
    return this;
  }

  async execute(): Promise<SearchResult<T>[]> {
    // ... existing code ...

    // After semantic search
    if (this.llmReranking) {
      results = await this.applyLLMReranking(
        results,
        this.llmReranking.userQuestion,
        this.llmReranking.options
      );
    }

    // ... rest of execution ...
  }

  private async applyLLMReranking(
    results: SearchResult<T>[],
    userQuestion: string,
    options: LLMRerankOptions
  ): Promise<SearchResult<T>[]> {
    const reranker = new LLMReranker(this.llmClient, options);

    // Rerank with LLM
    const reranked = await reranker.rerank({
      userQuestion,
      results,
      queryContext: this.buildQueryContext()
    });

    // Update scores
    return results.map(r => {
      const evaluation = reranked.evaluations.find(e => e.scopeId === r.entity.uuid);
      if (!evaluation) return r;

      const newScore = this.mergeScores(r.score, evaluation.score);

      return {
        ...r,
        score: newScore,
        scoreBreakdown: {
          ...r.scoreBreakdown,
          llm: evaluation.score,
          llmReasoning: evaluation.reasoning
        }
      };
    }).sort((a, b) => b.score - a.score);
  }

  private buildQueryContext(): string {
    // Reconstruct the query chain for LLM context
    let context = 'rag.scope()';

    if (Object.keys(this.filters).length > 0) {
      context += `\n  .where(${JSON.stringify(this.filters)})`;
    }

    if (this.semanticQuery) {
      const { text, options } = this.semanticQuery;
      context += `\n  .semanticSearchBySource('${text}', { topK: ${options.topK || 20} })`;
    }

    // ... other query parts ...

    return context;
  }
}
```

### LLMReranker Class

```typescript
export class LLMReranker {
  constructor(
    private llmClient: LLMClient,
    private options: LLMRerankOptions
  ) {}

  async rerank(input: {
    userQuestion: string;
    results: SearchResult[];
    queryContext?: string;
  }): Promise<LLMRerankResult> {
    const {
      batchSize = 10,
      parallel = 5,
      minScore = 0.0,
      withSuggestions = false
    } = this.options;

    // 1. Split results into batches
    const batches = this.createBatches(input.results, batchSize);

    // 2. Process batches in parallel with limit
    const allEvaluations: ScopeEvaluation[] = [];
    let queryFeedback: QueryFeedback | undefined;

    for (let i = 0; i < batches.length; i += parallel) {
      const batchGroup = batches.slice(i, i + parallel);

      // Process this group in parallel
      const promises = batchGroup.map((batch, idx) =>
        this.evaluateBatch(
          batch,
          input.userQuestion,
          input.queryContext,
          withSuggestions && i === 0 && idx === 0 // Only ask for suggestions once
        )
      );

      const results = await Promise.all(promises);

      // Merge results
      results.forEach(r => {
        allEvaluations.push(...r.evaluations);
        if (r.queryFeedback) {
          queryFeedback = r.queryFeedback;
        }
      });
    }

    // 3. Filter by minimum score
    const filtered = allEvaluations.filter(e => e.score >= minScore);

    return {
      evaluations: filtered,
      queryFeedback
    };
  }

  private createBatches(results: SearchResult[], size: number): SearchResult[][] {
    const batches: SearchResult[][] = [];
    for (let i = 0; i < results.length; i += size) {
      batches.push(results.slice(i, i + size));
    }
    return batches;
  }

  private async evaluateBatch(
    batch: SearchResult[],
    userQuestion: string,
    queryContext?: string,
    withSuggestions: boolean = false
  ): Promise<LLMRerankResult> {
    const prompt = this.buildPrompt(batch, userQuestion, queryContext, withSuggestions);

    const response = await this.llmClient.generate(prompt);

    return this.parseResponse(response, batch);
  }

  private buildPrompt(
    batch: SearchResult[],
    userQuestion: string,
    queryContext?: string,
    withSuggestions: boolean
  ): string {
    let prompt = `You are evaluating code search results for relevance.

User question: "${userQuestion}"
`;

    if (queryContext) {
      prompt += `
Query used to get these results:
\`\`\`typescript
${queryContext}
\`\`\`
`;
    }

    prompt += `
Evaluate if each scope below is relevant to the user's question.

<scopes>
`;

    batch.forEach((result, idx) => {
      const scope = result.entity;
      prompt += `  <scope id="${idx}">
    <name>${scope.name}</name>
    <type>${scope.type}</type>
    <file>${scope.file}</file>
`;

      if (scope.signature) {
        prompt += `    <signature>${this.escapeXml(scope.signature)}</signature>
`;
      }

      if (scope.source) {
        // Truncate source if too long
        const source = scope.source.length > 500
          ? scope.source.substring(0, 500) + '...'
          : scope.source;
        prompt += `    <source>${this.escapeXml(source)}</source>
`;
      }

      prompt += `  </scope>

`;
    });

    prompt += `</scopes>

For each scope, output:

<evaluation>
  <scope_evaluations>
    <scope id="0">
      <relevant>true|false</relevant>
      <score>0.0-1.0</score>
      <reasoning>Why this scope is/isn't relevant</reasoning>
    </scope>
    ...
  </scope_evaluations>
`;

    if (withSuggestions) {
      prompt += `
  <query_feedback>
    <quality>excellent|good|insufficient|poor</quality>
    <suggestions>
      <suggestion>
        <type>add_filter|change_semantic|expand_relationships|other</type>
        <description>Suggestion text here</description>
        <example_code>Code example (optional)</example_code>
      </suggestion>
    </suggestions>
  </query_feedback>
`;
    }

    prompt += `</evaluation>`;

    return prompt;
  }

  private parseResponse(response: string, batch: SearchResult[]): LLMRerankResult {
    const doc = new LuciformXMLParser(response, { mode: 'luciform-permissive' }).parse();
    const evaluationNode = doc.document?.root?.children?.find((c: any) => c.name === 'evaluation');

    if (!evaluationNode) {
      throw new Error('LLM did not return <evaluation> tag');
    }

    // Parse scope evaluations
    const scopeEvalsNode = evaluationNode.children?.find((c: any) => c.name === 'scope_evaluations');
    const evaluations: ScopeEvaluation[] = [];

    if (scopeEvalsNode) {
      const scopeNodes = scopeEvalsNode.children?.filter((c: any) => c.name === 'scope') || [];

      scopeNodes.forEach((scopeNode: any) => {
        const id = scopeNode.attributes?.get('id');
        const idx = parseInt(id || '0', 10);

        if (idx < batch.length) {
          const relevantText = getElementText(scopeNode.children?.find((c: any) => c.name === 'relevant'));
          const scoreText = getElementText(scopeNode.children?.find((c: any) => c.name === 'score'));
          const reasoning = getElementText(scopeNode.children?.find((c: any) => c.name === 'reasoning'));

          evaluations.push({
            scopeId: batch[idx].entity.uuid,
            relevant: relevantText === 'true',
            score: parseFloat(scoreText) || 0.0,
            reasoning
          });
        }
      });
    }

    // Parse query feedback (if present)
    let queryFeedback: QueryFeedback | undefined;
    const feedbackNode = evaluationNode.children?.find((c: any) => c.name === 'query_feedback');

    if (feedbackNode) {
      const quality = getElementText(feedbackNode.children?.find((c: any) => c.name === 'quality')) as any;
      const suggestionsNode = feedbackNode.children?.find((c: any) => c.name === 'suggestions');
      const suggestions: QuerySuggestion[] = [];

      if (suggestionsNode) {
        const suggestionNodes = suggestionsNode.children?.filter((c: any) => c.name === 'suggestion') || [];

        suggestionNodes.forEach((sNode: any) => {
          suggestions.push({
            type: getElementText(sNode.children?.find((c: any) => c.name === 'type')) as any,
            description: getElementText(sNode.children?.find((c: any) => c.name === 'description')),
            exampleCode: getElementText(sNode.children?.find((c: any) => c.name === 'example_code')) || undefined
          });
        });
      }

      queryFeedback = { quality, suggestions };
    }

    return { evaluations, queryFeedback };
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

function getElementText(element: any): string {
  if (!element || !element.children) return '';
  const textNodes = element.children.filter((c: any) => c.type === 'text');
  return textNodes.map((n: any) => n.content || '').join('').trim();
}
```

## Configuration

```typescript
interface LLMRerankOptions {
  /**
   * Number of scopes per LLM request
   * Default: 10
   */
  batchSize?: number;

  /**
   * Maximum parallel LLM requests
   * Default: 5
   */
  parallel?: number;

  /**
   * Minimum relevance score to keep
   * Default: 0.0 (keep all)
   */
  minScore?: number;

  /**
   * Request query improvement suggestions
   * Default: false
   */
  withSuggestions?: boolean;

  /**
   * Score merging strategy
   * Default: 'weighted'
   */
  scoreMerging?: 'weighted' | 'multiplicative' | 'llm-override';

  /**
   * Weights for score merging (if strategy = 'weighted')
   * Default: { vector: 0.3, llm: 0.7 }
   */
  weights?: {
    vector: number;
    llm: number;
  };
}
```

## Usage Examples

### Example 1: Simple Reranking

```typescript
const results = await rag.scope()
  .semanticSearchBySource('typescript parser', { topK: 50 })
  .llmRerankResults("Comment parser des fichiers TypeScript?")
  .limit(10)
  .execute();

// Results are now LLM-reranked
results.forEach(r => {
  console.log(r.entity.name, r.score);
  console.log('LLM reasoning:', r.scoreBreakdown.llmReasoning);
});
```

### Example 2: With Query Suggestions

```typescript
const results = await rag.scope()
  .whereFile({ contains: 'parsers' })
  .semanticSearchBySource('extract AST', { topK: 50 })
  .llmRerankResults("Où est le code d'extraction AST?", {
    withSuggestions: true
  })
  .execute();

// Access query feedback
if (results.queryFeedback) {
  console.log('Query quality:', results.queryFeedback.quality);
  console.log('Suggestions:');
  results.queryFeedback.suggestions.forEach(s => {
    console.log(`  - ${s.type}: ${s.description}`);
    if (s.exampleCode) {
      console.log(`    Example:\n${s.exampleCode}`);
    }
  });
}
```

### Example 3: Conservative Reranking

```typescript
const results = await rag.scope()
  .semanticSearchBySource('database queries', { topK: 100 })
  .llmRerankResults("Comment exécuter des queries Neo4j?", {
    batchSize: 15,      // Larger batches
    parallel: 3,        // Conservative parallelism
    minScore: 0.7,      // Only keep highly relevant
    scoreMerging: 'multiplicative'  // Require both vector AND llm to agree
  })
  .execute();
```

## Performance Considerations

### Cost Estimation

Assuming Gemini Flash pricing (~$0.075 / 1M input tokens):

```
100 results
Batch size: 10
→ 10 LLM requests

Average scope size: 200 tokens (signature + source)
Prompt overhead: 300 tokens
→ 2000 + 300 = 2300 tokens per request
→ 23,000 tokens total

Cost: ~$0.002 per query
```

**For 1000 queries/day:** ~$2/day = ~$60/month

### Latency

With parallel=5:

```
10 batches, parallel=5
→ 2 rounds of parallel execution

Gemini Flash latency: ~1-2s per request
→ Total: ~2-4s for reranking
```

### Optimization Strategies

1. **Smart batching:** Group similar scopes together
2. **Caching:** Cache LLM evaluations by (scope_uuid, user_question)
3. **Early termination:** Stop if first batches have low scores
4. **Adaptive parallelism:** Increase/decrease based on load

## Integration with Iterative Agent

The iterative agent can use query feedback:

```typescript
// Agent iteration 1
const results = await rag.scope()
  .semanticSearchBySource('parser', { topK: 50 })
  .llmRerankResults(userQuestion, { withSuggestions: true })
  .execute();

// Use suggestions for next iteration
if (results.queryFeedback?.suggestions.length > 0) {
  const suggestion = results.queryFeedback.suggestions[0];

  // Agent iteration 2 (improved query)
  if (suggestion.exampleCode) {
    // Execute the suggested code
    eval(suggestion.exampleCode);
  }
}
```

## Testing Strategy

### Unit Tests

- Batch creation
- Parallel execution
- Score merging algorithms
- XML parsing

### Integration Tests

- Real LLM reranking (with Gemini)
- Query feedback parsing
- Score distribution analysis

### Quality Metrics

- **Precision@K:** Are top-K results truly relevant?
- **NDCG:** Normalized discounted cumulative gain
- **Agreement:** LLM score vs human judgment
- **Cost efficiency:** Cost per query vs quality gain

## Future Enhancements

### 1. Hybrid Reranking

Combine multiple signals:

```typescript
.hybridRerank({
  llm: 0.4,           // LLM evaluation
  vector: 0.3,        // Vector similarity
  topology: 0.2,      // Graph centrality
  recency: 0.1        // Code recency
})
```

### 2. Multi-LLM Ensemble

Use multiple LLMs and average scores:

```typescript
.llmRerankResults(question, {
  llms: ['gemini', 'gpt-4', 'claude'],
  aggregation: 'mean'
})
```

### 3. Incremental Reranking

Rerank only top-K initially, expand if needed:

```typescript
.llmRerankResults(question, {
  incremental: true,
  initialK: 10,      // Rerank top 10 first
  expandIf: (scores) => scores.some(s => s < 0.7)
})
```

### 4. Learning to Rank

Train a model on LLM evaluations:

```typescript
// Collect training data
const dataset = await collectLLMEvaluations(1000);

// Train lightweight model
const model = trainRanker(dataset);

// Use for fast reranking
.trainedRerank(model)
```

## Conclusion

LLM reranking apporte:

✅ **Meilleure pertinence** - Évaluation sémantique profonde
✅ **Query feedback** - Suggestions d'amélioration
✅ **Flexibilité** - Configurable (batch, parallel, scoring)
✅ **Intégration fluente** - S'insère naturellement dans l'API

**Coût:** ~$0.002/query
**Latency:** ~2-4s
**Gain de qualité:** Estimé 20-30% improvement en Precision@10

🚀 **Ready to implement!**
