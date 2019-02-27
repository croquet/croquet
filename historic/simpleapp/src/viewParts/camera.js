import * as THREE from 'three';
import Object3DViewPart from "./object3D.js";

export default class CameraViewPart extends Object3DViewPart {
    constructor(owner, width, height, partName="camera") {
        super(owner, partName);
        this.width = width;
        this.height = height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}
