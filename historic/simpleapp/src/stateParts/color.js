import * as THREE from 'three';
import { StatePart } from "../modelView.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const ColorEvents = {
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
        this.value.copy(newColor);
        this.publish(ColorEvents.changed, newColor);
    }
}
