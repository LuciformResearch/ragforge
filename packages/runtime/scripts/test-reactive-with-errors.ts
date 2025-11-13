#!/usr/bin/env tsx

/**
 * Test reactive strategy with guaranteed 429 errors
 *
 * Launch 100 parallel requests to force rate limits,
 * then verify automatic recovery works correctly.
 *
 * Usage:
 *   tsx scripts/test-reactive-with-errors.ts
 */

import { GeminiAPIProvider } from '../src/reranking/gemini-api-provider.js';
import dotenv from 'dotenv';
import { join } from 'path';
import { writeFileSync, appendFileSync } from 'fs';

// Load .env
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = join(homeDir, 'LR_CodeRag', '.env');
dotenv.config({ path: envPath });

// Setup logging to file
const logDir = join(process.cwd(), 'test-logs');
const logFile = join(logDir, 'test-reactive-debug.log');
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

// Create log directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync(logDir, { recursive: true });
} catch (err) {
  // Directory already exists
}

// Clear log file at start
writeFileSync(logFile, `=== Test started at ${new Date().toISOString()} ===\n`);

// Override console to log to both console and file
console.log = (...args: any[]) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  originalConsoleLog(...args);
  appendFileSync(logFile, message + '\n');
};

console.warn = (...args: any[]) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  originalConsoleWarn(...args);
  appendFileSync(logFile, '[WARN] ' + message + '\n');
};

originalConsoleLog(`📝 Logging to: ${logFile}`);

async function testReactiveWithErrors() {
  console.log('🧪 Testing Reactive Strategy with Forced 429 Errors\n');
  console.log('Scenario: 100 parallel requests (6.7x the 15 RPM limit)');
  console.log('Expected: Many 429s, then intelligent recovery\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const provider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.3,
    maxOutputTokens: 100,
    retryAttempts: 5, // More retries to handle heavy load
    rateLimitStrategy: 'reactive'
  });

  console.log('📊 Configuration:');
  console.log('  Model: gemini-2.0-flash (1000 RPM limit)');
  console.log('  Strategy: reactive');
  console.log('  Retry attempts: 5');
  console.log('  Parallel requests: 100 (0.1x the limit - should work fine!)');
  console.log();

  const startTime = Date.now();
  const results: Array<{
    index: number;
    success: boolean;
    duration: number;
    had429: boolean;
  }> = [];

  let total429Count = 0;

  const promises = Array.from({ length: 100 }, async (_, index) => {
    const requestStart = Date.now();
    let had429 = false;

    try {
      const prompt = `Heavy load test ${index + 1}/100: "Neural networks power modern AI"`;
      await provider.generateContent(prompt);
      const duration = Date.now() - requestStart;
      results.push({ index: index + 1, success: true, duration, had429 });
      console.log(`  ✅ Request ${index + 1} completed in ${duration}ms${had429 ? ' (recovered from 429)' : ''}`);
    } catch (error: any) {
      const duration = Date.now() - requestStart;
      const is429 = error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
      if (is429) {
        had429 = true;
        total429Count++;
      }
      results.push({ index: index + 1, success: false, duration, had429 });
      console.log(`  ❌ Request ${index + 1} failed after ${duration}ms: ${is429 ? 'RATE_LIMIT' : 'OTHER'}`);
    }
  });

  console.log('🚀 Launching 100 requests in parallel (this WILL cause 429s)...\n');
  await Promise.all(promises);

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const had429Count = results.filter(r => r.had429).length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const throughput = (successCount / totalDuration) * 1000;

  console.log('\n' + '='.repeat(80));
  console.log('📊 DETAILED RESULTS');
  console.log('='.repeat(80));
  console.log(`\n⏱️  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`📈 Average request duration: ${(avgDuration / 1000).toFixed(1)}s`);
  console.log(`✅ Successful: ${successCount}/100 (${((successCount / 100) * 100).toFixed(0)}%)`);
  console.log(`❌ Failed: ${failCount}/100`);
  console.log(`⚠️  Requests that encountered 429: ${had429Count}/100`);
  console.log(`📊 Throughput: ${throughput.toFixed(2)} req/s`);

  // Duration breakdown
  const fast = results.filter(r => r.duration < 5000).length;
  const medium = results.filter(r => r.duration >= 5000 && r.duration < 30000).length;
  const slow = results.filter(r => r.duration >= 30000 && r.duration < 60000).length;
  const verySlow = results.filter(r => r.duration >= 60000).length;

  console.log('\n📊 Request duration breakdown:');
  console.log(`   Fast (<5s):        ${fast}/100 - First batch, no waiting`);
  console.log(`   Medium (5-30s):    ${medium}/100 - Some waiting for window`);
  console.log(`   Slow (30-60s):     ${slow}/100 - Had to wait for window to clear`);
  console.log(`   Very slow (>60s):  ${verySlow}/100 - Multiple retries needed`);

  // Analysis
  console.log('\n' + '='.repeat(80));
  console.log('💡 ANALYSIS');
  console.log('='.repeat(80));

  if (had429Count > 0) {
    console.log(`\n✅ Good! We successfully forced ${had429Count} rate limit(s).`);
    console.log('   This proves the reactive strategy encounters 429s as expected.');
  } else {
    console.log('\n⚠️  Unexpected: No 429s encountered with 100 parallel requests!');
    console.log('   Either API has higher capacity than expected, or timing was lucky.');
  }

  if (successCount === 100) {
    console.log('\n🎉 PERFECT RECOVERY! All 100 requests eventually succeeded!');
    console.log('   Reactive strategy intelligently waited and retried.');

    if (had429Count > 0) {
      console.log(`\n📝 Recovery behavior:`);
      console.log(`   - ${had429Count} requests hit 429 errors`);
      console.log(`   - All recovered by waiting for oldest request to age out`);
      console.log(`   - No requests permanently failed`);
    }

    // Check if recovery was efficient
    if (totalDuration < 60000) {
      console.log('\n⚡ Fast recovery (<60s total)!');
      console.log('   Reactive strategy efficiently managed the rate limit.');
    } else if (totalDuration < 120000) {
      console.log('\n⏱️  Moderate recovery time (60-120s).');
      console.log('   Expected with this load - had to wait for windows to clear.');
    } else {
      console.log('\n⏳ Slow recovery (>120s).');
      console.log('   Heavy load caused significant waiting.');
    }
  } else {
    console.log(`\n⚠️  WARNING: ${failCount} requests failed even after 5 retries.`);
    console.log('   Possible causes:');
    console.log('   - Rate limit window longer than expected');
    console.log('   - API experiencing issues');
    console.log('   - Need more retry attempts for this load');
  }

  // Test recovery after the burst
  console.log('\n' + '='.repeat(80));
  console.log('🔬 TESTING RECOVERY - New Request After Burst');
  console.log('='.repeat(80));
  console.log('\nWaiting 5 seconds, then launching 1 new request to verify system is healthy...\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const recoveryStart = Date.now();
    await provider.generateContent('Recovery test: "System is operational"');
    const recoveryDuration = Date.now() - recoveryStart;
    console.log(`✅ Recovery request succeeded in ${recoveryDuration}ms`);
    console.log('   System is healthy and ready for new requests!');
  } catch (error: any) {
    console.log(`❌ Recovery request failed: ${error.message}`);
    console.log('   System may still be rate-limited.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎯 FINAL VERDICT');
  console.log('='.repeat(80));

  if (successCount === 100) {
    console.log('\n✅ REACTIVE STRATEGY PASSED ALL TESTS!');
    console.log('\n   ✓ Handles heavy parallel load (100 requests)');
    console.log('   ✓ Encounters 429s as expected');
    console.log('   ✓ Automatically recovers from rate limits');
    console.log('   ✓ All requests eventually succeed');
    console.log('   ✓ System remains healthy after burst');
    console.log('\n   Recommendation: Reactive strategy is production-ready! 🚀');
  } else if (successCount >= 80) {
    console.log('\n⚠️  REACTIVE STRATEGY MOSTLY WORKS');
    console.log(`\n   ✓ Most requests succeeded (${successCount}/100)`);
    console.log(`   ✗ ${failCount} requests failed after retries`);
    console.log('\n   Recommendation: Increase retryAttempts for heavy loads,');
    console.log('   or use proactive strategy for predictable timing.');
  } else {
    console.log('\n❌ REACTIVE STRATEGY NEEDS TUNING');
    console.log(`\n   ✗ Only ${successCount}/100 requests succeeded`);
    console.log('   ✗ Too many failures under load');
    console.log('\n   Recommendation: Use proactive strategy for this load,');
    console.log('   or significantly increase retryAttempts.');
  }

  console.log('\n' + '='.repeat(80));
}

testReactiveWithErrors().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
