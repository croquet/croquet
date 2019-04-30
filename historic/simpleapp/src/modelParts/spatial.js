/** @module spatialPart */

import * as THREE from "three";
import { ModelPart } from "../parts";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const SpatialEvents = {
    moved: "spatial-moved",
    scaled: "spatial-scaled",
    rotated: "spatial-rotated"
};

/**
 * @class SpatialPart
 * @extends ModelPart
 */
export default class SpatialPart extends ModelPart {
    static types() {
        return {
            "THREE.Vector3": { cls: THREE.Vector3, write: vec3 => vec3.toArray(), read: state => new THREE.Vector3().fromArray(state) },
            "THREE.Quaternion": { cls: THREE.Quaternion, write: quat => quat.toArray(), read: state => new THREE.Quaternion().fromArray(state) },
        };
    }

    init(options={}, id) {
        super.init(options, id);
        /** @type {THREE.Vector3} */
        this.position = options.position || new THREE.Vector3(0, 0, 0);
        /** @type {THREE.Vector3} */
        this.scale = options.scale || new THREE.Vector3(1, 1, 1);
        /** @type {THREE.Quaternion} */
        this.quaternion = options.quaternion || new THREE.Quaternion();
    }

    /** @arg {THREE.Vector3} position */
    moveTo(position) {
        if (this.position.equals(position)) return;
        this.position.copy(position);
        this.publish(this.id, SpatialEvents.moved, this.position.clone());
    }

    /** @arg {THREE.Vector3} delta */
    moveBy(delta) {
        if ((delta.x === 0) && (delta.y === 0) && (delta.z === 0)) return;
        this.position.add(delta);
        this.publish(this.id, SpatialEvents.moved, this.position.clone());
    }

    /** @arg {THREE.Vector3} position */
    scaleTo(scale) {
        if (this.scale.equals(scale)) return;
        this.scale.copy(scale);
        this.publish(this.id, SpatialEvents.scaled, this.scale.clone());
    }

    /** @arg {THREE.Vector3} delta */
    scaleBy(factor) {
        if ((factor.x === 1) && (factor.y === 1) && (factor.z === 1)) return;
        this.scale.multiply(factor);
        this.publish(this.id, SpatialEvents.scaled, this.scale.clone());
    }

    rotateTo(quaternion) {
        if (this.quaternion.equals(quaternion)) return;
        this.quaternion.copy(quaternion);
        this.publish(this.id, SpatialEvents.rotated, this.quaternion.clone());
    }

    rotateBy(delta) {
        if ((delta.x === 0) && (delta.y === 0) && (delta.z === 0)) return;
        this.quaternion.multiply(delta);
        // quaternions apparently need to be normalized after
        // accrued multiplications or they get out of hand.
        this.quaternion.normalize();
        this.publish(this.id, SpatialEvents.rotated, this.quaternion.clone());
    }
}
