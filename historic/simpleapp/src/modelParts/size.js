import * as THREE from 'three';
import { ModelPart } from "../model.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

const SizeEvents = {
    changed: "size-changed"
};

export default class SizePart extends ModelPart {
    fromState(state={}) {
        this.value = state.value || new THREE.Vector3(1, 1, 1);
    }

    set(newSize) {
        this.value.copy(newSize);
        this.publish(SizeEvents.changed, newSize);
    }
}
