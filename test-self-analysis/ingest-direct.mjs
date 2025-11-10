/**
 * Direct ingestion script - bypass generated code
 */
import { TypeScriptLanguageParser } from '@luciformresearch/codeparsers';
import { globby } from 'globby';
import * as path from 'path';
import * as fs from 'fs';
import neo4j from 'neo4j-driver';
import { createHash } from 'crypto';

const ROOT_PATH = '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src';

async function main() {
  console.log('🚀 Starting direct ingestion...\n');

  // Parse all files
  const parser = new TypeScriptLanguageParser();
  const files = await globby(['**/*.ts'], {
    cwd: ROOT_PATH,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.test.ts']
  });

  console.log(`📄 Found ${files.length} TypeScript files`);

  const parsedData = [];
  let totalScopes = 0;
  let scopesWithHeritage = 0;
  let scopesWithGenerics = 0;

  for (const file of files) {
    const fullPath = path.join(ROOT_PATH, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const result = await parser.parseFile(fullPath, content);

    parsedData.push({ file, result });
    totalScopes += result.scopes.length;

    // Count Phase 3 features
    for (const scope of result.scopes) {
      const ts = scope.languageSpecific?.typescript;
      if (ts?.heritageClauses?.length > 0) scopesWithHeritage++;
      if (ts?.genericParameters?.length > 0) scopesWithGenerics++;
    }
  }

  console.log(`✅ Parsed ${totalScopes} scopes`);
  console.log(`🎯 Phase 3: ${scopesWithHeritage} with heritage, ${scopesWithGenerics} with generics\n`);

  // Connect to Neo4j
  const driver = neo4j.driver(
    'bolt://localhost:7688',
    neo4j.auth.basic('neo4j', 'neo4j123')
  );
  const session = driver.session();

  try {
    // Create Project node
    await session.run(`
      CREATE (p:Project {
        id: 'project:ragforge-runtime',
        name: 'ragforge-runtime',
        rootPath: $rootPath,
        indexedAt: datetime()
      })
    `, { rootPath: ROOT_PATH });

    console.log('📦 Created Project node');

    // Create Scope nodes
    let nodeCount = 0;
    const scopeUUIDs = new Map(); // (file, scopeName) -> uuid

    for (const { file, result } of parsedData) {
      for (const scope of result.scopes) {
        const ts = scope.languageSpecific?.typescript;

        // Generate UUID
        const scopeKey = `${file}:${scope.name}:${scope.startLine}`;
        const uuid = createHash('sha256').update(scopeKey).digest('hex').substring(0, 16);
        scopeUUIDs.set(`${file}:${scope.name}`, uuid);

        // Build properties
        const props = {
          uuid,
          name: scope.name,
          type: scope.type,
          file,
          language: 'typescript',
          startLine: scope.startLine,
          endLine: scope.endLine,
          signature: scope.signature || '',
          source: scope.source || ''
        };

        // Phase 3: Add heritage clauses
        if (ts?.heritageClauses?.length > 0) {
          props.heritageClauses = JSON.stringify(ts.heritageClauses);
          props.extends = ts.heritageClauses
            .filter(c => c.clause === 'extends')
            .flatMap(c => c.types)
            .join(',');
          props.implements = ts.heritageClauses
            .filter(c => c.clause === 'implements')
            .flatMap(c => c.types)
            .join(',');
        }

        // Phase 3: Add generic parameters
        if (ts?.genericParameters?.length > 0) {
          props.genericParameters = JSON.stringify(ts.genericParameters);
          props.generics = ts.genericParameters.map(g => g.name).join(',');
        }

        // Phase 3: Add decorators
        if (ts?.decoratorDetails?.length > 0) {
          props.decoratorDetails = JSON.stringify(ts.decoratorDetails);
          props.decorators = ts.decoratorDetails.map(d => d.name).join(',');
        }

        // Phase 3: Add enum members
        if (ts?.enumMembers?.length > 0) {
          props.enumMembers = JSON.stringify(ts.enumMembers);
        }

        await session.run(`
          CREATE (s:Scope $props)
          WITH s
          MATCH (p:Project {id: 'project:ragforge-runtime'})
          CREATE (s)-[:BELONGS_TO]->(p)
        `, { props });

        nodeCount++;
      }
    }

    console.log(`✅ Created ${nodeCount} Scope nodes\n`);

    // Create INHERITS_FROM relationships from heritage clauses
    let inheritCount = 0;
    for (const { file, result } of parsedData) {
      for (const scope of result.scopes) {
        const ts = scope.languageSpecific?.typescript;

        if (ts?.heritageClauses?.length > 0) {
          const sourceUuid = scopeUUIDs.get(`${file}:${scope.name}`);

          for (const clause of ts.heritageClauses) {
            for (const typeName of clause.types) {
              // Try to find target scope
              let targetUuid = null;

              // Search in all files
              for (const { file: targetFile, result: targetResult } of parsedData) {
                const targetScope = targetResult.scopes.find(s => s.name === typeName);
                if (targetScope) {
                  targetUuid = scopeUUIDs.get(`${targetFile}:${targetScope.name}`);
                  break;
                }
              }

              if (targetUuid) {
                const relType = clause.clause === 'extends' ? 'INHERITS_FROM' : 'IMPLEMENTS';

                await session.run(`
                  MATCH (a:Scope {uuid: $sourceUuid})
                  MATCH (b:Scope {uuid: $targetUuid})
                  CREATE (a)-[r:${relType} {explicit: true, clause: $clause}]->(b)
                `, { sourceUuid, targetUuid, clause: clause.clause });

                inheritCount++;
              }
            }
          }
        }
      }
    }

    console.log(`✅ Created ${inheritCount} heritage relationships\n`);

    // Query results
    console.log('🔍 Querying Neo4j for Phase 3 features...\n');

    const heritageResult = await session.run(`
      MATCH (s:Scope)
      WHERE s.heritageClauses IS NOT NULL
      RETURN s.name AS name, s.extends AS extends, s.implements AS implements
      ORDER BY s.name
      LIMIT 10
    `);

    console.log('📋 Scopes with heritage clauses:');
    for (const record of heritageResult.records) {
      const ext = record.get('extends') || '';
      const impl = record.get('implements') || '';
      console.log(`  ${record.get('name')}: ${ext ? `extends ${ext}` : ''}${ext && impl ? ', ' : ''}${impl ? `implements ${impl}` : ''}`);
    }

    const inheritsResult = await session.run(`
      MATCH (a:Scope)-[r:INHERITS_FROM]->(b:Scope)
      RETURN a.name AS child, b.name AS parent, r.explicit AS explicit
      ORDER BY a.name
    `);

    console.log(`\n🔗 INHERITS_FROM relationships: ${inheritsResult.records.length}`);
    for (const record of inheritsResult.records.slice(0, 10)) {
      const explicit = record.get('explicit') ? '(explicit)' : '(heuristic)';
      console.log(`  ${record.get('child')} -> ${record.get('parent')} ${explicit}`);
    }

    const genericsResult = await session.run(`
      MATCH (s:Scope)
      WHERE s.genericParameters IS NOT NULL
      RETURN s.name AS name, s.generics AS generics, s.genericParameters AS details
      LIMIT 10
    `);

    console.log(`\n🎯 Scopes with generic parameters: ${genericsResult.records.length}`);
    for (const record of genericsResult.records.slice(0, 5)) {
      console.log(`  ${record.get('name')}<${record.get('generics')}>`);
    }

    // Summary
    const summary = await session.run(`
      MATCH (s:Scope)
      RETURN
        count(s) AS total,
        count(CASE WHEN s.heritageClauses IS NOT NULL THEN 1 END) AS withHeritage,
        count(CASE WHEN s.genericParameters IS NOT NULL THEN 1 END) AS withGenerics,
        count(CASE WHEN s.decoratorDetails IS NOT NULL THEN 1 END) AS withDecorators,
        count(CASE WHEN s.enumMembers IS NOT NULL THEN 1 END) AS withEnums
    `);

    const stats = summary.records[0];
    console.log('\n📊 Summary:');
    console.log(`  Total Scopes: ${stats.get('total')}`);
    console.log(`  With heritage clauses: ${stats.get('withHeritage')}`);
    console.log(`  With generic parameters: ${stats.get('withGenerics')}`);
    console.log(`  With decorators: ${stats.get('withDecorators')}`);
    console.log(`  With enum members: ${stats.get('withEnums')}`);

  } finally {
    await session.close();
    await driver.close();
  }

  console.log('\n✅ Ingestion complete!');
}

main().catch(console.error);
