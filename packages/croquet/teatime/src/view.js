import { currentRealm } from "./realms";

/**
 * @public
 */
class View {

    /**
     * @public
     * @param {Model} model - the view's model
     */
    constructor(_model) {
        this.realm = currentRealm();
        this.id = this.realm.register(this);
    }

    /**
     * @public
     */
    detach() {
        this.realm.unsubscribeAll(this.id);
        this.realm.deregister(this);
    }

    publish(scope, event, data) {
        this.realm.publish(event, data, scope);
    }

    subscribe(scope, eventSpec, callback) {
        const {event, handling} = eventSpec.event ? eventSpec : {event: eventSpec};
        this.realm.subscribe(event, this.id, callback, scope, handling);
    }

    unsubscribe(scope, event) {
        this.realm.unsubscribe(event, this.id, null, scope);
    }

    unsubscribeAll() {
        this.realm.unsubscribeAll(this.id);
    }

    // Misc

    /** @returns {this} */
    future(tOffset=0) {
        return this.realm.futureProxy(tOffset, this);
    }

    // use currentRealm() to force a check that the call is happening in an appropriate context (not, e.g., in Model code)
    random() {
        return currentRealm().random();
    }

    now() {
        return this.realm.now();
    }

    externalNow() {
        return this.realm.externalNow();
    }

    /** Called from main loop once per frame. Default implementation does nothing.
     *
     * Override to add your own rendering.
     * @param {Number} time - this frame's time stamp in milliseconds
     * @public
    */
    render(_time) {
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor.name;
        if (className.includes('View')) return className;
        return `${className}[View]`;
    }
}

export default View;
