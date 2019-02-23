/** @module spatialModel */

import * as THREE from 'three';
import Model from './model.js';

export const SpatialEvents = {
    moved: "spatial-moved",
    rotated: "spatial-rotated"
};

/**
 * @class SpatialModel
 * @extends Model
 */
export default class SpatialModel extends Model {
    constructor(island, state={}) {
        super(island, state);
        this.position = state.position || new THREE.Vector3(0, 0, 0);
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

    state(state) {
        super.state(state);
        state.position = this.position;
        state.quaternion = this.quaternion;
        state.scale = this.scale;
    }
}
