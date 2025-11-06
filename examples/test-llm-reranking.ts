/**
 * Test LLM Reranking with Gemma 3n E2B
 *
 * Demonstrates how to use LLM reranking to improve search result quality
 * by having an LLM evaluate relevance after vector search.
 *
 * Prerequisites:
 * - GEMINI_API_KEY environment variable set
 *
 * Uses Gemini API (@google/genai) instead of Vertex AI because:
 * - Simpler (just API key, no GCP setup)
 * - All models available globally (no regional restrictions)
 * - Free tier available (60 req/min)
 * - Works everywhere with Gemma 3n E2B
 */

import { createRagClient } from './generated-dual-client/index.js';
import { GeminiAPIProvider } from '@ragforge/runtime';
import { loadEnv, verifyEnv } from '../utils/env-loader.js';

// Load environment variables
loadEnv(import.meta.url);

async function main() {
  console.log('🧪 Testing LLM Reranking with Gemma 3n E2B\n');

  // Verify required environment variables
  try {
    verifyEnv(['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'GEMINI_API_KEY']);
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }

  // Initialize RAG client
  const rag = createRagClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || '',
      database: 'neo4j'
    }
  });

  // Create Gemini API provider with Gemma 3n E2B (ultra-cheap, $0.005/1M tokens)
  const llmProvider = GeminiAPIProvider.fromEnv('gemma-3n-e2b-it');

  console.log('✅ Initialized with Gemma 3n E2B model (via Gemini API)');
  console.log('💰 Cost: ~$0.005 per 1M input tokens');
  console.log('📡 Using simple API key (no GCP setup needed)\n');

  // Test questions
  const questions = [
    {
      query: 'How is the Neo4j connection managed?',
      semantic: 'neo4j connection client'
    },
    {
      query: 'Where are environment variables loaded?',
      semantic: 'environment variables config dotenv'
    },
    {
      query: 'How does vector search work?',
      semantic: 'vector search embeddings similarity'
    }
  ];

  for (const { query, semantic } of questions) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Question: ${query}`);
    console.log(`${'='.repeat(80)}\n`);

    // Compare results with and without LLM reranking
    await compareResults(rag, query, semantic, llmProvider);
  }

  await rag.close();
}

async function compareResults(
  rag: any,
  userQuestion: string,
  semanticQuery: string,
  llmProvider: any
) {
  console.log('🔍 Performing searches...\n');

  // 1. Without LLM reranking (pure vector search)
  console.log('1️⃣  Vector Search Only:');
  const vectorOnlyResults = await rag.scope()
    .semanticSearchBySource(semanticQuery, { topK: 30 })
    .limit(5)
    .execute();

  console.log(`   Found ${vectorOnlyResults.length} results\n`);
  vectorOnlyResults.forEach((result: any, idx: number) => {
    const entity = result.entity;
    console.log(`   ${idx + 1}. ${entity.name} (${entity.type})`);
    console.log(`      File: ${entity.file}`);
    console.log(`      Score: ${result.score.toFixed(3)} (vector only)`);
    if (entity.signature) {
      console.log(`      Signature: ${entity.signature.substring(0, 60)}...`);
    }
    console.log();
  });

  // 2. With LLM reranking
  console.log('\n2️⃣  Vector Search + LLM Reranking (Gemma 3n E2B via Gemini API):');
  const rerankedResults = await rag.scope()
    .semanticSearchBySource(semanticQuery, { topK: 30 })
    .llmRerank(userQuestion, llmProvider, {
      batchSize: 10,
      parallel: 3,
      minScore: 0.3,
      scoreMerging: 'weighted',
      weights: { vector: 0.3, llm: 0.7 },
      withSuggestions: true
    })
    .limit(5)
    .execute();

  console.log(`   Found ${rerankedResults.length} results\n`);
  rerankedResults.forEach((result: any, idx: number) => {
    const entity = result.entity;
    const breakdown = result.scoreBreakdown || {};

    console.log(`   ${idx + 1}. ${entity.name} (${entity.type})`);
    console.log(`      File: ${entity.file}`);
    console.log(`      Final Score: ${result.score.toFixed(3)}`);
    console.log(`      Breakdown:`);
    console.log(`        - Vector: ${(breakdown.vector || 0).toFixed(3)}`);
    console.log(`        - LLM: ${(breakdown.llm || 0).toFixed(3)}`);
    if (breakdown.llmReasoning) {
      console.log(`        - Reasoning: ${breakdown.llmReasoning}`);
    }
    if (entity.signature) {
      console.log(`      Signature: ${entity.signature.substring(0, 60)}...`);
    }
    console.log();
  });

  // 3. Analysis
  console.log('\n📊 Comparison:');

  const vectorOnlyTop = vectorOnlyResults.slice(0, 3).map((r: any) => r.entity.name);
  const rerankedTop = rerankedResults.slice(0, 3).map((r: any) => r.entity.name);

  console.log(`   Vector-only top 3: ${vectorOnlyTop.join(', ')}`);
  console.log(`   Reranked top 3:    ${rerankedTop.join(', ')}`);

  const changed = vectorOnlyTop.filter((name: string, idx: number) => name !== rerankedTop[idx]).length;
  console.log(`   Changed: ${changed}/3 results reordered by LLM\n`);

  // Cost estimation
  const avgTokensPerScope = 150; // Approximate
  const totalScopes = 30;
  const inputTokens = totalScopes * avgTokensPerScope;
  const costPerMillion = 0.005;
  const estimatedCost = (inputTokens / 1_000_000) * costPerMillion;

  console.log(`💰 Cost Estimation:`);
  console.log(`   Input tokens: ~${inputTokens.toLocaleString()}`);
  console.log(`   Cost: ~$${estimatedCost.toFixed(6)} (${(estimatedCost * 1000).toFixed(3)}¢)`);
  console.log(`   For 1000 queries: ~$${(estimatedCost * 1000).toFixed(2)}`);
}

main().catch(console.error);
