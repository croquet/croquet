import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import urlOptions from "@croquet/util/urlOptions";
import { addClassHash } from "@croquet/util/modules";
import { currentRealm } from "./realms";


const DEBUG = {
    classes: urlOptions.has("debug", "classes", false),
};


/** passed to Model constructor to check if it was called via create */
const SECRET = Symbol("SECRET");

/** For warning about model instances that have not called super.init */
const SuperInitNotCalled = new WeakSet();

/**
 * Models are replicated objects in Croquet.
 * They are automatically kept in sync on each client in the same [session]{@link startSession}.
 * Models receive input by [subscribing]{@link Model#subscribe} to events published in a {@link View}.
 * Their output is handled by {@link View}s subscribing to events [published]{@link Model#publish} by a model.
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
 * restores all properties automatically without calling `init()`.
 *
 * @hideconstructor
 * @public
 */
class Model {
    // mark this and subclasses as model classes
    // used in classToID / classFromID below
    static __isTeatimeModelClass__() { return true; }

    /**
     * __Create an instance of a Model subclass.__
     *
     * This will call the user-defined [init()]{@link Model#init} method to initialize the instance,
     * passing the {@link options}.
     * @example this.foo = FooModel.create({answer: 123});
     * @public
     * @param {Object=} options - option object to be passed to [init()]{@link Model#init}.
     *     There are no system-defined options as of now, you're free to define your own.
     */
    static create(options) {
        const ModelClass = this;
        const realm = currentRealm();
        const model = new ModelClass(SECRET);
        model.__realm = realm;
        model.id = realm.register(model);
        SuperInitNotCalled.add(model);
        model.init(options);
        if (SuperInitNotCalled.has(model)) {
            SuperInitNotCalled.delete(model);
            // only warn about deep subclasses
            if (Object.getPrototypeOf(ModelClass) !== Model) {
                console.warn(`${model} did not call super.init(options)`);
            }
        }
        return model;
    }

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
    static register(file="unknown-file") {
        addClassHash(this);
        registerClass(file, this.name, this);
    }

    /**
     * __Static declaration of how to serialize non-model classes.__
     *
     * The Croquet snapshot mechanism only knows about {@link Model} subclasses.
     * If you want to store instances of non-model classes in your model, override this method.
     *
     * __NOTE:__ This is currently the only way to customize serialization (for example to keep snapshots fast and small).
     * The serialization of Model subclasses can not be customized.
     *
     * @example <caption>To use the default serializer just declare the class:</caption>
     * return {
     *     "THREE.Vector3": THREE.Vector3,
     *     "THREE.Quaternion": THREE.Quaternion,
     * };
     *
     * @example <caption>To define your own serializer, declare read and write functions:</caption>
     * return {
     *     "THREE.Color": {
     *         cls: THREE.Color,
     *         write: color => '#' + color.getHexString(),
     *         read: state => new THREE.Color(state) },
     *     }
     * };
     * @public
     */
    static types() {
        return {};
    }

    // for use by serializer (see island.js)
    static classToID(cls) {  return classToID(cls); }
    static classFromID(id) { return classFromID(id); }
    static allClasses() { return allClasses(); }
    static instantiateClassID(id) {
        const ModelClass = classFromID(id);
        return new ModelClass(SECRET);
    }

    constructor(secret) {
        if (secret !== SECRET) throw Error(`You must create ${this} using create() not "new"!`);
    }

    /**
     * This is called by [create()]{@link Model.create} to initialize a model instance.
     *
     * In your Model subclass this is the place to [subscribe]{@link Model#subscribe} to events, or start a [future]{@link Model#future} message chain.
     *
     * @param {Object=} options - there are no system-defined options, you're free to define your own
     * @public
     */
    init(_options) {
        // for reporting errors if user forgot to call super.init()
        SuperInitNotCalled.delete(this);
        /** each model has an id (unique within the session) which can be used to scope events
         * @type {String}
         * @public
         */
        this.id = this.id;  // don't know how to otherwise add documentation
    }

    /**
     *
     * @public
     */
    destroy() {
        currentRealm().unsubscribeAll(this.id);
        currentRealm().deregister(this);
    }

    // Pub / Sub

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
     * Note that there is no way of testing whether subscriptions exist or not (because that may vary from client to client).
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
     * A commonly used scope is `this.id` (in a model) and `model.id` (in a view) to establish a
     * a communication channel between a odel and its corresponding view.
     *
     * You can use any literal string as a global scope, or use [`this.sessionId`]{@link Model#sessionId} for a
     * session-global scope (if your application supports multipe sessions at the same time).
     * The predefined events [`"user-enter"`]{@link event:user-enter} and [`"user-exit"`]{@link event:user-exit}
     * use this session scope.
     *
     * The event handler **must** be a method of `this`, and you **must** call that method using a fat-arrow function:<br>
     * `() => this.method()`<br>
     * or<br>
     * `arg => this.method(arg)`
     *
     * **No other forms are allowed.** This is because the event handler can not be actually stored as a function
     * (because functions are not serializable in JS). Instead, the method name is extracted from the function
     * and stored as a string. If the subscribe method cannot extract the method name, it will throw an error.
     *
     * If `data` was passed to the [publish]{@link Model#publish} call, it will be passed as an argument to the handler method.
     * You can have at most one argument. To pass multiple values, pass an Object or Array containing those values.
     * Note that views can only pass serializable data to models, because those events are routed via a reflector server
     * (see [View.publish){@link View#publish}).
     *
     * @example
     * this.subscribe("something", "changed", () => this.update());
     * this.subscribe(this.id, "moved", pos => this.handleMove(pos));
     * @example
     * class MyModel extends Croquet.Model {
     *   init() {
     *     this.subscribe(this.id, "moved", pos => this.handleMove(pos));
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
     * @param {Function} methodCall - the method to be called when the event is published.
     *     This **must** be specified as a fat-arrow function directly calling a method on `this`,
     *     taking zero or one arguments (see above)
     * @public
     */
    subscribe(scope, event, methodCall) {
        if (!this.__realm) this.__realmError();
        this.__realm.subscribe(event, this.id, methodCall, scope);
    }

    /**
     *
     * @param {String} scope
     * @param {String} event
     * @public
     */
    unsubscribe(scope, event) {
        if (!this.__realm) this.__realmError();
        this.__realm.unsubscribe(event, this.id, null, scope);
    }

    /**
     *
     * @public
     */
    unsubscribeAll() {
        if (!this.__realm) this.__realmError();
        this.__realm.unsubscribeAll(this.id);
    }

    __realmError() {
        if (!this.id) throw Error(`${this} has no ID, did you call super.init(options)?`);
    }

    /**
     *
     * @public
     */
    publishPropertyChange(property) {
        this.publish(this.id + "#" + property, "changed", null);
    }

    /**
     *
     * @public
     */
    subscribeToPropertyChange(model, property, callback) {
        this.subscribe(model.id + "#" + property, "changed", callback);
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
     * @returns {this}
     * @public
     */
    future(tOffset=0) {
        if (!this.__realm) this.__realmError();
        return this.__realm.futureProxy(tOffset, this);
    }

    /**
     *
     * @returns {Number}
     * @public
     */
    random() {
        return currentRealm().random();
    }

    /**
     *
     * @returns {Number}
     * @public
     */
    now() {
        return currentRealm().now();
    }

    /**
     * Make this model globally accessible under the given name.
     * It can be retrieved from any other model in the same session using [wellKnownModel()]{@link Model#wellKnownModel}.
     *
     * Note: The instance of your root Model class is automatically made well-known as `"modelRoot"`
     * and passed to the [constructor]{@link View} of your root View during {@link startSession}.
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
        return this.__realm.island.get(name);
    }

    /**
     * the session id is used as "global" scope for events like [`"users"`]{@link event:users}
     * @type {String}
     * @public
     */
    get sessionId() {
        return this.__realm.island.id;
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor.name;
        if (className.includes('Model')) return className;
        return `${className}[Model]`;
    }
}


/// MODEL CLASS LOADING

// map model class names to model classes
let ModelClasses = {};

// Symbol for storing class ID in constructors
const CLASS_ID = Symbol('CLASS_ID');

function gatherModelClasses() {
    // HACK: go through all exports and find model subclasses
    for (const [file, m] of Object.entries(module.bundle.cache)) {
        for (const [name, cls] of Object.entries(m.exports)) {
            if (cls && cls.__isTeatimeModelClass__) {
                registerClass(file, name === "default" ? cls.name : name, cls);
            }
        }
    }
}

function allClasses() {
    if (Object.keys(ModelClasses).length === 0) gatherModelClasses();
    return Object.values(ModelClasses).map(entry => entry.cls);
}

function hasID(cls) {
    return Object.prototype.hasOwnProperty.call(cls, CLASS_ID);
}

function classToID(cls) {
    if (hasID(cls)) return cls[CLASS_ID];
    gatherModelClasses();
    if (hasID(cls)) return cls[CLASS_ID];
    throw Error(`Class "${cls.name}" not found, is it registered?`);
}

function classFromID(classID) {
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    gatherModelClasses();
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    throw Error(`Class "${classID}" not found, is it registered?`);
}

function registerClass(file, name, cls) {
    // create a classID for this class
    const id = `${file}:${name}`;
    const dupe = ModelClasses[id];
    if (dupe && dupe.cls !== cls) throw Error(`Duplicate class ${name} in ${file}`);
    if (hasID(cls)) {
        if (DEBUG.classes && !dupe) console.warn(`ignoring re-exported class ${name} from ${file}`);
    } else {
        if (DEBUG.classes) console.log(`registering class ${name} from ${file}`);
        cls[CLASS_ID] = id;
    }
    ModelClasses[id] = {cls, file};
    return cls;
}

// flush ModelClasses after hot reload
hotreloadEventManger.addDisposeHandler(module.id, () => ModelClasses = {});

export default Model;
