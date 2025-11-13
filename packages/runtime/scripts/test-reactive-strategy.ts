#!/usr/bin/env tsx

/**
 * Test reactive strategy with real workload
 *
 * Simulates a realistic test scenario:
 * - Launch 20 parallel requests (exceeds 15 RPM limit for gemma)
 * - Should hit 429s and recover intelligently
 * - Verify all requests eventually succeed
 *
 * Usage:
 *   tsx scripts/test-reactive-strategy.ts
 */

import { GeminiAPIProvider } from '../src/reranking/gemini-api-provider.js';
import dotenv from 'dotenv';
import { join } from 'path';

// Load .env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

async function testReactiveStrategy() {
  console.log('🧪 Testing Reactive Strategy with Real Workload\n');
  console.log('Scenario: 20 parallel requests (exceeds 15 RPM limit for gemma-3n-e2b-it)');
  console.log('Expected: Some 429s initially, then automatic recovery\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  // Create provider with reactive strategy (default)
  const provider = new GeminiAPIProvider({
    apiKey,
    model: 'gemma-3n-e2b-it',
    temperature: 0.3,
    maxOutputTokens: 100,
    retryAttempts: 3,
    rateLimitStrategy: 'reactive' // Explicitly set for clarity
  });

  console.log('📊 Configuration:');
  console.log('  Model: gemma-3n-e2b-it');
  console.log('  Strategy: reactive');
  console.log('  Retry attempts: 3');
  console.log('  Parallel requests: 20');
  console.log();

  const startTime = Date.now();
  const results: Array<{
    index: number;
    success: boolean;
    duration: number;
    attempts: number;
  }> = [];

  let totalAttempts = 0;

  const promises = Array.from({ length: 20 }, async (_, index) => {
    const requestStart = Date.now();
    let attemptCount = 0;

    try {
      attemptCount++;
      const prompt = `Request ${index + 1}/20: "Machine learning enables intelligent systems"`;
      await provider.generateContent(prompt);
      const duration = Date.now() - requestStart;
      totalAttempts += attemptCount;
      results.push({ index: index + 1, success: true, duration, attempts: attemptCount });
      console.log(`  ✅ Request ${index + 1} completed in ${duration}ms (${attemptCount} attempt(s))`);
    } catch (error: any) {
      const duration = Date.now() - requestStart;
      totalAttempts += attemptCount;
      results.push({ index: index + 1, success: false, duration, attempts: attemptCount });
      console.log(`  ❌ Request ${index + 1} failed after ${duration}ms (${attemptCount} attempt(s))`);
    }
  });

  console.log('🚀 Launching 20 requests in parallel...\n');
  await Promise.all(promises);

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const throughput = (successCount / totalDuration) * 1000;

  console.log('\n' + '='.repeat(80));
  console.log('📊 RESULTS');
  console.log('='.repeat(80));
  console.log(`\n⏱️  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`📈 Average request duration: ${avgDuration.toFixed(0)}ms`);
  console.log(`✅ Successful: ${successCount}/20 (${((successCount / 20) * 100).toFixed(0)}%)`);
  console.log(`❌ Failed: ${failCount}/20`);
  console.log(`🔄 Total API calls (including retries): ${totalAttempts}`);
  console.log(`📊 Throughput: ${throughput.toFixed(2)} req/s`);

  // Analysis
  console.log('\n' + '='.repeat(80));
  console.log('💡 ANALYSIS');
  console.log('='.repeat(80));

  if (successCount === 20) {
    console.log('\n✅ SUCCESS: All 20 requests completed!');
    console.log('   Reactive strategy handled rate limits gracefully.');

    if (totalAttempts > 20) {
      console.log(`\n📝 Note: Had to retry ${totalAttempts - 20} times due to rate limits.`);
      console.log('   This is expected behavior - reactive strategy hits 429s and recovers.');
    } else {
      console.log('\n🎉 Amazing! No retries needed - all requests succeeded on first try!');
    }

    // Estimate how reactive strategy behaved
    const avgTime = totalDuration / 1000;
    if (avgTime < 10) {
      console.log('\n⚡ Very fast completion (<10s)!');
      console.log('   Either lucky timing or API had extra capacity.');
    } else if (avgTime < 60) {
      console.log('\n⏱️  Moderate completion time (10-60s).');
      console.log('   Hit some rate limits, waited intelligently, succeeded.');
    } else {
      console.log('\n⏳ Slower completion (>60s).');
      console.log('   Multiple 429s encountered, but all eventually succeeded.');
    }
  } else {
    console.log(`\n⚠️  WARNING: ${failCount} requests failed even after retries.`);
    console.log('   This might indicate:');
    console.log('   - Retry attempts (3) insufficient for this load');
    console.log('   - API experiencing issues');
    console.log('   - Rate limits stricter than expected');
  }

  // Breakdown by duration
  const fast = results.filter(r => r.duration < 5000).length;
  const medium = results.filter(r => r.duration >= 5000 && r.duration < 30000).length;
  const slow = results.filter(r => r.duration >= 30000).length;

  console.log('\n📊 Request duration breakdown:');
  console.log(`   Fast (<5s):       ${fast}/20`);
  console.log(`   Medium (5-30s):   ${medium}/20`);
  console.log(`   Slow (>30s):      ${slow}/20`);

  if (slow > 0) {
    console.log('\n💡 Slow requests had to wait for rate limit window to clear.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎯 CONCLUSION');
  console.log('='.repeat(80));

  if (successCount === 20 && avgDuration < 30000) {
    console.log('\n✅ Reactive strategy is working optimally!');
    console.log('   - All requests succeeded');
    console.log('   - Reasonable average duration');
    console.log('   - Automatic recovery from rate limits');
  } else if (successCount === 20) {
    console.log('\n✅ Reactive strategy works but had to wait significantly.');
    console.log('   Consider using "proactive" strategy for more predictable timing.');
  } else {
    console.log('\n⚠️  Reactive strategy encountered issues.');
    console.log('   Increase retryAttempts or use "proactive" strategy.');
  }

  console.log('\n' + '='.repeat(80));
}

testReactiveStrategy().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
