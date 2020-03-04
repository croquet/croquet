import SeedRandom from "seedrandom/seedrandom";
import PriorityQueue from "@croquet/util/priorityQueue";
import "@croquet/math"; // creates window.CroquetMath
import { displayWarning, displayAppError } from "@croquet/util/html";
import Model from "./model";
import { inModelRealm, inViewRealm } from "./realms";
import { viewDomain } from "./domain";

/** @type {Island} */
let CurrentIsland = null;

/** function cache */
const QFuncs = {};

/** to be used as callback, e.g. QFunc({foo}, bar => this.baz(foo, bar))
 * @param {Object} vars - the captured variables
 * @param {Function} fn - the callback function
 */
export function QFunc(vars, fn) {
    if (typeof vars === "function") { fn = vars; vars = {}; }
    const qPara = Object.keys(vars).concat(["return " + fn]);
    const qArgs = Object.values(vars);
    const qFunc = {qPara, qArgs};
    const fnIndex = qArgs.indexOf(fn);
    if (fnIndex >= 0) { qArgs[fnIndex] = qPara[fnIndex]; qFunc.qFn = fnIndex; }
    return `{${btoa(JSON.stringify(qFunc))}}`;
}

function bindQFunc(qfunc, thisArg) {
    const { qPara, qArgs, qFn } = JSON.parse(atob(qfunc.slice(1, -1)));
    const cacheKey = JSON.stringify(qPara);
    // eslint-disable-next-line no-new-func
    const compiled = QFuncs[cacheKey] || (QFuncs[cacheKey] = new Function(...qPara));
    if (typeof qFn === "number") qArgs[qFn] = compiled;
    return compiled.call(thisArg, ...qArgs).bind(thisArg);
}


// this is the only place allowed to set CurrentIsland
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

// a variation of execOnIsland where the previous island does not have to be null
function execOnIslandNoCheck(island, fn) {
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

function execOffIsland(fn) {
    if (!CurrentIsland) throw Error("Island confusion");
    const previousIsland = CurrentIsland;
    try {
        CurrentIsland = null;
        fn();
    } finally {
        CurrentIsland = previousIsland;
    }
}

const VOTE_SUFFIX = '#__vote'; // internal, for 'vote' handling; never seen by user
const REFLECTED_SUFFIX = '#reflected';
const DIVERGENCE_SUFFIX = '#divergence';

/** An island holds the models which are replicated by teatime,
 * a queue of messages, plus additional bookkeeping to make
 * uniform pub/sub between models and views possible.*/
export default class Island {
    static current() {
        if (!CurrentIsland) console.warn(`No CurrentIsland!`);
        return CurrentIsland;
    }

    static installCustomMath() {
        // patch Math.random, and transcendentals as defined in "@croquet/math"
        if (!window.BrowserMath) {
            window.CroquetMath.random = () => CurrentIsland.random();
            window.BrowserMath = {};
            for (const [funcName, croquetMath] of Object.entries(window.CroquetMath)) {
                const browserMath = window.Math[funcName];
                window.BrowserMath[funcName] = browserMath;
                window.Math[funcName] = ["pow", "atan2"].includes(funcName)
                    ? (arg1, arg2) => CurrentIsland ? croquetMath(arg1, arg2) : browserMath(arg1, arg2)
                    : arg => CurrentIsland ? croquetMath(arg) : browserMath(arg);
            }
        }
    }

    constructor(snapshot, initFn) {
        Island.installCustomMath(); // trivial if already installed

        execOnIsland(this, () => {
            inModelRealm(this, () => {
                /** all the models in this island */
                this.modelsById = {};
                /** named entry points to models (so a view can attach to it) */
                this.modelsByName = {};
                /** pending messages, sorted by time and sequence number */
                this.messages = new PriorityQueue((a, b) => a.before(b));
                /** @type {{"scope:event": Array<String>}} model subscriptions */
                this.subscriptions = {};
                /** @type {{"id": "name"}} active users */
                this.users = {};
                /** @type {SeedRandom} our synced pseudo random stream */
                this._random = () => { throw Error("You must not use random when applying state!"); };
                /** @type {String} island ID */
                this.id = snapshot.id; // the controller always provides an ID
                /** @type {Number} how far simulation has progressed */
                this.time = 0;
                /** @type {Number} sequence number of last executed external message */
                this.seq = 0xFFFFFFF0;       // start value provokes 32 bit rollover soon
                /** @type {Number} timestamp of last scheduled external message */
                this.externalTime = 0;
                /** @type {Number} sequence number of last scheduled external message */
                this.externalSeq = this.seq;
                /** @type {Number} sequence number for disambiguating future messages with same timestamp */
                this.futureSeq = 0;
                /** @type {Number} sequence number of last sent TUTTI */
                this.tuttiSeq = 0;
                /** @type {Number} simulation time when last pollForSnapshot was executed */
                this.lastSnapshotPoll = 0;
                /** @type {Number} number for giving ids to model */
                this.modelsId = 0;
                if (snapshot.modelsById) {
                    // read island from snapshot
                    const reader = IslandReader.newOrRecycled(this);
                    const islandData = reader.readIsland(snapshot, "$");
                    // only read keys declared above
                    for (const key of Object.keys(islandData)) {
                        if (!(key in this) && key !== "meta") console.warn(`Ignoring property snapshot.${key}`);
                        else if (key === "messages") for (const msg of islandData.messages) this.messages.add(msg);
                        else this[key] = islandData[key];
                    }
                } else {
                    // create new random, it is okay to use in init code
                    this._random = new SeedRandom(null, { state: true });
                    const namedModels = initFn(this) || {};
                    Object.assign(this.modelsByName, namedModels);
                    this.addSubscription(this, this.id, "__users__", this.generateJoinExit);
                }
            });
        });
    }

    registerModel(model, id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        if (!id) id = this.id + "/M" + ++this.modelsId;
        this.modelsById[id] = model;
        // not assigning the id here catches missing super calls in init() and load()
        return id;
    }

    deregisterModel(id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const model = this.modelsById;
        delete this.modelsById[id];
        for (const [name, value] of Object.entries(this.modelsByName)) {
            if (model === value) delete this.modelsByName[name];
        }
        this.messages.removeMany(msg => msg.hasReceiver(id));
    }

    lookUpModel(id) {
        if (id === this.id) return this;
        const model = this.modelsById[id];
        if (model) return model;
        const [_, modelID, partId] = id.match(/^([^#]+)#(.*)$/);
        return this.modelsById[modelID].lookUp(partId);
    }

    get(modelName) { return this.modelsByName[modelName]; }
    set(modelName, model) {
        if (CurrentIsland !== this) throw Error("Island Error");
        this.modelsByName[modelName] = model;
    }

    getNextTuttiSeq() {
        this.tuttiSeq = (this.tuttiSeq + 1) >>> 0;
        return this.tuttiSeq;
    }

    // Send via reflector
    callModelMethod(modelId, selector, args) {
        if (CurrentIsland) throw Error("Island Error");
        const model = this.lookUpModel(modelId);
        if (!model) { console.error(Error(`Model not found: ${modelId}`)); return; }
        const message = new Message(this.time, 0, model.id, selector, args);
        this.controller.sendMessage(message);
    }

    // used in Controller.convertReflectorMessage()
    noop() {}

    generateJoinExit({entered, exited, count}) {
        if (entered.length === count) exited = Object.keys(this.users);
        else exited = exited.map(each => each[0]); // get id
        for (const id of exited) {
            if (this.users[id]) {
                delete this.users[id];
                this.publishFromModel(this.id, "view-exit", id);
            }
        }
        // [id, name] was provided to reflector in controller.join()
        // reflector may have added location as {region, city: {name, lat, lng}}
        for (const [id, name, location] of entered) {
            if (!this.users[id]) {
                this.users[id] = { name };
                if (location) this.users[id].location = location;
                this.publishFromModel(this.id, "view-join", id);
            }
        }
    }

    /** decode msgData and sort it into future queue
     * @param {MessageData} msgData - encoded message
     * @return {Message} decoded message
     */
    scheduleExternalMessage(msgData) {
        const message = Message.fromState(msgData, this);
        if (message.time < this.time) throw Error("past message from reflector " + msgData);
        const nextSeq = (this.externalSeq + 1) >>> 0;
        if (message.seq !== nextSeq) throw Error(`External message error. Expected message #${nextSeq} got #${message.seq}`);
        this.externalTime = message.time; // we have all external messages up to this time
        this.externalSeq = message.seq; // we have all external messages up to this sequence number
        message.seq = message.seq * 2 + 1;  // make odd sequence for external messages
        this.messages.add(message);
        return message;
    }

    futureSend(tOffset, receiverID, selector, args) {
        if (tOffset.every) return this.futureRepeat(tOffset.every, receiverID, selector, args);
        if (tOffset < 0) throw Error("attempt to send future message into the past");
        // Wrapping below is fine because the message comparison function deals with it.
        // To have a defined ordering between future messages generated on island
        // and messages from the reflector, we create even sequence numbers here and
        // the reflector's sequence numbers are made odd on arrival
        this.futureSeq = (this.futureSeq + 1) >>> 0;
        const message = new Message(this.time + tOffset, 2 * this.futureSeq, receiverID, selector, args);
        this.messages.add(message);
        return message;
    }

    futureRepeat(tOffset, receiverID, selector, args) {
        this.futureSend(tOffset, this.id, "futureExecAndRepeat", [tOffset, receiverID, selector, args]);
    }

    futureExecAndRepeat(tOffset, receiverID, selector, args) {
        const model = this.lookUpModel(receiverID);
        if (typeof model[selector] === "function") {
            try {
                model[selector](...args);
            } catch (error) {
                displayAppError(`future message ${model}.${selector}`, error);
            }
        } else {
            const fn = bindQFunc(selector, model);
            try {
                fn(...args);
            } catch (error) {
                displayAppError(`future message ${model} ${fn}`, error);
            }
        }
        this.futureRepeat(tOffset, receiverID, selector, args);
    }


    // Convert model.future(tOffset).property(...args)
    // or model.future(tOffset, "property",...args)
    // into this.futureSend(tOffset, model.id, "property", args)
    future(model, tOffset, methodNameOrCallback, methodArgs) {
        const methodName = this.asQFunc(model, methodNameOrCallback);
        if (typeof methodName === "string") {
            return this.futureSend(tOffset, model.id, methodName, methodArgs);
        }
        const island = this;
        return new Proxy(model, {
            get(_target, property) {
                if (typeof model[property] === "function") {
                    return (...args) => {
                        if (island.lookUpModel(model.id) !== model) throw Error("future send to unregistered model");
                        return island.futureSend(tOffset, model.id, property, args);
                    };
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(model).constructor.name + " which is not a function");
            }
        });
    }

    /**
     * Process pending messages for this island and advance simulation time.
     * Must only be sent by controller!
     * @param {Number} newTime - simulate at most up to this time
     * @param {Number} deadline - CPU time deadline for interrupting simulation
     * @returns {Boolean} true if finished simulation before deadline
     */
    advanceTo(newTime, deadline) {
        if (CurrentIsland) throw Error("Island Error");
        let count = 0;
        let message;
        // process each message in queue up to newTime
        while ((message = this.messages.peek()) && message.time <= newTime) {
            const { time, seq } = message;
            if (time < this.time) throw Error("past message encountered: " + message);
            // if external message, check seq so we don't miss any
            if (seq & 1) {
                this.seq = (this.seq + 1) >>> 0;  // uint32 rollover
                if ((seq/2) >>> 0 !== this.seq) throw Error(`Sequence error: expected ${this.seq} got ${(seq/2) >>> 0} in ${message}`);
            }
            // drop first message in message queue
            this.messages.poll();
            // advance time
            this.time = message.time;
            // execute future or external message
            message.executeOn(this);
            // make date check cheaper by only checking every 100 messages
            if (++count > 100) { count = 0; if (Date.now() > deadline) return false; }
        }
        // we processed all messages up to newTime
        this.time = newTime;
        return true;
    }

    // Pub-sub

    asQFunc(model, func) {
        // if a string was passed in, assume it's a method name
        if (typeof func === "string") return func;
        // if a function was passed in, hope it was a method
        if (typeof func === "function") {
            // if passing this.method
            if (model[func.name] === func) return func.name;
            // if passing this.foo = this.method
            let obj = model;
            while (obj !== null) {
                for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
                    if (desc.value === func) return name;
                }
                obj = Object.getPrototypeOf(obj);
            }
            // if passing (foo) => this.bar(baz)
            // match:                (   foo             )   =>  this .  bar              (    baz               )
            const HANDLER_REGEX = /^\(?([a-z][a-z0-9]*)?\)? *=> *this\.([a-z][a-z0-9]*) *\( *([a-z][a-z0-9]*)? *\) *$/i;
            const source = func.toString();
            const match = source.match(HANDLER_REGEX);
            if (match && (!match[3] || match[3] === match[1])) return match[2];
            // otherwise, wrap the function in a QFunc
            return QFunc(func);
        }
        return null;
    }

    addSubscription(model, scope, event, methodNameOrCallback) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const methodName = this.asQFunc(model, methodNameOrCallback);
        if (typeof methodName !== "string") {
            throw Error(`Subscription handler for "${event}" must be a method name`);
        }

        if (methodName.indexOf('.') < 0 && typeof model[methodName] !== "function") {
            if (methodName[0] !== '{') throw Error(`Subscriber method for "${event}" not found: ${model}.${methodName}()`);
        }
        const topic = scope + ":" + event;
        const handler = model.id + "." + methodName;
        // model subscriptions need to be ordered, so we're using an array
        if (!this.subscriptions[topic]) this.subscriptions[topic] = [];
        else if (this.subscriptions[topic].indexOf(handler) !== -1) {
            throw Error(`${model}.${methodName} already subscribed to ${event}`);
        }
        this.subscriptions[topic].push(handler);
    }

    removeSubscription(model, scope, event, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = model.id + "." + methodName;
        const handlers = this.subscriptions[topic];
        if (handlers) {
            const indexToRemove = handlers.indexOf(handler);
            handlers.splice(indexToRemove, 1);
            if (handlers.length === 0) delete this.subscriptions[topic];
        }
    }

    removeAllSubscriptionsFor(model) {
        const topicPrefix = `${model.id}:`;
        const handlerPrefix = `${model.id}.`;
        // TODO: optimize this - reverse lookup table?
        for (const [topic, handlers] of Object.entries(this.subscriptions)) {
            if (topic.startsWith(topicPrefix)) delete this.subscriptions[topic];
            else {
                for (let i = handlers.length - 1; i >= 0; i--) {
                    if (handlers[i].startsWith(handlerPrefix)) {
                        handlers.splice(i, 1);
                    }
                }
                if (handlers.size === 0) delete this.subscriptions[topic];
            }
        }
    }

    publishFromModel(scope, event, data, isInterIsland) {
        if (CurrentIsland !== this) throw Error("Island Error");
        // @@ hack for forcing reflection of model-to-model messages
        const reflected = event.endsWith(REFLECTED_SUFFIX);
        if (reflected) event = event.slice(0, event.length - REFLECTED_SUFFIX.length);
        const topic = scope + ":" + event;
        if (!isInterIsland) {
            this.handleModelEventInModel(topic, data, reflected);
            this.handleModelEventInView(topic, data);
        } else {
            if (window.isMaster) {
                this.publishFromModelAsView(topic, data);
            }
        }
    }

    publishFromView(scope, event, data) {
        if (CurrentIsland) throw Error("Island Error");
        let oldIsland = window.ISLAND;
        const topic = scope + ":" + event;
        for (let key in window.ISLANDS) {
            let island = window.ISLANDS[key];
            try {
                CurrentIsland = island;
                window.ISLAND = island;
                island.handleViewEventInModel(topic, data);
            } finally {
                CurrentIsland = null;
                window.ISLAND = oldIsland;
            }
        }
        this.handleViewEventInView(topic, data);
    }

    publishFromModelAsView(topic, data) {
        for (let key in window.ISLANDS) {
            let island = window.ISLANDS[key];
            execOnIslandNoCheck(island, () => {
                island.handleViewEventInModel(topic, data);
            });
        }
    }

    handleModelEventInModel(topic, data, reflect=false) {
        // model=>model events are handled synchronously unless reflected
        // because making them async would mean having to use future messages
        if (CurrentIsland !== this) throw Error("Island Error");
        if (reflect) {
            const tuttiSeq = this.getNextTuttiSeq(); // increment, whether we send or not
            if (this.controller.synced !== true) return;

            const voteTopic = topic + VOTE_SUFFIX;
            const divergenceTopic = topic + DIVERGENCE_SUFFIX;
            const wantsVote = !!viewDomain.subscriptions[voteTopic], wantsFirst = !!this.subscriptions[topic], wantsDiverge = !!this.subscriptions[divergenceTopic];
            if (wantsVote && wantsDiverge) console.log(`divergence subscription for ${topic} overridden by vote subscription`);
            // iff there are subscribers to a first message, build a candidate for the message that should be broadcast
            const firstMessage = wantsFirst ? new Message(this.time, 0, this.id, "handleModelEventInModel", [topic, data]) : null;
            // provide the receiver, selector and topic for any eventual tally response from the reflector.
            // if there are subscriptions to a vote, it'll be a handleModelEventInView with
            // the vote-augmented topic.  if not, default to our handleTuttiDivergence.
            let tallyTarget;
            if (wantsVote) tallyTarget = [this.id, "handleModelEventInView", voteTopic];
            else tallyTarget = [this.id, "handleTuttiDivergence", divergenceTopic];
            this.controller.sendTutti(this.time, tuttiSeq, data, firstMessage, wantsVote, tallyTarget);
        } else if (this.subscriptions[topic]) {
            for (const handler of this.subscriptions[topic]) {
                const [id, ...rest] = handler.split('.');
                const methodName = rest.join('.');
                const model = this.lookUpModel(id);

                
                if (!model) {
                    displayWarning(`event ${topic} .${methodName}(): subscriber not found`);
                    continue;
                }
                if (methodName.indexOf('.') < 0) {
                    if (typeof model[methodName] !== "function") {
                        console.log(`event ${topic} ${model}.${methodName}(): method not found`);
                        continue;
                    } else {
                        try {
                            model[methodName](data);
                        } catch (error) {
                            console.log(`event ${topic} ${model}.${methodName}()`, error);
                        }
                    }
                } else {
                    try {
                        let split = methodName.split('.');
                        model.call(split[0], split[1], data);
                    } catch (error) {
                        console.log(`event ${topic} ${model}.${methodName}()`, error);
                    }
                }
            }
        }
    }

    handleViewEventInModel(topic, data) {
        // view=>model events are converted to model=>model events via reflector
        if (this.subscriptions[topic]) {
            const message = new Message(this.time, 0, this.id, "handleModelEventInModel", [topic, data]);
            this.controller.sendMessage(message);
        }
    }

    handleModelEventInView(topic, data) {
        viewDomain.handleEvent(topic, data, fn => execOffIsland(() => inViewRealm(this, fn, true)));
    }

    handleViewEventInView(topic, data) {
        viewDomain.handleEvent(topic, data);
    }

    handleTuttiDivergence(divergenceTopic, data) {
        if (this.subscriptions[divergenceTopic]) this.handleModelEventInModel(divergenceTopic, data);
        else {
            const event = divergenceTopic.split(":").slice(-1)[0];
            console.warn(`uncaptured divergence in ${event}:`, data);
        }
    }

    processModelViewEvents() {
        if (CurrentIsland) throw Error("Island Error");
        return inViewRealm(this, () => viewDomain.processFrameEvents(!!this.controller.synced));
    }

    // DEBUG SUPPORT - NORMALLY NOT USED
    pollToCheckSync() {
        const tuttiSeq = this.getNextTuttiSeq(); // move it along, even if we won't be using it
        if (this.controller.synced !== true) return;

        const before = Date.now();
        const data = { date_island: this.time, hash: this.getSummaryHash() };
        const elapsed = Date.now() - before;
        this.controller.cpuTime -= elapsed; // give ourselves a time credit for the non-simulation work

        const voteMessage = [this.id, "handleSyncCheckVote", "syncCheckVote"]; // topic is ignored
        this.controller.sendTutti(this.time, tuttiSeq, data, null, true, voteMessage);
    }

    handleSyncCheckVote(_topic, data) {
        this.controller.handleSyncCheckVote(data);
    }

    pollForSnapshot() {
        const tuttiSeq = this.getNextTuttiSeq(); // move it along, even if this client decides not to participate

        // make sure there isn't a clash between clients simultaneously deciding
        // that it's time for someone to take a snapshot.
        const now = this.time;
        const sinceLast = now - this.lastSnapshotPoll;
        if (sinceLast < 5000) { // arbitrary - needs to be long enough to ensure this isn't part of the same batch
            console.log(`rejecting snapshot poll ${sinceLast}ms after previous`);
            return;
        }

        this.lastSnapshotPoll = now; // whether or not the controller agrees to participate

        const voteData = this.controller.preparePollForSnapshot(); // at least resets cpuTime
        if (!voteData) return; // not going to vote, so don't waste time on creating the hash

        const before = Date.now();
        voteData.hash = this.getSummaryHash();
        const elapsed = Date.now() - before;
        this.controller.cpuTime -= elapsed; // give ourselves a time credit for the non-simulation work

        // sending the vote is handled asynchronously, because we want to add a view-side random()
        Promise.resolve().then(() => this.controller.pollForSnapshot(now, tuttiSeq, voteData));
    }

    handleSnapshotVote(_topic, data) {
        this.controller.handleSnapshotVote(data);
    }

    snapshot() {
        const writer = IslandWriter.newOrRecycled(this);
        return writer.snapshot(this, "$");
    }

    // return an object describing the island - currently { oC, mC, nanC, infC, zC, nC, nH, sC, sL, fC } - for checking agreement between instances
    getSummaryHash() {
        return new IslandHasher().getHash(this);
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


function encode(receiver, selector, args) {
    if (args.length > 0) {
        const encoder = MessageArgumentEncoder.newOrRecycled();
        args = encoder.encode(args);
    }
    return `${receiver}>${selector}${args.length > 0 ? JSON.stringify(args):""}`;
}

function decode(payload, island) {
    const [_, msg, argString] = payload.match(/^([^[]+)(\[.*)?$/i);
    const [receiver, selector] = msg.split('>');
    let args = [];
    if (argString) {
        const decoder = MessageArgumentDecoder.newOrRecycled(island);
        args = decoder.decode(JSON.parse(argString));
    }
    return {receiver, selector, args};
}

function hasReceiver(payload, id) {
    return payload.startsWith(`${id}>`);
}

/** Answer true if seqA comes before seqB:
 * - sequence numbers are 32 bit unsigned ints with overflow
 * - seqA comes before seqB if it takes fewer increments to
 *    go from seqA to seqB (zero increments counts) than
 *    going from seqB to seqA
 * @typedef {Number} Uint32
 * @argument {Uint32} seqA
 * @argument {Uint32} seqB
 */
export function inSequence(seqA, seqB) {
    return ((seqB - seqA) | 0) >= 0;     // signed difference works with overflow
}

export class Message {
    constructor(time, seq, receiver, selector, args) {
        this.time = time;
        this.seq = seq;
        this.payload = encode(receiver, selector, args);
    }

    // Messages are generally sorted by time
    // For the same time stamp, we sort reflected messages after future messages
    // because otherwise it would depend on timing where the external message is put
    // (e.g when there are many future messages for the same time, we simulate a few,
    // and then insert an external message)
    before(other) {
        // sort by time
        if (this.time !== other.time) return this.time < other.time;
        // internal before external
        if (this.isExternal() !== other.isExternal()) return other.isExternal();
        return this.isExternal()
            ? inSequence(this.externalSeq, other.externalSeq)
            : inSequence(this.internalSeq, other.internalSeq);
    }

    hasReceiver(id) { return hasReceiver(this.payload, id); }

    isExternal() { return this.seq & 1; }
    get externalSeq() { return (this.seq / 2) >>> 0; }
    set externalSeq(seq) { this.seq = seq * 2 + 1; }
    get internalSeq() { return (this.seq / 2) >>> 0; }
    set internalSeq(seq) { this.seq = seq * 2; }

    asState() {
        // controller relies on this being a 3-element array
        return [this.time, this.seq, this.payload];
    }

    static fromState(state, island) {
        const [time, seq, payload] = state;
        const { receiver, selector, args } = decode(payload, island);
        return new Message(time, seq, receiver, selector, args);
    }

    executeOn(island) {
        const { receiver, selector, args } = decode(this.payload, island);
        const object = island.lookUpModel(receiver);
        if (!object) displayWarning(`${this.shortString()} ${selector}(): receiver not found`);
        else if (selector[0] === '{') {
            const fn = bindQFunc(selector, object);
            execOnIsland(island, () => {
                inModelRealm(island, () => {
                    try {
                        fn(...args);
                    } catch (error) {
                        displayAppError(`${this.shortString()} ${fn}`, error);
                    }
                });
            });
        } else if (typeof object[selector] !== "function") {
            displayWarning(`${this.shortString()} ${object}.${selector}(): method not found`);
        } else execOnIsland(island, () => {
            inModelRealm(island, () => {
                try {
                    object[selector](...args);
                } catch (error) {
                    displayAppError(`${this.shortString()} ${object}.${selector}()`, error);
                }
            });
        });
    }

    shortString() {
        return `${this.isExternal() ? 'External' : 'Future'}Message`;
    }

    toString() {
        const { receiver, selector, args } = decode(this.payload);
        const ext = this.isExternal();
        const seq = ext ? this.externalSeq : this.internalSeq;
        return `${ext ? 'External' : 'Future'}Message[${this.time}${':#'[+ext]}${seq} ${receiver}.${selector}(${args.map(JSON.stringify).join(', ')})]`;
    }

    [Symbol.toPrimitive]() { return this.toString(); }
}

/*
const sumForFloat = (() => {
    const float = new Float64Array(1);
    const ints = new Int32Array(float.buffer);
    return fl => {
        float[0] = fl;
        return ints[0] + ints[1];
        };
    })();
*/
const sumForFloat = (() => {
    // use DataView so we can enforce little-endian interpretation of float as ints on any platform
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    return fl => {
        view.setFloat64(0, fl, true);
        return view.getInt32(0, true) + view.getInt32(4, true);
    };
    })();

// IslandHasher walks the object tree gathering statistics intended to help
// identify divergence between island instances.
class IslandHasher {
    constructor() {
        this.refs = new Map();
        this.todo = []; // we use breadth-first writing to limit stack depth
        this.hashers = new Map();
        this.addHasher("Teatime:Message", Message);
        for (const [classId, ClassOrSpec] of Model.allClassTypes()) {
            this.addHasher(classId, ClassOrSpec);
        }
    }

    addHasher(classId, ClassOrSpec) {
        const { cls, write } = (Object.getPrototypeOf(ClassOrSpec) === Object.prototype) ? ClassOrSpec
            : { cls: ClassOrSpec, write: obj => Object.assign({}, obj) };
        this.hashers.set(cls, obj => this.hashStructure(obj, write(obj)));
    }

    /** @param {Island} island */
    getHash(island) {
        this.hashState = {
            oC: 0, // count of JS Objects
            mC: 0, // count of models
            nanC: 0, // count of NaNs
            infC: 0, // count of Infinities (+ve or -ve)
            zC: 0, // count of zeros
            nC: 0, // count of non-zero finite numbers
            nH: 0, // sum of the Int32 parts of non-zero numbers treated as Float64s
            sC: 0, // number of strings
            sL: 0,  // sum of lengths of strings
            fC: 0  // count of future messages
        };

        for (const [key, value] of Object.entries(island)) {
            if (key === "controller") continue;
            if (key === "meta") continue;
            if (key === "_random") this.hash(value.state(), false);
            else if (key === "messages") {
                const messageArray = value.asArray(); // from PriorityQueue
                const count = this.hashState.fC = messageArray.length;
                if (count) this.hash(messageArray, false);
            } else this.hashEntry(key, value);
        }
        this.hashDeferred();
        return this.hashState;
    }

    hashDeferred() {
        while (this.todo.length > 0) {
            const { key, value } = this.todo.shift();
            this.hashEntry(key, value, false);
        }
    }

    hash(value, defer = true) {
        switch (typeof value) {
            case "number":
                if (Number.isNaN(value)) this.hashState.nanC++;
                else if (!Number.isFinite(value)) this.hashState.infC++;
                else if (value===0) this.hashState.zC++;
                else {
                    this.hashState.nC++;
                    this.hashState.nH += sumForFloat(value);
                }
                return;
            case "string":
                this.hashState.sC++;
                this.hashState.sL += value.length;
                return;
            case "boolean":
            case "undefined":
                return;
            default: {
                const type = Object.prototype.toString.call(value).slice(8, -1);
                switch (type) {
                    case "Array":
                        this.hashArray(value, defer);
                        return;
                    case "Set":
                    case "Map":
                    case "Uint8Array":
                    case "Uint16Array":
                    case "Float32Array":
                        this.hashStructure(value, [...value]);
                        return;
                    case "Object":
                        if (value instanceof Model) this.hashModel(value);
                        else if (value.constructor === Object) this.hashObject(value, defer);
                        else {
                            const hasher = this.hashers.get(value.constructor);
                            if (hasher) hasher(value);
                            else throw Error(`Don't know how to hash ${value.constructor.name}`);
                        }
                        return;
                    case "Null": return;
                    default:
                        throw Error(`Don't know how to hash ${type}`);
                }
            }
        }
    }

    hashModel(model) {
        if (this.refs.has(model)) return;
        this.hashState.mC++;
        this.refs.set(model, true);      // register ref before recursing
        for (const [key, value] of Object.entries(model)) {
            if (key === "__realm") continue;
            if (value !== undefined) this.hashEntry(key, value);
        }
    }

    hashObject(object, defer = true) {
        if (this.refs.has(object)) return;
        this.hashState.oC++;
        this.refs.set(object, true);      // register ref before recursing
        for (const [key, value] of Object.entries(object)) {
            if (value !== undefined) this.hashEntry(key, value, defer);
        }
    }

    hashArray(array, defer = true) {
        if (this.refs.has(array)) return;
        this.refs.set(array, true);       // register ref before recursing
        for (let i = 0; i < array.length; i++) {
            this.hashEntry(i, array[i], defer);
        }
    }

    hashStructure(object, value) {
        if (value === undefined) return;
        if (this.refs.has(object)) return;
        this.refs.set(object, true);      // register ref before recursing
        this.hash(value, false);
    }

    hashEntry(key, value, defer = true) {
        if (key[0] === '$') { displayWarning(`snapshot: ignoring property ${key}`, { only: "once" }); return; }
        if (defer && typeof value === "object") {
            this.todo.push({ key, value });
            return;
        }
        this.hash(value);
    }
}

/*
// conversion buffer for writeFloat()
const floats = new Float64Array(2);
const ints = new Uint32Array(floats.buffer);
*/

class IslandWriter {
    static newOrRecycled(island) {
        let inst = this.reusableInstance;
        if (!inst) {
            inst = this.reusableInstance = new this(island);
        } else {
            inst.island = island;
            inst.nextRef = 1;
            inst.refs = new Map();
            inst.todo = [];
        }
        return inst;
    }

    static get reusableInstance() { return this[this.name + "-instance"]; }

    static set reusableInstance(val) { this[this.name + "-instance"] = val; }

    static resetInstance() { this.reusableInstance = null; }

    constructor(island) {
        this.island = island;
        this.nextRef = 1;
        this.refs = new Map();
        this.todo = []; // we use breadth-first writing to limit stack depth
        this.writers = new Map();
        this.addWriter("Teatime:Message", Message);
        for (const [classId, ClassOrSpec] of Model.allClassTypes()) {
            this.addWriter(classId, ClassOrSpec);
        }
    }

    addWriter(classId, ClassOrSpec) {
        const {cls, write} = (Object.getPrototypeOf(ClassOrSpec) === Object.prototype) ? ClassOrSpec
            : {cls: ClassOrSpec, write: obj => Object.assign({}, obj)};
        this.writers.set(cls, (obj, path) => this.writeAs(classId, obj, write(obj), path));
    }

    /** @param {Island} island */
    snapshot(island) {
        const state = {
            _random: island._random.state(),
            messages: this.write(island.messages.asArray()),
        };
        for (const [key, value] of Object.entries(island)) {
            if (key === "controller") continue;
            if (!state[key]) this.writeInto(state, key, value, "$");
        }
        this.writeDeferred();
        return state;
    }

    writeDeferred() {
        while (this.todo.length > 0) {
            const {state, key, value, path} = this.todo.shift();
            this.writeInto(state, key, value, path, false);
        }
    }

    write(value, path, defer=true) {
        switch (typeof value) {
            case "number":
                // JSON disallows NaN and Infinity
                if (Number.isSafeInteger(value)) return value;
                if (Number.isNaN(value)) return {$class: 'NaN'};
                if (!Number.isFinite(value)) return {$class: 'Infinity', $value: Math.sign(value)};
                return this.writeFloat(value);
            case "string":
            case "boolean":
            case "undefined":
                return value;
            default: {
                const type = Object.prototype.toString.call(value).slice(8, -1);
                switch (type) {
                    case "Array": return this.writeArray(value, path, defer);
                    case "Set":
                    case "Map":
                    case "Uint8Array":
                    case "Uint16Array":
                    case "Float32Array":
                        return this.writeAs(type, value, [...value], path);
                    case "Object": {
                        if (value instanceof Model) return this.writeModel(value, path);
                        if (value.constructor === Object) return this.writeObject(value, path, defer);
                        const writer = this.writers.get(value.constructor);
                        if (writer) return writer(value, path);
                        throw Error(`Don't know how to write ${value.constructor.name} at ${path}`);
                    }
                    case "Null": return value;
                    default:
                        throw Error(`Don't know how to write ${type} at ${path}`);
                }
            }
        }
    }

    writeModel(model, path) {
        if (this.refs.has(model)) return this.writeRef(model);
        const state = {
            $model: Model.classToID(model.constructor),
        };
        this.refs.set(model, state);      // register ref before recursing

        /* see comment in writeObject
        const descriptors = Object.getOwnPropertyDescriptors(model);
        for (const key of Object.keys(descriptors).sort()) {
            if (key === "__realm") continue;
            const descriptor = descriptors[key];
            if (descriptor.value !== undefined) {
                this.writeInto(state, key, descriptor.value, path);
            }
        }
        */

        for (const key of Object.keys(model).sort()) {
            if (key === "__realm") continue; // not enumerable in a Model, but is set directly in a ModelPart
            const value = model[key];
            if (value !== undefined) this.writeInto(state, key, value, path);
        }

        return state;
    }

    writeObject(object, path, defer=true) {
        if (this.refs.has(object)) return this.writeRef(object);
        const state = {};
        this.refs.set(object, state);      // register ref before recursing

        /* (ael & bf, aug 2019)
            originally went through property descriptors, which is slower than Object.keys.
            not sure if there was a particular reason for doing so.
        const descriptors = Object.getOwnPropertyDescriptors(object);
        for (const key of Object.keys(descriptors).sort()) {
            const descriptor = descriptors[key];
            if (descriptor.value !== undefined) {
                this.writeInto(state, key, descriptor.value, path, defer);
            }
        }
        */

        for (const key of Object.keys(object).sort()) {
            const value = object[key];
            if (value !== undefined) this.writeInto(state, key, value, path, defer);
        }

        return state;
    }

    writeArray(array, path, defer=true) {
        if (this.refs.has(array)) return this.writeRef(array);
        const state = [];
        this.refs.set(array, state);       // register ref before recursing
        for (let i = 0; i < array.length; i++) {
            this.writeInto(state, i, array[i], path, defer);
        }
        return state;
    }

    writeFloat(value) {
        /* original test of serialization.  never found an error.  disabled for now.
        floats[0] = value;
        floats[1] = JSON.parse(JSON.stringify(value));
        if (ints[0] !== ints[2] || ints[1] !== ints[3]) throw Error("Float serialization error");
        */
        return value;
    }

    writeAs(classID, object, value, path) {
        if (value === undefined) return value;
        if (this.refs.has(object)) return this.writeRef(object);
        const state = { $class: classID };
        this.refs.set(object, state);      // register ref before recursing
        const written = this.write(value, path, false);
        if (typeof written !== "object" || Array.isArray(written)) state.$value = written;
        else Object.assign(state, written);
        return state;
    }

    writeRef(object) {
        const state = this.refs.get(object);
        if (typeof state !== "object") throw Error("Non-object in refs: " + object);
        if (Array.isArray(state)) {
            // usually, extra properties on arrays don't get serialized to JSON
            // so we use this hack that does a one-time replacement of toJSON
            // on this particular array
            state.toJSON = function () {
                return {
                    $id: this.$id,
                    $class: "Array",
                    $value: [...this]
                };
            };
        }
        const $ref = state.$id || (state.$id = this.nextRef++);
        return {$ref};
    }

    writeInto(state, key, value, path, defer=true) {
        if (key[0] === '$') { displayWarning(`snapshot: ignoring property ${key}`, { only: "once" }); return; }
        if (defer && typeof value === "object") {
            this.todo.push({state, key, value, path});
            return;
        }
        const simpleKey = typeof key === "string" && key.match(/^[_a-z][_a-z0-9]*$/i);
        const newPath = path + (simpleKey ? `.${key}` : `[${JSON.stringify(key)}]`);
        const written = this.write(value, newPath);
        if (written !== undefined) state[key] = written;
    }
}

class IslandReader {
    static newOrRecycled(island) {
        let inst = this.reusableInstance;
        if (!inst) {
            inst = this.reusableInstance = new this(island);
        } else {
            inst.island = island;
            inst.refs = new Map();
            inst.todo = [];
            inst.unresolved = [];
        }
        return inst;
    }

    static get reusableInstance() { return this[this.name + "-instance"]; }

    static set reusableInstance(val) { this[this.name + "-instance"] = val; }

    static resetInstance() { this.reusableInstance = null; }

    constructor(island) {
        this.island = island;
        this.refs = new Map();
        this.todo = [];   // we use breadth-first reading to limit stack depth
        this.unresolved = [];
        this.readers = new Map();
        this.addReader("Teatime:Message", Message);
        for (const [classId, ClassOrSpec] of Model.allClassTypes()) {
            this.addReader(classId, ClassOrSpec);
        }
        this.readers.set("NaN", () => NaN);
        this.readers.set("Infinity", sign => sign * Infinity);
        this.readers.set("Set", array => new Set(array));
        this.readers.set("Map", array => new Map(array));
        this.readers.set("Array", array => array.slice(0));
        this.readers.set("Uint8Array", array => new Uint8Array(array));
        this.readers.set("Uint16Array", array => new Uint16Array(array));
        this.readers.set("Float32Array", array => new Float32Array(array));
    }

    addReader(classId, ClassOrSpec) {
        const read = (typeof ClassOrSpec === "object") ? ClassOrSpec.read
            : state => Object.assign(Object.create(ClassOrSpec.prototype), state);
        this.readers.set(classId, read);
    }

    readIsland(snapshot, root) {
        if (root !== "$") throw Error("Island must be root object");
        const islandData = {
            _random: new SeedRandom(null, { state: snapshot._random }),
        };
        for (const [key, value] of Object.entries(snapshot)) {
            if (!islandData[key]) this.readInto(islandData, key, value, root);
        }
        this.readDeferred();
        this.resolveRefs();
        return islandData;
    }

    readDeferred() {
        while (this.todo.length > 0) {
            const {object, key, value, path} = this.todo.shift();
            this.readInto(object, key, value, path, 1);
        }
    }

    resolveRefs() {
        for (const {object, key, ref, path} of this.unresolved) {
            if (this.refs.has(ref)) {
                object[key] = this.refs.get(ref);
            } else {
                throw Error(`Unresolved ref: ${ref} at ${path}[${JSON.stringify(key)}]`);
            }
        }
    }

    read(value, path, nodefer=0) {
        switch (typeof value) {
            case "number":
            case "string":
            case "boolean":
                return value;
            default: {
                const type = Object.prototype.toString.call(value).slice(8, -1);
                switch (type) {
                    case "Array": return this.readArray(value, path, nodefer);
                    case "Null": return null;
                    case "Object": {
                        const { $class, $model, $ref } = value;
                        if ($ref) throw Error("refs should have been handled in readInto()");
                        if ($model) return this.readModel(value, path);
                        if ($class) return this.readAs($class, value, path);
                        return this.readObject(Object, value, path, nodefer);
                    }
                    default:
                        throw Error(`Don't know how to read ${type} at ${path}`);
                }
            }
        }
    }

    readModel(state, path) {
        const model = Model.instantiateClassID(state.$model, state.id);
        if (state.$id) this.refs.set(state.$id, model);
        for (const [key, value] of Object.entries(state)) {
            if (key === "id" || key[0] === "$") continue;
            this.readInto(model, key, value, path);
        }
        return model;
    }

    readObject(Class, state, path, nodefer=0) {
        const object = new Class();
        if (state.$id) this.refs.set(state.$id, object);
        for (const [key, value] of Object.entries(state)) {
            if (key[0] === "$") continue;
            this.readInto(object, key, value, path, nodefer);
        }
        return object;
    }

    readArray(array, path, nodefer=0) {
        const result = [];
        if (array.$id) this.refs.set(array.$id, result);
        for (let i = 0; i < array.length; i++) {
            if (array[i] !== undefined) this.readInto(result, i, array[i], path, nodefer); // allow for missing indices
        }
        return result;
    }

    readAs(classID, state, path) {
        let temp = {};
        const unresolved = new Map();
        if ("$value" in state) temp = this.read(state.$value, path, 2);     // Map needs to resolve array of arrays, so 2
        else for (const [key, value] of Object.entries(state)) {
            if (key[0] === "$") continue;
            const ref = value && value.$ref;
            if (ref) {
                if (this.refs.has(ref)) temp[key] = this.refs.get(ref);
                else {
                    temp[key] = "<unresolved>";
                    unresolved.set(ref, key);
                }
            } else {
                this.readInto(temp, key, value, path, 1);
            }
        }
        const reader = this.readers.get(classID);
        const object = reader(temp, path);
        if (!object && classID !== "NaN") console.warn(`Reading "${classID}" returned ${object} at ${path}`);
        if (state.$id) this.refs.set(state.$id, object);
        for (const [ref, key] of unresolved.entries()) {
            this.unresolved.push({object, key, ref, path});
        }
        return object;
    }

    readRef(object, key, value, path) {
        if (!value || !value.$ref) return false;
        const ref = value.$ref;
        if (this.refs.has(ref)) {
            object[key] = this.refs.get(ref);
        } else {
            object[key] = "<unresolved>";
            this.unresolved.push({object, key, ref, path});
        }
        return true;
    }

    readInto(object, key, value, path, nodefer=0) {
        if (this.readRef(object, key, value, path)) return;
        if (nodefer === 0 && typeof value === "object") {
            this.todo.push({object, key, value, path});
            return;
        }
        const simpleKey = typeof key === "string" && key.match(/^[_a-z][_a-z0-9]*$/i);
        const newPath = path + (simpleKey ? `.${key}` : `[${JSON.stringify(key)}]`);
        object[key] = this.read(value, newPath, nodefer > 0 ? nodefer - 1 : 0);
    }
}

class MessageArgumentEncoder extends IslandWriter {
    encode(args) {
        const encoded = this.writeArray(args, '$');
        this.writeDeferred();
        return encoded;
    }

    writeModel(model) {
        return { $ref: model.id };
    }
}

class MessageArgumentDecoder extends IslandReader {
    decode(args) {
        const decoded = this.readArray(args, '$');
        this.readDeferred();
        this.resolveRefs();
        return decoded;
    }

    resolveRefs() {
        for (const {object, key, ref, path} of this.unresolved) {
            if (this.refs.has(ref)) {
                object[key] = this.refs.get(ref);
            } else {
                const model = this.island.lookUpModel(ref);
                if (model) object[key] = model;
                else throw Error(`Unresolved ref: ${ref} at ${path}[${JSON.stringify(key)}]`);
            }
        }
    }
}

/** helper that traverses a dummy object and gathers all object classes,
 * including otherwise inaccessible ones. Returns a mapping that can be returned in
 * a Model's static types() method */
export function gatherInternalClassTypes(dummyObject, prefix) {
    const gatheredClasses = {};
    const seen = new Set();
    gatherInternalClassTypesRec({root: dummyObject}, prefix, gatheredClasses, seen);
    return gatheredClasses;
}

export function resetReadersAndWriters() {
    IslandReader.resetInstance();
    IslandWriter.resetInstance();
    MessageArgumentEncoder.resetInstance();
    MessageArgumentDecoder.resetInstance();
}

function gatherInternalClassTypesRec(dummyObject, prefix="", gatheredClasses={}, seen=new Set()) {
    const newObjects = Object.values(dummyObject)
        .filter(prop => {
            const type = Object.prototype.toString.call(prop).slice(8, -1);
            return (type === "Object" || type === "Array") && !seen.has(prop);
        });
    for (const obj of newObjects) {
        seen.add(obj);
        const className = prefix + "." + obj.constructor.name;
        if (gatheredClasses[className]) {
            if (gatheredClasses[className] !== obj.constructor) {
                throw new Error("Class with name " + className + " already gathered, but new one has different identity");
            }
        } else {
            gatheredClasses[className] = obj.constructor;
        }
    }
    // we did breadth-first
    for (const obj of newObjects) {
        gatherInternalClassTypesRec(obj, prefix, gatheredClasses, seen);
    }
}
