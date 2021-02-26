import urlOptions from "@croquet/util/urlOptions";
import { addClassHash } from "@croquet/util/hashing";
import { displayAppError } from "@croquet/util";
import { currentRealm } from "./realms";
import Island, { resetReadersAndWriters } from "./island";

const DEBUG = {
    classes: urlOptions.has("debug", "classes", false),
};


/** passed to Model constructor to check if it was called via create */
let SECRET = Symbol("SECRET");

/** For warning about model instances that have not called super.init */
const SuperInitNotCalled = new WeakSet();

/**
 * Models are replicated objects in Croquet.
 * They are automatically kept in sync for each user in the same [session]{@link Session.join}.
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
class Model {
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
    static create(options, persistentData, modelRootName) {
        if (!hasID(this)) throw Error(`Model class "${this.name}" not registered`);
        const ModelClass = this;
        const realm = currentRealm();
        const model = new ModelClass(SECRET);
        // read-only props
        Object.defineProperty(model, "__realm", { value: realm });
        Object.defineProperty(model, "id", { value: realm.register(model), enumerable: true });
        SuperInitNotCalled.add(model);
        if (typeof persistentData === "string") {
            console.warn(`Croquet: Model.create(..., "${persistentData}") with a well-known name argument is deprecated!`);
            model.beWellKnownAs(persistentData);
            persistentData = undefined;
        }
        // register root model before calling its init() so
        // that other models created in init() can look it up
        if (modelRootName) {
            model.beWellKnownAs(modelRootName);
        }
        model.init(options, persistentData);
        if (SuperInitNotCalled.has(model)) {
            SuperInitNotCalled.delete(model);
            // only warn about deep subclasses
            if (Object.getPrototypeOf(ModelClass) !== Model) {
                console.warn(`${model} did not call super.init(options)`);
            }
        }
        return model;
    }
    /* When we announce persistence, add this above
     * @param {Object=} persistentData - persistent data to be passed to [init()]{@link Model#init}.
     *     Only your root model's `init` receives the stored data automatically.
     *     This argument allows you to pass portions of that data when creating submodels.
     */

    // this version is used by the serializer
    static createNoInit(id) {
        const ModelClass = this;
        const realm = currentRealm();
        const model = new ModelClass(SECRET);
        // read-only props
        Object.defineProperty(model, "__realm", { value: realm });
        Object.defineProperty(model, "id", { value: id, enumerable: true });
        return model;
    }

    // hack for Parts that still use constructors
    static allowConstructors() {
        SECRET = undefined;
        console.warn("disabling error reporting for Model constructors");
    }

    /**
     * __Registers this model subclass with Croquet__
     *
     * It is necessary to register all Model subclasses so the serializer can recreate their instances from a snapshot.
     * Since source code minification can change the actual class name, you have to pass a `classId` explicitly.
     *
     * Secondly, the [session id]{@link Session.join} is derived by hashing the source code of all registered classes.
     * This ensures that only clients running the same source code can be in the same session,
     * so that the replicated computations are identical for each client.
     *
     * **Important**: for the hashing to work reliably across browsers, be sure to specify `charset="utf-8"` for your `<html>` or all `<script>` tags.
     * @example
     * class MyModel extends Croquet.Model {
     *   ...
     * }
     * MyModel.register("MyModel")
     * @param {String} classId Id for this model class. Must be unique. If you use the same class name in two files, use e.g. `"file1/MyModel"` and `"file2/MyModel"`.
     * @public
     */
    static register(classId) {
        if (!classId) {
            classId = this.name;
            console.warn(`Deprecation warning: ${this.name}.register(classId) called without classId. See https://croquet.io/sdk/docs/Model.html#.register`);
        }
        resetReadersAndWriters();
        addClassHash(this, classId);
        registerClass(this, classId);
        return this;
    }

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
     * Declaring a type in any class makes that declaration available globally.
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
    static types() {
        return {};
    }

    // for use by serializer (see island.js)
    static classToID(cls) {  return classToID(cls); }
    static classFromID(id) { return classFromID(id); }
    static allClasses() { return allClasses(); }
    static allClassTypes() { return allClassTypes(); }
    static instantiateClassID(classId, id) {
        const ModelClass = classFromID(classId);
        return ModelClass.createNoInit(id);
    }

    constructor(secret) {
        if (secret !== SECRET) throw Error(`You must create ${this} using create() not "new"!`);
    }

    /**
     * This is called by [create()]{@link Model.create} to initialize a model instance.
     *
     * In your Model subclass this is the place to [subscribe]{@link Model#subscribe} to events,
     * or start a [future]{@link Model#future} message chain.
     *
     * If you pass `{options:...}` to [Session.join]{@link Session.join}, these will be passed to your root model's `init()`.
     *
     * **Note:** When your model instance is no longer needed, you must [destroy]{@link Model#destroy} it.
     *
     * @param {Object=} options - there are no system-defined options, you're free to define your own
     * @public
     */
    init(options) {
        // for reporting errors if user forgot to call super.init()
        SuperInitNotCalled.delete(this);
        // eslint-disable-next-line no-constant-condition
        if (false) {
            /** Each model has an id which can be used to scope [events]{@link Model#publish}. It is unique within the session.
             *
             * This property is read-only. There will be an error if you try to assign to it.
             *
             * It is assigned in {@link Model.create} before calling [init]{@link Model#init}.
             * @example
             * this.publish(this.id, "changed");
             * @type {String}
             * @public
             */
            this.id = "";
            // don't know how to otherwise add documentation
        }
    }

    /* ONCE THE PERSISTENCE API IS PUBLIC, ADD THIS ABOVE
     *
     * If you called [persistSession]{@link Model#persistSession} in a previous session (same name, same options, different code base),
     * that data will be passed as `persistentData` to your root model's `init()`. Based on that data you should re-create submodels,
     * subscriptions, future messages etc. to start the new session in a state similar to when it was last saved.
     *
     * @param {Object=} persistentData - data previously stored by [persistSession]{@link Model#persistSession}
     */

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
    destroy() {
        currentRealm().unsubscribeAll(this);
        currentRealm().deregister(this);
        // we're not deleting the object's id here
        // because it comes in handy for queued view event handlers
    }

    // Pub / Sub

    /**
     * **Publish an event to a scope.**
     *
     * Events are the main form of communication between models and views in Croquet.
     * Both models and views can publish events, and subscribe to each other's events.
     * Model-to-model and view-to-view subscriptions are possible, too.
     *
     * See [Model.subscribe]{@link Model#subscribe}() for a discussion of **scopes** and **event names**.
     * Refer to [View.subscribe]{@link View#subscribe}() for invoking event handlers *asynchronously* or *immediately*.
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
    publish(scope, event, data) {
        if (!this.__realm) this.__realmError();
        this.__realm.publish(event, data, scope);
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
    subscribe(scope, event, methodName) {
        if (!this.__realm) this.__realmError();
        return this.__realm.subscribe(this, scope, event, methodName);
    }

    /**
     * Unsubscribes this model's handler for the given event in the given scope.
     * @param {String} scope see [subscribe]{@link Model#subscribe}
     * @param {String} event see [subscribe]{@link Model#subscribe}
     * @public
     */
    unsubscribe(scope, event) {
        if (!this.__realm) this.__realmError();
        this.__realm.unsubscribe(this, scope, event);
    }

    /**
     * Unsubscribes all of this model's handlers for any event in any scope.
     * @public
     */
    unsubscribeAll() {
        if (!this.__realm) this.__realmError();
        this.__realm.unsubscribeAll(this);
    }

    __realmError() {
        if (!this.id) throw Error(`${this} has no ID, did you call super.init(options)?`);
    }

    // Misc

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
    future(tOffset=0, methodName, ...args) {
        if (!this.__realm) this.__realmError();
        return this.__realm.future(this, tOffset, methodName, args);
    }

    /**
     * **Generate a replicated pseudo-random number**
     *
     * This returns a floating-point, pseudo-random number in the range 0–1 (inclusive of 0, but not 1) with approximately uniform distribution over that range
     * (just like [Math.random]{@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Math/random}).
     *
     * Since the model computation is replicated for every user on their device, the sequence of random numbers generated must also
     * be exactly the same for everyone. This method provides access to such a random number generator.
     *
     * @returns {Number}
     * @public
     */
    random() {
        return currentRealm().random();
    }

    /**
     * **The model's current time**
     *
     * Time is discreet in Croquet, meaning it advances in steps.
     * Every user's device performs the exact same computation at the exact same virtual time.
     * This is what allows Croquet to do perfectly replicated computation.
     *
     * Every [event handler]{@link Model#subscribe} and [future message]{@link Model#future}
     * is run at a precisely defined moment in virtual model time, and time stands still while this execution is happening.
     * That means if you were to access `this.now()` in a loop, it would never answer a different value.
     *
     * The unit of `now` is milliseconds (1/1000 second) but the value can be fractional, it is a floating-point value.
     *
     * @return {Number} the model's time in milliseconds since the first user created the session.
     * @see [View.now()]{@link View#now}
     * @public
     */
    now() {
        return currentRealm().now();
    }

    /**
     * Make this model globally accessible under the given name.
     * It can be retrieved from any other model in the same session using [wellKnownModel()]{@link Model#wellKnownModel}.
     *
     * Hint: Another way to make a model well-known is to pass a name as second argument to {@link Model.create}().
     *
     * Note: The instance of your root Model class is automatically made well-known as `"modelRoot"`
     * and passed to the [constructor]{@link View} of your root View during {@link Session.join}.
     * @example
     * class FooManager extends Croquet.Model {
     *   init() {
     *     this.beWellKnownAs("UberFoo");
     *   }
     * }
     * class Underlings extends Croquet.Model {
     *   reportToManager(something) {
     *     this.wellKnownModel("UberFoo").report(something);
     *   }
     * }
     * @param {String} name - a name for the model
     * @public
     */
    beWellKnownAs(name) {
        currentRealm().island.set(name, this);
    }

    /**
     * Look up a model in the current session given its `id`
     * @example
     * const otherModel = this.getModel(otherId);
     * @param {String} id - the model's `id`
     * @returns {Model} the model if found, or `undefined`
     * @public
     */
    getModel(id) {
        return this.__realm.island.lookUpModel(id);
    }

    /**
     * Access a model that was registered previously using  [beWellKnownAs()]{@link Model#beWellKnownAs}.
     *
     * Note: The instance of your root Model class is automatically made well-known as `"modelRoot"`
     * and passed to the [constructor]{@link View} of your root View during {@link Session.join}.
     * @example
     * const topModel = this.wellKnownModel("modelRoot");
     * @param {String} name - the name given in [beWellKnownAs()]{@link Model#beWellKnownAs}
     * @returns {Model} the model if found, or `undefined`
     * @public
     */
    wellKnownModel(name) {
        return this.__realm.island.get(name);
    }

    /**
     * This methods checks if it is being called from a model, and throws an Error otherwise.
     *
     * Use this to protect some model code against accidentally being called from a view.
     * @example
     * get foo() { return this._foo; }
     * set foo(value) { this.modelOnly(); this._foo = value; }
     * @param {String=} msg - error message to display
     * @throws Error if called from view
     * @returns {Boolean} true (otherwise, throws Error)
     * @public
     */
    modelOnly(msg) {
        if (Island.current() === this.__realm.island) return true;
        const error = Error(msg || `${this}.modelOnly() called from outside a model!`);
        displayAppError('view code', error);
        throw error;
    }

    /**
     * **Identifies the shared session of all users**<br>
     * (as opposed to the [viewId]{@link View#viewId} which identifies the non-shared views of each user).
     *
     * The session id is used as "global" scope for events like [`"view-join"`]{@link event:view-join}.
     *
     * See {@link Session.join} for how the session id is generated.
     *
     * If your app has several sessions at the same time, each session id will be different.
     * @example
     * this.subscribe(this.sessionId, "view-join", this.addUser);
     * @type {String}
     * @public
     */
    get sessionId() {
        return this.__realm.island.id;
    }

    /**
     * **The number of users currently in this session.**
     *
     * All users in a session share the same Model (meaning all model objects) but each user has a different View
     * (meaning all the non-model state). This is the number of views currently sharing this model.
     * It increases by 1 for every [`"view-join"`]{@link event:view-join}
     * and decreases by 1 for every [`"view-exit"`]{@link event:view-exit} event.
     *
     * @example
     * this.subscribe(this.sessionId, "view-join", this.showUsers);
     * this.subscribe(this.sessionId, "view-exit", this.showUsers);
     * showUsers() { this.publish(this.sessionId, "view-count", this.viewCount); }
     * @type {Number}
     * @since 0.4.1
     * @public
     */
    get viewCount() {
        return Object.keys(this.__realm.island.views).length;
    }

    /**
     * Store an application-defined representation of this session to be loaded into future
     * sessions. This will be passed into the root model's [init]{@link Model#init} method
     * if resuming a session that is not currently ongoing (e.g. due to changes in the model code).
     *
     * **Note:** You should design this data in a way to be loadable in newer versions of your app.
     * To help migrating incompatible data, you may want to include a version identifier so a future
     * version of your [init]{@link Model#init} can decide what to do.
     *
     * Also you must only call persistSession() from your [root model]{@link Model#wellKnownModel}.
     * If there are submodels, your collectDataFunc should collect data from all submodels.
     * Similarly, only your root model's `init` will receive that persisted data.
     * It should recreate submodels as necessary.
     *
     * Croquet will not interpret this data in any way. It is simply encrypted, stored, and retrieved.
     *
     * @example
     * save() { this.persistSession(this.dataForExport); }
     * dataForExport() { return { version: 1, payload: { propA: "value", propB: ["values"] } }; }
     * @param {Function} collectDataFunc - method returning information to be stored, will be stringified as JSON
     * @since 0.3.4
     * @notpublic (yet)
     */
    persistSession(collectDataFunc) {
        if (this !== this.wellKnownModel("modelRoot")) throw Error('persistSession() must only be called on the root model');
        this.__realm.island.persist(this, collectDataFunc);
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor[CLASS_ID] || this.constructor.name;
        if (className.includes('Model')) return className;
        return `${className}[Model]`;
    }
}
// Model.register("Croquet.Model");
// registered at end of this file without hashing or logging

/// MODEL CLASS LOADING

// map model class names to model classes
const ModelClasses = {};

// Symbol for storing class ID in constructors
const CLASS_ID = Symbol('CLASS_ID');

function allClasses() {
    return Object.values(ModelClasses);
}

function allClassTypes() {
    const types = {};
    for (const modelClass of allClasses()) {
        Object.assign(types, modelClass.types());
    }
    return Object.entries(types);
}

function hasID(cls) {
    return Object.prototype.hasOwnProperty.call(cls, CLASS_ID);
}

function classToID(cls) {
    if (hasID(cls)) return cls[CLASS_ID];
    throw Error(`Class "${cls.name}" not found, did you call ${cls.name}.register("${cls.name}")?`);
}

function classFromID(classID) {
    if (ModelClasses[classID]) return ModelClasses[classID];
    throw Error(`Class "${classID}" in snapshot, but not found in current source?`);
}

function registerClass(cls, classId) {
    // create a classID for this class
    const dupe = ModelClasses[classId];
    if (dupe && dupe !== cls) throw Error(`Registering model class ${cls.name} failed, id "${classId}" already used by ${dupe.name}`);
    if (hasID(cls)) {
        if (DEBUG.classes && !dupe) console.warn(`ignoring re-exported model class ${classId}`);
    } else {
        if (DEBUG.classes) console.log(`registering model class ${classId}`);
        cls[CLASS_ID] = classId;
    }
    ModelClasses[classId] = cls;
    return cls;
}

// register without logging or hashing
const modelClassId = "Croquet.Model";
Model[CLASS_ID] = modelClassId;
ModelClasses[modelClassId] = Model;

export default Model;
