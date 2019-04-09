import * as THREE from 'three';
import { StatePart } from "../modelView.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const ColorEvents = {
    changed: 'color-changed'
};

export default class ColorPart extends StatePart {
    applyState(state={}) {
        this.value = new THREE.Color(state.value || "#dddddd");
    }

    toState(state) {
        state.value = '#' + this.value.getHexString();
    }

    setColor(newColor) {
        this.value = new THREE.Color(newColor);
        this.publish(ColorEvents.changed, this.value);
    }
}
