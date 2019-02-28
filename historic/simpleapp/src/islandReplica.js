import SeedRandom from "seedrandom";
import hotreload from "./hotreload.js";

const moduleVersion = "index.js v" + (module.bundle.v = (module.bundle.v || 0) + 1);
console.log("Loading " + moduleVersion);

let viewID = 0;
let CurrentIsland = null;

const Math_random = Math.random.bind(Math);
Math.random = () => CurrentIsland ? CurrentIsland.random() : Math_random();

// this is the only place allowed to change CurrentIsland
const hotIsland = module.hot && module.hot.data && module.hot.data.setCurrent;
function execOnIsland(island, fn) {
    if (CurrentIsland) throw Error("Island confusion");
    if (!(island instanceof IslandReplica)) throw Error("not an island: " + island);
    const previousIsland = CurrentIsland;
    try {
        if (hotIsland) hotIsland(island);
        CurrentIsland = island;
        fn();
    } finally {
        if (hotIsland) hotIsland(previousIsland);
        CurrentIsland = previousIsland;
    }
}

/** This is kind of a rough mock of what I expect TeaTime to provide
 * plus additional bookeeping "around" an island replica to make
 * uniform pub/sub between models and views possible.*/
export default class IslandReplica {
    static current() { return CurrentIsland; }

    constructor(state = {}, initFn) {
        this.modelsById = {};
        this.viewsById = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
        this.modelViewEvents = [];
        execOnIsland(this, () => {
            // our synced random stream
            this._random = new SeedRandom(null, { state: state.random || true });
            this.id = state.id || this.randomID();
            if (state.models) {
                // create all models
                for (let modelState of state.models || []) {
                    const ModelClass = modelClassNamed(modelState.className);
                    new ModelClass(modelState);  // registers the model
                }
                // wire up models in second pass
                for (let modelState of state.models || []) {
                    const model = this.modelsById[modelState.id];
                    model.restoreObjectReferences(modelState, this.modelsById);
                }
            } else initFn();
        });
    }

    registerModel(model, id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        if (!id) id = "M" + this.randomID();
        this.modelsById[id] = model;
        return id;
    }

    deregisterModel(id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        delete this.modelsById[id];
    }

    registerView(view) {
        if (CurrentIsland) throw Error("Island Error");
        const id = "V" + ++viewID;
        this.viewsById[id] = view;
        return id;
    }

    deregisterView(id) {
        if (CurrentIsland) throw Error("Island Error");
        delete this.viewsById[id];
    }

    // This will become in-directed via the Reflector
    callModelMethod(modelId, part, method, args, tOffset = 0) {
        if (tOffset) {
            hotreload.setTimeout(() => this.callModelMethod(modelId, part, method, args), tOffset);
        } else {
            const model = this.modelsById[modelId];
            execOnIsland(this, () => {
                if (part) {
                    model.parts[part][method](...args);
                } else {
                    model[method](...args);
                }
            });
        }
    }


    futureProxy(object, tOffset) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const island = this;
        return new Proxy(object, {
            get(target, property) {
                if (typeof target[property] === "function") {
                    const methodProxy = new Proxy(target[property], {
                        apply(_method, _this, args) {
                            // TODO: schedule in island queue
                            hotreload.setTimeout(() => {
                                execOnIsland(island, () => target[property](...args));
                            }, tOffset);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(target).constructor.name + " which is not a function");
            }
        });
    }


    addModelSubscription(scope, event, subscriberId, part, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + part + "." + methodName;
        if (!this.modelSubscriptions[topic]) this.modelSubscriptions[topic] = new Set();
        this.modelSubscriptions[topic].add(handler);
    }

    removeModelSubscription(scope, event, subscriberId, part, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + part + "." + methodName;
        if (this.modelSubscriptions[topic]) this.modelSubscriptions[topic].remove(handler);
    }

    addViewSubscription(scope, event, subscriberId, part, methodName) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + part + "." + methodName;
        if (!this.viewSubscriptions[topic]) this.viewSubscriptions[topic] = new Set();
        this.viewSubscriptions[topic].add(handler);
    }

    removeViewSubscription(scope, event, subscriberId, part, methodName) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + part + "." + methodName;
        if (this.viewSubscriptions[topic]) this.viewSubscriptions[topic].delete(handler);
    }

    publishFromModel(scope, event, data, tOffset) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        if (this.modelSubscriptions[topic]) {
            for (let handler of this.modelSubscriptions[topic]) {
                const [subscriberId, part, method] = handler.split(".");
                this.callModelMethod(subscriberId, part, method, [data], tOffset);
            }
        }
        // To ensure model code is executed bit-identically everywhere, we have to notify views
        // later, since different views might be subscribed in different island replicas
        if (this.viewSubscriptions[topic]) this.modelViewEvents.push({scope, event, data});
    }

    processModelViewEvents() {
        while (this.modelViewEvents.length > 0) {
            let { scope, event, data } = this.modelViewEvents.pop();
            this.publishFromView(scope, event, data);
        }
    }

    publishFromView(scope, event, data) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        // Events published by views can only reach other views
        if (this.viewSubscriptions[topic]) {
            for (let handler of this.viewSubscriptions[topic]) {
                const [subscriberId, part, method] = handler.split(".");
                const partInstance = this.viewsById[subscriberId].parts[part];
                partInstance[method].call(partInstance, data);
            }
        }
    }

    toState() {
        return {
            id: this.id,
            time: this.time,
            random: this._random.state(),
            models: Object.values(this.modelsById).map(model => {
                const state = {};
                model.toState(state);
                if (!state.id) throw Error(`No ID in ${model} - did you call super.toState()?`);
                return state;
            }),
        };
    }

    random() {
        if (CurrentIsland !== this) throw Error("Island Error");
        return this._random();
    }

    randomID() {
        if (CurrentIsland !== this) throw Error("Island Error");
        let id = '';
        for (let i = 0; i < 4; i++) {
            id += (this._random.int32() >>> 0).toString(16).padStart(8, '0');
        }
        return id;
    }
}


// map model class names to model classes
let ModelClasses = {};

function modelClassNamed(className) {
    if (ModelClasses[className]) return ModelClasses[className];
    // HACK: go through all exports and find model subclasses
    for (let m of Object.values(module.bundle.cache)) {
        for (let cls of Object.values(m.exports)) {
            if (cls.__isTeatimeModelClass__) ModelClasses[cls.name] = cls;
        }
    }
    if (ModelClasses[className]) return ModelClasses[className];
    throw new Error(`Class "${className}" not found, is it exported?`);
}


hotreload.addDisposeHandler(() => ModelClasses = {});


if (module.hot) {
    // this is a workaround for our implicit dependency on model.js:
    // Since model.js might refer to an old version of this module,
    // we set CurrentIsland in both the current and previous module version
    module.hot.dispose(hotData => hotData.setCurrent = island => CurrentIsland = island);
}
