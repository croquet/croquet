import * as THREE from 'three';
import { ModelPart } from "../model.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

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
