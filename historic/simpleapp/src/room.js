import * as THREE from 'three';
import SpatialComponent from './spatialComponent.js';
import View from './view.js';
import ManipulatorView from './manipulatorView.js';
import Model from './model';
import ModelChildrenComponent, { ChildEvents } from './modelChildrenComponent.js';

export const RoomEvents = {
    colorChanged: "room-colorChanged"
};

export class Room extends Model {
    constructor(island, state={}) {
        super(island, state);
        this.size = state.size || new THREE.Vector3(20, 20, 20);
        this.color = state.color || new THREE.Color("#dddddd");
        this.objects = new ModelChildrenComponent(this, "objects");
        this.observers = new ModelChildrenComponent(this, "observers");
    }

    toState(state) {
        super.toState(state);
        state.size = this.size;
        state.color = this.color;
    }

    changeColor(newColor) {
        this.color.copy(newColor);
        this.publish(RoomEvents.colorChanged, newColor);
    }
}

export class RoomView extends View {
    constructor(island, localObserver) {
        super(island);
        this.viewsForObjects = {};
        this.viewsForObservers = {};
        this.scene = new THREE.Scene();
        this.localObserver = localObserver;
    }

    /** @arg {Room} room */
    attach(room) {
        this.scene.background = room.color;
        this.grid = new THREE.GridHelper(room.size.x, 10, "#888888", "#aaaaaa");
        this.scene.add(this.grid);
        this.light = new THREE.DirectionalLight("#ffffdd");
        this.light.position.set(1, 2, -1);
        this.scene.add(this.light);
        this.ambientLight = new THREE.HemisphereLight("#ddddff", "#ffdddd");
        this.scene.add(this.ambientLight);

        for (let object of room.objects.children) {
            this.onObjectAdded(object);
        }

        this.subscribe(ChildEvents.childAdded, "onObjectAdded", room.id + ".objects");
        this.subscribe(ChildEvents.childRemoved, "onObjectRemoved", room.id + ".objects");

        for (let observer of room.observers.children) {
            this.onObserverJoined(observer);
        }

        this.subscribe(ChildEvents.childAdded, "onObserverJoined", room.id + '.observers');
        this.subscribe(ChildEvents.childRemoved, "onObserverLeft", room.id + '.observers');
    }

    detach() {
        for (let view of Object.values(this.viewsForObjects)) view.detach();
        for (let view of Object.values(this.viewsForObservers)) view.detach();
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const innerView = new NaturalView(this.island);
        const view = new ManipulatorView(this.island, innerView);
        this.viewsForObjects[object.id] = view;
        view.attach(object);
        if (view.addToThreeParent) view.addToThreeParent(this.scene);
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        if (view.removeFromThreeParent) view.removeFromThreeParent(this.scene);
        view.onDetach();
        delete this.viewsForObjects[object.id];
    }

    onObserverJoined(observer) {
        if (observer === this.localObserver) return;
        const view = new ObserverAvatarView(observer.id, this.island);
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
