/**
 * Simple Vertex AI test using the existing LR_CodeRag implementation
 */

import { loadEnv } from './utils/env-loader.js';
import { GoogleAuth } from 'google-auth-library';

loadEnv(import.meta.url);

const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever'
];

async function testEmbeddings() {
  console.log('🔢 Test: Embeddings via Gemini API\n');

  try {
    const auth = new GoogleAuth({ scopes: SCOPES });
    const client = await auth.getClient();

    const modelName = 'text-embedding-004';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:embedContent`;

    console.log(`📡 Calling ${modelName}...`);

    const response = await (client as any).request({
      url,
      method: 'POST',
      data: {
        content: {
          role: 'user',
          parts: [{ text: 'Hello from RagForge!' }]
        }
      }
    });

    const embedding = response?.data?.embedding?.values;

    if (Array.isArray(embedding)) {
      console.log(`✅ Embedding generated successfully`);
      console.log(`   Dimension: ${embedding.length}`);
      console.log(`   First 5 values: [${embedding.slice(0, 5).map((v: number) => v.toFixed(4)).join(', ')}...]`);
      console.log();
      return true;
    } else {
      console.error('❌ No embedding in response');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (error: any) {
    console.error('❌ Embeddings test failed:');
    console.error(`   ${error.message}`);
    if (error.response?.data) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

async function testLLM() {
  console.log('🤖 Test: LLM via Gemini API\n');

  try {
    const auth = new GoogleAuth({ scopes: SCOPES });
    const client = await auth.getClient();

    const modelName = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

    console.log(`📡 Calling ${modelName}...`);

    const response = await (client as any).request({
      url,
      method: 'POST',
      data: {
        contents: [{
          role: 'user',
          parts: [{ text: 'Say "Hello from RagForge!" and nothing else.' }]
        }]
      }
    });

    const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (text) {
      console.log(`✅ Response: "${text.trim()}"`);
      console.log();
      return true;
    } else {
      console.error('❌ No text in response');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (error: any) {
    console.error('❌ LLM test failed:');
    console.error(`   ${error.message}`);
    if (error.response?.data) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

async function main() {
  console.log('🚀 Vertex AI Simple Test (Gemini API)\n');

  const embeddingsOk = await testEmbeddings();
  const llmOk = await testLLM();

  console.log('📊 Summary');
  console.log('─'.repeat(60));
  console.log(`Embeddings: ${embeddingsOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`LLM: ${llmOk ? '✅ PASSED' : '❌ FAILED'}`);

  if (embeddingsOk && llmOk) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
