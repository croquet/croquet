import { ColorEvents } from "../modelParts/color";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

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
