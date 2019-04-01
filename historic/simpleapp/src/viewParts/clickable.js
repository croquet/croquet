import { PointerEvents, makePointerSensitive } from "./pointer.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default function Clickable(BaseViewPart, clickOptions) {
    clickOptions = {
        clickHandle: "",
        onClick: () => {},
        ...clickOptions
    };

    return class ClickableViewPart extends BaseViewPart {
        constructor(modelState, options) {
            super(modelState, options);

            /** @type {import('./object3D').Object3D} */
            this.clickablePart = this.lookUp(clickOptions.clickHandle);
            makePointerSensitive(this.clickablePart.threeObj, this);
            this.subscribe(PointerEvents.pointerDown, "clickableOnPointerDown");
        }

        clickableOnPointerDown() {
            clickOptions.onClick.apply(this);
        }
    };
}
