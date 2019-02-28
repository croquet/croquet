import Part, { PartOwner } from "./parts.js";
import IslandReplica from "./islandReplica.js";

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

    get island() { return IslandReplica.current(); }

    // LIFECYCLE
    /** @arg {Object} state */
    constructor(state={}) {
        super();
        this.id = this.island.registerModel(this, state.id);
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

    static fromState(state) {
        const Class = ModelClasses[state.className];
        if (Class) return new Class(state);

        // HACK: go through all exports and find model subclasses
        for (let m of Object.values(module.bundle.cache)) {
            for (let cls of Object.values(m.exports)) {
                if (cls.__isTeatimeModelClass__) {
                    ModelClasses[cls.name] = cls;
                }
            }
        }
        if (ModelClasses[state.className]) {
            return this.fromState(state);
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
    constructor(owner, fullState, options) {
        super(owner, options);
        this.fromState(fullState[this.partName], options);
    }

    /** @abstract */
    fromState(_state, _options) {}

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
        return this.owner.island.futureProxy(this, tOffset);
    }

    // STATE
    toState(_state) { }
}

/**
 * @param {(model: Model, state: {}, modelOptions: {}) => {}} componentsFromModelOptions
 * @param {typeof View} naturalViewClass
 * @returns {typeof Model} */
export function makeModelClass(componentsFromModelOptions, naturalViewClass) {
    return class extends Model {
        constructor(state, modelOptions={}) {
            super(state);
            componentsFromModelOptions(this, state, modelOptions);
        }

        naturalViewClass() {
            return naturalViewClass;
        }
    };
}
