import * as THREE from 'three';
import { ViewPart } from "../view.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class Object3D extends ViewPart {
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

export class Object3DGroup extends Object3D {
    static defaultPartId() {
        return "object3D";
    }

    attachWithObject3D(_modelState) {
        return new THREE.Group();
    }
}
