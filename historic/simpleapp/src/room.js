import * as THREE from 'three';
import View, { ViewPart } from './view.js';
import ManipulatorView from './manipulatorView.js';
import Model from './model.js';
import ChildrenPart, { ChildEvents } from './modelParts/children.js';
import ColorPart from './modelParts/color.js';
import SizePart from './modelParts/size.js';
import Object3DViewPart from './viewParts/object3D.js';
import { ObserverAvatarView } from './observer.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export class Room extends Model {
    buildParts(state={}) {
        new SizePart(this, state);
        new ColorPart(this, state);
        new ChildrenPart(this, state, {partName: "objects"});
        new ChildrenPart(this, state, {partName: "observers"});
    }
}

class RoomScenePart extends Object3DViewPart {
    /** @arg {Room} room */
    attachWithObject3D(room) {
        this.scene = new THREE.Scene();
        this.scene.background = room.parts.color.value;
        this.grid = new THREE.GridHelper(room.parts.size.x, 10, "#888888", "#aaaaaa");
        this.scene.add(this.grid);
        this.light = new THREE.DirectionalLight("#ffffdd");
        this.light.position.set(1, 2, -1);
        this.scene.add(this.light);
        this.ambientLight = new THREE.HemisphereLight("#ddddff", "#ffdddd");
        this.scene.add(this.ambientLight);
        return this.scene;
    }
}

class RoomObjectManagerPart extends ViewPart {
    /** @arg {Room} room */
    attach(room) {
        this.viewsForObjects = {};

        for (let object of room.parts.objects.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", room.id, "objects");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", room.id, "objects");
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const innerView = new NaturalView(this.owner.island);
        const view = new ManipulatorView(this.owner.island, {wrappedView: innerView});
        this.viewsForObjects[object.id] = view;
        view.attach(object);
        view.addToThreeParent(this.owner.parts.scene.scene);
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        view.removeFromThreeParent(this.owner.parts.scene.scene);
        view.onDetach();
        delete this.viewsForObjects[object.id];
    }
}

class RoomObserverManagerPart extends ViewPart {
    constructor(owner, options) {
        super(owner, {partName: "observerManager", ...options});
        this.localObserver = options.localObserver;
    }

    /** @arg {Room} room */
    attach(room) {
        this.viewsForObservers = {};

        for (let observer of room.parts.observers.children) {
            this.onObserverJoined(observer);
        }

        this.subscribe(ChildEvents.childAdded, "onObserverJoined", room.id, "observers");
        this.subscribe(ChildEvents.childRemoved, "onObserverLeft", room.id, "observers");
    }

    onObserverJoined(observer) {
        if (observer === this.localObserver) return;
        const view = new ObserverAvatarView(observer.id, this.owner.island);
        view.attach(observer);
        this.viewsForObservers[observer.id] = view;
        this.scene.add(view.threeObj);
    }

    onObserverLeft(observer) {
        if (observer === this.localObserver) return;
        const view = this.viewsForObservers[observer.id];
        this.scene.remove(view.threeObj);
        view.onDetach();
        delete this.viewsForObjects[observer.id];
    }
}

export class RoomView extends View {
    buildParts({localObserver}) {
        new RoomScenePart(this, {partName: "scene"});
        new RoomObjectManagerPart(this, {partName: "objectManager"});
        new RoomObserverManagerPart(this, {localObserver, partName: "oberserverManager"});
    }
}
