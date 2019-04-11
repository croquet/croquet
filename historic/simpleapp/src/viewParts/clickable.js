import { PointerEvents, makePointerSensitive } from "./pointer.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default function Clickable(clickOptions={}) {
    clickOptions = {
        clickHandle: "",
        onClick: _options => () => {},
        ...clickOptions
    };

    return BaseViewPart => class ClickableViewPart extends BaseViewPart {
        constructor(options) {
            super(options);
            /** @type {import('./object3D').Object3D} */
            this.clickablePart = this.lookUp(clickOptions.clickHandle);
            makePointerSensitive(this.clickablePart.threeObj, this);
            this.subscribe(PointerEvents.pointerDown, "clickableOnPointerDown");
            this.onClickCallback = clickOptions.onClick(options);
        }

        clickableOnPointerDown() {
            this.onClickCallback();
        }
    };
}
