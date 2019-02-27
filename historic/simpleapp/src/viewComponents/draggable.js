import { ViewComponent } from "../view.js";
import { PointerEvents, makePointerSensitive } from "./pointer.js";

export default class DraggableViewComponent extends ViewComponent {
    constructor(owner, componentName="draggable", grabbableComponentName="object3D", targetComponentName="spatial", dragVertically=true) {
        super(owner, componentName);
        /** @type {import('./object3D').default} */
        this.grabbableComponent = owner[grabbableComponentName];
        this.targetComponentName = targetComponentName;
        this.dragVertically = dragVertically;
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
        this.subscribe(PointerEvents.pointerUp, "onPointerUp");
    }

    attach() {
        makePointerSensitive(this.grabbableComponent.threeObj, this.asViewComponentRef());
    }

    onPointerDown() {
        this.positionAtDragStart = this.grabbableComponent.threeObj.position.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane, dragEndOnVerticalPlane}) {
        const dragEnd = this.dragVertically ? dragEndOnVerticalPlane : dragEndOnHorizontalPlane;
        this.owner.model()[this.targetComponentName].moveTo(
            this.positionAtDragStart.clone().add(dragEnd.clone().sub(dragStart))
        );
    }

    onPointerUp() {}
}
