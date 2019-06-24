import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import urlOptions from "@croquet/util/urlOptions";
import { addClassHash } from "@croquet/util/modules";
import { currentRealm } from "./realms";


const DEBUG = {
    classes: urlOptions.has("debug", "classes", false),
};


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
        const model = new ModelClass();
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
     *
     * @param {String} scope
     * @param {String} event
     * @param {*=} data
     * @public
     */
    publish(scope, event, data) {
        if (!this.__realm) this.__realmError();
        this.__realm.publish(event, data, scope);
    }


    /**
     * Register an event handler for an event published to a certain scope.
     * @param {String} scope - the event scope (to distinguish between events of the same name used by different objects)
     * @param {String} event - the event name (user-defined or system-defined)
     * @param {Function} callback - the function called when the event was published
     * @public
     */
    subscribe(scope, event, callback) {
        if (!this.__realm) this.__realmError();
        this.__realm.subscribe(event, this.id, callback, scope);
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
     * Note: The instance of your root Model class is being made well-known as `"modelRoot"`
     * and passed to the [constructor]{@link View} of your root View during {@link startSession}.
     * @param {String} name - a name for the model
     * @public
     */
    beWellKnownAs(name) {
        currentRealm().island.set(name, this);
    }

    /**
     * Access a model that was registered previously using  [beWellKnownAs()]{@link Model#beWellKnownAs}.
     *
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
