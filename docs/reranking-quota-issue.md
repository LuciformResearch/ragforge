# Reranking Quota Exhaustion Issue

**Date**: 2025-11-11
**Status**: Needs optimization

## Problem

LLM reranking with Gemini API frequently hits quota limits when processing large result sets:

```
Error: Gemini API generation failed: quota exceeded for metric:
generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count
limit: 15000 tokens per minute
```

## Current Behavior

- Reranking sends full source code for each candidate to the LLM
- With 10+ results and large functions, this quickly exceeds 15K tokens/minute
- Example from `07-llm-reranking.ts` failed after embeddings generation

## Root Cause

The reranker sends complete `source` field content for each scope:
- `printRootHelp` function: ~1800 characters
- 10 results × ~1800 chars = ~18K characters = ~4500 tokens
- Multiple concurrent requests push this over the limit

## Potential Solutions (DO NOT TRIM SOURCE CODE)

### Option 1: Intelligent Batching & Rate Limiting
- Implement smarter rate limiting with exponential backoff
- Batch reranking requests with delays between batches
- Track API usage and throttle proactively

### Option 2: Use Summarization When Available
- If `summarization.rerank_use: prefer_summary` is configured
- Send summaries instead of full source for reranking
- Only send full source if no summary exists
- This is already partially implemented in config

### Option 3: Tiered Reranking
- First pass: rerank using summaries or metadata only
- Second pass: full source reranking only for top-N results
- Reduces token usage by ~80% while maintaining quality

### Option 4: Alternative LLM for Reranking
- Use cheaper/faster models like Gemini Flash for reranking
- Reserve expensive models for summarization
- Flash has 1M tokens/min vs 15K for gemma-3-2b

### Option 5: Request Queuing
- Implement a request queue with strict rate limits
- Serialize reranking requests if needed
- Add progress indicators for long queues

## Recommended Approach

Combine Option 2 and Option 4:
1. Use Gemini Flash (1M tokens/min) instead of gemma-3-2b
2. Prefer summaries when available and `prefer_summary` is set
3. Implement basic rate limiting with retry logic

## Implementation Priority

- [ ] Switch default reranking model to gemini-flash
- [ ] Respect `rerank_use: prefer_summary` setting
- [ ] Add configurable rate limits per provider
- [ ] Implement retry with exponential backoff
- [ ] Add queue system for batch operations

## Testing Required

- Test with large codebases (100+ files)
- Verify summary-based reranking quality
- Benchmark token usage before/after
- Test quota limit handling gracefully
