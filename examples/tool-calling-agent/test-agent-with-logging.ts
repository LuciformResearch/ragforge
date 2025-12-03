/**
 * Test RagAgent with full logging
 *
 * Writes detailed logs to agent-logs.json for debugging
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createRagAgent } from '@luciformresearch/ragforge-runtime';
import { createRagClient } from './client.js';
import * as fs from 'fs';

config({ path: resolve(process.cwd(), '.env') });

async function main() {
  console.log('🧪 RagAgent with Logging Test\n');

  const rag = createRagClient();

  // Create agent with logging enabled
  const agent = await createRagAgent({
    configPath: './ragforge.config.yaml',
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
    logPath: './agent-logs.json',  // <-- Logs go here
  });

  console.log(`✅ Agent created with ${agent.getTools().length} tools`);
  console.log(`📝 Logging to: ./agent-logs.json\n`);

  // Ask the question
  const result = await agent.ask('What is the purpose of StructuredLLMExecutor?');

  console.log('\n' + '='.repeat(60));
  console.log('FINAL RESULT');
  console.log('='.repeat(60));
  console.log(`Answer: ${result.answer}`);
  console.log(`Confidence: ${result.confidence || 'N/A'}`);
  console.log(`Tools used: ${result.toolsUsed?.join(', ')}`);

  // Show last session log summary
  const sessionLog = agent.getLastSessionLog();
  if (sessionLog) {
    console.log('\n📊 Session Summary:');
    console.log(`   Session ID: ${sessionLog.sessionId}`);
    console.log(`   Total iterations: ${sessionLog.totalIterations}`);
    console.log(`   Tools used: ${sessionLog.toolsUsed.join(', ')}`);
    console.log(`   Entries logged: ${sessionLog.entries.length}`);
  }

  // Read and display the log file
  console.log('\n📄 Log file content preview:');
  const logContent = fs.readFileSync('./agent-logs.json', 'utf-8');
  const logs = JSON.parse(logContent);
  const lastSession = logs[logs.length - 1];

  // Show tool calls and results
  console.log('\n🔧 Tool Calls & Results:');
  for (const entry of lastSession.entries) {
    if (entry.type === 'tool_call') {
      console.log(`\n   CALL: ${entry.data.toolName}`);
      console.log(`   Args: ${JSON.stringify(entry.data.arguments)}`);
    } else if (entry.type === 'tool_result') {
      const resultStr = JSON.stringify(entry.data.result);
      console.log(`   RESULT (${entry.data.durationMs}ms): ${resultStr.substring(0, 500)}${resultStr.length > 500 ? '...' : ''}`);
    }
  }

  await rag.close();
  console.log('\n✅ Done! Check agent-logs.json for full details.');
}

main().catch(console.error);
