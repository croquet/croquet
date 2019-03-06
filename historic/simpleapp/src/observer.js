import * as THREE from 'three';
import arrowsAlt from '../assets/arrows-alt.svg';
import arrowsAltRot from '../assets/arrows-alt-rot.svg';
import Model from './model.js';
import InertialSpatialPart from './modelParts/inertialSpatial.js';
import SVGIcon from './util/svgIcon.js';
import View from './view.js';
import CameraViewPart from './viewParts/camera.js';
import Object3D from './viewParts/object3D.js';
import TrackSpatial from './viewParts/trackSpatial.js';
import PointerViewPart, { PointerEvents, makePointerSensitive, ignorePointer } from './viewParts/pointer.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** Represents an observer of a Room. This can be an active participant,
 *  a passive viewer, or internal camera views, such as for portals
 */
export class Observer extends Model {
    buildParts(state={}) {
        new InertialSpatialPart(this, state);
    }
}

/** Used to render a physical manifestation / Avatar of another participant
 *  in the Room.
 */
export class ObserverAvatarView extends View {
    // TODO
}

class TreadmillNavigationViewPart extends Object3D {
    constructor(owner, options) {
        options = {cameraPartName: "camera", ...options};
        super(owner, options);
        /** @type {CameraViewPart} */
        this.cameraPart = owner.parts[options.cameraPartName];
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
            this.owner.model.spatial.moveTo(this.threeObj.position.clone().sub(dragEndOnHorizontalPlane.clone().sub(dragStart)));
            this.moveCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
        } else {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize(),
                dragStart.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize()
            );
            this.owner.model.spatial.rotateTo(this.threeObj.quaternion.clone().multiply(delta));
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
        this.owner.model.spatial.moveBy(new THREE.Vector3(event.deltaX * multiplier, 0, event.deltaY * multiplier).applyQuaternion(this.threeObj.quaternion), false);
    }
}

/** For participants in a Room, allowing navigation of space (i.e. moving one's observer model).
 *  Also manages object picking and object interaction by maintaining a pointer, hover and drag states.
*/
export class PointingObserverCameraView extends View {
    buildParts({width, height}) {
        new CameraViewPart(this, {width, height});
        new TrackSpatial(this, {id: "trackCamera", affects: "camera"});
        new TreadmillNavigationViewPart(this);
        new TrackSpatial(this, {id: "trackTreadmill", affects: "treadmillNavigation"});
        new PointerViewPart(this);
    }
}
