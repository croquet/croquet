import { PointerEvents, makePointerSensitive } from "./pointer";

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
            this.subscribe(this.id, { event: PointerEvents.pointerDown, handling: 'immediate' }, data => this.clickableOnPointerDown(data));
            this.onClickCallback = clickOptions.onClick(options);
        }

        clickableOnPointerDown({at}) {
            this.onClickCallback(at, this); // @@ ael - added "this", used by video player
        }
    };
}
