import Part from "./parts.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** @typedef {import('./parts.js').PartPath} PartPath */

/** @extends {Part<StatePart>} */
export class StatePart extends Part {
    // mark this and subclasses as model classes
    // used in island.js:modelFromState
    static __isTeatimeModelClass__() { return true; }

    register(state={}) {
        this.realm = currentRealm();
        this.id = currentRealm().registerPart(this, state.id);
    }

    // first time init (after manual construction)
    init(state) {
        this.register(state);
        for (const [partName, part] of Object.entries(this.parts)) {
            part.init(state[partName] || {});
        }
        this.applyState(state);
        this.onInitialized(true);
        return this;
    }

    restore(stateToRestore, objectsByID) {
        this.applyStateRecursively(stateToRestore, objectsByID);
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
        this.realm.deregisterPart(this);
    }

    /** @abstract */
    applyState(_state, _objectsByID) {}

    applyStateRecursively(state, objectsByID) {
        this.applyState(state);
        for (const [partName, part] of Object.entries(this.parts)) {
            part.applyStateRecursively(state[partName], objectsByID);
        }
    }

    toState(state) {
        for (const [partName, part] of Object.entries(this.parts)) {
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
    future(tOffset=0) {
        return this.realm.futureProxy(tOffset, this);
    }

    // for setting type of arguments in future messages
    ensure(object, cls) {
        if (object instanceof cls) return;
        Object.setPrototypeOf(object, cls.prototype);
    }

    /** @abstract */
    naturalViewClass(_viewContext) { }
}

/** @typedef {import("./parts.js").PartPath} PartPath */
/** @typedef {PartPath | {fromModel: PartPath}} ViewPartPath */

/** @extends {Part<ViewPart>} */
export class ViewPart extends Part {
    /** @abstract */
    constructor(modelState, _options={}) {
        super();

        this.realm = currentRealm();
        this.id = currentRealm().registerPart(this);

        this.modelId = modelState.id;
        // if we are being passed the viewState of another ViewPart as a modelState
        // store a reference to it directly, so we can manipulate it directly
        // (as opposed to true modelStates, which are manipulated through proxies).
        // Also see the modelPart method
        if (modelState.isViewState) {
            this.viewStateThatActsAsModelState = modelState;
        }
        /** @type {import('THREE').Object3D | null} */
        this.threeObj = null;
        this.viewState = new StatePart();
        this.viewState.register();
        this.viewState.isViewState = true;
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
        this.owner.island.removeAllViewSubscriptionsFor(this.id);
        this.superDetachedCalled = true;

        for (const partId of Object.keys(this.parts)) {
            this.parts[partId].detach();
            if (!this.parts[partId].superDetachedCalled) {
                throw new Error("super.detach() wasn't called by " + Object.prototype(this.parts[partId]).constructor.name + ".detach()");
            }
        }

        this.viewState.destroy();
        this.realm.deregisterPart(this);
    }

    // PUB/SUB
    subscribe(event, methodName, to=this.id) {
        this.realm.subscribe(event, this.id, methodName, to);
    }

    unsubscribe(event, methodName, to=this.id) {
        this.realm.unsubscribe(event, this.id, methodName, to);
    }

    publish(event, data, to=this.id) {
        this.realm.publish(event, data, to);
    }

    /** @arg {PartPath}  */
    modelPart(partPath=null) {
        if (this.viewStateThatActsAsModelState) {
            return this.viewStateThatActsAsModelState.lookUp(partPath);
        }
        return new Proxy({}, {
            get: (_, methodName) => {
                const partMethodProxy = new Proxy(() => {}, {
                    apply: (_a, _b, args) => {
                        this.realm.callModelMethod(this.modelId, partPath, methodName, args);
                    }
                });
                return partMethodProxy;
            }
        });
    }

    future(tOffset) {
        return this.realm.futureProxy(tOffset, this);
    }
}

class ModelRealm {
    constructor(island) {
        this.island = island;
    }
    registerPart(part, existingId) {
        return this.island.registerModel(part, existingId);
    }
    deregisterPart(part) {
        this.island.deregisterModel(part.id);
    }
    /** @abstract */
    publish(event, data, to) {
        this.island.publishFromModel(to, event, data);
    }
    /** @abstract */
    subscribe(event, partId, methodName, to) {
        this.island.addModelSubscription(to, event, partId, methodName);
    }
    /** @abstract */
    unsubscribe(event, partId, methodName, to) {
        this.island.removeModelSubscription(to, event, partId, methodName);
    }

    futureProxy(tOffset, part) {
        return this.island.futureProxy(tOffset, part);
    }

    callModelMethod(modelId, partPath, methodName, args) {
        this.island.callModelMethod(modelId, partPath, methodName, args);
    }

    random() {
        this.island.random();
    }
}

class ViewRealm {
    constructor(island) {
        this.island = island;
    }

    registerPart(part) {
        return this.island.registerView(part);
    }
    deregisterPart(part) {
        this.island.deregisterView(part.id);
    }
    /** @abstract */
    publish(event, data, to) {
        this.island.publishFromView(to, event, data);
    }
    /** @abstract */
    subscribe(event, partId, methodName, to) {
        this.island.addViewSubscription(to, event, partId, methodName);
    }
    /** @abstract */
    unsubscribe(event, partId, methodName, to) {
        this.island.removeViewSubscription(to, event, partId, methodName);
    }

    futureProxy(tOffset, part) {
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
        this.island.random();
    }
}

let __currentRealm = null;

/** @returns {ModelRealm | ViewRealm} */
export function currentRealm() {
    if (!currentRealm) {
        throw new Error("Tried to execute code that requires realm outside of realm.");
    }
    return __currentRealm;
}

export function inModelRealm(island, callback) {
    if (__currentRealm !== null) {
        throw new Error("Can't switch realms from inside realm");
    }
    __currentRealm = new ModelRealm(island);
    callback();
    __currentRealm = null;
}

export function inViewRealm(island, callback) {
    if (__currentRealm !== null) {
        throw new Error("Can't switch realms from inside realm");
    }
    __currentRealm = new ViewRealm(island);
    callback();
    __currentRealm = null;
}
