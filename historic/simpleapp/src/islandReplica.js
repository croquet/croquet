import SeedRandom from "seedrandom";
import Model from "./model.js";
import hotreload from "./hotreload.js";

/** This is kind of a rough mock of what I expect TeaTime to provide
 * plus additional bookeeping "around" an island replica to make
 * uniform pub/sub between models and views possible.*/
export default class IslandReplica {
    constructor(state  = {}) {
        this.modelsById = {};
        this.viewsById = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
        // our synced random stream
        this._random = new SeedRandom(null, {state: state.random || true});
        // create all models
        for (let modelState of state.models || []) {
            Model.fromState(this, modelState);  // registers the model
        }
        // wire up models in second pass
        for (let modelState of state.models || []) {
            const model = this.modelsById[modelState.id];
            model.restoreObjectReferences(modelState, this.modelsById);
        }
    }

    registerModel(model, id) {
        if (!id) id = "M" + this.randomID();
        this.modelsById[id] = model;
        return id;
    }

    deregisterModel(id) {
        delete this.modelsById[id];
    }

    registerView(view) {
        const id = "V" + this.randomID();
        this.viewsById[id] = view;
        return id;
    }

    deregisterView(id) {
        delete this.viewsById[id];
    }

    // This will become in-directed via the Reflector
    callModelMethod(modelId, component, method, args, tOffset = 0) {
        if (tOffset) {
            hotreload.setTimeout(() => this.callModelMethod(modelId, component, method, args), tOffset);
        } else {
            const model = this.modelsById[modelId];
            if (component) {
                model[component][method](...args);
            } else {
                model[method](...args);
            }
        }
    }

    addModelSubscription(scope, event, subscriberId, component, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + component + "." + methodName;
        if (!this.modelSubscriptions[topic]) this.modelSubscriptions[topic] = new Set();
        this.modelSubscriptions[topic].add(handler);
    }

    removeModelSubscription(scope, event, subscriberId, component, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + component + "." + methodName;
        if (this.modelSubscriptions[topic]) this.modelSubscriptions[topic].remove(handler);
    }

    addViewSubscription(scope, event, subscriberId, component, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + component + "." + methodName;
        if (!this.viewSubscriptions[topic]) this.viewSubscriptions[topic] = new Set();
        this.viewSubscriptions[topic].add(handler);
    }

    removeViewSubscription(scope, event, subscriberId, component, methodName) {
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + component + "." + methodName;
        if (this.viewSubscriptions[topic]) this.viewSubscriptions[topic].delete(handler);
    }

    publishFromModel(scope, event, data, tOffset) {
        const topic = scope + ":" + event;
        if (this.modelSubscriptions[topic]) {
            for (let handler of this.modelSubscriptions[topic]) {
                const [subscriberId, component, method] = handler.split(".");
                this.callModelMethod(subscriberId, component, method, [data], tOffset);
            }
        }
        // This is essentially the only part of code inside a model that is not executed bit-identically
        // everywhere, since different view might be subscribed in different island replicas
        if (this.viewSubscriptions[topic]) {
            for (let handler of this.viewSubscriptions[topic]) {
                const [subscriberId, component, method] = handler.split(".");
                const componentInstance = this.viewsById[subscriberId][component];
                componentInstance[method].call(componentInstance, data);
            }
        }
    }

    publishFromView(scope, event, data) {
        const topic = scope + ":" + event;
        // Events published by views can only reach other views
        if (this.viewSubscriptions[topic]) {
            for (let handler of this.viewSubscriptions[topic]) {
                const [subscriberId, component, method] = handler.split(".");
                const componentInstance = this.viewsById[subscriberId][component];
                componentInstance[method].call(componentInstance, data);
            }
        }
    }

    toState() {
        return {
            id: this.id,
            time: this.time,
            random: this._random.state(),
            models: Object.values(this.modelsById).map(model => {
                const state = {};
                model.toState(state);
                if (!state.id) throw Error(`No ID in ${model} - did you call super.toState()?`);
                return state;
            }),
        };
    }

    random() {
        return this._random();
    }

    randomID() {
        let id = '';
        for (let i = 0; i < 4; i++) {
            id += (this._random.int32() >>> 0).toString(16).padStart(8, '0');
        }
        return id;
    }
}
