import hotreload from "@croquet/util/hotreload";
import { currentRealm } from "./realms";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class Model {
    // mark this and subclasses as model classes
    // used in classToID / classFromID below
    static __isTeatimeModelClass__() { return true; }
    static registerClass(file, cls) { return registerClass(file, cls, true); }

    static create(options) {
        const ModelClass = this;
        const model = new ModelClass();
        model.init(options);
        if (!model.id) throw Error(`${model} has no ID, did you call super.init(options)?`);
        return model;
    }

    static classFromState(state) {
        const ModelClass = classFromID(state.class);
        return ModelClass;
    }

    init(_options) {
        this.__realm = currentRealm();
        this.id = currentRealm().register(this);
    }

    destroy() {
        currentRealm().unsubscribeAll(this.id);
        currentRealm().deregister(this);
    }

    load(state, allModels) {
        this.__realm = currentRealm();
        const id = state.id;
        if (!allModels) throw Error(`Did ${this}.load() forget to pass allModels as super.load(state, allModels)?`);
        if (!allModels[id] === this) throw Error("Model ID mismatch");
        this.id = state.id;
    }

    save(state) {
        state.id = this.id;
        state.class = classToID(this.constructor);
    }

    // Pub / Sub

    publish(scope, event, data) {
        this.__realm.publish(event, data, scope);
    }

    subscribe(scope, event, callback) {
        this.__realm.subscribe(event, this.id, callback, scope);
    }

    unsubscribe(scope, event) {
        this.__realm.unsubscribe(event, this.id, null, scope);
    }

    // Misc

    /** @returns {this} */
    future(tOffset=0) {
        return this.__realm.futureProxy(tOffset, this);
    }

    random() {
        return currentRealm().random();
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
        for (const cls of Object.values(m.exports)) {
            if (cls && cls.__isTeatimeModelClass__) {
                registerClass(file, cls, false);
            }
        }
    }
}

function classToID(cls) {
    if (cls.hasOwnProperty(CLASS_ID)) return cls[CLASS_ID];
    gatherModelClasses();
    if (cls.hasOwnProperty(CLASS_ID)) return cls[CLASS_ID];
    throw Error(`Class "${cls.name}" not found, is it exported?`);
}

function classFromID(classID) {
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    gatherModelClasses();
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    throw Error(`Class "${classID}" not found, is it exported?`);
}

function registerClass(file, cls, warnAboutDupes) {
    // create a classID for this class
    const id = `${file}:${cls.name}`;
    const dupe = ModelClasses[id];
    if (dupe) {
        if (warnAboutDupes) console.warn(`deduplicating class ${cls.name} from ${file}`);
        return cls;
    }
    if (cls.hasOwnProperty(CLASS_ID)) {
        console.warn(`ignoring re-exported class ${cls.name} from ${file}`);
    } else {
        console.log(`registering class ${cls.name} from ${file}`);
        cls[CLASS_ID] = id;
    }
    ModelClasses[id] = {cls, file};
    return cls;
}

// flush ModelClasses after hot reload
hotreload.addDisposeHandler(module.id, () => ModelClasses = {});
