#!/usr/bin/env tsx

/**
 * Diagnostic Script: Gemini API Parallel Capacity Test with Gemma 3n E2B IT
 *
 * Tests two scenarios:
 * 1. Shared provider instance (optimal - allows Google to potentially batch/optimize)
 * 2. New provider per request (current test behavior - may prevent optimization)
 *
 * Usage:
 *   tsx scripts/test-parallel-capacity.ts
 *
 * Environment:
 *   GEMINI_API_KEY - Required for Gemini API access
 */

import { GeminiAPIProvider } from '../src/reranking/gemini-api-provider.js';
import dotenv from 'dotenv';
import { join } from 'path';

// Load .env from ~/LR_CodeRag/.env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

interface TestResult {
  scenario: string;
  parallelCount: number;
  totalDuration: number;
  avgDuration: number;
  successCount: number;
  errorCount: number;
  rateLimitErrors: number;
  throughput: number; // requests per second
}

/**
 * Test Scenario 1: Shared provider instance
 * This allows Google to potentially optimize/batch requests internally
 */
async function testSharedProvider(parallelCount: number): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Scenario 1: SHARED PROVIDER - ${parallelCount} parallel requests`);
  console.log('='.repeat(80));

  // Create ONE provider instance for all requests
  const provider = createProvider();

  const startTime = Date.now();
  const results: Array<{ success: boolean; duration: number; isRateLimit: boolean }> = [];

  const promises = Array.from({ length: parallelCount }, async (_, index) => {
    const requestStart = Date.now();
    try {
      const prompt = `Analyze sentiment (request ${index + 1}/${parallelCount}): "Cloud computing transforms business operations"`;
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
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const throughput = (successCount / totalDuration) * 1000;

  console.log(`\n📊 Results:`);
  console.log(`  Total duration: ${totalDuration}ms`);
  console.log(`  Average request duration: ${avgDuration.toFixed(0)}ms`);
  console.log(`  Successful: ${successCount}/${parallelCount}`);
  console.log(`  Failed: ${errorCount}/${parallelCount}`);
  console.log(`  Rate limit errors: ${rateLimitErrors}/${parallelCount}`);
  console.log(`  Throughput: ${throughput.toFixed(2)} req/s`);

  return {
    scenario: 'Shared Provider',
    parallelCount,
    totalDuration,
    avgDuration,
    successCount,
    errorCount,
    rateLimitErrors,
    throughput,
  };
}

/**
 * Test Scenario 2: New provider per request
 * This simulates current test behavior where each test creates its own provider
 */
async function testProviderPerRequest(parallelCount: number): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Scenario 2: PROVIDER PER REQUEST - ${parallelCount} parallel requests`);
  console.log('='.repeat(80));

  const startTime = Date.now();
  const results: Array<{ success: boolean; duration: number; isRateLimit: boolean }> = [];

  const promises = Array.from({ length: parallelCount }, async (_, index) => {
    const requestStart = Date.now();
    try {
      // Create NEW provider for each request (like beforeEach in tests)
      const provider = createProvider();
      const prompt = `Analyze sentiment (request ${index + 1}/${parallelCount}): "Cloud computing transforms business operations"`;
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
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const throughput = (successCount / totalDuration) * 1000;

  console.log(`\n📊 Results:`);
  console.log(`  Total duration: ${totalDuration}ms`);
  console.log(`  Average request duration: ${avgDuration.toFixed(0)}ms`);
  console.log(`  Successful: ${successCount}/${parallelCount}`);
  console.log(`  Failed: ${errorCount}/${parallelCount}`);
  console.log(`  Rate limit errors: ${rateLimitErrors}/${parallelCount}`);
  console.log(`  Throughput: ${throughput.toFixed(2)} req/s`);

  return {
    scenario: 'Provider Per Request',
    parallelCount,
    totalDuration,
    avgDuration,
    successCount,
    errorCount,
    rateLimitErrors,
    throughput,
  };
}

/**
 * Create provider configured WITHOUT proactive throttling
 * This allows us to test raw API behavior
 */
function createProvider(): GeminiAPIProvider {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const provider = new GeminiAPIProvider({
    apiKey,
    model: 'gemma-3n-e2b-it', // Use Gemma as per user's experience
    temperature: 0.3,
    maxOutputTokens: 100, // Keep responses small for faster testing
    retryAttempts: 0, // No retry - we want to see raw rate limits
    retryDelay: 1000,
  });

  // Disable proactive throttling to test raw API capacity
  (provider as any).minRequestInterval = 0;

  return provider;
}

/**
 * Run comprehensive diagnostics comparing both scenarios
 */
async function runDiagnostics() {
  console.log('🔬 Gemini API Parallel Capacity Diagnostic (Gemma 3n E2B IT)\n');
  console.log('Hypothesis: Shared provider instances may enable Google API optimizations');
  console.log('Testing WITHOUT proactive throttling to measure raw API capacity\n');

  // Test different parallel counts
  const testCounts = [1, 5, 10, 15, 20];
  const allResults: TestResult[] = [];

  for (const count of testCounts) {
    // Test Scenario 1: Shared provider
    const sharedResult = await testSharedProvider(count);
    allResults.push(sharedResult);

    // Wait between scenarios
    console.log('\n⏳ Waiting 5 seconds before next scenario...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test Scenario 2: Provider per request
    const perRequestResult = await testProviderPerRequest(count);
    allResults.push(perRequestResult);

    // Wait between test counts
    console.log('\n⏳ Waiting 10 seconds before next parallel count...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  // Print comparative summary
  console.log('\n' + '='.repeat(100));
  console.log('📈 COMPARATIVE SUMMARY');
  console.log('='.repeat(100));
  console.log('\nScenario              | Parallel | Success | Errors | Rate Limits | Avg Duration | Throughput');
  console.log('-'.repeat(100));

  for (const result of allResults) {
    console.log(
      `${result.scenario.padEnd(20)} | ` +
      `${result.parallelCount.toString().padStart(8)} | ` +
      `${result.successCount.toString().padStart(7)} | ` +
      `${result.errorCount.toString().padStart(6)} | ` +
      `${result.rateLimitErrors.toString().padStart(11)} | ` +
      `${result.avgDuration.toFixed(0).padStart(12)}ms | ` +
      `${result.throughput.toFixed(2).padStart(10)} req/s`
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(100));
  console.log('💡 ANALYSIS');
  console.log('='.repeat(100));

  // Compare shared vs per-request at each parallel count
  for (const count of testCounts) {
    const shared = allResults.find(r => r.scenario === 'Shared Provider' && r.parallelCount === count);
    const perRequest = allResults.find(r => r.scenario === 'Provider Per Request' && r.parallelCount === count);

    if (shared && perRequest) {
      console.log(`\n📊 Parallel count: ${count}`);

      // Success rate comparison
      const sharedSuccessRate = (shared.successCount / shared.parallelCount) * 100;
      const perRequestSuccessRate = (perRequest.successCount / perRequest.parallelCount) * 100;
      console.log(`  Success rate: Shared=${sharedSuccessRate.toFixed(0)}% vs PerRequest=${perRequestSuccessRate.toFixed(0)}%`);

      // Throughput comparison
      const throughputDiff = ((shared.throughput - perRequest.throughput) / perRequest.throughput) * 100;
      console.log(`  Throughput: Shared=${shared.throughput.toFixed(2)} vs PerRequest=${perRequest.throughput.toFixed(2)} (${throughputDiff > 0 ? '+' : ''}${throughputDiff.toFixed(1)}%)`);

      // Rate limit comparison
      console.log(`  Rate limits: Shared=${shared.rateLimitErrors} vs PerRequest=${perRequest.rateLimitErrors}`);
    }
  }

  // Recommendations
  console.log('\n' + '='.repeat(100));
  console.log('🎯 RECOMMENDATIONS');
  console.log('='.repeat(100));

  const sharedResults = allResults.filter(r => r.scenario === 'Shared Provider');
  const fullySuccessfulShared = sharedResults.filter(r => r.successCount === r.parallelCount);

  if (fullySuccessfulShared.length > 0) {
    const optimal = fullySuccessfulShared[fullySuccessfulShared.length - 1];
    console.log(`\n✅ Optimal parallel count with shared provider: ${optimal.parallelCount}`);
    console.log(`   - Throughput: ${optimal.throughput.toFixed(2)} req/s`);
    console.log(`   - All requests succeeded without rate limits`);
  }

  // Check if shared provider performs better
  const avgThroughputShared = sharedResults.reduce((sum, r) => sum + r.throughput, 0) / sharedResults.length;
  const perRequestResults = allResults.filter(r => r.scenario === 'Provider Per Request');
  const avgThroughputPerRequest = perRequestResults.reduce((sum, r) => sum + r.throughput, 0) / perRequestResults.length;

  console.log(`\n📊 Average throughput comparison:`);
  console.log(`   - Shared provider: ${avgThroughputShared.toFixed(2)} req/s`);
  console.log(`   - Provider per request: ${avgThroughputPerRequest.toFixed(2)} req/s`);

  if (avgThroughputShared > avgThroughputPerRequest * 1.1) {
    console.log(`\n✅ CONCLUSION: Shared provider is ${((avgThroughputShared / avgThroughputPerRequest - 1) * 100).toFixed(0)}% faster!`);
    console.log('   RECOMMENDATION: Modify tests to use a single shared GeminiAPIProvider instance');
  } else if (avgThroughputPerRequest > avgThroughputShared * 1.1) {
    console.log(`\n⚠️  CONCLUSION: Provider per request is ${((avgThroughputPerRequest / avgThroughputShared - 1) * 100).toFixed(0)}% faster`);
    console.log('   Current test architecture may be optimal');
  } else {
    console.log(`\n➡️  CONCLUSION: No significant difference between approaches`);
    console.log('   Provider architecture is not the bottleneck');
  }

  console.log('\n' + '='.repeat(100));
}

// Run diagnostics
runDiagnostics().catch((error) => {
  console.error('❌ Diagnostic failed:', error);
  process.exit(1);
});
