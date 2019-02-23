import * as THREE from 'three';
import IslandReplica from './islandReplica.js';
import SpatialModel from './spatialModel.js';
import Object3DView from './object3DView.js';
import { Room, RoomView } from './room.js';
import { Observer, PointingObserverCameraView, PointerEvents } from './observer.js';
import InertialModel from './inertialModel.js';
import { TextMesh } from './text/text.js';
import hotreload from "./hotreload.js";

/** Model for a Box */
class Box extends InertialModel {
    naturalViewClass() { return BoxView; }
}

/** Model for a rotating Box */
class RotatingBox extends SpatialModel {

    /** rotate by 0.01 rad 60 times per second via future send */
    doRotation() {
        this.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }

    naturalViewClass() { return BoxView; }
}

/** Model for a simple text display */
class Text extends InertialModel {
    constructor(island, text, font) {
        super(island);
        this.text = text;
        this.font = font;
    }

    naturalViewClass() { return TextView; }
}

/** View for a Box */
class BoxView extends Object3DView {
    attachWithObject3D(_modelState) {
        this.subscribe(this.id, PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(this.id, PointerEvents.pointerDrag, "onPointerDrag");
        this.subscribe(this.id, PointerEvents.pointerUp, "onPointerUp");

        this.cursor = "grab";

        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color("#aaaaaa")})
        );

    }

    onPointerDown() {
        this.positionAtDragStart = this.threeObj.position.clone();
        this.cursor = "grabbing";
    }

    onPointerDrag({dragStart, _dragStartNormal, _dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
        // const dragEnd = Math.abs(dragStartNormal.y) > 0.5 ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
        const dragEnd = dragEndOnVerticalPlane;
        this.model().moveTo(this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart)));
    }

    onPointerUp() {
        this.cursor = "grab";
    }
}

/** View for rendering a Text */
class TextView extends Object3DView {
    attachWithObject3D(modelState) {
        return new TextMesh(modelState.text, modelState.font, {width: 500});
    }
}

/** The main function. */
function start() {
    const island = new IslandReplica();

    const room = new Room(island);
    const box = new Box(island);
    box.moveTo(new THREE.Vector3(0, 1.0, 0), false);
    room.addObject(box);

    const rotatingBox = new RotatingBox(island);
    rotatingBox.moveTo(new THREE.Vector3(-3, 1.0, 0));
    rotatingBox.doRotation();
    room.addObject(rotatingBox);

    const text1 = new Text(island, "man is much more than a tool builder... he is an inventor of universes.", "Barlow");
    text1.moveTo(new THREE.Vector3(3, 1.0, 0), false);
    room.addObject(text1);

    const text2 = new Text(island, "Chapter Eight - The Queen's Croquet Ground", "Lora");
    text2.moveTo(new THREE.Vector3(-5, 1.0, 0), false);
    room.addObject(text2);

    const observer = new Observer(
        island,
        new THREE.Vector3(0, 2, -5),
        (new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
        "Guest1"
    );
    room.addObserver(observer);


    const renderer = state.renderer || new THREE.WebGLRenderer();
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
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => observerView.onMouseMove(event.clientX, event.clientY));
    hotreload.addEventListener(window, "mousedown", event => observerView.onMouseDown(event));
    hotreload.addEventListener(window, "mouseup", event => observerView.onMouseUp(event));
    hotreload.addEventListener(document.body, "touchstart", event => {
        observerView.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        observerView.updatePointer(roomView.scene);
        observerView.onMouseDown();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        observerView.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        observerView.onMouseUp();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        observerView.onWheel(event);
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});
}

    if (module.hot) {
        module.hot.dispose(hotData => {
            // disable hot reload unless url has #hot
            if (window.location.hash !== '#hot') return window.location.reload();

            // unregister all callbacks, they refer to old functions
            hotreload.dispose();
            // preserve state, will be available as module.hot.data after reload
            hotData.hotState = {
                renderer,
            };
        });
    }
}

start();
