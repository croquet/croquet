import * as THREE from 'three';
import Object3D from "./object3D.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class CameraViewPart extends Object3D {
    fromOptions(options) {
        super.fromOptions(options);
        this.width = options.width;
        this.height = options.height;
    }

    attachWithObject3D(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }

    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.threeObj.aspect = this.width / this.height;
        this.threeObj.updateProjectionMatrix();
    }
}
