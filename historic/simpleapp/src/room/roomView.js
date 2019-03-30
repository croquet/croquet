import * as THREE from 'three';
import { ViewPart } from '../modelView.js';
import WithManipulatorView from '../viewParts/manipulatorView.js';
import { ChildEvents } from '../stateParts/children.js';
import CameraViewPart from '../viewParts/camera.js';
import PointerViewPart, { makePointerSensitive, ignorePointer, PointerEvents } from '../viewParts/pointer.js';
import arrowsAlt from '../../assets/arrows-alt.svg';
import arrowsAltRot from '../../assets/arrows-alt-rot.svg';
import SVGIcon from '../util/svgIcon.js';
import TrackSpatial from '../viewParts/trackSpatial.js';
import InertialSpatialPart from '../stateParts/inertialSpatial.js';
import { PortalTraverserPart } from '../portal/portalModel.js';
import { KeyboardViewPart } from './keyboard.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class RoomView extends ViewPart {
    constructor(modelState, options={}) {
        super(modelState, options);

        this.viewState.parts.cameraSpatial = new InertialSpatialPart();
        this.viewState.init({
            cameraSpatial: {
                position: options.cameraPosition,
                quaternion: options.cameraQuaternion
            }
        });

        this.parts.trackedCamera = new TrackSpatial(this.viewState, {
            source: "cameraSpatial",
            inner: new CameraViewPart(modelState, {
                width: options.width,
                height: options.height
            })
        });

        this.parts.roomScene = new RoomScene(modelState);
        this.parts.objectViewManager = new ObjectViewManager(modelState, {scenePart: this.parts.roomScene});

        this.parts.portalTraverser = new PortalTraverserPart(this.viewState, {
            source: "cameraSpatial",
            onTraversed: options.onTraversedPortalView
        });

        if (options.activeParticipant) {
            this.parts.pointer = new PointerViewPart(modelState, {cameraPart: this.lookUp("trackedCamera.inner"), scenePart: this.parts.roomScene});
            this.parts.keyboard = new KeyboardViewPart(modelState, {});
            this.parts.treadmill = new TrackSpatial(this.viewState, {
                source: "cameraSpatial",
                inner: new TreadmillNavigation(this.viewState, {
                    affects: "cameraSpatial",
                    scenePart: this.parts.roomScene,
                    cameraPart: this.lookUp("trackedCamera.inner"),
                })
            });
        }
    }
}

class RoomScene extends ViewPart {
    /** @arg {Room} room */
    constructor(modelState, options) {
        super(modelState, options);
        this.scene = new THREE.Scene();
        this.grid = new THREE.GridHelper(10.0, 10, "#888888", "#aaaaaa");
        this.scene.add(this.grid);
        this.light = new THREE.DirectionalLight("#ffffdd");
        this.light.position.set(1, 2, 1);
        this.light.castShadow = true;
        this.light.shadow.mapSize.width = 1024;  // default
        this.light.shadow.mapSize.height = 1024; // default
        this.light.shadow.radius = 5;
        this.light.shadow.camera.near = 0.5;    // default
        this.light.shadow.camera.far = 10;     // default
        this.skyball = new THREE.Mesh(
            new THREE.SphereGeometry(50, 10, 10),
            new THREE.MeshBasicMaterial({color: modelState.parts.color.value, side: THREE.DoubleSide})
        );
        this.scene.add(this.skyball);

        this.scene.add(this.light);
        this.ambientLight = new THREE.HemisphereLight("#ddddff", "#ffdddd");
        this.scene.add(this.ambientLight);
        // this.scene.add(new THREE.AxesHelper(5));
        this.threeObj = this.scene;
    }
}

class ObjectViewManager extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.scenePart = options.scenePart;
        this.viewsForObjects = {};

        for (const object of modelState.parts.objects.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", modelState.parts.objects.id);
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", modelState.parts.objects.id);
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const innerView = new NaturalView(object, {});
        const view = new WithManipulatorView(object, {inner: innerView});
        this.viewsForObjects[object.id] = view;
        this.scenePart.threeObj.add(...view.threeObjs());
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        this.scenePart.threeObj.remove(...view.threeObjs());
        view.detach();
        delete this.viewsForObjects[object.id];
    }
}

class TreadmillNavigation extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        /** @type {CameraViewPart} */
        this.cameraPart = options.cameraPart;
        /** @type {RoomScene} */
        this.scenePart = options.scenePart;
        /** @type {SpatialPart} */
        this.affects = options.affects;

        // make treadmillForwardStrip look like a rectangle in screenspace
        const camera = this.cameraPart.threeObj;
        const d = 100;
        const w = Math.tan(camera.fov / 2 * (Math.PI / 180)) * camera.aspect * 0.5; // half width of frame
        const stripShape = new THREE.Shape([{x: 0, y: 0}, {x: w * d, y: d}, {x: -w * d, y: d}]);

        this.treadmill = new THREE.Group();
        this.treadmillForwardStrip = new THREE.Mesh(new THREE.ShapeBufferGeometry(stripShape), new THREE.MeshBasicMaterial({ color: "#eeeeee", visible: false}));
        this.treadmillForwardStrip.position.z += 0.1;
        makePointerSensitive(this.treadmillForwardStrip, this.id, -1);
        this.treadmillRotateArea = new THREE.Mesh(new THREE.CircleBufferGeometry(100, 30), new THREE.MeshBasicMaterial({color: "#cccccc", opacity: 0.2, transparent: true}));
        makePointerSensitive(this.treadmillRotateArea, this.id, -1);
        this.treadmill.add(this.treadmillForwardStrip);
        this.treadmill.add(this.treadmillRotateArea);
        this.treadmill.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        this.treadmill.position.y -= 2;

        this.moveCursor = new SVGIcon(arrowsAlt, new THREE.MeshBasicMaterial({color: "#888888"}));
        ignorePointer(this.moveCursor);
        this.moveCursor.visible = false;

        this.rotateCursor = new SVGIcon(arrowsAltRot, new THREE.MeshBasicMaterial({color: "#aaaaaa"}));
        ignorePointer(this.rotateCursor);
        this.rotateCursor.visible = false;

        const group = new THREE.Group();
        group.add(this.treadmill);
        group.add(this.moveCursor);
        group.add(this.rotateCursor);

        this.subscribe(PointerEvents.pointerMove, "onHoverTreadmillMove");
        this.subscribe(PointerEvents.pointerLeave, "onHoverTreadmillLeave");
        this.subscribe(PointerEvents.pointerDown, "onDragTreadmillStart");
        this.subscribe(PointerEvents.pointerDrag, "onDragTreadmill");

        this.threeObj = group;
    }

    onHoverTreadmillMove({hoverThreeObj, hoverPoint}) {
        if (hoverThreeObj === this.treadmillForwardStrip) {
            this.moveCursor.visible = true;
            this.moveCursor.position.copy(this.threeObj.worldToLocal(hoverPoint.clone()));
            this.rotateCursor.visible = false;
        } else {
            this.rotateCursor.visible = true;
            this.rotateCursor.position.copy(this.threeObj.worldToLocal(hoverPoint.clone()));
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                this.threeObj.getWorldDirection(new THREE.Vector3()),
                hoverPoint.clone().sub(this.threeObj.position.clone().setY(hoverPoint.y)).normalize(),
            );
            this.rotateCursor.quaternion.copy(delta);
            this.moveCursor.visible = false;
        }
    }

    onHoverTreadmillLeave() {
        this.moveCursor.visible = false;
        this.rotateCursor.visible = false;
    }

    onDragTreadmillStart() {
        this.positionBeforeObserverMove = this.threeObj.position.clone();
        this.quaternionBeforeObserverMove = this.threeObj.quaternion.clone();
    }

    onDragTreadmill({dragStart, dragEndOnHorizontalPlane, dragStartThreeObj}) {
        if (dragStartThreeObj === this.treadmillForwardStrip) {
            this.modelPart(this.affects).moveTo(this.threeObj.position.clone().sub(dragEndOnHorizontalPlane.clone().sub(dragStart)));
            this.moveCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
        } else {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize(),
                dragStart.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize()
            );
            this.modelPart(this.affects).rotateTo(this.threeObj.quaternion.clone().multiply(delta));
            this.rotateCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
            const deltaCursor = (new THREE.Quaternion()).setFromUnitVectors(
                this.threeObj.getWorldDirection(new THREE.Vector3()),
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragEndOnHorizontalPlane.y)).normalize(),
            );
            this.rotateCursor.quaternion.copy(deltaCursor);
        }
    }

    // TODO: this and its callsite is very ad-hoc
    onWheel(event) {
        const multiplier = 0.01;
        this.modelPart(this.affects).moveBy(new THREE.Vector3(event.deltaX * multiplier, 0, event.deltaY * multiplier).applyQuaternion(this.threeObj.quaternion), false);
    }
}
