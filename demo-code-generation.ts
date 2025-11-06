/**
 * Demo: Code Generation from Config
 *
 * Generates a complete typed RAG client from the LR_CodeRag config
 */

import { SchemaIntrospector, ConfigLoader, TypeGenerator, CodeGenerator } from './packages/core/src/index.js';
import { loadEnv } from './utils/env-loader.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

loadEnv(import.meta.url);

async function main() {
  console.log('🚀 RagForge Code Generation Demo\n');

  // 1. Load config
  console.log('📋 Loading config...');
  const configPath = './examples/generated-from-lr-coderag.yaml';
  const config = await ConfigLoader.load(configPath);
  console.log(`✅ Loaded config: ${config.name}`);
  console.log(`   Entities: ${config.entities.map(e => e.name).join(', ')}`);
  console.log();

  // 2. Introspect schema
  console.log('📊 Introspecting Neo4j schema...');
  const introspector = new SchemaIntrospector(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || ''
  );

  const schema = await introspector.introspect('neo4j');
  await introspector.close();

  console.log(`✅ Schema introspected`);
  console.log(`   Nodes: ${schema.nodes.length}`);
  console.log(`   Relationships: ${schema.relationships.length}`);
  console.log();

  // 3. Generate TypeScript types
  console.log('🔧 Generating TypeScript types...');
  const typesCode = TypeGenerator.generate(schema, config);
  console.log(`✅ Types generated (${typesCode.length} chars)`);
  console.log();

  // 4. Generate client code
  console.log('🔧 Generating client code...');
  const generatedCode = CodeGenerator.generate(config, schema);
  console.log(`✅ Client code generated:`);
  console.log(`   Query builders: ${generatedCode.queries.size}`);
  console.log(`   Client: ${generatedCode.client.length} chars`);
  console.log(`   Index: ${generatedCode.index.length} chars`);
  console.log();

  // 5. Write files
  console.log('💾 Writing generated files...');
  const outputDir = './examples/generated-client';

  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, 'queries'), { recursive: true });

  // Write types
  await writeFile(join(outputDir, 'types.ts'), typesCode);
  console.log(`   ✅ types.ts`);

  // Write query builders
  for (const [name, code] of generatedCode.queries) {
    await writeFile(join(outputDir, 'queries', `${name}.ts`), code);
    console.log(`   ✅ queries/${name}.ts`);
  }

  // Write client
  await writeFile(join(outputDir, 'client.ts'), generatedCode.client);
  console.log(`   ✅ client.ts`);

  // Write index
  await writeFile(join(outputDir, 'index.ts'), generatedCode.index);
  console.log(`   ✅ index.ts`);

  console.log();
  console.log('🎉 Code generation complete!');
  console.log();
  console.log('📁 Generated files in:', outputDir);
  console.log();
  console.log('Next steps:');
  console.log('  1. Review the generated code');
  console.log('  2. Install dependencies: npm install @ragforge/runtime');
  console.log('  3. Use the client:');
  console.log();
  console.log('     import { createRagClient } from \'./examples/generated-client/index.js\';');
  console.log();
  console.log('     const rag = createRagClient({');
  console.log('       neo4j: { uri: \'bolt://localhost:7687\', ... }');
  console.log('     });');
  console.log();
  console.log('     const scopes = await rag.scope()');
  console.log('       .whereType(\'function\')');
  console.log('       .withConsumes(2)');
  console.log('       .rerankByCodeQuality()');
  console.log('       .limit(10)');
  console.log('       .execute();');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
