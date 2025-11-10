import { buildGraph } from './generated/index.js';
import { loadConfig } from './generated/config.js';

async function main() {
  console.log('🚀 Starting code ingestion...\n');

  const config = loadConfig();
  const result = await buildGraph(config);

  console.log('\n✅ Ingestion complete!');
  console.log(`📊 Nodes created: ${result.nodes.length}`);
  console.log(`🔗 Relationships created: ${result.relationships.length}`);

  // Count by type
  const nodesByType = new Map<string, number>();
  for (const node of result.nodes) {
    const label = node.labels[0];
    nodesByType.set(label, (nodesByType.get(label) || 0) + 1);
  }

  console.log('\n📋 Nodes by type:');
  for (const [type, count] of nodesByType.entries()) {
    console.log(`  ${type}: ${count}`);
  }

  const relsByType = new Map<string, number>();
  for (const rel of result.relationships) {
    relsByType.set(rel.type, (relsByType.get(rel.type) || 0) + 1);
  }

  console.log('\n🔗 Relationships by type:');
  for (const [type, count] of relsByType.entries()) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);
