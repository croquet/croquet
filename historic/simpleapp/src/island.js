import { Socket } from "ws";    // eslint-disable-line import/no-extraneous-dependencies
import SeedRandom from "seedrandom";
import PriorityQueue from "./util/priorityQueue.js";
import AsyncQueue from './util/asyncQueue.js';
import hotreload from "./hotreload.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let viewID = 0;
let CurrentIsland = null;

const Math_random = Math.random.bind(Math);
Math.random = () => {
    if (CurrentIsland) throw Error("You must use this.island.random() in model code!");
    return Math_random();
};
hotreload.addDisposeHandler("math-random", () => Math.random = Math_random);

// this is the only place allowed to change CurrentIsland
function execOnIsland(island, fn) {
    if (CurrentIsland) throw Error("Island confusion");
    if (!(island instanceof Island)) throw Error("not an island: " + island);
    const previousIsland = CurrentIsland;
    try {
        CurrentIsland = island;
        window.ISLAND = island;
        fn();
    } finally {
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
        this.modelsByName = {};
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

    get(modelName) { return this.modelsByName[modelName]; }
    set(modelName, model) {
        if (CurrentIsland !== this) throw Error("Island Error");
        this.modelsByName[modelName] = model;
    }

    // Send via reflector
    callModelMethod(modelId, partId, selector, args) {
        if (CurrentIsland) throw Error("Island Error");
        const message = new Message(this.time, 0, modelId, partId, selector, args);
        this.controller.sendMessage(message);
    }

    sendNoop() {
        // this is only used for syncing after a snapshot
        // noop() isn't actually implemented, sends to island id
        // are filtered out in executeOn()
        const message = new Message(this.time, 0, this.id, 0, "noop", []);
        this.controller.sendMessage(message);
    }

    decodeScheduleAndExecute(msgData) {
        const message = Message.fromState(msgData);
        this.messages.add(message);
        this.advanceTo(message.time);
    }

    futureSend(tOffset, receiverID, partID, selector, args) {
        if (CurrentIsland !== this) throw Error("Island Error");
        if (tOffset < 0) throw Error("attempt to send future message into the past");
         // Wrapping below means that if we have an overflow, messages
        // scheduled after the overflow will be executed *before* messages
        // scheduled earlier. It won't lead to any collisions (this would require
        // wrap-around within a time slot) but it still is a problem since it
        // may cause unpredictable effects on the code.
        // The reflector uses a similar scheme with sequence numbers below 100000000.
        this.timeSeq = (this.timeSeq + 100000000) % 1000000000000000;
        const message = new Message(this.time + tOffset, this.timeSeq, receiverID, partID, selector, args);
        this.messages.add(message);
    }

    // Convert model.parts[partID].future(tOffset).property(...args)
    // into this.futureSend(tOffset, model.id, partID, "property", args)
    futureProxy(tOffset, model, partID) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const island = this;
        const object = partID ? model.parts[partID] : model;
        return new Proxy(object, {
            get(_target, property) {
                if (typeof object[property] === "function") {
                    const methodProxy = new Proxy(object[property], {
                        apply(_method, _this, args) {
                            if (island.modelsById[model.id] !== model) throw Error("future send to unregistered model");
                            island.futureSend(tOffset, model.id, partID, property, args);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(object).constructor.name + " which is not a function");
            }
        });
    }

    advanceTo(time) {
        if (CurrentIsland) throw Error("Island Error");
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

    removeAllViewSubscriptionsFor(subscriberId, part) {
        const handlerPrefix = subscriberId + "." + part;
        // TODO: optimize this - reverse lookup table?
        for (const topicSubscribers of Object.values(this.viewSubscriptions)) {
            for (const handler of topicSubscribers) {
                if (handler.startsWith(handlerPrefix)) {
                    topicSubscribers.delete(handler);
                }
            }
        }
    }

    publishFromModel(scope, event, data) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        if (this.modelSubscriptions[topic]) {
            for (const handler of this.modelSubscriptions[topic]) {
                const [subscriberId, partID, selector] = handler.split(".");
                this.futureSend(0, subscriberId, partID, selector, data ? [data] : []);
            }
        }
        // To ensure model code is executed bit-identically everywhere, we have to notify views
        // later, since different views might be subscribed in different island replicas
        if (this.viewSubscriptions[topic]) this.modelViewEvents.push({scope, event, data});
    }

    processModelViewEvents() {
        if (CurrentIsland) throw Error("Island Error");
        while (this.modelViewEvents.length > 0) {
            const { scope, event, data } = this.modelViewEvents.shift();
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

    asState() {
        return {
            id: this.id,
            time: this.time,
            timeSeq: this.timeSeq,
            random: this._random.state(),
            models: Object.values(this.modelsById).map(model => model.asState()),
            messages: this.messages.asUnsortedArray().map(message => message.asState()),
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


function socketSetup(socket) {
    Object.assign(socket, {
        onopen: _event => {
            console.log(socket.constructor.name, "connected");
            Controller.joinAll(socket);
        },
        onerror: _event => {
            console.log(socket.constructor.name, "error");
        },
        onclose: event => {
            console.log(socket.constructor.name, "closed:", event.code);
            if (event.code === 1006) {
                const error = document.getElementById("error");
                error.innerText = 'No Connection';
                console.log("no connection to server, setting up local server");
                // The following import runs the exact same code that's
                // executing on Node normally. It imports 'ws' which now
                // comes from our own fakeWS.js
                // ESLint doesn't know about the alias in package.json:
                // eslint-disable-next-line global-require,import/no-unresolved
                const server = require("reflector").server; // start up local server
                socketSetup(new Socket({server})); // connect to it
            }
        },
        onmessage: event => {
            Controller.receive(event.data);
        }
    });
    hotreload.addDisposeHandler("socket", () => socket.close());
}

socketSetup(new WebSocket('ws://localhost:9090/'));

// Controller

const Controllers = {};

export class Controller {
    // socket was connected, join session for all islands
    static joinAll(socket) {
        for (const controller of Object.values(Controllers)) {
            controller.join(socket);
        }
    }

    // dispatch to right controller
    static receive(data) {
        const { id, action, args } = JSON.parse(data);
        Controllers[id].receive(action, args);
    }

    constructor() {
        this.networkQueue = new AsyncQueue();
    }

    // handle messages from reflector
    receive(action, args) {
        switch (action) {
            case 'START': {
                // we are not joining an island but starting up cold
                this.islandCreator.callbackFn(this.island);
                break;
            }
            case 'RECV': {
                const msg = args;
                //if (msg.sender === this.senderID) this.addToStatistics(msg);
                this.networkQueue.put(msg);
                break;
            }
            case 'TICK': {
                const time = args;
                this.advanceTo(time);
                break;
            }
            case 'SERVE': {
                console.log('SERVE - replying with snapshot');
                this.socket.send(JSON.stringify({
                    action: args, // reply action
                    args: this.island.asState(),
                }));
                // and send a dummy message so that the other guy can play catch up
                this.island.sendNoop();
                break;
            }
            case 'SYNC': {
                console.log('SYNC - received snapshot');
                this.install(args);
                break;
            }
            default: console.log("Unknown action:", action);
        }
    }

    async install(snapshot) {
        const newIsland = this.islandCreator.creatorFn(snapshot);
        const newTime = newIsland.time;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const nextMsg = await this.networkQueue.next();
            if (nextMsg[0] > newTime) {
                // This is the first 'real' message arriving.
                newIsland.decodeScheduleAndExecute(nextMsg);
                this.setIsland(newIsland); // install island
                this.islandCreator.callbackFn(this.island);
                return; // done
            }
            // otherwise, silently skip the message
        }
    }

    setIsland(island) {
        this.island = island;
        this.island.controller = this;
    }

    newIsland(creatorFn, state, callbackFn=()=>{}) {
        this.islandCreator = { creatorFn, callbackFn };
        this.setIsland(creatorFn(state));
        Controllers[this.island.id] = this;
    }

    // network queue

    join(socket) {
        console.log('JOIN', this.island.id);
        this.socket = socket;
        socket.send(JSON.stringify({
            id: this.island.id,
            action: 'JOIN',
            args: this.island.time,
        }));
    }

    sendMessage(msg) {
        // SEND: Broadcast a message to all participants.
        this.socket.send(JSON.stringify({
            id: this.island.id,
            action: 'SEND',
            args: msg.asState(),
        }));
    }

    advanceTo(newTime) {
        if (!this.island) return;    // we are probably still sync-ing
        this.processMessages();      // process all the messages thus far
        this.island.advanceTo(newTime);
    }

    processMessages() {
        // Process pending messages for this island
        if (!this.island) return;     // we are probably still sync-ing
        let msgData;
        // Get the next message from the (concurrent) network queue
        while ((msgData = this.networkQueue.nextNonBlocking())) {
            // And have the island decode, schedule, and update to that message
            this.island.decodeScheduleAndExecute(msgData);
        }
    }
}


// Message encoders / decoders
//
// Eventually, these should be provided by the application
// to tailor the encoding for specific scenarios.
// (unless we find a truly efficient and general encoding scheme)

const XYZ = {
    encode: a => [a[0].x, a[0].y, a[0].z],
    decode: a => [{ x: a[0], y: a[1], z: a[2] }],
};

const XYZW = {
    encode: a => [a[0].x, a[0].y, a[0].z, a[0].w],
    decode: a => [{ x: a[0], y: a[1], z: a[2], w: a[3] }],
};

const transcoders = {
    "*.moveTo": XYZ,
    "*.rotateTo": XYZW,
};

function encode(receiver, part, selector, args) {
    if (args.length > 0) {
        const transcoder = transcoders[`${part}.${selector}`] || transcoders[`*.${selector}`] || transcoders['*'];
        if (!transcoder) throw Error(`No transcoder defined for ${part}.${selector}`);
        args = transcoder.encode(args);
    }
    return `${receiver}.${part}.${selector}${args.length > 0 ? JSON.stringify(args):""}`;
}

function decode(payload) {
    const [_, msg, argString] = payload.match(/^([^[]+)(\[.*)?$/);
    const [receiver, part, selector] = msg.split('.');
    let args = [];
    if (argString) {
        const transcoder = transcoders[`${part}.${selector}`] || transcoders[`*.${selector}`] || transcoders['*'];
        if (!transcoder) throw Error(`No transcoder defined for ${part}.${selector}`);
        args = transcoder.decode(JSON.parse(argString));
    }
    return {receiver, part, selector, args};
}

class Message {
    constructor(time, seq, receiver, part, selector, args) {
        this.time = time;
        this.seq = seq;
        this.payload = encode(receiver, part, selector, args);
    }

    before(other) {
        return this.time !== other.time
            ? this.time < other.time
            : this.seq < other.seq;
    }

    asState() {
        return [this.time, this.seq, this.payload];
    }

    static fromState(state) {
        const [time, seq, payload] = state;
        const { receiver, part, selector, args } = decode(payload);
        return new Message(time, seq, receiver, part, selector, args);
    }

    executeOn(island) {
        const { receiver, part, selector, args } = decode(this.payload);
        if (receiver === island.id) return; // noop
        let object = island.modelsById[receiver];
        if (part) object = object.parts[part];
        execOnIsland(island, () => object[selector](...args));
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

// flush ModelClasses after hot reload
hotreload.addDisposeHandler(module.id, () => ModelClasses = {});
