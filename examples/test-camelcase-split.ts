/**
 * Test camelCase splitting utility
 */

function splitCamelCase(identifier: string): string {
  if (!identifier || identifier.length <= 1) return identifier;

  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')  // lowercase followed by uppercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // consecutive uppercase followed by lowercase
    .split(' ');

  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const testCases = [
  // Format: [input, expected]
  ['getNeo4jDriver', 'Get Neo4j Driver'],
  ['createNeo4jDriver', 'Create Neo4j Driver'],
  ['Neo4jClient', 'Neo4j Client'],
  ['XMLParser', 'XML Parser'],
  ['parseHTMLDocument', 'Parse HTML Document'],
  ['QueryBuilder', 'Query Builder'],
  ['buildConfig', 'Build Config'],
  ['loadEnv', 'Load Env'],
  ['simple', 'Simple'],
  ['UPPERCASE', 'UPPERCASE'],
  ['camelCaseExample', 'Camel Case Example'],
];

console.log('🧪 Testing camelCase Splitting\n');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

testCases.forEach(([input, expected]) => {
  const result = splitCamelCase(input);
  const match = result === expected;

  if (match) {
    console.log(`✅ ${input.padEnd(25)} → ${result}`);
    passed++;
  } else {
    console.log(`❌ ${input.padEnd(25)} → ${result}`);
    console.log(`   Expected: ${expected}`);
    failed++;
  }
});

console.log('='.repeat(80));
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

// Show example enrichment
console.log('='.repeat(80));
console.log('📝 Example Enrichment for "getNeo4jDriver"\n');

const scopeName = 'getNeo4jDriver';
const consumes = ['createNeo4jDriver', 'Driver'];
const source = `function getNeo4jDriver(): Driver {
  if (!driver) {
    driver = createNeo4jDriver();
  }
  return driver;
}`;

const splitName = splitCamelCase(scopeName);
const consumesOriginal = consumes.join(', ');
const consumesSplit = consumes.map(dep => splitCamelCase(dep)).join(', ');

console.log('Original:');
console.log(source);
console.log('\nEnriched:');
console.log(source);
console.log(`\nFunction: ${splitName}`);
console.log(`Uses: ${consumesOriginal}`);
console.log(`Uses (expanded): ${consumesSplit}`);

console.log('\n' + '='.repeat(80));
console.log('💡 Key Insight:');
console.log('   "getNeo4jDriver" is now tokenized as "Get Neo4j Driver"');
console.log('   "createNeo4jDriver" is now tokenized as "Create Neo4j Driver"');
console.log('   This should help the embedding model match "neo4j" queries!');
console.log('='.repeat(80));
