'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

// Constants for instanced systems
const PARTICLE_COUNT = 150;
const VOXEL_COUNT = 200; // More voxels needed for full octree hierarchy

interface Node {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  connections: number[];
  mesh: THREE.Mesh;
  baseY: number;
  phase: number;
  type: 'agent' | 'data' | 'hub';
}

export function GraphBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const linesRef = useRef<THREE.LineSegments | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const scrollRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef<number>(0);
  const pulseRef = useRef<THREE.Mesh[]>([]);
  const printStyleRef = useRef<HTMLStyleElement | null>(null);
  const capturedOnceRef = useRef(false);
  const lastGlitchTimeRef = useRef<number[]>([]);
  const glitchStateRef = useRef<{ active: boolean; startTime: number; originalRotation: THREE.Euler; originalScale: number; originalPosition: THREE.Vector3 }[]>([]);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Instanced glitch particles
  const glitchParticlesRef = useRef<THREE.InstancedMesh | null>(null);
  const particleDataRef = useRef<{ active: boolean; life: number; maxLife: number; velocity: THREE.Vector3; targetNode: number }[]>([]);

  // Voxel octree glitch system
  const voxelMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const voxelDataRef = useRef<{ active: boolean; life: number; maxLife: number; nodeIndex: number; gridSize: number }[]>([]);

  const createGraph = useCallback(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const nodes: Node[] = [];
    const nodeCount = 60;

    // Create different node types for agents, data, hubs
    const createNodeGeometry = (type: 'agent' | 'data' | 'hub') => {
      switch (type) {
        case 'agent':
          // Octahedron for agents (diamond shape)
          return new THREE.OctahedronGeometry(0.12, 0);
        case 'hub':
          // Icosahedron for hubs (complex)
          return new THREE.IcosahedronGeometry(0.18, 0);
        case 'data':
        default:
          // Small cube for data nodes
          return new THREE.BoxGeometry(0.08, 0.08, 0.08);
      }
    };

    const getNodeColor = (type: 'agent' | 'data' | 'hub') => {
      switch (type) {
        case 'agent': return 0x00ffff; // Cyan
        case 'hub': return 0xff00ff;   // Magenta
        case 'data': return 0x00ff88;  // Green
      }
    };

    // Create nodes
    for (let i = 0; i < nodeCount; i++) {
      const type = i < 8 ? 'hub' : (i < 25 ? 'agent' : 'data');
      const geometry = createNodeGeometry(type);
      const material = new THREE.MeshBasicMaterial({
        color: getNodeColor(type),
        transparent: true,
        opacity: type === 'hub' ? 0.9 : 0.7,
        wireframe: type === 'hub',
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Distribute in 3D space
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = type === 'hub' ? 2 + Math.random() * 2 : 3 + Math.random() * 5;

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = (Math.random() - 0.5) * 8;
      const z = radius * Math.sin(phi) * Math.sin(theta) - 6;

      mesh.position.set(x, y, z);
      scene.add(mesh);

      nodes.push({
        position: mesh.position,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.003,
          (Math.random() - 0.5) * 0.003,
          (Math.random() - 0.5) * 0.003
        ),
        connections: [],
        mesh,
        baseY: y,
        phase: Math.random() * Math.PI * 2,
        type,
      });
    }

    // Create connections - agents connect to hubs, data connects to agents
    const maxDistance = 3;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dist = nodes[i].position.distanceTo(nodes[j].position);
        if (dist < maxDistance && nodes[i].connections.length < 5) {
          // Prioritize hub connections
          if (nodes[i].type === 'hub' || nodes[j].type === 'hub' || Math.random() > 0.5) {
            nodes[i].connections.push(j);
            nodes[j].connections.push(i);
          }
        }
      }
    }

    nodesRef.current = nodes;

    // Initialize glitch state for each node
    lastGlitchTimeRef.current = nodes.map(() => 0);
    glitchStateRef.current = nodes.map(() => ({
      active: false,
      startTime: 0,
      originalRotation: new THREE.Euler(),
      originalScale: 1,
      originalPosition: new THREE.Vector3()
    }));

    updateLines();
  }, []);

  const createCyberGrid = useCallback(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const grid = new THREE.Group();

    // Main grid lines
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.15,
    });

    const gridSize = 30;
    const gridDivisions = 30;
    const step = gridSize / gridDivisions;

    const gridGeometry = new THREE.BufferGeometry();
    const gridPositions: number[] = [];

    for (let i = -gridSize / 2; i <= gridSize / 2; i += step) {
      // X lines
      gridPositions.push(-gridSize / 2, -5, i);
      gridPositions.push(gridSize / 2, -5, i);
      // Z lines
      gridPositions.push(i, -5, -gridSize / 2);
      gridPositions.push(i, -5, gridSize / 2);
    }

    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
    const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial);
    grid.add(gridLines);

    // Add glowing accent lines
    const accentMaterial = new THREE.LineBasicMaterial({
      color: 0xff00ff,
      transparent: true,
      opacity: 0.3,
    });

    const accentGeometry = new THREE.BufferGeometry();
    const accentPositions: number[] = [];

    for (let i = -gridSize / 2; i <= gridSize / 2; i += step * 5) {
      accentPositions.push(-gridSize / 2, -4.98, i);
      accentPositions.push(gridSize / 2, -4.98, i);
      accentPositions.push(i, -4.98, -gridSize / 2);
      accentPositions.push(i, -4.98, gridSize / 2);
    }

    accentGeometry.setAttribute('position', new THREE.Float32BufferAttribute(accentPositions, 3));
    const accentLines = new THREE.LineSegments(accentGeometry, accentMaterial);
    grid.add(accentLines);

    scene.add(grid);
    gridRef.current = grid;
  }, []);

  // Create instanced glitch particles with per-instance colors
  const createGlitchParticles = useCallback(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;

    // Small box geometry for particles
    const particleGeometry = new THREE.BoxGeometry(0.025, 0.025, 0.025);
    const particleMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.InstancedMesh(particleGeometry, particleMaterial, PARTICLE_COUNT);
    particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particles.frustumCulled = false; // Important: disable culling for dynamic instances

    // Initialize all particles as inactive (scale 0) with random colors
    const matrix = new THREE.Matrix4();
    const zeroScale = new THREE.Vector3(0, 0, 0);
    const defaultPos = new THREE.Vector3(0, 0, 0);
    const defaultQuat = new THREE.Quaternion();
    const colors = [
      new THREE.Color(0x00ffff), // Cyan
      new THREE.Color(0xff00ff), // Magenta
      new THREE.Color(0x00ff88), // Green
      new THREE.Color(0xffffff), // White
    ];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      matrix.compose(defaultPos, defaultQuat, zeroScale);
      particles.setMatrixAt(i, matrix);
      particles.setColorAt(i, colors[i % colors.length]);
    }
    particles.instanceMatrix.needsUpdate = true;
    if (particles.instanceColor) particles.instanceColor.needsUpdate = true;

    scene.add(particles);
    glitchParticlesRef.current = particles;

    // Initialize particle data
    particleDataRef.current = Array(PARTICLE_COUNT).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0,
      velocity: new THREE.Vector3(),
      targetNode: -1,
    }));
  }, []);

  // Create instanced voxel octree mesh with per-instance colors
  const createVoxelSystem = useCallback(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;

    // Wireframe box for voxels (octree style)
    const voxelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const voxelMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.6,
      wireframe: true,
    });

    const voxels = new THREE.InstancedMesh(voxelGeometry, voxelMaterial, VOXEL_COUNT);
    voxels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    voxels.frustumCulled = false; // Important: disable culling for dynamic instances

    // Initialize all voxels as inactive (scale 0) with random colors
    const matrix = new THREE.Matrix4();
    const zeroScale = new THREE.Vector3(0, 0, 0);
    const defaultPos = new THREE.Vector3(0, 0, 0);
    const defaultQuat = new THREE.Quaternion();
    const colors = [
      new THREE.Color(0x00ffff), // Cyan
      new THREE.Color(0xff00ff), // Magenta
      new THREE.Color(0x00ff88), // Green
    ];

    for (let i = 0; i < VOXEL_COUNT; i++) {
      matrix.compose(defaultPos, defaultQuat, zeroScale);
      voxels.setMatrixAt(i, matrix);
      voxels.setColorAt(i, colors[i % colors.length]);
    }
    voxels.instanceMatrix.needsUpdate = true;
    if (voxels.instanceColor) voxels.instanceColor.needsUpdate = true;

    scene.add(voxels);
    voxelMeshRef.current = voxels;

    // Initialize voxel data
    voxelDataRef.current = Array(VOXEL_COUNT).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0,
      nodeIndex: -1,
      gridSize: 1,
    }));
  }, []);

  const createPulseRings = useCallback(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const pulses: THREE.Mesh[] = [];

    // Create pulse rings at random positions
    for (let i = 0; i < 5; i++) {
      const ringGeometry = new THREE.RingGeometry(0.5, 0.55, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x00ffff : 0xff00ff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      });

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 6,
        -5 + (Math.random() - 0.5) * 6
      );
      ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
      ring.rotation.y = Math.random() * Math.PI;

      scene.add(ring);
      pulses.push(ring);
    }

    pulseRef.current = pulses;
  }, []);

  const updateLines = useCallback(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const nodes = nodesRef.current;

    if (linesRef.current) {
      scene.remove(linesRef.current);
      linesRef.current.geometry.dispose();
    }

    const positions: number[] = [];
    const colors: number[] = [];

    for (let i = 0; i < nodes.length; i++) {
      for (const j of nodes[i].connections) {
        if (j > i) {
          positions.push(
            nodes[i].position.x, nodes[i].position.y, nodes[i].position.z,
            nodes[j].position.x, nodes[j].position.y, nodes[j].position.z
          );

          // Color based on connection type
          let color: THREE.Color;
          if (nodes[i].type === 'hub' || nodes[j].type === 'hub') {
            color = new THREE.Color(0xff00ff); // Magenta for hub connections
          } else if (nodes[i].type === 'agent' || nodes[j].type === 'agent') {
            color = new THREE.Color(0x00ffff); // Cyan for agent connections
          } else {
            color = new THREE.Color(0x00ff88); // Green for data
          }

          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });

    const lines = new THREE.LineSegments(geometry, material);
    scene.add(lines);
    linesRef.current = lines;
  }, []);

  // Capture canvas to dataURL for print background
  const captureForPrint = useCallback(() => {
    if (!rendererRef.current || capturedOnceRef.current) return;

    const canvas = rendererRef.current.domElement;
    const dataURL = canvas.toDataURL('image/png', 0.9);

    // Create or update print style
    if (!printStyleRef.current) {
      printStyleRef.current = document.createElement('style');
      document.head.appendChild(printStyleRef.current);
    }

    printStyleRef.current.textContent = `
      @media print {
        @page {
          margin: 0;
          size: A4;
        }

        html {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        body {
          background: url(${dataURL}) !important;
          background-size: cover !important;
          background-repeat: repeat-y !important;
          background-position: center center !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
    `;

    capturedOnceRef.current = true;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    // Add fog for depth
    scene.fog = new THREE.FogExp2(0x000811, 0.08);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.z = 6;
    camera.position.y = 1;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000811, 1);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    createGraph();
    createCyberGrid();
    createPulseRings();
    createGlitchParticles();
    createVoxelSystem();

    let time = 0;
    let frameCount = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      time += 0.008;
      frameCount++;

      // Capture after a few frames for print background (when scene is ready)
      if (frameCount === 60) {
        captureForPrint();
      }

      const nodes = nodesRef.current;
      const scroll = scrollRef.current;
      const mouse = mouseRef.current;

      // Update nodes with glitch effect
      const currentTime = performance.now();
      const isScrolling = isScrollingRef.current;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const glitchState = glitchStateRef.current[i];
        const lastGlitchTime = lastGlitchTimeRef.current[i];

        // Floating motion
        node.mesh.position.y = node.baseY + Math.sin(time * 2 + node.phase) * 0.15;

        // Rotation for geometric shapes (normal rotation)
        const baseRotationSpeed = 0.01;
        node.mesh.rotation.x += baseRotationSpeed;
        node.mesh.rotation.y += baseRotationSpeed * 1.5;

        // Add velocity
        node.mesh.position.add(node.velocity);

        // Scroll effect
        const scrollEffect = scroll * 0.0008;
        node.mesh.position.x += Math.sin(scrollEffect * 2 + i * 0.1) * 0.002;

        // Mouse influence
        const mouseInfluence = node.type === 'hub' ? 0.001 : 0.0003;
        node.mesh.position.x += (mouse.x * 3 - node.mesh.position.x) * mouseInfluence;
        node.mesh.position.y += (mouse.y * 2 - node.mesh.position.y) * mouseInfluence;

        // Boundaries
        if (Math.abs(node.mesh.position.x) > 10) node.velocity.x *= -1;
        if (Math.abs(node.mesh.position.y) > 6) node.velocity.y *= -1;
        if (node.mesh.position.z > 2 || node.mesh.position.z < -15) node.velocity.z *= -1;

        // Base pulse scale
        const basePulseScale = node.type === 'hub'
          ? 1 + Math.sin(time * 3 + node.phase) * 0.3
          : 1 + Math.sin(time * 4 + node.phase) * 0.15;

        // === GLITCH SYSTEM ===
        const glitchInterval = 500 + Math.random() * 200; // 0.5-0.7 seconds
        const glitchDuration = 80 + Math.random() * 40; // 80-120ms glitch duration
        const baseGlitchChance = 0.015; // Base chance per frame
        const scrollGlitchBoost = isScrolling ? 3.5 : 1; // 3.5x more likely while scrolling

        // Check if we should start a new glitch
        const timeSinceLastGlitch = currentTime - lastGlitchTime;
        const shouldGlitch = !glitchState.active &&
          timeSinceLastGlitch > glitchInterval &&
          Math.random() < baseGlitchChance * scrollGlitchBoost;

        if (shouldGlitch) {
          // Start new glitch
          glitchState.active = true;
          glitchState.startTime = currentTime;
          glitchState.originalRotation.copy(node.mesh.rotation);
          glitchState.originalScale = basePulseScale;
          glitchState.originalPosition.copy(node.mesh.position);
          lastGlitchTimeRef.current[i] = currentTime;
        }

        // Apply glitch effect if active
        if (glitchState.active) {
          const glitchProgress = (currentTime - glitchState.startTime) / glitchDuration;

          if (glitchProgress >= 1) {
            // End glitch - restore original values
            glitchState.active = false;
            node.mesh.scale.setScalar(basePulseScale);
          } else {
            // Apply glitch distortions
            const glitchIntensity = Math.sin(glitchProgress * Math.PI); // Smooth in/out

            // Random rotation glitch (like a "bug")
            const rotationGlitch = (Math.random() - 0.5) * Math.PI * 0.5 * glitchIntensity;
            node.mesh.rotation.x = glitchState.originalRotation.x + rotationGlitch;
            node.mesh.rotation.z = glitchState.originalRotation.z + rotationGlitch * 0.7;

            // Random scale glitch
            const scaleGlitch = 1 + (Math.random() - 0.5) * 0.6 * glitchIntensity;
            node.mesh.scale.setScalar(basePulseScale * scaleGlitch);

            // Position jitter (small displacement)
            const positionJitter = 0.15 * glitchIntensity;
            node.mesh.position.x += (Math.random() - 0.5) * positionJitter;
            node.mesh.position.y += (Math.random() - 0.5) * positionJitter;
            node.mesh.position.z += (Math.random() - 0.5) * positionJitter * 0.5;

            // Brief opacity flicker for the mesh material
            const material = node.mesh.material as THREE.MeshBasicMaterial;
            if (Math.random() < 0.3 * glitchIntensity) {
              material.opacity = 0.3 + Math.random() * 0.4;
            } else {
              material.opacity = node.type === 'hub' ? 0.9 : 0.7;
            }
          }
        } else {
          // Normal state - apply base pulse scale
          node.mesh.scale.setScalar(basePulseScale);
        }
      }

      // Update pulse rings
      for (const pulse of pulseRef.current) {
        const scale = 1 + Math.sin(time * 2) * 0.5;
        pulse.scale.setScalar(scale);
        (pulse.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - Math.sin(time * 2) * 0.5);
        pulse.rotation.z += 0.01;
      }

      // === UPDATE GLITCH PARTICLES (Instanced) ===
      if (glitchParticlesRef.current) {
        const particles = glitchParticlesRef.current;
        const particleData = particleDataRef.current;
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        let particlesNeedUpdate = false;

        // Spawn particles when nodes glitch - fewer, slower particles
        for (let i = 0; i < nodes.length; i++) {
          const glitchState = glitchStateRef.current[i];
          if (glitchState.active) {
            // Only 20% chance to spawn particles per frame, 1-3 at a time
            if (Math.random() < 0.2) {
              const particlesToSpawn = 1 + Math.floor(Math.random() * 2);
              let spawned = 0;

              for (let p = 0; p < particleData.length && spawned < particlesToSpawn; p++) {
                if (!particleData[p].active) {
                  const node = nodes[i];
                  particleData[p].active = true;
                  particleData[p].life = 0;
                  particleData[p].maxLife = 40 + Math.random() * 50; // 40-90 frames (longer life)
                  particleData[p].targetNode = i;
                  // Much slower velocity
                  particleData[p].velocity.set(
                    (Math.random() - 0.5) * 0.03,
                    (Math.random() - 0.5) * 0.03,
                    (Math.random() - 0.5) * 0.03
                  );

                  // Position at node with small offset
                  position.copy(node.mesh.position);
                  position.x += (Math.random() - 0.5) * 0.25;
                  position.y += (Math.random() - 0.5) * 0.25;
                  position.z += (Math.random() - 0.5) * 0.25;

                  const particleScale = 0.4 + Math.random() * 0.8;
                  scale.set(particleScale, particleScale, particleScale);
                  quaternion.setFromEuler(new THREE.Euler(
                    Math.random() * Math.PI,
                    Math.random() * Math.PI,
                    Math.random() * Math.PI
                  ));

                  matrix.compose(position, quaternion, scale);
                  particles.setMatrixAt(p, matrix);
                  particlesNeedUpdate = true;
                  spawned++;
                }
              }
            }
          }
        }

        // Update active particles
        for (let p = 0; p < particleData.length; p++) {
          if (particleData[p].active) {
            particleData[p].life++;

            if (particleData[p].life >= particleData[p].maxLife) {
              // Deactivate particle (scale to 0)
              particleData[p].active = false;
              scale.set(0, 0, 0);
              matrix.compose(position, quaternion, scale);
              particles.setMatrixAt(p, matrix);
              particlesNeedUpdate = true;
            } else {
              // Update particle position
              particles.getMatrixAt(p, matrix);
              matrix.decompose(position, quaternion, scale);

              // Apply velocity with some decay
              position.add(particleData[p].velocity);
              particleData[p].velocity.multiplyScalar(0.95);

              // Add jitter
              position.x += (Math.random() - 0.5) * 0.02;
              position.y += (Math.random() - 0.5) * 0.02;

              // Fade out scale
              const lifeRatio = 1 - particleData[p].life / particleData[p].maxLife;
              const newScale = lifeRatio * (0.5 + Math.random() * 0.5);
              scale.set(newScale, newScale, newScale);

              // Rotate randomly (glitch effect)
              quaternion.multiply(new THREE.Quaternion().setFromEuler(
                new THREE.Euler(Math.random() * 0.3, Math.random() * 0.3, Math.random() * 0.3)
              ));

              matrix.compose(position, quaternion, scale);
              particles.setMatrixAt(p, matrix);
              particlesNeedUpdate = true;
            }
          }
        }

        if (particlesNeedUpdate) {
          particles.instanceMatrix.needsUpdate = true;
        }
      }

      // === UPDATE VOXEL OCTREE SYSTEM (Instanced) ===
      if (voxelMeshRef.current) {
        const voxels = voxelMeshRef.current;
        const voxelData = voxelDataRef.current;
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        let voxelsNeedUpdate = false;

        // Get base radius for each node type (from geometry creation)
        const getNodeRadius = (type: 'agent' | 'data' | 'hub') => {
          switch (type) {
            case 'agent': return 0.12; // OctahedronGeometry radius
            case 'hub': return 0.18;   // IcosahedronGeometry radius
            case 'data': return 0.08 * 0.866; // BoxGeometry half-diagonal (0.08/2 * sqrt(3))
          }
        };

        // Spawn voxel octree when nodes glitch - show full hierarchy (rare)
        for (let i = 0; i < nodes.length; i++) {
          const glitchState = glitchStateRef.current[i];
          // Spawn octree at START of glitch only (within 20ms window) - only 15% of glitches
          if (glitchState.active && currentTime - glitchState.startTime < 20 && Math.random() < 0.15) {
            const node = nodes[i];
            const meshScale = node.mesh.scale.x; // Uniform scale
            const baseRadius = getNodeRadius(node.type);
            const actualRadius = baseRadius * meshScale;

            // Octree hierarchy: show ALL levels (parent + children)
            const maxLevel = node.type === 'hub' ? 2 : 1;
            const rootSize = actualRadius * 3; // Root bounding cube

            // Generate octree showing full hierarchy
            const generateOctreeHierarchy = (
              cx: number, cy: number, cz: number,
              size: number,
              level: number
            ) => {
              // Check sphere-box intersection
              const nodePos = node.mesh.position;
              const dx = cx - nodePos.x;
              const dy = cy - nodePos.y;
              const dz = cz - nodePos.z;
              const centerDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              const halfDiag = size * 0.866; // half diagonal of cube

              // Only show voxels that are close to the shape
              if (centerDist > actualRadius * 1.5 + halfDiag) return;

              // ALWAYS place a voxel at this level (to show hierarchy)
              for (let v = 0; v < voxelData.length; v++) {
                if (!voxelData[v].active) {
                  voxelData[v].active = true;
                  voxelData[v].life = 0;
                  // Stagger lifetime by level - parents appear first, fade last
                  const levelDelay = level * 8;
                  voxelData[v].maxLife = 50 + Math.random() * 30 + (maxLevel - level) * 15;
                  voxelData[v].nodeIndex = i;
                  voxelData[v].gridSize = size;

                  position.set(cx, cy, cz);
                  scale.set(size, size, size);
                  quaternion.identity();

                  matrix.compose(position, quaternion, scale);
                  voxels.setMatrixAt(v, matrix);
                  voxelsNeedUpdate = true;
                  break;
                }
              }

              // Subdivide if not at max level
              if (level < maxLevel) {
                const childSize = size / 2;
                const offset = childSize / 2;
                for (let ox = -1; ox <= 1; ox += 2) {
                  for (let oy = -1; oy <= 1; oy += 2) {
                    for (let oz = -1; oz <= 1; oz += 2) {
                      // Only subdivide octants that intersect shape
                      const childCx = cx + ox * offset;
                      const childCy = cy + oy * offset;
                      const childCz = cz + oz * offset;
                      const childDx = childCx - nodePos.x;
                      const childDy = childCy - nodePos.y;
                      const childDz = childCz - nodePos.z;
                      const childDist = Math.sqrt(childDx * childDx + childDy * childDy + childDz * childDz);

                      // Only recurse if this octant is near the shape
                      if (childDist < actualRadius * 1.8 + childSize * 0.866) {
                        generateOctreeHierarchy(childCx, childCy, childCz, childSize, level + 1);
                      }
                    }
                  }
                }
              }
            };

            // Start octree from node center
            generateOctreeHierarchy(
              node.mesh.position.x,
              node.mesh.position.y,
              node.mesh.position.z,
              rootSize,
              0
            );
          }
        }

        // Update active voxels
        for (let v = 0; v < voxelData.length; v++) {
          if (voxelData[v].active) {
            voxelData[v].life++;

            // Get current matrix first
            voxels.getMatrixAt(v, matrix);
            matrix.decompose(position, quaternion, scale);

            if (voxelData[v].life >= voxelData[v].maxLife) {
              // Deactivate voxel (scale to 0)
              voxelData[v].active = false;
              scale.set(0, 0, 0);
              matrix.compose(position, quaternion, scale);
              voxels.setMatrixAt(v, matrix);
              voxelsNeedUpdate = true;
            } else {
              const lifeRatio = voxelData[v].life / voxelData[v].maxLife;
              let currentScale = voxelData[v].gridSize;

              // Flicker effect - random scale jitter
              if (Math.random() < 0.3) {
                currentScale *= (0.7 + Math.random() * 0.6);
              }

              // Fade out near end of life
              if (lifeRatio > 0.6) {
                currentScale *= (1 - (lifeRatio - 0.6) / 0.4);
              }

              scale.set(currentScale, currentScale, currentScale);

              // Occasional position glitch
              if (Math.random() < 0.08) {
                position.x += (Math.random() - 0.5) * 0.15;
                position.y += (Math.random() - 0.5) * 0.15;
              }

              matrix.compose(position, quaternion, scale);
              voxels.setMatrixAt(v, matrix);
              voxelsNeedUpdate = true;
            }
          }
        }

        if (voxelsNeedUpdate) {
          voxels.instanceMatrix.needsUpdate = true;
        }
      }

      // Update grid opacity based on scroll
      if (gridRef.current) {
        gridRef.current.position.z = -scroll * 0.002;
      }

      // Update lines
      if (Math.floor(time * 10) % 5 === 0) {
        updateLines();
      }

      // Camera movement
      camera.position.y = 1 - scroll * 0.0003;
      camera.position.z = 6 + scroll * 0.001;
      camera.rotation.x = -0.1 + scroll * 0.00003;
      camera.rotation.y = Math.sin(time * 0.3) * 0.03 + mouse.x * 0.05;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    const handleScroll = () => {
      scrollRef.current = window.scrollY;

      // Mark as scrolling and set timeout to reset
      isScrollingRef.current = true;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };
    };

    // Re-capture on beforeprint in case user scrolled
    const handleBeforePrint = () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        // Render current frame
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        // Force re-capture
        capturedOnceRef.current = false;
        captureForPrint();
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('beforeprint', handleBeforePrint);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('beforeprint', handleBeforePrint);

      // Clean up scroll timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Clean up print style
      if (printStyleRef.current) {
        printStyleRef.current.remove();
        printStyleRef.current = null;
      }

      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [createGraph, updateLines, createCyberGrid, createPulseRings, createGlitchParticles, createVoxelSystem, captureForPrint]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 -z-10 pointer-events-none"
    />
  );
}
