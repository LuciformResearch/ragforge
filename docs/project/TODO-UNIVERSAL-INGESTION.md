# TODO: Universal File Ingestion & Agent Capabilities

**Last Updated**: 2025-12-07
**Status**: In Progress
**Author**: Lucie Defraiteur

---

## Current State

### ✅ Completed

1. **Code Parsers** (via @luciformresearch/codeparsers)
   - TypeScript, Python, HTML, CSS, SCSS
   - Vue SFC, Svelte components
   - Markdown with code blocks
   - Generic code files

2. **Data File Parser** (`data-file-parser.ts`)
   - JSON, YAML, XML, TOML, ENV
   - Extracts sections, references, external URLs

3. **Media File Parser** (`media-file-parser.ts`)
   - Images: PNG, JPG, GIF, WebP, SVG (dimensions extracted)
   - 3D: GLB/GLTF (mesh count, materials from JSON header)
   - Lazy loading for Gemini Vision analysis

4. **Document File Parser** (`document-file-parser.ts`) - NEW
   - PDF with text → `pdf2json` (direct extraction)
   - PDF image-only → `pdf-to-img` + `tesseract.js` (OCR)
   - DOCX → `mammoth` (text + HTML)
   - XLSX/XLS/CSV → `xlsx` (sheets, headers, data)
   - Low OCR confidence → `needsGeminiVision: true` (lazy)

5. **Graph Nodes** (type errors fixed)
   - `VueSFC`, `SvelteComponent`, `Stylesheet`
   - `MarkupDocument`, `CodeBlock`, `GenericFile`
   - `DataFile`, `DataSection`, `ExternalURL`, `ExternalLibrary`
   - `MediaFile`, `ImageFile`, `ThreeDFile`, `DocumentFile`

6. **3D Generation**
   - `generate_3d_from_text` uses multiview + Trellis (~$0.11 vs ~$3)

---

## 🚧 In Progress

### Document Nodes Integration
- [ ] Add `DocumentFile` nodes to graph
- [ ] Add `needsGeminiVision` property for lazy OCR
- [ ] Create `extract_document_text` tool for on-demand Gemini Vision

---

## 📋 Planned Features

### Phase 1: Complete Document Support

1. **Gemini Vision OCR (Lazy Loading)**
   - Only called when agent requests content AND `needsGeminiVision: true`
   - Costs money, so agent decides what's worth analyzing
   - Tool: `extract_document_text_with_vision`

2. **Image OCR for Images with Text**
   - Tesseract first (free)
   - If confidence < 60% → mark `needsGeminiVision: true`
   - Agent can request Gemini Vision analysis

### Phase 2: Agent Media Creation Tools

1. **Image Modification** 🎨 (via Gemini)
   - Model: `gemini-2.5-flash-image` (~$0.039/image)
   - Edit images with text prompts
   - Capabilities:
     - Change background, replace/add objects
     - Style transfer between images
     - Blend multiple images
     - Character consistency (faces, pets)
   - Tool: `edit_image`
   - Advanced: `gemini-3-pro-image-preview` for 4K output

2. **Music Generation** 🎵
   - Generate music from text descriptions
   - Backends:
     - `MusicGen` via Replicate (~$0.05/generation)
     - `Lyria 2` via Replicate (Google's new model)
   - Tool: `generate_music_from_text`
   - Output: MP3/WAV stored in project

3. **PDF Creation** 📄
   - Agent can create PDFs from content
   - Use Playwright to render HTML → PDF
   - Tool: `create_pdf_from_html`
   - Supports: text, images, tables, styling

### Phase 3: Web Integration (Ephemeral Data)

1. **Web Search & Ingestion** 🔍
   - Agent can search the web
   - Results ingested as structured data
   - **Time-limited**: Auto-expires after configurable duration
   - Node: `WebSearchResult` with `expiresAt` property
   - Tool: `search_web_and_ingest`

2. **Web Page Content Download** 🌐
   - Render page with Playwright (handles JS)
   - Extract: text, images, metadata
   - Ingest as `WebDocument` node
   - **Time-limited**: Auto-expires (default 24h?)
   - Tool: `fetch_web_page`
   - Handles: SPAs, dynamic content, auth walls (with cookies)

### Phase 4: Ephemeral Data Management

1. **TTL (Time-To-Live) System**
   ```typescript
   interface EphemeralNode {
     expiresAt: Date;
     source: 'web-search' | 'web-page' | 'api-response';
     refreshable: boolean;
   }
   ```

2. **Cleanup Job**
   - Background process removes expired nodes
   - Runs every N minutes
   - Cypher: `MATCH (n) WHERE n.expiresAt < datetime() DETACH DELETE n`

3. **Refresh Mechanism**
   - Agent can refresh ephemeral data before expiry
   - Updates `expiresAt` timestamp

---

## Node Types Summary

### Permanent Nodes (from codebase)
| Node | Source | Parser |
|------|--------|--------|
| `File`, `Directory`, `Project` | filesystem | built-in |
| `Scope` | code files | codeparsers |
| `VueSFC`, `SvelteComponent` | .vue, .svelte | codeparsers |
| `Stylesheet` | .css, .scss | codeparsers |
| `MarkupDocument`, `CodeBlock` | .md | codeparsers |
| `DataFile`, `DataSection` | .json, .yaml, etc | data-file-parser |
| `MediaFile`, `ImageFile`, `ThreeDFile` | images, 3D | media-file-parser |
| `DocumentFile` | .pdf, .docx, .xlsx | document-file-parser |
| `ExternalURL`, `ExternalLibrary` | references | parsers |

### Ephemeral Nodes (from web, time-limited)
| Node | Source | TTL |
|------|--------|-----|
| `WebSearchResult` | web search | configurable |
| `WebDocument` | Playwright fetch | 24h default |
| `APIResponse` | external APIs | configurable |

---

## Cost Estimates

| Operation | Cost | When |
|-----------|------|------|
| Tesseract OCR | Free | Always (image-only PDFs) |
| Gemini Vision OCR | ~$0.01/page | On-demand (low confidence) |
| Image Analysis | ~$0.01/image | On-demand |
| 3D from Text | ~$0.11 | On-demand |
| Music Generation | ~$0.05 | On-demand |
| Web Search | Depends on API | On-demand |

---

## Dependencies

### Installed
```json
{
  "pdf2json": "PDF text extraction",
  "pdf-to-img": "PDF to images for OCR",
  "tesseract.js": "Free OCR",
  "mammoth": "DOCX parsing",
  "xlsx": "Spreadsheet parsing"
}
```

### To Install
```json
{
  "sharp": "Image manipulation (Phase 2)",
  "replicate": "MusicGen/Lyria access (Phase 2)",
  "playwright": "Web rendering, PDF creation (Phase 2-3)"
}
```

---

## Related Documents

- [UNIVERSAL-FILE-INGESTION.md](./UNIVERSAL-FILE-INGESTION.md) - File type overview
- [CROSS-FILE-RELATIONSHIPS.md](./CROSS-FILE-RELATIONSHIPS.md) - Graph relationships
- [INCREMENTAL-INGESTION.md](./INCREMENTAL-INGESTION.md) - Update mechanics
- [MEDIA-TOOLS.md](./MEDIA-TOOLS.md) - Media generation tools

---

## Testing Checklist

### Document Parser
- [x] PDF with text → direct extraction
- [x] PDF image-only → Tesseract OCR (92% confidence)
- [x] DOCX → text + HTML extraction
- [x] XLSX → sheets + headers + data
- [x] Gemini Vision fallback → lazy loading flag

### Next Tests
- [ ] Build & verify no TypeScript errors
- [ ] Ingest project with mixed file types
- [ ] Query new node types in Neo4j
- [ ] Test Gemini Vision on-demand extraction

---

## 🌐 Web/Browser Support

### Code Parsers in Browser (web-tree-sitter)

**Problem**: `@luciformresearch/codeparsers` uses native tree-sitter (Node.js).
For browser, need `web-tree-sitter` with WASM files.

**Solution**: Use `web-tree-sitter` with Playwright for testing.

```typescript
import Parser from "web-tree-sitter";

async function init() {
  await Parser.init({
    locateFile: file => `/public/${file}` // runtime.wasm
  });

  const parser = new Parser();
  const Lang = await Parser.Language.load("/public/tree-sitter-typescript.wasm");
  parser.setLanguage(Lang);

  const tree = parser.parse(`function hello() { return 42 }`);
  console.log(tree.rootNode.toString());
}
```

**Required WASM files** (serve from `/public/`):
- `tree-sitter.wasm` (runtime)
- `tree-sitter-typescript.wasm`
- `tree-sitter-python.wasm`
- `tree-sitter-html.wasm`
- etc.

**Architecture Options**:

1. **Unified library** (harder)
   - Single `@luciformresearch/codeparsers` that detects environment
   - Uses native tree-sitter in Node, web-tree-sitter in browser
   - Complex to maintain

2. **Separate packages** (recommended if #1 is too hard)
   - `@luciformresearch/codeparsers` → Node.js only (current)
   - `@luciformresearch/codeparsers-web` → Browser with WASM
   - Shared types/interfaces between both

**Testing with Playwright**:
```typescript
// playwright.config.ts
export default {
  webServer: {
    command: 'npm run serve-wasm',
    port: 3000,
  },
};

// Serve WASM files with correct MIME type
// Content-Type: application/wasm
```

**Status**: Not started - needs investigation
