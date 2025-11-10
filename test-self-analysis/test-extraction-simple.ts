/**
 * Simple test to verify new parser features are working
 */
import { CodeSourceAdapter } from '../packages/runtime/src/adapters/code-source-adapter.js';
import type { AdapterConfig } from '../packages/runtime/src/types/entity-context.js';

async function main() {
  console.log('🔍 Testing new parser features...\n');

  const config: AdapterConfig = {
    adapter: 'typescript' as const,
    rootPath: '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src',
    include: ['**/*.ts'],
    exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**']
  };

  const adapter = new CodeSourceAdapter();
  const graph = await adapter.buildGraph(config);

  console.log(`✅ Extraction complete!`);
  console.log(`📊 Total nodes: ${graph.nodes.length}`);
  console.log(`🔗 Total relationships: ${graph.relationships.length}\n`);

  // Find a class with heritage (CodeSourceAdapter extends SourceAdapter)
  const codeSourceAdapterScope = graph.nodes.find(
    n => n.labels.includes('Scope') && n.properties.name === 'CodeSourceAdapter'
  );

  if (codeSourceAdapterScope) {
    console.log('🔎 Checking CodeSourceAdapter class:\n');
    console.log(`  Name: ${codeSourceAdapterScope.properties.name}`);
    console.log(`  Type: ${codeSourceAdapterScope.properties.type}`);

    // Check new Phase 3 fields
    if (codeSourceAdapterScope.properties.heritageClauses) {
      console.log(`  ✅ heritageClauses: ${JSON.stringify(codeSourceAdapterScope.properties.heritageClauses)}`);
    } else {
      console.log(`  ❌ heritageClauses: NOT FOUND`);
    }

    if (codeSourceAdapterScope.properties.genericParameters) {
      console.log(`  ✅ genericParameters: ${JSON.stringify(codeSourceAdapterScope.properties.genericParameters)}`);
    } else {
      console.log(`  ⚠️  genericParameters: empty (expected for this class)`);
    }

    if (codeSourceAdapterScope.properties.decoratorDetails) {
      console.log(`  ✅ decoratorDetails: ${JSON.stringify(codeSourceAdapterScope.properties.decoratorDetails)}`);
    } else {
      console.log(`  ⚠️  decoratorDetails: empty (expected for this class)`);
    }
  } else {
    console.log('❌ CodeSourceAdapter class not found!');
  }

  // Check for INHERITS_FROM relationship
  const inheritsFromRel = graph.relationships.find(
    r => r.type === 'INHERITS_FROM' &&
         graph.nodes.find(n => n.id === r.startNodeId)?.properties.name === 'CodeSourceAdapter'
  );

  if (inheritsFromRel) {
    const targetNode = graph.nodes.find(n => n.id === inheritsFromRel.endNodeId);
    console.log(`\n✅ INHERITS_FROM relationship found: CodeSourceAdapter -> ${targetNode?.properties.name}`);
  } else {
    console.log(`\n❌ INHERITS_FROM relationship NOT found for CodeSourceAdapter`);
  }

  // Count all scopes with heritage clauses
  const scopesWithHeritage = graph.nodes.filter(
    n => n.labels.includes('Scope') &&
         n.properties.heritageClauses &&
         n.properties.heritageClauses.length > 0
  );

  console.log(`\n📊 Scopes with heritage clauses: ${scopesWithHeritage.length}`);

  // Count all scopes with generic parameters
  const scopesWithGenerics = graph.nodes.filter(
    n => n.labels.includes('Scope') &&
         n.properties.genericParameters &&
         n.properties.genericParameters.length > 0
  );

  console.log(`📊 Scopes with generic parameters: ${scopesWithGenerics.length}`);

  // Count all scopes with decorators
  const scopesWithDecorators = graph.nodes.filter(
    n => n.labels.includes('Scope') &&
         n.properties.decoratorDetails &&
         n.properties.decoratorDetails.length > 0
  );

  console.log(`📊 Scopes with decorators: ${scopesWithDecorators.length}`);
}

main().catch(console.error);
