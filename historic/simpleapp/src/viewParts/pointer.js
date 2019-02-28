import * as THREE from 'three';
import { ViewPart } from '../view.js';

export const PointerEvents = {
    pointerEnter: "pointer-enter",
    pointerMove: "pointer-move",
    pointerLeave: "pointer-leave",
    pointerDown: "pointer-down",
    pointerDrag: "pointer-drag",
    pointerUp: "pointer-up"
};

/** @param {THREE.Object3D} threeObj */
export function makePointerSensitive(threeObj, targetPartRef, layer=1) {
    threeObj.userData.pointerSensitiveFor = targetPartRef;
    threeObj.userData.pointerLayer = layer;
}

export function ignorePointer(threeObj) {
    threeObj.userData.ignorePointer = true;
}

export default class PointerViewPart extends ViewPart {
    constructor(owner, options) {
        const fullOptions = {partName: "pointer", cameraPartName: "camera", ...options};
        super(owner, fullOptions);
        this.cameraPart = owner[fullOptions.cameraPartName];
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.hoveredViewPart = null;
        this.hoverPoint = null;
        this.hoverNormal = null;
        this.draggedViewPart = null;
        this.dragStartPoint = new THREE.Vector3();
        this.dragStartNormal = new THREE.Vector3();
        this.dragStartThreeObj = null;
        this.draggingVerticalPlane = new THREE.Plane();
        this.draggingHorizontalPlane = new THREE.Plane();
    }

    onMouseMove(clientX, clientY) {
        // calculate mouse position in normalized device coordinates
        // (-1 to +1) for both parts
        this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    }

    onMouseDown() {
        if (this.hoveredViewPart) {
            this.draggedViewPart = this.hoveredViewPart;
            this.dragStartPoint = this.hoverPoint.clone();
            this.dragStartNormal = this.hoverNormal.clone();
            this.dragStartThreeObj = this.hoverThreeObj;
            this.publish(
                PointerEvents.pointerDown,
                { at: this.dragStartPoint, pointer: this.asViewPartRef() },
                ...this.draggedViewPart.split(".")
            );
            this.draggingVerticalPlane.setFromNormalAndCoplanarPoint(this.cameraPart.threeObj.getWorldDirection(new THREE.Vector3()), this.hoverPoint);
            this.draggingHorizontalPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), this.hoverPoint);
        }
    }

    onMouseUp() {
        if (this.draggedViewPart) {
            this.publish(
                PointerEvents.pointerUp,
                { pointer: this.asViewPartRef() },
                ...this.hoveredViewPart.split(".")
            );
            this.draggedViewPart = null;
        }
    }

    updatePointer(scene) {
        this.raycaster.setFromCamera(this.mouse, this.cameraPart.threeObj);
        if (this.draggedViewPart) {
            const newVerticalDragPoint = this.raycaster.ray.intersectPlane(this.draggingVerticalPlane, new THREE.Vector3()) || this.dragStartPoint;
            const newHorizontalDragPoint = this.raycaster.ray.intersectPlane(this.draggingHorizontalPlane, new THREE.Vector3()) || this.dragStartPoint;
            this.publish(
                PointerEvents.pointerDrag,
                {
                    dragStart: this.dragStartPoint,
                    dragStartNormal: this.dragStartNormal,
                    dragStartThreeObj: this.dragStartThreeObj,
                    dragEndOnVerticalPlane: newVerticalDragPoint,
                    dragEndOnHorizontalPlane: newHorizontalDragPoint,
                    pointer: this.asViewPartRef()
                },
                ...this.draggedViewPart.split(".")
            );
        }
        else {
            const intersects = this.raycaster.intersectObject(scene, true);
            // look up effective THREE userData by traversing each intersected
            // object's parent chain until we find one
            for (let intersect of intersects) {
                let currentObjInTree = intersect.object;
                while (currentObjInTree) {
                    if (currentObjInTree.userData.pointerSensitiveFor) {
                        intersect.effectiveUserData = currentObjInTree.userData;
                        intersect.effectiveObject = currentObjInTree;
                        break;
                    }
                    else if (currentObjInTree.userData.ignorePointer) {
                        break;
                    }
                    currentObjInTree = currentObjInTree.parent;
                }
            }
            // sort intersects by
            // 1) pointer layer as an overriding "priority"
            // 2) distance from viewer for objects within one layer
            intersects.sort((a, b) => {
                const pointerLayerA = a.effectiveUserData ? a.effectiveUserData.pointerLayer : -1000;
                const pointerLayerB = b.effectiveUserData ? b.effectiveUserData.pointerLayer : -1000;
                const byPointerLayer = pointerLayerB - pointerLayerA;
                const byDistance = a.distance - b.distance;
                return byPointerLayer || byDistance;
            });
            let newlyHoveredViewPart = null;
            let hoverPoint = null;
            let hoverNormal = null;
            let hoverThreeObj = null;
            for (let intersect of intersects) {
                const { point, effectiveUserData, effectiveObject, face } = intersect;
                /** @type {ViewPartReference} */
                const associatedViewPart = effectiveUserData && effectiveUserData.pointerSensitiveFor;
                if (associatedViewPart) {
                    newlyHoveredViewPart = associatedViewPart;
                    hoverPoint = point;
                    hoverNormal = face.normal;
                    hoverThreeObj = effectiveObject;
                    break;
                }
            }
            this.hoverPoint = hoverPoint;
            this.hoverNormal = hoverNormal;
            this.hoverThreeObj = hoverThreeObj;
            if (this.hoveredViewPart !== newlyHoveredViewPart) {
                if (this.hoveredViewPart) {
                    this.publish(
                        PointerEvents.pointerLeave,
                        { pointer: this.asViewPartRef() },
                        ...this.hoveredViewPart.split(".")
                    );
                }
                this.hoveredViewPart = newlyHoveredViewPart;
                if (newlyHoveredViewPart) {
                    this.publish(
                        PointerEvents.pointerEnter,
                        { hoverPoint, hoverNormal, hoverThreeObj, pointer: this.asViewPartRef() },
                        ...newlyHoveredViewPart.split(".")
                    );
                }
                else {
                    this.hoverPoint = null;
                }
            }
            else if (this.hoveredViewPart && this.hoveredViewPart === newlyHoveredViewPart) {
                this.publish(
                    PointerEvents.pointerMove,
                    { hoverPoint, hoverNormal, hoverThreeObj, pointer: this.asViewPartRef() },
                    ...newlyHoveredViewPart.split(".")
                );
            }
        }
    }
}
