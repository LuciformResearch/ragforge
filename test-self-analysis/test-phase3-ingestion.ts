/**
 * Test Phase 3 ingestion - all new metadata to Neo4j
 */
import { CodeSourceAdapter } from '../packages/runtime/src/adapters/code-source-adapter.js';
import type { AdapterConfig } from '../packages/runtime/src/types/entity-context.js';
import neo4j from 'neo4j-driver';

async function main() {
  console.log('🚀 Testing Phase 3 ingestion to Neo4j...\n');

  const config: AdapterConfig = {
    adapter: 'typescript' as const,
    rootPath: '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src',
    include: ['**/*.ts'],
    exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**']
  };

  const adapter = new CodeSourceAdapter();
  const graph = await adapter.buildGraph(config);

  console.log(`✅ Graph built!`);
  console.log(`📊 Nodes: ${graph.nodes.length}`);
  console.log(`🔗 Relationships: ${graph.relationships.length}\n`);

  // Count nodes by label
  const nodesByLabel = new Map<string, number>();
  for (const node of graph.nodes) {
    const label = node.labels[0];
    nodesByLabel.set(label, (nodesByLabel.get(label) || 0) + 1);
  }

  console.log('📋 Nodes by label:');
  for (const [label, count] of nodesByLabel) {
    console.log(`  ${label}: ${count}`);
  }

  // Count relationships by type
  const relsByType = new Map<string, number>();
  for (const rel of graph.relationships) {
    relsByType.set(rel.type, (relsByType.get(rel.type) || 0) + 1);
  }

  console.log('\n🔗 Relationships by type:');
  for (const [type, count] of relsByType) {
    console.log(`  ${type}: ${count}`);
  }

  // Check Phase 3 features
  const scopesWithHeritage = graph.nodes.filter(
    n => n.labels.includes('Scope') && n.properties.heritageClauses
  );
  const scopesWithGenerics = graph.nodes.filter(
    n => n.labels.includes('Scope') && n.properties.genericParameters
  );
  const scopesWithDecorators = graph.nodes.filter(
    n => n.labels.includes('Scope') && n.properties.decoratorDetails
  );
  const scopesWithEnumMembers = graph.nodes.filter(
    n => n.labels.includes('Scope') && n.properties.enumMembers
  );

  console.log('\n🎯 Phase 3 Features:');
  console.log(`  Scopes with heritage clauses: ${scopesWithHeritage.length}`);
  console.log(`  Scopes with generic parameters: ${scopesWithGenerics.length}`);
  console.log(`  Scopes with decorators: ${scopesWithDecorators.length}`);
  console.log(`  Scopes with enum members: ${scopesWithEnumMembers.length}`);

  // Show an example
  if (scopesWithHeritage.length > 0) {
    const example = scopesWithHeritage[0];
    console.log(`\n📝 Example: ${example.properties.name}`);
    console.log(`  extends: ${example.properties.extends || 'none'}`);
    console.log(`  implements: ${example.properties.implements || 'none'}`);
    console.log(`  heritageClauses: ${example.properties.heritageClauses}`);
  }

  // Write to Neo4j
  console.log('\n💾 Writing to Neo4j...');

  const driver = neo4j.driver(
    'bolt://localhost:7688',
    neo4j.auth.basic('neo4j', 'neo4j123')
  );

  const session = driver.session();

  try {
    // Create nodes
    for (const node of graph.nodes) {
      const labels = node.labels.map(l => `:${l}`).join('');
      const propsEntries = Object.entries(node.properties);
      const setParts = propsEntries.map(([key]) => `n.${key} = $${key}`);

      const query = `
        MERGE (n${labels} {id: $id})
        SET ${setParts.join(', ')}
      `;

      const params = {
        id: node.id,
        ...node.properties
      };

      await session.run(query, params);
    }

    // Create relationships
    for (const rel of graph.relationships) {
      const props = rel.properties || {};
      const propsEntries = Object.entries(props);
      const setClause = propsEntries.length > 0
        ? `SET ${propsEntries.map(([key]) => `r.${key} = $${key}`).join(', ')}`
        : '';

      const query = `
        MATCH (a {id: $from})
        MATCH (b {id: $to})
        MERGE (a)-[r:${rel.type}]->(b)
        ${setClause}
      `;

      await session.run(query, { from: rel.from, to: rel.to, ...props });
    }

    console.log('✅ Data written to Neo4j\n');

    // Query Phase 3 features
    console.log('🔍 Querying Phase 3 features from Neo4j...\n');

    const heritageQuery = await session.run(`
      MATCH (s:Scope)
      WHERE s.heritageClauses IS NOT NULL
      RETURN s.name AS name, s.extends AS extends, s.implements AS implements
      LIMIT 5
    `);

    console.log('Heritage clauses in Neo4j:');
    for (const record of heritageQuery.records) {
      console.log(`  ${record.get('name')}: extends=${record.get('extends') || 'none'}, implements=${record.get('implements') || 'none'}`);
    }

    const inheritsQuery = await session.run(`
      MATCH (a:Scope)-[r:INHERITS_FROM]->(b:Scope)
      RETURN a.name AS child, b.name AS parent, r.explicit AS explicit
      LIMIT 10
    `);

    console.log(`\n✅ INHERITS_FROM relationships: ${inheritsQuery.records.length}`);
    for (const record of inheritsQuery.records) {
      const explicit = record.get('explicit') ? '(explicit)' : '(heuristic)';
      console.log(`  ${record.get('child')} -> ${record.get('parent')} ${explicit}`);
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
