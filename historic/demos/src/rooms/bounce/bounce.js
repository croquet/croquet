import SeedRandom from "seedrandom/seedrandom";
import { ModelPart, ViewPart, Room, ChildrenPart, ChildEvents, SpatialPart, Tracking, Clickable, Draggable, TextElement, THREE } from "@croquet/kit";
import Bouncing from './bouncing';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export class BoxElement extends ModelPart {
    constructor() {
        super();
        this.parts = {spatial: new SpatialPart()};
    }

    naturalViewClass() { return BoxElementView; }
}

export const BouncingSpatialPart = Bouncing()(SpatialPart);

export class BouncingBallElement extends ModelPart {
    constructor() {
        super();
        this.parts = { spatial: new BouncingSpatialPart() };
    }

    naturalViewClass() { return BouncingBallElementView; }
}

class BoxViewPart extends ViewPart {
    constructor(options) {
        options = {color: "#aaaaaa", ...options};
        super(options);
        this.threeObj = new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color(options.color)})
        );
    }
}

class BoxElementView extends Draggable()(Tracking()(BoxViewPart)) {
    get label() {
        return "Draggable Box";
    }
}

class BallViewPart extends ViewPart {
    constructor(options) {
        options = {color: "#aaaaaa", ...options};
        super(options);
        this.threeObj = new THREE.Mesh(
            new THREE.SphereBufferGeometry(0.75, 16, 16),
            new THREE.MeshStandardMaterial({color: new THREE.Color(this.color), metalness: 0.2, roughness: 0.8})
        );
    }
}

const BouncingBallElementView = Clickable({
    onClick: options => () => {
        options.model.parts.spatial.future().toggle();
    }
})(Tracking()(BallViewPart));


export class GroupElement extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart(),
            children: new ChildrenPart()
        };
    }

    naturalViewClass() { return GroupElementView; }
}

const GroupElementView = Tracking()(class extends ViewPart {
    constructor(options) {
        super(options);
        this.viewsForChildElements = {};

        this.subscribe(options.model.parts.children.id, ChildEvents.childAdded, data => this.onElementAdded(data));
        this.subscribe(options.model.parts.children.id, ChildEvents.childRemoved, data => this.onElementRemoved(data));
        this.group = new THREE.Group();
        this.threeObj = this.group;

        for (const element of options.model.parts.children.children) {
            this.onElementAdded(element);
        }
    }

    onElementAdded(element) {
        const NaturalView = element.naturalViewClass("in-group");
        /** @type {View} */
        const view = new NaturalView({model: element});
        this.viewsForChildElements[element.id] = view;
        // this.subscribe(view, {event: ViewEvents.changedDimensions, oncePerFrame: true}, () => this.publish(this, ViewEvents.changedDimensions));
        this.group.add(...view.threeObjs());
    }

    onElementRemoved(element) {
        const view = this.viewsForChildElements[element.id];
        this.group.remove(...view.threeObjs());
        // this.unsubscribe(view, ViewEvents.changedDimensions);
        view.detach();
        delete this.viewsForChildElements[element.id];
    }
});

/** A group that assigns random colors to its children's views */
export class RandomlyColoringGroupElement extends GroupElement {
    naturalViewClass() { return RandomlyColoringGroupElementView; }
}

class RandomlyColoringGroupElementView extends GroupElementView {
    constructor(options) {
        super(options);
        // TODO: this is just a hack to give this a more stable bounding box and thus frame
        const sizingBox = new THREE.Mesh(
            new THREE.BoxBufferGeometry(30, 30, 30),
            new THREE.MeshBasicMaterial({visible: false})
        );
        sizingBox.position.setY(10);
        this.group.add(sizingBox);
    }

    onElementAdded(element) {
        super.onElementAdded(element);
        const view = this.viewsForChildElements[element.id];
        // would like to use options.model.id for random (see constructor)
        // but the super() constructor already calls onElementAdded
        if (!this.seedRandom) this.seedRandom = new SeedRandom("VeryRandomSeed");
        for (const threeObj of view.threeObjs()) {
            threeObj.material.color.setHSL(this.seedRandom(), 0.5, 0.6);
        }
    }

    get label() {
        // TODO: this doesn't really belong here if this is supposed to be generic
        return "Bouncing Balls";
    }
}

export default function initBounce(options) {
    const room = Room.create();

    for (let x = -3; x <= 3; x += 3) {
        const bigBox = BoxElement.create({ spatial: { position: new THREE.Vector3(x, 0.5, -2)}});
        room.parts.elements.add(bigBox);
    }
    const text1 = TextElement.create({
        spatial: { position: new THREE.Vector3(-2.25, 3, -2) },
        text: { content: {runs: [{text: "Croquet runs identically on any platform. Load this in another page to compare. Drag the cubes."}]} },
        editable: true
    });
    room.parts.elements.add(text1);
    const bouncingBoxes = RandomlyColoringGroupElement.create({ spatial: { scale: new THREE.Vector3(0.5, 0.5, 0.5) } });
    room.parts.elements.add(bouncingBoxes);

    const n = options.n || 100;

    for (let i = 0; i < n; i++) {
        bouncingBoxes.parts.children.add(BouncingBallElement.create({ spatial: { scale: new THREE.Vector3(0.3, 0.3, 0.3) } }));
    }

    return {room};
}
