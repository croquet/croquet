import { Room, Draggable, Tracking, TextElement, PhysicalElement, PhysicalWorld, PhysicalShape, THREE } from '@croquet/kit';
import { RandomlyColoringGroupElement } from '../bounce/bounce';

export class Piece extends PhysicalElement {
    naturalViewClass() {
        return PieceView;
    }
}

const PieceView = Draggable({dragVertically: false})(Tracking()(PhysicalShape));

export default function initPhysics(options) {
    // called as part of installing the initial Island
    const room = Room.create();
    room.addElementManipulators = false;

    const world = PhysicalWorld.create({timestep: 1/320, iterations: 4, stepMultiplier: 5});

    const coloring = RandomlyColoringGroupElement.create();
    room.parts.elements.add(coloring);

    const stackingHeight = options.height || 10;

    for (let l = 0; l < stackingHeight; l++) {
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

    const chat = TextElement.create({
        editable: true,
        spatial: { position: new THREE.Vector3(-5, 2, -1.5) },
        text: {
            content: {
                runs: [{text: "Rudimentary chat here:"}],
            },
        },
    });
    room.parts.elements.add(chat);

    return {room};
}
