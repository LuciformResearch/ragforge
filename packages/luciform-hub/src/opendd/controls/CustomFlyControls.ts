import * as THREE from 'three';
import { inputManager, KeyCode, MouseButton } from './InputManager';

export class CustomFlyControls {
    public enabled: boolean = true;
    camera: THREE.PerspectiveCamera;
    yaw: number = 0;
    pitch: number = 0;
    viewSensivity: number = 0.0025;
    moveSpeed: number = 50.0; // Increased default speed
    pitchMinAngle: number = -Math.PI * 0.5;
    pitchMaxAngle: number = Math.PI * 0.5;
    
    private direction: THREE.Vector3 = new THREE.Vector3();

    constructor(camera: THREE.PerspectiveCamera) {
        this.camera = camera;
        
        // Use arrow function to maintain `this` context
        inputManager.MouseMoveEvent.addListener(this, (args) => {
            if (!this.enabled) return;
            if (inputManager.IsMouseButtonDown(MouseButton.Left)) {
                let dx = args.evt.movementX;
                let dy = args.evt.movementY;
                this.yaw -= dx * this.viewSensivity; // Inverted yaw for standard FPS controls
                this.pitch -= dy * this.viewSensivity;
                
                this.pitch = Math.max(this.pitchMinAngle, Math.min(this.pitchMaxAngle, this.pitch));
            }
        });

        inputManager.MouseWheelEvent.addListener(this, (args) => {
            if (!this.enabled) return;
            // Original code has reversed wheel direction and sensitive scaling, using a simpler model
            this.moveSpeed *= (1 - args.wheelDelta / 2000);
            this.moveSpeed = Math.max(0.01, this.moveSpeed);
        });
    }

    private updateRotation() {
        const quatX = new THREE.Quaternion();
        quatX.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
        
        const quatY = new THREE.Quaternion();
        quatY.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        
        // Order is important: Y rotation (yaw) first, then X rotation (pitch)
        this.camera.quaternion.copy(quatY).multiply(quatX);
    }
    
    private updateTranslation(deltaTime: number) {
        this.direction.set(0, 0, 0);
        const globalDirection = new THREE.Vector3(0, 0, 0);

        const useY = inputManager.IsDown(KeyCode.shift);

        if (inputManager.IsDown(KeyCode.e) || inputManager.IsDown(KeyCode.spacebar) || inputManager.IsDown(KeyCode.r)) {
            globalDirection.y += 1.0;
        }
        if (inputManager.IsDown(KeyCode.c) || inputManager.IsDown(KeyCode.ctrl)) {
            globalDirection.y -= 1.0;
        }

        if (inputManager.IsDown(KeyCode.w) || inputManager.IsDown(KeyCode.z)) {
            if (!useY) {
                this.direction.z = -1.0;
            } else {
                globalDirection.y += 1.0;
            }
        }
        if (inputManager.IsDown(KeyCode.s)) {
            if (!useY) {
                this.direction.z = 1.0;
            } else {
                globalDirection.y -= 1.0;
            }
        }
        if (inputManager.IsDown(KeyCode.d)) {
            this.direction.x = 1.0;
        }
        if (inputManager.IsDown(KeyCode.a) || inputManager.IsDown(KeyCode.q)) {
            this.direction.x = -1.0;
        }

        if (this.direction.lengthSq() === 0 && globalDirection.lengthSq() === 0) {
            return;
        }
        
        const moveDirection = this.direction.clone().applyQuaternion(this.camera.quaternion);
        moveDirection.add(globalDirection);
        moveDirection.normalize().multiplyScalar(deltaTime * this.moveSpeed);
        
        this.camera.position.add(moveDirection);
    }

    Update(deltaTime: number) {
        if (!this.enabled) return;
        this.updateRotation();
        this.updateTranslation(deltaTime);
    }
}
