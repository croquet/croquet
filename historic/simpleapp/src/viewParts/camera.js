import * as THREE from 'three';
import Object3DViewPart from "./object3D.js";

const moduleVersion = module.id + " #" + (module.bundle.v = (module.bundle.v || 0) + 1);
console.log("Loading " + moduleVersion);

export default class CameraViewPart extends Object3DViewPart {
    fromOptions(options) {
        this.width = options.width;
        this.height = options.height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}
