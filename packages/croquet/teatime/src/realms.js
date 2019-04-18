import { viewDomain } from "./domain";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


class ModelRealm {
    constructor(island) {
        /** @type import('./island').default */
        this.island = island;
    }
    register(model) {
        return this.island.registerModel(model);
    }
    deregister(model) {
        this.island.deregisterModel(model.id);
    }
    publish(event, data, to) {
        this.island.publishFromModel(to, event, data);
    }
    subscribe(event, modelId, methodName, to) {
        this.island.addSubscription(to, event, modelId, methodName);
    }
    unsubscribe(event, modelId, methodName, to) {
        this.island.removeSubscription(to, event, modelId, methodName);
    }
    unsubscribeAll(id) {
        this.island.removeAllSubscriptionsFor(id);
    }

    futureProxy(tOffset, model) {

        if (__currentRealm && __currentRealm.equal(this)) {
            return this.island.futureProxy(tOffset, model);
        }
        if (tOffset) throw Error("tOffset not supported from cross-realm future send yet.");
        const island = this.island;
        return new Proxy(model, {
            get(_target, property) {
                if (typeof model[property] === "function") {
                    const methodProxy = new Proxy(model[property], {
                        apply(_method, _this, args) {
                            island.callModelMethod(model.id, null, property, args);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(model).constructor.name + " which is not a function");
            }
        });
    }

    callModelMethod(modelId, modelPath, methodName, args) {
        this.island.callModelMethod(modelId, modelPath, methodName, args);
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

    register(_view) {
        return viewDomain.createId();
    }
    deregister(_view) {
    }
    publish(event, data, to) {
        this.island.publishFromView(to, event, data);
    }
    subscribe(event, viewId, methodName, to, oncePerFrame) {
        const handling = oncePerFrame ? "oncePerFrame" : "queued";
        viewDomain.addSubscription(to, event, viewId, methodName, handling);
    }
    unsubscribe(event, viewId, methodName, to) {
        viewDomain.removeSubscription(to, event, viewId, methodName);
    }
    unsubscribeAll(id) {
        viewDomain.removeAllSubscriptionsFor(id);
    }

    futureProxy(tOffset, view) {
        if (!tOffset) {
            return view;
        }
        return new Proxy(view, {
            get(_target, property) {
                if (typeof view[property] === "function") {
                    const methodProxy = new Proxy(view[property], {
                        apply(_method, _this, args) {
                            setTimeout(() => view[property](...args), tOffset);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(view).constructor.name + " which is not a function");
            }
        });
    }

    callModelMethod(modelId, viewPath, methodName, args) {
        this.island.callModelMethod(modelId, viewPath, methodName, args);
    }

    random() {
        return Math.random();
    }

    equal(otherRealm) {
        return otherRealm instanceof ViewRealm && otherRealm.island === this.island;
    }
}

let __currentRealm = null;

/** @returns {ModelRealm | ViewRealm} */
export function currentRealm() {
    if (!__currentRealm) {
        throw Error("Tried to execute code that requires realm outside of realm.");
    }
    return __currentRealm;
}

export function inModelRealm(island, callback) {
    if (__currentRealm !== null) {
        throw Error("Can't switch realms from inside realm");
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
        throw Error("Can't switch realms from inside realm");
    }
    try {
        __currentRealm = new ViewRealm(island);
        callback();
    } finally {
        __currentRealm = null;
    }
}
