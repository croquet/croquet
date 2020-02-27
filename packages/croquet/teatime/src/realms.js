import urlOptions from "@croquet/util/urlOptions";
import { viewDomain } from "./domain";


let DEBUG = {
    get subscribe() {
        // replace with static value on first call
        DEBUG = { subscribe: urlOptions.has("debug", "subscribe", false) };
        return DEBUG.subscribe;
    }
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
    publish(event, data, scope, isInterIsland) {
        this.island.publishFromModel(scope, event, data, isInterIsland);
    }
    subscribe(model, scope, event, methodName) {
        if (DEBUG.subscribe) console.log(`Model.subscribe(${scope}:${event}) ${model} ${methodName}`);
        return this.island.addSubscription(model, scope, event, methodName);
    }
    unsubscribe(model, scope, event, methodName='*') {
        if (DEBUG.subscribe) console.log(`Model.unsubscribe(${scope}:${event}) ${model}`);
        this.island.removeSubscription(model, scope, event, methodName);
    }
    unsubscribeAll(model) {
        if (DEBUG.subscribe) console.log(`View.unsubscribeAll(${model}`);
        this.island.removeAllSubscriptionsFor(model);
    }

    future(model, tOffset, methodName, methodArgs) {
        if (__currentRealm && __currentRealm.equal(this)) {
            return this.island.future(model, tOffset, methodName, methodArgs);
        }
        if (tOffset) throw Error("tOffset not supported from cross-realm future send yet.");
        const island = this.island;
        return new Proxy(model, {
            get(_target, property) {
                if (typeof model[property] === "function") {
                    const methodProxy = new Proxy(model[property], {
                        apply(_method, _this, args) {
                            island.callModelMethod(model.id, property, args);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(model).constructor.name + " which is not a function");
            }
        });
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
    subscribe(event, viewId, callback, scope, handling="queued") {
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

    future(view, tOffset) {
        if (!tOffset) {
            return view;
        }
        return new Proxy(view, {
            get(_target, property) {
                if (typeof view[property] === "function") {
                    const methodProxy = new Proxy(view[property], {
                        apply(_method, _this, args) {
                            setTimeout(() => { if (view.id) view[property](...args); }, tOffset);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(view).constructor.name + " which is not a function");
            }
        });
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

    isSynced() {
        return !!this.island.controller.synced;
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

export function inViewRealm(island, callback, force=false) {
    if (__currentRealm !== null && !force) {
        throw Error("Can't switch realms from inside realm");
    }
    const prevRealm = __currentRealm;
    try {
        __currentRealm = new ViewRealm(island);
        return callback();
    } finally {
        __currentRealm = prevRealm;
    }
}
