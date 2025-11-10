/**
 * Rebuild Agent Documentation Script
 *
 * Re-parse examples and regenerate the agent documentation.
 * Run this script when you modify the examples.
 *
 * Usage: tsx scripts/rebuild-agent.ts
 */

import { ScopeExtractionParser } from '@luciformresearch/codeparsers';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ParsedExample {
  filename: string;
  title: string;
  intent: string;
  code: string;
}

async function parseExamples(examplesDir: string): Promise<ParsedExample[]> {
  const parser = new ScopeExtractionParser('typescript');
  await parser.initialize();

  const files = readdirSync(examplesDir)
    .filter(f => f.endsWith('.ts') && !f.includes('basic') && !f.includes('semantic-search.ts'));

  const results: ParsedExample[] = [];

  for (const filename of files) {
    try {
      const filePath = join(examplesDir, filename);
      const content = readFileSync(filePath, 'utf-8');

      // Extract metadata from JSDoc comments
      const exampleMatch = content.match(/@example\s+(.+)/);
      const intentMatch = content.match(/@intent\s+(.+)/);

      const title = exampleMatch ? exampleMatch[1] : filename.replace('.ts', '');
      const intent = intentMatch ? intentMatch[1] : '';

      // Parse to extract function body
      const analysis = await parser.parseFile(filePath, content);
      const mainScope = analysis.scopes.find(s => s.type === 'function' && s.exports.length > 0);

      if (mainScope) {
        // Extract just the relevant code (remove boilerplate)
        let code = mainScope.content;

        // Remove common boilerplate
        code = code
          .replace(/\s*const rag = createRagClient\(\);.*\n/g, '')
          .replace(/\s*await rag\.close\(\);.*\n/g, '')
          .replace(/\s*return \{?.+\}?;.*\n/g, '')
          .trim();

        // Limit to first 15 lines
        const lines = code.split('\n');
        const limitedLines = lines.slice(0, 15);
        const truncated = lines.length > 15;

        let finalCode = limitedLines.join('\n');
        if (truncated) {
          finalCode += `\n  // ... (${lines.length - 15} more lines)`;
        }

        results.push({
          filename,
          title,
          intent,
          code: finalCode
        });
      }
    } catch (error) {
      console.warn(`⚠️  Failed to parse ${filename}:`, error);
    }
  }

  return results;
}

function generateDocumentation(examples: ParsedExample[]): string {
  const sections: string[] = [];

  sections.push('## 📚 Generated Examples');
  sections.push('');
  sections.push('The following examples demonstrate how to use the generated RAG client:');
  sections.push('');

  for (const example of examples) {
    sections.push(`### ${example.title}`);
    if (example.intent) {
      sections.push(`*${example.intent}*`);
      sections.push('');
    }
    sections.push('```typescript');
    sections.push(example.code);
    sections.push('```');
    sections.push('');
  }

  return sections.join('\n');
}

async function main() {
  console.log('🔧 Rebuilding agent documentation...');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = resolve(__dirname, '..');
  const examplesDir = join(projectRoot, 'examples');
  const docsDir = join(projectRoot, 'docs');
  const agentDocPath = join(docsDir, 'agent-reference.md');
  const clientDocPath = join(docsDir, 'client-reference.md');
  const docModulePath = join(projectRoot, 'documentation.ts');

  // Parse examples
  console.log('📖 Parsing examples...');
  const examples = await parseExamples(examplesDir);
  console.log(`✅ Parsed ${examples.length} examples`);

  // Generate examples section
  const examplesSection = generateDocumentation(examples);

  // Update agent documentation (for LLM agent)
  const existingAgentDoc = readFileSync(agentDocPath, 'utf-8');
  const updatedAgentDoc = existingAgentDoc.replace(
    /## 📚 Generated Examples[\s\S]*?(?=## Best Practices)/,
    examplesSection + '\n'
  );
  writeFileSync(agentDocPath, updatedAgentDoc, 'utf-8');
  console.log(`✅ Updated ${agentDocPath}`);

  // Update client documentation (for developers)
  const existingClientDoc = readFileSync(clientDocPath, 'utf-8');
  const updatedClientDoc = existingClientDoc.replace(
    /## 📚 Generated Examples[\s\S]*?(?=## Usage Patterns)/,
    examplesSection + '\n'
  );
  writeFileSync(clientDocPath, updatedClientDoc, 'utf-8');
  console.log(`✅ Updated ${clientDocPath}`);

  // Update the TypeScript documentation module (use agent doc for LLM agent)
  const docLiteral = JSON.stringify(updatedAgentDoc);
  const moduleContent = `export const CLIENT_DOCUMENTATION = ${docLiteral};\n`;
  writeFileSync(docModulePath, moduleContent, 'utf-8');
  console.log(`✅ Updated ${docModulePath}`);

  console.log('✨ Agent documentation rebuilt successfully!');
}

main().catch(error => {
  console.error('❌ Failed to rebuild agent documentation:', error);
  process.exit(1);
});
