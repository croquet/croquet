import * as THREE from 'three';
import IslandReplica from './islandReplica.js';
import Model, {ModelComponent} from './model.js';
import SpatialComponent from './modelComponents/spatial.js';
import { Room, RoomView } from './room.js';
import { Observer, PointingObserverCameraView } from './observer.js';
import InertialSpatialComponent from './modelComponents/inertialSpatial.js';
import View from './view.js';
import hotreload from "./hotreload.js";
import TextComponent from './modelComponents/text.js';
import TextViewComponent from './viewComponents/text.js';
import Object3DViewComponent from './viewComponents/object3D.js';
import DraggableViewComponent from './viewComponents/draggable.js';
import TrackSpatial from './viewComponents/trackSpatial.js';

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
class BoxComponent extends Object3DViewComponent {
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
        this.object3D = new BoxComponent(this);
        this.track = new TrackSpatial(this);
        this.draggable = new DraggableViewComponent(this);
    }
}

/** View for rendering a Text */
class TextView extends View {
    constructor(island) {
        super(island);
        this.text = new TextViewComponent(this);
        this.track = new TrackSpatial(this, "track", "spatial", "text");
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
