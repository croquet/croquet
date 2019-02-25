import * as THREE from 'three';
import SpatialModel from './spatialModel.js';
import View from './view.js';
import ManipulatorView from './manipulatorView.js';

export const RoomEvents = {
    objectAdded: "room-objectAdded",
    objectRemoved: "room-objectRemoved",
    observerJoined: "room-observerJoined",
    observerLeft: "room-observerLeft",
    colorChanged: "room-colorChanged"
};

export class Room extends SpatialModel {
    constructor(island, state={}) {
        super(island, state);
        this.size = state.size || new THREE.Vector3(20, 20, 20);
        this.color = state.color || new THREE.Color("#dddddd");
        /** @type {Set<SpatialModel>} */
        this.objects = new Set();
        this.observers = new Set();
    }

    state(state) {
        super.state(state);
        state.size = this.size;
        state.color = this.color;
    }

    addObject(object) {
        this.objects.add(object);
        this.publish(RoomEvents.objectAdded, object);
    }

    removeObject(object) {
        this.objects.add(object);
        this.publish(RoomEvents.objectRemoved, object);
    }

    addObserver(observer) {
        this.observers.add(observer);
        this.publish(RoomEvents.observerJoined, observer);
    }

    removeObserver(observer) {
        this.observers.remove(observer);
        this.publish(RoomEvents.observerLeft, observer);
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

        for (let object of room.objects) {
            this.onObjectAdded(object);
        }

        this.subscribe(room.id, RoomEvents.objectAdded, "onObjectAdded");
        this.subscribe(room.id, RoomEvents.objectRemoved, "onObjectRemoved");

        for (let observer of room.observers) {
            this.onObserverJoined(observer);
        }

        this.subscribe(room.id, RoomEvents.observerJoined, "onObserverJoined");
        this.subscribe(room.id, RoomEvents.observerLeft, "onObserverLeft");
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
