import * as THREE from 'three';
import IslandReplica from './islandReplica.js';
import Model, {ModelComponent} from './model.js';
import SpatialComponent from './modelComponents/spatial.js';
import Object3DView from './object3DView.js';
import { Room, RoomView } from './room.js';
import { Observer, PointingObserverCameraView, PointerEvents } from './observer.js';
import InertialSpatialComponent from './modelComponents/inertialSpatial.js';
import { TextMesh } from './text/text.js';
import hotreload from "./hotreload.js";
import TextComponent from './modelComponents/text.js';

/** Model for a Box */
export class Box extends Model {
    constructor(island, state) {
        super(island, state);
        this.spatial = new InertialSpatialComponent(this, state.spatial);
    }

    naturalViewClass() { return BoxView; }
}

class AutoRotate extends ModelComponent {
    constructor(owner, componentName="autoRotate", spatialComponentName="spatial") {
        super(owner, componentName);
        /** @type {SpatialComponent} */
        this.spatialComponent = owner[spatialComponentName];
    }

    doRotation() {
        this.spatialComponent.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }
}

/** Model for a rotating Box */
export class RotatingBox extends Model {
    constructor(island, state) {
        super(island, state);
        this.spatial = new SpatialComponent(this, state.spatial);
        this.autoRotate = new AutoRotate(this);
        this.autoRotate.doRotation();
    }

    naturalViewClass() { return BoxView; }
}

/** Model for a simple text display */
export class Text extends Model {
    constructor(island, state) {
        super(island, state);
        this.text = new TextComponent(this, state.text);
        this.spatial = new SpatialComponent(this, state.spatial);
    }

    naturalViewClass() { return TextView; }
}

/** View for a Box */
class BoxView extends Object3DView {
    attachWithObject3D(_modelState) {
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
        this.subscribe(PointerEvents.pointerUp, "onPointerUp");

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
        this.model().spatial.moveTo(this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart)));
    }

    onPointerUp() {
        this.cursor = "grab";
    }
}

/** View for rendering a Text */
class TextView extends Object3DView {
    attachWithObject3D(modelState) {
        return new TextMesh(modelState.text.content, modelState.text.font, {width: 500});
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

        const box = new Box(island, {spatial: {position: new THREE.Vector3(0, 1.0, 0)}});
        room.objects.add(box);

        const rotatingBox = new RotatingBox(island, {spatial: {position: new THREE.Vector3(-3, 1.0, 0)}});
        room.objects.add(rotatingBox);

        const text1 = new Text(island, {
            spatial: {position: new THREE.Vector3(3, 1.0, 0)},
            text: {content: "man is much more than a tool builder... he is an inventor of universes."}
        });
        room.objects.add(text1);

        const text2 = new Text(island, {
            spatial: {position: new THREE.Vector3(-5, 1.0, 0)},
            text: {content: "Chapter Eight - The Queen's Croquet Ground", font: "Lora"},
        });
        room.objects.add(text2);

        observer = new Observer(island, {
            spatial: {
                position: new THREE.Vector3(0, 2, -5),
                quaternion: (new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
            },
            name: "Guest1"
        });
        room.observers.add(observer);
    }

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
                island: island.toState(),
                room: room.id,
                observer: observer.id,
            };
        });
    }
}

start();
