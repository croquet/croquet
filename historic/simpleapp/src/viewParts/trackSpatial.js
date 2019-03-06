import { ViewPart } from "../view.js";
import { SpatialEvents } from '../stateParts/spatial.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export default class TrackSpatial extends ViewPart {
    fromOptions(options) {
        options = {source: "model.spatial", affects: "object3D", ...options};
        this.source = options.source;
        /** @type {Object3DView} */
        this.targetViewPart = this.owner.parts[options.affects];
    }

    attach(modelState) {
        const [contextName, partName] = this.source.split(".");
        const context = contextName === "model" ? modelState : this.owner;
        const spatialPart = context.parts[partName];
        this.targetViewPart.threeObj.position.copy(spatialPart.position);
        this.targetViewPart.threeObj.quaternion.copy(spatialPart.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", context.id, partName );
        this.subscribe(SpatialEvents.rotated, "onRotated", context.id, partName );
    }

    onMoved(newPosition) {
        this.targetViewPart.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.targetViewPart.threeObj.quaternion.copy(newQuaternion);
    }
}
