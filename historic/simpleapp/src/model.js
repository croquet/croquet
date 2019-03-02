import Part, { PartOwner } from "./parts.js";
import Island from "./island.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export const ModelEvents = {
    constructed: "model-constructed",
    destroyed: "model-destroyed"
};

/** @extends {PartOwner<ModelPart>} */
export default class Model extends PartOwner {
    // mark this and subclasses as model classes
    // used in island.js:modelFromState
    static __isTeatimeModelClass__() { return true; }

    get island() { return Island.current(); }

    // LIFECYCLE
    /** @arg {Object} state */
    constructor(state={}, modelOptions={}) {
        super();
        this.id = this.island.registerModel(this, state.id);
        this.buildParts(state, modelOptions);
    }

    /** @abstract */
    buildParts(_state, _modelOptions) {}

    /** second init pass: wire up objects */
    /** @arg {Object} state */
    /** @arg {Object} objectsByID */
    restoreObjectReferences(state, objectsByID) {
        for (const partId of Object.keys(this.parts)) {
            this.parts[partId].restoreObjectReferences(state[partId], objectsByID);
        }
    }

    destroy() {
        this.island.deregisterModel(this.id);
    }

    // STATE
    toState(state) {
        state.className = this.constructor.name;
        state.id = this.id;
        for (const partId of Object.keys(this.parts)) {
            state[partId] = {};
            this.parts[partId].toState(state[partId]);
        }
    }

    asState() {
        const state = {};
        this.toState(state);
        if (!state.id) throw Error(`No ID in ${this} - did you call super.toState()?`);
        return state;
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(_viewContext) { }
}

/** @extends {Part<Model>} */
export class ModelPart extends Part {
    get island() { return this.owner.island; }

    constructor(owner, fullState, options) {
        super(owner, options);
        this.fromState(fullState[this.partId], options);
    }

    /** @abstract */
    fromState(_state, _options) {}

    /** second init pass: wire up objects */
    /** @arg {Object} _state */
    /** @arg {Object} _objectsByID */
    restoreObjectReferences(_state, _objectsByID) {}

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        const fullScope = scope + (part ? "." + part : "");
        this.island.addModelSubscription(fullScope, event, this.owner.id, this.partId, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        const fullScope = scope + (part ? "." + part : "");
        this.island.removeModelSubscription(fullScope, event, this.owner.id, this.partId, methodName);
    }

    publish(event, data, tOffset=0, scope=this.owner.id, part=this.partId) {
        const fullScope = scope + (part ? "." + part : "");
        this.island.publishFromModel(fullScope, event, data, tOffset);
    }

    // FUTURE
    future(tOffset=0) {
        return this.island.futureProxy(tOffset, this.owner, this.partId);
    }

    // STATE
    toState(_state) { }
}
