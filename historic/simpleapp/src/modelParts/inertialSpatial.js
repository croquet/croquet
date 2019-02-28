import * as THREE from 'three';
import SpatialPart from './spatial.js';

/** A spatial model with inertia */
export default class InertialSpatialPart extends SpatialPart {
    /** @param {SpatialPart} spatialPart */
    constructor(owner, state={}, options) {
        super(owner, state, options);
        this.estimatedVelocity = state.estimatedVelocity || new THREE.Vector3(0, 0, 0);
        this.estimatedRotationalVelocity = state.estimatedRotationalVelocity || new THREE.Quaternion();
        this.dampening = state.dampening || 0.1;
        this.inInertiaPhase = false;
        if (state.inInertiaPhase) this.startInertiaPhase();
    }

    toState(state) {
        super.toState(state);
        state.estimatedVelocity = this.estimatedVelocity;
        state.estimatedRotationalVelocity = this.estimatedRotationalVelocity;
        state.dampening = this.dampening;
        state.inInertiaPhase = this.inInertiaPhase;
    }

    moveBy(delta, addInertia=true) {
        super.moveBy(delta);
        if (addInertia) this.estimatedVelocity.copy(this.estimatedVelocity.clone().multiplyScalar(0.7).addScaledVector(delta, 0.3));
        this.startInertiaPhase();
    }

    moveTo(newPosition, addInertia=true) {
        const positionBefore = this.position.clone();
        super.moveTo(newPosition);
        const delta = newPosition.sub(positionBefore);
        if (addInertia) this.estimatedVelocity.copy(this.estimatedVelocity.clone().multiplyScalar(0.7).addScaledVector(delta, 0.3));
        this.startInertiaPhase();
    }

    rotateBy(deltaQuaternion, addInertia=true) {
        super.rotateBy(deltaQuaternion);
        if (addInertia) this.estimatedRotationalVelocity.copy(this.estimatedRotationalVelocity.clone().slerp(deltaQuaternion, 0.3));
        this.startInertiaPhase();
    }

    rotateTo(quaternion, addInertia=true) {
        const deltaQuaternion = quaternion.clone().multiply(this.quaternion.clone().inverse());
        super.rotateTo(quaternion);
        if (addInertia) this.estimatedRotationalVelocity.copy(this.estimatedRotationalVelocity.clone().slerp(deltaQuaternion, 0.3));
        this.startInertiaPhase();
    }

    startInertiaPhase() {
        if (!this.inInertiaPhase) {
            this.inInertiaPhase = true;
            this.future(1000 / 60).applyVelocity();
        }
    }

    applyVelocity() {
        if (this.inInertiaPhase) {
            super.moveBy(this.estimatedVelocity.clone());
            super.rotateBy(this.estimatedRotationalVelocity.clone());
            this.estimatedVelocity.multiplyScalar(1 - this.dampening);
            this.estimatedRotationalVelocity.slerp(new THREE.Quaternion(), this.dampening);
            const done = this.estimatedVelocity.manhattanLength() +
                this.estimatedRotationalVelocity.manhattanLength() - 1 < 0.00001;
            if (done) this.inInertiaPhase = false;
            else this.future(1000 / 60).applyVelocity();
        }
    }
}

if (!THREE.Quaternion.prototype.manhattanLength) THREE.Quaternion.prototype.manhattanLength = function() {
    return Math.abs(this._x) + Math.abs(this._y) + Math.abs(this._z) + Math.abs(this._w);
};
