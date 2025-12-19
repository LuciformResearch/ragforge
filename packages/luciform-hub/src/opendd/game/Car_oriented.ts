import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// --- Constants ---
const CAR_ACCEL_SPD = 25.0;
const CAR_MAX_SPD = 100.0;
const CAR_MAX_TURN = 0.25;
const CAR_MAX_ACCEL = 20.0;
const CAR_THRESHOLD = 1.0;
const LOW_SPEED_ROTATION_THRESHOLD = 10.0;
const STEER_SPEED = 2.5;

const CAR_ACCEL = 1, CAR_BRAKE = 2, CAR_TURN_LEFT = 4, CAR_TURN_RIGHT = 8, CAR_HANDBRAKE = 16;

export class Car_oriented {
    public container = new THREE.Group(); // Handles yaw and position
    private rollPitchPivot = new THREE.Group(); // Handles roll and pitch from terrain
    private isLoaded = false;
    public position = new THREE.Vector3(0, 0, 10);
    public velocity = new THREE.Vector3();
    private accelerationVec = new THREE.Vector3();
    public directionAngle = 0.0;
    private directionVec = new THREE.Vector3(0, 0, 1);
    public wheelAngle = 0.0;
    public speed = 0.0;
    public acceleration = 0.0;
    public state = 0;
    private sens = 0;
    private new_sens = 0;
    private adherence = 0.0;
    private body!: THREE.Mesh;
    private wheels: THREE.Mesh[] = [];
    private frontWheelPivots: THREE.Object3D[] = [];
    private ground: THREE.Mesh | null = null;

    constructor() {
        this.container.add(this.rollPitchPivot);
    }

    public setGround(groundMesh: THREE.Mesh) {
        this.ground = groundMesh;
    }

    public accelerate(on: boolean) { on ? this.state |= CAR_ACCEL : this.state &= ~CAR_ACCEL; }
    public brake(on: boolean) { on ? this.state |= CAR_BRAKE : this.state &= ~CAR_BRAKE; }
    public turnLeft(on: boolean) { on ? this.state |= CAR_TURN_LEFT : this.state &= ~CAR_TURN_LEFT; }
    public turnRight(on: boolean) { on ? this.state |= CAR_TURN_RIGHT: this.state &= ~CAR_TURN_RIGHT; }
    public handbrake(on: boolean) { on ? this.state |= CAR_HANDBRAKE : this.state &= ~CAR_HANDBRAKE; }

    public async load(): Promise<void> {
        if (this.isLoaded) return Promise.resolve();
        const loadingManager = new THREE.LoadingManager();
        const objLoader = new OBJLoader(loadingManager);
        const textureLoader = new THREE.TextureLoader(loadingManager);
        let carBodyModel: THREE.Group, wheelModel: THREE.Group, carBodyTexture: THREE.Texture, wheelTexture: THREE.Texture;
        objLoader.load('/data/models/car.obj', (model) => carBodyModel = model);
        objLoader.load('/data/models/wheel1-2.obj', (model) => wheelModel = model);
        textureLoader.load('/data/textures/car/car1.jpg', (texture) => carBodyTexture = texture);
        textureLoader.load('/data/textures/car/wheel2.jpg', (texture) => wheelTexture = texture);
        return new Promise((resolve) => {
            loadingManager.onLoad = () => {
                this.body = carBodyModel.children[0] as THREE.Mesh;
                this.body.material = new THREE.MeshStandardMaterial({ map: carBodyTexture });
                this.body.rotation.y = -Math.PI / 2;
                this.rollPitchPivot.add(this.body); // Add body to the new pivot

                const wheelGeometry = (wheelModel.children[0] as THREE.Mesh).geometry;
                const wheelMaterial = new THREE.MeshStandardMaterial({ map: wheelTexture });
                const wheelPositions = [
                    { x: -0.92, y: 0.37, z: 1.36, front: true, mirrored: false }, { x: 0.92, y: 0.37, z: 1.36, front: true, mirrored: true },
                    { x: -0.9, y: 0.37, z: -0.92, front: false, mirrored: false }, { x: 0.9, y: 0.37, z: -0.92, front: false, mirrored: true }
                ];
                wheelPositions.forEach((pos) => {
                    const wheelPivot = new THREE.Object3D();
                    wheelPivot.position.set(pos.x, pos.y, pos.z);
                    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
                    wheel.rotation.y = pos.mirrored ? Math.PI / 2 : -Math.PI / 2;
                    wheelPivot.add(wheel);
                    this.rollPitchPivot.add(wheelPivot); // Add wheel pivots to the new pivot
                    this.wheels.push(wheel);
                    if (pos.front) this.frontWheelPivots.push(wheelPivot);
                });
                
                this.container.position.copy(this.position);
                this.isLoaded = true;
                resolve();
            };
        });
    }

    private updateInputsAndState(dt: number) {
        // --- Steering ---
        if (this.state & CAR_TURN_LEFT) this.wheelAngle += STEER_SPEED * dt;
        else if (this.state & CAR_TURN_RIGHT) this.wheelAngle -= STEER_SPEED * dt;
        else this.wheelAngle -= this.wheelAngle * 5.0 * dt;
        this.wheelAngle = Math.max(-CAR_MAX_TURN, Math.min(this.wheelAngle, CAR_MAX_TURN));

        // Determine new_sens (intended direction) based on pedal
        if (this.state & CAR_ACCEL && !(this.state & CAR_BRAKE)) this.new_sens = 1;
        else if (this.state & CAR_BRAKE && !(this.state & CAR_ACCEL)) this.new_sens = -1;
        else this.new_sens = 0;

        // --- Handle acceleration/braking input on acceleration scalar ---
        if (this.state & CAR_ACCEL && !(this.state & CAR_BRAKE)) { // Accel pedal is pressed
            if (this.sens === 1 || this.sens === 0) { // Accelerating forward or starting from stop
                this.acceleration += CAR_ACCEL_SPD * dt;
            } else { // Moving backward, but pressing forward -> BRAKE, so acceleration should decay
                this.acceleration = 0; // Stop building acceleration
            }
        } else if (this.state & CAR_BRAKE && !(this.state & CAR_ACCEL)) { // Brake pedal is pressed
            if (this.sens === -1 || this.sens === 0) { // Accelerating backward or starting from stop
                this.acceleration += CAR_ACCEL_SPD * dt;
            } else { // Moving forward, but pressing brake -> BRAKE, so acceleration should decay
                this.acceleration = 0; // Stop building acceleration
            }
        } else { // No pedals pressed or both pressed (neutral)
            this.acceleration -= this.acceleration * 8.0 * dt; // Natural deceleration of acceleration scalar
        }
    }

    private updateForces(dt: number) {
        // --- Natural deceleration / friction (when no pedals are pressed) ---
        if (!(this.state & CAR_ACCEL) && !(this.state & CAR_BRAKE)) {
            this.velocity.x -= this.velocity.x * 0.5 * dt;
            this.velocity.z -= this.velocity.z * 0.5 * dt;
        }

        // --- Handbrake ---
        if (this.state & CAR_HANDBRAKE) {
            this.velocity.multiplyScalar(1.0 - (CAR_ACCEL_SPD * (1.5 - this.adherence) * ((1 / (this.speed + 0.1)) + 0.1) * dt));
            this.adherence = 1.0;
        } else {
            this.adherence -= this.adherence * 0.15 * dt;
            if(this.adherence < 0) this.adherence = 0;
        }

        this.acceleration = Math.max(-CAR_MAX_ACCEL, Math.min(this.acceleration, CAR_MAX_ACCEL));
        const wheelAbsoluteVec = new THREE.Vector3(Math.sin(this.directionAngle + this.wheelAngle), 0, Math.cos(this.directionAngle + this.wheelAngle));
        this.accelerationVec.copy(wheelAbsoluteVec).multiplyScalar(this.sens * this.acceleration);
        
        // --- Apply braking force directly to velocity if opposing pedal is pressed ---
        let isBraking = false;
        if ( (this.state & CAR_ACCEL && !(this.state & CAR_BRAKE) && this.sens === -1) || // Moving backward, pressing forward
             (this.state & CAR_BRAKE && !(this.state & CAR_ACCEL) && this.sens === 1) ) { // Moving forward, pressing backward
            isBraking = true;
            // C code braking force logic:
            const brakeFactor = CAR_ACCEL_SPD * 1.0 * ((1 / (this.speed + 0.1)) + 0.1) * dt;
            this.velocity.x -= this.velocity.x * brakeFactor;
            this.velocity.z -= this.velocity.z * brakeFactor; // Only X and Z components in C code
        }

        // Only add acceleration if not braking by opposing pedal
        if (!isBraking) {
            this.velocity.add(this.accelerationVec.clone().multiplyScalar(dt));
        } else {
             // If braking by opposing pedal, acceleration should be zeroed
             this.acceleration = 0;
        }
    }

    private updateSpeedAndDirection(dt: number) {
        this.speed = this.velocity.length();
        if (this.speed > CAR_MAX_SPD) {
            this.velocity.multiplyScalar(CAR_MAX_SPD / this.speed);
        }
        
        // --- Implement speed-dependent angular velocity (rotationSpeedFactor) ---
        let rotationSpeedFactor = 1.0;
        if (this.speed < LOW_SPEED_ROTATION_THRESHOLD) {
            // Linearly interpolate factor from 0 at 0 speed to 1 at LOW_SPEED_ROTATION_THRESHOLD
            rotationSpeedFactor = this.speed / LOW_SPEED_ROTATION_THRESHOLD;
        }

        // --- Direction update (yaw) ---
        this.directionAngle += (1.0 - (this.adherence / 2.0)) * this.sens * this.wheelAngle * 10.0 * rotationSpeedFactor * dt;
        this.directionAngle %= (2 * Math.PI); if (this.directionAngle < 0) this.directionAngle += (2 * Math.PI);
        this.directionVec.set(Math.sin(this.directionAngle), 0, Math.cos(this.directionAngle));
    }

    private applyAdherence() {
        const velocityNormalized = this.velocity.clone().normalize();
        const adherenceVec = this.directionVec.clone().multiplyScalar((1.0 - this.adherence) * this.sens);
        if (this.speed > 0.1) {
             this.velocity.copy(velocityNormalized.multiplyScalar(this.adherence).add(adherenceVec).multiplyScalar(this.speed));
        }
    }
    
    private checkStopAndReverseCondition() {
        if (this.speed < CAR_THRESHOLD) {
            this.speed = 0;
            this.velocity.set(0, 0, 0);

            if (this.new_sens !== 0 && this.new_sens !== this.sens) { // If pedal held opposing current sens, flip it
                this.sens = this.new_sens;
                this.acceleration = 0.0;
                this.velocity.copy(this.directionVec).multiplyScalar(this.sens * CAR_THRESHOLD * 2);
            } else { // No pedal or same pedal
                this.acceleration = 0;
                this.sens = 0; // Truly neutral
            }
        }
    }

    private update3DModel(dt: number) {
        this.container.position.copy(this.position);
        this.container.rotation.y = this.directionAngle;

        this.frontWheelPivots.forEach(pivot => {
            pivot.rotation.y = this.wheelAngle;
        });

        // Spin wheels based on car speed
        const wheelRotationSpeed = this.speed * this.sens * 25 * dt;
        this.wheels.forEach(w => w.rotateZ(wheelRotationSpeed));
    }
    
    public update(dt: number) {
        if (!this.isLoaded) return;
        
        // --- Raycasting to adjust car height and orientation to terrain ---
        if (this.ground) {
            const raycaster = new THREE.Raycaster();
            const rayOrigin = this.position.clone().add(new THREE.Vector3(0, 10, 0));
            const rayDirection = new THREE.Vector3(0, -1, 0);
            raycaster.set(rayOrigin, rayDirection);

            const intersects = raycaster.intersectObject(this.ground, true);

            if (intersects.length > 0) {
                const intersect = intersects[0];
                this.position.y = intersect.point.y + 0.37;

                // Adjust the rollPitchPivot to match the terrain normal
                const upVector = new THREE.Vector3(0, 1, 0);
                const worldNormal = intersect.face!.normal.clone().transformDirection(this.ground.matrixWorld);
                const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(upVector, worldNormal);
                this.rollPitchPivot.quaternion.slerp(targetQuaternion, 0.1);
            }
        }
        
        this.updateInputsAndState(dt);
        this.updateForces(dt);
        this.updateSpeedAndDirection(dt);
        this.applyAdherence();
        this.checkStopAndReverseCondition();
        this.position.add(this.velocity.clone().multiplyScalar(dt));
        this.update3DModel(dt);
    }
}
