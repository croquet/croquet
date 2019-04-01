import { ViewPart } from "../view.js";
import { PointerEvents, makePointerSensitive } from "./pointer.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

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
