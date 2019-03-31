import { PartOwner } from "./parts.js";
import Island from "./island.js";
import hotreload from "./hotreload.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const ModelEvents = {
    constructed: "model-constructed",
    destroyed: "model-destroyed"
};

/** @typedef {import('./statePart').default} StatePart */

/** @extends {PartOwner<StatePart>} */
export default class Model extends PartOwner {
    // mark this and subclasses as model classes
    // used in island.js:modelFromState
    static __isTeatimeModelClass__() { return true; }

    /** @returns {Island} */
    get island() { return Island.current(); }

    // LIFECYCLE
    /** @arg {Object} state */
    constructor(state={}, modelOptions={}) {
        super();
        if (!this.island) throw Error("We probably have a hot reload problem again!");
        this.id = this.island.registerModel(this, state.id);
        this.buildParts(state, modelOptions);
    }

    /** @abstract */
    buildParts(_state, _modelOptions) {}

    /** second init pass: wire up objects */
    /** @arg {Object} state */
    /** @arg {Object} objectsByID */
    restoreObjectReferences(state, objectsByID) {
        for (const [partId, part] of Object.entries(this.parts)) {
            part.restoreObjectReferences(state[partId], objectsByID);
        }
    }

    destroy() {
        this.island.deregisterModel(this.id);
    }

    // PUB/SUB
    subscribePart(scope, part, event, subscribingPartId, methodName) {
        const fullScope = part ? `${scope}.${part}` : scope;
        this.island.addModelSubscription(fullScope, event, this.id, subscribingPartId, methodName);
    }

    unsubscribePart(scope, part, event, subscribingPartId, methodName) {
        const fullScope = part ? `${scope}.${part}` : scope;
        this.island.removeModelSubscription(fullScope, event, this.id, subscribingPartId, methodName);
    }

    publish(scope, part, event, data) {
        const fullScope = part ? `${scope}.${part}` : scope;
        this.island.publishFromModel(fullScope, event, data);
    }

    // FUTURE
    futureProxy(tOffset=0, partId) {
        return this.island.futureProxy(tOffset, this, partId);
    }

    // STATE
    static fromState(state) {
        const ModelClass = classFromID(state.class);
        return new ModelClass(state);
    }

    toState(state) {
        state.class = classToID(this.constructor);
        state.id = this.id;
        for (const [partId, part] of Object.entries(this.parts)) {
            part.toState(state[partId] = {});
        }
    }

    asState() {
        const state = {};
        this.toState(state);
        if (!state.id) throw Error(`No ID in ${this} - did you call super.toState(state)?`);
        return state;
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(_viewContext) { }
}


// map model class names to model classes
let ModelClasses = {};

// Symbol for storing class ID in constructors
const CLASS_ID = Symbol('CLASS_ID');

function gatherModelClasses() {
    // HACK: go through all exports and find model subclasses
    ModelClasses = {};
    for (const [file, m] of Object.entries(module.bundle.cache)) {
        for (const cls of Object.values(m.exports)) {
            if (cls && cls.__isTeatimeModelClass__) {
                // create a classID for this class
                const id = `${file}:${cls.name}`;
                const dupe = ModelClasses[id];
                if (dupe) throw Error(`Duplicate Model subclass "${id}" in ${file} and ${dupe.file}`);
                ModelClasses[id] = {cls, file};
                cls[CLASS_ID] = id;
            }
        }
    }
}

function classToID(cls) {
    if (cls[CLASS_ID]) return cls[CLASS_ID];
    gatherModelClasses();
    if (cls[CLASS_ID]) return cls[CLASS_ID];
    throw Error(`Class "${cls.name}" not found, is it exported?`);
}

function classFromID(classID) {
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    gatherModelClasses();
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    throw Error(`Class "${classID}" not found, is it exported?`);
}

// flush ModelClasses after hot reload
hotreload.addDisposeHandler(module.id, () => ModelClasses = {});
