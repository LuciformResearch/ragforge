import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// --- Constants ---
const CAR_ACCEL_SPD = 25.0;
const CAR_MAX_SPD = 100.0;
const CAR_MAX_TURN = 0.25;
const CAR_MAX_ACCEL = 800000000.0;
const CAR_THRESHOLD = 0.01;
const LOW_SPEED_ROTATION_THRESHOLD = 10.0;
const STEER_SPEED = 2.5;

// --- Suspension and Gravity Constants ---
const GRAVITY = new THREE.Vector3(0, -9.81, 0); // m/s^2
const SUSPENSION_STRENGTH = 150; // N/m (Spring constant)
const SUSPENSION_DAMPING = 50;   // N/(m/s) (Damping constant)
const SUSPENSION_REST_LENGTH = 1.0; // Meters - ideal length of suspension
const WHEEL_RADIUS = 0.35; // Approx radius of the car wheels for raycast origin
const CAR_MASS = 1200; // Kilograms

const CAR_ACCEL = 1, CAR_BRAKE = 2, CAR_TURN_LEFT = 4, CAR_TURN_RIGHT = 8, CAR_HANDBRAKE = 16;

interface WheelHitInfo {
    hit: boolean;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    distance: number;
    worldPosition: THREE.Vector3;
    pivot: THREE.Object3D;
}

export class Car {
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
    public sens = 0;
    private new_sens = 0;
    private adherence = 0.0;
    public netForce = new THREE.Vector3(); // Accumulates all forces
    private mass = CAR_MASS; // Car mass
    private body!: THREE.Mesh;
    private wheels: THREE.Mesh[] = [];
    private wheelPivots: THREE.Object3D[] = [];
    private frontWheelPivots: THREE.Object3D[] = [];
    private ground: THREE.Mesh | null = null;

    private _debugInfo: any = { // Added for GUI debugging
        state: 0,
        sens: 0,
        acceleration: 0,
        wheelAngle: 0,
        speed: 0,
        velocity: { x: 0, y: 0, z: 0 },
        netForce: { x: 0, y: 0, z: 0 },
        directionAngle: 0,
        groundContact: false, // Added for debug
        lowestPoint: 0,       // Added for debug
        currentSpeed: 0,      // Added for debug (same as speed, but for clarity)
    }; 


    constructor() {
        this.container.add(this.rollPitchPivot);
    }

    public getDebugInfo(): any { // Added for GUI debugging
        return this._debugInfo;
    }

    public setGround(groundMesh: THREE.Mesh) {
        this.ground = groundMesh;
    }

    public accelerate(on: boolean) { on ? this.state |= CAR_ACCEL : this.state &= ~CAR_ACCEL; }
    public brake(on: boolean) { on ? this.state |= CAR_BRAKE : this.state &= ~CAR_BRAKE; }
    public turnLeft(on: boolean) { on ? this.state |= CAR_TURN_LEFT : this.state &= ~CAR_TURN_LEFT; }
    public turnRight(on: boolean) { on ? this.state |= CAR_TURN_RIGHT : this.state &= ~CAR_TURN_RIGHT; }
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
                this.rollPitchPivot.add(this.body);

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
                    this.rollPitchPivot.add(wheelPivot);
                    this.wheels.push(wheel);
                    this.wheelPivots.push(wheelPivot);
                    if (pos.front) this.frontWheelPivots.push(wheelPivot);
                });
                
                this.container.position.copy(this.position);
                this.isLoaded = true;
                resolve();
            };
        });
    }

    private updateInputsAndState(dt: number) {
    // --- Steering (direction des roues avant) ---
    if (this.state & CAR_TURN_LEFT) {
        this.wheelAngle += STEER_SPEED * dt;
    } else if (this.state & CAR_TURN_RIGHT) {
        this.wheelAngle -= STEER_SPEED * dt;
    } else {
        // Retour au centre quand on lâche les flèches
        this.wheelAngle -= this.wheelAngle * 5.0 * dt;
    }
    this.wheelAngle = Math.max(-CAR_MAX_TURN, Math.min(CAR_MAX_TURN, this.wheelAngle));

    // --- Direction souhaitée selon les pédales ---
    if (this.state & CAR_ACCEL && !(this.state & CAR_BRAKE)) {
        this.new_sens = 1;   // On veut aller en avant
    } else if (this.state & CAR_BRAKE && !(this.state & CAR_ACCEL)) {
        this.new_sens = -1;  // On veut reculer (marche arrière)
    } else {
        console.log("SET SENS TO 0!");
        this.new_sens = 0;   // Neutre
    }

    // --- Gestion du "gaz" / force moteur ---
    const accelPressed = (this.state & CAR_ACCEL) && !(this.state & CAR_BRAKE);
    const brakePressed = (this.state & CAR_BRAKE) && !(this.state & CAR_ACCEL);

        // Si la pédale d'accélération est pressée et que l'on veut aller en avant
        if (accelPressed && this.new_sens === 1) {
            this.acceleration += CAR_ACCEL_SPD * dt;
        }
        // Si la pédale de frein est pressée et que l'on veut aller en arrière
        else if (brakePressed && this.new_sens === -1) {
            this.acceleration += CAR_ACCEL_SPD * dt;
        }
        // Sinon (pas de gaz, ou mauvaise pédale pour la direction désirée)
        else {
            this.acceleration -= this.acceleration * 8.0 * dt;
            if (Math.abs(this.acceleration) < 0.5) this.acceleration = 0;
        }
    // On limite quand même (mais maintenant on peut mettre une valeur très haute sans peur)
    this.acceleration = Math.max(-CAR_MAX_ACCEL, Math.min(CAR_MAX_ACCEL, this.acceleration));
}

    // --- New physics force accumulation and integration ---
    private integrateForces(dt: number) {
        // 1. Calculate Acceleration from Net Force
        const currentAcceleration = this.netForce.clone().divideScalar(this.mass);
        
        // 2. Update Velocity
        this.velocity.add(currentAcceleration.multiplyScalar(dt));

        // 3. Update Position (Physics position)
        this.position.add(this.velocity.clone().multiplyScalar(dt));
    }

    private updateForces(dt: number) {
        // Reset net force (already done in update)

        // Add engine/brake force to netForce (engine force is from accelerationVec)
        // This needs to be applied in the direction of the car's movement, not world
        const wheelAbsoluteVec = new THREE.Vector3(Math.sin(this.directionAngle + this.wheelAngle), 0, Math.cos(this.directionAngle + this.wheelAngle));
        this.accelerationVec.copy(wheelAbsoluteVec).multiplyScalar(this.sens * this.acceleration * this.mass);
        this.netForce.add(this.accelerationVec);

        // --- Handbrake ---
        if (this.state & CAR_HANDBRAKE) {
            this.velocity.multiplyScalar(1.0 - (CAR_ACCEL_SPD * (1.5 - this.adherence) * ((1 / (this.speed + 0.1)) + 0.1) * dt));
            this.adherence = 1.0;
        } else {
            this.adherence -= this.adherence * 0.15 * dt;
            if(this.adherence < 0) this.adherence = 0;
        }

        this.acceleration = Math.max(-CAR_MAX_ACCEL, Math.min(this.acceleration, CAR_MAX_ACCEL));

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

        // --- Natural deceleration / friction (when no pedals are pressed) ---
        if (!(this.state & CAR_ACCEL) && !(this.state & CAR_BRAKE)) {
            this.velocity.x -= this.velocity.x * 0.5 * dt;
            this.velocity.z -= this.velocity.z * 0.5 * dt;
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
        if (this.speed < CAR_THRESHOLD ) {
            // this.speed = 0; // Commented out: Let physics handle natural stop
            // this.velocity.set(0, 0, 0); // Commented out: Let physics handle natural stop

            if (this.new_sens !== 0 && this.new_sens !== this.sens) { // If pedal held opposing current sens, flip it
                this.sens = this.new_sens;
                // this.acceleration = 0.0; // Commented out: Allow acceleration to build up
                this.velocity.copy(this.directionVec).multiplyScalar(this.sens * CAR_THRESHOLD * 2);
            }
            else if (this.new_sens == this.sens)
            {

            }
            else { // No pedal or same pedal
                this.sens = 0; // Truly neutral
                console.log("SET SENS TO 0 HERE!");
                if (!(this.state & CAR_ACCEL) && !(this.state & CAR_BRAKE)) {
                    // Removed: this.velocity.set(0, 0, 0);
                }
            }
        }
    }

    private update3DModel(dt: number) {
        this.container.position.copy(this.position);
        this.container.rotation.y = this.directionAngle;

        const wheelRotationSpeed = this.speed * this.sens * 25 * dt;
        this.frontWheelPivots.forEach(pivot => {
            pivot.rotation.y = this.wheelAngle;
        });
        this.wheels.forEach(w => w.rotateZ(wheelRotationSpeed));
    }
    
    private updateSuspensionAndForces(dt: number) {
        if (!this.ground) return;

        const raycaster = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);

        const wheelHitInfos: WheelHitInfo[] = [];

        this.wheelPivots.forEach(pivot => {
            const worldPosition = new THREE.Vector3();
            pivot.getWorldPosition(worldPosition);
            
            // Raycast origin is above the wheel to detect ground
            const rayOrigin = worldPosition.clone().add(new THREE.Vector3(0, SUSPENSION_REST_LENGTH, 0));
            raycaster.set(rayOrigin, down);
            
            const intersects = raycaster.intersectObject(this.ground!, true); // Use non-null assertion as ground is checked
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const hitNormal = intersect.face!.normal.clone().transformDirection(this.ground!.matrixWorld);
                wheelHitInfos.push({
                    hit: true,
                    point: intersect.point,
                    normal: hitNormal,
                    distance: intersect.distance,
                    worldPosition: worldPosition,
                    pivot: pivot
                });
            } else {
                wheelHitInfos.push({
                    hit: false,
                    point: new THREE.Vector3(),
                    normal: new THREE.Vector3(),
                    distance: SUSPENSION_REST_LENGTH, // No hit, assume max extension
                    worldPosition: worldPosition,
                    pivot: pivot
                });
            }
        });
        
        let totalNormal = new THREE.Vector3();
        let hitWheels = 0;

        wheelHitInfos.forEach(hitInfo => {
            if (hitInfo.hit) {
                hitWheels++;
                totalNormal.add(hitInfo.normal);

                const compression = SUSPENSION_REST_LENGTH - hitInfo.distance;
                if (compression > 0) {
                    // Spring Force
                    const springForce = hitInfo.normal.clone().multiplyScalar(SUSPENSION_STRENGTH * compression);
                    this.netForce.add(springForce);

                    // Damping Force
                    // Simplified: assume vertical velocity of the car for damping
                    const wheelVelocity = this.velocity.dot(hitInfo.normal);
                    const dampingForce = hitInfo.normal.clone().multiplyScalar(SUSPENSION_DAMPING * wheelVelocity);
                    this.netForce.add(dampingForce);
                }
            }
        });

        // Update roll/pitch based on average normal of hit wheels
        if (hitWheels > 0) {
            totalNormal.normalize();
            const upVector = new THREE.Vector3(0, 1, 0);
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(upVector, totalNormal);
            this.rollPitchPivot.quaternion.slerp(targetQuaternion, 0.1);
        } else {
            // If no wheels hit, reset roll/pitch to level (or maintain last known, depends on desired behavior)
            // For now, let's just make it level
            const upVector = new THREE.Vector3(0, 1, 0);
            const levelQuaternion = new THREE.Quaternion().setFromUnitVectors(upVector, new THREE.Vector3(0,1,0));
            this.rollPitchPivot.quaternion.slerp(levelQuaternion, 0.1);
        }

        // Adjust car's Y position to prevent sinking if all wheels are off ground, or to follow terrain
        // This is a direct adjustment for now, until full force integration lifts the car correctly
        let lowestPoint = Infinity;
        let groundContact = false;

        wheelHitInfos.forEach(hitInfo => {
            if (hitInfo.hit) {
                lowestPoint = Math.min(lowestPoint, hitInfo.point.y);
                groundContact = true;
            }
        });

        // Store debug info
        this._debugInfo.groundContact = groundContact;
        this._debugInfo.lowestPoint = lowestPoint;

        if (groundContact) {
            // Set Y position based on average/lowest contact point
            this.position.y = lowestPoint + SUSPENSION_REST_LENGTH;
        }
    }

    public update(dt: number) {
        if (!this.isLoaded) return;
        
        // Reset net force and add gravity for this frame
        this.netForce.set(0, 0, 0);
        this.netForce.add(GRAVITY.clone().multiplyScalar(this.mass));

        // Update inputs and calculate engine/brake forces
        this.updateInputsAndState(dt);
        this.updateForces(dt); // This now adds engine/brake forces to netForce
        

        // Add suspension forces and calculate orientation
        this.updateSuspensionAndForces(dt); // Calculate and add suspension forces to netForce

        // Integrate forces to update velocity and position
        this.integrateForces(dt); // New method for force integration

        // Apply adherence (this might need to be re-evaluated if a full force model is used)
        this.applyAdherence(); 

        this.checkStopAndReverseCondition();
        
        // Update 3D model with new physics position and orientation
        this.update3DModel(dt);

        // --- Populate debug info for GUI ---
        this._debugInfo = {
            state: this.state,
            sens: this.sens,
            acceleration: this.acceleration,
            wheelAngle: this.wheelAngle,
            speed: this.speed,
            velocity: {
                x: this.velocity.x,
                y: this.velocity.y,
                z: this.velocity.z,
            },
            netForce: {
                x: this.netForce.x,
                y: this.netForce.y,
                z: this.netForce.z,
            },
            directionAngle: this.directionAngle,
            currentSpeed: this.speed, // Populate currentSpeed for debug GUI
        };
    }
}
