import { CodeSourceAdapter } from '@luciformresearch/ragforge-runtime';

const config = {
  adapter: 'typescript',
  rootPath: '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/adapters',
  include: ['code-source-adapter.ts'],
  exclude: []
};

const adapter = new CodeSourceAdapter();
const graph = await adapter.buildGraph(config);

console.log(`✅ Graph built: ${graph.nodes.length} nodes, ${graph.relationships.length} relationships\n`);

// Find CodeSourceAdapter node
const codeSourceNode = graph.nodes.find(n => n.properties.name === 'CodeSourceAdapter');

if (codeSourceNode) {
  console.log('📋 CodeSourceAdapter node properties:');
  console.log(JSON.stringify(codeSourceNode.properties, null, 2));
} else {
  console.log('❌ CodeSourceAdapter node not found');
}

// Check for any nodes with heritage clauses
const nodesWithHeritage = graph.nodes.filter(n => n.properties.heritageClauses);
console.log(`\n🎯 Nodes with heritage clauses: ${nodesWithHeritage.length}`);
if (nodesWithHeritage.length > 0) {
  console.log('Examples:');
  nodesWithHeritage.slice(0, 3).forEach(n => {
    console.log(`  - ${n.properties.name}: extends=${n.properties.extends}, implements=${n.properties.implements}`);
  });
}
