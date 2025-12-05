# Three.js Agent Roadmap - HTML Ingestion & 3D Workflow

**Created**: 2025-12-05
**Status**: In Progress
**Author**: Lucie Defraiteur

---

## Objective

Enable the RagForge code agent to:
1. Generate 3D assets from text descriptions
2. Verify generated assets visually
3. Install npm packages (Three.js)
4. Create HTML/JS files to display 3D models
5. Ingest HTML files into the code graph with embeddings
6. Enable semantic search on HTML content

---

## Current State (2025-12-05)

### Working
- `generate_multiview_images` - Text → 4 coherent view images (~10s)
- `generate_3d_from_image` - Images → GLB via Trellis (~50s)
- `render_3d_asset` - GLB → PNG screenshots (Three.js headless)
- `read_file`, `write_file`, `edit_file` - File operations
- Real-time TypeScript ingestion with embeddings

### Missing
- `install_package` tool for npm install
- HTML file ingestion (WebDocument nodes)
- Embeddings for HTML/JS content
- Agent workflow orchestration for 3D + HTML

---

## Phase 1: Agent Tools Extension

### 1.1 Tool `install_package`

**Purpose**: Allow agent to install npm packages in the project

**Implementation**: `packages/core/src/tools/file-tools.ts`

```typescript
{
  name: 'install_package',
  description: 'Install an npm package in the project',
  inputSchema: {
    type: 'object',
    properties: {
      package_name: {
        type: 'string',
        description: 'Package name (e.g., "three", "lodash@4.17.21")'
      },
      dev: {
        type: 'boolean',
        description: 'Install as devDependency (default: false)'
      }
    },
    required: ['package_name']
  }
}
```

**Security Considerations**:
- Option 1: Whitelist of allowed packages
- Option 2: User confirmation before install
- Option 3: Trust agent (current approach for file tools)

**Handler**:
```typescript
async function installPackage(args: { package_name: string; dev?: boolean }) {
  const { execSync } = await import('child_process');
  const flag = args.dev ? '--save-dev' : '--save';
  execSync(`npm install ${flag} ${args.package_name}`, {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  return { installed: args.package_name, dev: args.dev ?? false };
}
```

### 1.2 Tool `run_command` (Optional, Phase 2)

**Purpose**: Run whitelisted npm scripts

**Whitelist**:
- `npm run build`
- `npm run dev`
- `npm test`
- `npx tsc --noEmit`

---

## Phase 2: Complete 3D Workflow Test

### 2.1 Target Workflow

```
User: "Create a rubber duck 3D model and display it in a Three.js viewer"

Agent executes:
1. generate_multiview_images("a cute yellow rubber duck toy")
   → temp/duck/front.png, right.png, top.png, perspective.png

2. generate_3d_from_image(["temp/duck/*.png"], "assets/duck.glb")
   → assets/duck.glb (1.2MB)

3. render_3d_asset("assets/duck.glb", "temp/duck-preview/")
   → Screenshots to verify quality

4. describe_image("temp/duck-preview/perspective.png")
   → Agent verifies: "Yellow rubber duck, looks correct"

5. install_package("three")
   → three added to package.json

6. write_file("public/index.html", <html with canvas>)
7. write_file("src/viewer.js", <Three.js code to load GLB>)

8. Agent: "Done! Open public/index.html to see your duck"
```

### 2.2 Test Script

Create `scripts/test-agent-threejs-workflow.ts`:
```typescript
const task = `
Create a 3D rubber duck and display it in a web page:
1. Generate multiview images of a cute yellow rubber duck
2. Create 3D model from those images
3. Take screenshots to verify the model looks good
4. Install three.js package
5. Create an HTML page with Three.js that loads and displays the duck
`;

const result = await agent.ask(task);
```

---

## Phase 3: HTML Parser & Ingestion

### 3.1 HTMLDocumentParser

**Location**: `packages/codeparsers/src/html/`

**Design**: See `HTML-PARSER-DESIGN.md`

**Key Points**:
- Use tree-sitter-html (already installed)
- Create `WebDocument` nodes (not `Document` - reserved for Tika)
- Extract `<script>` content → parse as TypeScript → create Scope nodes
- Relationship: `Scope -[:SCRIPT_OF]-> WebDocument`

**Files to Create**:
```
packages/codeparsers/src/html/
├── HTMLDocumentParser.ts     # Main parser
├── VueSFCParser.ts           # Vue single-file component support
├── types.ts                  # WebDocumentInfo, etc.
└── index.ts                  # Exports
```

**Interface**:
```typescript
interface WebDocumentInfo {
  uuid: string;
  file: string;
  type: 'html' | 'vue-sfc' | 'svelte';
  hash: string;
  hasScript: boolean;
  hasStyle: boolean;
  scriptLang?: 'js' | 'ts';
  title?: string;
  imports: string[];
}

interface HTMLParseResult {
  document: WebDocumentInfo;
  scopes: ScopeInfo[];        // From <script> tags
  relationships: Relationship[];
}
```

### 3.2 CodeSourceAdapter Updates

**Location**: `packages/core/src/runtime/adapters/code-source-adapter.ts`

**Changes**:
1. Detect `.html`, `.htm`, `.vue` files
2. Call HTMLDocumentParser instead of TypeScript parser
3. Create WebDocument nodes
4. Create Scope nodes for scripts
5. Create SCRIPT_OF relationships

```typescript
// In processFile()
if (file.endsWith('.html') || file.endsWith('.vue')) {
  const result = await htmlParser.parseFile(filePath, content);
  await this.createWebDocumentNode(result.document);
  for (const scope of result.scopes) {
    await this.createScopeNode(scope);
    await this.createRelationship('SCRIPT_OF', scope.uuid, result.document.uuid);
  }
}
```

### 3.3 Neo4j Schema Update

**New Node**: WebDocument
```cypher
CREATE CONSTRAINT webdocument_uuid IF NOT EXISTS
FOR (d:WebDocument) REQUIRE d.uuid IS UNIQUE;

CREATE INDEX webdocument_file IF NOT EXISTS
FOR (d:WebDocument) ON (d.file);
```

**New Relationship**: SCRIPT_OF
```cypher
// Scope defined in WebDocument
(s:Scope)-[:SCRIPT_OF]->(d:WebDocument)
```

---

## Phase 4: Embeddings for HTML

### 4.1 WebDocument Embeddings

**Strategy**: Generate embeddings from script content

```typescript
// In embedding generation
for (const doc of webDocuments) {
  // Get all scopes from this document
  const scopes = await getScriptsOf(doc.uuid);

  // Concatenate script content
  const content = scopes.map(s => s.content).join('\n');

  // Generate embedding
  const embedding = await generateEmbedding(content);

  // Store on WebDocument
  await updateWebDocument(doc.uuid, { embedding });
}
```

### 4.2 Semantic Search Updates

**Location**: `packages/core/src/tools/tool-generator.ts`

**Changes**:
- Include WebDocument in vector search
- Return both Scope and WebDocument results

```typescript
// In semantic_search handler
const results = await client.run(`
  CALL db.index.vector.queryNodes('scope_embeddings', $topK, $queryVector)
  YIELD node, score
  RETURN node, score, labels(node)[0] as entityType
  UNION
  CALL db.index.vector.queryNodes('webdocument_embeddings', $topK, $queryVector)
  YIELD node, score
  RETURN node, score, labels(node)[0] as entityType
  ORDER BY score DESC
  LIMIT $topK
`);
```

---

## Phase 5: Testing & Validation

### 5.1 HTML Ingestion Test

```bash
# 1. Create HTML file with agent
npx tsx scripts/test-agent.ts "Create a simple HTML page with a button that logs 'clicked'"

# 2. Verify ingestion
npx tsx -e "
const rag = createRagClient();
const docs = await rag.client.run('MATCH (d:WebDocument) RETURN d.file, d.hasScript');
console.log(docs.records);
"

# 3. Verify scopes extracted
npx tsx -e "
const rag = createRagClient();
const scopes = await rag.client.run('
  MATCH (s:Scope)-[:SCRIPT_OF]->(d:WebDocument)
  RETURN s.name, s.type, d.file
');
console.log(scopes.records);
"
```

### 5.2 Semantic Search on HTML

```bash
npx tsx scripts/test-agent.ts "Find code related to button click handlers"
# Should find both TypeScript and HTML/JS results
```

### 5.3 Full Workflow Test

```bash
npx tsx scripts/test-agent-threejs-workflow.ts
# Verifies:
# - 3D generation works
# - Package installation works
# - HTML creation works
# - HTML ingestion works
# - Semantic search finds the Three.js code
```

---

## Implementation Order

| # | Task | Complexity | Depends On | Status |
|---|------|------------|------------|--------|
| 1 | Tool `install_package` | Low | - | Pending |
| 2 | Test agent 3D workflow (manual) | Low | 1 | Pending |
| 3 | HTMLDocumentParser (basic) | Medium | - | Pending |
| 4 | CodeSourceAdapter HTML support | Medium | 3 | Pending |
| 5 | WebDocument embeddings | Low | 4 | Pending |
| 6 | Semantic search WebDocument | Low | 5 | Pending |
| 7 | Full workflow test script | Low | 1-6 | Pending |

---

## Files to Modify/Create

### New Files
- `packages/codeparsers/src/html/HTMLDocumentParser.ts`
- `packages/codeparsers/src/html/types.ts`
- `packages/codeparsers/src/html/index.ts`
- `examples/test-project/.ragforge/generated/scripts/test-agent-threejs-workflow.ts`

### Modified Files
- `packages/core/src/tools/file-tools.ts` - Add install_package
- `packages/core/src/runtime/adapters/code-source-adapter.ts` - HTML support
- `packages/core/src/tools/tool-generator.ts` - WebDocument in semantic search
- `packages/codeparsers/src/index.ts` - Export HTML parser

---

## Success Criteria

1. Agent can generate a 3D model from text description
2. Agent can verify the model looks correct via screenshots
3. Agent can install Three.js in the project
4. Agent can create HTML/JS files that display the 3D model
5. HTML files are automatically ingested into Neo4j
6. Semantic search finds code in both TypeScript and HTML files
7. Full workflow completes in < 3 minutes

---

## Related Documents

- [HTML-PARSER-DESIGN.md](./HTML-PARSER-DESIGN.md) - Detailed HTML parser design
- [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) - Image and 3D tools documentation
- [AGENT-TESTING.md](./AGENT-TESTING.md) - Agent testing guide
- [CURRENT-STATUS.md](./CURRENT-STATUS.md) - Current project state
