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
import Object3DViewPart, { Object3DGroupViewPart } from './viewParts/object3D.js';
import DraggableViewPart from './viewParts/draggable.js';
import TrackSpatialViewPart from './viewParts/trackSpatial.js';
import { LayoutRootViewPart, LayoutContainerViewPart, StretchedObject3DLayoutViewPart } from './viewParts/layout.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

/** Model for a Box */
export class Box extends Model {
    buildParts(state) {
        new BouncingSpatialPart(this, state);
    }

    naturalViewClass() { return BoxView; }
}

class AutoRotate extends ModelPart {
    constructor(owner, _state, options) {
        options = {target: "spatial", ...options};
        super(owner, options);
        /** @type {SpatialPart} */
        this.spatialPart = owner.parts[options.target];
    }

    doRotation() {
        this.spatialPart.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }
}

/** Model for a rotating Box */
export class RotatingBox extends Model {
    buildParts(state) {
        new InertialSpatialPart(this, state);
        new AutoRotate(this);
        this.parts.autoRotate.doRotation();
    }

    naturalViewClass() { return BoxView; }
}

/** Model for a simple text display */
export class Text extends Model {
    buildParts(state) {
        new TextPart(this, state);
        new SpatialPart(this, state);
    }

    naturalViewClass() { return TextView; }
}

/** View for a Box */
class BoxViewPart extends Object3DViewPart {
    fromOptions(options) {
        options = {color: "#aaaaaa", ...options};
        super.fromOptions(options);
        this.color = options.color;
    }

    attachWithObject3D(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color(this.color)})
        );
    }
}

class BoxView extends View {
    buildParts() {
        new BoxViewPart(this);
        new TrackSpatialViewPart(this, {affects: "box"});
        new DraggableViewPart(this, {dragHandle: "box"});
    }
}

/** View for rendering a Text */
class TextView extends View {
    buildParts() {
        new TextViewPart(this);
        new TrackSpatialViewPart(this, {affects: "text"});
    }
}

export class LayoutTestModel extends Model {
    buildParts(state) {
        new SpatialPart(this, state);
    }

    naturalViewClass() {
        return LayoutTestView;
    }
}

class LayoutTestView extends View {
    buildParts() {
        new BoxViewPart(this, {partName: "box1", color: "#ff0000"});
        new BoxViewPart(this, {partName: "box2", color: "#ffff00"});
        new BoxViewPart(this, {partName: "box3", color: "#00ff00"});
        new BoxViewPart(this, {partName: "box4", color: "#00ffff"});
        new BoxViewPart(this, {partName: "box5", color: "#0000ff"});

        new Object3DGroupViewPart(this);
        new TrackSpatialViewPart(this);

        new LayoutRootViewPart(this, {children: [
            new LayoutContainerViewPart(this, {
                partName: "row",
                flexDirection: "row",
                alignItems: "stretch",
                // padding: 0.3,
                children: [
                    new StretchedObject3DLayoutViewPart(this, {
                        partName: "box1layout", affects: "box1", margin: 0.1
                    }),
                    new StretchedObject3DLayoutViewPart(this, {
                        partName: "box2layout", affects: "box2", margin: 0.1,
                    }),
                    new LayoutContainerViewPart(this, {
                        partName: "columnInRow",
                        flexDirection: "column",
                        // padding: 0.1,
                        children: [
                            new StretchedObject3DLayoutViewPart(this, {
                                partName: "box3layout", affects: "box3", margin: 0.1
                            }),
                            new StretchedObject3DLayoutViewPart(this, {
                                partName: "box4layout", affects: "box4", margin: 0.1
                            }),
                            new StretchedObject3DLayoutViewPart(this, {
                                partName: "box5layout", affects: "box5", margin: 0.1
                            }),
                        ]
                    })
                ]
            })
        ]});
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
        room.parts.objects.add(box);

        const rotatingBox = new RotatingBox({ spatial: { position: new THREE.Vector3(3, 1.0, 0) } });
        room.parts.objects.add(rotatingBox);

        const text1 = new Text({
            spatial: { position: new THREE.Vector3(-3, 1.0, 0) },
            text: { content: "man is much more than a tool builder... he is an inventor of universes." }
        });
        room.parts.objects.add(text1);

        const text2 = new Text({
            spatial: { position: new THREE.Vector3(5, 1.0, 0) },
            text: { content: "Chapter Eight - The Queen's Croquet Ground", font: "Lora" },
        });
        room.parts.objects.add(text2);

        const layoutTest = new LayoutTestModel({
            spatial: { position: new THREE.Vector3(0, 1.0, 1.0)}
        });
        room.parts.objects.add(layoutTest);

        observer = new Observer({
            spatial: {
                position: new THREE.Vector3(0, 2, 5),
            },
            name: "Guest1"
        });
        room.parts.observers.add(observer);
    });

    room = room || island.modelsById[state.room];
    observer = observer || island.modelsById[state.observer];

    const renderer = state.renderer || new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    state = null; // prevent accidental access below

    const roomView = new RoomView(island, {localObserver: observer});
    roomView.attach(room);

    const observerView = new PointingObserverCameraView(island, {width: window.innerWidth, height: window.innerHeight});
    observerView.attach(observer);
    observerView.addToThreeParent(roomView.parts.scene.scene);

    function frame() {
        renderer.render(roomView.parts.scene.scene, observerView.parts.camera.threeObj);
        observerView.parts.pointer.updatePointer(roomView.parts.scene.scene);
        island.processModelViewEvents();
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => observerView.parts.pointer.onMouseMove(event.clientX, event.clientY));
    hotreload.addEventListener(window, "mousedown", event => observerView.parts.pointer.onMouseDown(event));
    hotreload.addEventListener(window, "mouseup", event => observerView.parts.pointer.onMouseUp(event));
    hotreload.addEventListener(document.body, "touchstart", event => {
        observerView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        observerView.pointer.updatePointer(roomView.parts.scene);
        observerView.parts.pointer.onMouseDown();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        observerView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        observerView.parts.pointer.onMouseUp();
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        observerView.parts.treadmillNavigation.onWheel(event);
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    if (module.hot) {
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            // unregister all callbacks, they refer to old functions
            hotreload.dispose();
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
        // start logging module loads
        if (!module.bundle.v) module.bundle.v = 1;
    }
}

start();
