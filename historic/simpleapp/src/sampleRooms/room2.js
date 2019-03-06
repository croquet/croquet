import * as THREE from 'three';
import Island from "../island.js";
import Room from "../room/roomModel.js";

export default function initRoom2(state) {
    let room;

    const island = new Island(state && state.island, () => {
        room = new Room({color: {value: new THREE.Color("#000088")}});
    });

    room = room || island.modelsById[state.room];

    return {island, room};
}
