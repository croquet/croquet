import { ViewPart } from "../view.js";
import { SpatialEvents } from '../modelParts/spatial.js';

export default class TrackSpatialViewPart extends ViewPart {
    fromOptions(options) {
        options = {modelSource: "spatial", affects: "object3D", ...options};
        this.modelSource = options.modelSource;
        /** @type {Object3DView} */
        this.targetViewPart = this.owner.parts[options.affects];
    }

    attach(modelState) {
        const modelPart = modelState.parts[this.modelSource];
        this.targetViewPart.threeObj.position.copy(modelPart.position);
        this.targetViewPart.threeObj.quaternion.copy(modelPart.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", modelState.id, this.modelSource);
        this.subscribe(SpatialEvents.rotated, "onRotated", modelState.id, this.modelSource);
    }

    onMoved(newPosition) {
        this.targetViewPart.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.targetViewPart.threeObj.quaternion.copy(newQuaternion);
    }
}
