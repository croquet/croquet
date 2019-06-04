import { SpatialEvents } from "../modelParts/spatial";
import { ViewEvents } from "../parts";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default function Tracking(trackingOptions={}) {
    trackingOptions = {position: true, rotation: true, scale: true, ...trackingOptions};

    return BaseViewPart => class TrackingViewPart extends BaseViewPart {
        constructor(options) {
            super(options);

            const source = trackingOptions.source || (options.model && options.model.parts.spatial);
            // TODO: what to do if the inner view has multiple threeObjs?
            if (trackingOptions.position) {
                this.threeObj.position.copy(source.position);
                this.subscribe(source.id, SpatialEvents.moved, data => this.onMoved(data));
            }
            if (trackingOptions.scale) {
                this.threeObj.scale.copy(source.scale);
                this.subscribe(source.id, SpatialEvents.scaled, data => this.onScaled(data));
            }
            if (trackingOptions.rotation) {
                this.threeObj.quaternion.copy(source.quaternion);
                this.subscribe(source.id, SpatialEvents.rotated, data => this.onRotated(data));
            }
        }

        onMoved(newPosition) {
            this.threeObj.position.copy(newPosition);
            this.publish(this.id, ViewEvents.changedDimensions);
        }

        onScaled(newScale) {
            this.threeObj.scale.copy(newScale);
            this.publish(this.id, ViewEvents.changedDimensions);
        }

        onRotated(newQuaternion) {
            this.threeObj.quaternion.copy(newQuaternion);
            this.publish(this.id, ViewEvents.changedDimensions);
        }
    };
}

export function Facing(trackingOptions) {
    return BaseViewPart => Tracking({...trackingOptions, position: false, scale: false})(BaseViewPart);
}
