import SpatialModel from './spatialModel';
import Object3DView from './object3DView';
import * as THREE from 'three';

export class Observer extends SpatialModel {
    constructor(island, position, quaternion, name) {
        super(island, position, quaternion);
        this.name = name;
    }
};

export class ObserverAvatarView extends Object3DView {
    // TODO
}

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
    pointerLeave: "pointer-leave",
    pointerDown: "pointer-down",
    pointerDrag: "pointer-drag",
    pointerUp: "pointer-up"
}

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
        this.draggingVerticalPlane = new THREE.Plane();
        this.draggingHorizontalPlane = new THREE.Plane();
    }

    onMouseMove(event) {
        // calculate mouse position in normalized device coordinates
        // (-1 to +1) for both components

        this.mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
        this.mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    }

    onMouseDown() {
        if (this.hoveredView) {
            this.draggedView = this.hoveredView;
            this.dragStartPoint = this.hoverPoint.clone();
            this.dragStartNormal = this.hoverNormal.clone();
            this.publish(PointerEvents.pointerDown, {at: this.dragStartPoint}, this.draggedView.id);
            this.draggingVerticalPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(), this.hoverPoint);
            this.draggingHorizontalPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), this.hoverPoint);
        }
    }

    onMouseUp() {
        if (this.draggedView) {
            this.publish(PointerEvents.pointerUp, {}, this.hoveredView.id);
            this.draggedView = null;
        }
    }

    updatePointer(scene) {
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.draggedView) {
            const newVerticalDragPoint = this.raycaster.ray.intersectPlane(this.draggingVerticalPlane, new THREE.Vector3) || this.dragStartPoint;
            const newHorizontalDragPoint = this.raycaster.ray.intersectPlane(this.draggingHorizontalPlane, new THREE.Vector3) || this.dragStartPoint;
            this.publish(PointerEvents.pointerDrag, {
                dragStart: this.dragStartPoint,
                dragStartNormal: this.dragStartNormal,
                dragEndOnVerticalPlane: newVerticalDragPoint,
                dragEndOnHorizontalPlane: newHorizontalDragPoint,
            }, this.draggedView.id);
        } else {
            const intersects = this.raycaster.intersectObject(scene, true);

            let newlyHoveredView = null;
            let hoverPoint = null
            let hoverNormal = null

            for (let intersect of intersects) {
                const {point, object: threeObj, face} = intersect;

                if (threeObj.userData.croquetView) {
                    newlyHoveredView = threeObj.userData.croquetView;
                    hoverPoint = point;
                    hoverNormal = face.normal;
                    break;
                }
            }

            this.hoverPoint = hoverPoint;
            this.hoverNormal = hoverNormal;

            if (this.hoveredView !== newlyHoveredView) {
                this.hoveredView && this.publish(PointerEvents.pointerLeave, {}, this.hoveredView.id);
                this.hoveredView = newlyHoveredView;

                if (newlyHoveredView) {
                    this.publish(PointerEvents.pointerEnter, {}, newlyHoveredView.id);
                } else {
                    this.hoverPoint = null;
                }
            }
        }
    }
}