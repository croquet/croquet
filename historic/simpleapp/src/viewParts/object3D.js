import * as THREE from 'three';
import { ViewPart } from "../view.js";

export default class Object3DViewPart extends ViewPart {
    attach(modelState) {
        /** @type {THREE.Object3D} */
        this.threeObj = this.attachWithObject3D(modelState);
    }

    attachWithObject3D(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff0000") })
        );
    }

    addToThreeParent(parent) {
        parent.add(this.threeObj);
    }

    removeFromThreeParent(parent) {
        parent.remove(this.threeObj);
    }
}
