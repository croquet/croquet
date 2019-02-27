import * as THREE from 'three';
import { ViewComponent } from '../view.js';

export const PointerEvents = {
    pointerEnter: "pointer-enter",
    pointerMove: "pointer-move",
    pointerLeave: "pointer-leave",
    pointerDown: "pointer-down",
    pointerDrag: "pointer-drag",
    pointerUp: "pointer-up"
};

/** @param {THREE.Object3D} threeObj */
export function makePointerSensitive(threeObj, targetComponentRef, layer=1) {
    threeObj.userData.pointerSensitiveFor = targetComponentRef;
    threeObj.userData.pointerLayer = layer;
}

export function ignorePointer(threeObj) {
    threeObj.userData.ignorePointer = true;
}

export default class PointerViewComponent extends ViewComponent {
    constructor(owner, componentName = "pointer", cameraComponentName = "camera") {
        super(owner, componentName);
        this.cameraComponent = owner[cameraComponentName];
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.hoveredViewComponent = null;
        this.hoverPoint = null;
        this.hoverNormal = null;
        this.draggedViewComponent = null;
        this.dragStartPoint = new THREE.Vector3();
        this.dragStartNormal = new THREE.Vector3();
        this.dragStartThreeObj = null;
        this.draggingVerticalPlane = new THREE.Plane();
        this.draggingHorizontalPlane = new THREE.Plane();
    }

    onMouseMove(clientX, clientY) {
        // calculate mouse position in normalized device coordinates
        // (-1 to +1) for both components
        this.mouse.x = (clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    }

    onMouseDown() {
        if (this.hoveredViewComponent) {
            this.draggedViewComponent = this.hoveredViewComponent;
            this.dragStartPoint = this.hoverPoint.clone();
            this.dragStartNormal = this.hoverNormal.clone();
            this.dragStartThreeObj = this.hoverThreeObj;
            this.publish(
                PointerEvents.pointerDown,
                { at: this.dragStartPoint, pointer: this.asViewComponentRef() },
                ...this.draggedViewComponent.split(".")
            );
            this.draggingVerticalPlane.setFromNormalAndCoplanarPoint(this.cameraComponent.threeObj.getWorldDirection(new THREE.Vector3()), this.hoverPoint);
            this.draggingHorizontalPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), this.hoverPoint);
        }
    }

    onMouseUp() {
        if (this.draggedViewComponent) {
            this.publish(
                PointerEvents.pointerUp,
                { pointer: this.asViewComponentRef() },
                ...this.hoveredViewComponent.split(".")
            );
            this.draggedViewComponent = null;
        }
    }

    updatePointer(scene) {
        this.raycaster.setFromCamera(this.mouse, this.cameraComponent.threeObj);
        if (this.draggedViewComponent) {
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
                    pointer: this.asViewComponentRef()
                },
                ...this.draggedViewComponent.split(".")
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
            let newlyHoveredViewComponent = null;
            let hoverPoint = null;
            let hoverNormal = null;
            let hoverThreeObj = null;
            for (let intersect of intersects) {
                const { point, effectiveUserData, effectiveObject, face } = intersect;
                /** @type {ViewComponentReference} */
                const associatedViewComponent = effectiveUserData && effectiveUserData.pointerSensitiveFor;
                if (associatedViewComponent) {
                    newlyHoveredViewComponent = associatedViewComponent;
                    hoverPoint = point;
                    hoverNormal = face.normal;
                    hoverThreeObj = effectiveObject;
                    break;
                }
            }
            this.hoverPoint = hoverPoint;
            this.hoverNormal = hoverNormal;
            this.hoverThreeObj = hoverThreeObj;
            if (this.hoveredViewComponent !== newlyHoveredViewComponent) {
                if (this.hoveredViewComponent) {
                    this.publish(
                        PointerEvents.pointerLeave,
                        { pointer: this.asViewComponentRef() },
                        ...this.hoveredViewComponent.split(".")
                    );
                }
                this.hoveredViewComponent = newlyHoveredViewComponent;
                if (newlyHoveredViewComponent) {
                    this.publish(
                        PointerEvents.pointerEnter,
                        { hoverPoint, hoverNormal, hoverThreeObj, pointer: this.asViewComponentRef() },
                        ...newlyHoveredViewComponent.split(".")
                    );
                }
                else {
                    this.hoverPoint = null;
                }
            }
            else if (this.hoveredViewComponent && this.hoveredViewComponent === newlyHoveredViewComponent) {
                this.publish(
                    PointerEvents.pointerMove,
                    { hoverPoint, hoverNormal, hoverThreeObj, pointer: this.asViewComponentRef() },
                    ...newlyHoveredViewComponent.split(".")
                );
            }
        }
    }
}
