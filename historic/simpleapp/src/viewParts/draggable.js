import { ViewPart } from "../view.js";
import { PointerEvents, makePointerSensitive } from "./pointer.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export default class DraggableViewPart extends ViewPart {
    fromOptions(options) {
        options = {
            dragHandle: "object3D",
            target: "spatial",
            dragVertically: true,
            ...options
        };

        /** @type {import('./object3D').Object3D} */
        this.dragHandlePart = this.owner.parts[options.dragHandle];
        this.targetPartName = options.target;
        this.dragVertically = options.dragVertically;
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
        this.subscribe(PointerEvents.pointerUp, "onPointerUp");
    }

    attach() {
        makePointerSensitive(this.dragHandlePart.threeObj, this.asViewPartRef());
    }

    onPointerDown() {
        this.positionAtDragStart = this.dragHandlePart.threeObj.position.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
        const dragEnd = this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
        this.owner.model[this.targetPartName].moveTo(
            this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
        );
    }

    onPointerUp() {}
}
