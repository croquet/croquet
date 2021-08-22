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
        this.vm = island;
    }
    register(model) {
        return this.vm.registerModel(model);
    }
    deregister(model) {
        this.vm.deregisterModel(model.id);
    }
    publish(event, data, scope) {
        this.vm.publishFromModel(scope, event, data);
    }
    subscribe(model, scope, event, methodName) {
        if (DEBUG.subscribe) console.log(`Model.subscribe("${scope}:${event}", ${model} ${(""+methodName).replace(/\([\s\S]*/, '')})`);
        return this.vm.addSubscription(model, scope, event, methodName);
    }
    unsubscribe(model, scope, event, methodName='*') {
        if (DEBUG.subscribe) console.log(`Model.unsubscribe(${scope}:${event}", ${model} ${(""+methodName).replace(/\([\s\S]*/, '')})`);
        this.vm.removeSubscription(model, scope, event, methodName);
    }
    unsubscribeAll(model) {
        if (DEBUG.subscribe) console.log(`Model.unsubscribeAll(${model} ${model.id})`);
        this.vm.removeAllSubscriptionsFor(model);
    }

    future(model, tOffset, methodName, methodArgs) {
        if (__currentRealm && __currentRealm.equal(this)) {
            return this.vm.future(model, tOffset, methodName, methodArgs);
        }
        if (tOffset) throw Error("tOffset not supported from cross-realm future send yet.");
        const island = this.vm;
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
        return this.vm.random();
    }

    now() {
        return this.vm.time;
    }

    equal(otherRealm) {
        return otherRealm instanceof ModelRealm && otherRealm.vm === this.vm;
    }

    isViewRealm() { return false; }
}

class ViewRealm {
    constructor(island) {
        /** @type import('./island').default */
        this.vm = island;
    }

    register(view) {
        return viewDomain.register(view);
    }

    deregister(view) {
        viewDomain.deregister(view);
    }

    publish(event, data, scope) {
        this.vm.publishFromView(scope, event, data);
    }
    subscribe(event, viewId, callback, scope, handling="queued") {
        if (DEBUG.subscribe) console.log(`View.subscribe("${scope}:${event}", ${viewId} ${callback.name || (""+callback).replace(/\([\s\S]*/, '')} [${handling}])`);
        viewDomain.addSubscription(scope, event, viewId, callback, handling);
    }
    unsubscribe(event, viewId, callback, scope) {
        if (DEBUG.subscribe) console.log(`View.unsubscribe("${scope}:${event}", ${viewId} ${callback.name || (""+callback).replace(/\([\s\S]*/, '')})`);
        viewDomain.removeSubscription(scope, event, viewId, callback);
    }
    unsubscribeAll(viewId) {
        if (DEBUG.subscribe) console.log(`View.unsubscribeAll(${viewId})`);
        viewDomain.removeAllSubscriptionsFor(viewId);
    }

    future(view, tOffset) {
        const island = this.vm;
        return new Proxy(view, {
            get(_target, property) {
                if (typeof view[property] === "function") {
                    const methodProxy = new Proxy(view[property], {
                        apply(_method, _this, args) {
                            setTimeout(() => { if (view.id) inViewRealm(island, () => view[property](...args), true); }, tOffset);
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
        return this.vm.time;
    }

    externalNow() {
        return this.vm.controller.reflectorTime;
    }

    extrapolatedNow() {
        return this.vm.controller.extrapolatedTime;
    }

    isSynced() {
        return !!this.vm.controller.synced;
    }

    equal(otherRealm) {
        return otherRealm instanceof ViewRealm && otherRealm.vm === this.vm;
    }

    isViewRealm() { return true; }
}

let __currentRealm = null;

/** @returns {ModelRealm | ViewRealm} */
export function currentRealm(errorIfNoRealm="Tried to execute code that requires realm outside of realm.") {
    if (!__currentRealm && errorIfNoRealm) {
        throw Error(errorIfNoRealm);
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
