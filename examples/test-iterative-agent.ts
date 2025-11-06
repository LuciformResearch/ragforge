/**
 * Test Iterative Code Agent
 *
 * Demo of an LLM agent that writes and executes RagForge queries
 * to progressively build code context
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
      location: process.env.VERTEX_LOCATION || 'us-central1'
    });

    this.model = this.vertexAI.getGenerativeModel({
      model: 'gemini-1.5-flash-002',
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
  console.log('🤖 Iterative Code Agent Demo\n');
  console.log('This agent will write and execute RagForge queries');
  console.log('to progressively build the perfect code context.\n');

  // Create agent
  const agent = new IterativeCodeAgent({
    llm: new GeminiLLMClient(),
    ragClientPath: './generated-dual-client/index.js',
    workDir: process.cwd(),
    maxIterations: 4,
    verbose: true
  });

  // Test questions
  const questions = [
    "À quoi sert la classe TypeScriptParser?",
    "Quels fichiers sont liés à la détection de changements (file watching)?",
    "Comment fonctionne le système d'embeddings?",
  ];

  for (const question of questions) {
    console.log('\n' + '='.repeat(80));
    console.log(`QUESTION: ${question}`);
    console.log('='.repeat(80));

    try {
      const result = await agent.answer(question);

      console.log('\n' + '─'.repeat(80));
      console.log('FINAL ANSWER:');
      console.log('─'.repeat(80));
      console.log(result.answer);

      console.log('\n' + '─'.repeat(80));
      console.log('EXECUTION SUMMARY:');
      console.log('─'.repeat(80));
      console.log(`Iterations: ${result.totalIterations}`);
      console.log(`Total time: ${result.totalTime}ms`);
      console.log(`Context scopes: ${result.context.length}`);

      console.log('\nSteps:');
      result.steps.forEach(step => {
        console.log(`  ${step.iteration}. ${step.action} (${step.timestamp}ms)`);
        console.log(`     Quality: ${step.analysis?.quality}`);
        console.log(`     Next: ${step.analysis?.nextAction}`);
      });

      console.log('\nTop context scopes:');
      result.context.slice(0, 5).forEach((scope, i) => {
        console.log(`  ${i + 1}. ${scope.entity.name} (${scope.entity.type}) - ${scope.entity.file}`);
      });

    } catch (error: any) {
      console.error('❌ Error:', error.message);
      console.error(error.stack);
    }

    // Only test first question for now
    break;
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
