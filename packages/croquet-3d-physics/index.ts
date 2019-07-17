import * as OIMO from 'oimo';
import { vec3, quat } from 'gl-matrix';
import { gatherInternalClassTypes, Model } from 'croquet';
import { Observable, Observing } from 'croquet-observable';
import quatToEuler from 'quaternion-to-euler';

export class PhysicsWorld extends Observable(Model) {
    world!: OIMO.World;
    nSteps!: number;
    stepMultiplier!: number;

    static types() {
        const dummyWorld = new OIMO.World({timestep: 1/60, iterations: 16, broadphase: 3, worldscale: 1, random: false, info: false, gravity: [0, -9.82, 0] });
        dummyWorld.add({type: 'sphere', size: [1,1,1], pos: [0,3,0], move: true, density: 1, friction: 0.2, restitution: 0.2, belongsTo: 1, collidesWith: 0xffffffff});
        dummyWorld.add({type: 'cylinder', size: [1,1,1], pos: [0,3.5,0], move: true, density: 1, friction: 0.2, restitution: 0.2, belongsTo: 1, collidesWith: 0xffffffff});
        dummyWorld.add({type: 'box', size: [1,1,1], pos: [0,1,0]});
        dummyWorld.step();
        return gatherInternalClassTypes(dummyWorld, "OIMO");
    }

    init(options: {stepMultiplier?: number, }) {
        super.init(options);

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
        this.publishPropertyChange("nSteps");
        this.future(1000/60).step();
    }
}

export function SpaceWrapping(wrappingOptions: {wrapAround?: (pos: vec3) => (vec3 | undefined)} = {}) {
    const wrapAround = wrappingOptions.wrapAround || (_pos => null);
    return (BasePhysicsWorld: typeof PhysicsWorld) => class SpaceWrappingPhysicalWorld extends BasePhysicsWorld {
        step() {
            let currentBody = this.world.rigidBodies;
            while (currentBody) {
                if (currentBody.isDynamic && !currentBody.isKinematic) {
                    const mappedPosition = wrapAround(currentBody.getPosition());
                    if (mappedPosition) {
                        currentBody.resetPosition(mappedPosition[0], mappedPosition[1], mappedPosition[2]);
                    }
                }
                currentBody = currentBody.next;
            }
            super.step();
        }
    };
}

export type PhysicsBodyOptions = {
    world: PhysicsWorld,
    type: "box" | "sphere" | "cylinder",
    size: vec3,
    position: vec3,
    quaternion?: quat,
    move: boolean,
    kinematic: boolean,
    density?: number,
    friction?: number,
    restitution?: number
}

type Dimensions = {
    type: "box",
    width: number,
    height: number,
    depth: number
} | {
    type: "sphere",
    radius: number
} | {
    type: "cylinder",
    radius: number,
    height: number
}

export class PhysicsBody extends Observing(Observable(Model)) {
    body!: OIMO.Body;

    init(options: PhysicsBodyOptions) {
        super.init(options);

        this.body = options.world.world.add({
            type: options.type || "box",
            size: options.size,
            pos: options.position,
            rot: options.quaternion && quatToEuler(options.quaternion).map((a: number) => a * 180 / Math.PI),
            move: options.move === undefined ? true : options.move,
            kinematic: !!options.kinematic,
            density: options.density || 1,
            friction: options.friction || 0.2,
            restitution: options.restitution || 0.2
        });

        this.subscribeToPropertyChange(options.world, "nSteps", this.stepped);
    }

    stepped() {
        this.publishPropertyChange("position");
        this.publishPropertyChange("quaternion");
    }

    get position() {
        return this.body.getPosition();
    }

    get quaternion() {
        return this.body.getQuaternion();
    }

    get dimensions(): Dimensions {
        const firstShape = this.body.shapes;
        if (firstShape.type === OIMO.SHAPE_BOX)
            return {type: "box", width: firstShape.width, height: firstShape.height, depth: firstShape.depth};
        if (firstShape.type === OIMO.SHAPE_SPHERE)
            return {type: "sphere", radius: firstShape.radius};
        if (firstShape.type === OIMO.SHAPE_CYLINDER)
            return {type: "cylinder", radius: firstShape.radius, height: firstShape.height};
        throw new Error("Unknown shape type");
    }
}