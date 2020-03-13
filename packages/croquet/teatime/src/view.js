import { displayStatus, displayWarning, displayError } from "@croquet/util/html";
import { currentRealm, inViewRealm } from "./realms";

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
 *
 * It's possible for a single view instance to handle all the events, you don't event have to subclass Croquet.View for that.
 * That being said, a common pattern is to make a hierarchy of `Croquet.View` subclasses to mimic your hierarchy of {@link Model} subclasses.
 *
 * @public
 */
class View {
    static displayStatus(msg, options) { return displayStatus(msg, options); }
    static displayWarning(msg, options) { return displayWarning(msg, options); }
    static displayError(msg, options) { return displayError(msg, options); }

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
        Object.defineProperty(this, "id", {  value: this.realm.register(this), configurable: true });
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
     * **Unsubscribes all [subscriptions]{@link View#subscribe} this model has,
     * and removes it from the list of views**
     *
     * This needs to be called when a view is no longer needed, to prevent memory leaks.
     * A session's root view is automatically sent `detach` when the session becomes
     * inactive (for example, going dormant because its browser tab is hidden).
     * A root view should therefore override `detach` (remembering to call `super.detach()`)
     * to detach any subsidiary views that it has created.
     * @example
     * removeChild(child) {
     *    const index = this.children.indexOf(child);
     *    this.children.splice(index, 1);
     *    child.detach();
     * }
     * @public
     */
    detach() {
        this.unsubscribeAll();
        this.realm.deregister(this);
        Object.defineProperty(this, "id", {  value: "" });
    }

    /**
     * **Publish an event to a scope.**
     *
     * Events are the main form of communication between models and views in Croquet.
     * Both models and views can publish events, and subscribe to each other's events.
     * Model-to-model and view-to-view subscriptions are possible, too.
     *
     * See [Model.subscribe]{@link Model#subscribe} for a discussion of **scopes** and **event names**.
     *
     * Optionally, you can pass some **data** along with the event.
     * For events published by a view and received by a model,
     * the data needs to be serializable, because it will be sent via the reflector to all users.
     * For view-to-view events it can be any value or object.
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
     * **Register an event handler for an event published to a scope.**
     *
     * Both `scope` and `event` can be arbitrary strings.
     * Typically, the scope would select the object (or groups of objects) to respond to the event,
     * and the event name would select which operation to perform.
     *
     * A commonly used scope is `this.id` (in a model) and `model.id` (in a view) to establish
     * a communication channel between a model and its corresponding view.
     *
     * Unlike in a model's [subscribe]{@link Model#subscribe} method, you can specify when the event should be handled:
     * - **Queued:** The handler will be called on the next run of the [main loop]{@link startSession},
     *   the same number of times this event was published.
     *   This is useful if you need each piece of data that was passed in each [publish]{@link Model#publish} call.
     *
     *   An example would be log entries generated in the model that the view is supposed to print.
     *   Even if more than one log event is published in one render frame, the view needs to receive each one.
     *
     *   **`{ event: "name", handling: "queued" }` is the default.  Simply specify `"name"` instead.**
     *
     * - **Once Per Frame:** The handler will be called only _once_ during the next run of the [main loop]{@link startSession}.
     *   If [publish]{@link Model#publish} was called multiple times, the handler will only be invoked once,
     *   passing the data of only the last `publish` call.
     *
     *   For example, a view typically would only be interested in the current position of a model to render it.
     *   Since rendering only happens once per frame, it should subscribe using the `oncePerFrame` option.
     *   The event typically would be published only once per frame anyways, however,
     *   while the model is catching up when joining a session, this would be fired rapidly.
     *
     *   **`{ event: "name", handling: "oncePerFrame" }` is the most efficient option, you should use it whenever possible.**
     *
     * - **Immediate:** The handler will be invoked _synchronously_ during the [publish]{@link Model#publish} call.
     *   This will tie the view code very closely to the model simulation, which in general is undesirable.
     *   However, if the event handler needs to set up another subscription,
     *   immediate execution ensures that a subsequent publish will be properly handled
     *   (especially when rapidly replaying events for a new user).
     *   Similarly, if the view needs to know the exact state of the model at the time the event was published,
     *   before execution in the model proceeds, then this is the facility to allow this without having to copy model state.
     *
     *   Pass `{event: "name", handling: "immediate"}` to enforce this behavior.
     *
     * The `handler` can be any callback function.
     * Unlike a model's [handler]{@link Model#subscribe} which must be a method of that model,
     * a view's handler can be any function, including fat-arrow functions declared in-line.
     * Passing a method like in the model is allowed too, it will be bound to `this` in the subscribe call.
     *
     * @example
     * this.subscribe("something", "changed", this.update);
     * this.subscribe(this.id, {event: "moved", handling: "oncePerFrame"}, pos => this.sceneObject.setPosition(pos.x, pos.y, pos.z));
     * @tutorial 1_4_view_smoothing
     * @param {String} scope - the event scope (to distinguish between events of the same name used by different objects)
     * @param {String|Object} eventSpec - the event name (user-defined or system-defined), or an event handling spec object
     * @param {String} eventSpec.event - the event name (user-defined or system-defined)
     * @param {String} eventSpec.handling - `"queued"` (default), `"oncePerFrame"`, or `"immediate"`
     * @param {Function} handler - the event handler (can be any function)
     * @return {this}
     * @public
     */
    subscribe(scope, eventSpec, callback) {
        callback = callback.bind(this);
        const {event, handling} = eventSpec.event ? eventSpec : {event: eventSpec};
        this.realm.subscribe(event, this.id, callback, scope, handling);
    }

    /**
     * Unsubscribes this view's handlers for the given event in the given scope.
     * @param {String} scope see [subscribe]{@link View#subscribe}
     * @param {String} event see [subscribe]{@link View#subscribe}
     * @public
     */
    unsubscribe(scope, event) {
        this.realm.unsubscribe(event, this.id, null, scope);
    }

    /**
     * Unsubscribes all of this views's handlers for any event in any scope.
     * @public
     */
    unsubscribeAll() {
        this.realm.unsubscribeAll(this.id);
    }

    // Misc

    /**
     * **Schedule a message for future execution**
     *
     * This method is here for symmetry with [Model.future]{@link Model#future}.
     *
     * It simply schedules the execution using
     * [window.setTimeout]{@link https://developer.mozilla.org/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout}.
     * The only advantage to using this over setTimeout() is consistent style.
     *
     * @param {Number} tOffset - time offset in milliseconds
     * @returns {this}
     * @public
     */
    future(tOffset=0) {
        return this.realm.future(this, tOffset);
    }

    /**
     * **Answers [Math.random()]{@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Math/random}**
     *
     * This method is here purely for symmetry with [Model.random]{@link Model#random}.
     *
     * @returns {Number} [Math.random()]{@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Math/random}
     * @public
     */
    random() {
        // use currentRealm() to force a check that the call is happening in an appropriate context (not, e.g., in Model code)
        return currentRealm().random();
    }

    /**
     * **The model's current time**
     *
     * This is the time of how far the model has been simulated.
     * Normally this corresponds roughly to real-world time, since the reflector is generating time stamps
     * based on real-world time.
     *
     * If there is [backlog]{@link View#externalNow} however (e.g while a newly joined user is catching up),
     * this time will advance much faster than real time.
     *
     * The unit is milliseconds (1/1000 second) but the value can be fractional, it is a floating-point value.
     *
     * @return {Number} the model's time in milliseconds since the first user created the session.
     * @see [Model.now()]{@link Model#now}
     * @public
     */
    now() {
        return this.realm.now();
    }

    /**
     * **The latest timestamp received from reflector**
     *
     * Timestamps are received asynchronously from the reflector at the specified tick rate.
     * [Model time]{@link View#now} however only advances synchronously on every iteration of the [main loop]{@link startSession}.
     * Usually `now == externalNow`, but if the model has not caught up yet, then `now < externalNow`.
     *
     * We call the difference "backlog". If the backlog is too large, Croquet will put an overlay on the scene,
     * and remove it once the model simulation has caught up.
     * The [`"synced"`]{@link event:synced} event is sent when that happens.
     *
     * The `externalNow` value is rarely used by apps but may be useful if you need to synchronize views to real-time.
     * @example
     * const backlog = this.externalNow() - this.now();
     * @returns {number} the latest timestamp in milliseconds received from the reflector
     * @public
     */
    externalNow() {
        return this.realm.externalNow();
    }

    /** Called on the root view from [main loop]{@link startSession} once per frame. Default implementation does nothing.
     *
     * Override to add your own view-side input polling, rendering, etc.
     *
     * If you want this to be called for other views than the root view, you will have to call
     * those methods from the root view's `update()`.
     *
     * The `time` received is related to the local real-world time. If you need to access the model's time,
     * use [`this.now()`]{@link View#now}.
     *
     * @param {Number} time - this frame's time stamp in milliseconds, as received by
     *     [requestAnimationFrame]{@link https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame}
     *     (or passed into `step(time)` if [stepping manually]{@link startSession})
     * @public
    */
    update(_time) {
    }

    /**
     * Access a model that was registered previously using  [beWellKnownAs()]{@link Model#beWellKnownAs}.
     *
     * Note: The instance of your root Model class is automatically made well-known as `"modelRoot"`
     * and passed to the [constructor]{@link View} of your root View during {@link startSession}.
     * @example
     * const topModel = this.wellKnownModel("modelRoot");
     * @param {String} name - the name given in [beWellKnownAs()]{@link Model#beWellKnownAs}
     * @returns {Model} the model if found, or `undefined`
     * @public
     */
    wellKnownModel(name) {
        return this.realm.island.get(name);
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
     * this.subscribe(this.sessionId, "view-join", this.logUser);
     * @type {String}
     * @public
     */

    get primarySessionId() {
        return window.PRIMARY_ISLAND.id || this.realm.island.id;
    }
    
    get sessionId() {
        return window.PRIMARY_ISLAND.id || this.realm.island.id;
    }

    /**
     * **Identifies the View of the current user.**
     *
     * All users in a session share the same Model (meaning all model objects) but each user has a different View
     * (meaning all the non-model state). The `viewId` identifies each user's view.
     * It is sent as argument in [`"view-join"`]{@link event:view-join} and [`"view-exit"`]{@link event:view-exit}
     * events.
     *
     * The `viewId` is also used as a scope for non-replicated events, for example [`"synced"`]{@link event:synced}.
     *
     * **Note:** `this.viewId` is different from [`this.id`]{@link View#id} which identifies each individual view object
     * (if you create multiple views in your code). `this.viewId` identifies the local user, so it will be the same
     * in each individual view object. See [`"view-join"`]{@link event:view-join} event.
     * @example
     * this.subscribe(this.sessionId, "view-join", id => console.log(`${id === this.viewId ? "local" : "remote"} user ${id} joined`));
     * @type {String}
     * @public
     */
    get viewId() {
        return this.realm.island.controller.viewId;
    }

    // hidden helper to execute code in same view realm as this view
    // used by @croquet/react
    inSameViewRealm(callback) {
        return inViewRealm(this.realm.island, callback, true);
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor.name;
        if (className.includes('View')) return className;
        return `${className}[View]`;
    }
}

export default View;
