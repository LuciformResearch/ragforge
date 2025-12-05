/**
 * Test RagAgent on {{PROJECT_NAME}}
 *
 * Quick test to verify the agent works with this codebase.
 * Customize the question or pass one as argument.
 *
 * Usage:
 *   npx tsx scripts/test-agent.ts                    # Use default question
 *   npx tsx scripts/test-agent.ts "Your question"   # Custom question
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRagAgent } from '@luciformresearch/ragforge';
import { createRagClient } from '../client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

// Default question - customize for your domain
const DEFAULT_QUESTION = 'What are the main components of {{PROJECT_NAME}}?';

async function main() {
  const question = process.argv[2] || DEFAULT_QUESTION;

  console.log('RagAgent Test for {{PROJECT_NAME}}\n');

  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: resolve(__dirname, '../ragforge.config.yaml'),
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
    logPath: resolve(__dirname, '../agent-logs.json'),
  });

  console.log(`Agent created with ${agent.getTools().length} tools`);
  console.log(`Logging to: agent-logs.json\n`);
  console.log(`Question: ${question}\n`);

  const result = await agent.ask(question);

  console.log('\n' + '='.repeat(60));
  console.log('RESULT');
  console.log('='.repeat(60));
  console.log(`Answer: ${result.answer}`);
  console.log(`Confidence: ${result.confidence || 'N/A'}`);
  console.log(`Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);

  const sessionLog = agent.getLastSessionLog();
  if (sessionLog) {
    console.log(`\nSession: ${sessionLog.totalIterations} iterations, ${sessionLog.entries.length} log entries`);
  }

  await rag.close();
  console.log('\nDone! Check agent-logs.json for details.');
}

main().catch(console.error);
