import * as THREE from 'three';
import View, { ViewPart } from './view.js';
import ManipulatorView from './manipulatorView.js';
import Model from './model.js';
import ModelChildrenPart, { ChildEvents } from './modelParts/modelChildren.js';
import ColorPart from './modelParts/color.js';
import SizePart from './modelParts/size.js';
import Object3DViewPart from './viewParts/object3D.js';
import { ObserverAvatarView } from './observer.js';

export class Room extends Model {
    constructor(state={}) {
        super(state);
        this.size = new SizePart(this, state.size);
        this.color = new ColorPart(this, state.color);
        this.objects = new ModelChildrenPart(this, "objects");
        this.observers = new ModelChildrenPart(this, "observers");
    }
}

class RoomScenePart extends Object3DViewPart {
    /** @arg {Room} room */
    attachWithObject3D(room) {
        this.scene = new THREE.Scene();
        this.scene.background = room.color.value;
        this.grid = new THREE.GridHelper(room.size.x, 10, "#888888", "#aaaaaa");
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

        for (let object of room.objects.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", room.id, "objects");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", room.id, "objects");
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const innerView = new NaturalView(this.owner.island);
        const view = new ManipulatorView(this.owner.island, innerView);
        this.viewsForObjects[object.id] = view;
        view.attach(object);
        view.addToThreeParent(this.owner.scene.scene);
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        view.removeFromThreeParent(this.owner.scene.scene);
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

        for (let observer of room.observers.children) {
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
    constructor(island, localObserver) {
        super(island);
        this.scene = new RoomScenePart(this, {partName: "scene"});
        this.objectManager = new RoomObjectManagerPart(this, {partName: "objectManager"});
        this.observerManager = new RoomObserverManagerPart(this, {localObserver});
    }
}
