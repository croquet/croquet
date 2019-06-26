import { currentRealm } from "./realms";

/**
 * Views are the non-replicated part of a Croquet Application.
 * Each device and browser window creates its own independend local view.
 * The view [subscribes]{@link View#subscribe} to events [published]{@link Model#publish}
 * by the replicated model, so it stays up to date in real time.
 *
 * What the view is showing, however, is completely up to the application developer.
 * The view can adapt to the device it's running on and show very different things.
 *
 * Croquet makes no assumptions about the UI framework you use - be it plain HTML or Three.js or whatever.
 * Croquet only provides the publish/subscribe mechanism to hook into the replicated model simulation.
 *
 * A common pattern is to make a hierarchy of `Croquet.View` subclasses to mimic your hierarchy of Model subclasses.
 * However, it's also posssible for a single view instance to handle all the events, you don't event have to subclass it.
 *
 * @public
 */
class View {

    /**
     * A View instance is created in {@link startSession}, and the root model is passed into its constructor.
     *
     * This inherited constructor does not use the model in any way.
     * Your constructor should recreate the view state to exactly match what is in the model.
     * It should also [subscribe]{@link View#subscribe} to any changes published by the model.
     * Typically, a view would also subscribe to the browser's or framework's input events,
     * and in response [publish]{@link View#publish} events for the model to consume.
     *
     * @param {Model} model - the view's model
     * @public
     */
    constructor(_model) {
        // read-only properties
        Object.defineProperty(this, "realm", {  value: currentRealm() });
        Object.defineProperty(this, "id", {  value: this.realm.register(this) });
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
     * Override to add your own view-side input polling, rendering, etc.
     * @param {Number} time - this frame's time stamp in milliseconds
     * @public
    */
    update(_time) {
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
    get viewId() {
        return this.realm.island.controller.viewId;
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor.name;
        if (className.includes('View')) return className;
        return `${className}[View]`;
    }
}

export default View;
