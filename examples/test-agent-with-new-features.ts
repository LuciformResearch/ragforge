/**
 * Test Iterative Code Agent with New Features
 *
 * Test if the agent can use:
 * - rerankWithLLM()
 * - Pipeline operations (chaining)
 * - Advanced patterns
 */

import { IterativeCodeAgent, type LLMClient } from '../packages/runtime/src/agent/iterative-code-agent.js';
import { VertexAI } from '@google-cloud/vertexai';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

// ============================================================================
// Gemini LLM Client
// ============================================================================

class GeminiLLMClient implements LLMClient {
  private vertexAI: VertexAI;
  private model: any;

  constructor() {
    this.vertexAI = new VertexAI({
      project: process.env.VERTEX_PROJECT_ID!,
      location: 'us-central1'  // gemini-2.0-flash-exp only in us-central1
    });

    this.model = this.vertexAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
      }
    });
  }

  async generate(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    const response = result.response;
    return response.candidates[0].content.parts[0].text;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🧪 Testing Agent with New Features\n');
  console.log('The agent should now be able to use:');
  console.log('  - rerankWithLLM() for better ranking');
  console.log('  - Pipeline chaining (semantic → filter → expand)');
  console.log('  - Advanced patterns\n');

  const agent = new IterativeCodeAgent({
    llm: new GeminiLLMClient(),
    ragClientPath: './generated-dual-client/index.js',
    workDir: process.cwd(),
    maxIterations: 3,
    verbose: true
  });

  // This question should ideally lead the agent to:
  // 1. Do a broad semantic search
  // 2. Maybe use rerankWithLLM to get the best results
  // 3. Expand with withConsumes() to get dependencies
  const question = "Comment fonctionne le système de connexion à Neo4j dans ce projet?";

  console.log('='.repeat(80));
  console.log(`QUESTION: ${question}`);
  console.log('='.repeat(80));

  try {
    const result = await agent.answer(question);

    console.log('\n' + '─'.repeat(80));
    console.log('📝 ANSWER:');
    console.log('─'.repeat(80));
    console.log(result.answer);

    console.log('\n' + '─'.repeat(80));
    console.log('📊 SUMMARY:');
    console.log('─'.repeat(80));
    console.log(`Iterations: ${result.totalIterations}`);
    console.log(`Total time: ${(result.totalTime / 1000).toFixed(2)}s`);
    console.log(`Context scopes: ${result.context.length}`);

    console.log('\n📝 Steps:');
    result.steps.forEach(step => {
      console.log(`  ${step.iteration}. ${step.action}`);
      console.log(`     Quality: ${step.analysis?.quality}`);
      console.log(`     Next: ${step.analysis?.nextAction}`);

      // Check if the agent used new features
      const code = step.code || '';
      if (code.includes('rerankWithLLM')) {
        console.log(`     ✨ Used LLM reranking!`);
      }
      if (code.includes('withConsumes') || code.includes('withConsumedBy')) {
        console.log(`     ✨ Used relationship expansion!`);
      }
      if (code.includes('whereConsumesScope') || code.includes('whereConsumedByScope')) {
        console.log(`     ✨ Used relationship filtering!`);
      }
    });

    console.log('\n🎯 Top 5 Context Scopes:');
    result.context.slice(0, 5).forEach((scope, i) => {
      console.log(`  ${i + 1}. ${scope.entity.name} (${scope.entity.type})`);
      console.log(`     File: ${scope.entity.file}`);
      console.log(`     Score: ${scope.score.toFixed(4)}`);
    });

    // Analyze if new features were used
    console.log('\n' + '='.repeat(80));
    console.log('🔍 Feature Usage Analysis');
    console.log('='.repeat(80));

    const allCode = result.steps.map(s => s.code || '').join('\n');

    const usedReranking = allCode.includes('rerankWithLLM');
    const usedExpansion = allCode.includes('withConsumes') || allCode.includes('withConsumedBy');
    const usedFiltering = allCode.includes('whereConsumesScope') || allCode.includes('whereConsumedByScope');
    const usedPipeline = allCode.split('\n').filter(l => l.includes('.')).length > 3;

    console.log(`\n✨ LLM Reranking: ${usedReranking ? '✅ YES' : '❌ NO'}`);
    console.log(`✨ Relationship Expansion: ${usedExpansion ? '✅ YES' : '❌ NO'}`);
    console.log(`✨ Relationship Filtering: ${usedFiltering ? '✅ YES' : '❌ NO'}`);
    console.log(`✨ Pipeline Chaining: ${usedPipeline ? '✅ YES' : '❌ NO'}`);

    if (usedReranking || usedExpansion || usedFiltering) {
      console.log('\n🎉 SUCCESS! The agent is using the new features!');
    } else {
      console.log('\n⚠️  The agent did not use advanced features this time.');
      console.log('   This could be because:');
      console.log('   - The query was simple enough');
      console.log('   - The agent chose a different strategy');
      console.log('   - The LLM needs more examples');
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
