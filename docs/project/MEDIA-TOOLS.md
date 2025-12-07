# Media Tools - Images & 3D Assets

**Last Updated**: 2025-12-07
**Status**: ✅ Working
**Author**: Lucie Defraiteur

---

## Overview

RagForge provides media manipulation tools for the code agent, enabling it to:
1. **Read and analyze images** (OCR, visual description)
2. **Generate images** from text prompts (Gemini)
3. **Render 3D assets** to images (multiple views)
4. **Generate 3D models** from images (Trellis)

These tools are designed to help the agent work on visual/3D projects like Three.js applications.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CODE AGENT                               │
│                     (Working on Three.js project)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Uses tools to:                                              │
│  - Analyze existing assets (read_image, describe_image)     │
│  - Generate images (generate_image)                         │
│  - Preview 3D models (render_3d_asset)                       │
│  - Generate 3D from images (generate_3d_from_image)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   RAGFORGE MEDIA TOOLS                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  IMAGE TOOLS (ragforge-core)                                │
│  ├── read_image             - OCR text extraction           │
│  ├── describe_image         - Visual description (Gemini)   │
│  ├── list_images            - List image files              │
│  ├── generate_image         - Text → Image (Gemini)         │
│  └── generate_multiview_images - 4 coherent views for 3D   │
│                                                              │
│  3D TOOLS (ragforge-core)                                   │
│  ├── render_3d_asset       - Render model to images         │
│  └── generate_3d_from_image - Images → 3D (Trellis)        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      PROVIDERS                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Vision/OCR:                                                │
│  └── Gemini Vision (GEMINI_API_KEY)                         │
│                                                              │
│  Image Generation:                                          │
│  └── gemini-2.5-flash-image-preview (GEMINI_API_KEY)       │
│                                                              │
│  3D Generation:                                             │
│  └── firtoz/trellis (Images → 3D) - Replicate              │
│                                                              │
│  3D Rendering:                                              │
│  └── Three.js headless via Playwright (WebGL)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Image Tools

### read_image (OCR)

Extract text from images using AI vision models.

```typescript
{
  name: 'read_image',
  inputSchema: {
    path: string,      // Image file path
    provider?: 'gemini' | 'auto'
  }
}

// Example usage by agent
const result = await tools.read_image({
  path: 'screenshots/error-dialog.png'
});
// Returns: { text: "Error: Connection refused...", provider: "gemini" }
```

### describe_image

Get detailed visual description of an image.

```typescript
{
  name: 'describe_image',
  inputSchema: {
    path: string,      // Image file path
    prompt?: string    // Custom question about the image
  }
}

// Example
const result = await tools.describe_image({
  path: 'assets/character-model.png',
  prompt: 'What style is this character? Describe the colors and features.'
});
```

### list_images

List image files in a directory.

```typescript
{
  name: 'list_images',
  inputSchema: {
    path?: string,     // Directory (default: project root)
    recursive?: boolean,
    pattern?: string   // Glob pattern (e.g., "*.png")
  }
}
```

### generate_image

Generate an image from a text prompt using Gemini (`gemini-2.5-flash-image-preview`).

```typescript
{
  name: 'generate_image',
  inputSchema: {
    prompt: string,       // Text description
    output_path: string,  // Where to save PNG
    aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  }
}

// Example
const result = await tools.generate_image({
  prompt: 'A cute robot mascot, 3D render style, white background',
  output_path: 'assets/robot-mascot.png'
});
// Returns: { output_path: "assets/robot-mascot.png", processing_time_ms: 3500 }
```

### generate_multiview_images ✨ NEW

Generate 4 coherent view images from a text description, optimized for 3D reconstruction.

Uses a **prompt enhancer** (`gemini-2.0-flash` + `StructuredLLMExecutor`) to generate consistent prompts for all 4 views, then generates images with `gemini-2.5-flash-image-preview`.

```typescript
{
  name: 'generate_multiview_images',
  inputSchema: {
    prompt: string,       // Object description
    output_dir: string,   // Directory for 4 images
    style?: '3d_render' | 'realistic' | 'cartoon' | 'lowpoly'
  }
}

// Example
const result = await tools.generate_multiview_images({
  prompt: 'A yellow rubber duck toy',
  output_dir: 'temp/duck-views',
  style: '3d_render'
});
// Returns: {
//   images: [
//     { view: 'front', path: 'temp/duck-views/front.png' },
//     { view: 'right', path: 'temp/duck-views/right.png' },
//     { view: 'top', path: 'temp/duck-views/top.png' },
//     { view: 'perspective', path: 'temp/duck-views/perspective.png' }
//   ],
//   view_prompts: { front: "...", right: "...", ... }
// }
```

**How it works:**
1. Prompt enhancer analyzes your description and creates a canonical object description
2. Generates 4 view-specific prompts with consistent style, colors, and details
3. Generates all 4 images in parallel

---

## 3D Tools

### render_3d_asset

Render a 3D model to images from multiple viewpoints using Three.js.

```typescript
{
  name: 'render_3d_asset',
  inputSchema: {
    model_path: string,  // Path to .glb, .gltf
    output_dir: string,  // Where to save rendered images
    views?: string[],    // ['front', 'back', 'left', 'right', 'top', 'bottom', 'perspective']
    width?: number,      // Image width (default: 1024)
    height?: number,     // Image height (default: 1024)
    background?: string  // Background color (default: '#333333')
  }
}

// Example
const result = await tools.render_3d_asset({
  model_path: 'assets/models/character.glb',
  output_dir: 'renders/',
  views: ['front', 'left', 'perspective'],
  width: 512,
  height: 512
});
// Returns: {
//   renders: [
//     { view: 'front', path: 'renders/character_front.png' },
//     { view: 'left', path: 'renders/character_left.png' },
//     { view: 'perspective', path: 'renders/character_perspective.png' }
//   ]
// }
```

**Supported formats:**
- `.glb` / `.gltf` (recommended)

**View presets:**
| View | Camera Position | Description |
|------|-----------------|-------------|
| front | (0, 0, z) | Front face |
| back | (0, 0, -z) | Back face |
| left | (-x, 0, 0) | Left side |
| right | (x, 0, 0) | Right side |
| top | (0, y, 0) | Top-down |
| bottom | (0, -y, 0) | Bottom-up |
| perspective | (x, y, z) | 3/4 view |

### generate_3d_from_image

Generate a 3D model from reference image(s) using Trellis (Replicate).

```typescript
{
  name: 'generate_3d_from_image',
  inputSchema: {
    image_paths: string | string[],  // Single image or multiple views
    output_path: string,             // Where to save .glb
  }
}

// Example with single image
const result = await tools.generate_3d_from_image({
  image_paths: 'references/spaceship-concept.png',
  output_path: 'assets/models/spaceship.glb',
});

// Example with multiple views (better quality!)
const result = await tools.generate_3d_from_image({
  image_paths: [
    'renders/model_front.png',
    'renders/model_right.png',
    'renders/model_top.png',
    'renders/model_perspective.png'
  ],
  output_path: 'assets/models/reconstructed.glb',
});
// Returns: { model_path: '...', processing_time_ms: 110000 }
```

**Provider:** `firtoz/trellis` on Replicate
- High-quality image-to-3D reconstruction
- Best results with multiple views (front, side, top, perspective)
- Supports PBR textures
- ~2 minutes processing time

---

## Text-to-3D Workflow

### Recommended: Use `generate_multiview_images` + `generate_3d_from_image`

This is the **recommended workflow** (~$0.11 total cost):

```typescript
// Step 1: Generate 4 coherent views with prompt enhancer
const views = await tools.generate_multiview_images({
  prompt: 'A yellow rubber duck toy',
  output_dir: 'temp/duck-views',
  style: '3d_render'
});

// Step 2: Convert to 3D with Trellis
const model = await tools.generate_3d_from_image({
  image_paths: [
    'temp/duck-views/front.png',
    'temp/duck-views/right.png',
    'temp/duck-views/top.png',
    'temp/duck-views/perspective.png'
  ],
  output_path: 'assets/models/duck.glb'
});
```

### `generate_3d_from_text` (refactored ✅)

> **Now uses multiview + Trellis internally** (~$0.11 vs ~$3 for old MVDream)

This tool now automatically:
1. Calls `generate_multiview_images` to create 4 coherent views
2. Calls `generate_3d_from_image` to convert to GLB

```typescript
// Simple one-step API
const result = await tools.generate_3d_from_text({
  prompt: 'A yellow rubber duck toy',
  output_path: 'assets/models/duck.glb',
  style: '3d_render'  // or 'realistic', 'cartoon', 'lowpoly'
});
// Processing time: ~3-4 minutes
// Cost: ~$0.11
```

### Manual Workflow (alternative)

If you need more control, you can manually generate views:

```typescript
// Generate front view
await tools.generate_image({
  prompt: 'A yellow rubber duck toy, front view, white background, 3D render style',
  output_path: 'temp/duck_front.png'
});

// Generate side view
await tools.generate_image({
  prompt: 'A yellow rubber duck toy, side view from right, white background, 3D render style',
  output_path: 'temp/duck_right.png'
});

// Generate top view
await tools.generate_image({
  prompt: 'A yellow rubber duck toy, top-down view, white background, 3D render style',
  output_path: 'temp/duck_top.png'
});

// Then reconstruct with Trellis
const result = await tools.generate_3d_from_image({
  image_paths: ['temp/duck_front.png', 'temp/duck_right.png', 'temp/duck_top.png'],
  output_path: 'assets/models/duck.glb'
});
```

> **Tip:** Use `generate_multiview_images` instead - it uses a prompt enhancer to ensure all views are consistent in style, colors, and proportions.

---

## Implementation Status

| Tool | Status | Provider |
|------|--------|----------|
| read_image | ✅ Done | Gemini Vision |
| describe_image | ✅ Done | Gemini Vision |
| list_images | ✅ Done | Local |
| generate_image | ✅ Done | `gemini-2.5-flash-image-preview` |
| generate_multiview_images | ✅ Done | `gemini-2.0-flash` (enhancer) + `gemini-2.5-flash-image-preview` |
| render_3d_asset | ✅ Done | Three.js/Playwright |
| generate_3d_from_image | ✅ Done | Replicate/Trellis |
| generate_3d_from_text | ✅ Refactored | multiview + Trellis (~$0.11) |

---

## Environment Variables

```bash
# Required for all image tools
GEMINI_API_KEY=your-gemini-key

# Required for 3D generation (Trellis)
REPLICATE_API_TOKEN=your-replicate-token
```

---

## Enabling Media Tools in Agent

```typescript
const agent = await createRagAgent({
  configPath: './ragforge.config.yaml',
  ragClient: rag,
  apiKey: process.env.GEMINI_API_KEY,

  // Enable media tools
  includeMediaTools: true,
  projectRoot: '/path/to/project',
});

// Agent now has access to:
// - read_image, describe_image, list_images, generate_image, generate_multiview_images
// - render_3d_asset, generate_3d_from_image
```

---

## Cost Considerations

| Tool | Cost | Notes |
|------|------|-------|
| generate_image | ~$0.002/image | `gemini-2.5-flash-image-preview` |
| generate_multiview_images | ~$0.01/call | 4 images + prompt enhancer |
| generate_3d_from_image | ~$0.10/run | Trellis on Replicate |
| generate_3d_from_text | ~$0.11/model | Uses multiview + Trellis internally |
| render_3d_asset | Free | Local Three.js |
| read_image / describe_image | ~$0.001/call | Gemini Vision |

### Text-to-3D Options

| Method | Cost | Notes |
|--------|------|-------|
| `generate_3d_from_text` | **~$0.11** | Simple one-step API |
| `generate_multiview_images` + `generate_3d_from_image` | **~$0.11** | More control over steps |
| ~~MVDream (old)~~ | ~~$3.00~~ | **Removed** - 27x more expensive |

---

## Related Documents

- [UNIVERSAL-FILE-INGESTION.md](./UNIVERSAL-FILE-INGESTION.md) - Universal file ingestion (code, data, media)
- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - Full project context
- [AGENT-TESTING.md](./AGENT-TESTING.md) - Testing the code agent
