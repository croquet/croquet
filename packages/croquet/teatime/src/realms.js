import urlOptions from "@croquet/util/urlOptions";
import { viewDomain } from "./domain";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


const DEBUG = {
    subscribe: urlOptions.has("debug", "subscribe", false),
};


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
    publish(event, data, scope) {
        this.island.publishFromModel(scope, event, data);
    }
    subscribe(event, modelId, callback, scope) {
        if (DEBUG.subscribe) console.log(`Model.subscribe(${scope}:${event}) ${modelId} ${callback}`);
        this.island.addSubscription(scope, event, modelId, callback);
    }
    unsubscribe(event, modelId, callback, scope) {
        if (DEBUG.subscribe) console.log(`Model.unsubscribe(${scope}:${event}) ${modelId} ${callback}`);
        this.island.removeSubscription(scope, event, modelId, callback);
    }
    unsubscribeAll(modelId) {
        if (DEBUG.subscribe) console.log(`View.unsubscribeAll(${modelId}`);
        this.island.removeAllSubscriptionsFor(modelId);
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

    now() {
        return this.island.time;
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

    register(view) {
        return viewDomain.register(view);
    }
    deregister(view) {
        viewDomain.deregister(view);
    }
    publish(event, data, scope) {
        this.island.publishFromView(scope, event, data);
    }
    subscribe(event, viewId, callback, scope, oncePerFrame) {
        const handling = oncePerFrame ? "oncePerFrame" : "queued";
        if (DEBUG.subscribe) console.log(`View.subscribe(${scope}:${event}) ${viewId} ${callback} [${handling}]`);
        viewDomain.addSubscription(scope, event, viewId, callback, handling);
    }
    unsubscribe(event, viewId, callback, scope) {
        if (DEBUG.subscribe) console.log(`View.unsubscribe(${scope}:${event}) ${viewId} ${callback}`);
        viewDomain.removeSubscription(scope, event, viewId, callback);
    }
    unsubscribeAll(viewId) {
        if (DEBUG.subscribe) console.log(`View.unsubscribeAll(${viewId})`);
        viewDomain.removeAllSubscriptionsFor(viewId);
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

    now() {
        return this.island.time;
    }

    externalNow() {
        return this.island.controller.time;
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
        return callback();
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
        return callback();
    } finally {
        __currentRealm = null;
    }
}
