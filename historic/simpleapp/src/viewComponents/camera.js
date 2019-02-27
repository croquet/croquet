import * as THREE from 'three';
import Object3DViewComponent from "./object3D.js";

export default class CameraViewComponent extends Object3DViewComponent {
    constructor(owner, width, height, componentName="camera") {
        super(owner, componentName);
        this.width = width;
        this.height = height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}
