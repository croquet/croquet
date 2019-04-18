import * as THREE from "three";
import { ModelPart } from "../parts";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const ColorEvents = {
    changed: 'color-changed'
};

export default class ColorPart extends ModelPart {
    init(color) {
        super.init();
        this.value = color || new THREE.Color("#dddddd");
    }

    load(state) {
        this.value = new THREE.Color(state.value);
    }

    save(state) {
        state.value = '#' + this.value.getHexString();
    }

    setColor(newColor) {
        this.value = new THREE.Color(newColor);
        this.publish(this.id, ColorEvents.changed, this.value);
    }
}
