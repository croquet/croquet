import SeedRandom from "seedrandom";
import PriorityQueue from "./util/priorityQueue.js";
import AsyncQueue from './util/asyncQueue.js';
import hotreload from "./hotreload.js";
import { hashModelCode, baseUrl } from "./modules.js";
import { inModelRealm, StatePart } from "./modelView.js";
import Stats from "./util/stats.js";
import { PATH_PART_SEPARATOR_SPLIT_REGEXP } from "./parts.js";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const DEBUG = {
    messages: false,
    ticks: false,
};

let viewID = 0;
/** @type {Island} */
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
    static latest() { return module.bundle.v && module.bundle.v[module.id] || 0; }
    static version() { return moduleVersion; }
    static current() {
        if (!CurrentIsland) console.warn(`No CurrentIsland in v${moduleVersion}!`);
        return CurrentIsland;
    }

    constructor(snapshot, initFn) {
        if (moduleVersion !== Island.latest()) throw Error("Hot Reload problem: Instantiating old Island v" + moduleVersion);

        this.topLevelModelsById = {};
        this.viewsById = {};
        this.modelsByName = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
        /** topics that had events since last frame */
        this.frameTopics = new Set();
        /** pending messages, sorted by time and sequence number */
        this.messages = new PriorityQueue((a, b) => a.before(b));
        execOnIsland(this, () => {
            inModelRealm(this, () => {
                /** @type {SeedRandom} our synced pseudo random stream */
                this._random = () => { throw Error("You must not use random when applying state!"); };
                /** @type {String} island ID */
                this.id = snapshot.id; // the controller always provides an ID
                /** @type {Number} how far simulation has progressed */
                this.time = snapshot.time || 0;
                /** @type {Number} timestamp of last external message */
                this.externalTime = snapshot.externalTime || 0;
                /** @type {Number} sequence number for disambiguating messages with same timestamp */
                this.sequence = snapshot.sequence || 0;
                if (snapshot.models) {
                    // create all models, uninitialized, but already registered
                    for (const modelState of snapshot.models || []) {
                        const model = StatePart.constructFromState(modelState);
                        model.registerRecursively(modelState, true);
                    }

                    for (const [modelName, modelId] of Object.entries(snapshot.namedModels)) {
                        this.set(modelName, this.lookUpModel(modelId));
                    }

                    // restore model snapshot, allow resolving object references
                    for (const modelState of snapshot.models || []) {
                        const model = this.topLevelModelsById[modelState.id];
                        model.restore(modelState, this.topLevelModelsById);
                        model.restoreDone();
                    }
                    // restore messages
                    for (const messageState of snapshot.messages || []) {
                        const message = Message.fromState(messageState);
                        this.messages.add(message);
                    }
                    // now it's safe to use stored random
                    this._random = new SeedRandom(null, { state: snapshot.random });
                } else {
                    // create new random, it is okay to use in init code
                    this._random = new SeedRandom(null, { state: true });
                    initFn(this);
                }
            });
        });
    }

    registerModel(model, id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        if (!id) id = "M" + this.randomID();
        this.topLevelModelsById[id] = model;
        return id;
    }

    deregisterModel(id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        delete this.topLevelModelsById[id];
    }

    lookUpModel(id) {
        const [topLevelModelId, rest] = id.split(PATH_PART_SEPARATOR_SPLIT_REGEXP);
        if (rest) {
            return this.topLevelModelsById[topLevelModelId].lookUp(rest);
        }
        return this.topLevelModelsById[topLevelModelId];
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
    callModelMethod(modelId, subPartPath, selector, args) {
        if (CurrentIsland) throw Error("Island Error");
        const recipient = this.lookUpModel(modelId).lookUp(subPartPath).id;
        const message = new Message(this.time, 0, recipient, selector, args);
        this.controller.sendMessage(message);
    }

    sendNoop() {
        // this is only used for syncing after a snapshot
        // noop() isn't actually implemented, sends to island id
        // are filtered out in executeOn()
        const message = new Message(this.time, 0, this.id, "noop", []);
        this.controller.sendMessage(message);
    }

    /** decode msgData and sort it into future queue
     * @param {MessageData} msgData - encoded message
     * @return {Message} decoded message
     */
    processExternalMessage(msgData) {
        const message = Message.fromState(msgData);
        this.messages.add(message);
        this.externalTime = message.time; // we have all external messages up to this time
        return message;
    }

    futureSend(tOffset, receiverID, selector, args) {
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
        this.sequence = (this.sequence + 2) % (Number.MAX_SAFE_INTEGER + 1);
        const message = new Message(this.time + tOffset, this.sequence, receiverID, selector, args);
        this.messages.add(message);
    }

    // Convert model.future(tOffset).property(...args)
    // into this.futureSend(tOffset, model.id, "property", args)
    futureProxy(tOffset, model) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const island = this;
        return new Proxy(model, {
            get(_target, property) {
                if (typeof model[property] === "function") {
                    const methodProxy = new Proxy(model[property], {
                        apply(_method, _this, args) {
                            if (island.lookUpModel(model.id) !== model) throw Error("future send to unregistered model");
                            island.futureSend(tOffset, model.id, property, args);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(model).constructor.name + " which is not a function");
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

    addModelSubscription(scope, event, subscriberId, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + methodName;
        if (!this.modelSubscriptions[topic]) this.modelSubscriptions[topic] = new Set();
        this.modelSubscriptions[topic].add(handler);
    }

    removeModelSubscription(scope, event, subscriberId, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + methodName;
        if (this.modelSubscriptions[topic]) this.modelSubscriptions[topic].remove(handler);
    }

    addViewSubscription(scope, event, subscriberId, methodName, oncePerFrame) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + methodName;
        let subs = this.viewSubscriptions[topic];
        if (!subs) subs = this.viewSubscriptions[topic] = {
            data: [],
            onceHandlers: new Set(),
            queueHandlers: new Set(),
        };
        if (oncePerFrame) subs.onceHandlers.add(handler);
        else subs.queueHandlers.add(handler);
    }

    removeViewSubscription(scope, event, subscriberId, methodName) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + methodName;
        const subs = this.viewSubscriptions[topic];
        if (subs) {
            subs.onceHandlers.delete(handler);
            subs.queueHandlers.delete(handler);
            if (subs.onceHandlers.size + subs.queueHandlers.size === 0) {
                delete this.viewSubscriptions[topic];
            }
        }
    }

    removeAllViewSubscriptionsFor(subscriberId) {
        const handlerPrefix = `${subscriberId}.`;
        // TODO: optimize this - reverse lookup table?
        for (const [topic, subs] of Object.entries(this.viewSubscriptions)) {
            for (const kind of ["onceHandlers", "queueHandlers"]) {
                for (const handler of subs[kind]) {
                    if (handler.startsWith(handlerPrefix)) {
                        delete subs[handler];
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
                const [subscriberId, selector] = handler.split(".");
                this.futureSend(0, subscriberId, selector, data ? [data] : []);
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
                const [subscriberId, method] = subscriber.split(".");
                const view = this.viewsById[subscriberId];
                for (const data of dataArray) view[method](data);
            }
            const data = dataArray[dataArray.length - 1];
            for (const subscriber of subscriptions.onceHandlers) {
                const [subscriberId, method] = subscriber.split(".");
                const view = this.viewsById[subscriberId];
                view[method](data);
            }
        }
    }

    asState() {
        const namedModels = {};

        for (const [modelName, model] of Object.entries(this.modelsByName)) {
            namedModels[modelName] = model.id;
        }

        return {
            id: this.id,
            time: this.time,
            externalTime: this.externalTime,
            sequence: this.sequence,
            random: this._random.state(),
            models: Object.values(this.topLevelModelsById).map(model => {
                const state = {};
                model.toState(state);
                return state;
            }),
            namedModels,
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
        for (const [modelId, model] of Object.entries(this.topLevelModelsById)) {
            const cleanModel = cleanIsland.topLevelModelsById[modelId];
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


async function startReflectorInBrowser() {
    document.getElementById("error").innerText = 'No Connection';
    console.log("Starting in-browser reflector");
    // we defer starting the server until hotreload has finished
    // loading all new modules
    await hotreload.waitTimeout(0);
    // The following import runs the exact same code that's
    // executing on Node normally. It imports 'ws' which now
    // comes from our own fakeWS.js
    // ESLint doesn't know about the alias in package.json:
    // eslint-disable-next-line global-require,import/no-unresolved
    require("reflector"); // start up local server
    // we could return require("reflector").server._url
    // to connect to our server.
    // However, we want to discover servers in other tabs
    // so we use the magic port 0 to connect to that.
    return 'channel://server:0/';
}

function newInBrowserSocket(server) {
    // eslint-disable-next-line global-require,import/no-extraneous-dependencies
    const Socket = require("ws").Socket;
    return new Socket({ server });
}

export async function connectToReflector(reflectorUrl) {
    let socket;
    if (typeof reflectorUrl !== "string") reflectorUrl = await startReflectorInBrowser();
    if (reflectorUrl.match(/^wss?:/)) socket = new WebSocket(reflectorUrl);
    else if (reflectorUrl.match(/^channel:/)) socket = newInBrowserSocket(reflectorUrl);
    else throw Error('Cannot interpret reflector address ' + reflectorUrl);
    socketSetup(socket, reflectorUrl);
}

function socketSetup(socket, reflectorUrl) {
    document.getElementById("error").innerText = 'Connecting to ' + socket.url;
    Object.assign(socket, {
        onopen: _event => {
            if (socket.constructor === WebSocket) document.getElementById("error").innerText = '';
            console.log(socket.constructor.name, "connected to", socket.url);
            Controller.joinAll(socket);
            Stats.connected(true);
        },
        onerror: _event => {
            document.getElementById("error").innerText = 'Connection error';
            console.log(socket.constructor.name, "error");
        },
        onclose: event => {
            document.getElementById("error").innerText = 'Connection closed:' + event.code + ' ' + event.reason;
            console.log(socket.constructor.name, "closed:", event.code, event.reason);
            Stats.connected(false);
            Controller.leaveAll();
            if (event.code !== 1000) {
                // if abnormal close, try to connect again
                document.getElementById("error").innerText = 'Reconnecting ...';
                hotreload.setTimeout(() => connectToReflector(reflectorUrl), 1000);
            }
        },
        onmessage: event => {
            Controller.receive(event.data);
        }
    });
    hotreload.addDisposeHandler("socket", () => socket.readyState !== WebSocket.CLOSED && socket.close(1000, "hotreload "+moduleVersion));
}


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

    // socket was disconnected, destroy all islands
    static leaveAll() {
        if (!TheSocket) return;
        TheSocket = null;
        for (const controller of Object.values(Controllers)) {
            controller.leave();
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
        this.reset();
    }

    reset() {
        /** @type {Island} */
        this.island = null;
        /** the (shared) websocket for talking to the reflector */
        this.socket = null;
        /** the messages received from reflector */
        this.networkQueue = new AsyncQueue();
        /** the time of last message received from reflector */
        this.time = 0;
        /** the number of concurrent users in our island */
        this.users = 0;
        /** wallclock time we last heard from reflector */
        this.lastReceived = Date.now();
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
        const {moduleID, options} = creator;
        if (options) name += JSON.stringify(Object.values(options)); // include options in hash
        const id = await Controller.versionIDFor(name, moduleID);
        console.log(`ID for ${name}: ${id}`);
        this.islandCreator = {
            name,
            ...creator,
        };
        if (!this.islandCreator.snapshot) {
            this.islandCreator.snapshot = { id, time: 0, meta: { created: (new Date()).toISOString() } };
        }
        if (this.islandCreator.snapshot.id !== id) console.warn(`Resuming snapshot on different code base!`);
        return new Promise(resolve => {
            this.islandCreator.callbackFn = resolve;
            Controller.join(this);   // when socket is ready, join server
        });
    }

    takeSnapshot() {
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
        if (this.lastSnapshotTime === this.island.time) return;
        this.lastSnapshotTime = this.island.time;
        // take snapshot
        const snapshot = this.takeSnapshot();
        snapshot.meta = {
            ...this.islandCreator.snapshot.meta,
            room: this.islandCreator.room,
            options: this.islandCreator.options,
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

    async updateSnapshot() {
        // try to fetch latest snapshot
        try {
            const snapshot = await this.fetchSnapshot();
            if (snapshot.id !== this.id) {
                console.warn(this.id ,'fetched snapshot of different version!');
                snapshot.originalID = snapshot.id;
                snapshot.id = this.id;
            }
            if (snapshot.time >= this.islandCreator.snapshot.time) {
                this.islandCreator.snapshot = snapshot;
                console.log(this.id, `Controller fetched snapshot (time: ${Math.floor(snapshot.time)})`);
            } else {
                console.log(this.id, "Controller fetched snapshot but older than local" +
                    ` (remote: ${snapshot.time}, local: ${this.islandCreator.snapshot.time})`);
            }
        } catch (e) {
            console.log(this.id, 'Controller got no snapshot');
        }
    }

    /** @type String: this controller's island id */
    get id() {return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    // handle messages from reflector
    receive(action, args) {
        this.lastReceived = Date.now();
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
                msg[1] = seq * 2 + 1;  // make odd sequence from controller
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
                if (!this.island) { console.log("SERVE no island"); break; } // can't serve if we don't have an island
                if (this.backlog > 1000) { console.log("SERVE backlog", this.backlog); break; } // don't serve if we're not up-to-date
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
        const snapshotTime = newIsland.time;
        this.time = snapshotTime;
        // eslint-disable-next-line no-constant-condition
        while (drainQueue) {
            // eslint-disable-next-line no-await-in-loop
            const nextMsg = await this.networkQueue.next();
            if (nextMsg[0] > snapshotTime) {
                // This is the first 'real' message arriving.
                newIsland.processExternalMessage(nextMsg);
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

    async join(socket) {
        if (this.fetchUpdatedSnapshot) await this.updateSnapshot();
        console.log(this.id, 'Controller sending JOIN');
        this.socket = socket;
        const time = this.islandCreator.snapshot.time || 0;
        socket.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args: time,
        }));
    }

    leave() {
        const island = this.island;
        this.reset();
        if (!this.islandCreator) throw Error("do not discard islandCreator!");
        const {destroyerFn} = this.islandCreator;
        if (destroyerFn) {
            const snapshot = island.asState();
            destroyerFn(snapshot);
        }
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

    get backlog() { return this.island ? this.time - this.island.time : 0; }

    /**
     * Process pending messages for this island and advance simulation
     * @param {Number} deadline CPU time deadline before interrupting simulation
     */
    simulate(deadline) {
        if (!this.island) return;     // we are probably still sync-ing
        Stats.begin("simulate");
        let weHaveTime = true;
        while (weHaveTime) {
            // Get the next message from the (concurrent) network queue
            const msgData = this.networkQueue.nextNonBlocking();
            if (!msgData) break;
            // have the island decode and schedule that message
            const msg = this.island.processExternalMessage(msgData);
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
    "*#moveTo": XYZ,
    "*#rotateTo": XYZW,
    "*#onKeyDown": Identity,
    "*#updateContents": Identity,
};

export function addMessageTranscoder(pattern, encoder, decoder) {
    transcoders[pattern] = {encode: encoder, decode: decoder};
}

function encode(receiver, selector, args) {
    if (args.length > 0) {
        const transcoder = transcoders[`${receiver}#${selector}`] || transcoders[`*#${selector}`] || transcoders['*'];
        if (!transcoder) throw Error(`No transcoder defined for ${receiver}#${selector}`);
        args = transcoder.encode(args);
    }
    return `${receiver}#${selector}${args.length > 0 ? JSON.stringify(args):""}`;
}

function decode(payload) {
    const [_, msg, argString] = payload.match(/^([a-z0-9.#]+)(.*)$/i);
    const [receiver, selector] = msg.split('#');
    let args = [];
    if (argString) {
        const transcoder = transcoders[`${receiver}#${selector}`] || transcoders[`*#${selector}`] || transcoders['*'];
        if (!transcoder) throw Error(`No transcoder defined for ${receiver}#${selector}`);
        args = transcoder.decode(JSON.parse(argString));
    }
    return {receiver, selector, args};
}

class Message {
    constructor(time, seq, receiver, selector, args) {
        this.time = time;
        this.seq = seq;
        this.payload = encode(receiver, selector, args);
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
        const { receiver, selector, args } = decode(payload);
        return new Message(time, seq, receiver, selector, args);
    }

    executeOn(island) {
        const { receiver, selector, args } = decode(this.payload);
        if (receiver === island.id) return; // noop
        const object = island.lookUpModel(receiver);
        execOnIsland(island, () => {
            inModelRealm(island, () => object[selector](...args));
        });
    }
}
