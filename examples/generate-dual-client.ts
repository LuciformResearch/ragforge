/**
 * Generate client with dual embeddings support
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, readFile } from 'fs/promises';
import yaml from 'js-yaml';
import { CodeGenerator } from '../packages/core/src/generator/code-generator.js';
import { loadEnv } from '../utils/env-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnv(import.meta.url);

async function main() {
  console.log('🏗️  Generating Client with Dual Embeddings Support\n');

  // 1. Load config
  const configPath = resolve(__dirname, 'lr-coderag-dual-embeddings.yaml');
  console.log(`📄 Loading config: ${configPath}`);

  const configText = await readFile(configPath, 'utf-8');
  const config: any = yaml.load(configText);
  console.log(`✅ Config loaded: ${config.name} v${config.version}\n`);

  // 2. Mock schema (we don't need introspection for code generation)
  console.log('📝 Using mock schema...');

  const schema = {
    nodeLabels: config.entities.map((e: any) => ({
      label: e.name,
      properties: e.searchable_fields.map((f: any) => f.name),
      count: 0
    })),
    relationshipTypes: [],
    vectorIndexes: []
  };

  console.log(`✅ Configured ${schema.nodeLabels.length} entities\n`);

  // 3. Generate code
  console.log('⚙️  Generating TypeScript client...');

  const generated = CodeGenerator.generate(config, schema);

  // 4. Write files
  const outDir = resolve(__dirname, 'generated-dual-client');
  const queriesDir = resolve(outDir, 'queries');

  await mkdir(outDir, { recursive: true });
  await mkdir(queriesDir, { recursive: true });

  // Write query builders
  for (const [entityName, code] of generated.queries.entries()) {
    const filePath = resolve(queriesDir, `${entityName}.ts`);
    await writeFile(filePath, code, 'utf-8');
    console.log(`  ✓ queries/${entityName}.ts`);
  }

  // Write client
  const clientPath = resolve(outDir, 'client.ts');
  await writeFile(clientPath, generated.client, 'utf-8');
  console.log(`  ✓ client.ts`);

  // Write index
  const indexPath = resolve(outDir, 'index.ts');
  await writeFile(indexPath, generated.index, 'utf-8');
  console.log(`  ✓ index.ts`);

  // Write types (copy from existing)
  // TODO: Generate types from schema
  console.log(`  ⚠ types.ts - copy from generated-client/types.ts manually`);

  console.log('\n✅ Client generation complete!\n');

  // Show generated API
  console.log('📚 Generated API includes:\n');

  const scopeIndexes = config.entities
    .find(e => e.name === 'Scope')
    ?.vector_indexes || [];

  for (const idx of scopeIndexes) {
    const searchType = idx.source_field || 'embedding';
    const methodName = `semanticSearchBy${searchType.charAt(0).toUpperCase() + searchType.slice(1)}`;
    console.log(`  - rag.scope().${methodName}('...') ← Search by ${searchType}`);
  }

  console.log(`  - rag.scope().withConsumes(1) ← Include dependencies`);
  console.log(`  - rag.scope().withConsumedBy(1) ← Include consumers`);
  console.log(`  - rag.scope().rerankByCodeQuality() ← Apply reranking`);
  console.log('');

  console.log('🎯 Next steps:');
  console.log('  1. Copy types.ts from generated-client to generated-dual-client');
  console.log('  2. Run: npm run create-vector-indexes');
  console.log('  3. Run: npm run reindex-embeddings');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
