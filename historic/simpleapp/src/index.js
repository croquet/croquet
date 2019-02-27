import * as THREE from 'three';
import IslandReplica from './islandReplica.js';
import Model, {ModelPart} from './model.js';
import SpatialPart from './modelParts/spatial.js';
import { Room, RoomView } from './room.js';
import { Observer, PointingObserverCameraView } from './observer.js';
import InertialSpatialPart from './modelParts/inertialSpatial.js';
import BouncingSpatialPart from './modelParts/bouncingSpatial.js';
import View from './view.js';
import hotreload from "./hotreload.js";
import TextPart from './modelParts/text.js';
import TextViewPart from './viewParts/text.js';
import Object3DViewPart from './viewParts/object3D.js';
import DraggableViewPart from './viewParts/draggable.js';
import TrackSpatial from './viewParts/trackSpatial.js';

/** Model for a Box */
export class Box extends Model {
    constructor(state) {
        super(state);
        this.spatial = new BouncingSpatialPart(this, state.spatial);
    }

    naturalViewClass() { return BoxView; }
}

class AutoRotate extends ModelPart {
    constructor(owner, partName="autoRotate", spatialPartName="spatial") {
        super(owner, partName);
        /** @type {SpatialPart} */
        this.spatialPart = owner[spatialPartName];
    }

    doRotation() {
        this.spatialPart.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }
}

/** Model for a rotating Box */
export class RotatingBox extends Model {
    constructor(state) {
        super(state);
        this.spatial = new InertialSpatialPart(this, state.spatial);
        this.autoRotate = new AutoRotate(this);
        this.autoRotate.doRotation();
    }

    naturalViewClass() { return BoxView; }
}

/** Model for a simple text display */
export class Text extends Model {
    constructor(state) {
        super(state);
        this.text = new TextPart(this, state.text);
        this.spatial = new SpatialPart(this, state.spatial);
    }

    naturalViewClass() { return TextView; }
}

/** View for a Box */
class BoxPart extends Object3DViewPart {
    attachWithObject3D(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color("#aaaaaa")})
        );
    }
}

class BoxView extends View {
    constructor(island) {
        super(island);
        this.object3D = new BoxPart(this);
        this.track = new TrackSpatial(this);
        this.draggable = new DraggableViewPart(this);
    }
}

/** View for rendering a Text */
class TextView extends View {
    constructor(island) {
        super(island);
        this.text = new TextViewPart(this);
        this.track = new TrackSpatial(this, "track", "spatial", "text");
    }
}

/** The main function. */
function start() {
    let state = module.hot && module.hot.data && module.hot.data.hotState || {};

    let room;
    let observer;

    const island = new IslandReplica(state.island, () => {
        room = new Room();

        const box = new Box({ spatial: { position: new THREE.Vector3(0, 1.0, 0) } });
        room.objects.add(box);

        const rotatingBox = new RotatingBox({ spatial: { position: new THREE.Vector3(-3, 1.0, 0) } });
        room.objects.add(rotatingBox);

        const text1 = new Text({
            spatial: { position: new THREE.Vector3(3, 1.0, 0) },
            text: { content: "man is much more than a tool builder... he is an inventor of universes." }
        });
        room.objects.add(text1);

        const text2 = new Text({
            spatial: { position: new THREE.Vector3(-5, 1.0, 0) },
            text: { content: "Chapter Eight - The Queen's Croquet Ground", font: "Lora" },
        });
        room.objects.add(text2);

        observer = new Observer({
            spatial: {
                position: new THREE.Vector3(0, 2, -5),
                quaternion: (new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
            },
            name: "Guest1"
        });
        room.observers.add(observer);
    });

    room = room || island.modelsById[state.room];
    observer = observer || island.modelsById[state.observer];

    const renderer = state.renderer || new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    state = null; // prevent accidental access below

    const roomView = new RoomView(island, observer);
    roomView.attach(room);

    const observerView = new PointingObserverCameraView(island, window.innerWidth, window.innerHeight);
    observerView.attach(observer);
    observerView.addToThreeParent(roomView.scene.scene);

    function frame() {
        renderer.render(roomView.scene.scene, observerView.camera.threeObj);
        observerView.pointer.updatePointer(roomView.scene.scene);
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => observerView.pointer.onMouseMove(event.clientX, event.clientY));
    hotreload.addEventListener(window, "mousedown", event => observerView.pointer.onMouseDown(event));
    hotreload.addEventListener(window, "mouseup", event => observerView.pointer.onMouseUp(event));
    hotreload.addEventListener(document.body, "touchstart", event => {
        observerView.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        observerView.pointer.updatePointer(roomView.scene);
        observerView.pointer.onMouseDown();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        observerView.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        observerView.pointer.onMouseUp();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        observerView.treadmill.onWheel(event);
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    if (module.hot) {
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            console.log(`index.js: module.hot.dispose()`);
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
            console.log(hotData.hotState.island);
        });
    }
}

start();
