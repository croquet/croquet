import * as THREE from "three";
import SeedRandom from "seedrandom";
import Island from "../island";
import {StatePart, ViewPart} from "../modelView";
import Room from "../room/roomModel";
import ChildrenPart, { ChildEvents } from "../stateParts/children";
import SpatialPart from "../stateParts/spatial";
import Bouncing from "../stateParts/bouncing";
import Tracking from "../viewParts/tracking";
import Clickable from "../viewParts/clickable";
import Draggable from "../viewParts/draggable";
import TextElement from "../elements/textElement";
import urlOptions from "../util/urlOptions";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export class BoxElement extends StatePart {
    constructor() {
        super();
        this.parts = {spatial: new SpatialPart()};
    }

    naturalViewClass() { return BoxElementView; }
}

export class BouncingBallElement extends StatePart {
    constructor() {
        super();
        this.parts = {spatial: new (Bouncing()(SpatialPart))()};
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

const BoxElementView = Draggable()(Tracking()(BoxViewPart));

class BallViewPart extends ViewPart {
    constructor(options) {
        options = {color: "#aaaaaa", ...options};
        super(options);
        this.threeObj = new THREE.Mesh(
            new THREE.SphereBufferGeometry(0.75, 16, 16),
            new THREE.MeshStandardMaterial({color: new THREE.Color(this.color)})
        );
    }
}

const BouncingBallElementView = Clickable({
    onClick: options => () => {
        options.model.parts.spatial.toggle();
    }
})(Tracking()(BallViewPart));


export class GroupElement extends StatePart {
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

        this.subscribe(ChildEvents.childAdded, "onElementAdded", options.model.id, "children");
        this.subscribe(ChildEvents.childRemoved, "onElementRemoved", options.model.id, "children");
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
    //     this.random = new SeedRandom(options.model.id);
    // }

    onElementAdded(element) {
        super.onElementAdded(element);
        const view = this.viewsForChildElements[element.id];
        // would like to use options.model.id for random (see constructor)
        // but the super() constructor already calls onElementAdded
        if (!this.random) this.random = new SeedRandom("VeryRandomSeed");
        for (const threeObj of view.threeObjs()) {
            threeObj.material.color.setHSL(this.random(), 1, 0.5);
        }
    }
}

function initBounce(state, options) {
    return new Island(state, island => {
        const room = new Room().init({});
        island.set("room", room);

        for (let x = -3; x <= 3; x += 3) {
            const bigBox = new BoxElement().init({ spatial: { position: { x, y: 0.5, z: -2 }}});
            room.parts.elements.add(bigBox);
        }
        const text1 = new TextElement().init({
            spatial: { position: new THREE.Vector3(-2.25, 3, -2) },
            text: { content: {runs: [{text: ["Croquet replicated text" /*runs identically on any platform. Load this in another page to compare. Drag the cubes." */ ]}]} },
            editable: false
        });
        room.parts.elements.add(text1);
        const bouncingBoxes = new RandomlyColoringGroupElement().init({ spatial: { scale: {x: 0.5, y: 0.5, z: 0.5 } } });
        room.parts.elements.add(bouncingBoxes);
        for (let i = 0; i < options.n; i++) {
            bouncingBoxes.parts.children.add(new BouncingBallElement().init({ spatial: { scale: {x: 0.3, y: 0.3, z: 0.3 } } }));
        }
    });
}

export default {
    moduleID: module.id,
    creatorFn: initBounce,
    options: { n: urlOptions.n || 100 }
};
