/**
 * Test script for CSS parsing integration
 */

import { CodeSourceAdapter } from '../../packages/core/dist/esm/index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Testing CSS integration...\n');

  const adapter = new CodeSourceAdapter('typescript');

  const config = {
    type: 'code',
    include: ['src/**/*.ts', 'src/**/*.html', 'src/**/*.css'],
    exclude: ['**/node_modules/**'],
    root: __dirname,
    adapter: 'typescript'
  };

  try {
    const result = await adapter.parse({
      source: config,
      onProgress: (progress) => {
        console.log(`[${progress.phase}] ${progress.currentFile || ''} - ${progress.percentComplete?.toFixed(1)}%`);
      }
    });

    console.log('\n--- Results ---');
    console.log(`Nodes: ${result.graph.nodes.length}`);
    console.log(`Relationships: ${result.graph.relationships.length}`);

    // List nodes by label
    const nodesByLabel = {};
    for (const node of result.graph.nodes) {
      const label = node.labels[0] || 'Unknown';
      nodesByLabel[label] = (nodesByLabel[label] || 0) + 1;
    }

    console.log('\nNodes by label:');
    for (const [label, count] of Object.entries(nodesByLabel)) {
      console.log(`  ${label}: ${count}`);
    }

    // Check for Stylesheet nodes
    const stylesheets = result.graph.nodes.filter(n => n.labels.includes('Stylesheet'));
    console.log('\nStylesheet nodes:');
    for (const ss of stylesheets) {
      console.log(`  - ${ss.properties.file}`);
      console.log(`    Rules: ${ss.properties.ruleCount}, Selectors: ${ss.properties.selectorCount}`);
      console.log(`    Variables: ${JSON.stringify(ss.properties.variables || [])}`);
      console.log(`    Imports: ${JSON.stringify(ss.properties.imports || [])}`);
    }

    // Check for WebDocument nodes
    const webDocs = result.graph.nodes.filter(n => n.labels.includes('WebDocument'));
    console.log('\nWebDocument nodes:');
    for (const doc of webDocs) {
      console.log(`  - ${doc.properties.file}`);
      console.log(`    External stylesheets: ${doc.properties.externalStyles?.length || 0}`);
      console.log(`    External scripts: ${doc.properties.externalScripts?.length || 0}`);
    }

    // Check relationships
    const relsByType = {};
    for (const rel of result.graph.relationships) {
      relsByType[rel.type] = (relsByType[rel.type] || 0) + 1;
    }

    console.log('\nRelationships by type:');
    for (const [type, count] of Object.entries(relsByType)) {
      console.log(`  ${type}: ${count}`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
