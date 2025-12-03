/**
 * Text2Cypher - Natural Language to Cypher Query
 *
 * Converts natural language questions to Cypher queries using Gemini.
 *
 * Usage:
 *   npx tsx text2cypher.ts "Your question here"
 *   npm run ask "Your question here"
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@luciformresearch/ragforge-runtime';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const client = createClient({
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  }
});

// Pre-defined schema from config
const SCHEMA = `
## Graph Schema

### Entities:
- Scope: name, file, source

### Relationships:
- (Scope)-[:BELONGS_TO]->(Project)
- (File)-[:BELONGS_TO]->(Project)
- (Scope)-[:DEFINED_IN]->(File)
- (Scope)-[:HAS_PARENT]->(Scope)
- (File)-[:IN_DIRECTORY]->(Directory)
- (Directory)-[:PARENT_OF]->(Directory)
- (Scope)-[:CONSUMES]->(Scope)
- (Scope)-[:INHERITS_FROM]->(Scope)
- (Scope)-[:USES_LIBRARY]->(ExternalLibrary)
- (Conversation)-[:HAS_MESSAGE]->(Message)

### Important Notes:
- Use MATCH (n:Label) to query specific node types
- Use toLower() for case-insensitive text search
- Limit results to avoid large outputs
`;

async function generateCypher(question: string): Promise<string> {
  const prompt = `You are a Neo4j Cypher expert. Generate a Cypher query to answer the question.

${SCHEMA}

## Rules:
- Return ONLY the Cypher query, no explanations
- Use clear aliases in RETURN (AS readable_name)
- Limit results to 20 maximum
- For text search, use CONTAINS or toLower() for case-insensitive

## Question:
${question}

## Cypher:`;

  const result = await model.generateContent(prompt);
  return result.response.text()
    .replace(/\`\`\`cypher\n?/g, '')
    .replace(/\`\`\`\n?/g, '')
    .trim();
}

async function executeAndFormat(cypher: string): Promise<void> {
  console.log('\n📝 Generated Cypher:');
  console.log('─'.repeat(50));
  console.log(cypher);
  console.log('─'.repeat(50));

  try {
    const result = await client.raw(cypher);
    console.log(`\n📊 Results (${result.records.length} rows):\n`);

    if (result.records.length === 0) {
      console.log('  (no results)');
      return;
    }

    const keys = result.records[0].keys;
    for (const record of result.records) {
      const values = keys.map(key => {
        let val = record.get(key);
        if (val === null || val === undefined) return `${key}: (null)`;
        if (typeof val === 'object' && val.low !== undefined) val = val.low;
        if (typeof val === 'string' && val.length > 100) val = val.substring(0, 100) + '...';
        return `${key}: ${val}`;
      });
      console.log('  ' + values.join(' | '));
    }
  } catch (error: any) {
    console.error('\n❌ Query Error:', error.message);
  }
}

async function main() {
  const question = process.argv.slice(2).join(' ');

  if (!question) {
    console.log('Usage: npx tsx text2cypher.ts "Your question"');
    console.log('   or: npm run ask "Your question"');
    console.log('\nExamples:');
    console.log('  npm run ask "List all documents"');
    console.log('  npm run ask "How many nodes of each type?"');
    process.exit(1);
  }

  console.log('🤔 Question:', question);

  try {
    console.log('🧠 Generating Cypher...');
    const cypher = await generateCypher(question);
    await executeAndFormat(cypher);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
