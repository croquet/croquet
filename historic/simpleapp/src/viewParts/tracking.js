import { SpatialEvents } from '../stateParts/spatial.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default function Tracking(BaseViewPart, trackingOptions={}) {
    trackingOptions = {source: "spatial", scale: true, ...trackingOptions};

    return class TrackingViewPart extends BaseViewPart {
        constructor(modelState, options) {
            super(modelState, options);

            /** @type {import('../parts').PartPath} */
            const source = modelState.lookUp(trackingOptions.source);
            // TODO: what to do if the inner view has multiple threeObjs?
            this.threeObj.position.copy(source.position);
            if (trackingOptions.scale) {
                this.threeObj.scale.copy(source.scale);
                this.subscribe(SpatialEvents.scaled, "onScaled", source.id);
            }
            this.threeObj.quaternion.copy(source.quaternion);
            this.subscribe(SpatialEvents.moved, "onMoved", source.id);
            this.subscribe(SpatialEvents.rotated, "onRotated", source.id);
        }

        onMoved(newPosition) {
            this.threeObj.position.copy(newPosition);
        }

        onScaled(newScale) {
            this.threeObj.scale.copy(newScale);
        }

        onRotated(newQuaternion) {
            this.threeObj.quaternion.copy(newQuaternion);
        }
    };
}
