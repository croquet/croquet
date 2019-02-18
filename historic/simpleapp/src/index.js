import * as THREE from 'three';
import IslandReplica from './islandReplica';
import SpatialModel from './spatialModel';
import Object3DView from './object3DView';
import {Room, RoomView} from './room';
import {Observer, PointingObserverCameraView, PointerEvents} from './observer';
import InertialModel from './inertialModel';

class Box extends InertialModel {
    naturalViewClass() { return BoxView; }
}

class RotatingBox extends SpatialModel {
    doRotation() {
        this.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }

    naturalViewClass() { return BoxView; }
};

class BoxView extends Object3DView {
    attachWithObject3D(_modelState) {
        this.subscribe(this.id, PointerEvents.pointerEnter, "onPointerEnter");
        this.subscribe(this.id, PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(this.id, PointerEvents.pointerDrag, "onPointerDrag");
        this.subscribe(this.id, PointerEvents.pointerUp, "onPointerUp");
        this.subscribe(this.id, PointerEvents.pointerLeave, "onPointerLeave");
        this.cursor = "grab";

        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color("#aaaaaa")})
        );

    }

    onPointerEnter() {
        this.threeObj.material.color.set("#00ff00");
    }

    onPointerDown() {
        this.positionAtDragStart = this.threeObj.position.clone();
        this.threeObj.material.color.set("#0000ff");
        this.cursor = "grabbing";
    }

    onPointerDrag({dragStart, dragStartNormal, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
        const dragEnd = Math.abs(dragStartNormal.y) > 0.5 ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
        this.model().moveTo(this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart)));
    }

    onPointerUp() {
        this.threeObj.material.color.set("#00ff00");
        this.cursor = "grab";
    }

    onPointerLeave() {
        this.threeObj.material.color.set("#aaaaaa");
    }
}

function start() {
    const island = new IslandReplica();

    const room = new Room(island);
    const box = new Box(island);
    box.moveTo(new THREE.Vector3(0, 0.5, 0), false);
    room.addObject(box);

    const rotatingBox = new RotatingBox(island);
    rotatingBox.moveTo(new THREE.Vector3(-3, 0.5, 0));
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

    const observerView = new PointingObserverCameraView(island, window.innerWidth, window.innerHeight);
    observerView.attach(observer);
    observerView.addToThreeParent(roomView.scene);

    function frame() {
        renderer.render(roomView.scene, observerView.camera);
        observerView.updatePointer(roomView.scene);
        window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);

    window.addEventListener("mousemove", (event) => observerView.onMouseMove(event.clientX, event.clientY));
    window.addEventListener("mousedown", (event) => observerView.onMouseDown(event));
    window.addEventListener("mouseup", (event) => observerView.onMouseUp(event));
    document.body.addEventListener("touchstart", (event) => {
        observerView.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        observerView.updatePointer(roomView.scene);
        observerView.onMouseDown();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    document.body.addEventListener("touchmove", (event) => {
        observerView.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
    }, {passive: false});

    document.body.addEventListener("touchend", (event) => {
        observerView.onMouseUp();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});
}

start();