import SeedRandom from "seedrandom";
import hotreload from "./hotreload.js";
import PriorityQueue from "./util/priorityQueue.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

let viewID = 0;
let CurrentIsland = null;

const Math_random = Math.random.bind(Math);
Math.random = () => {
    if (CurrentIsland) throw Error("You must use this.island.random() in model code!");
    return Math_random();
};

// this is the only place allowed to change CurrentIsland
const hotIsland = module.hot && module.hot.data && module.hot.data.setCurrent;
function execOnIsland(island, fn) {
    if (CurrentIsland) throw Error("Island confusion");
    if (!(island instanceof Island)) throw Error("not an island: " + island);
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

/** An island holds the models which are replicated by teatime,
 * a queue of messages, plus additional bookeeping to make
 * uniform pub/sub between models and views possible.*/
export default class Island {
    static current() { return CurrentIsland; }

    constructor(state = {}, initFn) {
        this.modelsById = {};
        this.viewsById = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
        // pending messages, sorted by time
        this.messages = new PriorityQueue((a, b) => a.before(b));
        this.modelViewEvents = [];
        execOnIsland(this, () => {
            // our synced random stream
            this._random = new SeedRandom(null, { state: state.random || true });
            this.id = state.id || this.randomID();
            this.time = state.time || 0;
            this.timeSeq = state.timeSeq || 0;
            if (state.models) {
                // create all models
                for (const modelState of state.models || []) {
                    const ModelClass = modelClassNamed(modelState.className);
                    new ModelClass(modelState);  // registers the model
                }
                // wire up models in second pass
                for (const modelState of state.models || []) {
                    const model = this.modelsById[modelState.id];
                    model.restoreObjectReferences(modelState, this.modelsById);
                }
                // restore messages
                for (const messageState of state.messages || []) {
                    const message = Message.fromState(messageState);
                    this.messages.add(message);
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

    futureSend(tOffset, receiver, partID, selector, args) {
        if (tOffset < 0) throw Error("attempt to send future message into the past");
        if (this.modelsById[receiver.id] !== receiver) throw Error("future send to unregistered model");
        const message = new Message(this.time + tOffset, ++this.timeSeq, receiver.id, partID, selector, args);
        this.messages.add(message);
    }

    // Convert model.parts[partID].future(tOffset).property(...args)
    // into this.futureSend(tOffset, model, partID, "property", args)
    futureProxy(tOffset, model, partID) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const island = this;
        const object = partID ? model.parts[partID] : model;
        return new Proxy(object, {
            get(_target, property) {
                if (typeof object[property] === "function") {
                    const methodProxy = new Proxy(object[property], {
                        apply(_method, _this, args) {
                            island.futureSend(tOffset, model, partID, property, args);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(object).constructor.name + " which is not a function");
            }
        });
    }

    advanceTo(time) {
        let message;
        while ((message = this.messages.peek()) && message.time <= time) {
            if (message.time < this.time) throw Error("past message encountered: " + message);
            this.messages.poll();
            this.time = message.time;
            message.executeOn(this);
        }
        this.time = time;
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
            for (const handler of this.modelSubscriptions[topic]) {
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
            const { scope, event, data } = this.modelViewEvents.pop();
            this.publishFromView(scope, event, data);
        }
    }

    publishFromView(scope, event, data) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        // Events published by views can only reach other views
        if (this.viewSubscriptions[topic]) {
            for (const handler of this.viewSubscriptions[topic]) {
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
            timeSeq: this.timeSeq,
            random: this._random.state(),
            models: Object.values(this.modelsById).map(model => model.asState()),
            messages: this.messages.asArray().map(message => message.asState()),
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


class Message {
    constructor(time, seq, receiver, part, selector, args) {
        this.time = time;
        this.seq = seq;
        this.receiver = receiver;
        this.part = part;
        this.selector = selector;
        this.args = JSON.parse(JSON.stringify(args));   // make sure args can be serialized
    }

    before(other) {
        return this.time !== other.time
            ? this.time < other.time
            : this.seq < other.seq;
    }

    asState() {
        return [this.time, this.seq, this.receiver, this.part, this.selector, this.args];
    }

    static fromState(state) {
        const [time, seq, receiver, part, selector, args] = state;
        return new Message(time, seq, receiver, part, selector, args);
    }

    executeOn(island) {
        const {receiver, part, selector, args} = this;
        execOnIsland(island, () => island.modelsById[receiver].parts[part][selector](...args));
    }
}

// TODO: move this back to model.js and declare a dependency on model.js
// once this pull request is in a Parcel release:
// https://github.com/parcel-bundler/parcel/pull/2660/

// map model class names to model classes
let ModelClasses = {};

function modelClassNamed(className) {
    if (ModelClasses[className]) return ModelClasses[className];
    // HACK: go through all exports and find model subclasses
    for (const m of Object.values(module.bundle.cache)) {
        for (const cls of Object.values(m.exports)) {
            if (cls && cls.__isTeatimeModelClass__) ModelClasses[cls.name] = cls;
        }
    }
    if (ModelClasses[className]) return ModelClasses[className];
    throw new Error(`Class "${className}" not found, is it exported?`);
}


hotreload.addDisposeHandler(module.id, () => ModelClasses = {});

if (module.hot) {
    // this is a workaround for our implicit dependency on model.js:
    // Since model.js might refer to an old version of this module,
    // we set CurrentIsland in both the current and previous module version
    module.hot.dispose(hotData => hotData.setCurrent = island => CurrentIsland = island);
}
