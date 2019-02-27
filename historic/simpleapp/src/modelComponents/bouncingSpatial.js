import * as THREE from 'three';
import InertialSpatialComponent from './inertialSpatial';

/** A spatial model with inertia, gravity, and bouncing */
export default class BouncingSpatialComponent extends InertialSpatialComponent {
    /** @param {SpatialComponent} spatialComponent */
    constructor(owner, state = {}, componentName = "spatial") {
        super(owner, state, componentName);
        this.dampening = state.dampening || 0.01;
        this.gravity = state.gravity || new THREE.Vector3(0, -0.001, 0);
        this.bounce = state.bounce || 1;
    }

    toState(state) {
        super.toState(state);
        state.gravity = this.gravity;
        state.bounce = this.bounce;
    }

    applyVelocity() {
        if (this.inInertiaPhase) {
            this.estimatedVelocity.add(this.gravity);
            let bounce = false;
            if (this.position.y < 0.5) { this.estimatedVelocity.y = Math.abs(this.estimatedVelocity.y); this.position.y = 0.5; bounce = true; }
            if (this.position.x < -10) { this.estimatedVelocity.x = Math.abs(this.estimatedVelocity.x); this.position.x = -10; bounce = true; }
            if (this.position.x > 10) { this.estimatedVelocity.x = -Math.abs(this.estimatedVelocity.x); this.position.x =  10; bounce = true; }
            if (this.position.z < -10) { this.estimatedVelocity.z = Math.abs(this.estimatedVelocity.z); this.position.z = -10; bounce = true; }
            if (this.position.z > 10) { this.estimatedVelocity.z = -Math.abs(this.estimatedVelocity.z); this.position.z =  10; bounce = true; }
            if (bounce) {
                this.estimatedVelocity.x *= 1 + this.bounce * Math.random();
                this.estimatedVelocity.y *= 1 + this.bounce * Math.random();
                this.estimatedVelocity.z *= 1 + this.bounce * Math.random();
            }
            const speed = this.estimatedVelocity.length();
            if (speed > 1) this.estimatedVelocity.multiplyScalar(0.5);
            super.applyVelocity();
        }
    }
}
