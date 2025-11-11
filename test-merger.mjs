/**
 * Quick test to verify defaults merging works correctly
 */

import { ConfigLoader } from './packages/core/dist/esm/config/loader.js';
import { promises as fs } from 'fs';

async function testMerger() {
  console.log('🧪 Testing defaults merger...\n');

  try {
    // Load minimal config with defaults
    console.log('📖 Loading test-merger.yaml with defaults...');
    const config = await ConfigLoader.loadWithDefaults('./test-merger.yaml');

    console.log('\n✅ Config loaded successfully!');
    console.log('\n📊 Merged configuration summary:');
    console.log(`   - Name: ${config.name}`);
    console.log(`   - Version: ${config.version}`);
    console.log(`   - Source adapter: ${config.source?.adapter}`);
    console.log(`   - Entities: ${config.entities?.length || 0}`);
    console.log(`   - Watch enabled: ${config.watch?.enabled}`);
    console.log(`   - Exclude patterns: ${config.source?.exclude?.length || 0}`);
    console.log(`   - Embeddings provider: ${config.embeddings?.provider}`);
    console.log(`   - Summarization LLM: ${config.summarization_llm?.provider}/${config.summarization_llm?.model}`);

    if (config.entities && config.entities.length > 0) {
      const scopeEntity = config.entities.find(e => e.name === 'Scope');
      if (scopeEntity) {
        console.log(`\n   Scope entity:`);
        console.log(`     - Searchable fields: ${scopeEntity.searchable_fields?.length || 0}`);
        console.log(`     - Relationships: ${scopeEntity.relationships?.length || 0}`);
        console.log(`     - Vector indexes: ${scopeEntity.vector_indexes?.length || 0}`);
      }
    }

    // Save expanded config to see the result
    const expandedPath = './test-merger-expanded.yaml';
    const yaml = await import('yaml');
    await fs.writeFile(expandedPath, yaml.stringify(config, { indent: 2 }));
    console.log(`\n💾 Expanded config saved to: ${expandedPath}`);
    console.log('\n🎉 Merger test passed!');

  } catch (error) {
    console.error('\n❌ Merger test failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

testMerger();
