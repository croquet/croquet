/** @module spatialPart */

import * as THREE from 'three';
import StatePart from "../statePart.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const SpatialEvents = {
    moved: "spatial-moved",
    scaled: "spatial-scaled",
    rotated: "spatial-rotated"
};

/**
 * @class SpatialPart
 * @extends StatePart
 */
export default class SpatialPart extends StatePart {
    fromState(state={}) {
        /** @type {THREE.Vector3} */
        this.position = state.position || new THREE.Vector3(0, 0, 0);
        /** @type {THREE.Quaternion} */
        this.quaternion = state.quaternion || new THREE.Quaternion();
        this.scale = state.scale || new THREE.Vector3(1, 1, 1);
        this.ensure(this.position, THREE.Vector3);
        this.ensure(this.scale, THREE.Vector3);
        this.ensure(this.quaternion, THREE.Quaternion);
    }

    /** @arg {THREE.Vector3} position */
    moveTo(position) {
        if (this.position.equals(position)) return;
        this.position.copy(position);
        this.publish(SpatialEvents.moved, this.position.clone());
    }

    /** @arg {THREE.Vector3} delta */
    moveBy(delta) {
        if ((delta.x === 0) && (delta.y === 0) && (delta.z === 0)) return;
        this.position.add(delta);
        this.publish(SpatialEvents.moved, this.position.clone());
    }

    /** @arg {THREE.Vector3} position */
    scaleTo(scale) {
        if (this.scale.equals(scale)) return;
        this.scale.copy(scale);
        this.publish(SpatialEvents.scaled, this.scale.clone());
    }

    /** @arg {THREE.Vector3} delta */
    scaleBy(factor) {
        if ((factor.x === 1) && (factor.y === 1) && (factor.z === 1)) return;
        this.scale.multiply(factor);
        this.publish(SpatialEvents.scaled, this.scale.clone());
    }

    rotateTo(quaternion) {
        if (this.quaternion.equals(quaternion)) return;
        this.ensure(quaternion, THREE.Quaternion); // HACK for future message
        this.quaternion.copy(quaternion);
        this.publish(SpatialEvents.rotated, this.quaternion.clone());
    }

    rotateBy(delta) {
        if ((delta.x === 0) && (delta.y === 0) && (delta.z === 0)) return;
        this.quaternion.multiply(delta);
        // quaternions apparently need to be normalized after
        // accrued multiplications or they get out of hand.
        this.quaternion.normalize();
        this.publish(SpatialEvents.rotated, this.quaternion.clone());
    }

    toState(state) {
        super.toState(state);
        state.position = this.position;
        state.quaternion = this.quaternion;
        state.scale = this.scale;
    }
}
