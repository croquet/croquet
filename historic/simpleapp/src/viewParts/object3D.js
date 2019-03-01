import * as THREE from 'three';
import { ViewPart } from "../view.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

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
        if (!this.threeObj.parent) parent.add(this.threeObj);
    }

    removeFromThreeParent(parent) {
        if (this.threeObj.parent === parent) parent.remove(this.threeObj);
    }
}

export class Object3DGroupViewPart extends Object3DViewPart {
    static defaultPartName() {
        return "object3D";
    }

    attachWithObject3D(_modelState) {
        return new THREE.Group();
    }
}
