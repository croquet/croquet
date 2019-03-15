import { ViewPart } from "../view.js";
import { SpatialEvents } from '../stateParts/spatial.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class TrackSpatial extends ViewPart {
    fromOptions(options) {
        options = {source: "model.spatial", affects: "object3D", ...options};
        this.source = options.source;
        /** @type {Object3DView} */
        this.targetViewPart = this.owner.parts[options.affects];
    }

    attach(modelState) {
        const [contextName, partId] = this.source.split(".");
        const context = contextName === "model" ? modelState : this.owner;
        const spatialPart = context.parts[partId];
        this.targetViewPart.threeObj.position.copy(spatialPart.position);
        this.targetViewPart.threeObj.quaternion.copy(spatialPart.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", context.id, partId );
        this.subscribe(SpatialEvents.rotated, "onRotated", context.id, partId );
    }

    onMoved(newPosition) {
        this.targetViewPart.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.targetViewPart.threeObj.quaternion.copy(newQuaternion);
    }
}
