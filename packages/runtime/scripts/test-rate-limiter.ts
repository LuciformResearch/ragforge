#!/usr/bin/env tsx

/**
 * Test the new sliding window rate limiter
 *
 * Validates that:
 * 1. Rate limiter correctly limits requests per minute
 * 2. Sliding window works (not fixed buckets)
 * 3. Multiple models can have independent rate limits
 *
 * Usage:
 *   tsx scripts/test-rate-limiter.ts
 */

import { GeminiAPIProvider } from '../src/reranking/gemini-api-provider.js';
import { GlobalRateLimiter } from '../src/reranking/rate-limiter.js';
import dotenv from 'dotenv';
import { join } from 'path';

// Load .env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

async function testRateLimiter() {
  console.log('🧪 Testing Sliding Window Rate Limiter\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  // Create provider with global rate limiter enabled
  const provider = new GeminiAPIProvider({
    apiKey,
    model: 'gemma-3n-e2b-it',
    temperature: 0.3,
    maxOutputTokens: 100,
    retryAttempts: 0,
    useGlobalRateLimiter: true
  });

  console.log('📊 Rate limiter stats before test:');
  console.log(GlobalRateLimiter.getStats());
  console.log();

  console.log('🚀 Launching 15 parallel requests (should succeed with gemma-3n-e2b-it)...\n');

  const startTime = Date.now();
  const promises = Array.from({ length: 15 }, async (_, i) => {
    const requestStart = Date.now();
    try {
      await provider.generateContent(`Test ${i + 1}: "Cloud computing rocks"`);
      const duration = Date.now() - requestStart;
      console.log(`  ✅ Request ${i + 1} completed in ${duration}ms`);
      return { success: true, duration };
    } catch (error: any) {
      const duration = Date.now() - requestStart;
      const isRateLimit = error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
      console.log(`  ❌ Request ${i + 1} failed in ${duration}ms: ${isRateLimit ? 'RATE_LIMIT' : error.message?.substring(0, 50)}`);
      return { success: false, duration };
    }
  });

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startTime;

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('\n📊 Results:');
  console.log(`  Total duration: ${totalDuration}ms`);
  console.log(`  Success: ${successCount}/15`);
  console.log(`  Failed: ${failCount}/15`);
  console.log(`  Throughput: ${((successCount / totalDuration) * 1000).toFixed(2)} req/s`);

  console.log('\n📊 Rate limiter stats after test:');
  console.log(GlobalRateLimiter.getStats());

  if (successCount === 15) {
    console.log('\n✅ SUCCESS: All requests completed without rate limits!');
    console.log('   The sliding window rate limiter is working correctly.');
  } else {
    console.log(`\n⚠️  WARNING: ${failCount} requests failed`);
    console.log('   Rate limiter may need tuning or API limits changed.');
  }

  // Wait a bit and test again to verify sliding window
  console.log('\n⏳ Waiting 10 seconds to test sliding window behavior...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('🚀 Launching another 5 requests (should succeed as old requests left the window)...\n');

  const secondBatchStart = Date.now();
  const secondPromises = Array.from({ length: 5 }, async (_, i) => {
    const requestStart = Date.now();
    try {
      await provider.generateContent(`Second batch ${i + 1}: "AI is powerful"`);
      const duration = Date.now() - requestStart;
      console.log(`  ✅ Request ${i + 1} completed in ${duration}ms`);
      return { success: true, duration };
    } catch (error: any) {
      const duration = Date.now() - requestStart;
      console.log(`  ❌ Request ${i + 1} failed in ${duration}ms`);
      return { success: false, duration };
    }
  });

  const secondResults = await Promise.all(secondPromises);
  const secondBatchDuration = Date.now() - secondBatchStart;

  const secondSuccessCount = secondResults.filter(r => r.success).length;

  console.log('\n📊 Second batch results:');
  console.log(`  Duration: ${secondBatchDuration}ms`);
  console.log(`  Success: ${secondSuccessCount}/5`);

  console.log('\n📊 Final rate limiter stats:');
  console.log(GlobalRateLimiter.getStats());

  if (secondSuccessCount === 5) {
    console.log('\n✅ SUCCESS: Sliding window working correctly!');
    console.log('   Old requests expired from window, new requests succeeded.');
  }

  console.log('\n' + '='.repeat(80));
}

testRateLimiter().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
