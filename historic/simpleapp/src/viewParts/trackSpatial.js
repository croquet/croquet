import { ViewPart } from "../view.js";
import { SpatialEvents } from '../modelParts/spatial.js';

export default class TrackSpatialViewPart extends ViewPart {
    constructor(owner, options) {
        options = {partName: "track", modelPartName: "spatial", targetViewPart: "object3D", ...options};
        super(owner, options);
        this.modelPartName = options.modelPartName;
        /** @type {Object3DView} */
        this.targetViewPart = this.owner.parts[options.targetViewPart];
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
