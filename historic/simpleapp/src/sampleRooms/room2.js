import * as THREE from 'three';
import Island from "../island.js";
import Room from "../room/roomModel.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default function initRoom2(state) {
    return new Island(state, () => {
        new Room({color: {value: new THREE.Color("#000088")}});
    });
}
