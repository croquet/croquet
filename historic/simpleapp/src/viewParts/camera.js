import * as THREE from 'three';
import Object3DViewPart from "./object3D.js";

export default class CameraViewPart extends Object3DViewPart {
    constructor(owner, options) {
        options = {partName: "camera", ...options};
        super(owner, options);
        this.width = options.width;
        this.height = options.height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}
