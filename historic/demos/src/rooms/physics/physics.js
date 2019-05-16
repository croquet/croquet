import { urlOptions } from '@croquet/util';
import { Room, Draggable, Tracking, PhysicalElement, PhysicalWorld, PhysicalShape, THREE } from '@croquet/kit';
import { RandomlyColoringGroupElement } from '../bounce/bounce';

export class Puck extends PhysicalElement {
    naturalViewClass() {
        return PuckView;
    }
}

class PuckView extends Draggable({dragVertically: false})(Tracking()(PhysicalShape)) {
    constructor(options) {
        super({...options, material: new THREE.MeshStandardMaterial({
            color: "#dddddd", metalness: 0.2, roughness: 0.8, transparent: true, opacity: 0.8
        })});
    }
}

function initPhysics(options) {
    // called as part of installing the initial Island
    const room = Room.create();
    room.addElementManipulators = false;

    const world = PhysicalWorld.create();

    const coloring = RandomlyColoringGroupElement.create();
    room.parts.elements.add(coloring);

    for (let i = 0; i < options.n/3; i++) {
        const size = 0.1 + 0.2 * room.random();
        const sphere = PhysicalElement.create({
            spatial: {
                world,
                type: "sphere",
                position: new THREE.Vector3(2 - 4 * room.random(), 3 + room.random() * 2, -4 * room.random()),
                size: new THREE.Vector3(size, size, size)
            }
        });
        coloring.parts.children.add(sphere);

        const box = PhysicalElement.create({
            spatial: {
                world,
                type: "box",
                position: new THREE.Vector3(2 - 4 * room.random(), 3 + room.random() * 2, -4 * room.random()),
                size: new THREE.Vector3(0.1 + 0.4 * room.random(), 0.1 + 0.4 * room.random(), 0.1 + 0.4 * room.random())
            }
        });
        coloring.parts.children.add(box);

        const height = 0.1 + 0.5 * room.random();
        const radius = 0.1 + 0.3 * room.random();
        const cylinder = PhysicalElement.create({
            spatial: {
                world,
                type: "cylinder",
                position: new THREE.Vector3(2 - 4 * room.random(), 3 + room.random() * 2, -4 * room.random()),
                size: new THREE.Vector3(radius, height, radius)
            }
        });
        coloring.parts.children.add(cylinder);
    }

    const ground = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(0, -4.3, -2),
            size: new THREE.Vector3(50, 10, 50),
            move: false
        }
    });
    room.parts.elements.add(ground);

    for (let x = -2; x <= 2; x++) {
        const puck = Puck.create({
            spatial: {
                world,
                type: "cylinder",
                size: new THREE.Vector3(0.3, 0.6, 0.3),
                position: new THREE.Vector3(x, 1, -0.5),
                density: 1,
                kinematic: true
            }
        });
        room.parts.elements.add(puck);
    }

    return {room};
}

export default {
    init: initPhysics,
    options: { n: urlOptions.n || 100 }
};
