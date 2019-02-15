import * as THREE from 'three';

// Store subscriptions to per-object events in a WeakMap
// so we don't accidentally leak memory by referencing objects in callbacks only
// that are otherwise already completely removed
const Subscribers = new WeakMap();

const HierarchyEvents = {
    addedAsChild: "addedAsChild",
    removedAsChild: "removedAsChild"
};

class CObject {
    constructor() {
        /** Holds all "model" state that will be persisted/distributed in the future */
        this.state = {children: new Set()};
        Subscribers.set(this, {});
    }

    // ACTIONS 
    //   The only place where state shall be modified.
    //   Prefixed with 'act' to distinguish them from normal methods

    /** @arg {CObject} child */
    actAddChild(child) {
        this.state.children.add(child);
        child.publish(HierarchyEvents.addedAsChild, this);
    }

    /** @arg {CObject} child */
    actRemoveChild(child) {
        this.state.children.delete(child);
        child.publish(HierarchyEvents.removedAsChild, this);
    }

    // FUTURE
    //   Allows sending actions to a future self
    future(ms, callback) {
        window.setTimeout(callback, ms);
    }

    // PUBLISH / SUBSCRIBE SYSTEM
    //   CObjects act as a scope for publish/subscribe message passing
    //   Ideally, all inter-object communication should use this mechanism
    //   Subscription callbacks can
    //     - call actions on the *subscribing* object to modify its state
    //     - change view state on the *subscribing* object
    //     - publish new events within the scope of the subscribing object,
    //       or any other scope it knows about

    subscribe(event, listener) {
        if (Subscribers.get(this)[event] === undefined) Subscribers.get(this)[event] = [];
        Subscribers.get(this)[event].push(listener);
    }

    publish(event, data) {
        const callbacks = Subscribers.get(this)[event] || [];
        for (let callback of callbacks) {
            callback(data);
        }
    }
}

const SpatialEvents = {
    moved: "moved",
    rotated: "rotated"
}

class SpatialObject extends CObject {
    constructor(position=new THREE.Vector3(0, 0, 0), quaternion=new THREE.Quaternion(), scale=new THREE.Vector3(1, 1, 1)) {
        super();
        this.state = {position, quaternion, scale, ...this.state};
    }

    // METHODS

    getExtent() {
        return new THREE.Vector3(1, 1, 1);
    }

    // ACTIONS

    /** @arg {THREE.Vector3} position */
    actMoveTo(position) {
        this.state.position.copy(position);
        this.publish("moved", this.state.position.clone());
    }

    /** @arg {THREE.Vector3} delta */
    actMoveBy(delta) {
        this.state.position.add(delta);
        this.publish("moved", this.state.position.clone());
    }

    /** @arg {THREE.Vector3} axis */
    /** @arg {number} angle */
    actRotateTo(quaternion) {
        this.state.quaternion.copy(quaternion);
        this.publish("rotated", this.state.quaternion.clone());
    }

    // RENDERING

    /** Should *read only* from `this.state`,
     *  can modify any other instance variables that represent view state.
     *  @abstract
     *  @arg {ThreeRenderer} renderer
     */
    render(renderer) {}

    /** This only gets called on the top-level object,
     *  override {@link VisualObject#render} to implement */
    renderTree(renderer) {
        this.render(renderer);
        for (let child of this.state.children) {
            child.renderTree(renderer);
        }
    }
}

/** @typedef {{type: "Enter", at: THREE.Vector3, pointer: THREE.Vector3}} PointerEnterEvent */
/** @typedef {{type: "Move", at: THREE.Vector3, pointer: THREE.Vector3}} PointerMoveEvent */
/** @typedef {{type: "Down", from: THREE.Vector3, pointer: THREE.Vector3}} PointerDownEvent */
/** @typedef {{type: "Drag", from: THREE.Vector3, to: THREE.Vector3, pointer: THREE.Vector3}} PointerDragEvent */
/** @typedef {{type: "Up", from: THREE.Vector3, to: THREE.Vector3, pointer: THREE.Vector3}} PointerUpEvent */
/** @typedef {PointerEnterEvent | PointerMoveEvent | PointerDownEvent | PointerDragEvent | PointerUpEvent} PointerEvent */

class VisualObject extends SpatialObject {
    /** @arg {THREE.Object3D} threeObj */
    constructor(threeObj, position=new THREE.Vector3(0, 0, 0), quaternion=new THREE.Quaternion(), scale=new THREE.Vector3(1, 1, 1)) {
        super(position, quaternion, scale);
        this.threeObj = threeObj;
        this.visible = true;
        threeObj.userData.croquetObject = this;
        this.subscribe(HierarchyEvents.addedAsChild, parent => {
            if (parent.getThreeObj) parent.getThreeObj().add(threeObj);
        });
        this.subscribe(HierarchyEvents.removedAsChild, parent => {
            if (parent.getThreeObj) parent.getThreeObj().remove(threeObj);
        });
    }

    // METHODS

    setVisible(visible) {
        this.visible = visible;
    }

    getThreeObj() {
        return this.threeObj;
    }

    /** Override this to dispose any THREE resources that need it.
     *  @abstract */
    dispose() {}

    // RENDERING

    render(_renderer) {
        this.threeObj.visible = this.visible;
        this.threeObj.position.copy(this.state.position);
        this.threeObj.quaternion.copy(this.state.quaternion);
        this.threeObj.scale.copy(this.state.scale);
    }
}

class Room extends VisualObject {
    constructor(size=new THREE.Vector3(20, 20, 20), color=new THREE.Color("#dddddd")) {
        const scene = new THREE.Scene();
        super(scene);
        this.state = {size, color, ...this.state};
        this.scene = scene;
        this.actAddChild(new Floor(size));
    }


    render(renderer) {
        renderer.threeRenderer.setClearColor(this.state.color);
    }
}

class Floor extends VisualObject {
    constructor(size) {
        const grid = new THREE.GridHelper(size.x, size.x, new THREE.Color("#aaaaaa"));
        const plane = new THREE.Mesh(
            new THREE.PlaneBufferGeometry(size.x, size.y, 10, 10),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#cccccc")})
        );
        const gridAndPlane = new THREE.Group();
        gridAndPlane.add(grid);
        gridAndPlane.add(plane);
        super(gridAndPlane);
        this.grid = grid;
        this.plane = plane;
    }

    dispose() {
        this.plane.material.dispose();
        this.plane.geometry.dispose();
    }
}

class Avatar extends SpatialObject {
    constructor() {
        super();
        this.state = {velocity: new THREE.Vector3(0, 0, 0), ...this.state};
    }

    // ACTIONS
    actSetXVelocity(newXVelocity) {
        if (this.state.velocity.length() == 0) this.future(1000/60, () => this.actMoveTick());
        this.state.velocity.x = newXVelocity;
    }

    actSetZVelocity(newZVelocity) {
        if (this.state.velocity.length() == 0) this.future(1000/60, () => this.actMoveTick());
        this.state.velocity.z = newZVelocity;
    }

    actMoveTick() {
        if (this.state.velocity.length() > 0) {
            this.actMoveBy(this.state.velocity.clone().multiplyScalar(1/60));
            this.future(1000/60, () => this.actMoveTick());
        }
    }
}

class Pointer extends VisualObject {
    constructor() {
        
    }
}

class PointerEventManager {
    constructor() {
        this.raycaster = new THREE.Raycaster(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 1),
            0.1,
            1000
        );
        this.hoveredObject = null;
        this.grabbedObject = null;
        this.grabStart = null;
        this.grabProjectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    }

    doRaycast(scene) {
        if (this.grabbedObject) { 

        } else {
            for (let intersection of this.raycaster.intersectObject(scene, true)) {
                const {point, object: threeObj} = intersection;
                const object = threeObj.userData.croquetObject;
    
                if (object) {
    
                }
            }
        }
    }
}

class Box extends VisualObject {
    constructor() {
        const box = new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#ff0000")})
        );
        super(box);
        this.box = box;
    }

    dispose() {
        this.box.material.dispose();
        this.box.geometry.dispose();
    }
}

class Observer extends VisualObject {
    constructor(viewportWidth, viewportHeight) {
        const camera = new THREE.PerspectiveCamera(75, viewportWidth/viewportHeight, 0.1, 1000);
        super(camera);
        this.camera = camera;
    }
}

class ThreeRenderer {
    constructor() {
        this.threeRenderer = new THREE.WebGLRenderer();
        this.threeRenderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.threeRenderer.domElement);
    }
}

function start() {
    const room = new Room();

    const observer = new Observer(window.innerWidth, window.innerHeight);
    const avatar = new Avatar();
    avatar.subscribe(SpatialEvents.moved, newPosition => observer.actMoveTo(newPosition.clone().add(new THREE.Vector3(0, 2, 0))));
    avatar.subscribe(SpatialEvents.rotated, newQuaternion => observer.actRotateTo(newQuaternion));

    room.actAddChild(observer);
    room.actAddChild(avatar);

    const box = new Box();
    room.actAddChild(box);

    avatar.actMoveTo(new THREE.Vector3(0, 0, -5));
    const initialRotation = new THREE.Quaternion();
    initialRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    avatar.actRotateTo(initialRotation);

    const renderer = new ThreeRenderer();

    function frame() {
        room.renderTree(renderer);
        renderer.threeRenderer.render(room.scene, observer.camera);
        window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);

    document.addEventListener("keydown", keyEvent => {
        if (keyEvent.keyCode == '38') { // up arrow
            avatar.actSetZVelocity(0.8);
        } else if (keyEvent.keyCode == '40') { // down arrow
            avatar.actSetZVelocity(-0.8);
        } else if (keyEvent.keyCode == '37') { // left arrow
            avatar.actSetXVelocity(0.8);
        } else if (keyEvent.keyCode == '39') { // right arrow
            avatar.actSetXVelocity(-0.8);
        }
    });

    document.addEventListener("keyup", keyEvent => {
        if (keyEvent.keyCode == '38') { // up arrow
            avatar.actSetZVelocity(0);
        } else if (keyEvent.keyCode == '40') { // down arrow
            avatar.actSetZVelocity(0);
        } else if (keyEvent.keyCode == '37') { // left arrow
            avatar.actSetXVelocity(0);
        } else if (keyEvent.keyCode == '39') { // right arrow
            avatar.actSetXVelocity(0);
        }
    });
}

start();