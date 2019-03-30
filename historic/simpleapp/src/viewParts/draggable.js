import { ViewPart } from "../modelView.js";
import { PointerEvents, makePointerSensitive } from "./pointer.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** @typedef {import("../modelView.js").StatePart} StatePart */
/** @typedef {import("../parts.js").PartPath} PartPath */

export default class DraggableViewPart extends ViewPart {
    /**
     * @arg {Object} options
     * @arg {ViewPart} options.inner - a callback that constructs the inner ViewPart that should be draggable
     * @arg {PartPath | null} options.dragHandle - an optional path to a subpart of the inner ViewPart to use as the drag handle - otherwise uses the whole inner part
     * @arg {PartPath | null} options.target - the path into the attached model to modify on drag - defaults to "spatial"
     * @arg {boolean | null} options.dragVertically - whether drags should be on a horizontal or vertical camera-oriented plane
    */
    constructor(modelState, options) {
        options = {
            dragHandle: "",
            target: "spatial",
            dragVertically: true,
            ...options
        };
        super(modelState, options);

        this.parts = {inner: options.inner};
        /** @type {SceneNode} */
        this.dragHandlePart = this.parts.inner.lookUp(options.dragHandle);
        makePointerSensitive(this.dragHandlePart.threeObj);
        this.targetPartPath = options.target;
        this.dragVertically = options.dragVertically;
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
    }

    onPointerDown() {
        this.positionAtDragStart = this.dragHandlePart.threeObj.position.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
        const dragEnd = this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
        this.modelPart(this.targetPartPath).moveTo(
            this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
        );
    }
}
