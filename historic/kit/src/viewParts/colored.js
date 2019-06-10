import { ColorEvents } from "../modelParts/color";

export default function Colored(trackingOptions={}) {
    trackingOptions = {};

    return BaseViewPart => class ColoredViewPart extends BaseViewPart {
        constructor(options) {
            super(options);

            const source = trackingOptions.source || (options.model && options.model.parts.color);
            this.threeObj.material.color.copy(source.value);
            this.subscribe(source.id, ColorEvents.changed, newValue => this.threeObj.material.color.copy(newValue));
        }
    };
}
