import * as THREE from 'three';

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// This is kind of a rough mock of what I expect TeaTime to provide
// plus additional bookeeping "around" an island replica to make uniform
// pub/sub between models and views possible.
class IslandReplica {
    constructor() {
        this.modelsById = {};
        this.viewsById = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
    }

    registerModel(model) {
        const id = uuidv4();
        this.modelsById[id] = model;
        return id;
    }

    deregisterModel(id) {
        delete this.modelsById[id];
    }

    registerView(view) {
        const id = uuidv4();
        this.viewsById[id] = view;
        return id;
    }

    deregisterView(id) {
        delete this.viewsById[id];
    }

    // This will become in-directed via the Reflector
    callModelMethod(modelId, method, tOffset, ...args) {
        if (tOffset) {
            window.setTimeout(() => this.callModelMethod(modelId, method, ...args), tOffset)
        } else {
            const model = this.modelsById[modelId];
            model[method].apply(model, args);
        }
    }

    addModelSubscription(scope, event, subscriberId, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "#" + methodName;
        if (!this.modelSubscriptions[topic]) this.modelSubscriptions[topic] = new Set();
        this.modelSubscriptions[topic].add(handler);
    }

    removeModelSubscription(scope, event, subscriberId, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "#" + methodName;
        this.modelSubscriptions[topic] && this.modelSubscriptions[topic].remove(handler);
    }

    addViewSubscription(scope, event, subscriberId, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "#" + methodName;
        if (!this.viewSubscriptions[topic]) this.viewSubscriptions[topic] = new Set();
        this.viewSubscriptions[topic].add(handler);
    }

    removeViewSubscription(scope, event, subscriberId, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "#" + methodName;
        this.viewSubscriptions[topic] && this.viewSubscriptions[topic].remove(handler);
    }

    publishFromModel(scope, event, data, tOffset) {
        const topic = scope + ":" + event;
        if (this.modelSubscriptions[topic]) {
            for (let handler of this.modelSubscriptions[topic]) {
                const [subscriberId, method] = handler.split("#");
                DummyReflector.call(subscriberId, method, tOffset, data);
            }
        }
        // This is essentially the only part of code inside a model that is not executed bit-identically
        // everywhere, since different view might be subscribed in different island replicas
        if (this.viewSubscriptions[topic]) {
            for (let handler of this.viewSubscriptions[topic]) {
                const [subscriberId, method] = handler.split("#");
                const view = this.viewsById[subscriberId];
                view[method].call(view, data);
            }
        }
    }

    publishFromView(scope, event, data) {
        const topic = scope + ":" + event;
        // Events published by views can only reach other views
        if (this.viewSubscriptions[topic]) {
            for (let handler of modelSubscriptions[topic]) {
                const [subscriberId, method] = handler.split("#");
                const view = this.viewsById[subscriberId];
                view[method].call(view, data);
            }
        }
    }
}

const ModelEvents = {
    destroyed: "model-destroyed"
}

class Model {
    // LIFECYCLE
    /** @arg {IslandReplica} island */
    constructor(island) {
        this.island = island;
        this.id = island.registerModel(this);
    }

    destroy() {
        this.publish(ModelEvents.destroyed);
        this.island.deregisterModel(this.id);
    }

    // FUTURE
    future(tOffset=0) {
        return new Proxy(this, {
            get(target, property) {
                if (typeof target[property] === "function") {
                    const methodProxy = new Proxy(target[property], {
                        apply(targetMethod, _, args) {
                            window.setTimeout(() => {
                                targetMethod.apply(target, args);
                            }, tOffset);
                        }
                    });
                    return methodProxy;
                } else {
                    throw "Tried to call " + property + "() on future of " + Object.getPrototypeOf(target).constructor.name + " which is not a function";
                }
            }
        })
    }

    // PUB/SUB
    subscribe(scope, event, methodName) {
        this.island.addModelSubscription(scope, event, this.id, methodName);
    }

    unsubscribe(scope, event, methodName) {
        this.island.removeModelSubscription(scope, event, this.id, methodName);
    }

    publish(event, data, tOffset=0, scope=this.id) {
        this.island.publishFromModel(scope, event, data, tOffset);
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(viewContext) {}
}

class View {
    // LIFECYCLE
    /** @arg {IslandReplica} island */
    constructor(island) {
        this.island = island;
        this.id = island.registerView(this);
    }

    /** @abstract */
    attach(modelState) {}
    /** @abstract */
    detach() {}

    // PUB/SUB
    subscribe(scope, event, methodName) {
        this.island.addViewSubscription(scope, event, this.id, methodName);
    }

    unsubscribe(scope, event, methodName) {
        this.island.removeViewSubscription(scope, event, this.id, methodName);
    }

    publish(event, data, scope=this.id) {
        this.island.publishFromView(scope, event, data);
    }
}

const SpatialEvents = {
    moved: "spatial-moved",
    rotated: "spatial-rotated"
};

class SpatialModel extends Model {
    constructor(island, position=new THREE.Vector3(0, 0, 0), quaternion=new THREE.Quaternion(), scale=new THREE.Vector3(1, 1, 1)) {
        super(island);
        this.position = position;
        this.quaternion = quaternion;
        this.scale = scale;
    }

    /** @arg {THREE.Vector3} position */
    moveTo(position) {
        this.position.copy(position);
        this.publish(SpatialEvents.moved, this.position.clone());
    }

    /** @arg {THREE.Vector3} delta */
    moveBy(delta) {
        this.position.add(delta);
        this.publish(SpatialEvents.moved, this.position.clone());
    }

    rotateTo(quaternion) {
        this.quaternion.copy(quaternion);
        this.publish(SpatialEvents.rotated, this.quaternion.clone());
    }

    rotateBy(deltaQuaternion) {
        this.quaternion.multiply(deltaQuaternion);
        this.publish(SpatialEvents.rotated, this.quaternion.clone());
    }
}

class Object3DView extends View {
    /** @abstract */
    createThreeObject(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#ff0000")})
        );
    }

    attach(modelState) {
        this.threeObj = this.createThreeObject(modelState);
        this.threeObj.position.copy(modelState.position);
        this.threeObj.quaternion.copy(modelState.quaternion);
        this.threeObj.scale.copy(modelState.scale);

        this.subscribe(modelState.id, SpatialEvents.moved, "onMoved");
        this.subscribe(modelState.id, SpatialEvents.rotated, "onRotated");
    }

    detach() {
        this.unsubscribe(modelState.id. SpatialEvents.moved, "onMoved");
        this.unsubscribe(modelState.id. SpatialEvents.rotated, "onRotated");
        this.dispose();
    }

    /** @abstract */
    dispose() {}

    onMoved(newPosition) {
        this.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.threeObj.quaternion.copy(newQuaternion);
    }
}

const RoomEvents = {
    objectAdded: "room-objectAdded",
    objectRemoved: "room-objectRemoved",
    observerJoined: "room-observerJoined",
    observerLeft: "room-observerLeft",
    colorChanged: "room-colorChanged"
};

class Room extends Model {
    constructor(island, size=new THREE.Vector3(20, 20, 20), color=new THREE.Color("#dddddd")) {
        super(island);
        this.size = size;
        this.color = color;
        /** @type {Set<SpatialModel>} */
        this.objects = new Set();
        this.observers = new Set();
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

class RoomView extends View {
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
        this.grid = new THREE.GridHelper(room.size.x, 10);
        this.scene.add(this.grid);

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
        for (let view of Object.values(this.viewsForObjects)) view.onDetach();
        for (let view of Object.values(this.viewsForObservers)) view.onDetach();
    }

    onObjectAdded(object) {
        const NaturalView = object.naturalViewClass("in-room");
        /** @type {View} */
        const view = new NaturalView(this.island);
        this.viewsForObjects[object.id] = view;
        view.attach(object);
        if (view.threeObj) this.scene.add(view.threeObj);
    }

    onObjectRemoved(object) {
        const view = this.viewsForObjects[object.id];
        if (view.threeObj) this.scene.remove(view.threeObj);
        view.onDetach();
        delete this.viewsForObjects[object.id];
    }

    onObserverJoined(observer) {
        if (observer === this.localObserver) return;
        const view = new ObserverAvatarView(observer.id, island);
        view.attach(observer);
        this.viewsForObservers[observer.id] = view;
        this.scene.add(view.threeObj);
    }

    onObserverLeft(observer) {
        if (observer === this.localObserver) return;
        const view = this.viewsForObservers[observer.id];
        this.scene.remove(view.threeObj);
        view.onDetach();
        delete this.viewsForObjects[object.id];
    }
}

class Observer extends SpatialModel {
    constructor(island, position, quaternion, name) {
        super(island, position, quaternion);
        this.name = name;
    }
};

class ObserverCameraView extends Object3DView {
    constructor(island, width, height) {
        super(island);
        this.width = width;
        this.height = height;
    }

    createThreeObject(_modelState) {
        return new THREE.PerspectiveCamera(75, this.width/this.height, 0.1, 1000);
    }
}

class ObserverAvatarView extends Object3DView {
    // TODO
}

class Box extends SpatialModel {
    doRotation() {
        this.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.1));
        this.future(1000/60).doRotation();
    }

    naturalViewClass() { return BoxView; }
};

class BoxView extends Object3DView {
    createThreeObject(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#888888")})
        );
    }
}

function start() {
    const island = new IslandReplica();

    const room = new Room(island);
    const box = new Box(island);
    box.doRotation();
    room.addObject(box);

    const observer = new Observer(
        island,
        new THREE.Vector3(0, 2, -5),
        (new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
        "Guest1"
    );
    room.addObserver(observer);

    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const roomView = new RoomView(island, observer, window.innerWidth, window.innerHeight);
    roomView.attach(room);

    const observerCameraView = new ObserverCameraView(island, window.innerWidth, window.innerHeight);
    observerCameraView.attach(observer);

    function frame() {
        renderer.render(roomView.scene, observerCameraView.threeObj);
        window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
}

start();