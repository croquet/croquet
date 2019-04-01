import { ViewPart } from "../view.js";
import { SpatialEvents } from '../stateParts/spatial.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

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
        this.targetViewPart.threeObj.scale.copy(spatialPart.scale);
        this.targetViewPart.threeObj.quaternion.copy(spatialPart.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", context.id, partId, true);
        this.subscribe(SpatialEvents.scaled, "onScaled", context.id, partId, true);
        this.subscribe(SpatialEvents.rotated, "onRotated", context.id, partId, true);
    }

    onMoved(newPosition) {
        this.targetViewPart.threeObj.position.copy(newPosition);
    }

    onScaled(newScale) {
        this.targetViewPart.threeObj.scale.copy(newScale);
    }

    onRotated(newQuaternion) {
        this.targetViewPart.threeObj.quaternion.copy(newQuaternion);
    }
}
