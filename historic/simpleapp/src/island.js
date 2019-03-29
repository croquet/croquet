import SeedRandom from "seedrandom";
import PriorityQueue from "./util/priorityQueue.js";
import AsyncQueue from './util/asyncQueue.js';
import urlOptions from "./util/urlOptions.js";
import hotreload from "./hotreload.js";
import { hashModelCode, baseUrl } from "./modules.js";
import Stats from "./util/stats.js";


const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const DEBUG = {
    messages: false,
    ticks: false,
};

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
 * a queue of messages, plus additional bookkeeping to make
 * uniform pub/sub between models and views possible.*/
export default class Island {
    static current() { return CurrentIsland; }
    static encodeClassOf(obj) { return classToID(obj.constructor); }

    constructor(state = {}, initFn) {
        this.modelsById = {};
        this.viewsById = {};
        this.modelsByName = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
        // topics that had events since last frame
        this.frameTopics = new Set();
        // pending messages, sorted by time
        this.messages = new PriorityQueue((a, b) => a.before(b));
        execOnIsland(this, () => {
            // our synced random stream
            const seed = state.id; // okay to be undefined
            this._random = new SeedRandom(seed, { state: state.random || true });
            this.id = state.id || this.randomID();
            this.time = state.time || 0;
            this.timeSeq = state.timeSeq || 0;
            if (state.models) {
                // create all models
                for (const modelState of state.models || []) {
                    const ModelClass = classFromID(modelState.class);
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

    /** decode msgData and sort it into future queue
     * @param {MessageData} msgData - encoded message
     * @return {Message} decoded message
     */
    decodeAndSchedule(msgData) {
        const message = Message.fromState(msgData);
        this.messages.add(message);
        return message;
    }

    futureSend(tOffset, receiverID, partID, selector, args) {
        if (CurrentIsland !== this) throw Error("Island Error");
        if (tOffset < 0) throw Error("attempt to send future message into the past");
         // Wrapping below means that if we have an overflow, messages
        // scheduled after the overflow will be executed *before* messages
        // scheduled earlier. It won't lead to any collisions (this would require
        // wrap-around within a time slot) but it still is a problem since it
        // may cause unpredictable effects on the code.
        // Then again, if we produced 1000 messages at 60 fps it would still take
        // over 1000 years to wrap around. 2^53 is big.
        // To have a defined ordering between future messages generated on island
        // and messages from the reflector, we create even sequence numbers here and
        // the reflector's sequence numbers are made odd on arrival
        this.timeSeq = (this.timeSeq + 2) % (Number.MAX_SAFE_INTEGER + 1);
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

    /**
     * Process pending messages for this island and advance simulation.
     * Must only be sent by controller!
     * @param {Number} time - simulate up to this time
     * @param {Number} deadline - CPU time deadline for interrupting simulation
     * @returns {Boolean} true if finished simulation before deadline
     */
    advanceTo(time, deadline) {
        if (CurrentIsland) throw Error("Island Error");
        let count = 0;
        let message;
        while ((message = this.messages.peek()) && message.time <= time) {
            if (message.time < this.time) throw Error("past message encountered: " + message);
            this.messages.poll();
            this.time = message.time;
            message.executeOn(this);
            if (++count > 100) { count = 0; if (Date.now() > deadline) return false; }
        }
        this.time = time;
        return true;
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

    addViewSubscription(scope, event, subscriberId, part, methodName, oncePerFrame) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + part + "." + methodName;
        let subs = this.viewSubscriptions[topic];
        if (!subs) subs = this.viewSubscriptions[topic] = {
            data: [],
            onceHandlers: new Set(),
            queueHandlers: new Set(),
        };
        if (oncePerFrame) subs.onceHandlers.add(handler);
        else subs.queueHandlers.add(handler);
    }

    removeViewSubscription(scope, event, subscriberId, part, methodName) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + part + "." + methodName;
        const subs = this.viewSubscriptions[topic];
        if (subs) {
            subs.onceHandlers.delete(handler);
            subs.queueHandlers.delete(handler);
            if (subs.onceHandlers.size + subs.queueHandlers.size === 0) {
                delete this.viewSubscriptions[topic];
            }
        }
    }

    removeAllViewSubscriptionsFor(subscriberId, part) {
        const handlerPrefix = `${subscriberId}.${part}.`;
        // TODO: optimize this - reverse lookup table?
        for (const [topic, subs] of Object.entries(this.viewSubscriptions)) {
            for (const kind of ["onceHandlers", "queueHandlers"]) {
                for (const handler of subs[kind]) {
                    if (handler.startsWith(handlerPrefix)) {
                        subs.delete(handler);
                    }
                }
            }
            if (subs.onceHandlers.size + subs.queueHandlers.size === 0) {
                delete this.viewSubscriptions[topic];
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
        const topicSubscribers = this.viewSubscriptions[topic];
        if (topicSubscribers) {
            this.frameTopics.add(topic);
            if (topicSubscribers.queueHandlers.size > 0) {
                topicSubscribers.data.push(data);
                if (topicSubscribers.data.length % 1000 === 0) console.warn(`${topic} has ${topicSubscribers.data.length} events`);
            } else topicSubscribers.data[0] = data;
        }
    }

    processModelViewEvents() {
        if (CurrentIsland) throw Error("Island Error");
        // handle subscriptions for all new topics
        for (const topic of this.frameTopics) {
            const subscriptions = this.viewSubscriptions[topic];
            if (subscriptions) {
                this.handleViewEvents(topic, subscriptions.data);
                subscriptions.data.length = 0;
            }
        }
        this.frameTopics.clear();
    }

    publishFromView(scope, event, data) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        this.handleViewEvents(topic, [data]);
    }

    handleViewEvents(topic, dataArray) {
        // Events published by views can only reach other views
        const subscriptions = this.viewSubscriptions[topic];
        if (subscriptions) {
            for (const subscriber of subscriptions.queueHandlers) {
                const [subscriberId, part, method] = subscriber.split(".");
                const partInstance = this.viewsById[subscriberId].parts[part];
                for (const data of dataArray) partInstance[method](data);
            }
            const data = dataArray[dataArray.length - 1];
            for (const subscriber of subscriptions.onceHandlers) {
                const [subscriberId, part, method] = subscriber.split(".");
                const partInstance = this.viewsById[subscriberId].parts[part];
                partInstance[method](data);
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


    // HACK: create a clean island, and move all Spatial parts
    // to their initial position/rotation via reflector.
    // Also, stop and restart InertialSpatial parts.
    // Also, reset editable text
    broadcastInitialState() {
        const cleanIsland = this.controller.createCleanIsland();
        for (const [modelId, model] of Object.entries(this.modelsById)) {
            const cleanModel = cleanIsland.modelsById[modelId];
            if (!cleanModel) continue;
            for (const [partId, part] of Object.entries(model.parts)) {
                const cleanPart = cleanModel.parts[partId];
                if (!cleanPart) continue;
                if (part.position && typeof part.moveTo === "function"
                        && !part.position.equals(cleanPart.position)) {
                    this.callModelMethod(modelId, partId, "moveTo", [cleanPart.position]);
                    if (part.inInertiaPhase && typeof part.stop === "function") {
                        this.callModelMethod(modelId, partId, "stop", []);
                        if (typeof part.startInertiaPhase === "function") {
                            // This is such a hack: we need to wait for a tick that "cancels" the future messages
                            // before we can start it up again. Otherwise we get twice the number of future messages.
                            setTimeout(() => this.callModelMethod(modelId, partId, "startInertiaPhase", [], 1000));
                        }
                    }
                }
                if (part.quaternion && typeof part.rotateTo === "function"
                        && !part.quaternion.equals(cleanPart.quaternion)) {
                    this.callModelMethod(modelId, partId, "rotateTo", [cleanPart.quaternion]);
                }
                if (part.content && typeof part.updateContents === "function"
                        && part.content !== cleanPart.content) {
                    this.callModelMethod(modelId, partId, "updateContents", [cleanPart.content]);
                }
            }
        }
    }
}

function startReflectorInBrowser() {
    document.getElementById("error").innerText = 'No Connection';
    console.log("no connection to server, setting up local server");
    // The following import runs the exact same code that's
    // executing on Node normally. It imports 'ws' which now
    // comes from our own fakeWS.js
    hotreload.setTimeout(() => {
        // ESLint doesn't know about the alias in package.json:
        // eslint-disable-next-line global-require,import/no-unresolved
        const server = require("reflector").server; // start up local server
        // eslint-disable-next-line global-require,import/no-extraneous-dependencies
        const Socket = require("ws").Socket;
        socketSetup(new Socket({ server })); // connect to it
    }, 0);
    // we defer starting the server until hotreload has finished
    // loading all new modules
}

function socketSetup(socket) {
    document.getElementById("error").innerText = 'Connecting to ' + socket.url;
    Object.assign(socket, {
        onopen: _event => {
            if (socket.constructor === WebSocket) document.getElementById("error").innerText = '';
            console.log(socket.constructor.name, "connected to", socket.url);
            Controller.joinAll(socket);
        },
        onerror: _event => {
            document.getElementById("error").innerText = 'Connection error';
            console.log(socket.constructor.name, "error");
        },
        onclose: event => {
            document.getElementById("error").innerText = 'Connection closed:' + event.code + ' ' + event.reason;
            console.log(socket.constructor.name, "closed:", event.code, event.reason);
        },
        onmessage: event => {
            Controller.receive(event.data);
        }
    });
    hotreload.addDisposeHandler("socket", () => socket.readyState !== WebSocket.CLOSED && socket.close(1000, "hotreload "+moduleVersion));
}

const reflector = "reflector" in urlOptions ? urlOptions.reflector : "wss://dev1.os.vision/reflector-v1";
if (reflector && typeof reflector === 'string') socketSetup(new WebSocket(reflector));
else startReflectorInBrowser();

// Controller

const Controllers = {};
let TheSocket = null;

export class Controller {
    // socket was connected, join session for all islands
    static join(controller) {
        Controllers[controller.id] = controller;
        if (TheSocket) controller.join(TheSocket);
    }

    static joinAll(socket) {
        if (TheSocket) throw Error("TheSocket already set?");
        TheSocket = socket;
        for (const controller of Object.values(Controllers)) {
            if (!controller.socket) controller.join(socket);
        }
    }

    // dispatch to right controller
    static receive(data) {
        const { id, action, args } = JSON.parse(data);
        Controllers[id].receive(action, args);
    }

    /**
     * Generate an ID from a name and file versions.
     *
     * Two participants running the same code will generate the same ID
     * for the same name.
     * @param {String} name a name for the room.
     * @param {String} moduleID the ID of the module defining the room.
     * @returns {String} ID
     */
    static versionIDFor(name, moduleID) {
        return hashModelCode(name, moduleID);
    }

    constructor() {
        /** @type {Island} */
        this.island = null;
        /** the messages received from reflector */
        this.networkQueue = new AsyncQueue();
        /** the time of last message received from reflector */
        this.time = 0;
        /** the number of concurrent users in our island */
        this.users = 0;
    }

    /**
     * Create a new Island by requesting to join the reflector
     *
     * Detail: the island/session id is created from fileName and a hash of
     *         all source code that is imported by that file
     *
     * TODO: convert callback to promise
     * @param {String} name A (human-readable) name for the room
     * @param {{moduleID:String, creatorFn:Function}} creator The moduleID and function creating the island
     * @param {{}} snapshot The island's initial state (if hot-reloading)
     * @returns {Promise<Island>}
     */
    async createIsland(name, creator) {
        const {moduleID, creatorFn, options} = creator;
        if (options) name += JSON.stringify(Object.values(options)); // include options in hash
        this.islandCreator = { name, options, creatorFn, snapshot: {
            id: await Controller.versionIDFor(name, moduleID),
        }};
        console.log(`ID for ${name}: ${this.id}`);
        // try to fetch latest snapshot
        try {
            const snapshot = await this.fetchSnapshot();
            if (snapshot.id !== this.id) console.warn(name, 'resuming snapshot of different version!');
            this.islandCreator.snapshot = snapshot;
            console.log(this.id, `Controller got snapshot (time: ${Math.floor(snapshot.time)})`);
        } catch (e) {
            console.log(this.id, 'Controller got no snapshot');
        }

        return new Promise(resolve => {
            this.islandCreator.callbackFn = resolve;
            Controller.join(this);   // when socket is ready, join server
        });
    }

    takeSnapshot() {
        // put all pending messages into future queue
        this.scheduleAllPendingMessages();
        return this.island.asState();
    }

    snapshotUrl() {
        // name includes JSON options
        const options = this.islandCreator.name.split(/[^A-Z0-9]+/i);
        const snapshotName = `${options.filter(_=>_).join('-')}-${this.id}`;
        const base = baseUrl('snapshots');
        return `${base}${snapshotName}.json`;
    }

    /** upload a snapshot to the asset server */
    async uploadSnapshot(hashes) {
        if (!this.island) return;
        // take snapshot
        const snapshot = this.takeSnapshot();
        snapshot.meta = {
            date: (new Date()).toISOString(),
            host: window.location.hostname,
        };
        if (hashes) snapshot.meta.code = hashes;
        const string = JSON.stringify(snapshot);
        const url = this.snapshotUrl();
        console.log(this.id, `Controller uploading snapshot (${string.length} bytes) to ${url}`);
        await fetch(url, {
            method: "PUT",
            mode: "cors",
            headers: { "Content-Type": "application/json" },
            body: string,
        });
    }

    async fetchSnapshot() {
        const url = this.snapshotUrl();
        const response = await fetch(url, {
            mode: "cors",
        });
        return response.json();
    }

    /** @type String: this controller's island id */
    get id() {return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    // handle messages from reflector
    receive(action, args) {
        switch (action) {
            case 'START': {
                // We are starting a new island session.
                console.log(this.id, 'Controller received START - creating island');
                this.install(false);
                break;
            }
            case 'SYNC': {
                // We are joining an island session.
                this.islandCreator.snapshot = args;    // set snapshot
                console.log(this.id, 'Controller received SYNC - resuming snapshot');
                this.install(true);
                break;
            }
            case 'RECV': {
                // We received a message from reflector.
                // Put it in the queue, and set time.
                // Actual processing happens in main loop.
                if (DEBUG.messages) console.log(this.id, 'Controller received RECV ' + args);
                const msg = args;   // [time, seq, payload]
                const time = msg[0];
                const seq = msg[1];
                msg[1] = seq * 2 + 1;  // make odd timeSeq from controller
                //if (msg.sender === this.senderID) this.addToStatistics(msg);
                this.networkQueue.put(msg);
                this.timeFromReflector(time);
                break;
            }
            case 'TICK': {
                // We received a tick from reflector.
                // Just set time so main loop knows how far it can advance.
                if (!this.island) break; // ignore ticks before we are simulating
                const time = args;
                if (DEBUG.ticks) console.log(this.id, 'Controller received TICK ' + time);
                this.timeFromReflector(time);
                break;
            }
            case 'SERVE': {
                // We received a request to serve a current snapshot
                console.log(this.id, 'Controller received SERVE - replying with snapshot');
                const snapshot = this.takeSnapshot();
                // send the snapshot
                this.socket.send(JSON.stringify({
                    action: args, // reply action
                    args: snapshot,
                }));
                // and send a dummy message so that the other guy can drop
                // old messages in their controller.install()
                this.island.sendNoop();
                break;
            }
            case 'USERS': {
                // a user joined or left this island
                console.log(this.id, 'Controller received USERS', args);
                this.users = args;
                break;
            }
            default: console.warn("Unknown action:", action, args);
        }
    }

    async install(drainQueue=false) {
        const {snapshot, creatorFn, options, callbackFn} = this.islandCreator;
        const newIsland = creatorFn(snapshot, options);
        const newTime = newIsland.time;
        // eslint-disable-next-line no-constant-condition
        while (drainQueue) {
            // eslint-disable-next-line no-await-in-loop
            const nextMsg = await this.networkQueue.next();
            if (nextMsg[0] > newTime) {
                // This is the first 'real' message arriving.
                newIsland.decodeAndSchedule(nextMsg);
                drainQueue = false;
            }
            // otherwise, silently skip the message
        }
        this.setIsland(newIsland); // install island
        callbackFn(this.island);
    }

    setIsland(island) {
        this.island = island;
        this.island.controller = this;
    }

    // create an island in its initial state
    createCleanIsland() {
        const { options, creatorFn } = this.islandCreator;
        const snapshot = { id: this.id };
        return creatorFn(snapshot, options);
    }

    // network queue

    join(socket) {
        console.log(this.id, 'Controller sending JOIN');
        this.socket = socket;
        const time = this.islandCreator.snapshot.time || 0;
        socket.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args: time,
        }));
    }

    sendMessage(msg) {
        // SEND: Broadcast a message to all participants.
        if (DEBUG.messages) console.log(this.id, `Controller sending SEND ${msg.asState()}`);
        this.socket.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: msg.asState(),
        }));
    }

    /** Schedule all messages received from reflector as future messages in island */
    scheduleAllPendingMessages() {
        let msgData;
        // Get the next message from the (concurrent) network queue
        while ((msgData = this.networkQueue.nextNonBlocking())) {
            // And have the island decode and schedule that message
            this.island.decodeAndSchedule(msgData);
        }
    }

    get backlog() { return this.island ? this.time - this.island.time : 0; }

    /**
     * Process pending messages for this island and advance simulation
     * @param {Number} ms CPU time budget before interrupting simulation
     */
    simulate(ms = 1) {
        if (!this.island) return;     // we are probably still sync-ing
        Stats.begin("simulate");
        const deadline = Date.now() + ms;
        let weHaveTime = true;
        while (weHaveTime) {
            // Get the next message from the (concurrent) network queue
            const msgData = this.networkQueue.nextNonBlocking();
            if (!msgData) break;
            // have the island decode and schedule that message
            const msg = this.island.decodeAndSchedule(msgData);
            // simulate up to that message
            weHaveTime = this.island.advanceTo(msg.time, deadline);
        }
        if (weHaveTime) this.island.advanceTo(this.time, deadline);
        Stats.end("simulate");
        Stats.backlog(this.backlog);
    }

    /** Got the official time from reflector server */
    timeFromReflector(time) {
        this.time = time;
        if (this.island) Stats.backlog(this.backlog);
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

const Identity = {
    encode: a => a,
    decode: a => a,
};

const transcoders = {
    "*.moveTo": XYZ,
    "*.rotateTo": XYZW,
    "*.onKeyDown": Identity,
    "*.updateContents": Identity,
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

// Symbol for storing class ID in constructors
const CLASS_ID = Symbol('CLASS_ID');

function gatherModelClasses() {
    // HACK: go through all exports and find model subclasses
    ModelClasses = {};
    for (const [file, m] of Object.entries(module.bundle.cache)) {
        for (const cls of Object.values(m.exports)) {
            if (cls && cls.__isTeatimeModelClass__) {
                // create a classID for this class
                const id = `${file}:${cls.name}`;
                const dupe = ModelClasses[id];
                if (dupe) throw Error(`Duplicate Model subclass "${id}" in ${file} and ${dupe.file}`);
                ModelClasses[id] = {cls, file};
                cls[CLASS_ID] = id;
            }
        }
    }
}

function classToID(cls) {
    if (cls[CLASS_ID]) return cls[CLASS_ID];
    gatherModelClasses();
    if (cls[CLASS_ID]) return cls[CLASS_ID];
    throw Error(`Class "${cls.name}" not found, is it exported?`);
}

function classFromID(classID) {
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    gatherModelClasses();
    if (ModelClasses[classID]) return ModelClasses[classID].cls;
    throw Error(`Class "${classID}" not found, is it exported?`);
}

// flush ModelClasses after hot reload
hotreload.addDisposeHandler(module.id, () => ModelClasses = {});
