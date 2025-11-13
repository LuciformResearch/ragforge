#!/usr/bin/env tsx

/**
 * Compare parallel capacity between Gemma 3n E2B IT and Gemini 2.0 Flash Exp
 *
 * Tests 15 parallel requests (known sweet spot for Gemma) with both models
 * to confirm that model choice matters more than provider architecture.
 *
 * Usage:
 *   tsx scripts/compare-models-parallel.ts
 */

import { GeminiAPIProvider } from '../src/reranking/gemini-api-provider.js';
import dotenv from 'dotenv';
import { join } from 'path';

// Load .env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

interface ModelTestResult {
  model: string;
  parallelCount: number;
  totalDuration: number;
  successCount: number;
  errorCount: number;
  rateLimitErrors: number;
  throughput: number;
}

async function testModel(model: string, parallelCount: number = 15): Promise<ModelTestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing ${model} with ${parallelCount} parallel requests`);
  console.log('='.repeat(80));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  // Shared provider (optimal approach based on previous tests)
  const provider = new GeminiAPIProvider({
    apiKey,
    model,
    temperature: 0.3,
    maxOutputTokens: 100,
    retryAttempts: 0,
    retryDelay: 1000,
  });

  // Disable proactive throttling
  (provider as any).minRequestInterval = 0;

  const startTime = Date.now();
  const results: Array<{ success: boolean; duration: number; isRateLimit: boolean }> = [];

  const promises = Array.from({ length: parallelCount }, async (_, index) => {
    const requestStart = Date.now();
    try {
      const prompt = `Analyze sentiment (${index + 1}/${parallelCount}): "Cloud computing transforms business"`;
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
  console.log(`  Total duration: ${totalDuration}ms`);
  console.log(`  Successful: ${successCount}/${parallelCount}`);
  console.log(`  Failed: ${errorCount}/${parallelCount}`);
  console.log(`  Rate limit errors: ${rateLimitErrors}/${parallelCount}`);
  console.log(`  Throughput: ${throughput.toFixed(2)} req/s`);

  return {
    model,
    parallelCount,
    totalDuration,
    successCount,
    errorCount,
    rateLimitErrors,
    throughput,
  };
}

async function compareModels() {
  console.log('🔬 Model Comparison: Gemma vs Gemini 2.0 Flash Exp\n');
  console.log('Testing 15 parallel requests with each model (shared provider, no throttling)');

  const results: ModelTestResult[] = [];

  // Test Gemini 2.0 Flash Exp FIRST (to avoid rate limit contamination)
  const geminiResult = await testModel('gemini-2.0-flash-exp', 15);
  results.push(geminiResult);

  console.log('\n⏳ Waiting 10 seconds before testing next model...\n');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Test Gemma 3n E2B IT (we already know it handles 15 well)
  const gemmaResult = await testModel('gemma-3n-e2b-it', 15);
  results.push(gemmaResult);

  // Comparison summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log('\nModel                  | Success | Errors | Rate Limits | Duration | Throughput');
  console.log('-'.repeat(80));

  for (const result of results) {
    console.log(
      `${result.model.padEnd(22)} | ` +
      `${result.successCount.toString().padStart(7)} | ` +
      `${result.errorCount.toString().padStart(6)} | ` +
      `${result.rateLimitErrors.toString().padStart(11)} | ` +
      `${result.totalDuration.toString().padStart(8)}ms | ` +
      `${result.throughput.toFixed(2).padStart(10)} req/s`
    );
  }

  // Analysis
  console.log('\n' + '='.repeat(80));
  console.log('💡 ANALYSIS');
  console.log('='.repeat(80));

  const gemma = results.find(r => r.model === 'gemma-3n-e2b-it');
  const gemini = results.find(r => r.model === 'gemini-2.0-flash-exp');

  if (gemma && gemini) {
    console.log('\n📊 Success Rate:');
    console.log(`  Gemma 3n E2B IT:        ${((gemma.successCount / gemma.parallelCount) * 100).toFixed(0)}% (${gemma.successCount}/15)`);
    console.log(`  Gemini 2.0 Flash Exp:   ${((gemini.successCount / gemini.parallelCount) * 100).toFixed(0)}% (${gemini.successCount}/15)`);

    console.log('\n📊 Throughput:');
    console.log(`  Gemma 3n E2B IT:        ${gemma.throughput.toFixed(2)} req/s`);
    console.log(`  Gemini 2.0 Flash Exp:   ${gemini.throughput.toFixed(2)} req/s`);

    if (gemma.throughput > gemini.throughput) {
      const diff = ((gemma.throughput / gemini.throughput - 1) * 100).toFixed(0);
      console.log(`  Winner: Gemma (${diff}% faster)`);
    } else {
      const diff = ((gemini.throughput / gemma.throughput - 1) * 100).toFixed(0);
      console.log(`  Winner: Gemini (${diff}% faster)`);
    }

    console.log('\n📊 Rate Limits:');
    console.log(`  Gemma 3n E2B IT:        ${gemma.rateLimitErrors} errors`);
    console.log(`  Gemini 2.0 Flash Exp:   ${gemini.rateLimitErrors} errors`);

    // Recommendation
    console.log('\n' + '='.repeat(80));
    console.log('🎯 RECOMMENDATION FOR TESTS');
    console.log('='.repeat(80));

    if (gemma.rateLimitErrors === 0 && gemini.rateLimitErrors > 0) {
      console.log('\n✅ Switch tests to Gemma 3n E2B IT');
      console.log('   Reasons:');
      console.log('   - No rate limits at 15 parallel requests');
      console.log(`   - Success rate: ${((gemma.successCount / gemma.parallelCount) * 100).toFixed(0)}%`);
      console.log('   - Lower cost (smaller model)');
    } else if (gemma.rateLimitErrors > 0 && gemini.rateLimitErrors === 0) {
      console.log('\n✅ Keep Gemini 2.0 Flash Exp in tests');
      console.log('   Reasons:');
      console.log('   - No rate limits at 15 parallel requests');
      console.log(`   - Success rate: ${((gemini.successCount / gemini.parallelCount) * 100).toFixed(0)}%`);
    } else if (gemma.rateLimitErrors === 0 && gemini.rateLimitErrors === 0) {
      console.log('\n✅ Both models work well at 15 parallel');
      console.log('   Recommendation: Use Gemma 3n E2B IT');
      console.log('   Reasons:');
      console.log('   - Smaller model = lower cost');
      console.log('   - Similar or better performance');
      console.log(`   - Success rate: ${((gemma.successCount / gemma.parallelCount) * 100).toFixed(0)}%`);
    } else {
      console.log('\n⚠️  Both models hit rate limits at 15 parallel');
      console.log('   Recommendation: Reduce parallel count or implement throttling');
    }
  }

  console.log('\n' + '='.repeat(80));
}

compareModels().catch((error) => {
  console.error('❌ Comparison failed:', error);
  process.exit(1);
});
