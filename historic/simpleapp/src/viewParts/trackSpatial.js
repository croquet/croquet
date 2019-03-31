import { ViewPart } from "../modelView.js";
import { SpatialEvents } from '../stateParts/spatial.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class TrackSpatial extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        options = {source: "spatial", scale: true, ...options};
        /** @type {import('../parts').PartPath} */
        const source = modelState.lookUp(options.source);
        this.parts = {inner: options.inner};
        // TODO: what to do if the inner view has multiple threeObjs?
        this.parts.inner.threeObjs()[0].position.copy(source.position);
        if (options.scale) {
            this.parts.inner.threeObjs()[0].scale.copy(source.scale);
            this.subscribe(SpatialEvents.scaled, "onScaled", source.id);
        }
        this.parts.inner.threeObjs()[0].quaternion.copy(source.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", source.id);
        this.subscribe(SpatialEvents.rotated, "onRotated", source.id);
    }

    onMoved(newPosition) {
        this.parts.inner.threeObjs()[0].position.copy(newPosition);
    }

    onScaled(newScale) {
        this.parts.inner.threeObjs()[0].scale.copy(newScale);
    }

    onRotated(newQuaternion) {
        this.parts.inner.threeObjs()[0].quaternion.copy(newQuaternion);
    }
}
