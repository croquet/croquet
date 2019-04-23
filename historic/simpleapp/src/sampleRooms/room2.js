import * as THREE from "three";
import Room from "../room/roomModel";
import PortalElement from "../elements/portalElement";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

function initRoom2() {
    const room = Room.create({color: new THREE.Color("#000088")});

    const portalRoom1 = PortalElement.create({
        spatial: { position: new THREE.Vector3(0, 2, 0), scale: new THREE.Vector3(1.5, 2.5, 1.0) },
        spatialThere: {
            position: new THREE.Vector3(-4, 1, 4),
            quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, -Math.PI / 4)
        },
        there: "room1",
        roomId: room.id
    });
    room.parts.elements.add(portalRoom1);

    const portalBounce = PortalElement.create({
        spatial: {
            position: new THREE.Vector3(-3, 2, 1),
            quaternion: new THREE.Quaternion().setFromAxisAngle({x: 0, y: 1, z: 0}, Math.PI / 4),
            scale: new THREE.Vector3(1.5, 2.5, 1.0)
        },
        spatialThere: {
            position: new THREE.Vector3(0, 1, 2),
        },
        there: "bounce",
        roomId: room.id
    });
    room.parts.elements.add(portalBounce);

    const portalJump = PortalElement.create({
        spatial: {
            position: new THREE.Vector3(3, 2, 0),
            scale: new THREE.Vector3(1.5, 2.5, 1.0)
        },
        spatialThere: {
            position: new THREE.Vector3(0, 1, 4),
        },
        there: "jump1",
        roomId: room.id
    });
    room.parts.elements.add(portalJump);

    return {room};
}

export default { creatorFn: initRoom2 };
