import { PointerEvents, makePointerSensitive, TrackPlaneTopic, TrackPlaneEvents } from "./pointer";

/** @typedef {import("../modelView.js").ModelPart} ModelPart */
/** @typedef {import("../parts.js").PartPath} PartPath */

export default function Draggable(dragOptions={}) {
    dragOptions = {
        dragHandle: "",
        dragVertically: true,
        hoverMaterialUpdate: () => {},
        ...dragOptions
    };

    return BaseViewPart => class DraggableViewPart extends BaseViewPart {
        /**
         * @arg {Object} options
         * @arg {PartPath | null} options.dragHandle - an optional path to a subpart of the inner ViewPart to use as the drag handle - otherwise uses the whole inner part
         * @arg {ModelPart | null} options.target - The spatial part to affect
         * @arg {boolean | null} options.dragVertically - whether drags should be on a horizontal or vertical camera-oriented plane
        */
        constructor(options) {
            super(options);
            this.target = dragOptions.target || (options.model && options.model.parts.spatial);
            this.dragHandlePart = this.lookUp(dragOptions.dragHandle);
            makePointerSensitive(this.dragHandlePart.threeObj, this);
            this.dragVertically = dragOptions.dragVertically;
            this.subscribe(this.id, PointerEvents.pointerEnter, () => {
                dragOptions.hoverMaterialUpdate(true, this.dragHandlePart.threeObj.material);
                document.body.style.cursor = "grab";
            });
            this.subscribe(this.id, PointerEvents.pointerLeave, () => {
                dragOptions.hoverMaterialUpdate(false, this.dragHandlePart.threeObj.material);
                document.body.style.cursor = "default";
            });
            this.subscribe(this.id, PointerEvents.pointerDown, () => {
                this.positionAtDragStart = this.target.position.clone();
                document.body.style.cursor = "grabbing";
                if (dragOptions.draggingPlane) {
                    this.publish(TrackPlaneTopic, TrackPlaneEvents.requestTrackPlane, {plane: dragOptions.draggingPlane});
                }
            });
            this.subscribe(this.id, PointerEvents.pointerDrag, ({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane, dragEndOnUserPlane}) => {
                const dragEnd = dragOptions.draggingPlane
                    ? (dragEndOnUserPlane || dragStart)
                    : (this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane);
                this.target.future().moveTo(
                    this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
                );
            });
            this.subscribe(this.id, PointerEvents.pointerUp, () => {
                document.body.style.cursor = "grab";
            });
        }
    };
}
