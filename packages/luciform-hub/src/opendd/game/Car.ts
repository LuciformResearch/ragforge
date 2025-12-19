import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// --- Constants ---
const CAR_ACCEL_SPD = 20.0;
const CAR_MAX_SPD = 100.0;
const CAR_MAX_TURN = 0.25;
const CAR_MAX_ACCEL = 800000000.0;
const CAR_THRESHOLD = 1.0;
const LOW_SPEED_ROTATION_THRESHOLD = 10.0;
const STEER_SPEED = 2.5;

// --- Suspension and Gravity Constants ---
const GRAVITY = new THREE.Vector3(0, -9.81, 0); // m/s^2
const SUSPENSION_STRENGTH = 150; // N/m (Spring constant)
const SUSPENSION_DAMPING = 50;   // N/(m/s) (Damping constant)
const SUSPENSION_REST_LENGTH = 1.0; // Meters - ideal length of suspension
const WHEEL_RADIUS = 0.35; // Approx radius of the car wheels for raycast origin
const CAR_MASS = 1200; // Kilograms
const RAYCAST_HEIGHT_OFFSET = 5.0; // Start raycasts from high above to detect obstacles

// --- Ground Adhesion / Downforce ---
// Adjustable: increase to make car stick to ground more
const DOWNFORCE_BASE = 5.0; // Base downforce strength (m/s² of acceleration toward ground)
const DOWNFORCE_SPEED_MULT = 0.1; // Additional downforce per unit of speed
const GROUND_STICK_THRESHOLD = 3.0; // Distance within which car "sticks" to ground

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

    // --- Adjustable via GUI ---
    public downforceBase = DOWNFORCE_BASE;
    public downforceSpeedMult = DOWNFORCE_SPEED_MULT;
    public groundStickThreshold = GROUND_STICK_THRESHOLD;
    public maxUpwardVelocity = 5.0;

    private body!: THREE.Mesh;
    private wheels: THREE.Mesh[] = [];
    private wheelPivots: THREE.Object3D[] = [];
    private frontWheelPivots: THREE.Object3D[] = [];
    private groundObjects: THREE.Object3D[] = [];

    private _debugInfo: any = { // Added for GUI debugging
        state: 0,
        sens: 0,
        acceleration: 0,
        wheelAngle: 0,
        speed: 0,
        velocity: { x: 0, y: 0, z: 0 },
        netForce: { x: 0, y: 0, z: 0 },
        directionAngle: 0,
        groundContact: false,
        currentSpeed: 0,
        // New debug info
        carState: 'grounded', // 'airborne' | 'landing' | 'grounded'
        wheelsTouchingGround: 0,
        // Per-wheel info (FL = Front Left, FR = Front Right, RL = Rear Left, RR = Rear Right)
        wheelFL_touching: false,
        wheelFL_distance: 0,
        wheelFR_touching: false,
        wheelFR_distance: 0,
        wheelRL_touching: false,
        wheelRL_distance: 0,
        wheelRR_touching: false,
        wheelRR_distance: 0,
    }; 


    constructor() {
        this.container.add(this.rollPitchPivot);
    }

    public getDebugInfo(): any { // Added for GUI debugging
        return this._debugInfo;
    }

    public setGround(...objects: THREE.Object3D[]) {
        this.groundObjects = objects.filter(o => o != null);
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

                // Visual offset: lower the model by SUSPENSION_REST_LENGTH so it appears at ground level
                // Physics position stays higher for correct raycast calculations
                this.rollPitchPivot.position.y = -SUSPENSION_REST_LENGTH;

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
            this.wheelAngle -= this.wheelAngle * 5.0 * dt;
        }
        this.wheelAngle = Math.max(-CAR_MAX_TURN, Math.min(CAR_MAX_TURN, this.wheelAngle));

        // --- Determine desired direction based on pedals (this.new_sens) ---
        const isAccelPressed = (this.state & CAR_ACCEL) && !(this.state & CAR_BRAKE);
        const isBrakePressed = (this.state & CAR_BRAKE) && !(this.state & CAR_ACCEL);
        console.log("VEL: " + new THREE.Vector3(this.velocity.x, 0, this.velocity.z).length());
        if (new THREE.Vector3(this.velocity.x, 0, this.velocity.z).length() <= CAR_THRESHOLD)
        {
            console.log("SENS SET TO 0:" + new THREE.Vector3(this.velocity.x, 0, this.velocity.z).length());
            this.sens = 0;
        }
        if (isAccelPressed) {
            this.new_sens = 1;
            if (this.sens == 0)
            {
                this.sens = this.new_sens;
                console.log("set sens to 1");

            }
        } else if (isBrakePressed) {
            this.new_sens = -1;
            if (this.sens == 0)
            {
                this.sens = this.new_sens;
                console.log("set sens to -1");
            }
 
        } else {
            this.new_sens = 0; // No active pedal or both pressed

        }

        
        if (this.sens !== 0 && this.new_sens === this.sens) {
            this.acceleration += CAR_ACCEL_SPD * dt;
        } else if (this.sens !== 0 && this.new_sens !== this.sens) {
            this.acceleration -= this.acceleration * 8.0 * dt;
        }
        this.acceleration = Math.max(0, Math.min(CAR_MAX_ACCEL, this.acceleration));
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
        // Speed is now calculated and capped in the update method before this is called.

        // --- Implement speed-dependent angular velocity (rotationSpeedFactor) ---
        // Low speed: need some speed to turn (can't turn while stationary)
        let lowSpeedFactor = 1.0;
        if (this.speed < LOW_SPEED_ROTATION_THRESHOLD) {
            lowSpeedFactor = this.speed / LOW_SPEED_ROTATION_THRESHOLD;
        }

        // High speed: reduce turning capability as speed increases
        // Formula: 1 / (1 + speed * k) - gives smooth decrease
        // At speed=0: factor=1, at speed=50: factor~0.33, at speed=100: factor~0.2
        const turnReductionFactor = 0.02; // Adjust this to tune high-speed handling
        const highSpeedFactor = 1.0 / (1.0 + this.speed * turnReductionFactor);

        const rotationSpeedFactor = lowSpeedFactor * highSpeedFactor;

        // --- Direction update (yaw) ---
        this.directionAngle += (1.0 - (this.adherence / 2.0)) * this.sens * this.wheelAngle * 10.0 * rotationSpeedFactor * dt;
        this.directionAngle %= (2 * Math.PI); if (this.directionAngle < 0) this.directionAngle += (2 * Math.PI);
        this.directionVec.set(Math.sin(this.directionAngle), 0, Math.cos(this.directionAngle));
    }

    private applyAdherence() {
        // Preserve vertical velocity - adherence only affects horizontal movement
        const savedVelocityY = this.velocity.y;

        const velocityNormalized = this.velocity.clone().normalize();
        const adherenceVec = this.directionVec.clone().multiplyScalar((1.0 - this.adherence) * this.sens);

        this.velocity.copy(velocityNormalized.multiplyScalar(this.adherence).add(adherenceVec).multiplyScalar(this.speed));

        // Restore vertical velocity
        this.velocity.y = savedVelocityY;
    }
    
    private checkStopAndReverseCondition() {
        /*if (this.speed <= CAR_THRESHOLD) { 
            // If car is stopped but sens is active (just set by updateInputsAndState)
            if (this.sens !== 0) { 
                // Give a small initial push to ensure movement starts
                this.velocity.copy(this.directionVec).multiplyScalar(this.sens * CAR_THRESHOLD * 2);
                this.acceleration = 0.0; // Reset acceleration to build up
            } else { // If car is stopped and sens is also 0
                this.velocity.set(0, 0, 0); // Ensure it's truly stopped
            }
        }*/
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
    
    private raycaster = new THREE.Raycaster();
    private down = new THREE.Vector3(0, -1, 0);

    // Maximum raycast distance: generous margin to avoid jitter when grounded
    private readonly MAX_RAYCAST_DISTANCE = SUSPENSION_REST_LENGTH + WHEEL_RADIUS + 1.5;

    // Central raycast distance - decreases with speed for easier takeoff at high speed
    private get CENTER_RAYCAST_DISTANCE() {
        // At speed 0: full threshold. At CAR_MAX_SPD: minimum threshold (0.5)
        const speedRatio = Math.min(this.speed / CAR_MAX_SPD, 1.0);
        const dynamicThreshold = this.groundStickThreshold * (1 - speedRatio) + 0.5 * speedRatio;
        return SUSPENSION_REST_LENGTH + dynamicThreshold;
    }

    // Central raycast for stable ground detection (doesn't move with chassis orientation)
    private _performCenterRaycast(): { hit: boolean; height: number; normal: THREE.Vector3 } {
        if (this.groundObjects.length === 0) return { hit: false, height: 0, normal: new THREE.Vector3(0, 1, 0) };

        // Raycast from center of car (using this.position, not affected by rollPitchPivot)
        const rayOrigin = this.position.clone().add(new THREE.Vector3(0, SUSPENSION_REST_LENGTH, 0));
        this.raycaster.set(rayOrigin, this.down);
        this.raycaster.far = this.CENTER_RAYCAST_DISTANCE;

        const intersects = this.raycaster.intersectObjects(this.groundObjects, true);
        if (intersects.length > 0 && intersects[0].distance <= this.CENTER_RAYCAST_DISTANCE) {
            const hitObject = intersects[0].object;
            const hitNormal = intersects[0].face!.normal.clone().transformDirection(hitObject.matrixWorld);
            return {
                hit: true,
                height: intersects[0].point.y + SUSPENSION_REST_LENGTH,
                normal: hitNormal
            };
        }
        return { hit: false, height: 0, normal: new THREE.Vector3(0, 1, 0) };
    }

    private _performWheelRaycasts(): WheelHitInfo[] {
        if (this.groundObjects.length === 0) return [];

        const wheelHitInfos: WheelHitInfo[] = [];

        this.wheelPivots.forEach(pivot => {
            const worldPosition = new THREE.Vector3();
            pivot.getWorldPosition(worldPosition);

            // Raycast origin is above the wheel to detect ground
            const rayOrigin = worldPosition.clone().add(new THREE.Vector3(0, SUSPENSION_REST_LENGTH, 0));
            this.raycaster.set(rayOrigin, this.down);
            this.raycaster.far = Infinity; // No limit - always find ground for orientation

            const intersects = this.raycaster.intersectObjects(this.groundObjects, true);
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const hitObject = intersect.object;
                const hitNormal = intersect.face!.normal.clone().transformDirection(hitObject.matrixWorld);
                wheelHitInfos.push({
                    hit: true,
                    point: intersect.point,
                    normal: hitNormal,
                    distance: rayOrigin.distanceTo(intersect.point), // Distance from ray origin to hit point
                    worldPosition: worldPosition, // Wheel pivot world position
                    pivot: pivot
                });
            } else {
                wheelHitInfos.push({
                    hit: false,
                    point: new THREE.Vector3(),
                    normal: new THREE.Vector3(),
                    distance: SUSPENSION_REST_LENGTH, // No hit, assume max extension
                    worldPosition: worldPosition, // Wheel pivot world position
                    pivot: pivot
                });
            }
        });
        return wheelHitInfos;
    }


    private _calculateChassisOrientation(wheelHitInfos: WheelHitInfo[]): THREE.Vector3 {
        // Wheel order: FL (0), FR (1), RL (2), RR (3)
        if (wheelHitInfos.length < 4 || !wheelHitInfos.every(w => w.hit)) {
            return new THREE.Vector3(0, 1, 0); // Default up
        }

        // Get distances for each wheel
        const distFL = wheelHitInfos[0].distance;
        const distFR = wheelHitInfos[1].distance;
        const distRL = wheelHitInfos[2].distance;
        const distRR = wheelHitInfos[3].distance;

        // Calculate pitch correction: if front wheels are farther, pitch forward (nose down)
        const frontAvgDist = (distFL + distFR) / 2;
        const rearAvgDist = (distRL + distRR) / 2;
        const pitchDiff = frontAvgDist - rearAvgDist; // Positive = front is higher

        // Calculate roll correction: if left wheels are farther, roll left
        const leftAvgDist = (distFL + distRL) / 2;
        const rightAvgDist = (distFR + distRR) / 2;
        const rollDiff = leftAvgDist - rightAvgDist; // Positive = left is higher

        // Convert distance differences to angles
        // Approximate: wheelbase ~2.3m (front to rear), track ~1.8m (left to right)
        const wheelbase = 2.3;
        const track = 1.8;

        // pitchDiff is the height difference front-to-rear
        // tan(pitch) = pitchDiff / wheelbase
        const pitchAngle = Math.atan2(pitchDiff, wheelbase);
        const rollAngle = Math.atan2(rollDiff, track);

        // Clamp angles to reasonable values
        const maxAngle = Math.PI / 6; // 30 degrees max
        const clampedPitch = THREE.MathUtils.clamp(pitchAngle, -maxAngle, maxAngle);
        const clampedRoll = THREE.MathUtils.clamp(rollAngle, -maxAngle, maxAngle);

        // Create target up vector from pitch and roll
        // Start with up (0, 1, 0) and rotate by pitch (around X) and roll (around Z)
        const upVector = new THREE.Vector3(0, 1, 0);

        // Apply pitch rotation (around local X axis - tips nose up/down)
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), clampedPitch);
        upVector.applyQuaternion(pitchQuat);

        // Apply roll rotation (around local Z axis - tips left/right)
        const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), clampedRoll);
        upVector.applyQuaternion(rollQuat);

        return upVector.normalize();
    }

    // Store raycast results for use in applyGroundConstraint
    private lastWheelHitInfos: WheelHitInfo[] = [];
    private lastHitWheels = 0;
    private lastTargetHeight = 0;

    private updateSuspensionAndForces(dt: number): number {
        if (this.groundObjects.length === 0) return 0;

        const wheelHitInfos = this._performWheelRaycasts();
        this.lastWheelHitInfos = wheelHitInfos;

        let groundContact = false;
        let totalTargetHeight = 0;
        let hitWheels = 0;

        wheelHitInfos.forEach(hitInfo => {
            if (hitInfo.hit) {
                hitWheels++;
                totalTargetHeight += hitInfo.point.y + SUSPENSION_REST_LENGTH;
                groundContact = true;
            }
        });

        // Store for later constraint application
        this.lastHitWheels = hitWheels;
        this.lastTargetHeight = hitWheels > 0 ? totalTargetHeight / hitWheels : 0;

        // Store debug info
        this._debugInfo.groundContact = groundContact;

        // DON'T snap position here - let physics run first, then apply constraint

        const newUpVector = this._calculateChassisOrientation(wheelHitInfos);
        const upVector = new THREE.Vector3(0, 1, 0);
        const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(upVector, newUpVector);
        this.rollPitchPivot.quaternion.slerp(targetQuaternion, 0.1);

        return hitWheels;
    }

    // Car states: AIRBORNE -> LANDING -> GROUNDED -> AIRBORNE...
    private carState: 'airborne' | 'landing' | 'grounded' = 'grounded';

    // Angular velocity for air rotation (pitch, roll rates)
    private angularVelocity = new THREE.Vector3(0, 0, 0);

    // Air physics constants
    private readonly CENTER_OF_GRAVITY_OFFSET = 0.3;
    private readonly AIR_ROTATION_DAMPING = 0.98;
    private readonly GRAVITY_TORQUE_STRENGTH = 2.0;

    // Landing interpolation speeds (soft landing)
    private readonly LANDING_HEIGHT_LERP_SPEED = 8.0;
    private readonly LANDING_ROTATION_LERP_SPEED = 0.15;

    // Hysteresis: frames without ground contact before going airborne
    private framesWithoutContact = 0;
    private readonly AIRBORNE_THRESHOLD_FRAMES = 1;

    // Cache last valid ground height for stability
    private lastGroundHeight = 0;

    // Smoothed target orientation to reduce jitter
    private smoothedTargetUp = new THREE.Vector3(0, 1, 0);
    private readonly TARGET_SMOOTHING = 0.15; // How fast the target itself smooths (lower = smoother)

    // Combined: raycast, ground constraint, and orientation
    private updateSuspensionAndGroundConstraint(dt: number) {
        if (this.groundObjects.length === 0) return;

        // Use CENTER raycast for stable ground detection (not affected by chassis rotation)
        const centerHit = this._performCenterRaycast();

        // Use WHEEL raycasts for orientation
        const wheelHitInfos = this._performWheelRaycasts();

        // Count wheels that hit (for orientation calculation - with infinite raycast, should be 4)
        let hitWheels = 0;
        // Count wheels that are actually CLOSE to the ground (for slerp aggressiveness)
        let wheelsTouchingGround = 0;
        // TOUCH_THRESHOLD must account for:
        // - SUSPENSION_REST_LENGTH (1.0m) added to ray origin
        // - wheel pivot local Y offset (~0.37m)
        // - some margin for terrain variations
        const WHEEL_PIVOT_Y_OFFSET = 0.37;
        const TOUCH_THRESHOLD = SUSPENSION_REST_LENGTH + WHEEL_PIVOT_Y_OFFSET + 1.0; // ~2.37m + margin

        // Wheel order: FL (0), FR (1), RL (2), RR (3)
        const wheelNames = ['FL', 'FR', 'RL', 'RR'];
        wheelHitInfos.forEach((hitInfo, index) => {
            const isTouching = hitInfo.hit && hitInfo.distance <= TOUCH_THRESHOLD;
            if (hitInfo.hit) {
                hitWheels++;
                if (isTouching) {
                    wheelsTouchingGround++;
                }
            }
            // Update per-wheel debug info with proper precision
            const name = wheelNames[index];
            (this._debugInfo as any)[`wheel${name}_touching`] = isTouching;
            // Round to 2 decimal places for readability
            (this._debugInfo as any)[`wheel${name}_distance`] = hitInfo.hit ? Math.round(hitInfo.distance * 100) / 100 : -1;
        });

        // Debug log once per second (not every frame)
        if (Math.random() < 0.02) {
            console.log(`TOUCH_THRESHOLD=${TOUCH_THRESHOLD.toFixed(2)}, distances: FL=${wheelHitInfos[0]?.distance?.toFixed(2)}, FR=${wheelHitInfos[1]?.distance?.toFixed(2)}, RL=${wheelHitInfos[2]?.distance?.toFixed(2)}, RR=${wheelHitInfos[3]?.distance?.toFixed(2)}`);
        }

        // Update debug info
        this._debugInfo.carState = this.carState;
        this._debugInfo.wheelsTouchingGround = wheelsTouchingGround;

        // Hysteresis based on CENTER raycast (more stable)
        if (!centerHit.hit) {
            this.framesWithoutContact++;
        } else {
            this.framesWithoutContact = 0;
            this.lastGroundHeight = centerHit.height;
        }

        // Store debug info (with hysteresis)
        const effectiveGroundContact = centerHit.hit || this.framesWithoutContact < this.AIRBORNE_THRESHOLD_FRAMES;
        this._debugInfo.groundContact = effectiveGroundContact;

        // State machine transitions with hysteresis (based on center raycast)
        if (this.framesWithoutContact >= this.AIRBORNE_THRESHOLD_FRAMES) {
            // Confirmed airborne (no contact for several frames)
            this.carState = 'airborne';
        } else if (this.carState === 'airborne' && centerHit.hit) {
            // Was airborne, now touching -> LANDING
            this.carState = 'landing';
        } else if (this.carState === 'landing' && centerHit.hit && wheelsTouchingGround >= 4) {
            // ALL 4 wheels actually touching ground -> GROUNDED
            this.carState = 'grounded';
            this.angularVelocity.set(0, 0, 0);
        }
        // GROUNDED stays GROUNDED until confirmed airborne

        // Handle each state
        if (this.carState === 'airborne') {
            this.updateAirborneRotation(dt);

        } else {
            // LANDING or GROUNDED: Same logic - keep all wheels on ground
            const targetHeight = centerHit.hit ? centerHit.height : this.lastGroundHeight;

            if (this.carState === 'landing') {
                // LANDING: Lerp down smoothly
                const heightDiff = targetHeight - this.position.y;
                if (heightDiff > 0) {
                    this.position.y = targetHeight; // Below ground - snap up
                } else {
                    this.position.y = THREE.MathUtils.lerp(this.position.y, targetHeight, this.LANDING_HEIGHT_LERP_SPEED * dt);
                }
                this.velocity.y *= 0.7;
                this.angularVelocity.multiplyScalar(0.85);
            } else {
                // GROUNDED: Snap to height
                this.position.y = targetHeight;
                this.velocity.y = 0;
            }

            // Update container position
            this.container.position.y = this.position.y;

            // ALWAYS orient chassis to bring all wheels to ground
            if (hitWheels > 0) {
                // --- GRAVITY-BASED ROTATIONAL INERTIA ---
                // Calculate imbalance from wheel distances
                const distFL = wheelHitInfos[0]?.distance ?? 0;
                const distFR = wheelHitInfos[1]?.distance ?? 0;
                const distRL = wheelHitInfos[2]?.distance ?? 0;
                const distRR = wheelHitInfos[3]?.distance ?? 0;

                // Pitch imbalance: positive = front wheels are higher (need to pitch forward)
                const pitchImbalance = ((distFL + distFR) - (distRL + distRR)) / 2;
                // Roll imbalance: positive = left wheels are higher (need to roll left)
                const rollImbalance = ((distFL + distRL) - (distFR + distRR)) / 2;

                // Apply gravity torque based on imbalance (like a pendulum)
                const BASE_GRAVITY_TORQUE = 2.0; // Base strength at low speed
                const SPEED_TORQUE_MULTIPLIER = 0.05; // Additional torque per unit of speed
                const ANGULAR_DAMPING = 0.92; // Damping to prevent oscillation

                // Scale torque with speed - faster = more inertia
                const speedFactor = 1.0 + this.speed * SPEED_TORQUE_MULTIPLIER;
                const GRAVITY_TORQUE = BASE_GRAVITY_TORQUE * speedFactor;

                // Only apply gravity torque if there's significant imbalance
                const imbalanceThreshold = 0.3;
                if (Math.abs(pitchImbalance) > imbalanceThreshold || Math.abs(rollImbalance) > imbalanceThreshold) {
                    this.angularVelocity.x += pitchImbalance * GRAVITY_TORQUE * dt;
                    this.angularVelocity.z += rollImbalance * GRAVITY_TORQUE * dt;
                }

                // Apply damping
                this.angularVelocity.multiplyScalar(ANGULAR_DAMPING);

                // Clamp angular velocity
                const maxAngularVel = 2.0;
                this.angularVelocity.x = THREE.MathUtils.clamp(this.angularVelocity.x, -maxAngularVel, maxAngularVel);
                this.angularVelocity.z = THREE.MathUtils.clamp(this.angularVelocity.z, -maxAngularVel, maxAngularVel);

                // Apply angular velocity to rotation
                const euler = new THREE.Euler().setFromQuaternion(this.rollPitchPivot.quaternion, 'YXZ');
                euler.x += this.angularVelocity.x * dt;
                euler.z += this.angularVelocity.z * dt;

                // Clamp max angles to prevent flipping
                const maxAngle = Math.PI / 3; // 60 degrees max
                euler.x = THREE.MathUtils.clamp(euler.x, -maxAngle, maxAngle);
                euler.z = THREE.MathUtils.clamp(euler.z, -maxAngle, maxAngle);

                this.rollPitchPivot.quaternion.setFromEuler(euler);

                // --- Also keep the slerp towards target for stability ---
                const newUpVector = this._calculateChassisOrientation(wheelHitInfos);
                this.smoothedTargetUp.lerp(newUpVector, this.TARGET_SMOOTHING);
                this.smoothedTargetUp.normalize();

                const upVector = new THREE.Vector3(0, 1, 0);
                const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(upVector, this.smoothedTargetUp);

                // Gentle slerp to prevent drifting too far from target
                const stabilizationSlerp = 0.05;
                this.rollPitchPivot.quaternion.slerp(targetQuaternion, stabilizationSlerp);
            }
        }
    }

    // Getter for isGrounded (used by gravity logic)
    // Disable gravity when LANDING or GROUNDED (any wheel touching)
    private get isGrounded(): boolean {
        return this.carState !== 'airborne';
    }

    // Handle rotation when car is in the air
    private updateAirborneRotation(dt: number) {
        const euler = new THREE.Euler().setFromQuaternion(this.rollPitchPivot.quaternion, 'YXZ');
        const maxPitchAngle = Math.PI / 4;
        const currentPitch = euler.x;

        // Gravity torque - nose down due to center of gravity
        const pitchTorque = this.CENTER_OF_GRAVITY_OFFSET * this.GRAVITY_TORQUE_STRENGTH * Math.cos(currentPitch);
        this.angularVelocity.x += pitchTorque * dt;

        // Damping
        this.angularVelocity.multiplyScalar(this.AIR_ROTATION_DAMPING);

        // Clamp angular velocity
        this.angularVelocity.x = THREE.MathUtils.clamp(this.angularVelocity.x, -3, 3);
        this.angularVelocity.z = THREE.MathUtils.clamp(this.angularVelocity.z, -3, 3);

        // Apply rotation
        euler.x += this.angularVelocity.x * dt;
        euler.z += this.angularVelocity.z * dt;
        euler.x = THREE.MathUtils.clamp(euler.x, -maxPitchAngle, maxPitchAngle);

        this.rollPitchPivot.quaternion.setFromEuler(euler);
    }


    public update(dt: number) {
        if (!this.isLoaded) return;

        // 1. Reset net force and apply gravity
        this.netForce.set(0, 0, 0);
        if (!this.isGrounded) {
            // Full gravity when airborne
            this.netForce.add(GRAVITY.clone().multiplyScalar(this.mass));
        }

        // 2. Apply downforce to keep car planted (DECREASES with speed)
        // At low speed: full downforce. At high speed: no downforce (can take off from ramps)
        const downforce = Math.max(0, this.downforceBase - this.speed * this.downforceSpeedMult);
        this.velocity.y -= downforce * dt;

        // 3. Clamp upward velocity to prevent flying
        // Car can fall fast but can't rise too fast
        if (this.velocity.y > this.maxUpwardVelocity) {
            this.velocity.y = this.maxUpwardVelocity;
        }

        // 4. Update inputs and calculate engine/brake forces
        this.updateInputsAndState(dt);
        this.updateForces(dt); // This adds engine/brake forces to netForce

        // 5. Integrate forces to update velocity and position
        this.integrateForces(dt);

        // 4. Update 3D model position BEFORE raycasts (so raycasts use current position)
        this.container.position.copy(this.position);
        this.container.rotation.y = this.directionAngle;

        // 5. Now perform raycasts from the NEW position and apply ground constraint
        this.updateSuspensionAndGroundConstraint(dt);

        // 6. Update derived quantities like speed and direction
        this.speed = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).length();
        if (this.speed > CAR_MAX_SPD) {
            this.velocity.multiplyScalar(CAR_MAX_SPD / this.speed);
            this.speed = CAR_MAX_SPD;
        }
        this.updateSpeedAndDirection(dt);

        // 7. Apply adherence (might modify velocity based on new speed)
        this.applyAdherence();

        // 8. Check stop and reverse condition
        this.checkStopAndReverseCondition();

        // 9. Update 3D model with new physics position and orientation
        this.update3DModel(dt);

        // --- Populate debug info for GUI ---
        this._debugInfo.state = this.state;
        this._debugInfo.sens = this.sens;
        this._debugInfo.acceleration = this.acceleration;
        this._debugInfo.wheelAngle = this.wheelAngle;
        this._debugInfo.speed = this.speed;
        this._debugInfo.velocity = {
            x: this.velocity.x,
            y: this.velocity.y,
            z: this.velocity.z,
        };
        this._debugInfo.netForce = {
            x: this.netForce.x,
            y: this.netForce.y,
            z: this.netForce.z,
        };
        this._debugInfo.directionAngle = this.directionAngle;
        // groundContact and lowestPoint are already set in updateSuspensionAndForces
        this._debugInfo.currentSpeed = this.speed;
    }
}
