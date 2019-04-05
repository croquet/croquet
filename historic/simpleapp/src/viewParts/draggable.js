import { PointerEvents, makePointerSensitive } from "./pointer.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** @typedef {import("../modelView.js").StatePart} StatePart */
/** @typedef {import("../parts.js").PartPath} PartPath */

export default function Draggable(BaseViewPart, dragOptions) {
    dragOptions = {
        dragHandle: "",
        target: "spatial",
        dragVertically: true,
        ...dragOptions
    };

    return class DraggableViewPart extends BaseViewPart {
        /**
         * @arg {Object} options
         * @arg {PartPath | null} options.dragHandle - an optional path to a subpart of the inner ViewPart to use as the drag handle - otherwise uses the whole inner part
         * @arg {PartPath | null} options.target - the path into the attached model to modify on drag - defaults to "spatial"
         * @arg {boolean | null} options.dragVertically - whether drags should be on a horizontal or vertical camera-oriented plane
        */
        constructor(modelState, options) {
            super(modelState, options);
            this.dragHandlePart = this.lookUp(dragOptions.dragHandle);
            makePointerSensitive(this.dragHandlePart.threeObj, this);
            this.dragTargetPartPath = dragOptions.target;
            this.dragVertically = dragOptions.dragVertically;
            this.subscribe(PointerEvents.pointerDown, "draggableOnPointerDown");
            this.subscribe(PointerEvents.pointerDrag, "draggableOnPointerDrag");
        }

        draggableOnPointerDown() {
            this.positionAtDragStart = this.dragHandlePart.threeObj.position.clone();
        }

        draggableOnPointerDrag({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
            const dragEnd = this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
            this.modelPart(this.dragTargetPartPath).moveTo(
                this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
            );
        }
    };
}
