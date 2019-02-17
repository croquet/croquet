import * as THREE from 'three';
import IslandReplica from './islandReplica';
import SpatialModel from './spatialModel';
import Object3DView from './object3DView';
import {Room, RoomView} from './room';
import {Observer, ObserverCameraView} from './observer';

class Box extends SpatialModel {
    naturalViewClass() { return BoxView; }
}

class RotatingBox extends SpatialModel {
    doRotation() {
        this.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.1));
        this.future(1000/60).doRotation();
    }

    naturalViewClass() { return BoxView; }
};

class BoxView extends Object3DView {
    createThreeObject(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#888888")})
        );
    }
}

function start() {
    const island = new IslandReplica();

    const room = new Room(island);
    const box = new Box(island);
    room.addObject(box);

    const rotatingBox = new RotatingBox(island);
    rotatingBox.moveBy(new THREE.Vector3(-3, 0, 0));
    rotatingBox.doRotation();
    room.addObject(rotatingBox);

    const observer = new Observer(
        island,
        new THREE.Vector3(0, 2, -5),
        (new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
        "Guest1"
    );
    room.addObserver(observer);

    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const roomView = new RoomView(island, observer, window.innerWidth, window.innerHeight);
    roomView.attach(room);

    const observerCameraView = new ObserverCameraView(island, window.innerWidth, window.innerHeight);
    observerCameraView.attach(observer);

    function frame() {
        renderer.render(roomView.scene, observerCameraView.threeObj);
        window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
}

start();