import { Room, Clickable, Tracking, PhysicalElement, PhysicalWorld, PhysicalShape, THREE } from '@croquet/kit';
import { RandomlyColoringGroupElement } from '../bounce/bounce';

export class Ball extends PhysicalElement {
    naturalViewClass() {
        return BallView;
    }

    push(pushAt) {
        const body = this.parts.spatial.body;
        const direction = this.parts.spatial.position.clone().sub(pushAt);
        direction.y = 0;
        const force = direction.normalize().multiplyScalar(0.1);
        body.applyImpulse(pushAt, force);
    }
}

const BallView = Clickable({
    onClick: options => at => {
        options.model.future(0).push(at);
    }
})(Tracking()(PhysicalShape));

export default function initMinipool() {
    // called as part of installing the initial VirtualMachine
    const room = Room.create();
    room.addElementManipulators = false;
    room.noNavigation = true;

    const world = PhysicalWorld.create();

    const coloring = RandomlyColoringGroupElement.create();
    room.parts.elements.add(coloring);

    const radius = 0.2;
    const dist = 0.4;
    const rowDist = dist * Math.sin(Math.PI/3);

    for (let row = 0; row < 5; row++) {
        for (let ball = 0; ball <= row; ball++) {
            const x = dist * ball - 0.5 * dist * row;
            const z = -rowDist * row;
            const box = Ball.create({
                spatial: {
                    world,
                    type: "sphere",
                    position: new THREE.Vector3(x, 0.3, z - 1.4),
                    size: new THREE.Vector3(radius, radius, radius),
                    friction: 0.4,
                    restitution: 0.9,
                    density: 0.3,
                }
            });
            coloring.parts.children.add(box);
        }
    }

    const whiteBall = Ball.create({
        spatial: {
            world,
            type: "sphere",
            position: new THREE.Vector3(0, 0.3, 1 - 1.4),
            size: new THREE.Vector3(radius, radius, radius),
            friction: 0.4,
            restitution: 0.9,
            density: 0.3,
        }
    });
    coloring.parts.children.add(whiteBall);

    const ground = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(0, -2.5 + 0.1, 0 - 1.4),
            size: new THREE.Vector3(5, 5, 5),
            move: false,
        }
    });
    room.parts.elements.add(ground);

    const wall1 = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(-3, -2.5 + 0.5, 0 - 1.4),
            size: new THREE.Vector3(1, 5, 5),
            move: false,
        }
    });
    room.parts.elements.add(wall1);

    const wall2 = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(3, -2.5 + 0.5, 0 - 1.4),
            size: new THREE.Vector3(1, 5, 5),
            move: false,
        }
    });
    room.parts.elements.add(wall2);

    const wall3 = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(0, -2.5 + 0.5, -3 - 1.4),
            size: new THREE.Vector3(5, 5, 1),
            move: false,
        }
    });
    room.parts.elements.add(wall3);

    const wall4 = PhysicalElement.create({
        spatial: {
            world,
            type: "box",
            position: new THREE.Vector3(0, -2.5 + 0.5, 3 - 1.4),
            size: new THREE.Vector3(5, 5, 1),
            move: false,
        }
    });
    room.parts.elements.add(wall4);

    return {room};
}
