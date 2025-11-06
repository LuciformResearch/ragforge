/**
 * Test Vertex AI Setup
 *
 * Validates that Vertex AI (LLM and Embeddings) is properly configured
 * and accessible from RagForge package
 */

import { loadEnv, verifyEnv } from './utils/env-loader.js';
import { existsSync } from 'fs';

// Load environment variables from LR_CodeRag root
console.log('📋 Loading environment variables...\n');
loadEnv(import.meta.url);

// Verify required environment variables
console.log('✅ Environment Variables Check:');
console.log('─'.repeat(60));

const requiredVars = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'PROJECT_ID',
  'GOOGLE_CLOUD_PROJECT',
  'VERTEX_LOCATION'
];

let hasErrors = false;

for (const varName of requiredVars) {
  const value = process.env[varName];
  if (!value) {
    console.log(`❌ ${varName}: NOT SET`);
    hasErrors = true;
  } else {
    console.log(`✅ ${varName}: ${value}`);

    // Special check for credentials file
    if (varName === 'GOOGLE_APPLICATION_CREDENTIALS') {
      if (existsSync(value)) {
        console.log(`   ✅ Credentials file exists`);
      } else {
        console.log(`   ❌ Credentials file NOT FOUND at: ${value}`);
        hasErrors = true;
      }
    }
  }
}
console.log();

if (hasErrors) {
  console.error('❌ Environment setup incomplete. Please check your .env.local file.');
  process.exit(1);
}

// Test 1: Vertex AI LLM
console.log('🤖 Test 1: Vertex AI LLM (Gemini)');
console.log('─'.repeat(60));

async function testVertexLLM() {
  try {
    const { VertexAI } = await import('@google-cloud/vertexai');

    const vertexAI = new VertexAI({
      project: process.env.PROJECT_ID!,
      location: process.env.VERTEX_LOCATION!
    });

    const model = vertexAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
    });

    console.log('📡 Sending test prompt to Gemini...');

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: 'Say "Hello from Vertex AI!" and nothing else.' }]
      }]
    });

    const response = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`✅ Response received: "${response.trim()}"`);
    console.log();

    return true;
  } catch (error: any) {
    console.error('❌ Vertex AI LLM test failed:');
    console.error(`   Error: ${error.message}`);
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    console.log();
    return false;
  }
}

// Test 2: Vertex AI Embeddings
console.log('🔢 Test 2: Vertex AI Embeddings');
console.log('─'.repeat(60));

async function testVertexEmbeddings() {
  try {
    const { VertexAI } = await import('@google-cloud/vertexai');

    const vertexAI = new VertexAI({
      project: process.env.PROJECT_ID!,
      location: process.env.VERTEX_LOCATION!
    });

    // Use text-embedding model
    const modelName = 'text-embedding-004';

    console.log(`📡 Generating embeddings with ${modelName}...`);

    // Use the predict method for embeddings
    const model = vertexAI.preview.getGenerativeModel({
      model: modelName,
    });

    const request = {
      contents: [{
        role: 'user',
        parts: [{ text: 'This is a test sentence for embedding generation.' }]
      }]
    };

    const result = await model.generateContent(request);

    // For embedding models, the response structure is different
    // Let's try a simpler approach using the text-embedding API directly

    // Actually, let's use the aiplatform library correctly
    const aiplatform = await import('@google-cloud/aiplatform');
    const { PredictionServiceClient } = aiplatform.v1;

    const client = new PredictionServiceClient({
      apiEndpoint: `${process.env.VERTEX_LOCATION}-aiplatform.googleapis.com`
    });

    const endpoint = `projects/${process.env.PROJECT_ID}/locations/${process.env.VERTEX_LOCATION}/publishers/google/models/${modelName}`;

    const instance = {
      content: 'This is a test sentence for embedding generation.',
      task_type: 'RETRIEVAL_DOCUMENT'
    };

    const instances = [instance];
    const parameters = {};

    const [response] = await client.predict({
      endpoint,
      instances: instances as any,
      parameters: parameters as any,
    });

    const predictions = response.predictions;

    if (predictions && predictions.length > 0) {
      const pred = predictions[0] as any;
      const embedding = pred.embeddings?.values || pred.values || [];

      console.log(`✅ Embedding generated successfully`);
      console.log(`   Dimension: ${embedding.length}`);
      console.log(`   First 5 values: [${embedding.slice(0, 5).map((v: number) => v.toFixed(4)).join(', ')}...]`);
      console.log();
      return true;
    } else {
      console.error('❌ No predictions returned');
      console.log();
      return false;
    }
  } catch (error: any) {
    console.error('❌ Vertex AI Embeddings test failed:');
    console.error(`   Error: ${error.message}`);
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    if (error.details) {
      console.error(`   Details: ${error.details}`);
    }
    console.log();
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Vertex AI Setup Validation');
  console.log('='.repeat(60));
  console.log();

  const llmOk = await testVertexLLM();
  const embeddingsOk = await testVertexEmbeddings();

  console.log('📊 Test Summary');
  console.log('─'.repeat(60));
  console.log(`LLM Test: ${llmOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Embeddings Test: ${embeddingsOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log();

  if (llmOk && embeddingsOk) {
    console.log('🎉 All tests passed! Vertex AI is properly configured.');
    console.log('You can now use Vertex AI for:');
    console.log('  - Code generation (Gemini models)');
    console.log('  - Text embeddings (text-embedding-004)');
    console.log('  - Semantic search and RAG operations');
    process.exit(0);
  } else {
    console.error('❌ Some tests failed. Please check the errors above.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
