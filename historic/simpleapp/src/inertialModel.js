import SpatialModel from './spatialModel';
import * as THREE from 'three'

export default class InertialModel extends SpatialModel {
    constructor(island, position = new THREE.Vector3(0, 0, 0), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1)) {
        super(island, position, quaternion, scale);
        this.estimatedVelocity = new THREE.Vector3(0, 0, 0);
        this.estimatedRotationalVelocity = new THREE.Quaternion();
        this.dampening = 0.1;
        this.inInertiaPhase = false;
        this.applyVelocity();
    }

    moveBy(delta, addInertia=true) {
        super.moveBy(delta);
        if (addInertia) this.estimatedVelocity.copy(this.estimatedVelocity.clone().multiplyScalar(0.7).addScaledVector(delta, 0.3));
        this.inInertiaPhase = false;
        this.future(1000/30).startInertiaPhase();
    }

    moveTo(newPosition, addInertia=true) {
        const positionBefore = this.position.clone();
        super.moveTo(newPosition);
        const delta = newPosition.sub(positionBefore);
        if (addInertia) this.estimatedVelocity.copy(this.estimatedVelocity.clone().multiplyScalar(0.7).addScaledVector(delta, 0.3));
        this.inInertiaPhase = false;
        this.future(1000/10).startInertiaPhase();
    }

    rotateBy(deltaQuaternion, addInertia=true) {
        super.rotateBy(deltaQuaternion);
        if (addInertia) this.estimatedRotationalVelocity.copy(this.estimatedRotationalVelocity.clone().slerp(deltaQuaternion, 0.3));
        this.inInertiaPhase = false;
        this.future(1000/10).startInertiaPhase();
    }

    rotateTo(quaternion, addInertia=true) {
        const deltaQuaternion = quaternion.clone().multiply(this.quaternion.clone().inverse());
        super.rotateTo(quaternion);
        if (addInertia) this.estimatedRotationalVelocity.copy(this.estimatedRotationalVelocity.clone().slerp(deltaQuaternion, 0.3));
        this.inInertiaPhase = false;
        this.future(1000/10).startInertiaPhase();
    }

    startInertiaPhase() {
        this.inInertiaPhase = true;
    }

    applyVelocity() {
        if (this.inInertiaPhase) {
            super.moveBy(this.estimatedVelocity.clone());
            super.rotateBy(this.estimatedRotationalVelocity.clone());
            this.estimatedVelocity.multiplyScalar(1 - this.dampening);
            this.estimatedRotationalVelocity.slerp(new THREE.Quaternion(), this.dampening);
        }
        this.future(1000/60).applyVelocity();
    }
}