import { NODE_SCHEMAS, REL_SCHEMAS } from '../packages/core/dist/esm/utils/node-schema.js';

const nodeTypes = Object.keys(NODE_SCHEMAS);
console.log('Node types defined:', nodeTypes.length);
console.log('Node types:', nodeTypes.join(', '));
console.log('');

// Check all relationships for missing node types
const missing = new Set<string>();
for (const [relType, schemas] of Object.entries(REL_SCHEMAS)) {
  for (const rel of schemas as any[]) {
    if (!nodeTypes.includes(rel.from)) {
      missing.add(rel.from);
      console.log(`${relType}: Missing FROM '${rel.from}'`);
    }
    if (!nodeTypes.includes(rel.to)) {
      missing.add(rel.to);
      console.log(`${relType}: Missing TO '${rel.to}'`);
    }
  }
}

console.log('');
console.log('Missing node types:', Array.from(missing).join(', '));
