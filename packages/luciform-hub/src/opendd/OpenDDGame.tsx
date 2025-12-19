'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GUI } from 'dat.gui';
import { inputManager, KeyCode } from './controls/InputManager';
import { CustomFlyControls } from './controls/CustomFlyControls';
import { Car } from './game/Car';

interface OpenDDGameProps {
  terrainMode: 'flat' | 'bumpy';
}

export function OpenDDGame({ terrainMode }: OpenDDGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<{
    renderer: THREE.WebGLRenderer;
    gui: GUI;
    animationId: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const FLAT_TERRAIN_MODE = terrainMode === 'flat';

    // --- App State ---
    let debugMode = false;

    // --- Physics Timestep ---
    const physics_dt = 1 / 60;
    let physics_accumulator = 0;

    // 1. Initialize scene, camera, renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(0, 10, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);

    inputManager.ListenDomElement(renderer.domElement);

    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    const debugControls = new CustomFlyControls(camera);
    debugControls.enabled = debugMode;

    const clock = new THREE.Clock();

    // 2. Add lights
    scene.add(new THREE.AmbientLight(0x404040, 2));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(1, 1, 0).normalize();
    scene.add(directionalLight);

    // --- Scene Setup ---
    const playerCar = new Car();
    playerCar.load().then(() => {
      scene.add(playerCar.container);
    });

    const loadingManager = new THREE.LoadingManager();
    const textureLoader = new THREE.TextureLoader(loadingManager);
    const cubeTextureLoader = new THREE.CubeTextureLoader(loadingManager);
    const objLoader = new OBJLoader(loadingManager);

    let asphaltTexture: THREE.Texture;
    let landTexture: THREE.Texture;
    let skyboxCubeMap: THREE.CubeTexture;

    textureLoader.load('/data/textures/asphalt.jpg', (texture) => asphaltTexture = texture);
    textureLoader.load('/data/textures/land.jpg', (texture) => landTexture = texture);

    const skyboxPaths = [
      '/data/textures/skybox/rt1.jpg', '/data/textures/skybox/lt1.jpg',
      '/data/textures/skybox/up1.jpg', '/data/textures/skybox/dn1.jpg',
      '/data/textures/skybox/ft1.jpg', '/data/textures/skybox/bk1.jpg'
    ];
    cubeTextureLoader.load(skyboxPaths, (cubeTexture) => skyboxCubeMap = cubeTexture);

    let landObj: THREE.Group<THREE.Object3DEventMap> | undefined = undefined;
    objLoader.load('/data/models/land.obj', (object) => {
      landObj = object;
    });

    let sidewalkModelObj: THREE.Group<THREE.Object3DEventMap> | undefined = undefined;
    if (FLAT_TERRAIN_MODE) {
      objLoader.load('/data/models/sidewalk_model.obj', (object) => {
        sidewalkModelObj = object;
      });
    }

    // --- GUI Setup ---
    const gui = new GUI({ autoPlace: false });
    if (containerRef.current) {
      gui.domElement.style.position = 'absolute';
      gui.domElement.style.top = '0';
      gui.domElement.style.right = '0';
      containerRef.current.appendChild(gui.domElement);
    }

    const carFolder = gui.addFolder('Car Physics');
    carFolder.open();

    const debugData = {
      posX: 0, posY: 0, posZ: 0,
      speed: 0, accel: 0, sens: 0,
      wheelAngle: 0, dirAngle: 0,
      netForceX: 0, netForceY: 0, netForceZ: 0,
      groundContact: false, currentSpeed: 0,
      carState: 'grounded', wheelsTouchingGround: 0,
      wheelFL_touching: false, wheelFL_distance: 0,
      wheelFR_touching: false, wheelFR_distance: 0,
      wheelRL_touching: false, wheelRL_distance: 0,
      wheelRR_touching: false, wheelRR_distance: 0,
    };

    carFolder.add(debugData, 'posX').listen().name('Position X');
    carFolder.add(debugData, 'posY').listen().name('Position Y');
    carFolder.add(debugData, 'posZ').listen().name('Position Z');
    carFolder.add(debugData, 'speed').listen().name('Speed');
    carFolder.add(debugData, 'currentSpeed').listen().name('Current Speed');
    carFolder.add(debugData, 'groundContact').listen().name('Ground Contact');
    carFolder.add(debugData, 'carState').listen().name('Car State');

    // Ground Adhesion folder
    const adhesionFolder = gui.addFolder('Ground Adhesion');
    adhesionFolder.open();
    const downforceBaseCtrl = adhesionFolder.add(playerCar, 'downforceBase', 0, 20, 0.5).name('Downforce Base');
    const downforceSpeedCtrl = adhesionFolder.add(playerCar, 'downforceSpeedMult', 0, 0.5, 0.01).name('Downforce Speed');
    const stickThresholdCtrl = adhesionFolder.add(playerCar, 'groundStickThreshold', 1, 10, 0.5).name('Stick Threshold');
    const maxUpwardVelCtrl = adhesionFolder.add(playerCar, 'maxUpwardVelocity', 0, 20, 0.5).name('Max Upward Vel');

    const adhesionDefaults = {
      resetToDefaults: () => {
        playerCar.downforceBase = 5.0;
        playerCar.downforceSpeedMult = 0.1;
        playerCar.groundStickThreshold = 3.0;
        playerCar.maxUpwardVelocity = 5.0;
        downforceBaseCtrl.updateDisplay();
        downforceSpeedCtrl.updateDisplay();
        stickThresholdCtrl.updateDisplay();
        maxUpwardVelCtrl.updateDisplay();
      }
    };
    adhesionFolder.add(adhesionDefaults, 'resetToDefaults').name('Reset Defaults');


    // --- Main Entry Point ---
    loadingManager.onLoad = () => {
      console.log("All assets loaded. Initializing scene...");

      let groundSize = 200;
      if (landObj) {
        const boundingBox = new THREE.Box3().setFromObject(landObj);
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        groundSize = Math.max(size.x, size.z) * 1.2;
      }

      asphaltTexture.wrapS = THREE.RepeatWrapping;
      asphaltTexture.wrapT = THREE.RepeatWrapping;
      asphaltTexture.repeat.set(groundSize / 10, groundSize / 10);

      const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 100, 100);
      const position = groundGeometry.attributes.position;

      if (!FLAT_TERRAIN_MODE) {
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i);
          const y = position.getY(i);
          position.setZ(i, (Math.sin(x * 0.1) * Math.cos(y * 0.1) * 5));
        }
      }
      groundGeometry.computeVertexNormals();

      const groundMaterial = new THREE.MeshStandardMaterial({ map: asphaltTexture });
      const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
      groundPlane.rotation.x = -Math.PI / 2;
      groundPlane.receiveShadow = true;
      scene.add(groundPlane);

      if (FLAT_TERRAIN_MODE && sidewalkModelObj) {
        const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
        sidewalkModelObj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = sidewalkMaterial;
            if (child.geometry) {
              child.geometry.computeBoundingBox();
              child.geometry.computeBoundingSphere();
            }
          }
        });
        sidewalkModelObj.scale.set(0.3, 0.3, 0.3);
        const boundingBox = new THREE.Box3().setFromObject(sidewalkModelObj);
        const yOffset = -boundingBox.min.y;
        sidewalkModelObj.position.set(0, yOffset, 20);
        sidewalkModelObj.receiveShadow = true;
        sidewalkModelObj.castShadow = true;
        scene.add(sidewalkModelObj);
      }

      if (landObj) {
        const landMaterial = new THREE.MeshStandardMaterial({ map: landTexture });
        landObj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = landMaterial;
            if (child.geometry) {
              child.geometry.computeBoundingBox();
              child.geometry.computeBoundingSphere();
            }
          }
        });
        landObj.position.y = 0.01;
        scene.add(landObj);
      }

      const groundObjects: THREE.Object3D[] = [groundPlane];
      if (sidewalkModelObj) groundObjects.push(sidewalkModelObj);
      if (landObj) groundObjects.push(landObj);
      playerCar.setGround(...groundObjects);

      scene.add(playerCar.container);
      scene.background = skyboxCubeMap;

      animate();
    };

    // --- Animation Loop ---
    function animate() {
      gameRef.current!.animationId = requestAnimationFrame(animate);
      const frameDelta = clock.getDelta();
      physics_accumulator += frameDelta;

      if (inputManager.IsJustDown(KeyCode.t)) {
        debugMode = !debugMode;
        if (debugMode) inputManager.reset();
        debugControls.enabled = debugMode;
      }

      if (!debugMode) {
        playerCar.accelerate(inputManager.IsDown(KeyCode.w) || inputManager.IsDown(KeyCode.z));
        playerCar.brake(inputManager.IsDown(KeyCode.s));
        playerCar.turnLeft(inputManager.IsDown(KeyCode.a) || inputManager.IsDown(KeyCode.q));
        playerCar.turnRight(inputManager.IsDown(KeyCode.d));
        playerCar.handbrake(inputManager.IsDown(KeyCode.spacebar));
      } else {
        playerCar.accelerate(false);
        playerCar.brake(false);
        playerCar.turnLeft(false);
        playerCar.turnRight(false);
        playerCar.handbrake(false);
      }

      while (physics_accumulator >= physics_dt) {
        playerCar.update(physics_dt);
        physics_accumulator -= physics_dt;
      }

      inputManager.Update();

      // Update GUI
      const carDebugInfo = playerCar.getDebugInfo();
      debugData.posX = playerCar.position.x;
      debugData.posY = playerCar.position.y;
      debugData.posZ = playerCar.position.z;
      debugData.speed = carDebugInfo.speed;
      debugData.currentSpeed = carDebugInfo.currentSpeed;
      debugData.groundContact = carDebugInfo.groundContact;
      debugData.carState = carDebugInfo.carState;

      // Camera
      if (debugMode) {
        debugControls.Update(frameDelta);
      } else {
        const carPosition = playerCar.position;
        const carRotation = playerCar.container.quaternion;
        const offset = new THREE.Vector3(0, 5, -10);
        offset.applyQuaternion(carRotation);
        const cameraPosition = carPosition.clone().add(offset);
        camera.position.copy(cameraPosition);
        camera.lookAt(carPosition);
      }

      renderer.render(scene, camera);
    }

    gameRef.current = { renderer, gui, animationId: 0 };

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (gameRef.current) {
        cancelAnimationFrame(gameRef.current.animationId);
        gameRef.current.gui.destroy();
        gameRef.current.renderer.dispose();
      }
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [terrainMode]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[700px] relative"
      tabIndex={0}
    />
  );
}
