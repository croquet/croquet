import SeedRandom from "seedrandom";
import Island from "../island.js";
import Model from '../model.js';
import View from '../view.js';
import Room from "../room/roomModel.js";
import { Object3DGroup } from '../viewParts/object3D.js';
import ChildrenPart, { ChildEvents } from '../stateParts/children.js';
import BouncingSpatialPart from '../stateParts/bouncingSpatial.js';
import SpatialPart from '../stateParts/spatial.js';
import TrackSpatial from '../viewParts/trackSpatial.js';
import { BoxView } from "./room1.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** Model for a Bouncing Box */
export class BouncingBox extends Model {
    buildParts(state) {
        new BouncingSpatialPart(this, state);
    }

    naturalViewClass() { return BoxView; }
}

export class Group extends Model {
    buildParts(state) {
        new SpatialPart(this, state);
        new ChildrenPart(this, state);
    }

    naturalViewClass() { return GroupView; }
}

class GroupView extends View {
    buildParts() {
        new Object3DChildren(this);    // provides 'object3D'
        new TrackSpatial(this);        // affects 'object3D'
    }

}

class Object3DChildren extends Object3DGroup {

    attach(modelState) {
        super.attach(modelState);

        this.viewsForObjects = {};

        for (const object of modelState.parts.children.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", modelState.id, "children");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", modelState.id, "children");
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-group");
        /** @type {View} */
        const view = new NaturalView(this.owner.island);
        this.viewsForObjects[object.id] = view;
        view.attach(object);
        view.addToThreeParent(this.threeObj);
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        view.removeFromThreeParent(this.threeObj);
        view.onDetach();
        delete this.viewsForObjects[object.id];
    }
}

/** A group that assigns random colors to its children's views */
export class RandomColorGroup extends Group {
    naturalViewClass() { return RandomColorGroupView; }
}

class RandomColorGroupView extends GroupView {
    buildParts() {
        new RandomColorChildren(this);
        new TrackSpatial(this);
    }
}

class RandomColorChildren extends Object3DChildren {
    constructor(...args) {
        super(...args);
        this.random = new SeedRandom(this.owner.island.id);
    }

    onObjectAdded(object) {
        super.onObjectAdded(object);
        const view = this.viewsForObjects[object.id];
        const material = view.parts.box.threeObj.material;      // FIXME: hard-coded 'box'
        material.color.setHSL(this.random(), 1, 0.5);
    }
}

function initBounce(state) {
    return new Island(state, () => {
        const room = new Room();

        const bouncingBoxes = new RandomColorGroup({ spatial: { scale: {x: 0.5, y: 0.5, z: 0.5 } } });
        room.parts.objects.add(bouncingBoxes);
        for (let i = 0; i < 100; i++) {
            bouncingBoxes.parts.children.add(new BouncingBox({ spatial: { scale: {x: 0.3, y: 0.3, z: 0.3 } } }));
        }
    });
}

export default {
    moduleID: module.id,
    creatorFn: initBounce,
};
