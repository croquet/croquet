import * as THREE from 'three';
import { ModelPart } from "../model.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

const ColorEvents = {
    changed: 'color-changed'
};

export default class ColorPart extends ModelPart {
    fromState(state={}) {
        this.value = state.value || new THREE.Color("#dddddd");
    }

    toState(state) {
        state.value = this.value.clone();
    }

    setColor(newColor) {
        this.value.copy(newColor);
        this.publish(ColorEvents.changed, newColor);
    }
}
