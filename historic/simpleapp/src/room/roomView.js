import * as THREE from 'three';
import { ViewPart } from '../modelView.js';
import WithManipulator from '../viewParts/manipulatorView.js';
import { ChildEvents } from '../stateParts/children.js';
import CameraViewPart from '../viewParts/camera.js';
import PointerViewPart, { makePointerSensitive, ignorePointer, PointerEvents } from '../viewParts/pointer.js';
import arrowsAlt from '../../assets/arrows-alt.svg';
import arrowsAltRot from '../../assets/arrows-alt-rot.svg';
import SVGIcon from '../util/svgIcon.js';
import Tracking, { Facing } from '../viewParts/tracking.js';
import SpatialPart from '../stateParts/spatial.js';
import Inertial from '../stateParts/inertial.js';
import { PortalTraversing, PortalEvents, PortalTopic } from '../portal/portalModel.js';
import { KeyboardViewPart } from './keyboard.js';
import { ContextMenu } from '../viewParts/menu.js';
import { ColorEvents } from '../stateParts/color.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class RoomView extends ViewPart {
    /** @arg {{room: import('./roomModel').default}} options */
    constructor(options) {
        super();

        this.cameraSpatial = new (PortalTraversing(Inertial(SpatialPart)))();
        this.cameraSpatial.init({
            position: options.cameraPosition,
            quaternion: options.cameraQuaternion
        });

        this.parts.camera = new (Tracking(CameraViewPart, {source: this.cameraSpatial}))({
            width: options.width,
            height: options.height
        });

        this.parts.roomScene = new RoomScene({room: options.room});
        this.parts.objectViewManager = new ObjectViewManager({room: options.room, scenePart: this.parts.roomScene});

        if (options.activeParticipant) {
            this.parts.pointer = new PointerViewPart({room: options.room, cameraPart: this.parts.camera, scenePart: this.parts.roomScene});
            this.parts.keyboard = new KeyboardViewPart();
            this.parts.treadmill = new (Tracking(TreadmillNavigation, {source: this.cameraSpatial}))({
                affects: this.cameraSpatial,
                scenePart: this.parts.roomScene,
                cameraPart: this.parts.camera,
            });
            this.parts.interactionDome = new (Tracking(InteractionDome, {source: this.cameraSpatial}))({
                cameraSpatial: this.cameraSpatial,
                scenePart: this.parts.roomScene,
                changeColor: color => options.room.parts.color.future().setColor(color),
                resetCameraPosition: () => {
                    this.cameraSpatial.moveTo(new THREE.Vector3(0, 2, 4), false);
                    this.cameraSpatial.rotateTo(new THREE.Quaternion(), false);
                }
            });

            this.traversePortalToRoom = options.traversePortalToRoom;
            this.subscribe(PortalEvents.traversed, "onPortalTraversed", PortalTopic);
        }
    }

    onPortalTraversed(traverseInfo) {
        if (traverseInfo.traverserId === this.cameraSpatial.id) {
            this.traversePortalToRoom(traverseInfo);
            this.parts.pointer.onMouseUp();
            // take a step back in this room for when we come back
            const stepBack = new THREE.Vector3(0, 0, 1).applyQuaternion(this.cameraSpatial.quaternion);
            this.cameraSpatial.moveByNoPortalTraverse(stepBack);
        }
    }
}

class RoomScene extends ViewPart {
    /** @arg {{room: import('./roomModel').default}} options */
    constructor(options) {
        super();
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
        this.skydome = new THREE.Mesh(
            new THREE.SphereGeometry(50, 10, 10),
            new THREE.MeshBasicMaterial({color: options.room.parts.color.value, side: THREE.DoubleSide})
        );
        this.scene.add(this.skydome);

        this.scene.add(this.light);
        this.ambientLight = new THREE.HemisphereLight("#ddddff", "#ffdddd");
        this.scene.add(this.ambientLight);
        // this.scene.add(new THREE.AxesHelper(5));
        this.threeObj = this.scene;

        this.subscribe(ColorEvents.changed, "colorChanged", options.room.parts.color.id);
    }

    colorChanged(newColor) {
        this.skydome.material.color = new THREE.Color(newColor);
    }
}

class InteractionDome extends ViewPart {
    constructor(options) {
        super();

        this.parts = {
            contextMenu: new (Facing(ContextMenu, {source: options.cameraSpatial}))({
                entries: [
                    ["Change Room Color", () => {
                        options.changeColor(new THREE.Color(`hsl(${Math.random() * 360}, 50%, 90%)`));
                    }],
                    ["Back to room center", () => {
                        options.resetCameraPosition();
                        this.parts.contextMenu.dismiss();
                    }],
                    ["Show/Hide Debug Info", () => {
                        document.body.className = document.body.className === "debug" ? "" : "debug";
                    }],
                ]
            })
        };

        this.escapeKeyHandler = e => {
            if (e.key === "Escape") {
                this.parts.contextMenu.dismiss();
            }
        };

        document.addEventListener("keyup", this.escapeKeyHandler);

        this.scenePart = options.scenePart;

        this.scenePart.threeObj.add(this.parts.contextMenu.threeObj);

        this.threeObj = new THREE.Mesh(
            new THREE.SphereGeometry(15, 10, 10),
            new THREE.MeshBasicMaterial({color: "#ffffff", visible: false, side: THREE.DoubleSide})
        );

        this.scenePart.threeObj.add(this.threeObj);
        makePointerSensitive(this.threeObj, this, -1);
        this.subscribe(PointerEvents.pointerUp, "onClick");
    }

    onClick({dragEndOnVerticalPlane}) {
        this.parts.contextMenu.toggleAt(dragEndOnVerticalPlane);
    }

    detach() {
        super.detach();
        document.removeEventListener("keyup", this.escapeKeyHandler);
    }
}

class ObjectViewManager extends ViewPart {
    /** @arg {{room: import('./roomModel').default}} options */
    constructor(options) {
        super();
        this.scenePart = options.scenePart;
        this.viewsForObjects = {};

        for (const object of options.room.parts.objects.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", options.room.parts.objects.id);
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", options.room.parts.objects.id);
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const view = new (WithManipulator(NaturalView))({model: object});
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
    constructor(options) {
        super();
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
        makePointerSensitive(this.treadmillForwardStrip, this, -1);
        this.treadmillRotateArea = new THREE.Mesh(new THREE.CircleBufferGeometry(100, 30), new THREE.MeshBasicMaterial({color: "#cccccc", opacity: 0.2, transparent: true}));
        makePointerSensitive(this.treadmillRotateArea, this, -1);
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
        this.scenePart.threeObj.add(group);
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
            this.affects.future().moveTo(this.threeObj.position.clone().sub(dragEndOnHorizontalPlane.clone().sub(dragStart)));
            this.moveCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
        } else {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize(),
                dragStart.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize()
            );
            this.affects.future().rotateTo(this.threeObj.quaternion.clone().multiply(delta));
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
        this.affects.future().moveBy(new THREE.Vector3(event.deltaX * multiplier, 0, event.deltaY * multiplier).applyQuaternion(this.threeObj.quaternion), false);
    }
}
