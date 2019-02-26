import hotreload from "./hotreload.js";
import Component, { ComponentOwner } from "./component.js";

export const ModelEvents = {
    constructed: "model-constructed",
    destroyed: "model-destroyed"
};

let ModelConstructors = {};

/** @extends {ComponentOwner<ModelComponent>} */
export default class Model extends ComponentOwner {
    static isTeaTimeModel() { return true; }

    // LIFECYCLE
    /** @arg {import('./islandReplica').default} island */
    /** @arg {Object} state */
    constructor(island, state={}) {
        super();
        this.island = island;
        this.id = island.registerModel(this, state.id);
    }

    /** second init pass: wire up objects */
    /** @arg {Object} state */
    /** @arg {Object} objectsByID */
    restoreObjectReferences(state, objectsByID) {
        for (let componentName of Object.keys(this.components)) {
            this.components[componentName].restoreObjectReferences(state[componentName], objectsByID);
        }
    }

    destroy() {
        this.island.deregisterModel(this.id);
    }

    // STATE
    toState(state) {
        state.constructorName = this.constructor.name;
        state.id = this.id;
        for (let componentName of Object.keys(this.components)) {
            state[componentName] = {};
            this.components[componentName].toState(state[componentName]);
        }
    }

    static fromState(island, state) {
        const Constructor = ModelConstructors[state.constructorName];
        if (Constructor) return new Constructor(island, state);

        // HACK: go through all exports and find model subclasses
        for (let m of Object.values(module.bundle.cache)) {
            for (let [key, value] of Object.entries(m.exports)) {
                if (value.isTeaTimeModel) {
                    const name = key === "default" ? value.name : key;
                    ModelConstructors[name] = value;
                }
            }
        }
        if (ModelConstructors[state.constructorName]) {
            return this.fromState(island, state);
        }
        throw new Error(`Class "${state.constructorName}" not found, is it exported?`);
    }

    static dispose() {
        ModelConstructors = {};
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(_viewContext) {}
}

/** @extends {Component<Model>} */
export class ModelComponent extends Component {
    /** second init pass: wire up objects */
    /** @arg {Object} _state */
    /** @arg {Object} _objectsByID */
    restoreObjectReferences(_state, _objectsByID) {}

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, component=this.componentName) {
        const fullScope = scope + (component ? "." + component : "");
        this.owner.island.addModelSubscription(fullScope, event, this.owner.id, this.componentName, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, component=this.componentName) {
        const fullScope = scope + (component ? "." + component : "");
        this.owner.island.removeModelSubscription(fullScope, event, this.owner.id, this.componentName, methodName);
    }

    publish(event, data, tOffset=0, scope=this.owner.id, component=this.componentName) {
        const fullScope = scope + (component ? "." + component : "");
        this.owner.island.publishFromModel(fullScope, event, data, tOffset);
    }

    // FUTURE
    future(tOffset=0) {
        return new Proxy(this, {
            get(target, property) {
                if (typeof target[property] === "function") {
                    const methodProxy = new Proxy(target[property], {
                        apply(targetMethod, _, args) {
                            hotreload.setTimeout(() => {
                                targetMethod.apply(target, args);
                            }, tOffset);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(target).constructor.name + " which is not a function");
            }
        });
    }

    // STATE
    toState(state) {}
};