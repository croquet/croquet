import * as THREE from 'three';
import IslandReplica from './islandReplica.js';
import Model from './model.js';
import SpatialModel from './spatialModel.js';
import Object3DView from './object3DView.js';
import { Room, RoomView } from './room.js';
import { Observer, PointingObserverCameraView, PointerEvents } from './observer.js';
import InertialModel from './inertialModel.js';
import { TextMesh } from './text/text.js';
import hotreload from "./hotreload.js";

/** Model for a Box */
export class Box extends InertialModel {
    naturalViewClass() { return BoxView; }
}

/** Model for a rotating Box */
export class RotatingBox extends SpatialModel {
    constructor(island, state) {
        super(island, state);
        this.doRotation();
    }

    /** rotate by 0.01 rad 60 times per second via future send */
    doRotation() {
        this.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }

    naturalViewClass() { return BoxView; }
}

/** Model for a simple text display */
export class Text extends InertialModel {
    constructor(island, state) {
        super(island, state);
        this.text = state.text;
        this.font = state.font;
    }

    state(state) {
        super.state(state);
        state.text = this.text;
        state.font = this.font;
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
    const state = module.hot && module.hot.data && module.hot.data.hotState || {};

    const island = new IslandReplica(state.island);

    let room;
    let observer;

    if (state.room) {
        room = island.modelsById[state.room];
        observer = island.modelsById[state.observer];
    } else {
        room = new Room(island);

        const box = new Box(island, {position: new THREE.Vector3(0, 1.0, 0)});
        room.addObject(box);

        const rotatingBox = new RotatingBox(island, {position: new THREE.Vector3(-3, 1.0, 0)});
        room.addObject(rotatingBox);

        const text1 = new Text(island, {
            position: new THREE.Vector3(3, 1.0, 0),
            text: "man is much more than a tool builder... he is an inventor of universes.",
            font: "Barlow"
        });
        room.addObject(text1);

        const text2 = new Text(island, {
            position: new THREE.Vector3(-5, 1.0, 0),
            text: "Chapter Eight - The Queen's Croquet Ground",
            font: "Lora",
        });
        room.addObject(text2);

        observer = new Observer(island, {
            position: new THREE.Vector3(0, 2, -5),
            quaternion: (new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
            name: "Guest1"
        });
    }
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

    if (module.hot) {
        module.hot.dispose(hotData => {
            // unregister all callbacks, they refer to old functions
            hotreload.dispose();
            // clean old references
            Model.dispose();
            // release WebGL resources
            roomView.detach();
            observerView.detach();
            // preserve state, will be available as module.hot.data after reload
            hotData.hotState = {
                renderer,
                island: island.state(),
                room: room.id,
                observer: observer.id,
            };
        });
    }
}

start();
