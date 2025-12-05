#!/usr/bin/env npx tsx
/**
 * Test Code Agent with File Tools
 *
 * Tests the RagAgent with file tools enabled.
 * The agent can read, write, and edit files in the project.
 *
 * Usage:
 *   npx tsx scripts/test-code-agent.ts                     # Use default task
 *   npx tsx scripts/test-code-agent.ts "Your task here"   # Custom task
 *
 * Examples:
 *   npx tsx scripts/test-code-agent.ts "Read the main entry file and summarize it"
 *   npx tsx scripts/test-code-agent.ts "Create a new utility file with a helper function"
 *   npx tsx scripts/test-code-agent.ts "Add a comment to the add function in index.ts"
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRagAgent } from '@luciformresearch/ragforge';
import { createRagClient } from '../client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

// Project root (parent of .ragforge)
const projectRoot = resolve(__dirname, '../..');

// Default task
const DEFAULT_TASK = `
Read the src/index.ts file and tell me what it does.
Then create a new file src/utils.ts with a simple utility function.
`;

async function main() {
  const task = process.argv[2] || DEFAULT_TASK;

  console.log('Code Agent Test');
  console.log('═'.repeat(60));
  console.log(`Project root: ${projectRoot}`);
  console.log('');

  const rag = createRagClient();

  // Create agent with file tools enabled
  const agent = await createRagAgent({
    configPath: resolve(__dirname, '../ragforge.config.yaml'),
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
    toolCallMode: 'structured',
    verbose: true,
    logPath: resolve(__dirname, '../code-agent-logs.json'),

    // File tools configuration
    includeFileTools: true,
    projectRoot: projectRoot,
    onFileModified: async (filePath, changeType) => {
      console.log(`\n   📁 File ${changeType}: ${filePath}`);
      // In a real scenario, you might re-ingest the file here:
      // await codeAdapter.parseFile(filePath);
    },
  });

  const tools = agent.getTools();
  console.log(`Agent created with ${tools.length} tools:`);
  console.log(`   RAG tools: ${tools.filter(t => !['read_file', 'write_file', 'edit_file'].includes(t.name)).map(t => t.name).join(', ')}`);
  console.log(`   File tools: read_file, write_file, edit_file`);
  console.log('');
  console.log(`Task: ${task.trim()}`);
  console.log('');

  const result = await agent.ask(task);

  console.log('\n' + '═'.repeat(60));
  console.log('RESULT');
  console.log('═'.repeat(60));
  console.log(`Answer: ${result.answer}`);
  console.log(`Confidence: ${result.confidence || 'N/A'}`);
  console.log(`Tools used: ${result.toolsUsed?.join(', ') || 'none'}`);

  const sessionLog = agent.getLastSessionLog();
  if (sessionLog) {
    console.log(`\nSession: ${sessionLog.totalIterations} iterations`);

    // Show file operations from logs
    const fileOps = sessionLog.entries.filter(
      e => e.type === 'tool_call' &&
      ['read_file', 'write_file', 'edit_file'].includes(e.data.toolName)
    );
    if (fileOps.length > 0) {
      console.log('\nFile operations:');
      for (const op of fileOps) {
        const path = op.data.arguments?.path || 'unknown';
        console.log(`   - ${op.data.toolName}(${path})`);
      }
    }
  }

  await rag.close();
  console.log('\nDone! Check code-agent-logs.json for details.');
}

main().catch(console.error);
