import Part from "./parts.js";

/** @typedef {import('./view').default} View */
/** @typedef {import('./model').default} Model */

/** @extends {Part<Model|View>} */
export default class StatePart extends Part {
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
        this.owner.subscribePart(scope, part, event, this.partId, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        this.owner.unsubscribePart(scope, part, event, this.partId, methodName);
    }

    publish(event, data, scope=this.owner.id, part=this.partId) {
        this.owner.publish(scope, part, event, data);
    }

    // FUTURE
    future(tOffset=0) {
        return this.owner.futureProxy(tOffset, this.partId);
    }

    /** @returns {import('./island.js').default} */
    get island() {
        return this.owner.island;
    }

    // for setting type of arguments in future messages
    ensure(object, cls) {
        if (object instanceof cls) return;
        Object.setPrototypeOf(object, cls.prototype);
    }

    // STATE
    toState(_state) { }
}
