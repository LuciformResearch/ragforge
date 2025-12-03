/**
 * Test RagAgent - Generic Agent from Config
 *
 * Demonstrates:
 * - Native vs Structured tool calling modes
 * - batch_analyze meta-tool for LLM analysis on items
 * - Custom output schema for structured responses
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createRagAgent } from '@luciformresearch/ragforge-runtime';
import { createRagClient } from './client.js';

// Load environment
config({ path: resolve(process.cwd(), '.env') });

async function testStructuredMode() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Structured Mode (XML-based, per-item)');
  console.log('='.repeat(60));

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: './ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
  });

  console.log(`\n✅ Agent created with ${agent.getTools().length} tools`);

  try {
    const result = await agent.ask('What is the purpose of StructuredLLMExecutor?');

    console.log('\n📤 Result:');
    console.log(`   Answer: ${result.answer?.substring(0, 200)}...`);
    console.log(`   Confidence: ${result.confidence || 'N/A'}`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);
    console.log('\n✅ Structured mode test passed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  await rag.close();
}

async function testNativeMode() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Native Mode (Gemini native tool calling)');
  console.log('='.repeat(60));

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: './ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'native',
    verbose: true,
  });

  console.log(`\n✅ Agent created with ${agent.getTools().length} tools`);

  try {
    const result = await agent.ask('Find functions related to embedding generation');

    console.log('\n📤 Result:');
    console.log(`   Answer: ${result.answer?.substring(0, 200)}...`);
    console.log(`   Confidence: ${result.confidence || 'N/A'}`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);
    console.log('\n✅ Native mode test passed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  await rag.close();
}

async function testCustomOutputSchema() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Custom Output Schema');
  console.log('='.repeat(60));

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: './ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
    // Custom output schema
    outputSchema: {
      answer: {
        type: 'string',
        description: 'Your answer',
        required: true,
      },
      key_concepts: {
        type: 'array',
        description: 'List of key concepts found',
        required: true,
        items: { type: 'string' },
      },
      related_files: {
        type: 'array',
        description: 'List of related file paths',
        required: false,
        items: { type: 'string' },
      },
    },
  });

  console.log(`\n✅ Agent created with custom output schema`);

  try {
    const result = await agent.ask('What is the RagClient and how does it work?');

    console.log('\n📤 Result:');
    console.log(`   Answer: ${result.answer?.substring(0, 150)}...`);
    console.log(`   Key concepts: ${JSON.stringify(result.key_concepts)}`);
    console.log(`   Related files: ${JSON.stringify(result.related_files)}`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);
    console.log('\n✅ Custom schema test passed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  await rag.close();
}

async function testBatchAnalyze() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: batch_analyze Meta-Tool');
  console.log('='.repeat(60));

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: './ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    includeBatchAnalyze: true,
    verbose: true,
  });

  console.log(`\n✅ Agent created with batch_analyze tool`);
  console.log(`   Tools: ${agent.getTools().map(t => t.name).join(', ')}`);

  try {
    // Ask a question that should trigger batch_analyze
    const result = await agent.ask(
      'Search for functions related to "query" and analyze each one to extract its main purpose and complexity level (simple, medium, complex)'
    );

    console.log('\n📤 Result:');
    console.log(`   Answer: ${result.answer?.substring(0, 300)}...`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);
    console.log('\n✅ batch_analyze test passed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }

  await rag.close();
}

async function main() {
  console.log('🧪 RagAgent Advanced Tests\n');

  // Run tests
  await testStructuredMode();
  await testNativeMode();
  await testCustomOutputSchema();
  await testBatchAnalyze();

  console.log('\n' + '='.repeat(60));
  console.log('🎉 All tests completed!');
  console.log('='.repeat(60));
}

main().catch(console.error);
