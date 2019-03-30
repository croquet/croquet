import * as THREE from 'three';
import { ViewPart } from '../modelView.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class CameraViewPart extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.width = options.width;
        this.height = options.height;
        this.threeObj =  new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }

    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.threeObj.aspect = this.width / this.height;
        this.threeObj.updateProjectionMatrix();
    }
}
