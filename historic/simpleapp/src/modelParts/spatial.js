/** @module spatialPart */

import * as THREE from 'three';
import {ModelPart} from '../model.js';

export const SpatialEvents = {
    moved: "spatial-moved",
    rotated: "spatial-rotated"
};

/**
 * @class SpatialPart
 * @extends ModelPart
 */
export default class SpatialPart extends ModelPart {
    constructor(owner, state={}, options) {
        super(owner, {partName: "spatial", ...options});
        /** @type {THREE.Vector3} */
        this.position = state.position || new THREE.Vector3(0, 0, 0);
        /** @type {THREE.Quaternion} */
        this.quaternion = state.quaternion || new THREE.Quaternion();
        this.scale = state.scale || new THREE.Vector3(1, 1, 1);
    }

    /** @arg {THREE.Vector3} position */
    moveTo(position) {
        this.position.copy(position);
        this.publish(SpatialEvents.moved, this.position.clone());
    }

    /** @arg {THREE.Vector3} delta */
    moveBy(delta) {
        this.position.add(delta);
        this.publish(SpatialEvents.moved, this.position.clone());
    }

    rotateTo(quaternion) {
        this.quaternion.copy(quaternion);
        this.publish(SpatialEvents.rotated, this.quaternion.clone());
    }

    rotateBy(deltaQuaternion) {
        this.quaternion.multiply(deltaQuaternion);
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
