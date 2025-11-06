# LLM Reranking in RagForge

## Overview

LLM Reranking improves search result quality by using a language model to evaluate and rerank results based on their relevance to the user's question. This is particularly useful when vector similarity alone isn't sufficient to determine relevance.

## Why LLM Reranking?

**Vector search limitations:**
- Matches by embedding similarity, not semantic relevance
- Can't understand complex intent or context
- May rank code snippets by keyword overlap rather than actual relevance

**LLM reranking benefits:**
- Understands user's question semantically
- Evaluates code relevance in context
- Provides reasoning for each ranking decision
- Offers query improvement suggestions

## Architecture

```
User Query
    ↓
Vector Search (topK: 30-50)    ← Fast, broad retrieval
    ↓
LLM Reranking (Gemma 3n E2B)   ← Intelligent evaluation
    ↓
Final Results (limit: 5-10)     ← High quality, ranked
```

## Usage

### Basic Example

```typescript
import { createRagClient } from '@ragforge/core';
import { VertexAIProvider } from '@ragforge/runtime';

// Initialize RAG client
const rag = await createRagClient({
  configPath: './ragforge.yaml',
  neo4jUri: 'bolt://localhost:7687',
  neo4jUser: 'neo4j',
  neo4jPassword: 'password'
});

// Create LLM provider (Gemma 3n E2B - ultra cheap)
const llmProvider = VertexAIProvider.fromEnv('gemma-3n-e2b-it');

// Query with LLM reranking
const results = await rag.scope()
  .semanticSearchBySource('How does authentication work?', { topK: 30 })
  .llmRerank('How does authentication work?', llmProvider, {
    batchSize: 10,
    parallel: 3,
    minScore: 0.5,
    scoreMerging: 'weighted',
    weights: { vector: 0.3, llm: 0.7 }
  })
  .limit(5)
  .execute();
```

### Configuration Options

```typescript
interface LLMRerankOptions {
  /**
   * Number of scopes per LLM request
   * Default: 10
   * Recommendation: 5-15 for optimal token usage
   */
  batchSize?: number;

  /**
   * Maximum parallel LLM requests
   * Default: 5
   * Recommendation: 3-5 to balance speed and quota limits
   */
  parallel?: number;

  /**
   * Minimum relevance score to keep (0.0-1.0)
   * Default: 0.0 (keep all)
   * Recommendation: 0.5-0.6 for quality filtering
   */
  minScore?: number;

  /**
   * Request query improvement suggestions
   * Default: false
   * Use: Set to true to get feedback on your query
   */
  withSuggestions?: boolean;

  /**
   * Score merging strategy
   * Default: 'weighted'
   *
   * - 'weighted': Combines vector and LLM scores with configurable weights
   * - 'multiplicative': Multiplies vector × LLM scores
   * - 'llm-override': Uses LLM score when highly confident (>0.9)
   */
  scoreMerging?: 'weighted' | 'multiplicative' | 'llm-override';

  /**
   * Weights for score merging (if strategy = 'weighted')
   * Default: { vector: 0.3, llm: 0.7 }
   *
   * Recommendations:
   * - Trust LLM more: { vector: 0.2, llm: 0.8 }
   * - Balanced: { vector: 0.5, llm: 0.5 }
   * - Trust vector more: { vector: 0.7, llm: 0.3 }
   */
  weights?: {
    vector: number;
    llm: number;
  };
}
```

## Model Choice: Gemma 3n E2B

**Why Gemma 3n E2B?**

- **Ultra cheap**: $0.005 per 1M input tokens (12x cheaper than Gemini Flash)
- **Fast**: Small model optimized for quick inference
- **Good enough**: Sufficient for binary relevance evaluation
- **High quotas**: 1000+ req/min on Vertex AI

**Cost Comparison (30k queries/month, 30 scopes each):**

| Model | Price per 1M tokens | Monthly Cost |
|-------|-------------------|--------------|
| Gemma 3n E2B | $0.005 | **$3.75** ⭐ |
| Gemini 2.5 Flash | $0.075 | $60.00 |
| Gemini 1.5 Pro | $1.25 | $1,000.00 |

**For 30k queries/month:**
- Input: ~135M tokens (30k × 30 scopes × 150 tokens)
- Gemma 3n E2B: $0.675 (~$0.68/month)
- Gemini Flash: $10.13/month

## Environment Setup

### Required Environment Variables

```bash
# Vertex AI Project
export VERTEX_PROJECT_ID="your-project-id"
export VERTEX_LOCATION="us-central1"  # Optional, defaults to us-central1

# Google Cloud credentials
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

### Creating Service Account

```bash
# 1. Create service account
gcloud iam service-accounts create ragforge-llm \
  --display-name="RagForge LLM Reranking"

# 2. Grant Vertex AI User role
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:ragforge-llm@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# 3. Create key
gcloud iam service-accounts keys create credentials.json \
  --iam-account=ragforge-llm@YOUR_PROJECT_ID.iam.gserviceaccount.com

# 4. Set environment variable
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/credentials.json"
```

## Score Breakdown

When using LLM reranking, results include a detailed score breakdown:

```typescript
{
  entity: { name: 'authenticateUser', type: 'function', ... },
  score: 0.82,  // Final merged score
  scoreBreakdown: {
    vector: 0.75,        // Original vector similarity
    llm: 0.95,           // LLM relevance score
    llmReasoning: 'This function directly implements user authentication...'
  }
}
```

## Query Feedback

Enable `withSuggestions: true` to get improvement suggestions:

```typescript
const results = await rag.scope()
  .semanticSearchBySource(query, { topK: 30 })
  .llmRerank(userQuestion, llmProvider, {
    withSuggestions: true  // ← Enable feedback
  })
  .execute();

// Console output:
// [LLM Reranking Feedback]
// Quality: good
// Suggestions:
//   - [add_filter] Filter by 'function' type for more precise results
//   - [expand_relationships] Include CONSUMES relationships to find dependencies
```

## Performance Optimization

### Batch Size

**Smaller batches (5-10):**
- ✅ More parallel requests
- ✅ Faster results
- ❌ Higher API overhead

**Larger batches (15-20):**
- ✅ Better token efficiency
- ✅ Lower API calls
- ❌ Slower per-batch processing

**Recommendation:** `batchSize: 10` for balanced performance

### Parallel Requests

```typescript
parallel: 3  // Conservative, safe for quotas
parallel: 5  // Balanced (default)
parallel: 10 // Aggressive, may hit rate limits
```

**Vertex AI quotas:**
- Free tier: 60 requests/min
- Paid: 1000+ requests/min

### TopK Selection

```typescript
// ❌ Too few results
.semanticSearchBySource(query, { topK: 10 })
.llmRerank(question, provider)
.limit(5)  // Only 10 results to rerank

// ✅ Good balance
.semanticSearchBySource(query, { topK: 30 })
.llmRerank(question, provider)
.limit(5)  // 30 results → rerank → top 5

// ⚠️  Expensive but thorough
.semanticSearchBySource(query, { topK: 100 })
.llmRerank(question, provider, { minScore: 0.6 })
.limit(10)  // 100 results → filter by LLM → top 10
```

**Recommendation:** `topK: 30-50` for most use cases

## Example Output

```
Question: How does authentication work?

1. authenticateUser (function)
   File: src/auth/authenticate.ts
   Final Score: 0.895
   Breakdown:
     - Vector: 0.782
     - LLM: 0.950
     - Reasoning: Main authentication function that validates credentials

2. verifyToken (function)
   File: src/auth/token.ts
   Final Score: 0.831
   Breakdown:
     - Vector: 0.654
     - LLM: 0.920
     - Reasoning: Token verification used in authentication flow

💰 Cost Estimation:
   Input tokens: ~4,500
   Cost: ~$0.000023 ($0.002¢)
   For 1000 queries: ~$0.02
```

## Best Practices

1. **Use appropriate topK**
   - Start with `topK: 30-50`
   - Increase if missing relevant results
   - Decrease for faster queries

2. **Set minScore for filtering**
   - `minScore: 0.5` - Balanced filtering
   - `minScore: 0.6` - High quality only
   - `minScore: 0.3` - Keep more results

3. **Choose right score merging**
   - Trust LLM: `weights: { vector: 0.3, llm: 0.7 }` (default)
   - Balanced: `weights: { vector: 0.5, llm: 0.5 }`
   - Trust vector: `weights: { vector: 0.7, llm: 0.3 }`

4. **Monitor costs**
   - Log token usage
   - Track query volumes
   - Set up billing alerts

5. **Enable suggestions during development**
   - Use `withSuggestions: true` while building
   - Disable in production to save tokens

## Troubleshooting

### "No candidates in response"

**Cause:** Vertex AI returned empty response

**Fix:**
```typescript
// Check model availability
const isAvailable = await llmProvider.isAvailable();
console.log('LLM available:', isAvailable);

// Verify credentials
console.log('Project ID:', process.env.VERTEX_PROJECT_ID);
console.log('Credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
```

### Rate limit errors

**Cause:** Too many parallel requests

**Fix:**
```typescript
// Reduce parallelism
.llmRerank(question, provider, {
  parallel: 3  // Lower from default 5
})
```

### High costs

**Cause:** Too many scopes or queries

**Fix:**
```typescript
// Reduce topK
.semanticSearchBySource(query, { topK: 20 })  // Lower from 50

// Add filtering
.llmRerank(question, provider, {
  minScore: 0.6  // Filter out low-scoring results
})

// Disable suggestions in production
.llmRerank(question, provider, {
  withSuggestions: false
})
```

## See Also

- [Vector Search Documentation](./vector-search.md)
- [Google AI Libraries Comparison](./google-ai-libraries-comparison.md)
- [Example: Test LLM Reranking](../examples/test-llm-reranking.ts)
