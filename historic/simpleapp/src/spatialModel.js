import Model from './model';
import * as THREE from 'three';

export const SpatialEvents = {
    moved: "spatial-moved",
    rotated: "spatial-rotated"
};

export default class SpatialModel extends Model {
    constructor(island, position = new THREE.Vector3(0, 0, 0), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1)) {
        super(island);
        this.position = position;
        this.quaternion = quaternion;
        this.scale = scale;
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
        this.publish(SpatialEvents.rotated, this.quaternion.clone());
    }
}
