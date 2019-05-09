import * as THREE from 'three';
import * as OIMO from 'oimo';
import { urlOptions } from '@croquet/util';
import Room from "../room/roomModel";
import { ModelPart, ViewPart } from "../parts";
import SpatialPart from '../modelParts/spatial';
import Tracking from '../viewParts/tracking';
import { PointerEvents, makePointerSensitive } from '../viewParts/pointer';
import { RandomlyColoringGroupElement } from './bounce';

const USER = Math.random() + "";

export const PhysicsEvents = {
    worldStepped: "physics-worldStepped"
};

function gatherInternalClassTypes(dummyObject, prefix) {
    const gatheredClasses = {};
    const seen = new Set();
    gatherInternalClassTypesRec({root: dummyObject}, prefix, gatheredClasses, seen);
    return gatheredClasses;
}

function gatherInternalClassTypesRec(dummyObject, prefix="", gatheredClasses={}, seen=new Set()) {
    const newObjects = Object.values(dummyObject)
        .filter(prop => {
            const type = Object.prototype.toString.call(prop).slice(8, -1);
            return (type === "Object" || type === "Array") && !seen.has(prop);
        });
    for (const obj of newObjects) {
        seen.add(obj);
        const className = prefix + "." + obj.constructor.name;
        if (gatheredClasses[className]) {
            if (gatheredClasses[className] !== obj.constructor) {
                throw new Error("Class with name " + className + " already gathered, but new one has different identity");
            }
        } else {
            gatheredClasses[className] = obj.constructor;
        }
    }
    // we did breadth-first
    for (const obj of newObjects) {
        gatherInternalClassTypesRec(obj, prefix, gatheredClasses, seen);
    }
}

export class OimoWorld extends ModelPart {
    static types() {
        const dummyWorld = new OIMO.World({
            timestep: 1/60,
            iterations: 16,
            broadphase: 3,
            worldscale: 1,
            random: false,
            info: false,
            gravity: [0, -9.82, 0]
        });
        dummyWorld.add({
            type: 'sphere', // type of shape : sphere, box, cylinder
            size: [1,1,1], // size of shape
            pos: [0,3,0], // start position in degree
            move: true, // dynamic or statique
            density: 1,
            friction: 0.2,
            restitution: 0.2,
            belongsTo: 1, // The bits of the collision groups to which the shape belongs.
            collidesWith: 0xffffffff // The bits of the collision groups with which the shape collides.
        });
        dummyWorld.add({
            type: 'cylinder', // type of shape : sphere, box, cylinder
            size: [1,1,1], // size of shape
            pos: [0,3.5,0], // start position in degree
            move: true, // dynamic or statique
            density: 1,
            friction: 0.2,
            restitution: 0.2,
            belongsTo: 1, // The bits of the collision groups to which the shape belongs.
            collidesWith: 0xffffffff // The bits of the collision groups with which the shape collides.
        });
        dummyWorld.add({
            type: 'box', // type of shape : sphere, box, cylinder
            size: [1,1,1], // size of shape
            pos: [0,1,0], // start position in degree
        });
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
            gravity: [0, -9.82, 0]
        });
        this.nSteps = 0;
        this.future(1000/60).step();
    }

    step() {
        this.world.step();
        this.publish(this, PhysicsEvents.worldStepped);
        this.future(1000/60).step();
        this.nSteps += 1;
        console.log("physics step " + this.nSteps);
        // if (this.nSteps > 300 && this.nSteps % 60 === 0) {
        //     const snap = window.ISLAND.snapshot();
        //     const steps = this.nSteps;
        //     hashString(JSON.stringify(snap)).then(hash => console.log(`State hash, step ${steps}: ${hash}`));
        // }
    }
}

export class OimoBall extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart()
        };
    }

    init(options, id) {
        super.init(options, id);
        this.world = options.world;
        this.ball = this.world.world.add({
            type: 'sphere', // type of shape : sphere, box, cylinder
            size: options.size.toArray(), // size of shape
            pos: options.position.toArray(), // start position in degree
            move: true, // dynamic or statique
            density: 1,
            friction: 0.2,
            restitution: 0.2,
        });
        this.parts.spatial.scaleTo(options.size);
        this.subscribe(options.world, PhysicsEvents.worldStepped, data => this.stepped(data));
    }

    stepped() {
        this.parts.spatial.moveTo(this.ball.getPosition());
        this.parts.spatial.rotateTo(this.ball.getQuaternion());
    }

    naturalViewClass() {
        return Tracking()(OimoBallView);
    }
}

export class OimoBallView extends ViewPart {
    constructor(options) {
        super(options);

        this.threeObj = new THREE.Mesh(
            new THREE.SphereBufferGeometry(1, 20, 20),
            new THREE.MeshStandardMaterial({color: "#888888", metalness: 0.2, roughness: 0.8})
        );
    }
}

export class OimoBox extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart()
        };
    }

    init(options, id) {
        super.init(options, id);
        this.world = options.world;
        this.box = this.world.world.add({
            type: 'box', // type of shape : sphere, box, cylinder
            size: options.size.toArray(), // size of shape
            pos: options.position.toArray(), // start position in degree
            move: true, // dynamic or statique
            density: 1,
            friction: 0.2,
            restitution: 0.2,
        });
        this.parts.spatial.scaleTo(options.size);
        this.subscribe(options.world, PhysicsEvents.worldStepped, data => this.stepped(data));
    }

    stepped() {
        this.parts.spatial.moveTo(this.box.getPosition());
        this.parts.spatial.rotateTo(this.box.getQuaternion());
    }

    naturalViewClass() {
        return Tracking()(OimoBoxView);
    }
}

export class OimoBoxView extends ViewPart {
    constructor(options) {
        super(options);

        this.threeObj = new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: "#888888", metalness: 0.2, roughness: 0.8})
        );
    }
}

export class OimoTube extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart()
        };
    }

    init(options, id) {
        super.init(options, id);
        this.world = options.world;
        this.tube = this.world.world.add({
            type: 'cylinder', // type of shape : sphere, box, cylinder
            size: [options.size.x, options.size.y, options.size.x], // size of shape
            pos: options.position.toArray(), // start position in degree
            move: true, // dynamic or statique
            density: 1,
            friction: 0.2,
            restitution: 0.2,
        });
        this.parts.spatial.scaleTo(new THREE.Vector3(options.size.x, options.size.y, options.size.x));
        this.subscribe(options.world, PhysicsEvents.worldStepped, data => this.stepped(data));
    }

    stepped() {
        this.parts.spatial.moveTo(this.tube.getPosition());
        this.parts.spatial.rotateTo(this.tube.getQuaternion());
    }

    naturalViewClass() {
        return Tracking()(OimoTubeView);
    }
}

export class OimoTubeView extends ViewPart {
    constructor(options) {
        super(options);

        this.threeObj = new THREE.Mesh(
            new THREE.CylinderBufferGeometry(1, 1, 1, 20),
            new THREE.MeshStandardMaterial({color: "#888888", metalness: 0.2, roughness: 0.8})
        );
    }
}

export class OimoGround extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart()
        };
    }

    init(options, id) {
        super.init(options, id);
        this.world = options.world;
        this.ground = this.world.world.add({
            type: 'box', // type of shape : sphere, box, cylinder
            size: options.size.toArray(), // size of shape
            pos: options.position.toArray(), // start position in degree
        });
        this.parts.spatial.moveTo(options.position);
        this.parts.spatial.scaleTo(options.size);
        this.paddles = {};
        this.subscribe(this.id, "movePaddle", data => this.movePaddleTo(data));
    }

    movePaddleTo({position, user}) {
        if (!this.paddles[user]) {
            this.paddles[user] = this.world.world.add({
                type:'cylinder',
                size:[0.3, 0.6, 0.3],
                pos: position.toArray(),
                density:1,
                move:true,
                kinematic:true,
                material:'kinematic'
            });

            console.log("Added paddle at", position);
        } else {
            this.paddles[user].setPosition(position);
            console.log("Moved paddle to", position);
        }
    }

    naturalViewClass() {
        return OimoGroundView;
    }
}

export class OimoGroundView extends ViewPart {
    constructor(options) {
        super(options);

        const groundShape = options.model.ground.shapes;

        this.groundBox = new THREE.Mesh(
            new THREE.BoxBufferGeometry(groundShape.width, groundShape.height, groundShape.depth),
            new THREE.MeshStandardMaterial({color: "#888888"})
        );

        this.paddleTubes = {};
        this.paddleTubesGroup = new THREE.Group();

        this.groundBox.position.copy(options.model.ground.getPosition());

        makePointerSensitive(this.groundBox, this);
        const movePaddleCallback = ({hoverPoint, dragEndOnHorizontalPlane}) => {
            const targetPoint = (hoverPoint || dragEndOnHorizontalPlane).clone().add(new THREE.Vector3(0, 0.3, 0));
            this.publish(options.model.id, "movePaddle", {position: targetPoint, user: USER});
        };
        this.subscribe(this.id, PointerEvents.pointerEnter, movePaddleCallback);
        this.subscribe(this.id, PointerEvents.pointerMove, movePaddleCallback);

        this.subscribe(options.model.world, PhysicsEvents.worldStepped, () => {
            for (const [user, paddle] of Object.entries(options.model.paddles)) {
                if (!this.paddleTubes[user]) {
                    const paddleShape = paddle.shapes;

                    this.paddleTubes[user] = new THREE.Mesh(
                        new THREE.CylinderBufferGeometry(1, 1, 1, 20),
                        new THREE.MeshStandardMaterial({color: "#ffffff", opacity: 0.6, transparent: true, metalness: 0.2, roughness: 0.8})
                    );

                    this.paddleTubes[user].scale.set(paddleShape.radius, paddleShape.height, paddleShape.radius);

                    this.paddleTubesGroup.add(this.paddleTubes[user]);
                }
                this.paddleTubes[user].position.copy(paddle.getPosition());
            }
        });
    }

    threeObjs() {
        return [this.groundBox, this.paddleTubesGroup];
    }
}

function initPhysics(options) {
    // called as part of installing the initial Island
    const room = Room.create();
    room.addElementManipulators = false;

    const oimoWorld = OimoWorld.create();

    const coloring = RandomlyColoringGroupElement.create();
    room.parts.elements.add(coloring);

    for (let i = 0; i < options.n/3; i++) {
        const size = 0.1 + 0.2 * room.random();
        const oimoBall = OimoBall.create({
            world: oimoWorld,
            position: new THREE.Vector3(2 - 4 * room.random(), 3 + room.random() * 2, -4 * room.random()),
            size: new THREE.Vector3(size, size, size)
        });
        coloring.parts.children.add(oimoBall);

        const oimoBox = OimoBox.create({
            world: oimoWorld,
            position: new THREE.Vector3(2 - 4 * room.random(), 3 + room.random() * 2, -4 * room.random()),
            size: new THREE.Vector3(0.1 + 0.4 * room.random(), 0.1 + 0.4 * room.random(), 0.1 + 0.4 * room.random())
        });
        coloring.parts.children.add(oimoBox);

        const oimoTube = OimoTube.create({
            world: oimoWorld,
            position: new THREE.Vector3(2 - 4 * room.random(), 3 + room.random() * 2, -4 * room.random()),
            size: new THREE.Vector3(0.1 + 0.2 * room.random(), 0.1 + 0.4 * room.random(), 0.1 + 0.2 * room.random())
        });
        coloring.parts.children.add(oimoTube);
    }

    const oimoGround = OimoGround.create({world: oimoWorld, position: new THREE.Vector3(0, -4.3, -2), size: new THREE.Vector3(50, 10, 50)});
    room.parts.elements.add(oimoGround);

    return {room};
}

export default {
    creatorFn: initPhysics,
    options: { n: urlOptions.n || 100 }
};
