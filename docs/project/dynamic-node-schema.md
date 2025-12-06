# Dynamic Node Schema Architecture

**Date**: 2025-12-06
**Status**: Implemented
**Related files**:
- `packages/core/src/utils/node-schema.ts` (NEW - utilities)
- `packages/core/src/runtime/adapters/code-source-adapter.ts`
- `packages/cli/src/commands/quickstart.ts`
- `packages/core/src/runtime/adapters/incremental-ingestion.ts`

---

## Problem Statement

When adding new node types (e.g., Stylesheet, CSSVariable, Markdown, etc.), we currently need to modify **3 separate files**:

1. **code-source-adapter.ts** - Add parsing logic and node/relationship creation in `buildGraph()`
2. **quickstart.ts** - Add constraints, batch creation, `getNodeType()`, `getNodeInfo()`
3. **incremental-ingestion.ts** - Add to `structuralNodes` array

This is:
- **Fragile**: Easy to forget one file
- **Repetitive**: Same patterns repeated for each type
- **Error-prone**: Inconsistencies between files cause silent failures (e.g., relationships not created because node type not handled)

---

## Current Architecture

### Node ID Prefixes (conventions)

| Node Type | ID Prefix | Unique Field | Example ID |
|-----------|-----------|--------------|------------|
| Scope | (none) | uuid | `A1B2C3D4-...` |
| File | `file:` | path | `file:src/index.ts` |
| Directory | `dir:` | path | `dir:src/components` |
| Project | `project:` | name | `project:my-app` |
| ExternalLibrary | `lib:` | name | `lib:lodash` |
| PackageJson | `pkg:` | uuid | `pkg:A1B2C3D4-...` |
| WebDocument | `webdoc:` | uuid | `webdoc:A1B2C3D4-...` |
| Stylesheet | `stylesheet:` | uuid | `stylesheet:A1B2C3D4-...` |
| CSSVariable | `cssvar:` | uuid | `cssvar:A1B2C3D4:--primary` |

### Current Hardcoded Logic

**quickstart.ts**:
```typescript
// Hardcoded filtering
const scopeNodes = graph.nodes.filter(n => n.labels.includes('Scope'));
const fileNodes = graph.nodes.filter(n => n.labels.includes('File'));
const stylesheetNodes = graph.nodes.filter(n => n.labels.includes('Stylesheet'));
// ... repeat for each type

// Hardcoded type detection
const getNodeType = (id: string): string => {
  if (id.startsWith('file:')) return 'file';
  if (id.startsWith('stylesheet:')) return 'stylesheet';
  // ... repeat for each type
  return 'scope';
};

// Hardcoded node info
const getNodeInfo = (type: string): { label: string; key: string } => {
  switch (type) {
    case 'file': return { label: 'File', key: 'path' };
    case 'stylesheet': return { label: 'Stylesheet', key: 'uuid' };
    // ... repeat for each type
  }
};
```

**incremental-ingestion.ts**:
```typescript
// Hardcoded structural nodes list
const projectNodes = nodes.filter(n => n.labels.includes('Project'));
const stylesheetNodes = nodes.filter(n => n.labels.includes('Stylesheet'));
// ... repeat for each type
const structuralNodes = [...projectNodes, ...stylesheetNodes, ...];
```

---

## Proposed Solution: Dynamic Node Schema

### Core Principle

Instead of hardcoding each node type, **infer everything from the parsed nodes**:
- Labels come from `node.labels[0]`
- Unique field is inferred from the ID prefix pattern
- Constraints are created dynamically

### Implementation

#### 1. Utility Functions (shared)

Create `packages/core/src/utils/node-schema.ts`:

```typescript
/**
 * Node Schema Utilities
 *
 * Dynamically handles node types without hardcoding.
 */

// Known prefix patterns and their unique fields
const PREFIX_PATTERNS: Record<string, { uniqueField: string; stripPrefix: boolean }> = {
  'file:': { uniqueField: 'path', stripPrefix: true },
  'dir:': { uniqueField: 'path', stripPrefix: true },
  'lib:': { uniqueField: 'name', stripPrefix: true },
  'project:': { uniqueField: 'name', stripPrefix: true },
  // All other prefixes use uuid and keep the full ID
};

/**
 * Infer node type info from an ID
 */
export function getNodeTypeFromId(id: string): {
  prefix: string;
  uniqueField: string;
  matchValue: string;
} {
  for (const [prefix, config] of Object.entries(PREFIX_PATTERNS)) {
    if (id.startsWith(prefix)) {
      return {
        prefix,
        uniqueField: config.uniqueField,
        matchValue: config.stripPrefix ? id.slice(prefix.length) : id
      };
    }
  }
  // Default: uuid-based with full ID
  return { prefix: '', uniqueField: 'uuid', matchValue: id };
}

/**
 * Group nodes by their label
 */
export function groupNodesByLabel(nodes: ParsedNode[]): Map<string, ParsedNode[]> {
  const byLabel = new Map<string, ParsedNode[]>();
  for (const node of nodes) {
    const label = node.labels[0];
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(node);
  }
  return byLabel;
}

/**
 * Infer unique field for a node based on its ID
 */
export function inferUniqueField(node: ParsedNode): string {
  return getNodeTypeFromId(node.id).uniqueField;
}

/**
 * Check if a node type is "structural" (non-Scope)
 */
export function isStructuralNode(node: ParsedNode): boolean {
  return !node.labels.includes('Scope');
}
```

#### 2. Updated quickstart.ts

```typescript
import { groupNodesByLabel, getNodeTypeFromId } from '@luciformresearch/ragforge';

// Dynamic constraint creation
const nodesByLabel = groupNodesByLabel(graph.nodes);

for (const [label, nodes] of nodesByLabel) {
  if (nodes.length === 0) continue;

  const uniqueField = inferUniqueField(nodes[0]);
  const constraintName = `${label.toLowerCase()}_${uniqueField}`;

  await client.run(
    `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${uniqueField} IS UNIQUE`
  );
}

// Dynamic node creation
for (const [label, nodes] of nodesByLabel) {
  if (nodes.length === 0) continue;

  const uniqueField = inferUniqueField(nodes[0]);
  const uniqueValue = uniqueField === 'path' ? 'node.path' : 'node.uuid';

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    await client.run(
      `UNWIND $nodes AS node
       MERGE (n:${label} {${uniqueField}: ${uniqueValue}})
       SET n += node`,
      { nodes: batch.map(n => n.properties) }
    );
  }
}

// Dynamic relationship creation
for (const rel of graph.relationships) {
  const fromInfo = getNodeTypeFromId(rel.from);
  const toInfo = getNodeTypeFromId(rel.to);
  // Use fromInfo.matchValue and toInfo.matchValue for MATCH
}
```

#### 3. Updated incremental-ingestion.ts

```typescript
import { isStructuralNode } from '@luciformresearch/ragforge';

// Dynamic structural nodes detection
const structuralNodes = nodes.filter(isStructuralNode);
const scopeNodes = nodes.filter(n => n.labels.includes('Scope'));

// Rest of the logic stays the same
```

---

## Benefits

1. **Adding a new type requires only 1 file change**: `code-source-adapter.ts`
2. **No more forgotten updates**: quickstart and incremental-ingestion auto-adapt
3. **Consistent behavior**: Same logic everywhere
4. **Extensible**: New types "just work" if they follow the prefix convention

---

## Migration Plan

### Phase 1: Create utilities ✅
- [x] Create `packages/core/src/utils/node-schema.ts`
- [x] Export from package index
- [ ] Add unit tests (optional)

### Phase 2: Update quickstart.ts ✅
- [x] Replace hardcoded constraint creation with dynamic
- [x] Replace hardcoded batch creation with dynamic
- [x] Replace getNodeType/getNodeInfo with utility functions
- [x] Test with existing types

### Phase 3: Update incremental-ingestion.ts ✅
- [x] Replace hardcoded structuralNodes with `isStructuralNode` filter
- [x] Test incremental behavior

### Phase 4: Cleanup ✅
- [x] Remove any remaining hardcoded type lists
- [x] Update documentation
- [ ] Add new type (e.g., Markdown) to verify it "just works"

---

## Edge Cases to Handle

1. **Scope nodes**: Special case - not structural, tracked for embeddings
2. **File/Directory**: Use `path` as unique field, strip prefix for matching
3. **ExternalLibrary/Project**: Use `name` as unique field, strip prefix
4. **All others**: Use `uuid` as unique field, keep full prefixed ID

---

## Future Considerations

### Type-specific indexes

Some types may need additional indexes beyond the unique constraint:

```typescript
const TYPE_INDEXES: Record<string, string[]> = {
  Scope: ['name', 'type', 'file'],
  Stylesheet: ['file'],
  // ...
};
```

### Parser version tracking

For intelligent re-parsing when parser changes:

```cypher
(:ParserMetadata {
  nodeType: 'Stylesheet',
  parserVersion: '1.0.0',
  lastFullParse: timestamp()
})
```

When parser version changes for a type, trigger full re-parse for that type only.

---

## Related Documentation

- `docs/context-regen/2025-12-06-10h55.md` - Current node types and relationships
- `packages/core/src/runtime/adapters/code-source-adapter.ts` - Main parsing logic
