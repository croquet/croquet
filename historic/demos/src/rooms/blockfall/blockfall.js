import { Room, Draggable, Tracking, PhysicalElement, PhysicalWorld, PhysicalShape, THREE, SpaceWrapping } from '@croquet/kit';
import { RandomlyColoringGroupElement } from '../bounce/bounce';

export class Puck extends PhysicalElement {
    naturalViewClass() {
        return PuckView;
    }
}

class PuckView extends Draggable({
    draggingPlane: new THREE.Plane(new THREE.Vector3(0, Math.cos(Math.PI / 8), Math.sin(Math.PI / 8)), 0)
})(Tracking()(PhysicalShape)) {
    constructor(options) {
        super({...options, material: new THREE.MeshStandardMaterial({
            color: "#EF493E", metalness: 0.2, roughness: 0.8, transparent: true, opacity: 0.9
        })});
    }
}

export class Ground extends PhysicalElement {
    naturalViewClass() {
        return GroundView;
    }
}

class GroundView extends Tracking()(PhysicalShape) {
    constructor(options) {
        super({...options, material: new THREE.MeshStandardMaterial({
            color: "#333333", metalness: 0.2, roughness: 0.8,
        })});
    }
}

export const WrappingWorld = SpaceWrapping({
    wrapAround: pos => pos.y < -2 && new THREE.Vector3(pos.x % 2, 8, -3),
})(PhysicalWorld);

export default function initBlockfall(options) {
    // called as part of installing the initial Island
    const room = Room.create();
    room.addElementManipulators = false;

    const world = WrappingWorld.create({
        timestep: 1/320,
        iterations: 4,
        stepMultiplier: 3
    });

    const coloring = RandomlyColoringGroupElement.create();
    room.parts.elements.add(coloring);

    const nElements = options.n || 15;

    for (let i = 0; i < nElements; i++) {
        const size = 0.25;
        const sphere = PhysicalElement.create({
            spatial: {
                world,
                type: room.random() > 0.3 ? room.random() > 0.5 ? "sphere" : "box" : "cylinder",
                position: new THREE.Vector3(2 - 4 * room.random(), 2 + 20 * room.random(), -3),
                size: new THREE.Vector3(size, size, size),
                density: 1,
                friction: 0.5,
                restitution: 0.2
            }
        });
        coloring.parts.children.add(sphere);
    }

    const ground = Ground.create({
        spatial: {
            world,
            type: "cylinder",
            position: new THREE.Vector3(0, 0, -2.8),
            quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 8),
            size: new THREE.Vector3(3, 3, 3),
            move: false
        }
    });
    room.parts.elements.add(ground);

    for (let z = 0; z <= 2; z++) {
        for (let x = -1; x <= 1 - z; x++) {
            const puck = Puck.create({
                spatial: {
                    world,
                    type: "cylinder",
                    size: new THREE.Vector3(0.25, 0.5, 0.25),
                    position: new THREE.Vector3(1.5 * x + 1.5 * 0.5 * z, 1.6 - Math.sin(Math.PI / 8) * z, -2.5 + z),
                    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 8),
                    density: 1,
                    kinematic: true
                }
            });
            room.parts.elements.add(puck);
        }
    }

    return {room};
}
