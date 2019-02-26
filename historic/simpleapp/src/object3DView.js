import * as THREE from 'three';
import View from './view.js';
import {SpatialEvents} from './spatialComponent';

export default class Object3DView extends View {
    /** @abstract */
    attachWithObject3D(_modelState) {
        return new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff0000") }));
    }

    attach(modelState) {
        super.attach(modelState);
        this.threeObj = this.attachWithObject3D(modelState);
        this.threeObj.userData.croquetView = this;

        this.threeObj.position.copy(modelState.spatial.position);
        this.threeObj.quaternion.copy(modelState.spatial.quaternion);
        this.threeObj.scale.copy(modelState.spatial.scale);

        this.subscribe(SpatialEvents.moved, "onMoved", this.modelId + ".spatial");
        this.subscribe(SpatialEvents.rotated, "onRotated", this.modelId + ".spatial");
    }

    addToThreeParent(parent) {
        parent.add(this.threeObj);
    }

    detach() {
        this.unsubscribe(SpatialEvents.moved, "onMoved", this.modelId + ".spatial");
        this.unsubscribe(SpatialEvents.rotated, "onRotated", this.modelId + ".spatial");
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
