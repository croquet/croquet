import * as THREE from 'three';
import { ModelPart } from "../model.js";

const SizeEvents = {
    changed: "size-changed"
};

export default class SizePart extends ModelPart {
    constructor(owner, state={}, options) {
        super(owner, {partName: "size", ...options});
        this.value = state.value || new THREE.Vector3(1, 1, 1);
    }

    set(newSize) {
        this.value.copy(newSize);
        this.publish(SizeEvents.changed, newSize);
    }
}
