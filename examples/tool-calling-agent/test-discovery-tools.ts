/**
 * Test Discovery Tools
 *
 * Verifies that discovery tools work generically for any config
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';

config({ path: resolve(process.cwd(), '.env') });

async function loadConfig(configPath: string) {
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(content) as any;
}

async function testDiscoveryTools(configPath: string, label: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${label}`);
  console.log(`Config: ${configPath}`);
  console.log('='.repeat(60));

  const config = await loadConfig(configPath);
  const { tools, handlers } = generateToolsFromConfig(config, {
    includeDiscovery: true,
  });

  console.log(`\n📦 Generated ${tools.length} tools:`);
  tools.forEach(t => console.log(`   - ${t.name}`));

  // Test get_schema
  console.log('\n🔍 Testing get_schema...');
  const getSchemaHandler = handlers['get_schema'];
  if (!getSchemaHandler) {
    console.error('❌ get_schema handler not found!');
    return false;
  }

  const schemaResult = await getSchemaHandler(null)({ include_tips: true });
  console.log('\n📊 Schema Result:');
  console.log(`   Entities: ${schemaResult.entities.join(', ')}`);

  for (const entityName of schemaResult.entities) {
    const entityInfo = schemaResult.entity_details[entityName];
    console.log(`\n   📁 ${entityName}:`);
    console.log(`      unique_field: ${entityInfo.unique_field}`);
    console.log(`      display_name_field: ${entityInfo.display_name_field}`);
    console.log(`      query_field: ${entityInfo.query_field}`);
    console.log(`      fields: ${entityInfo.fields.map((f: any) => f.name).join(', ')}`);
    if (entityInfo.has_semantic_search) {
      console.log(`      semantic_indexes: ${entityInfo.semantic_indexes?.join(', ')}`);
    }
    if (entityInfo.outgoing_relationships.length > 0) {
      console.log(`      outgoing_relationships: ${entityInfo.outgoing_relationships.join(', ')}`);
    }
  }

  if (schemaResult.relationships.length > 0) {
    console.log(`\n   🔗 Relationships:`);
    schemaResult.relationships.forEach((r: any) => {
      console.log(`      ${r.from} -[${r.type}]-> ${r.to}`);
    });
  }

  if (schemaResult.semantic_indexes.length > 0) {
    console.log(`\n   🧠 Semantic Indexes:`);
    schemaResult.semantic_indexes.forEach((i: any) => {
      console.log(`      ${i.name}: ${i.entity}.${i.source_field}`);
    });
  }

  if (schemaResult.usage_tips.length > 0) {
    console.log(`\n   💡 Usage Tips:`);
    schemaResult.usage_tips.forEach((tip: string) => {
      console.log(`      - ${tip}`);
    });
  }

  // Test describe_entity
  console.log('\n🔍 Testing describe_entity...');
  const describeEntityHandler = handlers['describe_entity'];
  if (!describeEntityHandler) {
    console.error('❌ describe_entity handler not found!');
    return false;
  }

  const firstEntity = schemaResult.entities[0];
  const entityResult = await describeEntityHandler(null)({ entity_name: firstEntity });
  console.log(`\n📄 describe_entity("${firstEntity}"):`);
  console.log(JSON.stringify(entityResult, null, 2));

  console.log('\n✅ Test passed!');
  return true;
}

async function main() {
  console.log('🧪 Discovery Tools Test\n');

  const results = [];

  // Test code-rag config
  results.push(await testDiscoveryTools(
    '/home/luciedefraiteur/LR_CodeRag/ragforge/examples/tool-calling-agent/ragforge.config.yaml',
    'Code RAG (Scope entity)'
  ));

  // Test document-rag config
  results.push(await testDiscoveryTools(
    '/home/luciedefraiteur/LR_CodeRag/ragforge/examples/document-rag/ragforge.config.yaml',
    'Document RAG (Document, Chunk entities)'
  ));

  console.log('\n' + '='.repeat(60));
  if (results.every(r => r)) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
}

main().catch(console.error);
