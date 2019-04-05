import * as THREE from 'three';
import SeedRandom from "seedrandom";
import Island from "../island.js";
import {StatePart, ViewPart} from '../modelView.js';
import Room from "../room/roomModel.js";
import ChildrenPart, { ChildEvents } from '../stateParts/children.js';
import SpatialPart from '../stateParts/spatial.js';
import Bouncing from '../stateParts/bouncing.js';
import Tracking from '../viewParts/tracking.js';
import Clickable from '../viewParts/clickable.js';
import Draggable from '../viewParts/draggable.js';
import { TextObject } from '../objects/text.js';
import urlOptions from '../util/urlOptions.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export class Box extends StatePart {
    constructor() {
        super();
        this.parts = {spatial: new SpatialPart()};
    }

    naturalViewClass() { return DragBoxView; }
}

export class BouncingBox extends StatePart {
    constructor() {
        super();
        this.parts = {spatial: new (Bouncing(SpatialPart))()};
    }

    naturalViewClass() { return ClickBoxView; }
}

class BoxViewPart extends ViewPart {
    constructor(model, options) {
        options = {color: "#aaaaaa", ...options};
        super(model, options);
        this.threeObj = new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color(options.color)})
        );
    }
}

class BallViewPart extends ViewPart {
    constructor(model, options) {
        options = {color: "#aaaaaa", ...options};
        super(model, options);
        this.threeObj = new THREE.Mesh(
            new THREE.SphereBufferGeometry(0.75, 16, 16),
            new THREE.MeshStandardMaterial({color: new THREE.Color(this.color)})
        );
    }
}

const ClickBoxView = Clickable(Tracking(BallViewPart), {
    onClick() {
        this.modelPart("spatial").toggle();
    }
});

const DragBoxView = Draggable(Tracking(BoxViewPart));

export class Group extends StatePart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart(),
            children: new ChildrenPart()
        };
    }

    naturalViewClass() { return GroupView; }
}

class ChildrenGroupView extends ViewPart {
    constructor(model, options) {
        super(model, options);
        this.viewsForObjects = {};

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", model.id, "children");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", model.id, "children");
        this.group = new THREE.Group();
        this.threeObj = this.group;

        for (const object of model.parts.children.children) {
            this.onObjectAdded(object);
        }
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-group");
        /** @type {View} */
        const view = new NaturalView(object);
        this.viewsForObjects[object.id] = view;
        this.group.add(...view.threeObjs());
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        this.group.remove(...view.threeObjs());
        view.detach();
        delete this.viewsForObjects[object.id];
    }
}

const GroupView = Tracking(ChildrenGroupView);

/** A group that assigns random colors to its children's views */
export class RandomColorGroup extends Group {
    naturalViewClass() { return RandomColorGroupView; }
}

class RandomColorChildrenGroupView extends ChildrenGroupView {
    onObjectAdded(object) {
        super.onObjectAdded(object);
        const view = this.viewsForObjects[object.id];
        if (!this.random) this.random = new SeedRandom(this.modelId);
        for (const threeObj of view.threeObjs()) {
            threeObj.material.color.setHSL(this.random(), 1, 0.5);
        }
    }
}

const RandomColorGroupView = Tracking(RandomColorChildrenGroupView);

function initBounce(state, options) {
    return new Island(state, island => {
        const room = new Room().init({});
        island.set("room", room);

        for (let x = -3; x <= 3; x += 3) {
            const bigBox = new Box().init({ spatial: { position: { x, y: 0.5, z: -2 }}});
            room.parts.objects.add(bigBox);
        }
        const text1 = new TextObject().init({
            spatial: { position: new THREE.Vector3(-2.25, 3, -2) },
            text: { content: "Croquet runs identically on any platform. Load this in another page to compare. Drag the cubes." }
        });
        room.parts.objects.add(text1);
        const bouncingBoxes = new RandomColorGroup().init({ spatial: { scale: {x: 0.5, y: 0.5, z: 0.5 } } });
        room.parts.objects.add(bouncingBoxes);
        for (let i = 0; i < options.n; i++) {
            bouncingBoxes.parts.children.add(new BouncingBox().init({ spatial: { scale: {x: 0.3, y: 0.3, z: 0.3 } } }));
        }
    });
}

export default {
    moduleID: module.id,
    creatorFn: initBounce,
    options: { n: urlOptions.n || 100 }
};
