'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Camera configurations for standard views
 * Copied from RagForge's threed-tools.ts
 */
interface ViewConfig {
  type: 'ortho' | 'perspective';
  direction: [number, number, number];
  up: [number, number, number];
}

const VIEW_CONFIGS: Record<string, ViewConfig> = {
  front: { type: 'ortho', direction: [0, 0, 1], up: [0, 1, 0] },
  back: { type: 'ortho', direction: [0, 0, -1], up: [0, 1, 0] },
  left: { type: 'ortho', direction: [-1, 0, 0], up: [0, 1, 0] },
  right: { type: 'ortho', direction: [1, 0, 0], up: [0, 1, 0] },
  top: { type: 'ortho', direction: [0, 1, 0], up: [0, 0, -1] },
  bottom: { type: 'ortho', direction: [0, -1, 0], up: [0, 0, 1] },
  perspective: { type: 'perspective', direction: [1, 0.6, 1], up: [0, 1, 0] },
};

interface ThreeDViewerProps {
  className?: string;
}

export function ThreeDViewer({ className = '' }: ThreeDViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const animationIdRef = useRef<number>(0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [capturedImages, setCapturedImages] = useState<Array<{ view: string; dataUrl: string }>>([]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1e293b, 1); // slate-800
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, -5, -5);
    scene.add(backLight);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(5, 3, 5);
    cameraRef.current = camera;

    // Controls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Animation loop
    function animate() {
      animationIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationIdRef.current);
      renderer.dispose();
      controls.dispose();
    };
  }, []);

  // Load model from file
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !sceneRef.current) return;

    setIsLoading(true);
    setError(null);
    setCapturedImages([]);

    // Remove previous model
    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current);
      modelRef.current = null;
    }

    const fileName = file.name.toLowerCase();
    const ext = fileName.substring(fileName.lastIndexOf('.'));

    try {
      const url = URL.createObjectURL(file);

      let loadedModel: THREE.Object3D;

      if (ext === '.glb' || ext === '.gltf') {
        const loader = new GLTFLoader();
        const gltf = await new Promise<any>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });
        loadedModel = gltf.scene;
      } else if (ext === '.obj') {
        const loader = new OBJLoader();
        loadedModel = await new Promise<THREE.Object3D>((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });
        // Apply default material to OBJ
        loadedModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: 0x888888 });
          }
        });
      } else {
        throw new Error(`Unsupported format: ${ext}`);
      }

      URL.revokeObjectURL(url);

      sceneRef.current.add(loadedModel);
      modelRef.current = loadedModel;
      setModelName(file.name);

      // Auto-frame the model
      frameModel(loadedModel, 'perspective');

    } catch (err: any) {
      setError(err.message || 'Failed to load model');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Frame the model to fit in view - adapted from RagForge's threed-tools.ts
   */
  const frameModel = useCallback((model: THREE.Object3D, view: string) => {
    if (!cameraRef.current || !rendererRef.current || !controlsRef.current) return;

    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const controls = controlsRef.current;

    const viewConfig = VIEW_CONFIGS[view] || VIEW_CONFIGS.perspective;
    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    const aspect = width / height;

    // Calculate world bounding box
    const worldBox = new THREE.Box3().setFromObject(model);
    const worldCenter = worldBox.getCenter(new THREE.Vector3());
    const worldSize = worldBox.getSize(new THREE.Vector3());
    const halfSize = worldSize.clone().multiplyScalar(0.5);

    // Get the 8 corners of the bounding box
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

    // PERSPECTIVE VIEW - Thales-based optimal distance
    const fov = 45;
    const viewDir = new THREE.Vector3(...viewConfig.direction).normalize();

    // Initial distance estimate
    const initialDistance = halfSize.length() * 3;

    // Position camera
    camera.fov = fov;
    camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(initialDistance));
    camera.up.set(0, 1, 0);
    camera.lookAt(worldCenter);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // Project corners to NDC
    let minNdcX = Infinity, maxNdcX = -Infinity;
    let minNdcY = Infinity, maxNdcY = -Infinity;

    for (const corner of boxCorners) {
      const projected = corner.clone().project(camera);
      minNdcX = Math.min(minNdcX, projected.x);
      maxNdcX = Math.max(maxNdcX, projected.x);
      minNdcY = Math.min(minNdcY, projected.y);
      maxNdcY = Math.max(maxNdcY, projected.y);
    }

    // Scale factor to fit in view (target: fill 90% of frame)
    const ndcWidth = maxNdcX - minNdcX;
    const ndcHeight = maxNdcY - minNdcY;
    const targetSize = 1.8;
    const scaleFactor = targetSize / Math.max(ndcWidth, ndcHeight);

    // New distance
    const newDistance = initialDistance / scaleFactor;

    // Move camera to new distance
    camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(newDistance));
    camera.lookAt(worldCenter);
    camera.updateMatrixWorld();

    // Compute tangent-based centering
    const viewMatrix = camera.matrixWorldInverse;

    let minTanX = Infinity, maxTanX = -Infinity;
    let minTanY = Infinity, maxTanY = -Infinity;
    let finalMinDepth = Infinity, finalMaxDepth = -Infinity;

    for (const corner of boxCorners) {
      const camSpacePoint = corner.clone().applyMatrix4(viewMatrix);
      const depth = -camSpacePoint.z;
      if (depth > 0) {
        const tanX = camSpacePoint.x / depth;
        const tanY = camSpacePoint.y / depth;
        minTanX = Math.min(minTanX, tanX);
        maxTanX = Math.max(maxTanX, tanX);
        minTanY = Math.min(minTanY, tanY);
        maxTanY = Math.max(maxTanY, tanY);
        finalMinDepth = Math.min(finalMinDepth, depth);
        finalMaxDepth = Math.max(finalMaxDepth, depth);
      }
    }

    // Center the view
    const tanCenterX = (minTanX + maxTanX) / 2;
    const tanCenterY = (minTanY + maxTanY) / 2;

    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    const offsetX = tanCenterX * newDistance;
    const offsetY = tanCenterY * newDistance;

    camera.position.add(camRight.clone().multiplyScalar(offsetX));
    camera.position.add(camUp.clone().multiplyScalar(offsetY));

    const newLookAt = worldCenter.clone()
      .add(camRight.clone().multiplyScalar(offsetX))
      .add(camUp.clone().multiplyScalar(offsetY));
    camera.lookAt(newLookAt);

    // Update near/far
    camera.near = Math.max(0.001, finalMinDepth * 0.5);
    camera.far = finalMaxDepth * 2;
    camera.updateProjectionMatrix();

    // Update controls target
    controls.target.copy(worldCenter);
    controls.update();
  }, []);

  /**
   * Capture view using a separate renderer with square canvas (1024x1024)
   * This ensures proper gamma correction and color space handling
   */
  const captureView = useCallback((viewName: string) => {
    if (!sceneRef.current || !modelRef.current) return;

    const scene = sceneRef.current;
    const model = modelRef.current;

    const captureSize = 1024;

    // Create a separate canvas and renderer for capture
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = captureSize;
    captureCanvas.height = captureSize;

    const captureRenderer = new THREE.WebGLRenderer({
      canvas: captureCanvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    captureRenderer.setSize(captureSize, captureSize);
    captureRenderer.setClearColor(0x1e293b, 1);
    captureRenderer.outputColorSpace = THREE.SRGBColorSpace;

    // Create a separate camera for capture (square aspect)
    const captureCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    // Add temporary lights for capture
    const captureLights: THREE.Light[] = [];

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    captureLights.push(ambientLight);

    const frontLight = new THREE.DirectionalLight(0xffffff, 1.2);
    frontLight.position.set(5, 10, 7.5);
    scene.add(frontLight);
    captureLights.push(frontLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);
    captureLights.push(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, -5, 10);
    scene.add(rimLight);
    captureLights.push(rimLight);

    // Frame the model for this view with the capture camera
    const viewConfig = VIEW_CONFIGS[viewName] || VIEW_CONFIGS.perspective;

    // Calculate world bounding box
    const worldBox = new THREE.Box3().setFromObject(model);
    const worldCenter = worldBox.getCenter(new THREE.Vector3());
    const worldSize = worldBox.getSize(new THREE.Vector3());
    const halfSize = worldSize.clone().multiplyScalar(0.5);

    // Get bounding box corners
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

    const viewDir = new THREE.Vector3(...viewConfig.direction).normalize();
    const initialDistance = halfSize.length() * 3;

    // Position capture camera
    captureCamera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(initialDistance));
    captureCamera.up.set(0, 1, 0);
    captureCamera.lookAt(worldCenter);
    captureCamera.updateMatrixWorld();
    captureCamera.updateProjectionMatrix();

    // Project corners to NDC and calculate scale
    let minNdcX = Infinity, maxNdcX = -Infinity;
    let minNdcY = Infinity, maxNdcY = -Infinity;

    for (const corner of boxCorners) {
      const projected = corner.clone().project(captureCamera);
      minNdcX = Math.min(minNdcX, projected.x);
      maxNdcX = Math.max(maxNdcX, projected.x);
      minNdcY = Math.min(minNdcY, projected.y);
      maxNdcY = Math.max(maxNdcY, projected.y);
    }

    const ndcWidth = maxNdcX - minNdcX;
    const ndcHeight = maxNdcY - minNdcY;
    const targetSize = 1.8;
    const scaleFactor = targetSize / Math.max(ndcWidth, ndcHeight);
    const newDistance = initialDistance / scaleFactor;

    captureCamera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(newDistance));
    captureCamera.lookAt(worldCenter);
    captureCamera.updateMatrixWorld();

    // Compute tangent-based centering
    const viewMatrix = captureCamera.matrixWorldInverse;
    let minTanX = Infinity, maxTanX = -Infinity;
    let minTanY = Infinity, maxTanY = -Infinity;
    let finalMinDepth = Infinity, finalMaxDepth = -Infinity;

    for (const corner of boxCorners) {
      const camSpacePoint = corner.clone().applyMatrix4(viewMatrix);
      const depth = -camSpacePoint.z;
      if (depth > 0) {
        minTanX = Math.min(minTanX, camSpacePoint.x / depth);
        maxTanX = Math.max(maxTanX, camSpacePoint.x / depth);
        minTanY = Math.min(minTanY, camSpacePoint.y / depth);
        maxTanY = Math.max(maxTanY, camSpacePoint.y / depth);
        finalMinDepth = Math.min(finalMinDepth, depth);
        finalMaxDepth = Math.max(finalMaxDepth, depth);
      }
    }

    const tanCenterX = (minTanX + maxTanX) / 2;
    const tanCenterY = (minTanY + maxTanY) / 2;
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(captureCamera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(captureCamera.quaternion);

    captureCamera.position.add(camRight.clone().multiplyScalar(tanCenterX * newDistance));
    captureCamera.position.add(camUp.clone().multiplyScalar(tanCenterY * newDistance));

    const newLookAt = worldCenter.clone()
      .add(camRight.clone().multiplyScalar(tanCenterX * newDistance))
      .add(camUp.clone().multiplyScalar(tanCenterY * newDistance));
    captureCamera.lookAt(newLookAt);

    captureCamera.near = Math.max(0.001, finalMinDepth * 0.5);
    captureCamera.far = finalMaxDepth * 2;
    captureCamera.updateProjectionMatrix();

    // Render to the capture canvas
    captureRenderer.clear();
    captureRenderer.render(scene, captureCamera);

    // Get data URL directly from the canvas (proper gamma correction applied)
    const dataUrl = captureCanvas.toDataURL('image/png');

    // Cleanup
    captureRenderer.dispose();
    for (const light of captureLights) {
      scene.remove(light);
      light.dispose();
    }

    setCapturedImages(prev => {
      const existing = prev.findIndex(img => img.view === viewName);
      if (existing >= 0) {
        const newImages = [...prev];
        newImages[existing] = { view: viewName, dataUrl };
        return newImages;
      }
      return [...prev, { view: viewName, dataUrl }];
    });
  }, []);

  /**
   * Capture all standard views
   */
  const captureAllViews = useCallback(async () => {
    if (!modelRef.current) return;

    const views = ['front', 'right', 'back', 'perspective'];
    setCapturedImages([]);

    for (const view of views) {
      frameModel(modelRef.current, view);
      // Wait for render
      await new Promise(resolve => setTimeout(resolve, 100));
      captureView(view);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, [frameModel, captureView]);

  /**
   * Download captured image
   */
  const downloadImage = useCallback((image: { view: string; dataUrl: string }) => {
    const link = document.createElement('a');
    link.href = image.dataUrl;
    link.download = `${modelName || 'model'}_${image.view}.png`;
    link.click();
  }, [modelName]);

  /**
   * Download all captured images as ZIP
   */
  const downloadAllImages = useCallback(async () => {
    if (capturedImages.length === 0) return;

    // Simple download one by one (ZIP would require a library)
    for (const image of capturedImages) {
      downloadImage(image);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }, [capturedImages, downloadImage]);

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="bg-slate-800 px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
            Upload 3D Model
            <input
              type="file"
              accept=".glb,.gltf,.obj"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          {modelName && (
            <span className="text-slate-400 text-sm">{modelName}</span>
          )}
        </div>

        {modelRef.current && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => captureView('perspective')}
              className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded text-sm transition-colors"
            >
              Capture View
            </button>
            <button
              onClick={captureAllViews}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm transition-colors"
            >
              Capture All Views
            </button>
          </div>
        )}
      </div>

      {/* View buttons */}
      {modelRef.current && (
        <div className="bg-slate-850 px-4 py-2 flex flex-wrap gap-2 border-b border-slate-700">
          {Object.keys(VIEW_CONFIGS).map(view => (
            <button
              key={view}
              onClick={() => modelRef.current && frameModel(modelRef.current, view)}
              className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded text-xs transition-colors capitalize"
            >
              {view}
            </button>
          ))}
        </div>
      )}

      {/* 3D Canvas */}
      <div ref={containerRef} className="relative h-[400px]">
        <canvas ref={canvasRef} className="w-full h-full" />

        {isLoading && (
          <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center">
            <div className="text-white">Loading...</div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center">
            <div className="text-red-400">{error}</div>
          </div>
        )}

        {!modelRef.current && !isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-slate-500 text-center">
              <div className="text-4xl mb-2">📦</div>
              <div>Upload a .glb, .gltf, or .obj file</div>
            </div>
          </div>
        )}
      </div>

      {/* Captured Images */}
      {capturedImages.length > 0 && (
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Captured Images ({capturedImages.length})</h3>
            <button
              onClick={downloadAllImages}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Download All
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {capturedImages.map(image => (
              <div key={image.view} className="relative group">
                <img
                  src={image.dataUrl}
                  alt={image.view}
                  className="w-full aspect-square object-contain bg-slate-800 rounded"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => downloadImage(image)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs"
                  >
                    Download
                  </button>
                </div>
                <div className="text-center text-xs text-slate-400 mt-1 capitalize">{image.view}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="px-4 py-3 bg-slate-800/50 text-xs text-slate-500">
        <strong className="text-slate-400">Auto-framing:</strong> Camera automatically positions to fit the model perfectly in view.
        Uses Thales theorem for optimal perspective distance calculation.
      </div>
    </div>
  );
}
