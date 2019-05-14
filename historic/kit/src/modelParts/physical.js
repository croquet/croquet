import * as THREE from 'three';
import * as OIMO from 'oimo';
import { gatherInternalClassTypes } from '@croquet/teatime/src/island';
import { SpatialEvents } from "./spatial";
import { ModelPart } from "../parts";
import Tracking from "../viewParts/tracking";
import { PhysicalShape } from "../viewParts/physicalShape";

export const PhysicsEvents = {
    worldStepped: "physics-worldStepped"
};

export default class PhysicalPart extends ModelPart {
    init(options={}, id) {
        super.init(options, id);

        this.body = options.world.world.add({
            type: options.type || "box",
            size: options.size.toArray(),
            pos: options.position.toArray(),
            move: options.move === undefined ? true : options.move,
            kinematic: !!options.kinematic,
            density: options.density || 1,
            friction: options.friction || 0.2,
            restitution: options.restitution || 0.2
        });

        this.subscribe(options.world, PhysicsEvents.worldStepped, data => this.stepped(data));
    }

    stepped() {
        this.publish(this.id, SpatialEvents.moved, this.position);
        this.publish(this.id, SpatialEvents.rotated, this.quaternion);
    }

    get position() {
        return this.body.getPosition();
    }

    get quaternion() {
        return this.body.getQuaternion();
    }

    get scale() {
        const firstShape = this.body.shapes;
        if (firstShape.type === OIMO.SHAPE_BOX) return new THREE.Vector3(firstShape.width, firstShape.height, firstShape.depth);
        if (firstShape.type === OIMO.SHAPE_SPHERE)  return new THREE.Vector3(firstShape.radius, firstShape.radius, firstShape.radius);
        if (firstShape.type === OIMO.SHAPE_CYLINDER) return new THREE.Vector3(firstShape.radius, firstShape.height, firstShape.radius);
        throw new Error("Unknown shape type");
    }

    moveTo(position) {
        if (this.body.isKinematic) this.body.setPosition(position);
        else this.body.resetPosition(position.x, position.y, position.z);
    }
    moveBy(_delta) {}
    scaleTo(_scale) {}
    scaleBy(_factor) {}
    rotateTo(_quaternion) {}
    rotateBy(_delta) {}
}

export class PhysicalElement extends ModelPart {
    constructor() {
        super();

        this.parts = {
            spatial: new PhysicalPart()
        };
    }

    naturalViewClass() {
        return Tracking()(PhysicalShape);
    }
}

export class PhysicalWorld extends ModelPart {
    static types() {
        const dummyWorld = new OIMO.World({timestep: 1/60, iterations: 16, broadphase: 3, worldscale: 1, random: false, info: false, gravity: [0, -9.82, 0] });
        dummyWorld.add({type: 'sphere', size: [1,1,1], pos: [0,3,0], move: true, density: 1, friction: 0.2, restitution: 0.2, belongsTo: 1, collidesWith: 0xffffffff});
        dummyWorld.add({type: 'cylinder', size: [1,1,1], pos: [0,3.5,0], move: true, density: 1, friction: 0.2, restitution: 0.2, belongsTo: 1, collidesWith: 0xffffffff});
        dummyWorld.add({type: 'box', size: [1,1,1], pos: [0,1,0]});
        dummyWorld.step();
        return gatherInternalClassTypes(dummyWorld, "OIMO");
    }

    init(options={}, id) {
        super.init(options, id);
        this.world = new OIMO.World({
            timestep: 1/60,
            iterations: 8,
            broadphase: 3, // 1 brute force, 2 sweep and prune, 3 volume tree
            worldscale: 1, // scale full world
            random: false,  // randomize sample
            info: false,   // calculate statistic or not
            gravity: [0, -9.82, 0],
            ...options
        });
        this.stepMultiplier = options.stepMultiplier || 1;
        this.nSteps = 0;
        this.future(1000/60).step();
    }

    step() {
        for (let i = 0; i < this.stepMultiplier; i++) {
            this.world.step();
            this.nSteps += 1;
        }
        this.publish(this, PhysicsEvents.worldStepped);
        this.future(1000/60).step();
    }
}
