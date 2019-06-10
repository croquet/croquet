import * as THREE from "three";
import { ModelPart } from "../parts";

export const ColorEvents = {
    changed: 'color-changed'
};

export default class ColorPart extends ModelPart {
    static types() {
        return {
            "THREE.Color": { cls: THREE.Color, write: color => '#' + color.getHexString(), read: state => new THREE.Color(state) },
        };
    }

    init(color, id) {
        super.init(null, id);
        this.value = color || new THREE.Color("#dddddd");
    }

    setColor(newColor) {
        this.value = new THREE.Color(newColor);
        this.publish(this.id, ColorEvents.changed, this.value);
    }
}
