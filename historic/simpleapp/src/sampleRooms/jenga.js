import * as THREE from 'three';
import { urlOptions } from '@croquet/util';
import Room from "../room/roomModel";
import { RandomlyColoringGroupElement } from './bounce';
import { PhysicalElement, PhysicalWorld } from '../modelParts/physical';
import Draggable from '../viewParts/draggable';
import { PhysicalShape } from '../viewParts/physicalShape';
import Tracking from '../viewParts/tracking';

export class Piece extends PhysicalElement {
    naturalViewClass() {
        return PieceView;
    }
}

const PieceView = Draggable({dragVertically: false})(Tracking()(PhysicalShape));

function initPhysics(options) {
    // called as part of installing the initial Island
    const room = Room.create();
    room.addElementManipulators = false;

    const world = PhysicalWorld.create({timestep: 1/320, iterations: 4, stepMultiplier: 5});

    const coloring = RandomlyColoringGroupElement.create();
    room.parts.elements.add(coloring);

    for (let l = 0; l < options.height; l++) {
        const [width, depth] = l % 2 === 0 ? [1, 1/3] : [1/3, 1];
        const height = 1/6;

        for (let o = -1; o <= 1; o++) {
            const [x, z] = l % 2 === 0 ? [0, 1.1 * o * depth] : [1.1 * o * width, 0];
            const box = Piece.create({
                spatial: {
                    world,
                    type: "box",
                    position: new THREE.Vector3(x, 1 * l * height + 0.5 * height + 0.1, z),
                    size: new THREE.Vector3(width, height, depth),
                    friction: 0.4,
                    restitution: 0.1,
                    density: 0.3,
                }
            });
            coloring.parts.children.add(box);
        }
    }

    const ground = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(0, -2.5 + 0.1, 0),
            size: new THREE.Vector3(3, 5, 3),
            move: false,
        }
    });
    room.parts.elements.add(ground);

    return {room};
}

export default {
    creatorFn: initPhysics,
    options: { height: urlOptions.height || 10 }
};
