import { SpatialEvents } from "../modelParts/spatial";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default function Tracking(trackingOptions={}) {
    trackingOptions = {position: true, rotation: true, scale: true, ...trackingOptions};

    return BaseViewPart => class TrackingViewPart extends BaseViewPart {
        constructor(options) {
            super(options);

            const source = trackingOptions.source || (options.model && options.model.parts.spatial);
            // TODO: what to do if the inner view has multiple threeObjs?
            if (trackingOptions.position) {
                this.threeObj.position.copy(source.position);
                this.subscribe(source.id, SpatialEvents.moved, "onMoved");
            }
            if (trackingOptions.scale) {
                this.threeObj.scale.copy(source.scale);
                this.subscribe(source.id, SpatialEvents.scaled, "onScaled");
            }
            if (trackingOptions.rotation) {
                this.threeObj.quaternion.copy(source.quaternion);
                this.subscribe(source.id, SpatialEvents.rotated, "onRotated");
            }
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

export function Facing(trackingOptions) {
    return BaseViewPart => Tracking({...trackingOptions, position: false, scale: false})(BaseViewPart);
}
