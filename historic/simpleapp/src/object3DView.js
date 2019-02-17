import View from './view';
import * as THREE from 'three';
import {SpatialEvents} from './spatialModel';

export default class Object3DView extends View {
    /** @abstract */
    createThreeObject(_modelState) {
        return new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff0000") }));
    }

    attach(modelState) {
        this.threeObj = this.createThreeObject(modelState);
        this.threeObj.position.copy(modelState.position);
        this.threeObj.quaternion.copy(modelState.quaternion);
        this.threeObj.scale.copy(modelState.scale);
        this.subscribe(modelState.id, SpatialEvents.moved, "onMoved");
        this.subscribe(modelState.id, SpatialEvents.rotated, "onRotated");
    }

    detach() {
        this.unsubscribe(modelState.id.SpatialEvents.moved, "onMoved");
        this.unsubscribe(modelState.id.SpatialEvents.rotated, "onRotated");
        this.dispose();
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
