/**
 * Image Tools - Read images with OCR, describe images, list images
 *
 * Uses ragforge's OCR service for text extraction from images.
 * Supports Gemini Vision and DeepSeek-OCR (via Replicate).
 *
 * @since 2025-12-05
 */

import type { GeneratedToolDefinition } from './types/index.js';

// ============================================
// Tool Definitions
// ============================================

/**
 * Generate read_image tool (OCR - extract text from image)
 */
export function generateReadImageTool(): GeneratedToolDefinition {
  return {
    name: 'read_image',
    description: `Extract text from an image using OCR.

Uses AI vision models (Gemini Vision or DeepSeek-OCR) to extract all text content from an image.
Useful for reading screenshots, scanned documents, diagrams with text, code snippets in images, etc.

Parameters:
- path: Path to image file (absolute or relative to project root)
- provider: OCR provider to use ('gemini' or 'replicate-deepseek', default: auto)

Supported formats: PNG, JPG, JPEG, GIF, WebP, BMP

Example: read_image({ path: "docs/screenshot.png" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to image file (absolute or relative to project root)',
        },
        provider: {
          type: 'string',
          enum: ['gemini', 'replicate-deepseek', 'auto'],
          description: 'OCR provider to use (default: auto - uses first available)',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate describe_image tool (get visual description)
 */
export function generateDescribeImageTool(): GeneratedToolDefinition {
  return {
    name: 'describe_image',
    description: `Get a detailed description of an image's visual content.

Uses AI vision models to analyze and describe what's in the image.
Can answer specific questions about the image if a prompt is provided.

Parameters:
- path: Path to image file (absolute or relative to project root)
- prompt: Custom question or instruction (optional, default: general description)

Example:
  describe_image({ path: "ui-mockup.png" })
  describe_image({ path: "diagram.png", prompt: "What components are shown?" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to image file (absolute or relative to project root)',
        },
        prompt: {
          type: 'string',
          description: 'Custom question or instruction about the image',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate generate_multiview_images tool (multi-view generation for 3D reconstruction)
 */
export function generateGenerateMultiviewImagesTool(): GeneratedToolDefinition {
  return {
    name: 'generate_multiview_images',
    description: `Generate multiple consistent view images from a text description.

Uses AI to create 4 coherent views (front, right, top, perspective) of the same object.
These views can then be passed to generate_3d_from_image for 3D reconstruction.

The tool uses a prompt enhancer to ensure all views are consistent in style, colors, and details.

Parameters:
- prompt: Text description of the object to generate
- output_dir: Directory to save the generated images
- style: Style preset ('3d_render', 'realistic', 'cartoon', 'lowpoly', default: '3d_render')

Note: Requires GEMINI_API_KEY environment variable.

Example:
  generate_multiview_images({
    prompt: "A yellow rubber duck toy",
    output_dir: "temp/duck-views",
    style: "3d_render"
  })

Returns paths to 4 images: {name}_front.png, {name}_right.png, {name}_top.png, {name}_perspective.png`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the object to generate',
        },
        output_dir: {
          type: 'string',
          description: 'Directory to save the generated images',
        },
        style: {
          type: 'string',
          enum: ['3d_render', 'realistic', 'cartoon', 'lowpoly'],
          description: 'Style preset (default: 3d_render)',
        },
      },
      required: ['prompt', 'output_dir'],
    },
  };
}

/**
 * Generate generate_image tool (AI image generation)
 */
export function generateGenerateImageTool(): GeneratedToolDefinition {
  return {
    name: 'generate_image',
    description: `Generate an image from a text prompt using AI.

Uses Gemini's image generation (gemini-2.0-flash-exp) to create images from text descriptions.
Good for creating concept art, reference images, icons, diagrams, etc.

Parameters:
- prompt: Text description of the image to generate
- output_path: Where to save the generated image (PNG)
- aspect_ratio: Aspect ratio ('1:1', '16:9', '9:16', '4:3', '3:4', default: '1:1')

Note: Requires GEMINI_API_KEY environment variable.

Example:
  generate_image({
    prompt: "A cute robot mascot, 3D render style, white background",
    output_path: "assets/robot-mascot.png"
  })`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the image to generate',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the generated image (PNG)',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Aspect ratio (default: 1:1)',
        },
      },
      required: ['prompt', 'output_path'],
    },
  };
}

/**
 * Generate list_images tool
 */
export function generateListImagesTool(): GeneratedToolDefinition {
  return {
    name: 'list_images',
    description: `List image files in a directory.

Finds all image files (PNG, JPG, JPEG, GIF, WebP, BMP, SVG) in the specified directory.
Can search recursively in subdirectories.

Parameters:
- path: Directory path to search (default: project root)
- recursive: Search subdirectories (default: false)
- pattern: Glob pattern to filter (e.g., "*.png", "screenshot-*")

Example: list_images({ path: "docs/images", recursive: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to search (default: project root)',
        },
        recursive: {
          type: 'boolean',
          description: 'Search subdirectories (default: false)',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files',
        },
      },
      required: [],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export interface ImageToolsContext {
  /** Project root directory (for relative paths) */
  projectRoot: string;
  /** OCR Service instance (from ragforge) */
  ocrService?: any;
}

/**
 * Generate handler for read_image (OCR)
 */
export function generateReadImageHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: imagePath, provider = 'auto' } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(imagePath)
      ? imagePath
      : pathModule.join(ctx.projectRoot, imagePath);

    // Check file exists
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Image not found: ${absolutePath}` };
      }
      throw err;
    }

    // Check if it's an image
    const ext = pathModule.extname(absolutePath).toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (!imageExtensions.includes(ext)) {
      return { error: `Not a supported image format: ${ext}. Supported: ${imageExtensions.join(', ')}` };
    }

    // Use OCR service if available
    if (ctx.ocrService) {
      // Set provider if specified
      if (provider !== 'auto') {
        ctx.ocrService.setPrimaryProvider(provider);
      }

      const result = await ctx.ocrService.extractText(absolutePath);

      if (result.error) {
        return {
          path: imagePath,
          absolute_path: absolutePath,
          error: result.error,
          provider: result.provider,
        };
      }

      return {
        path: imagePath,
        absolute_path: absolutePath,
        text: result.text,
        provider: result.provider,
        processing_time_ms: result.processingTimeMs,
      };
    }

    // Fallback: try to import OCR service dynamically
    try {
      const { getOCRService } = await import('../runtime/index.js');
      const ocrService = getOCRService();

      if (!ocrService.isAvailable()) {
        return {
          error: 'No OCR provider available. Set GEMINI_API_KEY or REPLICATE_API_TOKEN environment variable.',
        };
      }

      if (provider !== 'auto') {
        ocrService.setPrimaryProvider(provider);
      }

      const result = await ocrService.extractText(absolutePath);

      if (result.error) {
        return {
          path: imagePath,
          absolute_path: absolutePath,
          error: result.error,
          provider: result.provider,
        };
      }

      return {
        path: imagePath,
        absolute_path: absolutePath,
        text: result.text,
        provider: result.provider,
        processing_time_ms: result.processingTimeMs,
      };
    } catch (importError: any) {
      return {
        error: `OCR service not available: ${importError.message}. Make sure @luciformresearch/ragforge is installed.`,
      };
    }
  };
}

/**
 * Generate handler for describe_image
 */
export function generateDescribeImageHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: imagePath, prompt } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(imagePath)
      ? imagePath
      : pathModule.join(ctx.projectRoot, imagePath);

    // Check file exists
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Image not found: ${absolutePath}` };
      }
      throw err;
    }

    // Check if it's an image
    const ext = pathModule.extname(absolutePath).toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (!imageExtensions.includes(ext)) {
      return { error: `Not a supported image format: ${ext}. Supported: ${imageExtensions.join(', ')}` };
    }

    // Default prompt for description
    const descriptionPrompt = prompt ||
      'Describe this image in detail. What do you see? Include any text, UI elements, diagrams, or notable features.';

    // Try to use Gemini for description (best at visual understanding)
    try {
      const { getOCRService } = await import('../runtime/index.js');
      const ocrService = getOCRService({ primaryProvider: 'gemini' });

      if (!ocrService.isAvailable()) {
        return {
          error: 'No vision provider available. Set GEMINI_API_KEY environment variable.',
        };
      }

      const result = await ocrService.extractText(absolutePath, { prompt: descriptionPrompt });

      if (result.error) {
        return {
          path: imagePath,
          absolute_path: absolutePath,
          error: result.error,
        };
      }

      return {
        path: imagePath,
        absolute_path: absolutePath,
        description: result.text,
        provider: result.provider,
        processing_time_ms: result.processingTimeMs,
      };
    } catch (importError: any) {
      return {
        error: `Vision service not available: ${importError.message}`,
      };
    }
  };
}

/**
 * Generate handler for generate_image
 */
export function generateGenerateImageHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { prompt, output_path, aspect_ratio = '1:1' } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { error: 'GEMINI_API_KEY environment variable is not set' };
    }

    // Resolve output path
    const absoluteOutputPath = pathModule.isAbsolute(output_path)
      ? output_path
      : pathModule.join(ctx.projectRoot, output_path);

    const startTime = Date.now();

    try {
      // Use Gemini 2.5 Flash Image (Nano Banana)
      const { GoogleGenAI } = await import('@google/genai');
      const genAI = new GoogleGenAI({ apiKey });

      const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });

      // Extract image from response
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: any) => p.inlineData?.data);

      if (!imgPart) {
        // Check for text response that might explain the error
        const textPart = parts.find((p: any) => p.text);
        const errorText = textPart?.text || 'No image generated';
        return { error: `No image in response: ${errorText.substring(0, 200)}` };
      }

      // Save image
      const buffer = Buffer.from(imgPart.inlineData!.data!, 'base64');
      await fs.mkdir(pathModule.dirname(absoluteOutputPath), { recursive: true });
      await fs.writeFile(absoluteOutputPath, buffer);

      return {
        prompt,
        output_path,
        absolute_path: absoluteOutputPath,
        aspect_ratio,
        processing_time_ms: Date.now() - startTime,
      };
    } catch (err: any) {
      return { error: `Image generation failed: ${err.message}` };
    }
  };
}

/**
 * Generate handler for generate_multiview_images
 * Uses a prompt enhancer to generate 4 coherent view-specific prompts
 */
export function generateGenerateMultiviewImagesHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { prompt, output_dir, style = '3d_render' } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { error: 'GEMINI_API_KEY environment variable is not set' };
    }

    // Resolve output directory
    const absoluteOutputDir = pathModule.isAbsolute(output_dir)
      ? output_dir
      : pathModule.join(ctx.projectRoot, output_dir);

    const startTime = Date.now();

    try {
      // Create output directory
      await fs.mkdir(absoluteOutputDir, { recursive: true });

      // 1. Use prompt enhancer to generate 4 coherent view prompts
      console.log('🎨 Enhancing prompts for multiview generation...');
      const viewPrompts = await generateViewPrompts(prompt, style, apiKey);

      console.log('📸 Generated view prompts:');
      for (const [view, viewPrompt] of Object.entries(viewPrompts)) {
        console.log(`  - ${view}: ${(viewPrompt as string).substring(0, 80)}...`);
      }

      // 2. Generate all 4 images in parallel
      console.log('🖼️ Generating 4 images in parallel...');
      const generateImageHandler = generateGenerateImageHandler(ctx);

      const views = ['front', 'right', 'top', 'perspective'] as const;
      const imagePromises = views.map(async (view) => {
        const viewPrompt = viewPrompts[view];
        const outputPath = pathModule.join(output_dir, `${view}.png`);

        const result = await generateImageHandler({
          prompt: viewPrompt,
          output_path: outputPath,
        });

        return { view, ...result };
      });

      const results = await Promise.all(imagePromises);

      // Check for errors
      const errors = results.filter(r => r.error);
      if (errors.length === results.length) {
        return { error: `All image generations failed: ${errors.map(e => e.error).join(', ')}` };
      }

      const successfulResults = results.filter(r => !r.error);

      return {
        prompt,
        style,
        output_dir,
        absolute_output_dir: absoluteOutputDir,
        images: successfulResults.map(r => ({
          view: r.view,
          path: r.output_path,
          absolute_path: r.absolute_path,
        })),
        failed: errors.map(e => ({ view: e.view, error: e.error })),
        processing_time_ms: Date.now() - startTime,
        view_prompts: viewPrompts,
      };
    } catch (err: any) {
      return { error: `Multiview generation failed: ${err.message}` };
    }
  };
}

/**
 * Generate 4 coherent view-specific prompts using StructuredLLMExecutor
 * Inspired by PromptEnhancerAgent from lr-tchatagent-web
 */
async function generateViewPrompts(
  basePrompt: string,
  style: string,
  apiKey: string
): Promise<Record<'front' | 'right' | 'top' | 'perspective', string>> {
  const styleDescriptions: Record<string, string> = {
    '3d_render': 'Clean 3D render style, studio lighting, smooth materials, white or neutral background',
    'realistic': 'Photorealistic, detailed textures, natural lighting, high quality photograph',
    'cartoon': 'Cartoon style, bold outlines, vibrant colors, simplified shapes',
    'lowpoly': 'Low poly 3D style, geometric facets, minimal detail, stylized',
  };

  const styleDesc = styleDescriptions[style] || styleDescriptions['3d_render'];

  try {
    // Import StructuredLLMExecutor and GeminiAPIProvider from runtime
    const { StructuredLLMExecutor, GeminiAPIProvider } = await import('../runtime/index.js');

    // Create GeminiAPIProvider (no LlamaIndex needed)
    const llmProvider = new GeminiAPIProvider({
      apiKey,
      model: 'gemini-2.0-flash',
      temperature: 0.7,
    });

    const executor = new StructuredLLMExecutor();

    // Define input item
    const inputItem = {
      basePrompt,
      style,
      styleDescription: styleDesc,
    };

    // Execute structured LLM call with llmProvider
    const results = await executor.executeLLMBatch(
      [inputItem],
      {
        inputFields: ['basePrompt', 'style', 'styleDescription'],
        llmProvider,
        systemPrompt: `Tu es un expert en prompt engineering pour la génération d'images multi-vues destinées à la reconstruction 3D.
Tu génères 4 prompts cohérents et optimisés pour Gemini 2.5 Flash Image.

RÈGLES CRITIQUES DE COHÉRENCE:
1. MÊME OBJET: Tous les prompts décrivent exactement le même objet avec les mêmes caractéristiques
2. MÊMES COULEURS: Les couleurs spécifiées doivent être identiques dans tous les prompts
3. MÊMES DÉTAILS: Tous les détails (textures, matériaux, accessoires) doivent être cohérents
4. MÊMES PROPORTIONS: L'objet doit avoir les mêmes proportions dans toutes les vues
5. FOND UNIFORME: Utilise un fond blanc ou neutre pour toutes les vues
6. CENTRÉ: L'objet doit être centré dans le cadre pour chaque vue
7. STYLE COHÉRENT: Le style artistique doit être identique`,
        userTask: `Génère 4 prompts optimisés pour ces vues:
- front: Vue de face, centré, regardant directement la caméra
- right: Vue de profil droit (90°), même position/pose
- top: Vue du dessus (vue plongeante à 90°), même objet
- perspective: Vue 3/4 avant-droite (45°), légèrement en hauteur

Chaque prompt doit:
- Commencer par la description de l'objet (reprendre les détails originaux)
- Spécifier la vue clairement
- Ajouter les détails de style et de rendu
- Terminer par "centered in frame, white background"`,
        outputSchema: {
          front: {
            type: 'string',
            description: 'Prompt complet pour la vue de face (front view)',
            required: true,
          },
          right: {
            type: 'string',
            description: 'Prompt complet pour la vue de droite (right side view)',
            required: true,
          },
          top: {
            type: 'string',
            description: 'Prompt complet pour la vue du dessus (top-down view)',
            required: true,
          },
          perspective: {
            type: 'string',
            description: 'Prompt complet pour la vue perspective 3/4 (perspective view)',
            required: true,
          },
          reasoning: {
            type: 'string',
            description: 'Explication courte des choix de prompts',
            required: false,
          },
        },
        outputFormat: 'xml', // XML is more robust for parsing
        batchSize: 1,
      }
    );

    // Extract result (executeLLMBatch returns array)
    const result = Array.isArray(results) ? results[0] : (results as any).items[0];

    if (!result || !result.front || !result.right || !result.top || !result.perspective) {
      throw new Error('Missing view prompts in structured response');
    }

    console.log(`✨ Prompt enhancer reasoning: ${result.reasoning || 'N/A'}`);

    return {
      front: result.front,
      right: result.right,
      top: result.top,
      perspective: result.perspective,
    };
  } catch (err: any) {
    console.warn(`⚠️ StructuredLLMExecutor failed, using fallback prompts: ${err.message}`);

    // Fallback: simple template-based prompts
    const baseEnhanced = `${basePrompt}, ${styleDesc}`;
    return {
      front: `${baseEnhanced}, front view, centered in frame, white background`,
      right: `${baseEnhanced}, right side view, profile, centered in frame, white background`,
      top: `${baseEnhanced}, top-down view, from above, centered in frame, white background`,
      perspective: `${baseEnhanced}, 3/4 perspective view, slightly elevated angle, centered in frame, white background`,
    };
  }
}

/**
 * Generate handler for list_images
 */
export function generateListImagesHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: dirPath = '.', recursive = false, pattern } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(dirPath)
      ? dirPath
      : pathModule.join(ctx.projectRoot, dirPath);

    // Check directory exists
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        return { error: `Path is not a directory: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Directory not found: ${absolutePath}` };
      }
      throw err;
    }

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
    const images: Array<{ path: string; name: string; size: number }> = [];

    // Helper to check if file matches pattern
    const matchesPattern = (filename: string): boolean => {
      if (!pattern) return true;
      // Simple glob matching (supports * and ?)
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i'
      );
      return regex.test(filename);
    };

    // Recursive directory reader
    const scanDir = async (dir: string, relativeTo: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = pathModule.join(dir, entry.name);
        const relativePath = pathModule.relative(relativeTo, fullPath);

        if (entry.isDirectory() && recursive) {
          await scanDir(fullPath, relativeTo);
        } else if (entry.isFile()) {
          const ext = pathModule.extname(entry.name).toLowerCase();
          if (imageExtensions.includes(ext) && matchesPattern(entry.name)) {
            const stat = await fs.stat(fullPath);
            images.push({
              path: relativePath,
              name: entry.name,
              size: stat.size,
            });
          }
        }
      }
    };

    await scanDir(absolutePath, absolutePath);

    // Sort by name
    images.sort((a, b) => a.name.localeCompare(b.name));

    return {
      directory: dirPath,
      absolute_path: absolutePath,
      recursive,
      pattern: pattern || '*',
      count: images.length,
      images,
    };
  };
}

// ============================================
// Export All Image Tools
// ============================================

export interface ImageToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all image tools with handlers
 */
export function generateImageTools(ctx: ImageToolsContext): ImageToolsResult {
  return {
    tools: [
      generateReadImageTool(),
      generateDescribeImageTool(),
      generateListImagesTool(),
      generateGenerateImageTool(),
      generateGenerateMultiviewImagesTool(),
    ],
    handlers: {
      read_image: generateReadImageHandler(ctx),
      describe_image: generateDescribeImageHandler(ctx),
      list_images: generateListImagesHandler(ctx),
      generate_image: generateGenerateImageHandler(ctx),
      generate_multiview_images: generateGenerateMultiviewImagesHandler(ctx),
    },
  };
}
