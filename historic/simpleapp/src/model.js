import Part, { PartOwner } from "./parts.js";
import Island from "./island.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

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
        for (const [partId, part] of Object.entries(this.parts)) {
            part.restoreObjectReferences(state[partId], objectsByID);
        }
    }

    destroy() {
        this.island.deregisterModel(this.id);
    }

    // STATE
    toState(state) {
        state.className = this.constructor.name;
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
        const fullScope = part ? `${scope}.${part}` : scope;
        this.island.addModelSubscription(fullScope, event, this.owner.id, this.partId, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        const fullScope = part ? `${scope}.${part}` : scope;
        this.island.removeModelSubscription(fullScope, event, this.owner.id, this.partId, methodName);
    }

    publish(event, data, scope=this.owner.id, part=this.partId) {
        const fullScope = part ? `${scope}.${part}` : scope;
        this.island.publishFromModel(fullScope, event, data);
    }

    // FUTURE
    future(tOffset=0) {
        return this.island.futureProxy(tOffset, this.owner, this.partId);
    }

    // for setting type of arguments in future messages
    ensure(object, cls) {
        if (object instanceof cls) return;
        Object.setPrototypeOf(object, cls.prototype);
    }

    // STATE
    toState(_state) { }
}
