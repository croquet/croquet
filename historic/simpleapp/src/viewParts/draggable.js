import { ViewPart } from "../view.js";
import { PointerEvents, makePointerSensitive } from "./pointer.js";

export default class DraggableViewPart extends ViewPart {
    constructor(owner, partName="draggable", grabbablePartName="object3D", targetPartName="spatial", dragVertically=true) {
        super(owner, partName);
        /** @type {import('./object3D').default} */
        this.grabbablePart = owner[grabbablePartName];
        this.targetPartName = targetPartName;
        this.dragVertically = dragVertically;
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
        this.subscribe(PointerEvents.pointerUp, "onPointerUp");
    }

    attach() {
        makePointerSensitive(this.grabbablePart.threeObj, this.asViewPartRef());
    }

    onPointerDown() {
        this.positionAtDragStart = this.grabbablePart.threeObj.position.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
        const dragEnd = this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
        this.owner.model()[this.targetPartName].moveTo(
            this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
        );
    }

    onPointerUp() {}
}
