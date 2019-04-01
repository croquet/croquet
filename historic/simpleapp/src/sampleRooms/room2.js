import * as THREE from 'three';
import Island from "../island.js";
import Room from "../room/roomModel.js";
import Portal from "../portal/portalModel.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

function initRoom2(state) {
    return new Island(state, () => {
        const room = new Room({color: {value: new THREE.Color("#000088")}});

        const portalRoom1 = new Portal({
            spatial: { position: {x: 0, y: 2, z: 0} },
            thereSpatial: {
                position: {x: -4, y: 1.25, z: 4},
                quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, -Math.PI / 4)
            },
            size: { value: {x: 1.5, y: 2.5, z: 1.0} },
            portal: { there: "room1" }
        });
        room.parts.objects.add(portalRoom1);

        const portalBounce = new Portal({
            spatial: {
                position: {x: -3, y: 2, z: 1},
                quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, Math.PI / 4)
            },
            thereSpatial: {
                position: {x: 0, y: 1.25, z: 2},
            },
            size: { value: {x: 1.5, y: 2.5, z: 1.0} },
            portal: { there: "bounce" }
        });
        room.parts.objects.add(portalBounce);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom2,
};
