import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'; // Keep import
import { inputManager, KeyCode } from './controls/InputManager';
import { CustomFlyControls } from './controls/CustomFlyControls';
import { Car } from './game/Car';
import { GUI } from 'dat.gui'; // Import dat.gui

// --- App State ---
let debugMode = false;

// Terrain mode - read from URL params or default to flat
const urlParams = new URLSearchParams(window.location.search);
const FLAT_TERRAIN_MODE = urlParams.get('terrain') !== 'bumpy';

// --- Physics Timestep ---
const physics_dt = 1 / 60; // Run physics at 60Hz
let physics_accumulator = 0;

// 1. Initialisation de la scène, caméra, renderer...
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 50);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app')?.appendChild(renderer.domElement);

inputManager.ListenDomElement(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const debugControls = new CustomFlyControls(camera);
debugControls.enabled = debugMode;

const clock = new THREE.Clock();

// 2. Ajout des lumières
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
const objLoader = new OBJLoader(loadingManager); // THIS LINE IS DELIBERATELY LEFT AS-IS based on user's instruction

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
const gui = new GUI();
const carFolder = gui.addFolder('Car Physics');
carFolder.open();

const debugData = {
    posX: 0, posY: 0, posZ: 0,
    speed: 0,
    accel: 0,
    sens: 0,
    wheelAngle: 0,
    dirAngle: 0,
    netForceX: 0,
    netForceY: 0,
    netForceZ: 0,
    groundContact: false,
    currentSpeed: 0,
    // New debug info
    carState: 'grounded',
    wheelsTouchingGround: 0,
    // Per-wheel info
    wheelFL_touching: false,
    wheelFL_distance: 0,
    wheelFR_touching: false,
    wheelFR_distance: 0,
    wheelRL_touching: false,
    wheelRL_distance: 0,
    wheelRR_touching: false,
    wheelRR_distance: 0,
};

carFolder.add(debugData, 'posX').listen().name('Position X');
carFolder.add(debugData, 'posY').listen().name('Position Y');
carFolder.add(debugData, 'posZ').listen().name('Position Z');
carFolder.add(debugData, 'speed').listen().name('Speed');
carFolder.add(debugData, 'accel').listen().name('Acceleration');
carFolder.add(debugData, 'sens').listen().name('Sens');
carFolder.add(debugData, 'wheelAngle').listen().name('Wheel Angle');
carFolder.add(debugData, 'dirAngle').listen().name('Direction Angle');
carFolder.add(debugData, 'netForceX').listen().name('Net Force X');
carFolder.add(debugData, 'netForceY').listen().name('Net Force Y');
carFolder.add(debugData, 'netForceZ').listen().name('Net Force Z');
carFolder.add(debugData, 'groundContact').listen().name('Ground Contact');
carFolder.add(debugData, 'currentSpeed').listen().name('Current Speed');
carFolder.add(debugData, 'carState').listen().name('Car State');
carFolder.add(debugData, 'wheelsTouchingGround').listen().name('Wheels Touching');

// Wheels folder
const wheelsFolder = gui.addFolder('Wheels Debug');
wheelsFolder.add(debugData, 'wheelFL_touching').listen().name('FL Touching');
wheelsFolder.add(debugData, 'wheelFL_distance').listen().name('FL Distance');
wheelsFolder.add(debugData, 'wheelFR_touching').listen().name('FR Touching');
wheelsFolder.add(debugData, 'wheelFR_distance').listen().name('FR Distance');
wheelsFolder.add(debugData, 'wheelRL_touching').listen().name('RL Touching');
wheelsFolder.add(debugData, 'wheelRL_distance').listen().name('RL Distance');
wheelsFolder.add(debugData, 'wheelRR_touching').listen().name('RR Touching');
wheelsFolder.add(debugData, 'wheelRR_distance').listen().name('RR Distance');

// Ground Adhesion folder (adjustable settings)
const adhesionFolder = gui.addFolder('Ground Adhesion');
adhesionFolder.open();
const downforceBaseCtrl = adhesionFolder.add(playerCar, 'downforceBase', 0, 20, 0.5).name('Downforce Base');
const downforceSpeedCtrl = adhesionFolder.add(playerCar, 'downforceSpeedMult', 0, 0.5, 0.01).name('Downforce Speed×');
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

// --- Terrain Mode Toggle ---
const terrainFolder = gui.addFolder('Terrain');
terrainFolder.open();
const terrainSettings = {
    mode: FLAT_TERRAIN_MODE ? 'Flat' : 'Bumpy',
    switchMode: () => {
        const newMode = FLAT_TERRAIN_MODE ? 'bumpy' : 'flat';
        window.location.href = `${window.location.pathname}?terrain=${newMode}`;
    }
};
terrainFolder.add(terrainSettings, 'mode').name('Current Mode').listen();
terrainFolder.add(terrainSettings, 'switchMode').name('Switch Terrain');

// --- Main Entry Point ---
loadingManager.onLoad = () => {
    console.log("All assets loaded. Initializing scene...");

    // 1. Calculate ground size based on landObj bounding box
    let groundSize = 200; // Default size
    if (landObj) {
        const boundingBox = new THREE.Box3().setFromObject(landObj);
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        groundSize = Math.max(size.x, size.z) * 1.2; // 20% margin
        console.log(`Land bounding box: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}, ground size: ${groundSize.toFixed(1)}`);
    }

    // 2. Build the ground with adapted size
    asphaltTexture.wrapS = THREE.RepeatWrapping; asphaltTexture.wrapT = THREE.RepeatWrapping;
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
    let groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Add sidewalk model for testing in flat terrain mode
    if (FLAT_TERRAIN_MODE && sidewalkModelObj) {
        const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });
        sidewalkModelObj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material = sidewalkMaterial;
                // Precompute bounding volumes for faster raycast culling
                if (child.geometry) {
                    child.geometry.computeBoundingBox();
                    child.geometry.computeBoundingSphere();
                }
            }
        });

        // Scale down the model to realistic size
        sidewalkModelObj.scale.set(0.3, 0.3, 0.3);

        // Calculate bounding box and adjust Y so bottom is at ground level
        const boundingBox = new THREE.Box3().setFromObject(sidewalkModelObj);
        const yOffset = -boundingBox.min.y; // Offset to bring min.y to 0
        sidewalkModelObj.position.set(0, yOffset, 20); // Place it in front of car start position

        sidewalkModelObj.receiveShadow = true;
        sidewalkModelObj.castShadow = true;
        scene.add(sidewalkModelObj);
        console.log(`Sidewalk model added at z=20, yOffset=${yOffset.toFixed(2)} (bbox min.y was ${boundingBox.min.y.toFixed(2)})`);
    }

    // 2. Add the scenery object
    if (landObj)
    {
        const landMaterial = new THREE.MeshStandardMaterial({ map: landTexture });
        landObj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material = landMaterial;
                // Precompute bounding volumes for faster raycast culling
                if (child.geometry) {
                    child.geometry.computeBoundingBox();
                    child.geometry.computeBoundingSphere();
                }
            }
        });
        landObj.position.y = 0.01;
        scene.add(landObj);
    }

    // Set ALL ground objects for collision in a single call
    const groundObjects: THREE.Object3D[] = [groundPlane];
    if (sidewalkModelObj) groundObjects.push(sidewalkModelObj);
    if (landObj) groundObjects.push(landObj);
    playerCar.setGround(...groundObjects);
    console.log(`Ground objects set: ${groundObjects.length} objects (groundPlane${sidewalkModelObj ? ', sidewalkModel' : ''}${landObj ? ', landObj' : ''})`);

    // 3. Add the car
    scene.add(playerCar.container);

    // 4. Set the skybox
    scene.background = skyboxCubeMap;

    // 5. Start the animation loop
    animate();
};

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  const frameDelta = clock.getDelta();
  physics_accumulator += frameDelta;

  // --- Handle Inputs ---
  if (inputManager.IsJustDown(KeyCode.t)) {
    debugMode = !debugMode;
    if(debugMode) inputManager.reset();
    debugControls.enabled = debugMode;
    console.log(`%cDebug mode set to: ${debugMode}`, 'color: #00ff00');
  }

  if (!debugMode) {
      playerCar.accelerate(inputManager.IsDown(KeyCode.w) || inputManager.IsDown(KeyCode.z));
      playerCar.brake(inputManager.IsDown(KeyCode.s));
      playerCar.turnLeft(inputManager.IsDown(KeyCode.a) || inputManager.IsDown(KeyCode.q));
      playerCar.turnRight(inputManager.IsDown(KeyCode.d));
      playerCar.handbrake(inputManager.IsDown(KeyCode.spacebar));
  } else {
      playerCar.accelerate(false); playerCar.brake(false); playerCar.turnLeft(false); playerCar.turnRight(false); playerCar.handbrake(false);
  }

  // --- Update World (Fixed Timestep) ---
  while (physics_accumulator >= physics_dt) {
    playerCar.update(physics_dt);
    physics_accumulator -= physics_dt;
  }
  
  inputManager.Update();

  // --- Update GUI ---
  const carDebugInfo = playerCar.getDebugInfo();
  debugData.posX = playerCar.position.x;
  debugData.posY = playerCar.position.y;
  debugData.posZ = playerCar.position.z;
  debugData.speed = carDebugInfo.speed;
  debugData.accel = carDebugInfo.acceleration;
  debugData.sens = carDebugInfo.sens;
  debugData.wheelAngle = carDebugInfo.wheelAngle;
  debugData.dirAngle = carDebugInfo.directionAngle;
  debugData.netForceX = carDebugInfo.netForce.x;
  debugData.netForceY = carDebugInfo.netForce.y;
  debugData.netForceZ = carDebugInfo.netForce.z;
  debugData.groundContact = carDebugInfo.groundContact;
  debugData.currentSpeed = carDebugInfo.currentSpeed;
  debugData.carState = carDebugInfo.carState;
  debugData.wheelsTouchingGround = carDebugInfo.wheelsTouchingGround;
  // Per-wheel info (raw values for debugging)
  debugData.wheelFL_touching = carDebugInfo.wheelFL_touching;
  debugData.wheelFL_distance = carDebugInfo.wheelFL_distance;
  debugData.wheelFR_touching = carDebugInfo.wheelFR_touching;
  debugData.wheelFR_distance = carDebugInfo.wheelFR_distance;
  debugData.wheelRL_touching = carDebugInfo.wheelRL_touching;
  debugData.wheelRL_distance = carDebugInfo.wheelRL_distance;
  debugData.wheelRR_touching = carDebugInfo.wheelRR_touching;
  debugData.wheelRR_distance = carDebugInfo.wheelRR_distance;

  // --- Camera & Debug Controls ---
  if (debugMode) {
    debugControls.Update(frameDelta); // Update debug controls once per frame with frameDelta
  } else {
    const carPosition = playerCar.position;
    const carRotation = playerCar.container.quaternion;
    const offset = new THREE.Vector3(0, 5, -10);
    offset.applyQuaternion(carRotation);
    const cameraPosition = carPosition.clone().add(offset);
    camera.position.copy(cameraPosition); // Increased camera lerp for responsiveness
    camera.lookAt(carPosition);
  }
  
  renderer.render(scene, camera);
}