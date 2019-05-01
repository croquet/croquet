import * as THREE from "three";
import SeedRandom from "seedrandom";
import {urlOptions} from "@croquet/util";
import {ModelPart, ViewPart} from "../parts";
import Room from "../room/roomModel";
import ChildrenPart, { ChildEvents } from "../modelParts/children";
import SpatialPart, { SpatialEvents } from "../modelParts/spatial";
import Flying from "../modelParts/flying";
import Tracking from "../viewParts/tracking";
import ColorPart from "../modelParts/color";

//import Clickable from "../viewParts/clickable";
//import Draggable from "../viewParts/draggable";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const TOTAL_BALLS = 100;
const USER = Math.random();

export const FlyingSpatialPart = Flying()(SpatialPart);

export class FlyingBallElement extends ModelPart {
    constructor() {
        super();
        this.parts = {
            color: new ColorPart(),
            spatial: new FlyingSpatialPart()
            };
    }

    init(options) {
        const startPos = new THREE.Vector3(0, 0, 1000); // out of sight
        const startVelocity = new THREE.Vector3(0, 0, 0);
        options.spatial.position = startPos;
        options.spatial.velocity = startVelocity;
        options.spatial.gravity = new THREE.Vector3(0, 0, 0.001);
        super.init(options);
    }

    naturalViewClass() { return FlyingBallElementView; }
}

const FlyingBallElementView = Tracking()(class extends ViewPart {
    constructor(options) {
        options = {color: "#aaaaaa", ...options};
        super(options);
        const source = options.model && options.model.parts.spatial;
        this.subscribe(source.id, "recolor", data => this.recolor(data));

        this.threeObj = new THREE.Mesh(
            new THREE.SphereBufferGeometry(0.75, 16, 16),
            new THREE.MeshStandardMaterial({color: new THREE.Color(this.color)})
        );
    }

    recolor(data) {
        this.threeObj.material.color.setHSL(data.colorH, 1, 0.5);
    }
});

export class GroupElement extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart(),
            children: new ChildrenPart()
            };
    }

    init(options) {
        super.init(options);
        this.launchIndex = -1;
        for (let i = 0; i < TOTAL_BALLS; i++) {
            const ball = FlyingBallElement.create({ spatial: { scale: new THREE.Vector3(0.2, 0.2, 0.2) } });
            this.parts.children.add(ball);
        }
        this.subscribe("arBalls", "launch", data => this.launchBall(data));
    }

    load(state, allModels) {
        super.load(state, allModels);
        this.launchIndex = state.launchIndex;
    }

    save(state) {
        super.save(state);
        state.launchIndex = this.launchIndex;
    }

    launchBall(data) {
        this.launchIndex++;
        if (this.launchIndex === TOTAL_BALLS) this.launchIndex = 0;
        // HACK
        const balls = Array.from(this.parts.children.children);
        const ballSpatial = balls[this.launchIndex].parts.spatial;
        ballSpatial.position = new THREE.Vector3(0, 0, -0.2);
        ballSpatial.estimatedVelocity = new THREE.Vector3(...data.direction).multiplyScalar(0.1);
        this.publish(ballSpatial.id, "recolor", { colorH: data.colorH });
    }

    naturalViewClass() { return GroupElementView; }
}

const GroupElementView = Tracking()(class extends ViewPart {
    constructor(options) {
        super(options);
        const cameraSpatial = options.cameraSpatial;

        this.viewsForChildElements = {};

        this.subscribe(options.model.parts.children.id, ChildEvents.childAdded, data => this.onElementAdded(data));
        this.subscribe(options.model.parts.children.id, ChildEvents.childRemoved, data => this.onElementRemoved(data));
        this.group = new THREE.Group();
        this.threeObj = this.group;

        const markSize = 1.15; // approx width and height (by inspection)
        const originMark = new THREE.Mesh(
            //new THREE.PlaneBufferGeometry(markSize, markSize),
            new THREE.RingBufferGeometry(markSize*0.4, markSize*0.45, 32),
            new THREE.MeshStandardMaterial({color: new THREE.Color("#88ff88")})
            );
        const offset = (markSize - 1)/2;
        originMark.position.set(offset, 0, -offset);
        originMark.rotateX(-Math.PI/2);
        this.threeObj.add(originMark);

        for (const element of options.model.parts.children.children) {
            this.onElementAdded(element);
        }

        const viewColorH = USER; // a suitable random number
        const camPos = new THREE.Vector3();
        setInterval(() => {
            const pos = cameraSpatial.position;
            if (pos.x !== 10000) this.publish("arBalls", "launch", { direction: camPos.copy(cameraSpatial.position).normalize().toArray(), colorH: viewColorH });
            }, 200);
    }

    onElementAdded(element) {
        const NaturalView = element.naturalViewClass("in-group");
        /** @type {View} */
        const view = new NaturalView({model: element});
        this.viewsForChildElements[element.id] = view;
        this.group.add(...view.threeObjs());
    }

    onElementRemoved(element) {
        const view = this.viewsForChildElements[element.id];
        this.group.remove(...view.threeObjs());
        view.detach();
        delete this.viewsForChildElements[element.id];
    }
});

/** A group that assigns random colors to its children's views */
export class RandomlyColoringGroupElement extends GroupElement {
    naturalViewClass() { return RandomlyColoringGroupElementView; }
}

class RandomlyColoringGroupElementView extends GroupElementView {
    // constructor(options) {
    //     super(options);
    //     this.seedRandom = new SeedRandom(options.model.id);
    // }

    onElementAdded(element) {
        super.onElementAdded(element);
        const view = this.viewsForChildElements[element.id];
        // would like to use options.model.id for random (see constructor)
        // but the super() constructor already calls onElementAdded
        if (!this.seedRandom) this.seedRandom = new SeedRandom("VeryRandomSeed");
        for (const threeObj of view.threeObjs()) {
            threeObj.material.color.setHSL(this.seedRandom(), 1, 0.5);
        }
    }
}

function initARBalls(_options) {
    // called as part of installing the initial Island
    const room = Room.create();
    room.addElementManipulators = false;

    const flyingBalls = GroupElement.create({ spatial: { scale: new THREE.Vector3(0.5, 0.5, 0.5) } });
    room.parts.elements.add(flyingBalls);

    return {room};
}

export default {
    creatorFn: initARBalls,
    options: { n: urlOptions.n || 100 }
};
