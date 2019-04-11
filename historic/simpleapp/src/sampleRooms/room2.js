import * as THREE from "three";
import Island from "../island";
import Room from "../room/roomModel";
import Portal from "../portal/portalModel";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

function initRoom2(state) {
    return new Island(state, island => {
        const room = new Room().init({color: {value: new THREE.Color("#000088")}});
        island.set("room", room);

        const portalRoom1 = new Portal().init({
            spatial: { position: {x: 0, y: 2, z: 0}, scale: {x: 1.5, y: 2.5, z: 1.0} },
            spatialThere: {
                position: {x: -4, y: 1.25, z: 4},
                quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, -Math.PI / 4)
            },
            there: "room1"
        });
        room.parts.objects.add(portalRoom1);

        const portalBounce = new Portal().init({
            spatial: {
                position: {x: -3, y: 2, z: 1},
                quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, Math.PI / 4),
                scale: {x: 1.5, y: 2.5, z: 1.0}
            },
            spatialThere: {
                position: {x: 0, y: 1.25, z: 2},
            },
            there: "bounce"
        });
        room.parts.objects.add(portalBounce);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom2,
};
