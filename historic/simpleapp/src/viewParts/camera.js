import * as THREE from 'three';
import Object3DViewPart from "./object3D.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export default class CameraViewPart extends Object3DViewPart {
    fromOptions(options) {
        this.width = options.width;
        this.height = options.height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}
