import { TypeScriptLanguageParser } from '@luciformresearch/codeparsers';
import { readFileSync } from 'fs';

const parser = new TypeScriptLanguageParser();
const filePath = '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime/src/adapters/code-source-adapter.ts';
const content = readFileSync(filePath, 'utf-8');

const result = await parser.parseFile(filePath, content);

// Find CodeSourceAdapter class
const codeSourceAdapter = result.scopes.find(s => s.name === 'CodeSourceAdapter');

if (codeSourceAdapter) {
  console.log('📋 CodeSourceAdapter from parser:');
  console.log('  Name:', codeSourceAdapter.name);
  console.log('  Type:', codeSourceAdapter.type);
  console.log('  Signature:', codeSourceAdapter.signature);

  const ts = codeSourceAdapter.languageSpecific?.typescript;
  if (ts) {
    console.log('\n🎯 TypeScript-specific metadata:');
    console.log('  heritageClauses:', JSON.stringify(ts.heritageClauses, null, 2));
    console.log('  genericParameters:', JSON.stringify(ts.genericParameters, null, 2));
  } else {
    console.log('\n❌ No languageSpecific.typescript metadata!');
  }
} else {
  console.log('❌ CodeSourceAdapter not found in parsed scopes');
}
