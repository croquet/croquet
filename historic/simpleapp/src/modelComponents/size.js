import { ModelComponent } from "../model";
import * as THREE from 'three';

const SizeEvents = {
    changed: "size-changed"
}

export default class SizeComponent extends ModelComponent {
    constructor(owner, state={}, componentName="size") {
        super(owner, componentName);
        this.value = state.value || new THREE.Vector3(1, 1, 1);
    }

    set(newSize) {
        this.value.copy(newSize);
        this.publish(SizeEvents.changed, newSize);
    }
}