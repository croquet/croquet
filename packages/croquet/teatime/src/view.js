import { currentRealm } from "./realms";

/**
 * @public
 */
class View {

    /**
     * @param {Model} model - the view's model
     * @public
     */
    constructor(_model) {
        this.realm = currentRealm();
        /** @public */
        this.id = this.realm.register(this);
    }

    /**
     * @public
     */
    detach() {
        this.realm.unsubscribeAll(this.id);
        this.realm.deregister(this);
    }

    /**
     *
     * @param {String} scope
     * @param {String} event
     * @param {Object?} data
     * @public
     */
    publish(scope, event, data) {
        this.realm.publish(event, data, scope);
    }

    /**
     *
     * @param {String} scope
     * @param {String|Object} eventSpec
     * @param {Function} callback
     * @public
     */
    subscribe(scope, eventSpec, callback) {
        const {event, handling} = eventSpec.event ? eventSpec : {event: eventSpec};
        this.realm.subscribe(event, this.id, callback, scope, handling);
    }

    /**
     *
     * @param {String} scope
     * @param {String} event
     * @public
     */
    unsubscribe(scope, event) {
        this.realm.unsubscribe(event, this.id, null, scope);
    }

    /**
     * @public
     */
    unsubscribeAll() {
        this.realm.unsubscribeAll(this.id);
    }

    /**
     *
     * @public
     */
    subscribeToPropertyChange(model, property, callback, options={}) {
        this.subscribe(model.id + "#" + property, {...options, event: "changed"}, callback);
    }

    /**
     *
     * @public
     */
    unsubscribeFromPropertyChange(model, property) {
        this.unsubscribe(model.id + "#" + property, "changed");
    }

    // Misc

    /**
     *
     * @param {Number} tOffset
     * @returns {this}
     * @public
     */
    future(tOffset=0) {
        return this.realm.futureProxy(tOffset, this);
    }

    /**
     * @public
     */
    random() {
        // use currentRealm() to force a check that the call is happening in an appropriate context (not, e.g., in Model code)
        return currentRealm().random();
    }

    /**
     * @public
     */
    now() {
        return this.realm.now();
    }

    /**
     * @public
     */
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

    /**
     * @public
     */
    get sessionId() {
        return this.realm.island.id;
    }

    /**
     * @public
     */
    get clientId() {
        return this.realm.island.controller.clientId;
    }

    /**
     * @public
     */
    get user() {
        return this.realm.island.controller.user;
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor.name;
        if (className.includes('View')) return className;
        return `${className}[View]`;
    }
}

export default View;
