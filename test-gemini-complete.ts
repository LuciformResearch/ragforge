/**
 * Test complet Gemini API (Embeddings + LLM)
 *
 * Utilise l'approche de LR_Lucicode:
 * - Embeddings: Google Auth (credentials)
 * - LLM: Gemini API Key
 */

import { loadEnv } from './utils/env-loader.js';
import { GoogleAuth } from 'google-auth-library';

loadEnv(import.meta.url);

const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever'
];

async function testEmbeddings() {
  console.log('🔢 Test 1: Embeddings (Google Auth)\n');

  try {
    const auth = new GoogleAuth({ scopes: SCOPES });
    const client = await auth.getClient();

    const modelName = 'text-embedding-004';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:embedContent`;

    console.log(`📡 Calling ${modelName} with Google Auth...`);

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
      console.log(`✅ Embedding generated`);
      console.log(`   Dimension: ${embedding.length}`);
      console.log(`   First 5: [${embedding.slice(0, 5).map((v: number) => v.toFixed(4)).join(', ')}...]`);
      console.log();
      return true;
    } else {
      console.error('❌ No embedding in response');
      return false;
    }
  } catch (error: any) {
    console.error('❌ Embeddings failed:', error.message);
    return false;
  }
}

async function testLLM() {
  console.log('🤖 Test 2: LLM (Gemini API Key)\n');

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment');
    return false;
  }

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    console.log(`📡 Calling ${model} with API key...`);

    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    };

    const payload = {
      contents: [{
        parts: [{
          text: 'Generate a TypeScript interface for a User entity with id, name, and email fields. Return ONLY the code, no explanation.'
        }]
      }],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.3
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) {
        console.log(`✅ LLM response received (${text.length} chars)`);
        console.log('\n--- Generated Code ---');
        console.log(text);
        console.log('--- End ---\n');
        return true;
      } else {
        console.error('❌ No text in response');
        console.log('Response:', JSON.stringify(data, null, 2));
        return false;
      }
    } else {
      const errorText = await response.text();
      console.error(`❌ HTTP ${response.status}:`, errorText);
      return false;
    }
  } catch (error: any) {
    console.error('❌ LLM failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Gemini API Complete Test\n');
  console.log('='.repeat(60));
  console.log();

  const embeddingsOk = await testEmbeddings();
  const llmOk = await testLLM();

  console.log('📊 Summary');
  console.log('─'.repeat(60));
  console.log(`Embeddings (Google Auth):  ${embeddingsOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`LLM (Gemini API Key):      ${llmOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log();

  if (embeddingsOk && llmOk) {
    console.log('🎉 All tests passed!');
    console.log('\nYou can now use:');
    console.log('  - Embeddings for semantic search');
    console.log('  - Gemini LLM for code generation');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
