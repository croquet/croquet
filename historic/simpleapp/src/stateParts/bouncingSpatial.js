import * as THREE from 'three';
import InertialSpatialPart from './inertialSpatial.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** A spatial model with inertia, gravity, and bouncing */
export default class BouncingSpatialPart extends InertialSpatialPart {
    static defaultPartId() { return "spatial"; }

    /** @param {SpatialPart} spatialPart */
    fromState(state={}, options) {
        super.fromState(state, options);
        this.dampening = state.dampening || 0.01;
        this.gravity = state.gravity || new THREE.Vector3(0, -0.001, 0);
        this.bounce = state.bounce || 0.1;
        this.ensure(this.gravity, THREE.Vector3);
        // kick off animation only (!) if created from scratch
        if (!("inInertiaPhase" in state)) this.startInertiaPhase();
        // otherwise, future message is still scheduled
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
                const random = axis => this.island.random() * this.bounce * (Math.sign(this.estimatedVelocity[axis]) || this.island.random() - 0.5);
                this.estimatedVelocity.x += random('x');
                this.estimatedVelocity.y += random('y');
                this.estimatedVelocity.z += random('z');
            }
            const speed = this.estimatedVelocity.length();
            if (speed > 1) this.estimatedVelocity.multiplyScalar(0.5);
            super.applyVelocity();
        }
    }

    shouldStop() { return false; }

    toggle() {
        if (this.inInertiaPhase) this.stop();
        else this.startInertiaPhase();
    }
}
