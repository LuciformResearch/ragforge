/**
 * 3D Asset Tools
 *
 * - render_3d_asset: Render 3D models to images (Three.js headless)
 * - generate_3d_from_image: Generate 3D from image (Replicate/Trellis)
 * - generate_3d_from_text: Generate 3D from text (Replicate/MVDream)
 *
 * @since 2025-12-05
 */

import type { GeneratedToolDefinition } from './types/index.js';

// ============================================
// Tool Definitions
// ============================================

/**
 * Generate render_3d_asset tool
 */
export function generateRender3DAssetTool(): GeneratedToolDefinition {
  return {
    name: 'render_3d_asset',
    section: 'media_ops',
    description: `Render a 3D model to images from multiple viewpoints.

Uses Three.js to render .glb/.gltf/.obj models to PNG images.
Useful for previewing 3D assets or generating reference images.

Parameters:
- model_path: Path to 3D model file (.glb, .gltf, .obj)
- output_dir: Directory to save rendered images
- views: Array of view angles (default: ['perspective'])
  Available: 'front', 'back', 'left', 'right', 'top', 'bottom', 'perspective'
- width: Image width in pixels (default: 1024)
- height: Image height in pixels (default: 1024)
- background: Background color hex (default: transparent)

Example: render_3d_asset({
  model_path: "assets/character.glb",
  output_dir: "renders/",
  views: ["front", "left", "perspective"]
})`,
    inputSchema: {
      type: 'object',
      properties: {
        model_path: {
          type: 'string',
          description: 'Path to 3D model file (.glb, .gltf, .obj, .fbx)',
        },
        output_dir: {
          type: 'string',
          description: 'Directory to save rendered images',
        },
        views: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'perspective'],
          },
          description: 'View angles to render (default: perspective)',
        },
        width: {
          type: 'number',
          description: 'Image width in pixels (default: 1024)',
        },
        height: {
          type: 'number',
          description: 'Image height in pixels (default: 1024)',
        },
        background: {
          type: 'string',
          description: 'Background color hex (e.g., "#ffffff") or "transparent"',
        },
        precise_framing: {
          type: 'boolean',
          description: 'Use vertex projection for precise framing (slower but more accurate). Default: false (uses bbox corners)',
        },
      },
      required: ['model_path', 'output_dir'],
    },
  };
}

/**
 * Generate generate_3d_from_image tool
 */
export function generateGenerate3DFromImageTool(): GeneratedToolDefinition {
  return {
    name: 'generate_3d_from_image',
    section: 'media_ops',
    description: `Generate a 3D model from reference image(s).

Uses Trellis (via Replicate) to convert images into a 3D model.
Best results with multiple views (front, side, top, perspective).
Good for creating game-ready 3D assets from concept art or photos.

Parameters:
- image_paths: Path(s) to input image(s) - string or array of strings
- output_path: Where to save the generated .glb model

Note: Requires REPLICATE_API_TOKEN environment variable.
Processing time: ~60-120 seconds depending on complexity.

Example with single image:
  generate_3d_from_image({
    image_paths: "references/spaceship-concept.png",
    output_path: "assets/models/spaceship.glb"
  })

Example with multiple views (better quality):
  generate_3d_from_image({
    image_paths: ["renders/model_front.png", "renders/model_right.png", "renders/model_perspective.png"],
    output_path: "assets/models/reconstructed.glb"
  })`,
    inputSchema: {
      type: 'object',
      properties: {
        image_paths: {
          oneOf: [
            { type: 'string', description: 'Path to single input image' },
            { type: 'array', items: { type: 'string' }, description: 'Paths to multiple input images (better quality)' },
          ],
          description: 'Path(s) to input image(s)',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the generated 3D model',
        },
      },
      required: ['image_paths', 'output_path'],
    },
  };
}

/**
 * Generate generate_3d_from_text tool
 *
 * Internally uses generate_multiview_images + generate_3d_from_image (~$0.11 total)
 */
export function generateGenerate3DFromTextTool(): GeneratedToolDefinition {
  return {
    name: 'generate_3d_from_text',
    section: 'media_ops',
    description: `Generate a 3D model from a text description.

This tool automatically:
1. Generates 4 coherent view images using Gemini (with prompt enhancer)
2. Converts them to a 3D GLB model using Trellis

Total cost: ~$0.11 per model. Processing time: ~3-4 minutes.

Parameters:
- prompt: Text description of the 3D model to generate
- output_path: Where to save the generated .glb model
- style: Visual style ('3d_render', 'realistic', 'cartoon', 'lowpoly')

Example: generate_3d_from_text({
  prompt: "A yellow rubber duck toy",
  output_path: "assets/models/duck.glb",
  style: "3d_render"
})

Note: Requires GEMINI_API_KEY and REPLICATE_API_TOKEN environment variables.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the 3D model',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the generated .glb model',
        },
        style: {
          type: 'string',
          enum: ['3d_render', 'realistic', 'cartoon', 'lowpoly'],
          description: 'Visual style (default: 3d_render)',
        },
      },
      required: ['prompt', 'output_path'],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export interface ThreeDToolsContext {
  /** Project root directory */
  projectRoot: string;
  /**
   * Callback when a file is created by 3D tools
   * Used for automatic ingestion
   */
  onFileCreated?: (filePath: string, fileType: 'image' | '3d' | 'document') => Promise<void>;
  /**
   * Callback to register rendered views in the knowledge graph
   * Creates ImageFile nodes with RENDERED_AS relationships
   */
  onRenderedViews?: (
    modelPath: string,
    renders: Array<{ view: string; path: string }>
  ) => Promise<{ threeDFileUuid: string; imageUuids: string[] }>;
  /**
   * Callback when content is extracted (descriptions, etc.)
   * Used to update brain with extracted content and mark for embedding regeneration
   */
  onContentExtracted?: (params: {
    filePath: string;
    textContent?: string;
    description?: string;
    extractionMethod?: string;
    generateEmbeddings?: boolean;
    /** Source files used to create this file (creates GENERATED_FROM relationships) */
    sourceFiles?: string[];
  }) => Promise<{ updated: boolean }>;
}

/**
 * Camera configurations for standard views
 * - ortho views: use OrthographicCamera with exact bounding box fit
 * - perspective: use PerspectiveCamera with Thales-based distance calculation
 */
interface ViewConfig {
  type: 'ortho' | 'perspective';
  direction: [number, number, number]; // View direction (camera looks at -direction)
  up: [number, number, number];
}

const VIEW_CONFIGS: Record<string, ViewConfig> = {
  front: { type: 'ortho', direction: [0, 0, 1], up: [0, 1, 0] },
  back: { type: 'ortho', direction: [0, 0, -1], up: [0, 1, 0] },
  left: { type: 'ortho', direction: [-1, 0, 0], up: [0, 1, 0] },
  right: { type: 'ortho', direction: [1, 0, 0], up: [0, 1, 0] },
  top: { type: 'ortho', direction: [0, 1, 0], up: [0, 0, -1] },
  bottom: { type: 'ortho', direction: [0, -1, 0], up: [0, 0, 1] },
  perspective: { type: 'perspective', direction: [1, 0.6, 1], up: [0, 1, 0] }, // ~45° around Y, ~30° elevation
};

/**
 * Generate handler for render_3d_asset
 */
export function generateRender3DAssetHandler(ctx: ThreeDToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const {
      model_path,
      output_dir,
      views = ['perspective'],
      width = 1024,
      height = 1024,
      background = 'transparent',
      precise_framing = false,
    } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve paths
    const absoluteModelPath = pathModule.isAbsolute(model_path)
      ? model_path
      : pathModule.join(ctx.projectRoot, model_path);

    const absoluteOutputDir = pathModule.isAbsolute(output_dir)
      ? output_dir
      : pathModule.join(ctx.projectRoot, output_dir);

    // Check model exists
    try {
      await fs.stat(absoluteModelPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Model not found: ${absoluteModelPath}` };
      }
      throw err;
    }

    // Check format
    const ext = pathModule.extname(absoluteModelPath).toLowerCase();
    const supportedFormats = ['.glb', '.gltf', '.obj'];
    if (!supportedFormats.includes(ext)) {
      return { error: `Unsupported format: ${ext}. Supported: ${supportedFormats.join(', ')}` };
    }

    // Create output directory
    await fs.mkdir(absoluteOutputDir, { recursive: true });

    // Try to render using Three.js
    try {
      const renders = await renderModelWithThreeJS(
        absoluteModelPath,
        absoluteOutputDir,
        views,
        width,
        height,
        background,
        precise_framing
      );

      // Trigger ingestion callback for each rendered image
      if (ctx.onFileCreated) {
        for (const render of renders) {
          const absolutePath = pathModule.join(absoluteOutputDir, pathModule.basename(render.path));
          await ctx.onFileCreated(absolutePath, 'image');
        }
      }

      // Register rendered views in knowledge graph (creates RENDERED_AS relationships)
      let registrationResult: { threeDFileUuid?: string; imageUuids?: string[] } = {};
      if (ctx.onRenderedViews) {
        try {
          registrationResult = await ctx.onRenderedViews(model_path, renders);
        } catch (err: any) {
          console.warn(`[render_3d_asset] Failed to register views: ${err.message}`);
        }
      }

      return {
        model_path,
        output_dir,
        views_rendered: views,
        renders,
        threeDFileUuid: registrationResult.threeDFileUuid,
        imageUuids: registrationResult.imageUuids,
      };
    } catch (err: any) {
      return {
        error: `Rendering failed: ${err.message}`,
        hint: 'Make sure three, canvas, and gl packages are installed for headless rendering.',
      };
    }
  };
}

/**
 * Render model using Playwright + Three.js
 *
 * Uses a headless browser for full WebGL2 support.
 * For orthographic views (front, back, etc.): OrthographicCamera with exact bounding box fit
 * For perspective view: PerspectiveCamera with Thales-based optimal distance calculation
 */
async function renderModelWithThreeJS(
  modelPath: string,
  outputDir: string,
  views: string[],
  width: number,
  height: number,
  background: string,
  preciseFraming: boolean = false
): Promise<Array<{ view: string; path: string }>> {
  const fs = await import('fs/promises');
  const pathModule = await import('path');
  const { chromium } = await import('playwright');

  const renders: Array<{ view: string; path: string }> = [];
  const modelName = pathModule.basename(modelPath, pathModule.extname(modelPath));

  // Read model file
  const modelBuffer = await fs.readFile(modelPath);

  // Build the HTML page with Three.js (model served via route intercept)
  const modelUrl = 'http://localhost/__model__.glb';
  const html = buildThreeJSPage(width, height, background, modelUrl, views, preciseFraming);

  // Launch browser with WebGL support for headless
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-gpu-rasterization',
    ],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Intercept request for model file and serve it directly
  await page.route('**/__model__.glb', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'model/gltf-binary',
      body: modelBuffer,
    });
  });

  try {
    // Capture console errors for debugging
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push(err.message);
    });

    // Load the page
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Wait for Three.js to load and render
    await page.waitForFunction('window.rendersReady === true', { timeout: 30000 });

    // Check for errors
    const pageError = await page.evaluate('window.renderError') as string | undefined;
    if (pageError) {
      throw new Error(`Page render error: ${pageError}`);
    }
    if (consoleErrors.length > 0) {
      console.warn('Console errors during render:', consoleErrors);
    }

    // Get the render results from the page
    const renderResults = await page.evaluate('window.renderResults') as Array<{ view: string; dataUrl: string }>;

    // Save each rendered view
    for (const result of renderResults) {
      const outputPath = pathModule.join(outputDir, `${modelName}_${result.view}.png`);

      // Convert base64 data URL to buffer and save
      const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(outputPath, imageBuffer);

      renders.push({
        view: result.view,
        path: pathModule.relative(pathModule.dirname(outputDir), outputPath),
      });
    }
  } finally {
    await browser.close();
  }

  return renders;
}

/**
 * Build HTML page with embedded Three.js for rendering
 */
function buildThreeJSPage(
  width: number,
  height: number,
  background: string,
  modelDataUrl: string,
  views: string[],
  preciseFraming: boolean = false
): string {
  const viewConfigsJson = JSON.stringify(VIEW_CONFIGS);
  const viewsJson = JSON.stringify(views);
  const bgColor = background === 'transparent' ? 'null' : `"${background}"`;

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const VIEW_CONFIGS = ${viewConfigsJson};
    const views = ${viewsJson};
    const width = ${width};
    const height = ${height};
    const bgColor = ${bgColor};
    const modelDataUrl = "${modelDataUrl}";
    const preciseFraming = ${preciseFraming};

    window.renderResults = [];
    window.rendersReady = false;

    async function main() {
      // Create renderer
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: bgColor === null,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(width, height);
      document.body.appendChild(renderer.domElement);

      if (bgColor !== null) {
        renderer.setClearColor(new THREE.Color(bgColor), 1);
      }

      // Create scene
      const scene = new THREE.Scene();

      // Add lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 10, 7.5);
      scene.add(directionalLight);

      const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
      backLight.position.set(-5, -5, -5);
      scene.add(backLight);

      // Load model from URL (served via Playwright route intercept)
      const loader = new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        loader.load(modelDataUrl, resolve, undefined, reject);
      });

      scene.add(gltf.scene);

      // Calculate world bounding box (model stays in place, camera will target center)
      const worldBox = new THREE.Box3().setFromObject(gltf.scene);
      const worldCenter = worldBox.getCenter(new THREE.Vector3());
      const worldSize = worldBox.getSize(new THREE.Vector3());
      const halfSize = worldSize.clone().multiplyScalar(0.5);

      // Get the 8 corners of the bounding box in world space
      const boxCorners = [
        new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y - halfSize.y, worldCenter.z - halfSize.z),
        new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y - halfSize.y, worldCenter.z + halfSize.z),
        new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y + halfSize.y, worldCenter.z - halfSize.z),
        new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y + halfSize.y, worldCenter.z + halfSize.z),
        new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y - halfSize.y, worldCenter.z - halfSize.z),
        new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y - halfSize.y, worldCenter.z + halfSize.z),
        new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y + halfSize.y, worldCenter.z - halfSize.z),
        new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y + halfSize.y, worldCenter.z + halfSize.z),
      ];

      // Extract all vertices from meshes for precise framing (if needed)
      function getAllVertices(object) {
        const vertices = [];
        object.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            const posAttr = geo.attributes.position;
            if (posAttr) {
              child.updateWorldMatrix(true, false);
              const worldMatrix = child.matrixWorld;
              for (let i = 0; i < posAttr.count; i++) {
                const vertex = new THREE.Vector3(
                  posAttr.getX(i),
                  posAttr.getY(i),
                  posAttr.getZ(i)
                );
                vertex.applyMatrix4(worldMatrix);
                vertices.push(vertex);
              }
            }
          }
        });
        return vertices;
      }

      // Get points to project (vertices if precise, bbox corners otherwise)
      const allVertices = preciseFraming ? getAllVertices(gltf.scene) : null;

      const aspect = width / height;

      // Render each view
      for (const view of views) {
        const viewConfig = VIEW_CONFIGS[view] || VIEW_CONFIGS.perspective;
        let camera;

        if (viewConfig.type === 'ortho') {
          // === ORTHOGRAPHIC VIEW ===
          const viewDir = new THREE.Vector3(...viewConfig.direction).normalize();
          const upDir = new THREE.Vector3(...viewConfig.up);

          const rightDir = new THREE.Vector3().crossVectors(viewDir, upDir).normalize();
          const adjustedUp = new THREE.Vector3().crossVectors(rightDir, viewDir).normalize();

          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          let minZ = Infinity, maxZ = -Infinity;

          for (const corner of boxCorners) {
            const camX = corner.dot(rightDir);
            const camY = corner.dot(adjustedUp);
            const camZ = corner.dot(viewDir);
            minX = Math.min(minX, camX); maxX = Math.max(maxX, camX);
            minY = Math.min(minY, camY); maxY = Math.max(maxY, camY);
            minZ = Math.min(minZ, camZ); maxZ = Math.max(maxZ, camZ);
          }

          const bboxWidth = maxX - minX;
          const bboxHeight = maxY - minY;
          const bboxCenterX = (minX + maxX) / 2;
          const bboxCenterY = (minY + maxY) / 2;

          let frustumHalfWidth, frustumHalfHeight;
          if (bboxWidth / bboxHeight > aspect) {
            frustumHalfWidth = bboxWidth / 2;
            frustumHalfHeight = frustumHalfWidth / aspect;
          } else {
            frustumHalfHeight = bboxHeight / 2;
            frustumHalfWidth = frustumHalfHeight * aspect;
          }

          const margin = 1.05;
          frustumHalfWidth *= margin;
          frustumHalfHeight *= margin;

          camera = new THREE.OrthographicCamera(
            -frustumHalfWidth, frustumHalfWidth,
            frustumHalfHeight, -frustumHalfHeight,
            0.1, maxZ - minZ + 100
          );

          const cameraDistance = -minZ + 10;
          camera.position.copy(viewDir.clone().multiplyScalar(cameraDistance));
          camera.position.add(rightDir.clone().multiplyScalar(bboxCenterX));
          camera.position.add(adjustedUp.clone().multiplyScalar(bboxCenterY));
          camera.up.copy(adjustedUp);
          camera.lookAt(camera.position.clone().sub(viewDir));

        } else {
          // === PERSPECTIVE VIEW ===
          // Project points to 2D, find bounding rect, adjust camera to fit & center
          const fov = 45;
          const fovRad = (fov * Math.PI) / 180;

          // Camera direction (from center toward camera position)
          const viewDir = new THREE.Vector3(...viewConfig.direction).normalize();

          // Initial distance estimate (will be refined)
          const initialDistance = halfSize.length() * 3;

          // Create camera at initial position, looking at model center
          camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, initialDistance * 10);
          camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(initialDistance));
          camera.up.set(0, 1, 0);
          camera.lookAt(worldCenter);
          camera.updateMatrixWorld();
          camera.updateProjectionMatrix();

          // Project points to NDC (normalized device coordinates: -1 to 1)
          // Use all vertices for precise framing, or just bbox corners for fast mode
          const pointsToProject = allVertices && allVertices.length > 0 ? allVertices : boxCorners;

          let minNdcX = Infinity, maxNdcX = -Infinity;
          let minNdcY = Infinity, maxNdcY = -Infinity;

          for (const point of pointsToProject) {
            const projected = point.clone().project(camera);
            minNdcX = Math.min(minNdcX, projected.x);
            maxNdcX = Math.max(maxNdcX, projected.x);
            minNdcY = Math.min(minNdcY, projected.y);
            maxNdcY = Math.max(maxNdcY, projected.y);
          }

          // Current 2D bounding rect in NDC
          const ndcWidth = maxNdcX - minNdcX;
          const ndcHeight = maxNdcY - minNdcY;

          // Scale factor to fit in view (target: fill 90% of frame)
          const targetSize = 1.8; // NDC range is -1 to 1, so 2 total, 1.8 = 90%
          const scaleFactor = targetSize / Math.max(ndcWidth, ndcHeight);

          // New distance
          const newDistance = initialDistance / scaleFactor;

          // Step 1: Move camera to new distance
          camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(newDistance));
          camera.lookAt(worldCenter);
          camera.updateMatrixWorld();

          // Step 2: Transform points to camera space and compute angle-based bounds (Thales)
          // In camera space: point at (x, y, z) projects with tan(angle_x) = x/z, tan(angle_y) = y/z
          const viewMatrix = camera.matrixWorldInverse;

          let minTanX = Infinity, maxTanX = -Infinity;
          let minTanY = Infinity, maxTanY = -Infinity;
          let minDepth = Infinity, maxDepth = -Infinity;

          for (const point of pointsToProject) {
            // Transform to camera space
            const camSpacePoint = point.clone().applyMatrix4(viewMatrix);
            // In Three.js camera space: -Z is forward, so depth = -z
            const depth = -camSpacePoint.z;
            if (depth > 0) {
              const tanX = camSpacePoint.x / depth;
              const tanY = camSpacePoint.y / depth;
              minTanX = Math.min(minTanX, tanX);
              maxTanX = Math.max(maxTanX, tanX);
              minTanY = Math.min(minTanY, tanY);
              maxTanY = Math.max(maxTanY, tanY);
              minDepth = Math.min(minDepth, depth);
              maxDepth = Math.max(maxDepth, depth);
            }
          }

          // Center of the tangent bounds = the angle offset needed
          const tanCenterX = (minTanX + maxTanX) / 2;
          const tanCenterY = (minTanY + maxTanY) / 2;

          // Get camera axes
          const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

          // Translate camera to center the view (not rotate)
          // Moving camera by -offset shifts the projected image by +offset
          const offsetX = tanCenterX * newDistance;
          const offsetY = tanCenterY * newDistance;

          camera.position.add(camRight.clone().multiplyScalar(offsetX));
          camera.position.add(camUp.clone().multiplyScalar(offsetY));

          // Update lookAt to maintain same view direction (target also shifts)
          const newLookAt = worldCenter.clone()
            .add(camRight.clone().multiplyScalar(offsetX))
            .add(camUp.clone().multiplyScalar(offsetY));
          camera.lookAt(newLookAt);
          camera.updateMatrixWorld();

          // Recalculate near/far after final camera position
          let finalMinDepth = Infinity, finalMaxDepth = -Infinity;
          const finalViewMatrix = camera.matrixWorldInverse;
          for (const point of pointsToProject) {
            const camSpacePoint = point.clone().applyMatrix4(finalViewMatrix);
            const depth = -camSpacePoint.z;
            if (depth > 0) {
              finalMinDepth = Math.min(finalMinDepth, depth);
              finalMaxDepth = Math.max(finalMaxDepth, depth);
            }
          }

          // Add margin to avoid clipping
          camera.near = Math.max(0.001, finalMinDepth * 0.5);
          camera.far = finalMaxDepth * 2;
        }

        camera.updateProjectionMatrix();

        // Clear and render
        gltf.scene.updateWorldMatrix(true, true);
        renderer.clear();
        renderer.render(scene, camera);

        const gl = renderer.getContext();
        gl.finish();

        // Capture as data URL
        const dataUrl = renderer.domElement.toDataURL('image/png');
        window.renderResults.push({ view, dataUrl });
      }

      window.rendersReady = true;
    }

    main().catch(err => {
      console.error('Render error:', err);
      window.renderError = err.message || String(err);
      window.rendersReady = true;
    });
  </script>
</body>
</html>`;
}

/**
 * Generate handler for generate_3d_from_image
 */
export function generateGenerate3DFromImageHandler(ctx: ThreeDToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { image_paths, output_path } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const Replicate = (await import('replicate')).default;

    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      return { error: 'REPLICATE_API_TOKEN environment variable is not set' };
    }

    // Normalize to array
    const imagePaths = Array.isArray(image_paths) ? image_paths : [image_paths];

    const absoluteOutputPath = pathModule.isAbsolute(output_path)
      ? output_path
      : pathModule.join(ctx.projectRoot, output_path);

    // Read and encode all images
    const dataUris: string[] = [];
    const absoluteImagePaths: string[] = [];
    for (const imagePath of imagePaths) {
      const absoluteImagePath = pathModule.isAbsolute(imagePath)
        ? imagePath
        : pathModule.join(ctx.projectRoot, imagePath);
      absoluteImagePaths.push(absoluteImagePath);

      // Check image exists
      try {
        await fs.stat(absoluteImagePath);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return { error: `Image not found: ${absoluteImagePath}` };
        }
        throw err;
      }

      const imageBuffer = await fs.readFile(absoluteImagePath);
      const base64Image = imageBuffer.toString('base64');
      const ext = pathModule.extname(absoluteImagePath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      dataUris.push(`data:${mimeType};base64,${base64Image}`);
    }

    const startTime = Date.now();

    try {
      // useFileOutput: false returns URLs instead of ReadableStreams
      const replicate = new Replicate({ auth: apiToken, useFileOutput: false });

      // Run Trellis model for image-to-3D
      // Trellis accepts array of images and needs generate_model=true for GLB output
      const output = await replicate.run('firtoz/trellis:e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c', {
        input: {
          images: dataUris,
          generate_model: true,
          texture_size: 1024,
        },
      }) as any;

      // Output has model_file URL
      const modelUrl = output?.model_file || output?.glb || output?.mesh;
      if (!modelUrl || typeof modelUrl !== 'string') {
        return { error: `No model URL in output: ${JSON.stringify(output)}` };
      }

      // Download the model from URL
      const modelResponse = await fetch(modelUrl);
      const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());

      // Create output directory and save
      await fs.mkdir(pathModule.dirname(absoluteOutputPath), { recursive: true });
      await fs.writeFile(absoluteOutputPath, modelBuffer);

      // Ingest the 3D model with description and source relationships
      let ingested = false;
      if (ctx.onContentExtracted) {
        try {
          const imageList = absoluteImagePaths.map(p => pathModule.basename(p)).join(', ');
          const description = `3D model generated from images: ${imageList}`;
          const ingestResult = await ctx.onContentExtracted({
            filePath: absoluteOutputPath,
            description,
            extractionMethod: 'ai-generated-3d',
            generateEmbeddings: true,
            sourceFiles: absoluteImagePaths,
          });
          ingested = ingestResult.updated;
        } catch (e) {
          console.warn(`[threed-tools] Failed to ingest 3D model: ${e}`);
        }
      }

      return {
        output_path,
        model_path: output_path, // Alias for backward compatibility
        absolute_path: absoluteOutputPath,
        format: 'glb',
        input_images: imagePaths.length,
        processing_time_ms: Date.now() - startTime,
        ingested,
      };
    } catch (err: any) {
      return { error: `Generation failed: ${err.message}` };
    }
  };
}

/**
 * Generate handler for generate_3d_from_text
 *
 * Internally uses generate_multiview_images + generate_3d_from_image (~$0.11 total)
 * instead of MVDream (~$3/model).
 *
 * Source images are saved next to the model for traceability:
 * - output_path: "models/my-model.glb"
 * - sources: "models/my-model-sources/perspective.png"
 */
export function generateGenerate3DFromTextHandler(ctx: ThreeDToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { prompt, output_path, style = '3d_render' } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Import image tools handlers
    const { generateGenerateMultiviewImagesHandler } = await import('./image-tools.js');

    const startTime = Date.now();

    // Resolve output path
    const absoluteOutputPath = pathModule.isAbsolute(output_path)
      ? output_path
      : pathModule.join(ctx.projectRoot, output_path);

    // Create sources directory next to the model (not in temp!)
    // e.g., "models/my-model.glb" → "models/my-model-sources/"
    const modelBaseName = pathModule.basename(absoluteOutputPath, pathModule.extname(absoluteOutputPath));
    const modelDir = pathModule.dirname(absoluteOutputPath);
    const sourcesDir = pathModule.join(modelDir, `${modelBaseName}-sources`);
    await fs.mkdir(sourcesDir, { recursive: true });

    try {
      console.log('🎨 Step 1/2: Generating enhanced perspective image...');

      // Step 1: Generate only perspective view (uses prompt enhancer for quality)
      const multiviewHandler = generateGenerateMultiviewImagesHandler({ projectRoot: ctx.projectRoot });
      const multiviewResult = await multiviewHandler({
        prompt,
        output_dir: sourcesDir, // Save to sources directory, not temp!
        style,
        views: ['perspective'], // Only generate perspective for cleaner 3D reconstruction
      });

      if (multiviewResult.error) {
        return {
          error: `Multiview generation failed: ${multiviewResult.error}`,
          step: 'generate_multiview_images',
        };
      }

      // Get paths of generated images
      const imagePaths = multiviewResult.images?.map((img: any) => img.absolute_path) || [];
      if (imagePaths.length === 0) {
        return {
          error: 'No images generated from multiview step',
          multiview_result: multiviewResult,
        };
      }

      console.log(`✅ Generated ${imagePaths.length} enhanced perspective image(s)`);
      console.log('🔧 Step 2/2: Converting to 3D model with Trellis (single image mode)...');

      // Step 2: Generate 3D from images
      const generate3DHandler = generateGenerate3DFromImageHandler(ctx);
      const result3D = await generate3DHandler({
        image_paths: imagePaths,
        output_path,
      });

      if (result3D.error) {
        return {
          error: `3D generation failed: ${result3D.error}`,
          step: 'generate_3d_from_image',
          multiview_result: multiviewResult,
        };
      }

      console.log('✅ 3D model generated successfully!');

      // Get the enhanced prompt from the perspective view (much better than lazy user prompt)
      const enhancedPrompt = multiviewResult.view_prompts?.perspective || prompt;

      // Ingest 3D model with enhanced prompt for better semantic search
      let modelIngested = false;
      if (ctx.onContentExtracted) {
        try {
          const ingestResult = await ctx.onContentExtracted({
            filePath: result3D.absolute_path,
            description: enhancedPrompt, // Use enhanced prompt, not original!
            extractionMethod: 'ai-generated-3d-from-text',
            generateEmbeddings: true,
            sourceFiles: imagePaths,
          });
          modelIngested = ingestResult.updated;
        } catch (e) {
          console.warn(`[threed-tools] Failed to ingest 3D model: ${e}`);
        }
      }

      // Ingest each source image with its enhanced prompt
      const imagesIngested: string[] = [];
      if (ctx.onContentExtracted && multiviewResult.images) {
        for (const img of multiviewResult.images) {
          try {
            const viewPrompt = multiviewResult.view_prompts?.[img.view] || prompt;
            await ctx.onContentExtracted({
              filePath: img.absolute_path,
              description: viewPrompt, // Use view-specific enhanced prompt
              extractionMethod: 'ai-generated-multiview',
              generateEmbeddings: true,
            });
            imagesIngested.push(img.absolute_path);
          } catch (e) {
            console.warn(`[threed-tools] Failed to ingest source image ${img.view}: ${e}`);
          }
        }
      }

      return {
        prompt,
        enhanced_prompt: enhancedPrompt, // Return for debug/reference
        style,
        model_path: output_path,
        absolute_path: result3D.absolute_path,
        source_images: imagePaths, // Return source images paths
        sources_directory: sourcesDir,
        format: 'glb',
        processing_time_ms: Date.now() - startTime,
        ingested: {
          model: modelIngested,
          images: imagesIngested,
        },
        steps: {
          multiview: {
            images_generated: imagePaths.length,
            view_prompts: multiviewResult.view_prompts,
          },
          trellis: {
            processing_time_ms: result3D.processing_time_ms,
          },
        },
      };
    } catch (err: any) {
      return { error: `Text-to-3D failed: ${err.message}` };
    }
  };
}

/**
 * Generate analyze_3d_model tool
 *
 * Full workflow: render → describe views → synthesize description → embed
 */
export function generateAnalyze3DModelTool(): GeneratedToolDefinition {
  return {
    name: 'analyze_3d_model',
    section: 'media_ops',
    description: `Fully analyze a 3D model: render views, describe each view, synthesize global description.

This tool performs the complete 3D analysis workflow:
1. Renders the model from multiple viewpoints (front, right, back, perspective)
2. Generates descriptions for each view using Gemini Vision
3. Synthesizes a global description combining all views
4. Generates embeddings for semantic search

Use this to make 3D models searchable and understandable.

Parameters:
- model_path: Path to 3D model file (.glb, .gltf)
- output_dir: Directory to save rendered images (optional, uses temp if not specified)
- views: Array of view angles (default: ['front', 'right', 'back', 'perspective'])

Note: Requires GEMINI_API_KEY for descriptions.

Example: analyze_3d_model({
  model_path: "assets/models/character.glb"
})`,
    inputSchema: {
      type: 'object',
      properties: {
        model_path: {
          type: 'string',
          description: 'Path to 3D model file (.glb, .gltf)',
        },
        output_dir: {
          type: 'string',
          description: 'Directory to save rendered images (optional)',
        },
        views: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'perspective'],
          },
          description: 'View angles to render (default: front, right, back, perspective)',
        },
      },
      required: ['model_path'],
    },
  };
}

/**
 * Extended context for analyze_3d_model (needs ThreeDService)
 */
export interface ThreeDAnalyzeContext extends ThreeDToolsContext {
  /** ThreeDService instance for full analysis */
  threeDService?: {
    registerRenderedViews: (
      modelPath: string,
      projectId: string,
      renders: Array<{ view: string; path: string }>
    ) => Promise<{ threeDFileUuid: string; imageUuids: string[] }>;
    describeRenderedViews: (
      threeDFileUuid: string,
      projectId: string
    ) => Promise<Array<{ imageUuid: string; view: string; description: string }>>;
    synthesizeGlobalDescription: (
      threeDFileUuid: string
    ) => Promise<string | null>;
  };
  /** Project ID for Neo4j */
  projectId?: string;
}

/**
 * Generate handler for analyze_3d_model
 */
export function generateAnalyze3DModelHandler(ctx: ThreeDAnalyzeContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const {
      model_path,
      output_dir,
      views = ['front', 'right', 'back', 'perspective'],
    } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');
    const os = await import('os');

    const startTime = Date.now();

    // Determine output directory
    const actualOutputDir = output_dir
      ? (pathModule.isAbsolute(output_dir) ? output_dir : pathModule.join(ctx.projectRoot, output_dir))
      : pathModule.join(os.tmpdir(), `ragforge-3d-analyze-${Date.now()}`);

    await fs.mkdir(actualOutputDir, { recursive: true });

    // Resolve model path
    const absoluteModelPath = pathModule.isAbsolute(model_path)
      ? model_path
      : pathModule.join(ctx.projectRoot, model_path);

    try {
      console.log('📷 Step 1/3: Rendering 3D model views...');

      // Step 1: Render the model
      const renderHandler = generateRender3DAssetHandler(ctx);
      const renderResult = await renderHandler({
        model_path,
        output_dir: actualOutputDir,
        views,
        width: 1024,
        height: 1024,
        background: 'transparent',
      });

      if (renderResult.error) {
        return {
          error: `Rendering failed: ${renderResult.error}`,
          step: 'render',
        };
      }

      console.log(`✅ Rendered ${renderResult.renders.length} views`);

      // Mode 1: Full service mode (with threeDService)
      if (ctx.threeDService && ctx.projectId) {
        console.log('🔗 Step 2/3: Registering views in knowledge graph...');

        const { threeDFileUuid, imageUuids } = await ctx.threeDService.registerRenderedViews(
          model_path,
          ctx.projectId,
          renderResult.renders
        );

        console.log(`✅ Created ${imageUuids.length} ImageFile nodes with RENDERED_AS relationships`);

        console.log('🔍 Step 3/3: Generating descriptions...');

        const descriptions = await ctx.threeDService.describeRenderedViews(
          threeDFileUuid,
          ctx.projectId
        );

        console.log(`✅ Generated ${descriptions.length} view descriptions`);

        console.log('📝 Synthesizing global description...');

        const globalDescription = await ctx.threeDService.synthesizeGlobalDescription(threeDFileUuid);

        console.log('✅ Analysis complete!');

        return {
          model_path,
          threeDFileUuid,
          views_analyzed: views,
          renders: renderResult.renders,
          descriptions: descriptions.map(d => ({
            view: d.view,
            description: d.description,
          })),
          global_description: globalDescription,
          processing_time_ms: Date.now() - startTime,
          mode: 'full-service',
        };
      }

      // Mode 2: Standalone mode (with onContentExtracted callback)
      console.log('🔍 Step 2/2: Generating descriptions with Gemini Vision...');

      const { getOCRService } = await import('../runtime/index.js');
      const ocrService = getOCRService({ primaryProvider: 'gemini' });

      if (!ocrService.isAvailable()) {
        return {
          error: 'Gemini Vision not available. Set GEMINI_API_KEY environment variable.',
          renders: renderResult.renders,
        };
      }

      const descriptions: Array<{ view: string; description: string }> = [];

      for (const render of renderResult.renders) {
        const absolutePath = pathModule.join(actualOutputDir, pathModule.basename(render.path));
        try {
          const result = await ocrService.extractText(absolutePath, {
            prompt: `Describe this ${render.view} view of a 3D model. Focus on shape, features, and visual characteristics.`,
          });
          if (result.text) {
            descriptions.push({ view: render.view, description: result.text });

            // Ingest to brain if callback provided
            if (ctx.onContentExtracted) {
              await ctx.onContentExtracted({
                filePath: absolutePath,
                description: result.text,
                extractionMethod: 'gemini-vision',
                generateEmbeddings: true,
              });
            }
          }
        } catch (err: any) {
          console.warn(`[analyze_3d_model] Failed to describe ${render.view}: ${err.message}`);
        }
      }

      // Synthesize global description from all views
      let globalDescription: string | undefined;
      if (descriptions.length > 0) {
        const allDescriptions = descriptions.map(d => `${d.view}: ${d.description}`).join('\n');
        try {
          const synthResult = await ocrService.extractText(
            pathModule.join(actualOutputDir, pathModule.basename(renderResult.renders[0].path)),
            {
              prompt: `Based on these view descriptions of a 3D model, write a single comprehensive description:\n\n${allDescriptions}\n\nWrite a unified description of this 3D model:`,
            }
          );
          globalDescription = synthResult.text;

          // Ingest global description for the 3D model itself
          let ingested = false;
          if (ctx.onContentExtracted && globalDescription) {
            const ingestResult = await ctx.onContentExtracted({
              filePath: absoluteModelPath,
              description: globalDescription,
              extractionMethod: 'gemini-vision-synthesis',
              generateEmbeddings: true,
            });
            ingested = ingestResult.updated;
          }

          console.log('✅ Analysis complete!');

          return {
            model_path,
            views_analyzed: views,
            renders: renderResult.renders,
            descriptions,
            global_description: globalDescription,
            processing_time_ms: Date.now() - startTime,
            mode: 'standalone',
            ingested,
          };
        } catch (err: any) {
          console.warn(`[analyze_3d_model] Failed to synthesize description: ${err.message}`);
        }
      }

      console.log('✅ Analysis complete!');

      return {
        model_path,
        views_analyzed: views,
        renders: renderResult.renders,
        descriptions,
        global_description: globalDescription,
        processing_time_ms: Date.now() - startTime,
        mode: 'standalone',
        ingested: false,
      };
    } catch (err: any) {
      return { error: `Analysis failed: ${err.message}` };
    }
  };
}

// ============================================
// Export All 3D Tools
// ============================================

export interface ThreeDToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all 3D tools with handlers
 */
export function generate3DTools(ctx: ThreeDToolsContext): ThreeDToolsResult {
  return {
    tools: [
      generateRender3DAssetTool(),
      generateGenerate3DFromImageTool(),
      generateGenerate3DFromTextTool(),
      generateAnalyze3DModelTool(),
    ],
    handlers: {
      render_3d_asset: generateRender3DAssetHandler(ctx),
      generate_3d_from_image: generateGenerate3DFromImageHandler(ctx),
      generate_3d_from_text: generateGenerate3DFromTextHandler(ctx),
      analyze_3d_model: generateAnalyze3DModelHandler(ctx as ThreeDAnalyzeContext),
    },
  };
}
