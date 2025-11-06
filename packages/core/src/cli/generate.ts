#!/usr/bin/env node
/**
 * RagForge CLI - Generate Config
 *
 * Demonstrates intelligent config generation from Neo4j schema introspection
 */

import { SchemaIntrospector } from '../schema/introspector.js';
import { ConfigGenerator } from '../generator/config-generator.js';
import { TypeGenerator } from '../generator/type-generator.js';
import YAML from 'yaml';
import { promises as fs } from 'fs';

interface GenerateOptions {
  uri: string;
  username: string;
  password: string;
  database?: string;
  projectName: string;
  output?: string;
  generateTypes?: boolean;
}

export async function generateConfig(options: GenerateOptions): Promise<void> {
  console.log('🔍 Connecting to Neo4j...');
  const introspector = new SchemaIntrospector(
    options.uri,
    options.username,
    options.password
  );

  try {
    console.log('📊 Introspecting schema...');
    const schema = await introspector.introspect(options.database);

    console.log(`\n✨ Schema discovered:`);
    console.log(`  - ${schema.nodes.length} node types`);
    console.log(`  - ${schema.relationships.length} relationship types`);
    console.log(`  - ${schema.vectorIndexes.length} vector indexes`);

    console.log('\n🧠 Analyzing domain and generating config...');
    const config = ConfigGenerator.generate(schema, options.projectName);

    // Show domain detection results
    const domain = (ConfigGenerator as any).detectDomain(schema);
    console.log(`\n🎯 Detected domain: ${domain.name} (confidence: ${(domain.confidence * 100).toFixed(0)}%)`);
    console.log('  Indicators:');
    for (const indicator of domain.indicators.slice(0, 5)) {
      console.log(`    - ${indicator}`);
    }
    if (domain.indicators.length > 5) {
      console.log(`    ... and ${domain.indicators.length - 5} more`);
    }

    console.log(`\n📝 Generated config:`);
    console.log(`  - ${config.entities.length} entities configured`);
    console.log(`  - ${config.reranking?.strategies.length || 0} reranking strategies`);
    console.log(`  - ${config.mcp?.tools?.length || 0} MCP tools`);

    // Output config
    const yamlContent = YAML.stringify(config, { indent: 2 });

    if (options.output) {
      await fs.writeFile(options.output, yamlContent, 'utf-8');
      console.log(`\n✅ Config written to: ${options.output}`);
    } else {
      console.log('\n' + '='.repeat(80));
      console.log(yamlContent);
      console.log('='.repeat(80));
    }

    // Generate types if requested
    if (options.generateTypes) {
      console.log('\n🔧 Generating TypeScript types...');
      const types = TypeGenerator.generate(schema, config);

      const typesPath = options.output
        ? options.output.replace(/\.yaml$/, '.types.ts')
        : 'generated.types.ts';

      await fs.writeFile(typesPath, types, 'utf-8');
      console.log(`✅ Types written to: ${typesPath}`);
    }

  } finally {
    await introspector.close();
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  const options: GenerateOptions = {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || '',
    database: process.env.NEO4J_DATABASE,
    projectName: args[0] || 'my-project',
    output: args[1],
    generateTypes: args.includes('--types')
  };

  generateConfig(options)
    .then(() => {
      console.log('\n✨ Done!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
}
