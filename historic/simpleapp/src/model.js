import hotreload from "./hotreload.js";
import Part, { PartOwner } from "./parts.js";

export const ModelEvents = {
    constructed: "model-constructed",
    destroyed: "model-destroyed"
};

// map model class names to model classes
let ModelClasses = {};

/** @extends {PartOwner<ModelPart>} */
export default class Model extends PartOwner {
    // mark this and subclasses as model classes
    static __isTeatimeModelClass__() { return true; }

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
        for (let partName of Object.keys(this.parts)) {
            this.parts[partName].restoreObjectReferences(state[partName], objectsByID);
        }
    }

    destroy() {
        this.island.deregisterModel(this.id);
    }

    // STATE
    toState(state) {
        state.className = this.constructor.name;
        state.id = this.id;
        for (let partName of Object.keys(this.parts)) {
            state[partName] = {};
            this.parts[partName].toState(state[partName]);
        }
    }

    static fromState(island, state) {
        const Class = ModelClasses[state.className];
        if (Class) return new Class(island, state);

        // HACK: go through all exports and find model subclasses
        for (let m of Object.values(module.bundle.cache)) {
            for (let cls of Object.values(m.exports)) {
                if (cls.__isTeatimeModelClass__) {
                    ModelClasses[cls.name] = cls;
                }
            }
        }
        if (ModelClasses[state.className]) {
            return this.fromState(island, state);
        }
        throw new Error(`Class "${state.className}" not found, is it exported?`);
    }

    static dispose() {
        ModelClasses = {};
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(_viewContext) { }
}

/** @extends {Part<Model>} */
export class ModelPart extends Part {
    /** second init pass: wire up objects */
    /** @arg {Object} _state */
    /** @arg {Object} _objectsByID */
    restoreObjectReferences(_state, _objectsByID) {}

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, part=this.partName) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.addModelSubscription(fullScope, event, this.owner.id, this.partName, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partName) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.removeModelSubscription(fullScope, event, this.owner.id, this.partName, methodName);
    }

    publish(event, data, tOffset=0, scope=this.owner.id, part=this.partName) {
        const fullScope = scope + (part ? "." + part : "");
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
    toState(_state) { }
}
