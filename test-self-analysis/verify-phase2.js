#!/usr/bin/env node
/**
 * Verification script for Phase 2 features
 * Checks that all new node types and relationships are created correctly
 */

import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USERNAME || 'neo4j',
    process.env.NEO4J_PASSWORD || 'neo4j123'
  )
);

async function verifyPhase2() {
  const session = driver.session();

  try {
    console.log('\n🔍 Phase 2 Verification\n');
    console.log('=' .repeat(60));

    // Check node types
    console.log('\n📦 Node Types:');
    const nodeTypesQuery = `
      MATCH (n)
      RETURN labels(n) as labels, count(*) as count
      ORDER BY count DESC
    `;
    const nodeResults = await session.run(nodeTypesQuery);
    const nodeCounts = {};
    nodeResults.records.forEach(record => {
      const labels = record.get('labels');
      const count = record.get('count').toNumber();
      labels.forEach(label => {
        nodeCounts[label] = (nodeCounts[label] || 0) + count;
      });
    });

    const expectedNodes = ['Scope', 'File', 'Directory', 'ExternalLibrary', 'Project'];
    expectedNodes.forEach(nodeType => {
      const count = nodeCounts[nodeType] || 0;
      const status = count > 0 ? '✅' : '❌';
      console.log(`  ${status} ${nodeType}: ${count} nodes`);
    });

    // Check relationship types
    console.log('\n🔗 Relationship Types:');
    const relTypesQuery = `
      MATCH ()-[r]->()
      RETURN type(r) as relType, count(*) as count
      ORDER BY count DESC
    `;
    const relResults = await session.run(relTypesQuery);

    const expectedRels = [
      'DEFINED_IN',
      'CONSUMES',
      'IN_DIRECTORY',
      'PARENT_OF',
      'USES_LIBRARY',
      'BELONGS_TO',
      'HAS_PARENT',
      'INHERITS_FROM'
    ];

    const relCounts = {};
    relResults.records.forEach(record => {
      relCounts[record.get('relType')] = record.get('count').toNumber();
    });

    expectedRels.forEach(relType => {
      const count = relCounts[relType] || 0;
      const status = count > 0 ? '✅' : '⚠️';
      console.log(`  ${status} ${relType}: ${count} relationships`);
    });

    // Check Phase 2 specific features
    console.log('\n🆕 Phase 2 Features:');

    // Check File metadata (directory, extension, contentHash)
    const fileMetadataQuery = `
      MATCH (f:File)
      WHERE f.directory IS NOT NULL
        AND f.extension IS NOT NULL
        AND f.contentHash IS NOT NULL
      RETURN count(*) as count
    `;
    const fileMetaResult = await session.run(fileMetadataQuery);
    const filesWithMetadata = fileMetaResult.records[0].get('count').toNumber();
    const totalFiles = nodeCounts['File'] || 0;
    console.log(`  ${filesWithMetadata === totalFiles ? '✅' : '❌'} File metadata (directory, extension, contentHash): ${filesWithMetadata}/${totalFiles}`);

    // Check Scope parentUUID
    const parentUUIDQuery = `
      MATCH (s:Scope)
      WHERE s.parentUUID IS NOT NULL
      RETURN count(*) as count
    `;
    const parentUUIDResult = await session.run(parentUUIDQuery);
    const scopesWithParentUUID = parentUUIDResult.records[0].get('count').toNumber();
    console.log(`  ${scopesWithParentUUID > 0 ? '✅' : '⚠️'} Scope parentUUID: ${scopesWithParentUUID} scopes have parent`);

    // Check Directory depth
    const dirDepthQuery = `
      MATCH (d:Directory)
      WHERE d.depth IS NOT NULL
      RETURN count(*) as count
    `;
    const dirDepthResult = await session.run(dirDepthQuery);
    const dirsWithDepth = dirDepthResult.records[0].get('count').toNumber();
    const totalDirs = nodeCounts['Directory'] || 0;
    console.log(`  ${dirsWithDepth === totalDirs ? '✅' : '❌'} Directory depth: ${dirsWithDepth}/${totalDirs}`);

    // Check Project properties
    const projectQuery = `
      MATCH (p:Project)
      WHERE p.name IS NOT NULL
        AND p.rootPath IS NOT NULL
        AND p.indexedAt IS NOT NULL
      RETURN count(*) as count
    `;
    const projectResult = await session.run(projectQuery);
    const projectsWithProps = projectResult.records[0].get('count').toNumber();
    const totalProjects = nodeCounts['Project'] || 0;
    console.log(`  ${projectsWithProps === totalProjects ? '✅' : '❌'} Project properties: ${projectsWithProps}/${totalProjects}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    const allNodesPresent = expectedNodes.every(n => nodeCounts[n] > 0);
    const criticalRelsPresent = ['DEFINED_IN', 'IN_DIRECTORY', 'BELONGS_TO', 'HAS_PARENT'].every(r => relCounts[r] > 0);

    if (allNodesPresent && criticalRelsPresent) {
      console.log('\n✅ Phase 2 verification PASSED!\n');
      return true;
    } else {
      console.log('\n⚠️  Phase 2 verification INCOMPLETE - some features missing\n');
      return false;
    }

  } catch (error) {
    console.error('❌ Error during verification:', error);
    return false;
  } finally {
    await session.close();
  }
}

async function main() {
  try {
    const success = await verifyPhase2();
    await driver.close();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('Fatal error:', error);
    await driver.close();
    process.exit(1);
  }
}

main();
