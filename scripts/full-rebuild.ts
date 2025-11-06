/**
 * Full RagForge rebuild pipeline
 * 1. Reindex embeddings (dual: signature + source)
 * 2. Regenerate dual-embeddings client
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ragforgeRoot = resolve(__dirname, '..');

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n$ ${command} ${args.join(' ')}`);
    console.log(`  (in ${cwd})\n`);

    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function main() {
  console.log('🔄 RagForge Full Rebuild Pipeline');
  console.log('═'.repeat(70));
  console.log('');

  try {
    // Step 1: Reindex embeddings
    console.log('📊 Step 1/3: Reindexing embeddings (dual: signature + source)');
    console.log('─'.repeat(70));
    await runCommand('npx', ['tsx', 'scripts/reindex-embeddings.ts'], ragforgeRoot);
    console.log('✅ Embeddings reindexed!\n');

    // Step 2: Generate dual-embeddings client
    console.log('🏗️  Step 2/3: Generating dual-embeddings client');
    console.log('─'.repeat(70));
    await runCommand('npx', ['tsx', 'examples/generate-dual-client.ts'], ragforgeRoot);
    console.log('✅ Client generated!\n');

    // Step 3: Build runtime package
    console.log('📦 Step 3/3: Building runtime package');
    console.log('─'.repeat(70));
    await runCommand('npm', ['run', 'build'], resolve(ragforgeRoot, 'packages/runtime'));
    console.log('✅ Runtime built!\n');

    // Summary
    console.log('═'.repeat(70));
    console.log('🎉 Full rebuild complete!\n');
    console.log('📚 Generated client available at:');
    console.log(`   ${resolve(ragforgeRoot, 'examples/generated-dual-client')}\n`);
    console.log('🧪 Test with:');
    console.log('   npx tsx examples/test-dual-semantic-search.ts\n');

  } catch (error: any) {
    console.error('\n❌ Pipeline failed:', error.message);
    process.exit(1);
  }
}

main();
