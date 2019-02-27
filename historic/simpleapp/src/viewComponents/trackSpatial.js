import { ViewComponent } from "../view.js";
import { SpatialEvents } from '../modelComponents/spatial.js';

export default class TrackSpatial extends ViewComponent {
    constructor(owner, componentName = "track", modelComponentName = "spatial", targetViewComponent = "object3D") {
        super(owner, componentName);
        this.modelComponentName = modelComponentName;
        /** @type {Object3DView} */
        this.targetViewComponent = this.owner[targetViewComponent];
    }
    attach(modelState) {
        const modelComponent = modelState[this.modelComponentName];
        this.targetViewComponent.threeObj.position.copy(modelComponent.position);
        this.targetViewComponent.threeObj.quaternion.copy(modelComponent.quaternion);
        this.subscribe(SpatialEvents.moved, "onMoved", modelState.id, this.modelComponentName);
        this.subscribe(SpatialEvents.rotated, "onRotated", modelState.id, this.modelComponentName);
    }
    onMoved(newPosition) {
        this.targetViewComponent.threeObj.position.copy(newPosition);
    }
    onRotated(newQuaternion) {
        this.targetViewComponent.threeObj.quaternion.copy(newQuaternion);
    }
}
