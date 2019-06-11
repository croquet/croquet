import { Room, PortalElement, THREE } from "@croquet/kit";

function initJump(nextRoomName, color) {
    return () => {
        const room = Room.create({color: new THREE.Color(color)});

        const portal = PortalElement.create({
            spatial: { position: new THREE.Vector3(0, 2, 0), scale: new THREE.Vector3(1.5, 2.5, 1.0) },
            spatialThere: { position: new THREE.Vector3(0, 1, 4) },
            there: nextRoomName,
            roomId: room.id
        });
        room.parts.elements.add(portal);

        const escape = PortalElement.create({
            spatial: { position: new THREE.Vector3(-3, 2, 0), scale: new THREE.Vector3(1.5, 2.5, 1.0) },
            spatialThere: { position: new THREE.Vector3(0, 1, 4) },
            there: "portals",
            roomId: room.id
        });
        room.parts.elements.add(escape);

        return {room};
    };
}

export default {
    jump1: initJump("jump2", "#008800"),
    jump2: initJump("jump3", "#880088"),
    jump3: initJump("jump1", "#880000"),
};
