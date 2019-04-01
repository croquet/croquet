import * as THREE from 'three';
import StatePart from "../statePart.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const SizeEvents = {
    changed: "size-changed"
};

export default class SizePart extends StatePart {
    fromState(state={}) {
        this.value = state.value || new THREE.Vector3(1, 1, 1);
        this.ensure(this.value, THREE.Vector3);
    }

    toState(state) {
        super.toState(state);
        state.value = this.value.clone();
    }

    set(newSize) {
        this.value.copy(newSize);
        this.publish(SizeEvents.changed, newSize);
    }
}
