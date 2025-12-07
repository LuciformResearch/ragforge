# Cross-File Relationships

**Last Updated**: 2025-12-06
**Status**: Planning
**Author**: Lucie Defraiteur

---

## Overview

RagForge creates a rich graph of relationships between files, not just within files. This allows the agent to understand how files reference each other and navigate the project semantically.

---

## Relationship Types

### Code Files → Code Files

Already implemented via `CONSUMES` and `IMPORTS`:

```
(Scope)-[:CONSUMES]->(Scope)        // function calls another function
(Scope)-[:IMPORTS]->(Scope)         // import { foo } from './bar'
(Scope)-[:INHERITS_FROM]->(Scope)   // class extends
(Scope)-[:IMPLEMENTS]->(Scope)      // class implements interface
```

### HTML/Vue/Svelte → Assets

```
(WebDocument)-[:IMPORTS_STYLE]->(Stylesheet)       // <link href="style.css">
(WebDocument)-[:IMPORTS_SCRIPT]->(File)            // <script src="app.ts">
(WebDocument)-[:REFERENCES_IMAGE]->(MediaFile)     // <img src="logo.png">
(WebDocument)-[:LINKS_TO]->(ExternalURL)           // <a href="https://...">

(VueSFC)-[:IMPORTS_STYLE]->(Stylesheet)            // <style src="./styles.scss">
(VueSFC)-[:IMPORTS]->(VueSFC | Scope)              // import Component from './Comp.vue'
(VueSFC)-[:USES_COMPONENT]->(VueSFC)               // <MyComponent /> in template

(SvelteComponent)-[:IMPORTS_STYLE]->(Stylesheet)
(SvelteComponent)-[:IMPORTS]->(SvelteComponent | Scope)
(SvelteComponent)-[:USES_COMPONENT]->(SvelteComponent)
```

### Markdown → References

```
(MarkupDocument)-[:LINKS_TO]->(File | ExternalURL)     // [link](./doc.md) or [link](https://...)
(MarkupDocument)-[:REFERENCES_IMAGE]->(MediaFile)      // ![alt](image.png)
(MarkupDocument)-[:CONTAINS_CODE]->(CodeBlock)         // ```typescript ... ```

// CodeBlock can reference actual code
(CodeBlock)-[:EXAMPLE_OF]->(Scope)                     // code block shows usage of a function
```

### Data Files → Files

```
(DataFile)-[:REFERENCES]->(File)              // tsconfig.json → "./src/index.ts"
(DataFile)-[:REFERENCES]->(Directory)         // webpack.config → "./dist"
(DataFile)-[:REFERENCES]->(MediaFile)         // config.yaml → "./assets/logo.png"
(DataFile)-[:REFERENCES]->(DataFile)          // extends: "./base.tsconfig.json"
(DataFile)-[:USES_PACKAGE]->(ExternalLibrary) // dependencies in package.json (already done)
(DataFile)-[:CONFIGURES]->(File)              // tsconfig.json configures *.ts files
```

### Stylesheets → Assets

```
(Stylesheet)-[:IMPORTS]->(Stylesheet)         // @import './variables.scss'
(Stylesheet)-[:REFERENCES_IMAGE]->(MediaFile) // background: url('./bg.png')
(Stylesheet)-[:USES_FONT]->(ExternalURL)      // @font-face src url()
```

---

## Node Types for External References

### ExternalURL

For links to external websites:

```typescript
{
  labels: ['ExternalURL'],
  properties: {
    uuid: string,
    url: string,           // "https://example.com/docs"
    domain: string,        // "example.com"
    referencedBy: number,  // count of files referencing this URL
  }
}
```

### MediaFile

For images, 3D models, PDFs (lazy loading):

```typescript
{
  labels: ['MediaFile'],
  properties: {
    uuid: string,
    file: string,
    format: 'png' | 'jpg' | 'svg' | 'glb' | 'gltf' | 'pdf' | ...,
    category: 'image' | '3d' | 'document',
    sizeBytes: number,
    // Image-specific
    width?: number,
    height?: number,
    // 3D-specific
    meshCount?: number,
    materialCount?: number,
    // Analysis done on-demand (lazy loading)
    analyzed: boolean,
  }
}
```

### DataFile

For JSON, YAML, XML, TOML, ENV files:

```typescript
{
  labels: ['DataFile'],
  properties: {
    uuid: string,
    file: string,
    format: 'json' | 'yaml' | 'xml' | 'toml' | 'env',
    hash: string,
    linesOfCode: number,
    sectionCount: number,
    referenceCount: number,
  }
}
```

### DataSection

For nested sections in data files:

```typescript
{
  labels: ['DataSection'],
  properties: {
    uuid: string,
    path: string,          // "compilerOptions.paths"
    key: string,           // "paths"
    content: string,       // serialized JSON
    depth: number,
    valueType: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null',
  }
}

// Relationships
(DataFile)-[:HAS_SECTION]->(DataSection)
(DataSection)-[:HAS_CHILD]->(DataSection)  // recursive
```

### CodeBlock (in Markdown)

For code blocks embedded in documentation:

```typescript
{
  labels: ['CodeBlock'],
  properties: {
    uuid: string,
    language: string,      // "typescript", "python", "bash", etc.
    content: string,       // the actual code
    line: number,
    index: number,         // position in document
  }
}

// Relationships
(MarkupDocument)-[:CONTAINS_CODE]->(CodeBlock)
(CodeBlock)-[:EXAMPLE_OF]->(Scope)  // if code references a known function/class
```

---

## Reference Detection

### In Data Files

The `data-file-parser.ts` detects references based on:

| Pattern | Type | Example |
|---------|------|---------|
| `./path` or `../path` | file/directory | `"./src/index.ts"` |
| `*.ts`, `*.js`, etc. | code | `"./utils.ts"` |
| `*.png`, `*.jpg`, etc. | image | `"./logo.png"` |
| `*.json`, `*.yaml`, etc. | config | `"./tsconfig.base.json"` |
| `https://...` | url | `"https://api.example.com"` |
| In dependencies context | package | `"lodash": "^4.0.0"` |

### In HTML/Vue/Svelte

Detected from:
- `<link href="...">` → stylesheet
- `<script src="...">` → script file
- `<img src="...">` → image
- `<a href="...">` → link (file or URL)
- `import ... from '...'` → module
- Component usage in template → component

### In Markdown

Detected from:
- `[text](url)` → link
- `![alt](url)` → image
- ` ```language ... ``` ` → code block

### In Stylesheets

Detected from:
- `@import '...'` → stylesheet
- `url('...')` → image/font
- `@font-face { src: url(...) }` → font

---

## Query Examples

### Find all files referencing a specific config

```cypher
MATCH (f)-[:REFERENCES]->(config:DataFile {file: 'tsconfig.json'})
RETURN f.file, type(f)
```

### Find all images used in the project

```cypher
MATCH (doc)-[:REFERENCES_IMAGE]->(img:MediaFile)
RETURN img.file, collect(doc.file) as usedBy
```

### Find external URLs by domain

```cypher
MATCH (f)-[:LINKS_TO]->(url:ExternalURL)
WHERE url.domain = 'github.com'
RETURN url.url, collect(f.file) as referencedFrom
```

### Find code examples in documentation

```cypher
MATCH (doc:MarkupDocument)-[:CONTAINS_CODE]->(block:CodeBlock)
WHERE block.language = 'typescript'
RETURN doc.file, block.content
```

### Find unused stylesheets

```cypher
MATCH (s:Stylesheet)
WHERE NOT ()-[:IMPORTS_STYLE]->(s)
RETURN s.file
```

### Find which Vue components use a specific component

```cypher
MATCH (parent:VueSFC)-[:USES_COMPONENT]->(child:VueSFC {componentName: 'Button'})
RETURN parent.file, parent.componentName
```

---

## Implementation Plan

### Phase 1: Data Files (Current)
- [x] Create `data-file-parser.ts`
- [x] Detect references in data files
- [ ] Create DataFile nodes
- [ ] Create DataSection nodes
- [ ] Create REFERENCES relationships

### Phase 2: Media Files
- [x] Create `media-file-parser.ts`
- [ ] Create MediaFile nodes (lazy loading)
- [ ] Link from HTML/Markdown/CSS

### Phase 3: External URLs
- [ ] Create ExternalURL nodes
- [ ] Deduplicate by URL
- [ ] Track domain for grouping

### Phase 4: Enhanced HTML/Vue/Svelte
- [ ] Parse `<link>`, `<script>`, `<img>`, `<a>` tags
- [ ] Create cross-file relationships
- [ ] Track component usage in templates

### Phase 5: Enhanced Markdown
- [ ] Link CodeBlocks to actual Scopes when possible
- [ ] Create EXAMPLE_OF relationships

### Phase 6: Stylesheet References
- [ ] Parse `@import` statements
- [ ] Parse `url()` references
- [ ] Link to MediaFile/ExternalURL

---

## Benefits for Agent

1. **Navigation**: "Find all files that reference this config"
2. **Impact Analysis**: "What would break if I rename this file?"
3. **Documentation**: "Show me examples of this function in the docs"
4. **Dependency Tracking**: "What external services does this project use?"
5. **Asset Management**: "Which images are actually used?"
6. **Refactoring**: "Find all imports of this module"

---

## Related Documents

- [UNIVERSAL-FILE-INGESTION.md](./UNIVERSAL-FILE-INGESTION.md) - File type support
- [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) - Media tools for lazy loading
