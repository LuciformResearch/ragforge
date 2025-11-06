import { SchemaIntrospector } from './packages/core/dist/index.js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../LR_CodeRag/.env') });

async function testIntrospection() {
  const uri = process.env.NEO4J_URI!;
  const username = process.env.NEO4J_USER || process.env.NEO4J_USERNAME!;
  const password = process.env.NEO4J_PASSWORD!;

  console.log(`📡 Connecting to: ${uri}\n`);

  const introspector = new SchemaIntrospector(uri, username, password);

  try {
    console.log('🔍 Introspecting Neo4j...\n');
    const schema = await introspector.introspect();

    console.log('📊 Field Examples collected:');
    if (schema.fieldExamples) {
      const entries = Object.entries(schema.fieldExamples);
      if (entries.length === 0) {
        console.log('  (none collected)');
      } else {
        for (const [key, values] of entries) {
          console.log(`  ${key}:`);
          values.slice(0, 3).forEach(v => console.log(`    - "${v}"`));
          if (values.length > 3) {
            console.log(`    ... and ${values.length - 3} more`);
          }
        }
      }
    } else {
      console.log('  (fieldExamples is undefined)');
    }

    console.log('\n🔗 Relationship Examples collected:');
    if (schema.relationshipExamples) {
      const entries = Object.entries(schema.relationshipExamples);
      if (entries.length === 0) {
        console.log('  (none collected)');
      } else {
        for (const [relType, targetName] of entries) {
          console.log(`  ${relType} -> "${targetName}"`);
        }
      }
    } else {
      console.log('  (relationshipExamples is undefined)');
    }

    console.log('\n✨ Working Examples collected:');
    if (schema.workingExamples) {
      const entries = Object.entries(schema.workingExamples);
      if (entries.length === 0) {
        console.log('  (none collected)');
      } else {
        for (const [key, value] of entries) {
          console.log(`  ${key}:`);
          if (Array.isArray(value)) {
            value.slice(0, 3).forEach((item: any) => {
              if (item.relType) {
                console.log(`    - ${item.relType}: ${item.sourceName} -> ${item.targetName} (${item.count})`);
              } else if (item.name) {
                console.log(`    - ${item.name} (${item.relationships?.length || 0} rels)`);
              }
            });
            if (value.length > 3) {
              console.log(`    ... and ${value.length - 3} more`);
            }
          }
        }
      }
    } else {
      console.log('  (workingExamples is undefined)');
    }

  } finally {
    await introspector.close();
  }
}

testIntrospection()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
