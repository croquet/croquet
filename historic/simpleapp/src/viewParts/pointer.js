import * as THREE from "three";
import { ViewPart } from "../parts";
import { theKeyboardManager } from "../domKeyboardManager";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const PointerEvents = {
    pointerEnter: "pointer-enter",
    pointerMove: "pointer-move",
    pointerLeave: "pointer-leave",
    pointerDown: "pointer-down",
    pointerDrag: "pointer-drag",
    pointerUp: "pointer-up"
};

export const TrackPlaneTopic = "topic-trackplane";
export const TrackPlaneEvents = {requestTrackPlane: "requestTrackPlane"};

/**
 * @arg {THREE.Object3D} threeObj
 * @arg {ViewPart} target */
export function makePointerSensitive(threeObj, target, layer=1) {
    threeObj.userData.pointerSensitiveFor = target;
    threeObj.userData.pointerLayer = layer;
}

export function ignorePointer(threeObj) {
    threeObj.userData.ignorePointer = true;
}

export default class PointerViewPart extends ViewPart {
    constructor(options) {
        super();
        this.cameraPart = options.cameraPart;
        this.scenePart = options.scenePart;
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
        this.dragEndOnVerticalPlane = new THREE.Vector3();
        this.dragEndOnHorizontalPlane = new THREE.Vector3();
        this.dragEndOnUserPlane = new THREE.Vector3();

        this.subscribe(TrackPlaneTopic, TrackPlaneEvents.requestTrackPlane, data => this.onRequestTrackPlane(data));
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
            theKeyboardManager.blur();
            this.publish(
                this.draggedViewPart.id,
                PointerEvents.pointerDown,
                { at: this.dragStartPoint, pointer: this.id },
            );
            this.draggingVerticalPlane.setFromNormalAndCoplanarPoint(this.cameraPart.threeObj.getWorldDirection(new THREE.Vector3()), this.hoverPoint);
            this.draggingHorizontalPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), this.hoverPoint);
        }
    }

    onMouseUp() {
        if (this.draggedViewPart) {
            this.publish(
                this.draggedViewPart.id,
                PointerEvents.pointerUp,
                {
                    pointer: this.id,
                    dragStartPoint: this.dragStartPoint,
                    dragEndOnVerticalPlane: this.dragEndOnVerticalPlane,
                    dragEndOnHorizontalPlane: this.dragEndOnHorizontalPlane,
                    dragEndOnUserPlane: this.dragEndOnUserPlane,
                }
            );
            this.draggedViewPart = null;
        }
    }

    updatePointer() {
        this.raycaster.setFromCamera(this.mouse, this.cameraPart.threeObj);
        if (this.draggedViewPart) {
            const newVerticalDragPoint = this.raycaster.ray.intersectPlane(this.draggingVerticalPlane, new THREE.Vector3()) || this.dragStartPoint;
            const newHorizontalDragPoint = this.raycaster.ray.intersectPlane(this.draggingHorizontalPlane, new THREE.Vector3()) || this.dragStartPoint;
            let newUserDragPoint = null;
            if (this.userDraggingPlane) {
                newUserDragPoint = this.raycaster.ray.intersectPlane(this.userDraggingPlane, new THREE.Vector3()) || this.dragStartPoint;
            }

            this.dragEndOnVerticalPlane = newVerticalDragPoint;
            this.dragEndOnHorizontalPlane = newHorizontalDragPoint;
            this.dragEndOnUserPlane = newUserDragPoint;

            this.publish(
                this.draggedViewPart.id,
                PointerEvents.pointerDrag,
                {
                    dragStart: this.dragStartPoint,
                    dragStartNormal: this.dragStartNormal,
                    dragStartThreeObj: this.dragStartThreeObj,
                    dragEndOnVerticalPlane: newVerticalDragPoint,
                    dragEndOnHorizontalPlane: newHorizontalDragPoint,
                    dragEndOnUserPlane: newUserDragPoint,
                    pointer: this.id
                }
            );
        }
        else {
            const intersects = this.raycaster.intersectObject(this.scenePart.threeObj, true);
            // look up effective THREE userData by traversing each intersected
            // object's parent chain until we find one
            for (const intersect of intersects) {
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
            for (const intersect of intersects) {
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
                        this.hoveredViewPart.id,
                        PointerEvents.pointerLeave,
                        { pointer: this.id }
                    );
                }
                this.hoveredViewPart = newlyHoveredViewPart;
                if (newlyHoveredViewPart) {
                    this.publish(
                        newlyHoveredViewPart.id,
                        PointerEvents.pointerEnter,
                        { hoverPoint, hoverNormal, hoverThreeObj, pointer: this.id }
                    );
                }
                else {
                    this.hoverPoint = null;
                }
            }
            else if (this.hoveredViewPart && this.hoveredViewPart === newlyHoveredViewPart) {
                this.publish(
                    newlyHoveredViewPart.id,
                    PointerEvents.pointerMove,
                    { hoverPoint, hoverNormal, hoverThreeObj, pointer: this.id }
                );
            }
        }
    }

    onRequestTrackPlane(request) {
        //const requestor = request.requestor;
        this.userDraggingPlane = request.plane;
    }
}
