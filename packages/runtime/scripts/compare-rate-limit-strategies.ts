#!/usr/bin/env tsx

/**
 * Compare rate limiting strategies: Proactive vs Reactive vs None
 *
 * Tests:
 * - Proactive: Sliding window prevents 429s before they happen
 * - Reactive: Let requests fly until 429, then wait intelligently
 * - None: No rate limiting at all (for baseline)
 *
 * Usage:
 *   tsx scripts/compare-rate-limit-strategies.ts
 */

import { GeminiAPIProvider, type RateLimitStrategy } from '../src/reranking/gemini-api-provider.js';
import dotenv from 'dotenv';
import { join } from 'path';

// Load .env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

interface StrategyTestResult {
  strategy: RateLimitStrategy;
  parallelCount: number;
  totalDuration: number;
  successCount: number;
  errorCount: number;
  rateLimitErrors: number;
  throughput: number;
}

async function testStrategy(strategy: RateLimitStrategy, parallelCount: number = 20): Promise<StrategyTestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing ${strategy.toUpperCase()} strategy with ${parallelCount} parallel requests`);
  console.log('='.repeat(80));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const provider = new GeminiAPIProvider({
    apiKey,
    model: 'gemma-3n-e2b-it',
    temperature: 0.3,
    maxOutputTokens: 100,
    retryAttempts: 2, // Allow some retries
    rateLimitStrategy: strategy
  });

  const startTime = Date.now();
  const results: Array<{ success: boolean; duration: number; isRateLimit: boolean }> = [];

  const promises = Array.from({ length: parallelCount }, async (_, index) => {
    const requestStart = Date.now();
    try {
      const prompt = `Test ${index + 1}: "Technology evolves rapidly"`;
      await provider.generateContent(prompt);
      const duration = Date.now() - requestStart;
      results.push({ success: true, duration, isRateLimit: false });
      console.log(`  ✅ Request ${index + 1} completed in ${duration}ms`);
    } catch (error: any) {
      const duration = Date.now() - requestStart;
      const isRateLimit = error.message?.includes('429') ||
                          error.message?.includes('RESOURCE_EXHAUSTED') ||
                          error.message?.includes('quota');
      results.push({ success: false, duration, isRateLimit });
      console.log(`  ❌ Request ${index + 1} failed in ${duration}ms: ${isRateLimit ? 'RATE_LIMIT' : error.message?.substring(0, 50)}`);
    }
  });

  await Promise.all(promises);

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;
  const rateLimitErrors = results.filter(r => r.isRateLimit).length;
  const throughput = (successCount / totalDuration) * 1000;

  console.log(`\n📊 Results:`);
  console.log(`  Total duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
  console.log(`  Successful: ${successCount}/${parallelCount}`);
  console.log(`  Failed: ${errorCount}/${parallelCount}`);
  console.log(`  Rate limit errors: ${rateLimitErrors}/${parallelCount}`);
  console.log(`  Throughput: ${throughput.toFixed(2)} req/s`);

  return {
    strategy,
    parallelCount,
    totalDuration,
    successCount,
    errorCount,
    rateLimitErrors,
    throughput,
  };
}

async function compareStrategies() {
  console.log('🔬 Rate Limiting Strategy Comparison\n');
  console.log('Testing 20 parallel requests with each strategy');
  console.log('Model: gemma-3n-e2b-it (15 RPM limit)\n');

  const results: StrategyTestResult[] = [];

  // Test Proactive strategy
  const proactiveResult = await testStrategy('proactive', 20);
  results.push(proactiveResult);

  console.log('\n⏳ Waiting 65 seconds to reset rate limits...\n');
  await new Promise(resolve => setTimeout(resolve, 65000));

  // Test Reactive strategy
  const reactiveResult = await testStrategy('reactive', 20);
  results.push(reactiveResult);

  console.log('\n⏳ Waiting 65 seconds to reset rate limits...\n');
  await new Promise(resolve => setTimeout(resolve, 65000));

  // Test None strategy (baseline)
  const noneResult = await testStrategy('none', 20);
  results.push(noneResult);

  // Comparison summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log('\nStrategy   | Success | Errors | Rate Limits | Duration | Throughput');
  console.log('-'.repeat(80));

  for (const result of results) {
    console.log(
      `${result.strategy.padEnd(10)} | ` +
      `${result.successCount.toString().padStart(7)} | ` +
      `${result.errorCount.toString().padStart(6)} | ` +
      `${result.rateLimitErrors.toString().padStart(11)} | ` +
      `${(result.totalDuration / 1000).toFixed(1).padStart(7)}s | ` +
      `${result.throughput.toFixed(2).padStart(10)} req/s`
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(80));
  console.log('💡 ANALYSIS');
  console.log('='.repeat(80));

  const proactive = results.find(r => r.strategy === 'proactive');
  const reactive = results.find(r => r.strategy === 'reactive');
  const none = results.find(r => r.strategy === 'none');

  if (proactive && reactive && none) {
    console.log('\n📊 Success Rate:');
    console.log(`  Proactive: ${((proactive.successCount / proactive.parallelCount) * 100).toFixed(0)}% (${proactive.successCount}/20)`);
    console.log(`  Reactive:  ${((reactive.successCount / reactive.parallelCount) * 100).toFixed(0)}% (${reactive.successCount}/20)`);
    console.log(`  None:      ${((none.successCount / none.parallelCount) * 100).toFixed(0)}% (${none.successCount}/20)`);

    console.log('\n📊 Total Duration:');
    console.log(`  Proactive: ${(proactive.totalDuration / 1000).toFixed(1)}s`);
    console.log(`  Reactive:  ${(reactive.totalDuration / 1000).toFixed(1)}s`);
    console.log(`  None:      ${(none.totalDuration / 1000).toFixed(1)}s`);

    console.log('\n📊 Rate Limit Errors:');
    console.log(`  Proactive: ${proactive.rateLimitErrors} errors`);
    console.log(`  Reactive:  ${reactive.rateLimitErrors} errors (recovered via retry)`);
    console.log(`  None:      ${none.rateLimitErrors} errors (no recovery)`);

    // Determine winner
    console.log('\n' + '='.repeat(80));
    console.log('🏆 WINNER');
    console.log('='.repeat(80));

    // Winner is strategy with highest success rate, then lowest duration as tiebreaker
    const sortedBySuccess = [...results].sort((a, b) => {
      const successDiff = b.successCount - a.successCount;
      if (successDiff !== 0) return successDiff;
      return a.totalDuration - b.totalDuration;
    });

    const winner = sortedBySuccess[0];
    console.log(`\n✅ ${winner.strategy.toUpperCase()} strategy is optimal for this workload`);
    console.log(`   - Success rate: ${((winner.successCount / winner.parallelCount) * 100).toFixed(0)}%`);
    console.log(`   - Duration: ${(winner.totalDuration / 1000).toFixed(1)}s`);
    console.log(`   - Throughput: ${winner.throughput.toFixed(2)} req/s`);

    // Recommendations
    console.log('\n📝 RECOMMENDATIONS:');
    if (winner.strategy === 'proactive') {
      console.log('   Use PROACTIVE for:');
      console.log('   - High-volume parallel requests');
      console.log('   - Production environments');
      console.log('   - When predictable performance matters');
    } else if (winner.strategy === 'reactive') {
      console.log('   Use REACTIVE for:');
      console.log('   - Bursts of requests with pauses between');
      console.log('   - When you want max speed until hitting limits');
      console.log('   - When occasional wait is acceptable');
    } else {
      console.log('   Use NONE for:');
      console.log('   - Very low request volumes (<5 RPM)');
      console.log('   - Testing/development only');
      console.log('   ⚠️  Not recommended for production');
    }
  }

  console.log('\n' + '='.repeat(80));
}

compareStrategies().catch((error) => {
  console.error('❌ Comparison failed:', error);
  process.exit(1);
});
