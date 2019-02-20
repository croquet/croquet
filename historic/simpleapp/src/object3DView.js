import * as THREE from 'three';
import View from './view.js';
import {SpatialEvents} from './spatialModel.js';

export default class Object3DView extends View {
    /** @abstract */
    attachWithObject3D(_modelState) {
        return new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff0000") }));
    }

    attach(modelState) {
        super.attach(modelState);
        this.threeObj = this.attachWithObject3D(modelState);
        this.threeObj.userData.croquetView = this;

        this.threeObj.position.copy(modelState.position);
        this.threeObj.quaternion.copy(modelState.quaternion);
        this.threeObj.scale.copy(modelState.scale);

        this.subscribe(modelState.id, SpatialEvents.moved, "onMoved");
        this.subscribe(modelState.id, SpatialEvents.rotated, "onRotated");
    }

    addToThreeParent(parent) {
        parent.add(this.threeObj);
    }

    detach() {
        this.unsubscribe(modelState.id.SpatialEvents.moved, "onMoved");
        this.unsubscribe(modelState.id.SpatialEvents.rotated, "onRotated");
        this.dispose();
    }

    removeFromThreeParent(parent) {
        parent.remove(this.threeObj);
    }

    /** @abstract */
    dispose() { }

    onMoved(newPosition) {
        this.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.threeObj.quaternion.copy(newQuaternion);
    }
}
