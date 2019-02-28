import * as THREE from 'three';
import Object3DViewPart from "./object3D.js";

export default class CameraViewPart extends Object3DViewPart {
    constructor(owner, options) {
        const fullOptions = {partName: "camera", ...options};
        super(owner, fullOptions);
        this.width = fullOptions.width;
        this.height = fullOptions.height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}
