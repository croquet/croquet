import { PointerEvents, makePointerSensitive } from "./pointer";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** @typedef {import("../modelView.js").ModelPart} ModelPart */
/** @typedef {import("../parts.js").PartPath} PartPath */

export default function Draggable(dragOptions={}) {
    dragOptions = {
        dragHandle: "",
        dragVertically: true,
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
            this.subscribe(this.id, PointerEvents.pointerDown, () => {
                this.positionAtDragStart = this.dragHandlePart.threeObj.position.clone();
            });
            this.subscribe(this.id, PointerEvents.pointerDrag, ({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) => {
                const dragEnd = this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
                this.target.future().moveTo(
                    this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
                );
            });
        }
    };
}
