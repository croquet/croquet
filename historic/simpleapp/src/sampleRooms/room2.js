import * as THREE from 'three';
import Island from "../island.js";
import Room from "../room/roomModel.js";
import Portal from "../portal/portalModel.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default function initRoom2(state) {
    state = { id: "2bb90375ea596139cc2cdcf474df4117", ...state };

    return new Island(state, () => {
        const room = new Room({color: {value: new THREE.Color("#000088")}});

        const portal = new Portal({
            spatial: { position: new THREE.Vector3(0, 2, 0) },
            thereSpatial: {
                position: new THREE.Vector3(-4, 1.25, 4),
                quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4)
            },
            size: { value: new THREE.Vector3(1.5, 2.5, 1.0) },
            portal: { there: "room1" }
        });
        room.parts.objects.add(portal);

        const portalBounce = new Portal({
            spatial: {
                position: {x: -2, y: 2, z: 2},
                quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, Math.PI / 2)
            },
            thereSpatial: {
                position: {x: 0, y: 0, z: 2},
            },
            size: { value: {x: 1.5, y: 2.5, z: 1.0} },
            portal: { there: "bounce" }
        });
        room.parts.objects.add(portalBounce);
    });
}
