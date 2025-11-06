/**
 * Debug Agent Prompts - Test what Gemini actually returns
 */

import { VertexAI } from '@google-cloud/vertexai';
import { loadEnv } from '../utils/env-loader.js';

loadEnv(import.meta.url);

const FRAMEWORK_EXAMPLES = `
# RagForge Framework Usage Examples

## Basic Semantic Search

\`\`\`typescript
import { createRagClient } from './path/to/client';

const rag = createRagClient({ neo4j: { /* config */ } });

// Search by source code
const results = await rag.scope()
  .semanticSearchBySource('parse typescript files', { topK: 10 })
  .execute();
\`\`\`
`;

async function testPrompt() {
  console.log('🧪 Testing Agent Code Generation Prompt\n');

  const vertexAI = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID!,
    location: 'us-central1'
  });

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8000,
    }
  });

  const userQuestion = "Comment fonctionne le système de connexion à Neo4j dans ce projet?";
  const ragClientPath = './generated-dual-client/index.js';

  // IMPROVED prompt with clear XML structure
  const prompt = `You are a code generation assistant for RagForge, a RAG framework for code analysis.

${FRAMEWORK_EXAMPLES}

User question: "${userQuestion}"

This is the FIRST iteration. Generate TypeScript code to perform an initial broad search.
Use semantic search with a high topK (50-100) to cast a wide net.

You MUST respond with a structured XML response following this EXACT format:

<response>
  <reasoning>
    Explain your thinking here:
    - What search strategy are you using?
    - Why this query will find relevant results?
    - What topK value and why?
  </reasoning>
  <code>
import { createRagClient } from '${ragClientPath}';

const rag = createRagClient({
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: 'neo4j'
  }
});

const results = await rag.scope()
  .semanticSearchBySource('your query here', { topK: 50 })
  .execute();

await rag.close();

console.log(JSON.stringify(results, null, 2));
  </code>
</response>

IMPORTANT:
- Use ONLY XML tags (no markdown code blocks with \`\`\`)
- The <code> section must contain valid TypeScript
- The <reasoning> section explains your strategy
- Do NOT add any text outside the <response> tags

Generate your structured XML response now:`;

  console.log('='.repeat(80));
  console.log('📝 PROMPT:');
  console.log('='.repeat(80));
  console.log(prompt);
  console.log('\n' + '='.repeat(80));
  console.log('🤖 GEMINI RESPONSE:');
  console.log('='.repeat(80));

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.candidates[0].content.parts[0].text;

    console.log(text);

    console.log('\n' + '='.repeat(80));
    console.log('🔍 ANALYSIS:');
    console.log('='.repeat(80));

    // Check for <response> wrapper
    if (text.includes('<response>')) {
      console.log('✅ Contains <response> wrapper tag');
    } else {
      console.log('❌ Missing <response> wrapper tag');
    }

    // Extract reasoning
    const reasoningMatch = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
    if (reasoningMatch) {
      console.log('✅ Successfully extracted <reasoning>');
      console.log('\n📝 Reasoning:');
      console.log(reasoningMatch[1].trim());
    } else {
      console.log('❌ NO <reasoning> tag found');
    }

    // Extract code
    const codeMatch = text.match(/<code>([\s\S]*?)<\/code>/);
    if (codeMatch) {
      console.log('\n✅ Successfully extracted <code> block');
      console.log('\n💻 Generated Code:');
      console.log('---');
      console.log(codeMatch[1].trim());
      console.log('---');
    } else {
      console.log('\n❌ NO <code> tag found');
      console.log('\n⚠️  This is why the agent fails!');

      // Check for common mistakes
      if (text.includes('```typescript')) {
        console.log('\n🔍 Found ```typescript - LLM used markdown instead of XML!');
      }
      if (text.includes('```')) {
        console.log('\n🔍 Found ``` - LLM used generic markdown code blocks');
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 VERDICT:');
    console.log('='.repeat(80));

    const hasResponse = text.includes('<response>');
    const hasReasoning = reasoningMatch !== null;
    const hasCode = codeMatch !== null;

    if (hasResponse && hasReasoning && hasCode) {
      console.log('✅ PERFECT! LLM followed the structured XML format correctly');
      console.log('   Agent would work with this response');
    } else {
      console.log('❌ FAILURE - Missing required elements:');
      if (!hasResponse) console.log('   - <response> wrapper');
      if (!hasReasoning) console.log('   - <reasoning> section');
      if (!hasCode) console.log('   - <code> section');
      console.log('\n💡 The prompt needs improvement or the LLM needs more guidance');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testPrompt().catch(console.error);
