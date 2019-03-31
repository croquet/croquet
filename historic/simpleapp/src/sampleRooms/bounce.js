import SeedRandom from "seedrandom";
import * as THREE from 'three';
import Island from "../island.js";
import {StatePart, ViewPart} from '../modelView.js';
import Room from "../room/roomModel.js";
import ChildrenPart, { ChildEvents } from '../stateParts/children.js';
import BouncingSpatialPart from '../stateParts/bouncingSpatial.js';
import SpatialPart from '../stateParts/spatial.js';
import TrackSpatial from '../viewParts/trackSpatial.js';
import { BoxView } from "./room1.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** Model for a Bouncing Box */
export class BouncingBox extends StatePart {
    constructor() {
        super();
        this.parts = {spatial: new BouncingSpatialPart()};
    }

    naturalViewClass() { return BoxView; }
}

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

class GroupView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.parts = {
            childrenGroupView: new TrackSpatial(modelState, {
                inner: new ChildrenGroupView()
            })
        };
    }
}

class ChildrenGroupView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.viewsForObjects = {};

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", modelState.id, "children");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", modelState.id, "children");
        this.group = new THREE.Group();
        this.threeObj = this.group;

        for (const object of modelState.parts.children.children) {
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

/** A group that assigns random colors to its children's views */
export class RandomColorGroup extends Group {
    naturalViewClass() { return RandomColorGroupView; }
}

class RandomColorGroupView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.parts = {
            childrenGroupView: new TrackSpatial(modelState, {
                inner: new RandomColorChildrenGroupView(modelState)
            })
        };
    }
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

function initBounce(state) {
    return new Island(state, island => {
        const room = new Room().init({});
        island.set("room", room);

        const bouncingBoxes = new RandomColorGroup().init({ spatial: { scale: {x: 0.5, y: 0.5, z: 0.5 } } });
        room.parts.objects.add(bouncingBoxes);
        for (let i = 0; i < 100; i++) {
            bouncingBoxes.parts.children.add(new BouncingBox().init({ spatial: { scale: {x: 0.3, y: 0.3, z: 0.3 } } }));
        }
    });
}

export default {
    moduleID: module.id,
    creatorFn: initBounce,
};
