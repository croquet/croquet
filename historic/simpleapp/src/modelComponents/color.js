import { ModelComponent } from "../model";
import * as THREE from 'three';

const ColorEvents = {
    changed: 'color-changed'
}

export default class ColorComponent extends ModelComponent {
    constructor(owner, state={}, componentName="color") {
        super(owner, componentName);
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