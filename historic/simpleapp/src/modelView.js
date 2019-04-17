import Part, { PART_PATH_SEPARATOR } from "./parts";
import hotreload from "./hotreload";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** @typedef {import('./parts.js').PartPath} PartPath */

// TODO: The current flow of initialising, registering, restoring
//       of StateParts, distinguishing between top-level and sub-parts
//       works, but feels unnecessarily messy. There seems to be a lot
//       of redundant and almost-the-same methods in here...

// TODO: This all also tends to assume a static sub-part composition of parts.
//       To truly support user-created objects, we should be able to restore from
//       state and register properly parts that consist of spontaneously composed parts

/** @extends {Part<StatePart>} */
export class StatePart extends Part {
    // mark this and subclasses as model classes
    // used in island.js:modelFromState
    static __isTeatimeModelClass__() { return true; }

    register(state={}, isTopLevel) {
        this.realm = currentRealm();
        if (isTopLevel) {
            this.id = currentRealm().registerTopLevelPart(this, state.id);
        } else {
            this.id = state.id;
        }
    }

    registerRecursively(state={}, isTopLevel) {
        this.register(state, isTopLevel);
        for (const [partName, part] of Object.entries(this.parts)) {
            part.registerRecursively({id: this.id + PART_PATH_SEPARATOR + partName}, false);
        }
    }

    // first time init at top level (after manual construction)
    // TODO: the default setting to true is potentially dangerous, see above for maybe a complete simplification
    init(state, isTopLevel=true) {
        this.register(state, isTopLevel);
        for (const [partName, part] of Object.entries(this.parts)) {
            part.init({...state[partName], id: this.id + PART_PATH_SEPARATOR + partName}, false);
        }
        this.applyState(state);
        this.onInitialized(true);
        return this;
    }

    restore(stateToRestore, topLevelPartsById) {
        this.applyStateRecursively(stateToRestore, topLevelPartsById);
    }

    restoreDone() {
        for (const part of Object.values(this.parts)) {
            part.restoreDone();
        }
        this.onInitialized(false);
    }

    /** @abstract */
    onInitialized(_wasFirstInit) {}

    destroy() {
        for (const part of Object.values(this.parts)) {
            part.destroy();
        }
        this.realm.unsubscribeAll(this.id);
        this.realm.deregisterTopLevelPart(this);
    }

    /** @abstract */
    static constructFromState(state) {
        const ModelClass = classFromID(state.class);
        return new ModelClass();
    }

    applyState(_state, _topLevelPartsById) {}

    applyStateRecursively(state, topLevelPartsById) {
        this.applyState(state, topLevelPartsById);
        for (const [partName, part] of Object.entries(this.parts)) {
            part.applyStateRecursively(state[partName], topLevelPartsById);
        }
    }

    toState(state) {
        // TODO: weird way to check whether this is a top level component
        if (!this.id.includes(PART_PATH_SEPARATOR)) {
            state.id = this.id;
        }

        state.class = classToID(this.constructor);

        for (const [partName, part] of Object.entries(this.parts)) {
            if (!state[partName]) state[partName] = {};
            part.toState(state[partName]);
        }
    }

    // PUB/SUB
    subscribe(event, methodName, to=this.id) {
        if (!this.id) {throw new Error("Cant subscribe before StatePart is registered. Please do so in onInitialized()");}
        this.realm.subscribe(event, this.id, methodName, to);
    }

    unsubscribe(event, methodName, to=this.id) {
        if (!this.id) {throw new Error("Cant unsubscribe before StatePart is registered. Please do so in onInitialized()");}
        this.realm.unsubscribe(event, this.id, methodName, to);
    }

    publish(event, data, to=this.id) {
        if (!this.id) {throw new Error("Cant publish before StatePart is registered. Please do so in onInitialized()");}
        this.realm.publish(event, data, to);
    }

    // FUTURE
    /** @returns {this} */
    future(tOffset=0) {
        return this.realm.futureProxy(tOffset, this);
    }

    // for setting type of arguments in future messages
    ensure(object, cls) {
        if (object instanceof cls) return;
        Object.setPrototypeOf(object, cls.prototype);
    }

    ensureMutationAllowed() {
        if (!currentRealm().equal(this.realm)) {
            throw new Error(
`Trying to mutate StatePart from outside its realm.
Most likely this means that you're trying to mutate a Model part from a View directly.
Use part.future().method() to send a method call through the reflector`
            );
        }
    }

    /** @abstract */
    naturalViewClass(_viewContext) { }
}

/** @typedef {import("./parts.js").PartPath} PartPath */
/** @typedef {PartPath | {fromModel: PartPath}} ViewPartPath */

/** @extends {Part<ViewPart>} */
export class ViewPart extends Part {
    /** @abstract */
    constructor() {
        super();

        this.realm = currentRealm();
        this.id = currentRealm().registerTopLevelPart(this);

        /** @type {import('THREE').Object3D | null} */
        this.threeObj = null;
    }

    /** @returns {import('THREE').Object3D[]} */
    threeObjs() {
        if (this.threeObj) {
            return [this.threeObj];
        }

        const threeObjs = [];
        for (const part of Object.values(this.parts)) {
            if (part instanceof ViewPart) {
                threeObjs.push(...part.threeObjs());
            }
        }
        return threeObjs;
    }

    detach() {
        this.realm.unsubscribeAll(this.id);
        this.superDetachedCalled = true;

        for (const partId of Object.keys(this.parts)) {
            this.parts[partId].detach();
            if (!this.parts[partId].superDetachedCalled) {
                throw new Error("super.detach() wasn't called by " + Object.prototype(this.parts[partId]).constructor.name + ".detach()");
            }
        }

        this.realm.deregisterTopLevelPart(this);
    }

    // PUB/SUB
    subscribe(event, methodName, to=this.id, oncePerFrame=false) {
        this.realm.subscribe(event, this.id, methodName, to, oncePerFrame);
    }

    unsubscribe(event, methodName, to=this.id) {
        this.realm.unsubscribe(event, this.id, methodName, to);
    }

    publish(event, data, to=this.id) {
        this.realm.publish(event, data, to);
    }

    /** @returns {this} */
    future(tOffset) {
        return this.realm.futureProxy(tOffset, this);
    }
}

/// REALMS

class ModelRealm {
    constructor(island) {
        /** @type import('./island').default */
        this.island = island;
    }
    registerTopLevelPart(part, existingId) {
        return this.island.registerModel(part, existingId);
    }
    deregisterTopLevelPart(part) {
        this.island.deregisterModel(part.id);
    }
    publish(event, data, to) {
        this.island.publishFromModel(to, event, data);
    }
    subscribe(event, partId, methodName, to) {
        this.island.addModelSubscription(to, event, partId, methodName);
    }
    unsubscribe(event, partId, methodName, to) {
        this.island.removeModelSubscription(to, event, partId, methodName);
    }
    unsubscribeAll(id) {
        this.island.removeAllModelSubscriptionsFor(id);
    }

    futureProxy(tOffset, part) {

        if (__currentRealm && __currentRealm.equal(this)) {
            return this.island.futureProxy(tOffset, part);
        }
        if (tOffset) throw new Error("tOffset not supported from cross-realm future send yet.");
        const island = this.island;
        return new Proxy(part, {
            get(_target, property) {
                if (typeof part[property] === "function") {
                    const methodProxy = new Proxy(part[property], {
                        apply(_method, _this, args) {
                            island.callModelMethod(part.id, null, property, args);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(part).constructor.name + " which is not a function");
            }
        });
    }

    callModelMethod(modelId, partPath, methodName, args) {
        this.island.callModelMethod(modelId, partPath, methodName, args);
    }

    random() {
        return this.island.random();
    }

    equal(otherRealm) {
        return otherRealm instanceof ModelRealm && otherRealm.island === this.island;
    }
}

class ViewRealm {
    constructor(island) {
        /** @type import('./island').default */
        this.island = island;
    }

    registerTopLevelPart(part) {
        return this.island.registerView(part);
    }
    deregisterTopLevelPart(part) {
        this.island.deregisterView(part.id);
    }
    publish(event, data, to) {
        this.island.publishFromView(to, event, data);
    }
    subscribe(event, partId, methodName, to, oncePerFrame) {
        this.island.addViewSubscription(to, event, partId, methodName, oncePerFrame);
    }
    unsubscribe(event, partId, methodName, to) {
        this.island.removeViewSubscription(to, event, partId, methodName);
    }
    unsubscribeAll(id) {
        this.island.removeAllViewSubscriptionsFor(id);
    }

    futureProxy(tOffset, part) {
        if (!tOffset) {
            return part;
        }
        return new Proxy(part, {
            get(_target, property) {
                if (typeof part[property] === "function") {
                    const methodProxy = new Proxy(part[property], {
                        apply(_method, _this, args) {
                            setTimeout(() => part[property](...args), tOffset);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(part).constructor.name + " which is not a function");
            }
        });
    }

    callModelMethod(modelId, partPath, methodName, args) {
        this.island.callModelMethod(modelId, partPath, methodName, args);
    }

    random() {
        return this.island.random();
    }

    equal(otherRealm) {
        return otherRealm instanceof ViewRealm && otherRealm.island === this.island;
    }
}

let __currentRealm = null;

/** @returns {ModelRealm | ViewRealm} */
export function currentRealm() {
    if (!__currentRealm) {
        throw new Error("Tried to execute code that requires realm outside of realm.");
    }
    return __currentRealm;
}

export function inModelRealm(island, callback) {
    if (__currentRealm !== null) {
        throw new Error("Can't switch realms from inside realm");
    }
    try {
        __currentRealm = new ModelRealm(island);
        callback();
    } finally {
        __currentRealm = null;
    }
}

export function inViewRealm(island, callback) {
    if (__currentRealm !== null) {
        throw new Error("Can't switch realms from inside realm");
    }
    try {
        __currentRealm = new ViewRealm(island);
        callback();
    } finally {
        __currentRealm = null;
    }
}

/// MODEL CLASS LOADING

// map model class names to model classes
let ModelClasses = {};

// Symbol for storing class ID in constructors
const CLASS_ID = Symbol('CLASS_ID');

function gatherModelClasses() {
    // HACK: go through all exports and find model subclasses
    ModelClasses = {};
    for (const [file, m] of Object.entries(module.bundle.cache)) {
        for (const cls of Object.values(m.exports)) {
            if (cls && cls.__isTeatimeModelClass__) {
                // create a classID for this class
                const id = `${file}:${cls.name}`;
                const dupe = ModelClasses[id];
                if (dupe) throw Error(`Duplicate Model subclass "${id}" in ${file} and ${dupe.file}`);
                ModelClasses[id] = {cls, file};
                cls[CLASS_ID] = id;
            }
        }
    }
}

function classToID(cls) {
    if (cls[CLASS_ID]) return cls[CLASS_ID];
    gatherModelClasses();
    if (cls[CLASS_ID]) return cls[CLASS_ID];
    throw Error(`Class "${cls.name}" not found, is it exported?`);
}

function classFromID(classID) {
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    gatherModelClasses();
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    throw Error(`Class "${classID}" not found, is it exported?`);
}

// flush ModelClasses after hot reload
hotreload.addDisposeHandler(module.id, () => ModelClasses = {});
