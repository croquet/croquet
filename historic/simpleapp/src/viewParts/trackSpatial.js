import { ViewPart } from "../view.js";
import { SpatialEvents } from '../modelParts/spatial.js';

export default class TrackSpatial extends ViewPart {
    constructor(owner, partName = "track", modelPartName = "spatial", targetViewPart = "object3D") {
        super(owner, partName);
        this.modelPartName = modelPartName;
        /** @type {Object3DView} */
        this.targetViewPart = this.owner[targetViewPart];
    }
    attach(modelState) {
        const modelPart = modelState[this.modelPartName];
        this.targetViewPart.threeObj.position.copy(modelPart.position);
        this.targetViewPart.threeObj.quaternion.copy(modelPart.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", modelState.id, this.modelPartName);
        this.subscribe(SpatialEvents.rotated, "onRotated", modelState.id, this.modelPartName);
    }
    onMoved(newPosition) {
        this.targetViewPart.threeObj.position.copy(newPosition);
    }
    onRotated(newQuaternion) {
        this.targetViewPart.threeObj.quaternion.copy(newQuaternion);
    }
}
