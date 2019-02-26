import * as THREE from 'three';
import Object3DView from './object3DView.js';
import arrowsAlt from '../assets/arrows-alt.svg';
import arrowsAltRot from '../assets/arrows-alt-rot.svg';
import Model from './model';
import InertialSpatialComponent from './modelComponents/inertialSpatial.js';
import SVGIcon from './util/svgIcon.js';

/** Represents an observer of a Room. This can be an active participant,
 *  a passive viewer, or internal camera views, such as for portals
 */
export class Observer extends Model {
    constructor(island, state={}) {
        super(island, state);
        this.spatial = new InertialSpatialComponent(this, state.spatial);
        this.name = state.name;
    }

    state(state) {
        super.state(state);
        state.name = this.name;
    }
}

/** Used to render a physical manifestation / Avatar of another participant
 *  in the Room.
 */
export class ObserverAvatarView extends Object3DView {
    // TODO
}

/** A Camera attached to an observer model. Used for the main render process
 *  as well as all other views into Rooms, such as portals
 */
export class ObserverCameraView extends Object3DView {
    constructor(island, width, height) {
        super(island);
        this.width = width;
        this.height = height;
    }

    attachWithObject3D(_modelState) {
        this.camera = new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
        return this.camera;
    }
}

export const PointerEvents = {
    pointerEnter: "pointer-enter",
    pointerMove: "pointer-move",
    pointerLeave: "pointer-leave",
    pointerDown: "pointer-down",
    pointerDrag: "pointer-drag",
    pointerUp: "pointer-up"
};

/** For participants in a Room, allowing navigation of space (i.e. moving one's observer model).
 *  Also manages object picking and object interaction by maintaining a pointer, hover and drag states.
*/
export class PointingObserverCameraView extends ObserverCameraView {
    constructor(island, width, height) {
        super(island, width, height);

        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.hoveredView = null;
        this.hoverPoint = null;
        this.hoverNormal = null;
        this.draggedView = null;
        this.dragStartPoint = new THREE.Vector3();
        this.dragStartNormal = new THREE.Vector3();
        this.dragStartThreeObj = null;
        this.draggingVerticalPlane = new THREE.Plane();
        this.draggingHorizontalPlane = new THREE.Plane();
    }

    attachWithObject3D(modelState) {
        const camera = super.attachWithObject3D(modelState);
        camera.position.setZ(1);

        this.treadmill = new THREE.Group();
        this.treadmillForwardStrip = new THREE.Mesh(new THREE.PlaneBufferGeometry(4, 100), new THREE.MeshBasicMaterial({color: "#eeeeee", visible: false}));
        this.treadmillForwardStrip.userData.croquetView = this;
        this.treadmillRotateArea = new THREE.Mesh(new THREE.CircleBufferGeometry(100, 30), new THREE.MeshBasicMaterial({color: "#cccccc", visible: false}));
        this.treadmillRotateArea.position.z -= 0.1;
        this.treadmillRotateArea.userData.croquetView = this;
        this.treadmill.add(this.treadmillForwardStrip);
        this.treadmill.add(this.treadmillRotateArea);
        this.treadmill.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        this.treadmill.position.y -= 2;
        this.treadmill.userData.croquetView = this;
        this.moveCursor = new SVGIcon(arrowsAlt, new THREE.MeshBasicMaterial({color: "#888888"}));
        this.moveCursor.userData.noInteraction = true;
        this.moveCursor.visible = false;
        this.rotateCursor = new SVGIcon(arrowsAltRot, new THREE.MeshBasicMaterial({color: "#aaaaaa"}));
        this.rotateCursor.userData.noInteraction = true;
        this.rotateCursor.visible = false;

        const group = new THREE.Group();
        group.add(camera);
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
            this.model().spatial.moveTo(this.threeObj.position.clone().sub(dragEndOnHorizontalPlane.clone().sub(dragStart)));
            this.moveCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
        } else {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize(),
                dragStart.clone().sub(this.threeObj.position.clone().setY(dragStart.y)).normalize()
            );
            this.model().spatial.rotateTo(this.threeObj.quaternion.clone().multiply(delta));
            this.rotateCursor.position.copy(this.threeObj.worldToLocal(dragEndOnHorizontalPlane.clone()));
            const deltaCursor = (new THREE.Quaternion()).setFromUnitVectors(
                this.threeObj.getWorldDirection(new THREE.Vector3()),
                dragEndOnHorizontalPlane.clone().sub(this.threeObj.position.clone().setY(dragEndOnHorizontalPlane.y)).normalize(),
            );
            this.rotateCursor.quaternion.copy(deltaCursor);
        }
    }

    onMouseMove(clientX, clientY) {
        // calculate mouse position in normalized device coordinates
        // (-1 to +1) for both components

        this.mouse.x = ( clientX / window.innerWidth ) * 2 - 1;
        this.mouse.y = -( clientY / window.innerHeight ) * 2 + 1;
    }

    onMouseDown() {
        if (this.hoveredView) {
            this.draggedView = this.hoveredView;
            this.dragStartPoint = this.hoverPoint.clone();
            this.dragStartNormal = this.hoverNormal.clone();
            this.dragStartThreeObj = this.hoverThreeObj;
            this.publish(PointerEvents.pointerDown, {at: this.dragStartPoint}, this.draggedView.id);
            this.draggingVerticalPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), this.hoverPoint);
            this.draggingHorizontalPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), this.hoverPoint);
        }
    }

    onMouseUp() {
        if (this.draggedView) {
            this.publish(PointerEvents.pointerUp, {}, this.hoveredView.id);
            this.draggedView = null;
        }
    }

    onWheel(event) {
        const multiplier = 0.01;
        this.model().moveBy(new THREE.Vector3(event.deltaX * multiplier, 0, event.deltaY * multiplier).applyQuaternion(this.threeObj.quaternion), false);
    }

    updatePointer(scene) {
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.draggedView) {
            const newVerticalDragPoint = this.raycaster.ray.intersectPlane(this.draggingVerticalPlane, new THREE.Vector3()) || this.dragStartPoint;
            const newHorizontalDragPoint = this.raycaster.ray.intersectPlane(this.draggingHorizontalPlane, new THREE.Vector3()) || this.dragStartPoint;
            this.publish(PointerEvents.pointerDrag, {
                dragStart: this.dragStartPoint,
                dragStartNormal: this.dragStartNormal,
                dragStartThreeObj: this.dragStartThreeObj,
                dragEndOnVerticalPlane: newVerticalDragPoint,
                dragEndOnHorizontalPlane: newHorizontalDragPoint,
            }, this.draggedView.id);
            if (this.draggedView.cursor) {
                document.body.style.cursor = this.draggedView.cursor;
            } else {
                document.body.style.cursor = "default";
            }
        } else {
            const intersects = this.raycaster.intersectObject(scene, true);

            let newlyHoveredView = null;
            let hoverPoint = null;
            let hoverNormal = null;
            let hoverThreeObj = null;

            for (let intersect of intersects) {
                const {point, object: threeObj, face} = intersect;

                let associatedCroquetView;
                let currentObjInTree = threeObj;

                while (currentObjInTree) {
                    if (currentObjInTree.userData.croquetView) {
                        associatedCroquetView = currentObjInTree.userData.croquetView;
                        break;
                    } else if (currentObjInTree.userData.noInteraction) {
                        break;
                    }
                    currentObjInTree = currentObjInTree.parent;
                }

                if (associatedCroquetView) {
                    newlyHoveredView = associatedCroquetView;
                    hoverPoint = point;
                    hoverNormal = face.normal;
                    hoverThreeObj = currentObjInTree;
                    break;
                }
            }

            this.hoverPoint = hoverPoint;
            this.hoverNormal = hoverNormal;
            this.hoverThreeObj = hoverThreeObj;

            if (this.hoveredView !== newlyHoveredView) {
                if (this.hoveredView) this.publish(PointerEvents.pointerLeave, {}, this.hoveredView.id);
                this.hoveredView = newlyHoveredView;

                if (newlyHoveredView) {
                    this.publish(PointerEvents.pointerEnter, {hoverPoint, hoverNormal, hoverThreeObj}, newlyHoveredView.id);
                } else {
                    this.hoverPoint = null;
                }
            } else if (this.hoveredView && this.hoveredView === newlyHoveredView) {
                this.publish(PointerEvents.pointerMove, {hoverPoint, hoverNormal, hoverThreeObj}, newlyHoveredView.id);
            }

            if (newlyHoveredView && newlyHoveredView.cursor) {
                document.body.style.cursor = newlyHoveredView.cursor;
            } else {
                document.body.style.cursor = "default";
            }
        }
    }
}
