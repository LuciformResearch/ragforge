/**
 * Demo: Generate RagForge config from LR_CodeRag database
 *
 * This demonstrates the intelligent config generation on a real codebase
 */

import { generateConfig } from './packages/core/src/cli/generate.js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from LR_CodeRag root
dotenv.config({ path: resolve(process.cwd(), '../.env') });

async function main() {
  console.log('🚀 RagForge Demo - LR_CodeRag Config Generation\n');

  await generateConfig({
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: 'neo4j',
    projectName: 'lr-coderag',
    output: './examples/generated-from-lr-coderag.yaml',
    generateTypes: true
  });

  console.log('\n📚 Next steps:');
  console.log('  1. Review the generated config in examples/generated-from-lr-coderag.yaml');
  console.log('  2. Tweak any settings as needed');
  console.log('  3. Run code generation to create your RAG framework');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
