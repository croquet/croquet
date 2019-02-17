import SpatialModel from './spatialModel';
import Object3DView from './object3DView';
import * as THREE from 'three';

export class Observer extends SpatialModel {
    constructor(island, position, quaternion, name) {
        super(island, position, quaternion);
        this.name = name;
    }
};

export class ObserverCameraView extends Object3DView {
    constructor(island, width, height) {
        super(island);
        this.width = width;
        this.height = height;
    }

    createThreeObject(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}

export class ObserverAvatarView extends Object3DView {
    // TODO
}