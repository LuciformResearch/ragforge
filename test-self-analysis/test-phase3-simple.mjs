/**
 * Simple test of Phase 3 features - no Neo4j, just graph inspection
 */
import { CodeSourceAdapter } from '../packages/runtime/dist/esm/adapters/code-source-adapter.js';

async function main() {
  console.log('🚀 Testing Phase 3 features...\n');

  const config = {
    name: 'test-phase3',
    adapter: 'typescript',
    rootPath: '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/adapters',
    include: ['**/*.ts'],
    exclude: [],
    entities: {}
  };

  const adapter = new CodeSourceAdapter();
  const graph = await adapter.buildGraph(config);

  console.log(`✅ Graph built!`);
  console.log(`📊 Nodes: ${graph.nodes.length}`);
  console.log(`🔗 Relationships: ${graph.relationships.length}\n`);

  // Check Phase 3 features in nodes
  const scopesWithHeritage = graph.nodes.filter(
    n => n.labels.includes('Scope') && n.properties.heritageClauses
  );
  const scopesWithGenerics = graph.nodes.filter(
    n => n.labels.includes('Scope') && n.properties.genericParameters
  );

  console.log('🎯 Phase 3 Features in graph:');
  console.log(`  Scopes with heritage clauses: ${scopesWithHeritage.length}`);
  console.log(`  Scopes with generic parameters: ${scopesWithGenerics.length}`);

  // Show examples
  if (scopesWithHeritage.length > 0) {
    console.log(`\n📝 Example scope with heritage:`)
    const ex = scopesWithHeritage[0];
    console.log(`  Name: ${ex.properties.name}`);
    console.log(`  Type: ${ex.properties.type}`);
    console.log(`  extends: ${ex.properties.extends || 'none'}`);
    console.log(`  implements: ${ex.properties.implements || 'none'}`);
    console.log(`  Raw: ${ex.properties.heritageClauses}`);
  }

  // Check relationships
  const inheritsFrom = graph.relationships.filter(r => r.type === 'INHERITS_FROM');
  const implements_ = graph.relationships.filter(r => r.type === 'IMPLEMENTS');

  console.log(`\n🔗 Heritage Relationships:`);
  console.log(`  INHERITS_FROM: ${inheritsFrom.length}`);
  console.log(`  IMPLEMENTS: ${implements_.length}`);

  if (inheritsFrom.length > 0) {
    console.log(`\n  Examples:`);
    for (const rel of inheritsFrom.slice(0, 3)) {
      const fromNode = graph.nodes.find(n => n.id === rel.from);
      const toNode = graph.nodes.find(n => n.id === rel.to);
      const explicit = rel.properties?.explicit ? '(explicit)' : '(heuristic)';
      console.log(`    ${fromNode?.properties.name} -> ${toNode?.properties.name} ${explicit}`);
    }
  }
}

main().catch(console.error);
