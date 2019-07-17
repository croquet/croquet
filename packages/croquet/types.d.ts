declare module "croquet" {
    export abstract class PubSubParticipant {
        publish(scope: string, event: string, data: any): void;
        subscribe(scope: string, event: string, methodName: string | ((e: any) => void)): void;
        unsubscribe(scope: string, event: string): void;
        unsubscribeAll(): void;
    }

    /**
     * Models are replicated objects in Croquet.
     * They are automatically kept in sync for each user in the same [session]{@link startSession}.
     * Models receive input by [subscribing]{@link Model#subscribe} to events published in a {@link View}.
     * Their output is handled by views subscribing to events [published]{@link Model#publish} by a model.
     * Models advance time by sending messages into their [future]{@link Model#future}.
     *
     * ## Instance Creation and Initialization
     *
     * ### Do __NOT__ create a {@link Model} instance using `new` and<br>do __NOT__ override the `constructor`!
     *
     * To __create__ a new instance, use [create()]{@link Model.create}, for example:
     * ```
     * this.foo = FooModel.create({answer: 123});
     * ```
     * To __initialize__ an instance, override [init()]{@link Model#init}, for example:
     * ```
     * class FooModel extends Croquet.Model {
     *     init(options={}) {
     *         this.answer = options.answer || 42;
     *     }
     * }
     * ```
     * The **reason** for this is that Models are only initialized by calling `init()`
     * the first time the object comes into existence in the session.
     * After that, when joining a session, the models are deserialized from the snapshot, which
     * restores all properties automatically without calling `init()`. A constructor would
     * be called all the time, not just when starting a session.
     *
     * @hideconstructor
     * @public
     */
    export class Model extends PubSubParticipant {
        id: string;

        /**
         * __Create an instance of a Model subclass.__
         *
         * The instance will be registered for automatical snapshotting, and is assigned an [id]{@link Model#id}.
         *
         * Then it will call the user-defined [init()]{@link Model#init} method to initialize the instance,
         * passing the {@link options}.
         *
         * **Note:** When your model instance is no longer needed, you must [destroy]{@link Model#destroy} it.
         * Otherwise it will be kept in the snapshot forever.
         *
         * **Warning**: never create a Model instance using `new`, or override its constructor. See [above]{@link Model}.
         *
         * @example this.foo = FooModel.create({answer: 123});
         * @public
         * @param {Object=} options - option object to be passed to [init()]{@link Model#init}.
         *     There are no system-defined options as of now, you're free to define your own.
         */
        static create(options: any): Model;

        /**
         * __Registers this model subclass with Croquet__
         *
         * It is necessary to register all Model subclasses so the serializer can recreate their instances from a snapshot.
         * Also, the [session id]{@link startSession} is derived by hashing the source code of all registered classes.
         * @example
         * class MyModel extends Croquet.Model {
         *   ...
         * }
         * MyModel.register()
         * @param {String=} file the file name this class was defined in, to distinguish between same class names in different files
         * @public
         */
        static register(file:string): void;

        /**
         * __Static declaration of how to serialize non-model classes.__
         *
         * The Croquet snapshot mechanism only knows about {@link Model} subclasses.
         * If you want to store instances of non-model classes in your model, override this method.
         *
         * `types()` needs to return an Object that maps _names_ to _class descriptions_:
         * - the name can be any string, it just has to be unique within your app
         * - the class description can either be just the class itself (if the serializer should
         *   snapshot all its fields, see first example below), or an object with `write()` and `read()` methods to
         *   convert instances from and to their serializable form (see second example below).
         *
         * The types only need to be declared once, even if several different Model subclasses are using them.
         *
         * __NOTE:__ This is currently the only way to customize serialization (for example to keep snapshots fast and small).
         * The serialization of Model subclasses themselves can not be customized.
         *
         * @example <caption>To use the default serializer just declare the class:</caption>
         * class MyModel extends Croquet.Model {
         *   static types() {
         *     return {
         *       "SomeUniqueName": MyNonModelClass,
         *       "THREE.Vector3": THREE.Vector3,
         *       "THREE.Quaternion": THREE.Quaternion,
         *     };
         *   }
         * }
         *
         * @example <caption>To define your own serializer, declare read and write functions:</caption>
         * class MyModel extends Croquet.Model {
         *   static types() {
         *     return {
         *       "THREE.Color": {
         *         cls: THREE.Color,
         *         write: color => '#' + color.getHexString(),
         *         read: state => new THREE.Color(state) },
         *       };
         *    }
         * }
         * @public
         */
        static types(): Object;

        /**
         * This is called by [create()]{@link Model.create} to initialize a model instance.
         *
         * In your Model subclass this is the place to [subscribe]{@link Model#subscribe} to events,
         * or start a [future]{@link Model#future} message chain.
         *
         * **Note:** When your model instance is no longer needed, you must [destroy]{@link Model#destroy} it.
         *
         * @param {Object=} options - there are no system-defined options, you're free to define your own
         * @public
         */
        init(_options: any): void;

        /**
         * Unsubscribes all [subscriptions]{@link Model#subscribe} this model has,
         * unschedules all [future]{@link Model#future} messages,
         * and removes it from future snapshots.
         * @example
         * removeChild(child) {
         *    const index = this.children.indexOf(child);
         *    this.children.splice(index, 1);
         *    child.destroy();
         * }
         * @public
         */
        destroy(): void;

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
         * For events published by a model, this can be any arbitrary value or object.
         * See View's [publish]{@link View#publish} method for restrictions in passing data from a view to a model.
         *
         * Note that there is no way of testing whether subscriptions exist or not (because models can exist independent of views).
         * Publishing an event that has no subscriptions is about as cheap as that test would be, so feel free to always publish,
         * there is very little overhead.
         *
         * @example
         * this.publish("something", "changed");
         * this.publish(this.id, "moved", this.pos);
         * @param {String} scope see [subscribe]{@link Model#subscribe}()
         * @param {String} event see [subscribe]{@link Model#subscribe}()
         * @param {*=} data can be any value or object
         * @public
         */
        publish(scope: string, event: string, data: any): void;

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
         * You can use any literal string as a global scope, or use [`this.sessionId`]{@link Model#sessionId} for a
         * session-global scope (if your application supports multipe sessions at the same time).
         * The predefined events [`"view-join"`]{@link event:view-join} and [`"view-exit"`]{@link event:view-exit}
         * use this session scope.
         *
         * The handler must be a method of `this`, e.g. `subscribe("scope", "event", this.methodName)` will schedule the
         * invocation of `this["methodName"](data)` whenever `publish("scope", "event", data)` is executed.
         *
         * If `data` was passed to the [publish]{@link Model#publish} call, it will be passed as an argument to the handler method.
         * You can have at most one argument. To pass multiple values, pass an Object or Array containing those values.
         * Note that views can only pass serializable data to models, because those events are routed via a reflector server
         * (see [View.publish){@link View#publish}).
         *
         * @example
         * this.subscribe("something", "changed", this.update);
         * this.subscribe(this.id, "moved", this.handleMove);
         * @example
         * class MyModel extends Croquet.Model {
         *   init() {
         *     this.subscribe(this.id, "moved", this.handleMove);
         *   }
         *   handleMove({x,y}) {
         *     this.x = x;
         *     this.y = y;
         *   }
         * }
         * class MyView extends Croquet.View {
         *   constructor(model) {
         *     this.modelId = model.id;
         *   }
         *   onpointermove(evt) {
         *      const x = evt.x;
         *      const y = evt.y;
         *      this.publish(this.modelId, "moved", {x,y});
         *   }
         * }
         * @param {String} scope - the event scope (to distinguish between events of the same name used by different objects)
         * @param {String} event - the event name (user-defined or system-defined)
         * @param {Function} handler - the event handler (must be a method of `this`)
         * @return {this}
         * @public
         */
        subscribe(scope: string, event: string, methodName: string | ((e: any) => void)): void;

        /**
         * Unsubscribes this model's handler for the given event in the given scope.
         * @param {String} scope see [subscribe]{@link Model#subscribe}
         * @param {String} event see [subscribe]{@link Model#subscribe}
         * @public
         */
        unsubscribe(scope: string, event: string): void;

        /**
         * Unsubscribes all of this model's handlers for any event in any scope.
         * @public
         */
        unsubscribeAll(): void;

        /**
         * **Schedule a message for future execution**
         *
         * Use a future message to automatically advance time in a model,
         * for example for animations.
         * The execution will be scheduled `tOffset` milliseconds into the future.
         * It will run at precisely `[this.now()]{@link Model#now} + tOffset`.
         *
         * Use the form `this.future(100).methodName(args)` to schedule the execution
         * of `this.methodName(args)` at time `this.[now]{@link Model#now}() + tOffset`.
         *
         * **Hint**: This would be an unusual use of `future()`, but the `tOffset` given may be `0`,
         * in which case the execution will happen asynchronously before advancing time.
         * This is the only way for asynchronous execution in the model since you must not
         * use Promises or async functions in model code (because a snapshot may happen at any time
         * and it would not capture those executions).
         *
         * **Note:** the recommended form given above is equivalent to `this.future(100, "methodName", arg1, arg2)`
         * but makes it more clear that "methodName" is not just a string but the name of a method of this object.
         * Technically, it answers a [Proxy]{@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Proxy}
         * that captures the name and arguments of `.methodName(args)` for later execution.
         *
         * See this [tutorial]{@tutorial 1_1_hello_world} for a complete example.
         * @example <caption>single invocation with two arguments</caption>
         * this.future(3000).say("hello", "world");
         * @example <caption>repeated invocation with no arguments</caption>
         * tick() {
         *     this.n++;
         *     this.publish(this.id, "count", {time: this.now(), count: this.n)});
         *     this.future(100).tick();
         * }
         * @param {Number} tOffset - time offset in milliseconds, must be >= 0
         * @returns {this}
         * @public
         */
        future(tOffset?:number, methodName?: string, ...args: any[]): this;
    }

    export class View extends PubSubParticipant {
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
        constructor(model: Model);

        /**
         * **Unsubscribes all [subscriptions]{@link View#subscribe} this model has,
         * and removes it from the list of views**
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
        detach(): void;

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
        publish(scope: string, event: string, data: any): void;

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
         *   However, if the view needs to know the exact state of the model at the time the event was published,
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
        subscribe(scope: string, eventSpec: string | {event: "string", handling: "queued" | "oncePerFrame" | "immediate"}, callback: (e: any) => void): void;

        /**
         * Unsubscribes this view's handler for the given event in the given scope.
         * @param {String} scope see [subscribe]{@link View#subscribe}
         * @param {String} event see [subscribe]{@link View#subscribe}
         * @public
         */
        unsubscribe(scope: string, event: string): void;

        /**
         * Unsubscribes all of this views's handlers for any event in any scope.
         * @public
         */
        unsubscribeAll(): void;
    }

    /** helper that traverses a dummy object and gathers all object classes,
     * including otherwise inaccessible ones. Returns a mapping that can be returned in
     * a Model's static types() method */
    export function gatherInternalClassTypes(dummyObject: any, prefix: string): any;
}
