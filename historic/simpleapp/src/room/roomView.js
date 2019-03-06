import * as THREE from 'three';
import View, { ViewPart } from '../view.js';
import ManipulatorView from '../manipulatorView.js';
import { ChildEvents } from '../stateParts/children.js';
import Object3D from '../viewParts/object3D.js';
import CameraViewPart from '../viewParts/camera.js';
import PointerViewPart, { makePointerSensitive, ignorePointer, PointerEvents } from '../viewParts/pointer.js';
import arrowsAlt from '../../assets/arrows-alt.svg';
import arrowsAltRot from '../../assets/arrows-alt-rot.svg';
import SVGIcon from '../util/svgIcon.js';
import SpatialPart from '../stateParts/spatial.js';
import TrackSpatial from '../viewParts/trackSpatial.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class RoomView extends View {
    buildParts(viewOptions={}) {
        new RoomScene(this);
        new ObjectViewManager(this, {scenePartName: "roomScene"});
        new CameraViewPart(this, {
            width: viewOptions.width,
            height: viewOptions.height
        });
        new SpatialPart(this, {cameraPosition: {
            position: viewOptions.cameraPosition,
            quaternion: viewOptions.cameraQuaternion
        }}, {id: "cameraPosition"});
        new TrackSpatial(this, {source: "this.cameraPosition", affects: "camera"});
        if (viewOptions.activeParticipant) {
            new PointerViewPart(this, {scenePartName: "roomScene"});
            new TreadmillNavigation(this, {scenePartName: "roomScene"});
            new TrackSpatial(this, {source: "this.cameraPosition", affects: "treadmillNavigation", id: "trackTreadmill"});
        }
    }
}

class RoomScene extends Object3D {
    /** @arg {Room} room */
    attachWithObject3D(room) {
        this.scene = new THREE.Scene();
        this.scene.background = room.parts.color.value;
        this.grid = new THREE.GridHelper(room.parts.size.x, 10, "#888888", "#aaaaaa");
        this.scene.add(this.grid);
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
        // this.scene.add(new THREE.AxesHelper(5));
        return this.scene;
    }
}

class ObjectViewManager extends ViewPart {
    fromOptions(options) {
        options = {scenePartName: "scene", ...options};
        super.fromOptions(options);
        this.scenePart = this.owner.parts[options.scenePartName];
    }

    /** @arg {Room} room */
    attach(room) {
        this.viewsForObjects = {};

        for (const object of room.parts.objects.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", room.id, "objects");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", room.id, "objects");
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const innerView = new NaturalView(this.owner.island);
        const view = new ManipulatorView(this.owner.island, {wrappedView: innerView});
        this.viewsForObjects[object.id] = view;
        view.attach(object);
        view.addToThreeParent(this.scenePart.threeObj);
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        view.removeFromThreeParent(this.scenePart.threeObj);
        view.onDetach();
        delete this.viewsForObjects[object.id];
    }
}

class TreadmillNavigation extends Object3D {
    constructor(owner, options) {
        options = {cameraPartName: "camera", scenePartName: "scene", affects: "cameraPosition", ...options};
        super(owner, options);
        /** @type {CameraViewPart} */
        this.cameraPart = owner.parts[options.cameraPartName];
        /** @type {RoomScene} */
        this.scenePart = owner.parts[options.scenePartName];
        /** @type {SpatialPart} */
        this.affectedSpatial = owner.parts[options.affects];
    }

    attachWithObject3D(_modelState) {
        // make treadmillForwardStrip look like a rectangle in screenspace
        const camera = this.cameraPart.threeObj;
        const d = 100;
        const w = Math.tan(camera.fov / 2 * (Math.PI / 180)) * camera.aspect * 0.5; // half width of frame
        const stripShape = new THREE.Shape([{x: 0, y: 0}, {x: w * d, y: d}, {x: -w * d, y: d}]);

        this.treadmill = new THREE.Group();
        this.treadmillForwardStrip = new THREE.Mesh(new THREE.ShapeBufferGeometry(stripShape), new THREE.MeshBasicMaterial({ color: "#eeeeee", visible: false}));
        this.treadmillForwardStrip.position.z += 0.1;
        makePointerSensitive(this.treadmillForwardStrip, this.asViewPartRef(), -1);
        this.treadmillRotateArea = new THREE.Mesh(new THREE.CircleBufferGeometry(100, 30), new THREE.MeshBasicMaterial({color: "#cccccc", opacity: 0.2, transparent: true}));
        makePointerSensitive(this.treadmillRotateArea, this.asViewPartRef(), -1);
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

        this.scenePart.threeObj.add(group);

        return group;
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
            this.affectedSpatial.moveTo(this.threeObj.position.clone().sub(dragEndOnHorizontalPlane.clone().sub(dragStart)));
            this.moveCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
        } else {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize(),
                dragStart.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize()
            );
            this.affectedSpatial.rotateTo(this.threeObj.quaternion.clone().multiply(delta));
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
        this.affectedSpatial.moveBy(new THREE.Vector3(event.deltaX * multiplier, 0, event.deltaY * multiplier).applyQuaternion(this.threeObj.quaternion), false);
    }
}
