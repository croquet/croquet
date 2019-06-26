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
 * **Croquet makes no assumptions about the UI framework you use** - be it plain HTML or Three.js or React or whatever.
 * Croquet only provides the publish/subscribe mechanism to hook into the replicated model simulation.
 * It's possible for a single view instance to handle all the events, you don't event have to subclass Croquet.View for that.
 *
 * That being said, a common pattern is to make a hierarchy of `Croquet.View` subclasses to mimic your hierarchy of Model subclasses.
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
     * The constructor will, however, register the view and assign it an [id]{@link View#id}.
     *
     * **Note:** When your view instance is no longer needed, you must [detach]{@link View#detach} it.
     * Otherwise it will be kept in memory forever.
     *
     * @param {Model} model - the view's model
     * @public
     */
    constructor(_model) {
        // read-only properties
        Object.defineProperty(this, "realm", {  value: currentRealm() });
        Object.defineProperty(this, "id", {  value: this.realm.register(this) });
        // eslint-disable-next-line no-constant-condition
        if (false) {
            /** Each view has an id which can be used to scope [events]{@link View#publish} between views.
             * It is unique within the session for each user.
             *
             * **Note:** The `id` is **not** currently guaranteed to be unique for different users.
             * Views on multiple devices may or may not be given the same id.
             *
             * This property is read-only. It is assigned in the view's constructor. There will be an error if you try to assign to it.
             *
             * @example
             * this.publish(this.id, "changed");
             * @type {String}
             * @public
             */
            this.id = "";
            // don't know how to otherwise add documentation
        }
    }

    /**
     * Unsubscribes all [subscriptions]{@link View#subscribe} this model has,
     * and removes it from the list of views.
     *
     * This needs to be called when a view is no longer needed to prevent memory leaks.
     * @example
     * removeChild(child) {
     *    const index = this.children.indexOf(child);
     *    this.children.splice(index, 1);
     *    child.detach();
     * }
     * @public
     */
    detach() {
        this.realm.unsubscribeAll(this.id);
        this.realm.deregister(this);
    }

    /**
     * **Publish an event to a scope.**
     *
     * Events are the main form of communication between models and views in Croquet.
     * Both models and views can publish events, and subscribe to each other's events.
     * Model-to-model and view-to-view subscriptions are possible, too.
     *
     * See [subscribe]{@link Model#subscribe}() for a discussion of **scopes** and **event names**.
     *
     * Optionally, you can pass some **data** along with the event.
     * For events published by a view and received , this can be any arbitrary value or object.
     *
     * Note that there is no way of testing whether subscriptions exist or not (because models can exist independent of views).
     * Publishing an event that has no subscriptions is about as cheap as that test would be, so feel free to always publish,
     * there is very little overhead.
     *
     * @example
     * this.publish("input", "keypressed", {key: 'A'});
     * this.publish(this.model.id, "move-to", this.pos);
     * @param {String} scope see [subscribe]{@link Model#subscribe}()
     * @param {String} event see [subscribe]{@link Model#subscribe}()
     * @param {*=} data can be any value or object (for view-to-model, must be serializable)
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
        if (this[callback.name] === callback) callback = callback.bind(this);
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
     * **Identifies the shared Model of all users.**
     *
     * The session id is used as "global" scope for events like [`"view-join"`]{@link event:view-join}.
     *
     * See {@link startSession} for how the session id is generated.
     *
     * If your app has several sessions at the same time, each session id will be different.
     * @example
     * this.subscribe(this.sessionId, "view-join", viewId => this.logUser(viewId));
     * @type {String}
     * @public
     */
    get sessionId() {
        return this.realm.island.id;
    }

    /**
     * **Identifies the View of the current user.**
     *
     * All users in a session share the same Model (meaning all model objects) but each user has a different View
     * (meaning all the non-model state). The `viewId` identifies each user's view.
     * It is sent as argument in [`"view-join"`]{@link event:view-join} and [`"view-exit"`]{@link event:view-exit}
     * events.
     *
     * **Note:** this is different from [`this.id`]{@link View#id} which identifies each individual view object
     * (if you create multiple views in your code). `this.viewId` identifies the local user, so it will be the same
     * in each individual view object. See [`"view-join"`]{@link event:view-join} event.
     * @type {String}
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
