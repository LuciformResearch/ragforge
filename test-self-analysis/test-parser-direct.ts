/**
 * Direct test of parser with new Phase 3 features
 */
import { TypeScriptLanguageParser } from '@luciformresearch/codeparsers';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('🔍 Testing new parser features directly...\n');

  const parser = new TypeScriptLanguageParser();

  // Test file with class inheritance
  const testFile = path.join(
    '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/adapters',
    'code-source-adapter.ts'
  );

  console.log(`📄 Parsing: ${testFile}\n`);

  const content = fs.readFileSync(testFile, 'utf8');
  const result = await parser.parseFile(testFile, content);

  console.log(`✅ Parsed successfully!`);
  console.log(`📊 Total scopes: ${result.scopes.length}\n`);

  // Find CodeSourceAdapter class
  const codeSourceAdapter = result.scopes.find(s => s.name === 'CodeSourceAdapter' && s.type === 'class');

  if (codeSourceAdapter) {
    console.log('🔎 CodeSourceAdapter class details:\n');
    console.log(`  Name: ${codeSourceAdapter.name}`);
    console.log(`  Type: ${codeSourceAdapter.type}`);
    console.log(`  Signature: ${codeSourceAdapter.signature}`);
    const tsMetadata = (codeSourceAdapter as any).languageSpecific?.typescript;
    console.log(`  [RAW] heritageClauses: ${JSON.stringify(tsMetadata?.heritageClauses)}`);
    console.log(`  [RAW] genericParameters: ${JSON.stringify(tsMetadata?.genericParameters)}`);
    console.log(`  [RAW] decoratorDetails: ${JSON.stringify(tsMetadata?.decoratorDetails)}`);

    // Check Phase 3 features
    if (tsMetadata?.heritageClauses && tsMetadata.heritageClauses.length > 0) {
      console.log(`  ✅ Heritage Clauses:`);
      for (const clause of tsMetadata.heritageClauses) {
        console.log(`    - ${clause.clause}: ${clause.types.join(', ')}`);
      }
    } else {
      console.log(`  ❌ Heritage Clauses: EMPTY (expected 'extends SourceAdapter')`);
    }

    if (tsMetadata?.genericParameters && tsMetadata.genericParameters.length > 0) {
      console.log(`  ✅ Generic Parameters:`);
      for (const param of tsMetadata.genericParameters) {
        const constraint = param.constraint ? ` extends ${param.constraint}` : '';
        const defaultType = param.defaultType ? ` = ${param.defaultType}` : '';
        console.log(`    - ${param.name}${constraint}${defaultType}`);
      }
    } else {
      console.log(`  ⚠️  Generic Parameters: empty (expected for this class)`);
    }

    if (tsMetadata?.decoratorDetails && tsMetadata.decoratorDetails.length > 0) {
      console.log(`  ✅ Decorators:`);
      for (const dec of tsMetadata.decoratorDetails) {
        const args = dec.arguments ? `(${dec.arguments})` : '';
        console.log(`    - @${dec.name}${args} (line ${dec.line})`);
      }
    } else {
      console.log(`  ⚠️  Decorators: empty (expected for this class)`);
    }

    if (codeSourceAdapter.members && codeSourceAdapter.members.length > 0) {
      console.log(`  ℹ️  Class members: ${codeSourceAdapter.members.length}`);
    }
  } else {
    console.log('❌ CodeSourceAdapter class not found!');
  }

  // Count all Phase 3 features across all scopes
  const withHeritage = result.scopes.filter(s => {
    const ts = (s as any).languageSpecific?.typescript;
    return ts?.heritageClauses && ts.heritageClauses.length > 0;
  });
  const withGenerics = result.scopes.filter(s => {
    const ts = (s as any).languageSpecific?.typescript;
    return ts?.genericParameters && ts.genericParameters.length > 0;
  });
  const withDecorators = result.scopes.filter(s => {
    const ts = (s as any).languageSpecific?.typescript;
    return ts?.decoratorDetails && ts.decoratorDetails.length > 0;
  });

  console.log(`\n📊 Phase 3 Features Summary:`);
  console.log(`  Scopes with heritage clauses: ${withHeritage.length}`);
  console.log(`  Scopes with generic parameters: ${withGenerics.length}`);
  console.log(`  Scopes with decorators: ${withDecorators.length}`);

  // Show an example of a scope with generics
  const exampleWithGenerics = withGenerics[0];
  if (exampleWithGenerics) {
    const ts = (exampleWithGenerics as any).languageSpecific?.typescript;
    console.log(`\n🔬 Example scope with generics: ${exampleWithGenerics.name}`);
    console.log(`  Type: ${exampleWithGenerics.type}`);
    console.log(`  Generic parameters:`);
    for (const param of ts.genericParameters) {
      const constraint = param.constraint ? ` extends ${param.constraint}` : '';
      const defaultType = param.defaultType ? ` = ${param.defaultType}` : '';
      console.log(`    - ${param.name}${constraint}${defaultType}`);
    }
  }
}

main().catch(console.error);
