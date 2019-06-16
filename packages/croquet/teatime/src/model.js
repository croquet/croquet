import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import urlOptions from "@croquet/util/urlOptions";
import { addClassHash } from "@croquet/util/modules";
import { currentRealm } from "./realms";


const DEBUG = {
    classes: urlOptions.has("debug", "classes", false),
};


/**
 * Models are replicated objects in Croquet.
 * @public
 */
class Model {
    // mark this and subclasses as model classes
    // used in classToID / classFromID below
    static __isTeatimeModelClass__() { return true; }

    /**
     * __Create an instance of a Model subclass.__
     * This will call {@link Model#init} on the new instance, passing the {@link options}.
     * @public
     * @param {Object?} options - (optional) option object to be passed to {@link Model#init}.
     *     There are no system-defined options as of now, you're free to define your own.
     */
    static create(options) {
        const ModelClass = this;
        const model = new ModelClass();
        model.init(options);
        if (!model.id) throw Error(`${model} has no ID, did you call super.init(options)?`);
        return model;
    }

    /**
     * __Registers this model subclass with Croquet__, e.g.
     *
     *     class MyModel {
     *         ...
     *     }
     *     MyModel.register()
     *
     * @param {String?} file (optional) the file name this class was defined in, to distinguish between same class names in different files (default: `"<unknown>"`)
     * @param {String?} name (optional) a name for identifying this class in a snapshot (default: `this.name`)
     * @public
     */
    static register(file="<unknown>", name=this.name) {
        addClassHash(this);
        registerClass(file, name, this);
    }

    /**
     * __Static declaration of how to serialize non-model classes.__
     * The Croquet snapshot mechanism only knows about {@link Model} subclasses. If you want to store instances of non-model classes in your model, override this method.
     *
     * To use the default serializer just declare the class:
     *
     *     return {
     *         "THREE.Vector3": THREE.Vector3,
     *         "THREE.Quaternion": THREE.Quaternion,
     *     };
     *
     *  To define your own serializer, declare `read()` and `write()` methods, e.g.:
     *
     *     return {
     *         "THREE.Color": {
     *             cls: THREE.Color,
     *             write: color => '#' + color.getHexString(),
     *             read: state => new THREE.Color(state) },
     *         }
     *     };
     *
     * This is currently the only way to customize serialization (e.g. to keep snapshots fast and small). The serialization of Model subclasses can not be customized.
     * @public
     */
    static types() {
        return {};
    }

    static classToID(cls) {
        return classToID(cls);
    }

    static classFromID(id) {
        return classFromID(id);
    }

    static allClasses() {
        return allClasses();
    }

    /**
     * This is called by `Model.create(options)` to initialize a model instance.
     *
     * In your Model subclass this is the place to subscribe to events, or start a future message chain.
     *
     * Do not forget to call `super.init(options)` in your subclass.
     * @param {Object?} options - (optional) there are no system-defined options, you're free to define your own
     * @public
     */
    init(_options) {
        this.__realm = currentRealm();
        this.id = currentRealm().register(this);
    }

    destroy() {
        currentRealm().unsubscribeAll(this.id);
        currentRealm().deregister(this);
    }

    // Pub / Sub

    publish(scope, event, data) {
        if (!this.__realm) this.__realmError();
        this.__realm.publish(event, data, scope);
    }

    subscribe(scope, event, callback) {
        if (!this.__realm) this.__realmError();
        this.__realm.subscribe(event, this.id, callback, scope);
    }

    unsubscribe(scope, event) {
        if (!this.__realm) this.__realmError();
        this.__realm.unsubscribe(event, this.id, null, scope);
    }

    unsubscribeAll() {
        if (!this.__realm) this.__realmError();
        this.__realm.unsubscribeAll(this.id);
    }

    __realmError() {
        if (!this.id) throw Error(`${this} has no ID, did you call super.init(options)?`);
    }

    // Misc

    /** @returns {this} */
    future(tOffset=0) {
        if (!this.__realm) this.__realmError();
        return this.__realm.futureProxy(tOffset, this);
    }

    random() {
        return currentRealm().random();
    }

    now() {
        return currentRealm().now();
    }

    beWellKnownAs(name) {
        currentRealm().island.set(name, this);
    }

    wellKnownModel(name) {
        return this.__realm.island.get(name);
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
