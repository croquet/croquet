import SeedRandom from "seedrandom";
import Model from "./model.js"

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
            model.init(modelState, this.modelsById);
        }
    }

    registerModel(model, id) {
        if (!id) id = this.randomID();
        this.modelsById[id] = model;
        return id;
    }

    deregisterModel(id) {
        delete this.modelsById[id];
    }

    registerView(view) {
        const id = this.randomID();
        this.viewsById[id] = view;
        return id;
    }

    deregisterView(id) {
        delete this.viewsById[id];
    }

    // This will become in-directed via the Reflector
    callModelMethod(modelId, method, args, tOffset = 0) {
        if (tOffset) {
            window.setTimeout(() => this.callModelMethod(modelId, method, args), tOffset);
        } else {
            const model = this.modelsById[modelId];
            model[method](...args);
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
        if (this.modelSubscriptions[topic]) this.modelSubscriptions[topic].remove(handler);
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
        if (this.viewSubscriptions[topic]) this.viewSubscriptions[topic].delete(handler);
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
            for (let handler of this.viewSubscriptions[topic]) {
                const [subscriberId, method] = handler.split("#");
                const view = this.viewsById[subscriberId];
                view[method].call(view, data);
            }
        }
    }

    state() {
        return {
            id: this.id,
            time: this.time,
            random: this._random.state(),
            models: Object.values(this.modelsById).map(model => {
                const state = {};
                model.state(state);
                if (!state.id) throw Error(`No ID in ${model} - did you call super.state()?`);
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
