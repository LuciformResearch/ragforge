# LLM Parallel Execution Optimization

## Overview

This document outlines findings and optimization strategies for parallel LLM execution with Gemini API in RagForge's runtime package.

## Current Performance Analysis

### Test Execution Times
- **Initial**: ~90 seconds for multi-format tests
- **After optimization**: ~40 seconds (55% improvement)
- **Main bottleneck**: Rate limiting and sequential request execution

### Diagnostic Findings

From diagnostic logs added to `GeminiAPIProvider` and `StructuredLLMExecutor`:

```
📦 Batching: 2 items → 1 batch(es) | Items per batch: [2] | Parallel: 5
🚀 Launching 1 requests in parallel (batch group 1/1)
📤 Sending request | Prompt: 464 chars | Model: gemini-2.0-flash-exp
📥 Response received | Response: ~200 chars | Duration: ~1-2s
```

**Key observations**:
- Current tests only send 2 items each
- This creates only 1 batch per test
- Therefore only 1 request executes at a time (no parallelism utilized)
- Proactive throttling waits 6 seconds between each sequential request
- Despite `parallel: 5` configuration, no parallel execution occurs

## Gemini API Rate Limits

For `gemini-2.0-flash-exp`:
- **Limit**: 10 requests per minute
- **Practical spacing**: 6 seconds between requests (proactive throttling)
- **Historical observation**: User reports successfully sending 10-20 requests in parallel in previous projects

## Rate Limiting Strategies

RagForge now supports **three rate limiting strategies** to handle API limits:

### 1. Reactive Strategy (Default - Recommended)

**How it works**: Launches all requests immediately. If a 429 occurs, waits until the oldest request is >1 minute old, then retries.

```typescript
const provider = new GeminiAPIProvider({
  apiKey: GEMINI_API_KEY,
  model: 'any-model', // Model-agnostic!
  rateLimitStrategy: 'reactive' // Default
});
```

**Benefits**:
- **Model-agnostic**: Works with any model/API rate limits
- Maximum speed until hitting rate limits
- Best throughput for bursts with pauses
- Adaptive to actual API capacity
- Automatically recovers from 429 errors

**Tradeoffs**:
- Will encounter 429 errors (but recovers automatically)
- Less predictable timing

**Why default**: Since users may use various models with different rate limits, reactive strategy adapts automatically without needing to configure specific limits.

### 2. Proactive Strategy

**How it works**: Uses a sliding window rate limiter to prevent 429 errors before they happen.

```typescript
const provider = new GeminiAPIProvider({
  apiKey: GEMINI_API_KEY,
  model: 'gemma-3n-e2b-it',
  rateLimitStrategy: 'proactive'
});
```

**Benefits**:
- No 429 errors (prevents them proactively)
- Predictable performance
- Best for high-volume parallel requests with known rate limits

**Tradeoffs**:
- Requires knowing the model's rate limits (hardcoded: 15 RPM for gemma, 10 RPM for gemini-flash)
- May wait even when API could handle more requests
- Slightly conservative

### 3. None Strategy

**How it works**: No rate limiting at all. API handles everything.

```typescript
const provider = new GeminiAPIProvider({
  apiKey: GEMINI_API_KEY,
  model: 'gemma-3n-e2b-it',
  rateLimitStrategy: 'none'
});
```

**Use cases**:
- Very low request volumes (<5 RPM)
- Testing/development
- ⚠️ Not recommended for production with parallel requests

## Implemented Optimizations

### 1. Proactive Throttling
**File**: `gemini-api-provider.ts:80-91`

```typescript
private async throttle(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - this.lastRequestTime;

  if (this.lastRequestTime > 0 && timeSinceLastRequest < this.minRequestInterval) {
    const waitTime = this.minRequestInterval - timeSinceLastRequest;
    console.log(`[GeminiAPIProvider] Proactive throttling: waiting ${waitTime}ms to avoid rate limit`);
    await this.sleep(waitTime);
  }

  this.lastRequestTime = Date.now();
}
```

**Benefits**:
- Prevents hitting 429 rate limit errors
- Avoids wasted retry attempts
- More predictable execution time

**Drawback**:
- Currently prevents parallel requests when using single provider instance

### 2. Aggressive Retry Strategy
**File**: `gemini-api-provider.ts:115-127`

```typescript
// Use 50% of suggested delay, or our exponential backoff, whichever is smaller
let retryAfter = this.retryDelay * Math.pow(2, attempt); // Exponential backoff

const retryMatch = error.message?.match(/retryDelay[\"']?\s*:\s*[\"']?(\d+)s/);
if (retryMatch) {
  const suggestedDelay = parseInt(retryMatch[1], 10) * 1000;
  retryAfter = Math.min(suggestedDelay * 0.5, retryAfter);
}

// Cap at reasonable maximum (30s)
retryAfter = Math.min(retryAfter, 30000);
```

**Benefits**:
- Faster recovery from rate limits
- 50% of suggested delay instead of 100%
- 30 second cap prevents excessive waiting

### 3. Diagnostic Logging

Added comprehensive logging to track:
- **Prompt size** (characters)
- **Response size** (characters)
- **Request duration** (milliseconds)
- **Batching configuration** (items → batches mapping)
- **Parallel execution count** (actual concurrent requests)

## Optimization Ideas

### Problem: Lack of True Parallelism

Current architecture has a fundamental conflict:
- **StructuredLLMExecutor** supports parallel batches (`parallel: 5`)
- **GeminiAPIProvider** enforces sequential execution (6s spacing per instance)
- **Test structure** creates 1 batch per test (only 2 items)

### Proposed Solutions

#### Option 1: Shared Provider Instance with Global Rate Limiter

**Current behavior**: Each test creates its own provider instance, each tracks rate limits independently.

**Proposed change**: Share a single `GeminiAPIProvider` instance across all tests with a global rate limiter.

**Implementation**:
```typescript
// Global singleton rate limiter
class GlobalRateLimiter {
  private static instance: GlobalRateLimiter;
  private requestQueue: Array<() => Promise<void>> = [];
  private activeRequests = 0;
  private maxParallel = 10; // To be determined by diagnostic script
  private minInterval = 6000;
  private lastRequestTime = 0;

  static getInstance(): GlobalRateLimiter {
    if (!this.instance) {
      this.instance = new GlobalRateLimiter();
    }
    return this.instance;
  }

  async executeWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for available slot in parallel execution
    await this.waitForSlot();

    // Execute with global rate tracking
    this.activeRequests++;
    try {
      return await fn();
    } finally {
      this.activeRequests--;
      this.lastRequestTime = Date.now();
    }
  }
}
```

**Benefits**:
- True parallel execution up to rate limit
- Shared rate limit tracking across all tests
- Better utilization of Gemini API capacity

**Drawbacks**:
- More complex implementation
- Requires refactoring test structure

#### Option 2: Increase Items Per Test

**Current**: Tests send 2 items → 1 batch → 1 request

**Proposed**: Tests send 10-20 items → 2-4 batches → parallel requests

**Benefits**:
- Simpler implementation (just add more test items)
- Leverages existing `parallel: 5` configuration
- Tests parallel batching logic more thoroughly

**Drawbacks**:
- Tests become more complex
- Still limited by per-instance rate limiting

#### Option 3: Remove Proactive Throttling, Rely on Reactive Retry

**Current**: Wait 6s between requests proactively

**Proposed**: Allow parallel requests, handle 429 errors with aggressive retry

**Benefits**:
- Maximizes parallel throughput
- Simpler provider implementation
- Better for batch operations

**Drawbacks**:
- More 429 errors (but handled by retry)
- Less predictable execution time
- May waste some API quota on failed attempts

## Next Steps

1. **Run diagnostic script** (`scripts/test-parallel-capacity.ts`) to determine:
   - Actual maximum parallel requests supported by Gemini API
   - Whether 10-20 parallel requests are feasible
   - Impact of parallel requests on error rates

2. **Choose optimization strategy** based on diagnostic results:
   - If 10-20 parallel works: Implement Option 3 (remove proactive throttling)
   - If 5-10 parallel works: Implement Option 1 (global rate limiter)
   - If <5 parallel works: Keep current approach, optimize elsewhere

3. **Measure impact** on:
   - Test execution time
   - Error rates (429 responses)
   - Total API quota usage

## References

- `packages/runtime/src/reranking/gemini-api-provider.ts` - Provider implementation with throttling
- `packages/runtime/src/llm/structured-llm-executor.ts` - Batching and parallel execution
- `packages/runtime/src/llm/__tests__/structured-llm-executor.test.ts` - Test suite
- `packages/runtime/test-logs/mixed-format-*.log` - Diagnostic log outputs
