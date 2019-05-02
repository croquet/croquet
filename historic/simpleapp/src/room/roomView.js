import * as THREE from "three";
import { urlOptions } from "@croquet/util";
import { ViewPart } from "../parts";
import WithManipulator from "../viewParts/manipulator";
import { ChildEvents } from "../modelParts/children";
import CameraViewPart from "../viewParts/camera";
import PointerViewPart, { makePointerSensitive, ignorePointer, PointerEvents } from "../viewParts/pointer";
import arrowsAlt from "../../assets/arrows-alt.svg";
import arrowsAltRot from "../../assets/arrows-alt-rot.svg";
import SVGIcon from "../util/svgIcon";
import Tracking, { Facing } from "../viewParts/tracking";
import SpatialPart from "../modelParts/spatial";
import Inertial from "../modelParts/inertial";
import { PortalTraversing, PortalEvents, PortalTopicPrefix } from "../modelParts/portal";
import { KeyboardViewPart } from "../viewParts/keyboard";
import { ContextMenu } from "../viewParts/menu";
import { ColorEvents } from "../modelParts/color";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class RoomView extends ViewPart {
    /** @arg {{room: import('./roomModel').default}} options */
    constructor(options) {
        super();
//console.log({roomoptions: options});
//console.warn(options.room);
        this.cameraSpatial = Inertial()(PortalTraversing({roomId: options.room.id})(SpatialPart)).create();
        this.cameraSpatial.init({
            position: options.cameraPosition,
            quaternion: options.cameraQuaternion,
            dampening: 0.05
        });

        this.parts.camera = new (Tracking({source: this.cameraSpatial})(CameraViewPart))({
            width: options.width,
            height: options.height
        });

        this.parts.roomScene = new RoomScene({room: options.room});
        this.parts.elementViewManager = new ElementViewManager({room: options.room, scenePart: this.parts.roomScene, cameraSpatial: this.cameraSpatial, addElementManipulators: options.addElementManipulators!==false});

        if (options.activeParticipant) {
            this.parts.pointer = new PointerViewPart({room: options.room, cameraPart: this.parts.camera, scenePart: this.parts.roomScene});
            if (!urlOptions.ar) {
                this.parts.keyboard = new KeyboardViewPart();
                this.parts.treadmill = new (Tracking({source: this.cameraSpatial})(TreadmillNavigation))({
                    affects: this.cameraSpatial,
                    scenePart: this.parts.roomScene,
                    cameraPart: this.parts.camera,
                });
                this.parts.interactionDome = new (Tracking({source: this.cameraSpatial})(InteractionDome))({
                    cameraSpatial: this.cameraSpatial,
                    scenePart: this.parts.roomScene,
                    changeColor: color => options.room.parts.color.future().setColor(color),
                    resetCameraPosition: () => {
                        this.cameraSpatial.moveTo(new THREE.Vector3(0, 2, 4), false);
                        this.cameraSpatial.rotateTo(new THREE.Quaternion(), false);
                    }
                });

                this.traversePortalToRoom = options.traversePortalToRoom;
                this.subscribe(PortalTopicPrefix + options.room.id, PortalEvents.traversed, data => this.onPortalTraversed(data));
            }
        }
    }

    onPortalTraversed(traverseInfo) {
        // only listen to clonedPortals in the view domain to prevent portal traversal lag
        if ((traverseInfo.traverserId === this.cameraSpatial.id) && traverseInfo.portalId.includes("/V")) {
            this.traversePortalToRoom(traverseInfo);
            this.parts.pointer.onMouseUp();
            this.cameraSpatial.stop();
            window.requestAnimationFrame(() => {
                // take a step back in this room for when we come back
                const stepBack = new THREE.Vector3(0, 0, 2).applyQuaternion(this.cameraSpatial.quaternion);
                this.cameraSpatial.moveByNoPortalTraverse(stepBack, false);
            });
        }
    }
}

class RoomScene extends ViewPart {
    /** @arg {{room: import('./roomModel').default}} options */
    constructor(options) {
        super();
        this.scene = new THREE.Scene();
        this.light = new THREE.DirectionalLight("#ffffdd");
        this.light.position.set(1, 2, 1);
        this.light.castShadow = true;
        this.light.shadow.mapSize.width = 1024;  // default
        this.light.shadow.mapSize.height = 1024; // default
        this.light.shadow.radius = 5;
        this.light.shadow.camera.near = 0.5;    // default
        this.light.shadow.camera.far = 10;     // default
        this.scene.add(this.light);
        this.ambientLight = new THREE.HemisphereLight("#ddddff", "#ffdddd");
        this.scene.add(this.ambientLight);
        if (!urlOptions.ar) {
            this.grid = new THREE.GridHelper(10.0, 10, "#888888", "#aaaaaa");
            this.scene.add(this.grid);
            this.skydome = new THREE.Mesh(
                new THREE.SphereGeometry(50, 10, 10),
                new THREE.MeshBasicMaterial({color: options.room.parts.color.value, side: THREE.DoubleSide})
                );
            this.scene.add(this.skydome);
        }
        // this.scene.add(new THREE.AxesHelper(5));
        this.threeObj = this.scene;

        this.subscribe(options.room.parts.color.id, ColorEvents.changed, data => this.colorChanged(data));
    }

    colorChanged(newColor) {
        this.skydome.material.color = new THREE.Color(newColor);
    }
}

class InteractionDome extends ViewPart {
    constructor(options) {
        super();

        this.parts = {
            contextMenu: new (Facing({source: options.cameraSpatial})(ContextMenu))({
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

        if (urlOptions.debug || window.location.hostname === "localhost") document.body.className = "debug";

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
        this.subscribe(this.id, PointerEvents.pointerUp, data => this.onClick(data));
    }

    onClick({dragEndOnVerticalPlane}) {
        this.parts.contextMenu.toggleAt(dragEndOnVerticalPlane);
    }

    detach() {
        super.detach();
        document.removeEventListener("keyup", this.escapeKeyHandler);
    }
}

class ElementViewManager extends ViewPart {
    /** @arg {{room: import('./roomModel').default}} options */
    constructor(options) {
        super();
        this.scenePart = options.scenePart;
        this.cameraSpatial = options.cameraSpatial;
        this.viewsForElements = {};

        this.addElementManipulators = !!options.addElementManipulators;

        for (const element of options.room.parts.elements.children) {
            this.onElementAdded(element);
        }

        this.subscribe(options.room.parts.elements.id, ChildEvents.childAdded, data => this.onElementAdded(data));
        this.subscribe(options.room.parts.elements.id, ChildEvents.childRemoved, data => this.onElementRemoved(data));
    }

    onElementAdded(element) {
        const NaturalView = element.naturalViewClass("in-room");
        /** @type {View} */
        const ViewClass = this.addElementManipulators ? WithManipulator(NaturalView) : NaturalView;
        const view = new ViewClass({model: element, cameraSpatial: this.cameraSpatial});
        this.viewsForElements[element.id] = view;
        this.scenePart.threeObj.add(...view.threeObjs());
    }

    onElementRemoved(element) {
        const view = this.viewsForElements[element.id];
        this.scenePart.threeObj.remove(...view.threeObjs());
        view.detach();
        delete this.viewsForElements[element.id];
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

        this.subscribe(this.id, PointerEvents.pointerMove, data => this.onHoverTreadmillMove(data));
        this.subscribe(this.id, PointerEvents.pointerLeave, data => this.onHoverTreadmillLeave(data));
        this.subscribe(this.id, PointerEvents.pointerDown, data => this.onDragTreadmillStart(data));
        this.subscribe(this.id, PointerEvents.pointerDrag, data => this.onDragTreadmill(data));
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
