import { ViewPart } from "../view.js";
import { PointerEvents, makePointerSensitive } from "./pointer.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class Clickable extends ViewPart {
    fromOptions(options) {
        options = {
            clickable: "object3D",
            target: "spatial",
            method: "onClick",
            ...options
        };
        /** @type {import('./object3D').Object3D} */
        this.clickablePart = this.owner.parts[options.clickable];
        this.targetPartName = options.target;
        this.targetMethod = options.method;
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
    }

    attach() {
        makePointerSensitive(this.clickablePart.threeObj, this.asPartRef());
    }

    onPointerDown() {
        this.owner.model[this.targetPartName][this.targetMethod]();
    }
}
