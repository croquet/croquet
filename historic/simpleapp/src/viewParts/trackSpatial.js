import { ViewPart } from "../modelView.js";
import { SpatialEvents } from '../stateParts/spatial.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class TrackSpatial extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        options = {source: "spatial", ...options};
        /** @type {import('../parts').PartPath} */
        const source = modelState.lookUp(options.source);
        const sourcePath = modelState.absolutePath(options.source);
        this.parts = {inner: options.inner};
        // TODO: what to do if the inner view has multiple threeObjs?
        this.parts.inner.threeObjs()[0].position.copy(source.position);
        this.parts.inner.threeObjs()[0].scale.copy(source.scale);
        this.parts.inner.threeObjs()[0].quaternion.copy(source.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", sourcePath);
        this.subscribe(SpatialEvents.scaled, "onScaled", sourcePath);
        this.subscribe(SpatialEvents.rotated, "onRotated", sourcePath);
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
