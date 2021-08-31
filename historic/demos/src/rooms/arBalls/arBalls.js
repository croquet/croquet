import SeedRandom from "seedrandom/seedrandom";
import { ModelPart, ViewPart, Room, ChildrenPart, ChildEvents, SpatialPart, Tracking, ColorPart, THREE } from "@croquet/kit";
import Flying from './flying';

//import Clickable from "../viewParts/clickable";
//import Draggable from "../viewParts/draggable";

const TOTAL_BALLS = 100;
const GRAVITY = 0.001;
const USER = Math.random();

export class BoxElement extends ModelPart {
    constructor() {
        super();
        this.parts = {spatial: new SpatialPart()};
        this.subscribe("arBalls", "launch", data => this.adjustCamera(data));
    }

    adjustCamera(data) {
        if (data.USER !== this.USER) return; // @@ fix me

        const camPos = new THREE.Vector3(...data.cameraPos);
        this.parts.spatialPart.moveTo(camPos);
    }

    naturalViewClass() { return BoxElementView; }
}

class BoxViewPart extends ViewPart {
    constructor(options) {
        options = {color: "#aaaaaa", ...options};
        super(options);
        this.threeObj = new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 0.1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color(options.color)})
        );
    }
}

class BoxElementView extends (Tracking()(BoxViewPart)) {
    get label() {
        return "Camera Box";
    }
}

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
        options.spatial.gravity = new THREE.Vector3(0, 0, GRAVITY);
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

    get label() {
        return "Flying Ball";
    }

    recolor(data) {
        this.threeObj.visible = !!data.colorH;
        if (data.colorH) this.threeObj.material.color.setHSL(data.colorH, 1, 0.5);
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

        const camPos = new THREE.Vector3(...data.cameraPos);
        // const camQuat = new THREE.Quaternion(...data.camQuat);

        // HACK
        const balls = Array.from(this.parts.children.children);

        const ballSpatial = balls[this.launchIndex].parts.spatial;
        const height = -camPos.z;// - 0.25; // height of camera above ar code
        const camDirOnPlane = new THREE.Vector3().copy(camPos);
        camDirOnPlane.z = 0;
        const hDistance = camDirOnPlane.length(); // horizontal distance
        camDirOnPlane.normalize();
        let alpha = 0.3; // slope we'd like the ball to curve in at
        if (hDistance * alpha + height <= 0) {
            const newAlpha = Math.min(0.7, -height / hDistance * 1.1);
//console.log(`dist = ${hDistance.toFixed(2)}, height = ${height}; alpha ${alpha} not steep enough; using ${newAlpha.toFixed(2)}`);
            alpha = newAlpha;
        }

        ballSpatial.position = new THREE.Vector3(0, 0, -0.2);

        let uStart, vStart;
        if (alpha===0) {
            const t = Math.sqrt(2 * height / GRAVITY);
            vStart = GRAVITY * t; // +ve up (i.e., -ve z)
            uStart = hDistance / t;
        } else {
            // v is the initial upward speed for the backward journey from camera to target
            const v = hDistance * alpha / Math.sqrt(2 / GRAVITY * (hDistance * alpha + height));
            const u = v / alpha; // +ve whether v is +ve or -ve
            const t = hDistance / u;
            vStart = -(v - GRAVITY * t); // find v at the target, and reverse it
            uStart = u;
        }
//console.log({ height: height.toFixed(2), alpha, uStart: uStart.toFixed(2), vStart: vStart.toFixed(2) });
        ballSpatial.estimatedVelocity = new THREE.Vector3(0, 0, -vStart).addScaledVector(camDirOnPlane, uStart);
        ballSpatial.targetPoint = new THREE.Vector3(...data.cameraPos);
        ballSpatial.distanceToTarget = ballSpatial.targetPoint.length();
        ballSpatial.targetAlpha = alpha;
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
        setInterval(() => {
            const pos = cameraSpatial.position;
            if (pos.length() <= 1000) this.publish("arBalls", "launch", { cameraPos: pos.toArray(), colorH: viewColorH });
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

    get label() {
        return "Flying Balls";
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

export default function initARBalls() {
    // called as part of installing the initial VirtualMachine
    const room = Room.create();
    room.addElementManipulators = false;

    const flyingBalls = GroupElement.create({ spatial: { scale: new THREE.Vector3(0.5, 0.5, 0.5) } });
    room.parts.elements.add(flyingBalls);

    /* NOT READY
    const cameraBox = BoxElement.create({ spatial: { position: new THREE.Vector3(x, 0.5, -2)}});
    room.parts.elements.add(cameraBox);
    */

    return {room};
}
