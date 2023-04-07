import stableStringify from "fast-json-stable-stringify";
import SeedRandom from "seedrandom/seedrandom";
import "@croquet/math"; // creates globalThis.CroquetMath
import PriorityQueue from "./priorityQueue";
import { Stats } from "./_STATS_MODULE_"; // eslint-disable-line import/no-unresolved
import { displayWarning, displayAppError } from "./_HTML_MODULE_"; // eslint-disable-line import/no-unresolved
import urlOptions from "./_URLOPTIONS_MODULE_"; // eslint-disable-line import/no-unresolved
import Model from "./model";
import { inModelRealm, inViewRealm } from "./realms";
import { viewDomain } from "./domain";
import Data, { DataHandleSpec } from "./data";

/** @typedef { import("./controller").default } Controller */

/** @type {VirtualMachine} */
let CurrentVM = null;

let DEBUG = null;
function initDEBUG() {
    // TODO: turn this into a reasonable API
    DEBUG = {
        snapshot: urlOptions.has("debug", "snapshot", false),               // snapshotting, uploading etc
        session: urlOptions.has("debug", "session", false),                 // session logging
    };
}

/** this shows up as "CroquetWarning" in the console */
class CroquetWarning extends Error {}
Object.defineProperty(CroquetWarning.prototype, "name", { value: "CroquetWarning" });

/** patch Math and Date */
function patchBrowser() {
    // patch Math.random, and the transcendentals as defined in "@croquet/math"
    if (!globalThis.CroquetViewMath) {
        // make random use CurrentVM
        globalThis.CroquetMath.random = () => CurrentVM.random();
        // save all original Math methods
        globalThis.CroquetViewMath = {...Math};
        // we keep the original Math object but replace the methods found in CroquetMath
        // with a dispatch based on being executed in model or view code
        for (const [funcName, modelFunc] of Object.entries(globalThis.CroquetMath)) {
            const viewFunc = Math[funcName];
            Math[funcName] = modelFunc.length === 1
                ? arg => CurrentVM ? modelFunc(arg) : viewFunc(arg)
                : (arg1, arg2) => CurrentVM ? modelFunc(arg1, arg2) : viewFunc(arg1, arg2);
        }
    }
    // patch Date.now to return VirtualMachine time if called from Model code
    if (!globalThis.CroquetViewDate) {
        // replace the original Date constructor function but return actual Date instances
        const SystemDate = globalThis.Date; // capture in closure
        // warn only once
        let warned = false;
        function modelDateWarning(expr, value) {
            if (!warned) {
                warned = true;
                // log CroquetWarning object to give developers a stack trace
                console.warn(new CroquetWarning(`${expr} used in Model code`));
            }
            return value;
        }
        // Date replacement
        function CroquetDate(a, b, c, d, e, f, g) {
            // written this way so CroquetDate.length === 7 per spec
            const calledWithNew = this instanceof CroquetDate; // slightly more efficient than new.target after Babel
            const args = [a, b, c, d, e, f, g];
            args.length = arguments.length;
            if (CurrentVM) {
                // Alwys warn. Even when providing arguments, instances still use local timezone
                // TODO: write complete replacement? Don't think so.
                modelDateWarning(calledWithNew ? "new Date()" : "Date()");
                switch (arguments.length) {
                    case 0: args.push(CurrentVM.time); break;
                    case 1: break;
                    default:
                        args[0] = SystemDate.UTC(...args);
                        args.length = 1;
                }
            }
            const instance = new SystemDate(...args);
            return calledWithNew ? instance : "" + instance;
        }
        // implement static properties
        CroquetDate.prototype = SystemDate.prototype;
        CroquetDate.UTC = SystemDate.UTC;
        CroquetDate.now =  () => CurrentVM ? modelDateWarning("Date.now()", CurrentVM.time) : SystemDate.now();
        CroquetDate.parse = (...args) => CurrentVM ? modelDateWarning("Date.parse()", 0) : SystemDate.parse(...args);
        // make original accessible
        globalThis.CroquetViewDate = SystemDate;
        // switch
        globalThis.Date = CroquetDate;
    }
}

/** function cache */
const QFuncs = {};

/** QFuncs are a hack to allow functions (that is, non-methods) in Model code
 * to be used as callback, e.g. QFunc({foo}, bar => this.baz(foo, bar))
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


// this is the only place allowed to set CurrentVM
function execInVM(vm, fn) {
    if (CurrentVM) throw Error("VirtualMachine confusion");
    if (!(vm instanceof VirtualMachine)) throw Error("not a VM: " + vm);
    const previousVM = CurrentVM;
    try {
        CurrentVM = vm;
        globalThis.CROQUETVM = vm;
        fn();
    } finally {
        CurrentVM = previousVM;
    }
}

function execOutsideVM(fn) {
    if (!CurrentVM) throw Error("VirtualMachine confusion");
    const previousVM = CurrentVM;
    try {
        CurrentVM = null;
        fn();
    } finally {
        CurrentVM = previousVM;
    }
}

const INITIAL_SEQ = 0xFFFFFFF0; // initial sequence number, must match reflector.js
const VOTE_SUFFIX = "#__vote"; // internal, for "vote" handling; never seen by apps
const REFLECTED_SUFFIX = "#reflected";
const DIVERGENCE_SUFFIX = "#divergence";

// messages invoked via reflector (encoded as single digit, not full string)
const ENCODED_MESSAGES = [
    "handleModelEventInModel",   // 0: the common case (triggers handlers in models and views)
    "handleBundledEvents",       // 1: the case if bundled, will verify each unbundled message

    // below are encoded for consistency but not directly sent to reflector
    "publishFromModelOnly",      // 2: triggers handlers in models only (specifically, join/exit)
    "handlePollForSnapshot",     // 3: snapshot polling
    "handleTuttiResult",         // 4: processing of TUTTI
    "handleTuttiDivergence",     // 5: processing of TUTTI
    "handleSnapshotVote",        // 6: snapshot voting
    "handlePersistVote",         // 7: persist voting
    "handleModelEventInView",    // 8: view subscription for TUTTI votes (unofficial API)
    "noop",                      // 9: unused (was used in convertReflectorMessage)
    // we're counting in Base36  // A: ...
    //                           // B: ...
    // must not have more than 36 to keep it single-digit (or update encode/decode)
];

// map of message names to index for encoding
const ENCODE_MESSAGE = {};
for (let i = 0; i < ENCODED_MESSAGES.length; i++) {
    ENCODE_MESSAGE[ENCODED_MESSAGES[i]] = i;
}

// minimum ms (vm time) between successive snapshot polls
const SNAPSHOT_MIN_POLL_GAP = 5000;
// minimum ms (vm time) between successive persistence polls
const PERSIST_MIN_POLL_GAP = 25000; // bearing in mind max tick interval of 30s

const persistenceDetails = new WeakMap(); // map from vm to a persistence-details object
function setPersistenceCache(vm, details) { persistenceDetails.set(vm, details); }
function getPersistenceCache(vm) { return persistenceDetails.get(vm); }
function clearPersistenceCache(vm) { persistenceDetails.set(vm, null); }

/** A fake VM is used to run bit-identical code outside of the model, e.g. for Constant init */
class FakeVM {
    random() {
        throw Error("Math.random() cannot be used in Model.evaluate()");
    }
}

/** A VM holds the models which are synchronized by teatime,
 * a queue of messages, plus additional bookkeeping to make
 * uniform pub/sub between models and views possible.*/
export default class VirtualMachine {
    static current() {
        if (!CurrentVM) console.warn(`VirtualMachine.current() called from outside the vm!`);
        return CurrentVM;
    }

    static hasCurrent() {
        return !!CurrentVM;
    }

    /** exposed as Model.evaluate() */
    static evaluate(fn) {
        if (CurrentVM) return fn();
        patchBrowser(); // trivial if already installed
        const previousVM = CurrentVM;
        try {
            CurrentVM = new FakeVM();
            return fn();
        } finally {
            CurrentVM = previousVM;
        }
    }

    constructor(snapshot, initFn) {
        patchBrowser(); // trivial if already installed
        initDEBUG();
        clearPersistenceCache(this);

        execInVM(this, () => {
            inModelRealm(this, () => {
                /** all the models in this vm */
                this.modelsById = {};
                /** named entry points to models (so a view can attach to it) */
                this.modelsByName = {};
                /** pending messages, sorted by time and sequence number */
                this.messages = new PriorityQueue((a, b) => a.before(b));
                /** @type {{"scope:event": Array<String>}} model subscriptions, maps topic to handlers */
                this.subscriptions = {};
                /** @type {Map<String, Set<String>>} maps models to subscribed topics. Excluded from snapshot */
                this.subscribers = new Map();
                /** @type {{[id:string]: {extraConnections?: Number}}} viewIds of active reflector connections */
                this.views = {};
                /** @type {SeedRandom} our synced pseudo random stream */
                this._random = () => { throw Error("You must not use random when applying state!"); };
                /** @type {String} session ID */
                this.id = snapshot.id; // the controller always provides an ID
                /** @type {Number} how far simulation has progressed */
                this.time = 0;
                /** @type {Number} sequence number of last executed external message */
                this.seq = INITIAL_SEQ;       // 0xFFFFFFF0 provokes 32 bit rollover soon
                /** @type {Number} timestamp of last scheduled external message */
                this.externalTime = 0;
                /** @type {Number} sequence number of last scheduled external message */
                this.externalSeq = this.seq;
                /** @type {Number} sequence number for disambiguating future messages with same timestamp */
                this.futureSeq = 0;
                /** @type {Number} simulation time when last snapshot poll was taken */
                this.lastSnapshotPoll = 0;
                /** @type {Number} simulation time when last persistence poll was requested */
                this.lastPersistencePoll = 0;
                /** @type {Boolean} true when a future persistence poll has been scheduled */
                this.inPersistenceCoolOff = false;
                /** @type {String} hash of last persistent data upload */
                this.persisted = "";
                /** @type {Number} number for giving ids to model */
                this.modelsId = 0;
                /** @type {Controller} our controller, for sending messages. Excluded from snapshot */
                this.controller = null;
                if (snapshot.modelsById) {
                    // read vm from snapshot
                    const reader = VMReader.newOrRecycled(this);
                    const vmData = reader.readVM(snapshot, "vm");
                    let messages = [];
                    // only read keys declared above
                    for (const key of Object.keys(vmData)) {
                        if (!(key in this) && key !== "meta") console.warn(`Ignoring property snapshot.${key}`);
                        else if (key === "messages") messages = vmData.messages;
                        else this[key] = vmData[key];
                    }
                    // add messages array to priority queue
                    for (const msg of messages) this.messages.add(msg.convertIfNeeded(this));
                    // recreate subscribers from subscriptions
                    for (const [topic, handlers] of Object.entries(this.subscriptions)) {
                        for (const handler of handlers) {
                            const [modelId] = handler.split('.');
                            let topics = this.subscribers.get(modelId);
                            if (!topics) this.subscribers.set(modelId, topics = new Set());
                            topics.add(topic);
                        }
                    }
                } else {
                    // seed with session id so different sessions get different random streams
                    this._random = new SeedRandom(snapshot.id, { state: true });
                    this.addSubscription(this, "__VM__", "__peers__", this.generateJoinExit);
                    // creates root model and puts it in modelsByName as "rootModel"
                    initFn(this);
                }
            });
        });
    }

    registerModel(model, id) {
        if (CurrentVM !== this) throw Error("You can only create models from model code!");
        if (!id) id = "M" + ++this.modelsId;
        this.modelsById[id] = model;
        // not assigning the id here catches missing super calls in init() and load()
        return id;
    }

    deregisterModel(id) {
        if (CurrentVM !== this) throw Error("You can only destroy models from model code!");
        const model = this.modelsById;
        delete this.modelsById[id];
        for (const [name, value] of Object.entries(this.modelsByName)) {
            if (model === value) delete this.modelsByName[name];
        }
        this.messages.removeMany(msg => msg.hasReceiver(id));
    }

    lookUpModel(id) {
        if (id === "_") return this;
        const model = this.modelsById[id];
        if (model) return model;
        const [_, modelID, partId] = id.match(/^([^#]+)#(.*)$/);
        return this.modelsById[modelID].lookUp(partId);
    }

    get(modelName) { return this.modelsByName[modelName]; }
    set(modelName, model) {
        if (CurrentVM !== this) throw Error("You can only make a model well-known from model code!");
        this.modelsByName[modelName] = model;
    }

    // used in Controller.convertReflectorMessage()
    noop() {}

    // generate perfectly paired view-join and view-exit events
    // from imperfectly paired reflector messages
    // e.g. nobody is there to receive an exit event for the last view
    // leaving a session so we generate those when the first view resumes a session
    // keeping track of views in the currently not exposed this.views property
    generateJoinExit({entered, exited, count}) {
        // if entered = count then the reflector just resumed the session
        // synthesize exit events for old views stored in snapshot
        if (entered.length === count) {
            exited = Object.keys(this.views);
            // all connections gone
            for (const id of exited) this.views[id].extraConnections = 0;
        }
        // reflector may send join+exit for same view in one event
        if (entered.length !== 0 && exited.length !== 0) {
            const both = entered.filter(id => exited.includes(id));
            if (both.length !== 0) {
                entered = entered.filter(id => !both.includes(id));
                exited = exited.filter(id => !both.includes(id));
                if (entered.length === 0 && exited.length === 0) return;
            }
        }
        // process exits first
        for (const id of exited) {
            if (this.views[id]) {
                // ignore exit for multiple connections (see below)
                if (this.views[id].extraConnections) {
                    this.views[id].extraConnections--;
                    if (DEBUG.session) console.log(`${this.id} @${this.time}#${this.seq} view ${id} closed extra connection`);
                    continue;
                }
                // otherwise this is a real exit
                delete this.views[id];
                this.publishFromModelOnly(this.id, "view-exit", id);
            } else {
                // there is no way this could ever happen. If it does, something is seriously broken.
                console.error(`${this.id} @${this.time}#${this.seq} view ${id} exited without being present - this should not happen`);
                this.controller.sendLog(`view-exit-mismatch @${this.time}#${this.seq} ${id} left without being present`);
            }
        }
        // then joins
        for (const id of entered) {
            if (this.views[id]) {
                // this happens if a client rejoins but the reflector is still holding
                // onto the old connection
                if (DEBUG.session) console.log(`${this.id} @${this.time}#${this.seq} view ${id} opened another connection`);
                this.views[id].extraConnections = (this.views[id].extraConnections||0) + 1;
            } else {
                // otherwise this is a real join
                this.views[id] = {};
                this.publishFromModelOnly(this.id, "view-join", id);
            }
        }
        // sanity check: the active number of connections on the reflector should match our count
        const connections = Object.values(this.views).reduce((n, view) => n + 1 + (view.extraConnections || 0), 0);
        if (count !== connections) {
            console.error(`@${this.time}#${this.seq} view count mismatch (model: ${connections}, reflector: ${count}) - this should not happen`);
            this.controller.sendLog(`view-exit-mismatch @${this.time}#${this.seq} connections model: ${connections} reflector: ${count}`);
        }
        // BTW: if the view sent to reflector in controller.join() was an object or array
        // instead of a plain string, then reflector may have added the
        // location as {region, city: {name, lat, lng}}, see JOIN() in reflector.js
        // for now, we are using plain string ids, so no location is sent
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
        this.verifyExternal(message); // may throw
        this.messages.add(message);
        return message;
    }

    /** limit the methods that can be triggered directly via reflector */
    verifyExternal(msg) {
        if (msg.receiver !== "_") throw Error(`invalid receiver in external message: ${msg}`);
        if (!(msg.selector in ENCODE_MESSAGE)) throw Error(`unexpected external message: ${msg.selector}`);
    }

    futureSend(tOffset, receiverID, selector, args) {
        if (tOffset.every) return this.futureRepeat(tOffset.every, receiverID, selector, args);
        if (tOffset < 0) throw Error("attempt to send future message into the past");
        // Wrapping below is fine because the message comparison function deals with it.
        // To have a defined ordering between future messages generated on vm
        // and messages from the reflector, we create even sequence numbers here and
        // the reflector's sequence numbers are made odd on arrival
        this.futureSeq = (this.futureSeq + 1) >>> 0;
        const message = new Message(this.time + tOffset, 2 * this.futureSeq, receiverID, selector, args);
        this.messages.add(message);
        return message;
    }

    cancelFuture(model, methodOrMessage) {
        const messages = this.messages;
        let removed;
        if ("time" in methodOrMessage) {
            const { time, seq } = methodOrMessage;
            removed = messages.removeOne(msg => msg.time === time && msg.seq === seq);
        } else {
            const methodName = this.asQFunc(model, methodOrMessage, "cancelFuture message");
            const receiverID = model.id;
            removed = messages.removeOne(msg => msg.receiver === receiverID && msg.selector === methodName
                || msg.receiver === "_" && msg.selector === "futureExecAndRepeat" && msg.args[1] === receiverID && msg.args[2] === methodName);
        }
        return removed !== undefined;
    }

    futureRepeat(tOffset, receiverID, selector, args) {
        // "_ " is a special receiver that means "this VM"
        this.futureSend(tOffset, "_", "futureExecAndRepeat", [tOffset, receiverID, selector, args]);
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
        const methodName = this.asQFunc(model, methodNameOrCallback, "future message");
        if (typeof methodName === "string") {
            return this.futureSend(tOffset, model.id, methodName, methodArgs);
        }
        const vm = this;
        return new Proxy(model, {
            get(_target, property) {
                if (typeof model[property] === "function") {
                    return (...args) => {
                        if (vm.lookUpModel(model.id) !== model) throw Error("future send to unregistered model");
                        return vm.futureSend(tOffset, model.id, property, args);
                    };
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(model).constructor.name + " which is not a function");
            }
        });
    }

    /**
     * Process pending messages for this vm and advance simulation time.
     * Must only be sent by controller!
     * @param {Number} newTime - simulate at most up to this time
     * @param {Number} deadline - CPU time deadline for interrupting simulation
     * @returns {Boolean} true if finished simulation before deadline
     */
    advanceTo(newTime, deadline) {
        if (CurrentVM) throw Error("cannot advance time from model code");
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
            // if we're out of time, bail out
            if (globalThis.CroquetViewDate.now() >= deadline) return false;
        }
        // we processed all messages up to newTime
        this.time = newTime;
        return true;
    }

    // Pub-sub

    asQFunc(model, func, handler = "subscription handler") {
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
            // otherwise, assume it's an inline function
            displayWarning(`${handler} is not a method of ${model}: ${func}\n`, { only: "once" });
            // if passing (foo) => this.bar(baz)
            // match:                (   foo             )   =>  this .  bar              (    baz               )
            const HANDLER_REGEX = /^\(?([a-z][a-z0-9]*)?\)? *=> *this\.([a-z][a-z0-9]*) *\( *([a-z][a-z0-9]*)? *\) *$/i;
            // captures:               [      1       ]                [       2      ]      [      3       ]
            const source = func.toString();
            const match = source.match(HANDLER_REGEX);
            if (match && (!match[3] || match[3] === match[1])) return match[2];
            // otherwise, wrap the function in a QFunc
            return QFunc(func);
        }
        return null;
    }

    addSubscription(model, scope, event, methodNameOrCallback) {
        if (CurrentVM !== this) throw Error("Cannot add a model subscription from outside model code");
        const methodName = this.asQFunc(model, methodNameOrCallback);
        if (typeof methodName !== "string") {
            throw Error(`Subscription handler for "${event}" must be a method name`);
        }
        if (methodName.indexOf('.') < 0 && typeof model[methodName] !== "function") {
            if (methodName[0] !== '{') throw Error(`Subscriber method for "${event}" not found: ${model}.${methodName}()`);
        }
        const topic = scope + ':' + event;
        const id = model === this ? "_" : model.id;
        const handler = id + '.' + methodName;
        // model subscriptions need to be ordered, so we're using an array
        if (!this.subscriptions[topic]) this.subscriptions[topic] = [];
        else if (this.subscriptions[topic].indexOf(handler) !== -1) {
            throw Error(`${model}.${methodName} already subscribed to ${event}`);
        }
        this.subscriptions[topic].push(handler);
        let topics = this.subscribers.get(id);
        if (!topics) this.subscribers.set(id, topics = new Set());
        topics.add(topic);
    }

    removeSubscription(model, scope, event, methodName="*") {
        if (CurrentVM !== this) throw Error("Cannot remove a model subscription from outside model code");
        const topic = scope + ':' + event;
        const handlers = this.subscriptions[topic];
        if (handlers) {
            const handlerPrefix = model.id + '.';
            if (methodName === "*") {
                // modify the array in place so the loop in handleModelEventInModel()
                // will not execute removed handlers
                for (let i = handlers.length - 1; i >= 0; i--) {
                    if (handlers[i].startsWith(handlerPrefix)) {
                        handlers.splice(i, 1);
                    }
                }
                if (handlers.length === 0) delete this.subscriptions[topic];
            } else {
                const nameString = this.asQFunc(model, methodName);
                if (typeof nameString !== "string") {
                    throw Error(`Invalid unsubscribe args for "${event}" in ${model}: ${methodName}`);
                }
                const handler = handlerPrefix + nameString;
                const indexToRemove = handlers.indexOf(handler);
                if (indexToRemove !== -1) {
                    handlers.splice(indexToRemove, 1);
                    if (handlers.length === 0) delete this.subscriptions[topic];
                }
                // if there are remaining handlers, do not remove the topic for this model
                if (handlers.find(h => h.startsWith(handlerPrefix))) {
                    return;
                }
            }
            // all handlers of this model for the topic are gone, remove the topic
            const topics = this.subscribers.get(model.id);
            topics.delete(topic);
            if (topics.size === 0) this.subscribers.delete(model.id);
        }
    }

    removeAllSubscriptionsFor(model) {
        const topics = this.subscribers.get(model.id);
        if (topics) {
            const handlerPrefix = model.id + '.';
            for (const topic of topics) {
                const handlers = this.subscriptions[topic];
                // modify the array in place so the loop in handleModelEventInModel()
                // will not execute removed handlers
                for (let i = handlers.length - 1; i >= 0; i--) {
                    if (handlers[i].startsWith(handlerPrefix)) {
                        handlers.splice(i, 1);
                    }
                }
                if (handlers.length === 0) delete this.subscriptions[topic];
            }
            this.subscribers.delete(model.id);
        }
    }

    publishFromModel(scope, event, data) {
        if (CurrentVM !== this) throw Error("Cannot publish a model event from outside model code");
        // @@ hack for forcing reflection of model-to-model messages
        const reflected = event.endsWith(REFLECTED_SUFFIX);
        if (reflected) event = event.slice(0, event.length - REFLECTED_SUFFIX.length);

        const topic = scope + ':' + event;
        this.handleModelEventInModel(topic, data, reflected);
        this.handleModelEventInView(topic, data);
    }

    publishFromModelOnly(scope, event, data) {
        if (CurrentVM !== this) throw Error("Cannot publish a model event from outside model code");
        const topic = scope + ':' + event;
        this.handleModelEventInModel(topic, data);
    }

    publishFromView(scope, event, data) {
        if (CurrentVM) throw Error("Cannot publish a view event from model code");
        const topic = scope + ':' + event;
        this.handleViewEventInModel(topic, data);
        this.handleViewEventInView(topic, data);
    }

    handleBundledEvents(events) {
        for (const msgState of events) {
            const message = Message.fromState(msgState, this);
            this.verifyExternal(message); // may throw
            message.executeOn(this, true); // nested invocation
        }
    }

    handleModelEventInModel(topic, data, reflect=false) {
        // model=>model events are handled synchronously unless reflected
        // because making them async would mean having to use future messages
        if (CurrentVM !== this) throw Error("handleModelEventInModel called from outside model code");
        if (reflect) {
            if (this.controller.synced !== true) return;

            const voteTopic = topic + VOTE_SUFFIX;
            const divergenceTopic = topic + DIVERGENCE_SUFFIX;
            const wantsVote = !!viewDomain.subscriptions[voteTopic], wantsFirst = !!this.subscriptions[topic], wantsDiverge = !!this.subscriptions[divergenceTopic];
            if (wantsVote && wantsDiverge) console.log(`divergence subscription for ${topic} overridden by vote subscription`);
            // iff there are subscribers to a first message, build a candidate for the message that should be broadcast
            const firstMessage = wantsFirst ? new Message(this.time, 0, "_", "handleModelEventInModel", [topic, data]) : null;
            // provide the receiver, selector and topic for any eventual tally response from the reflector.
            // if there are subscriptions to a vote, it'll be a handleModelEventInView with
            // the vote-augmented topic.  if not, default to our handleTuttiDivergence.
            let tallyTarget;
            if (wantsVote) tallyTarget = ["handleModelEventInView", voteTopic];
            else tallyTarget = ["handleTuttiDivergence", divergenceTopic];
            Promise.resolve().then(() => this.controller.sendTutti({
                time: this.time,
                topic,
                data,
                firstMessage,
                wantsVote,
                tallyTarget
                })); // break out of model code
        } else if (this.subscriptions[topic]) {
            for (const handler of this.subscriptions[topic]) {
                const [id, ...rest] = handler.split('.');
                const methodName = rest.join('.');
                const model = this.lookUpModel(id);

                if (!model) {
                    displayWarning(`event ${topic} .${methodName}(): subscriber not found`);
                    continue;
                }
                if (methodName[0] === '{') {
                    const fn = bindQFunc(methodName, model);
                    try {
                        fn(data);
                    } catch (error) {
                        displayAppError(`event ${topic} ${model} ${fn}`, error);
                    }
                    continue;
                }
                if (methodName.indexOf('.') >= 0) {
                    const i = methodName.indexOf('.');
                    const head = methodName.slice(0, i);
                    const tail = methodName.slice(i + 1);
                    try {
                        model.call(head, tail, data);
                    } catch (error) {
                        displayAppError(`event ${topic} ${model}.call(${JSON.stringify(head)}, ${JSON.stringify(tail)})`, error);
                    }
                    continue;
                }
                if (typeof model[methodName] !== "function") {
                    displayAppError(`event ${topic} ${model}.${methodName}(): method not found`);
                    continue;
                } else {
                    try {
                        model[methodName](data);
                    } catch (error) {
                        displayAppError(`event ${topic} ${model}.${methodName}()`, error);
                    }
                }
            }
        }
    }

    handleViewEventInModel(topic, data) {
        // view=>model events are converted to model=>model events via reflector
        if (this.subscriptions[topic]) {
            const args = [topic];
            if (data !== undefined) args.push(data); // avoid {"$class":"Undefined"}
            const message = new Message(this.time, 0, "_", "handleModelEventInModel", args);
            this.controller.sendMessage(message);
        }
    }

    handleModelEventInView(topic, data) {
        viewDomain.handleEvent(topic, data, fn => execOutsideVM(() => inViewRealm(this, fn, true)));
    }

    handleViewEventInView(topic, data) {
        viewDomain.handleEvent(topic, data);
    }

    handleTuttiDivergence(divergenceTopic, data) {
        // for a reflected model message foo#reflected, by default divergence triggers any model
        // subscriptions for foo#divergence.
        if (this.subscriptions[divergenceTopic]) this.handleModelEventInModel(divergenceTopic, data);
        else {
            const event = divergenceTopic.split(':').slice(-1)[0];
            console.warn(`uncaptured divergence in ${event}:`, data);
        }
    }

    processModelViewEvents(isInAnimationStep) {
        if (CurrentVM) throw Error("cannot process view events in model code");
        return inViewRealm(this, () => viewDomain.processFrameEvents(isInAnimationStep, !!this.controller.synced));
    }

    handlePollForSnapshot() {
        // make sure there isn't a clash between clients simultaneously deciding
        // that it's time for someone to take a snapshot.
        const now = this.time;
        const sinceLast = now - this.lastSnapshotPoll;
        if (sinceLast < SNAPSHOT_MIN_POLL_GAP) { // arbitrary - needs to be long enough to ensure this isn't part of the same batch
            console.log(`rejecting snapshot poll ${sinceLast}ms after previous`);
            return;
        }

        this.lastSnapshotPoll = now;
        this.controller.handlePollForSnapshot(now);
    }

    handleTuttiResult(data) {
        this.controller.handleTuttiResult(data);
    }

    handleSnapshotVote(data) {
        this.controller.handleSnapshotVote(data);
    }

    handlePersistVote(data) {
        this.controller.handlePersistVote(data);
    }

    snapshot() {
        const writer = VMWriter.newOrRecycled(this);
        return writer.snapshot(this, "_");
    }

    // return the stringification of an object describing the vm - currently { oC, mC, nanC, infC, zC, nC, nH, sC, sL, fC } - for checking agreement between instances
    getSummaryHash() {
        return stableStringify(new VMHasher().getHash(this));
    }

    persist(model, persistentDataFunc) {
        if (this.controller && this.controller.sessionSpec.appId === 'no.appId') console.warn("Croquet: appId should be provided in Session.join() to not overwrite another apps's persistent data");
        const start = Stats.begin("snapshot");
        const persistentData = typeof persistentDataFunc === "function" ? persistentDataFunc.call(model) : persistentDataFunc;
        if (typeof persistentData !== "object") throw Error(`Croquet: persistSession() can only persist objects (got ${typeof persistentData})`);
        const persistentString = stableStringify(persistentData);
        const persistentHash = Data.hash(persistentString);
        const ms = Stats.end("snapshot") - start;
        const unchanged = this.persisted === persistentHash;
        const persistTime = this.time;
        if (DEBUG.snapshot) console.log(`${this.id} persistent data @${persistTime} collected, stringified and hashed in ${Math.ceil(ms)}ms${unchanged ? " (unchanged, ignoring)" : ""}`);
        if (unchanged) return;

        // we rely on a local, view-specific cache of persistence data that deserves
        // to be uploaded, perhaps after a suitable cooloff period since the previous.
        // newly joining clients will each populate that local cache if they simulate
        // their way through the steps that cause the persistence call... but if there
        // has been a snapshot since that call, a new client will not populate the cache.
        // therefore we update the model with the new persistentHash as soon as it is
        // generated, even though there is no guarantee that any client will survive
        // long enough with the cached persistentString to upload it.  in the worst
        // case, that iteration of the persistence will be lost.
        setPersistenceCache(this, { persistTime, persistentString, persistentHash, ms });
        this.persisted = persistentHash; // update the model, whatever happens

        // figure out whether it's ok to go ahead immediately with a poll
        if (this.inPersistenceCoolOff) {
            if (DEBUG.snapshot) console.log(`${this.id} persistence poll postponed by cooloff`);
        } else {
            const timeUntilReady = this.lastPersistencePoll ? this.lastPersistencePoll + PERSIST_MIN_POLL_GAP - this.time : 0;
            if (timeUntilReady > 0) {
                if (DEBUG.snapshot) console.log(`${this.id} postponing persistence poll by ${timeUntilReady}ms`);
                this.futureSend(timeUntilReady, "_", "triggerPersistencePoll", []);
                this.inPersistenceCoolOff = true;
            } else {
                // go right ahead
                this.triggerPersistencePoll();
            }
        }
    }

    triggerPersistencePoll() {
        this.inPersistenceCoolOff = false;
        this.lastPersistencePoll = this.controller ? this.time : 0; // ignore during init()

        const details = getPersistenceCache(this);
        if (!details) return; // this client, at least, has nothing ready to upload

        const { persistTime, persistentString, persistentHash, ms } = details;
        clearPersistenceCache(this);

        // controller is unset only during init()
        // this lets us init the hash, but we won't upload the initial state
        if (!this.controller) return;

        if (this.controller.synced) {
            if (DEBUG.snapshot) console.log(`${this.id} asking controller to poll for persistence @${persistTime}`);

            // run everything else outside of VM
            const vmTime = this.time;
            Promise.resolve().then(() => this.controller.pollForPersist(vmTime, persistTime, persistentString, persistentHash, ms));
        }
    }

    random() {
        if (CurrentVM !== this) throw Error("synchronized random accessed from outside the model");
        return this._random();
    }

    randomID() {
        if (CurrentVM !== this) throw Error("synchronized random accessed from outside the model");
        let id = "";
        for (let i = 0; i < 4; i++) {
            id += (this._random.int32() >>> 0).toString(16).padStart(8, '0');
        }
        return id;
    }

    toString() { return `VirtualMachine[${this.id}]`; }

    [Symbol.toPrimitive]() { return this.toString(); }
}


function encode(receiver, selector, args) {
    let encoded;
    if (receiver === "_") {
        const index = ENCODE_MESSAGE[selector];
        if (typeof index === "number") encoded = index.toString(36); // Base36
    }
    if (encoded === undefined) encoded = `${receiver}>${selector}`;
    if (args.length > 0) {
        const encoder = MessageArgumentEncoder.newOrRecycled();
        encoded += JSON.stringify(encoder.encode(args));
    }
    return encoded;
}

function decode(payload, vm) {
    let receiver, selector, argString;
    if (payload.length === 1 || payload[1] === '[') {
        const index = parseInt(payload[0], 36); // Base36
        receiver = "_";
        selector = ENCODED_MESSAGES[index];
        argString = payload.slice(1);
    } else {
        const selPos = payload.indexOf('>');
        let argPos = payload.indexOf('[');
        if (argPos === -1) argPos = payload.length;
        receiver = payload.slice(0, selPos);
        selector = payload.slice(selPos + 1, argPos);
        argString = payload.slice(argPos);
    }
    let args = [];
    if (argString) {
        const decoder = MessageArgumentDecoder.newOrRecycled(vm);
        args = decoder.decode(JSON.parse(argString));
    }
    return {receiver, selector, args};
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
    constructor(time, seq, receiverId, selector, args) {
        /** @type {Number} floating point seconds since beginning of session */
        this.time = time;
        /** @type {Number} a 32 bit unsigned integer (wraps around) */
        this.seq = seq;
        /** @type {String} id of receiver */
        this.receiver = receiverId;
        /** @type {String} method name */
        this.selector = selector;
        /** @type {Array} method arguments */
        this.args = args;
    }

    convertIfNeeded(vm) {
        if (this.payload) {
            // before 0.3, messages always had an encoded payload
            const {receiver, selector, args} = decode(this.payload, vm);
            delete this.payload;
            this.receiver = receiver;
            this.selector = selector;
            this.args = args;
        }
        return this;
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

    hasReceiver(id) { return this.receiver === id; }

    isExternal() { return this.seq & 1; }
    get externalSeq() { return (this.seq / 2) >>> 0; }
    set externalSeq(seq) { this.seq = seq * 2 + 1; }
    get internalSeq() { return (this.seq / 2) >>> 0; }
    set internalSeq(seq) { this.seq = seq * 2; }

    asState() {
        // controller relies on this being a 3-element array
        return [this.time, this.seq, encode(this.receiver, this.selector, this.args)];
    }

    static fromState(state, vm) {
        const [time, seq, payload] = state;
        const { receiver, selector, args } = decode(payload, vm);
        return new Message(time, seq, receiver, selector, args);
    }

    executeOn(vm, nested=false) {
        const executor = nested
            ? fn => fn()
            : fn => execInVM(vm, () => inModelRealm(vm, fn));
        const { receiver, selector, args } = this;
        const object = vm.lookUpModel(receiver);
        if (!object) displayWarning(`${this.shortString()} ${selector}(): receiver not found`);
        else if (selector[0] === '{') {
            const fn = bindQFunc(selector, object);
            executor(() => {
                try {
                    fn(...args);
                } catch (error) {
                    displayAppError(`${this.shortString()} ${fn}`, error);
                }
                });
        } else if (selector.indexOf('.') >= 0) {
            executor(() => {
                const i = selector.indexOf('.');
                const head = selector.slice(0, i);
                const tail = selector.slice(i + 1);
                try {
                    object.call(head, tail, ...args);
                } catch (error) {
                    displayAppError(`${this.shortString()} ${object}.call(${JSON.stringify(head)}, ${JSON.stringify(tail)})`, error);
                }
                });
        } else if (typeof object[selector] !== "function") {
            displayWarning(`${this.shortString()} ${object}.${selector}(): method not found`);
        } else executor(() => {
            try {
                object[selector](...args);
            } catch (error) {
                displayAppError(`${this.shortString()} ${object}.${selector}()`, error);
            }
            });
    }

    shortString() {
        return `${this.isExternal() ? "External" : "Future"}Message`;
    }

    toString() {
        const { receiver, selector, args } = this;
        const ext = this.isExternal();
        const seq = ext ? this.externalSeq : this.internalSeq;
        return `${ext ? "External" : "Future"}Message[${this.time}${":#"[+ext]}${seq} ${receiver}.${selector}(${args.map(JSON.stringify).join(", ")})]`;
    }

    [Symbol.toPrimitive]() { return this.toString(); }
}

const sumForFloat = (() => {
    // use DataView so we can enforce little-endian interpretation of float as ints on any platform
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    return fl => {
        view.setFloat64(0, fl, true);
        return view.getInt32(0, true) + view.getInt32(4, true);
    };
    })();

// VMHasher walks the object tree gathering statistics intended to help
// identify divergence between vm instances.
class VMHasher {
    constructor() {
        this.refs = new Map();
        this.todo = []; // we use breadth-first writing to limit stack depth
        this.hashers = new Map();
        this.addHasher("Teatime:Message", Message);
        this.addHasher("Teatime:Data", DataHandleSpec);
        for (const [classId, ClassOrSpec] of Model.allClassTypes()) {
            this.addHasher(classId, ClassOrSpec);
        }
    }

    addHasher(classId, ClassOrSpec) {
        const { cls, write } = (Object.getPrototypeOf(ClassOrSpec) === Object.prototype) ? ClassOrSpec
            : { cls: ClassOrSpec, write: obj => ({ ...obj }) };
        this.hashers.set(cls, obj => this.hashStructure(obj, write(obj)));
    }

    /** @param {VirtualMachine} vm */
    getHash(vm) {
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

        for (const [key, value] of Object.entries(vm)) {
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
                if (this.refs.has(value)) return;
                const type = Object.prototype.toString.call(value).slice(8, -1);
                switch (type) {
                    case "Array":
                        this.hashArray(value, defer);
                        return;
                    case "ArrayBuffer":
                        this.hashIntArray(new Uint8Array(value), false);
                        return;
                    case "Set":
                    case "Map":
                        this.hashStructure(value, [...value]);
                        return;
                    case "DataView":
                        this.hashIntArray(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), false);
                        return;
                    case "Int8Array":
                    case "Uint8Array":
                    case "Uint8ClampedArray":
                    case "Int16Array":
                    case "Uint16Array":
                    case "Int32Array":
                    case "Uint32Array":
                        this.hashIntArray(value, false);
                        return;
                    case "Float32Array":
                    case "Float64Array":
                        this.hashArray(value, false);
                        return;
                    case "Object":
                        if (value instanceof Model) this.hashModel(value);
                        else if (value.constructor === Object) this.hashObject(value, defer);
                        else {
                            const hasher = this.hashers.get(value.constructor);
                            if (hasher) hasher(value);
                            // no class error here, will be caught and reported by snapshot with full path
                        }
                    // case "Null": not counted
                    // ignore other errors here (e.g. Function), will be caught and reported by snapshot with full path
                    /* no default */
                }
            }
        }
    }

    hashModel(model) {
        this.hashState.mC++;
        this.refs.set(model, true);      // register ref before recursing
        // note: for the hash as currently taken, all tallies are additive
        // so order is not important
        for (const [key, value] of Object.entries(model)) {
            if (key === "__realm") continue;
            if (value !== undefined) this.hashEntry(key, value);
        }
    }

    hashObject(object, defer = true) {
        this.hashState.oC++;
        this.refs.set(object, true);      // register ref before recursing
        // see comment in hashModel re order
        for (const [key, value] of Object.entries(object)) {
            if (value !== undefined) this.hashEntry(key, value, defer);
        }
    }

    hashArray(array, defer = true) {
        this.refs.set(array, true);       // register ref before recursing
        for (let i = 0; i < array.length; i++) {
            this.hashEntry(i, array[i], defer);
        }
    }

    hashIntArray(array) {
        this.refs.set(array, true);       // register ref
        for (let i = 0; i < array.length; i++) {
            const value = array[i];
            if (value === 0) this.hashState.zC++;
            else {
                this.hashState.nC++;
                this.hashState.nH += value;
            }
        }
    }

    hashStructure(object, value) {
        if (value === undefined) return;
        this.refs.set(object, true);      // register ref before recursing
        this.hash(value, false);
    }

    hashEntry(key, value, defer = true) {
        if (key[0] === '$') return;
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

class VMWriter {
    static newOrRecycled(vm) {
        let inst = this.reusableInstance;
        if (!inst) {
            inst = this.reusableInstance = new this(vm);
        } else {
            inst.vm = vm;
            inst.nextRef = 1;
            inst.refs = new Map();
            inst.todo = [];
        }
        return inst;
    }

    static get reusableInstance() { return this[this.name + "-instance"]; }

    static set reusableInstance(val) { this[this.name + "-instance"] = val; }

    static resetInstance() { this.reusableInstance = null; }

    constructor(vm) {
        this.vm = vm;
        this.nextRef = 1;
        this.refs = new Map();
        this.todo = []; // we use breadth-first writing to limit stack depth
        this.writers = new Map();
        this.addWriter("Teatime:Message", Message);
        this.addWriter("Teatime:Data", DataHandleSpec);
        for (const [classId, ClassOrSpec] of Model.allClassTypes()) {
            this.addWriter(classId, ClassOrSpec);
        }
        this.okayToIgnore = {};
        for (const Class of Model.allClasses()) {
            if (Object.prototype.hasOwnProperty.call(Class, "okayToIgnore")) {
                const props = Class.okayToIgnore();
                if (!Array.isArray(props)) throw new Error("okayToIgnore() must return an array");
                for (const prop of props) {
                    if (prop[0] !== '$') throw Error(`okayToIgnore: ignored prop "${prop}" must start with '$'`);
                    this.okayToIgnore[prop] = true;
                }
            }
        }
}

    addWriter(classId, ClassOrSpec) {
        const {cls, write} = (Object.getPrototypeOf(ClassOrSpec) === Object.prototype) ? ClassOrSpec
            : {cls: ClassOrSpec, write: obj => ({ ...obj })};
        this.writers.set(cls, (obj, path) => this.writeAs(classId, obj, write(obj), path));
    }

    /** @param {VirtualMachine} vm */
    snapshot(vm) {
        const state = {
            _random: vm._random.state(),
            messages: this.write(vm.messages.asArray(), "vm.messages"),
            subscribers: undefined, // do not write subscribers
            controller: undefined, // do not write controller
        };
        for (const [key, value] of Object.entries(vm)) {
            if (key in state) continue;
            this.writeInto(state, key, value, `vm.${key}`);
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
                // JSON disallows NaN and Infinity, and writes -0 as "0"
                if (Object.is(value, -0)) return {$class: "NegZero"};
                if (Number.isSafeInteger(value)) return value;
                if (Number.isNaN(value)) return {$class: "NaN"};
                if (!Number.isFinite(value)) return {$class: "Infinity", $value: Math.sign(value)};
                return this.writeFloat(value);
            case "string":
            case "boolean":
                return value;
            case "undefined":
                return {$class: "Undefined"};
            default: {
                if (this.refs.has(value)) return this.writeRef(value);
                const type = Object.prototype.toString.call(value).slice(8, -1);
                switch (type) {
                    case "Array": return this.writeArray(value, path, defer);
                    case "ArrayBuffer": return this.writeArrayBuffer(value);
                    case "Set":
                        return this.writeAs(type, value, [...value], path);
                    case "Map":
                        return this.writeAs(type, value, [...value].flat(), path); // flatten to single array [key, value, key, value, ...]
                    case "DataView":
                    case "Int8Array":
                    case "Uint8Array":
                    case "Uint8ClampedArray":
                    case "Int16Array":
                    case "Uint16Array":
                    case "Int32Array":
                    case "Uint32Array":
                    case "Float32Array":
                    case "Float64Array":
                        return this.writeTypedArray(type, value);
                    case "Object": {
                        if (value instanceof Model) return this.writeModel(value, path);
                        if (value.constructor === Object || typeof value.constructor !== "function") return this.writeObject(value, path, defer);
                        const writer = this.writers.get(value.constructor);
                        if (writer) return writer(value, path);
                        console.error(`Croquet: unknown class at ${path}:`, value);
                        throw Error(`Croquet: class not registered in Model.types(): ${value.constructor.name}`);
                    }
                    case "Null": return value;
                    default:
                        console.error(`Croquet: unsupported property at ${path}:`, value);
                        throw Error(`Croquet: serialization of ${type}s is not supported`);
                }
            }
        }
    }

    writeModel(model, path) {
        const state = {};
        this.refs.set(model, state);      // register ref before recursing

        try {
            state.$model = Model.classToID(model.constructor);
        } catch (err) {
            console.error(`unregistered model class at ${path}:`, model);
            throw err;
        }

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
            this.writeInto(state, key, value, path);
        }

        return state;
    }

    writeObject(object, path, defer=true) {
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
            this.writeInto(state, key, value, path, defer);
        }

        return state;
    }

    writeArray(array, path, defer=true) {
        const state = [];
        this.refs.set(array, state);       // register ref before recursing
        for (let i = 0; i < array.length; i++) {
            this.writeInto(state, i, array[i], path, defer);
        }
        return state;
    }

    writeArrayBuffer(buffer) {
        const state = {
            $class: "ArrayBuffer",
            $value: arrayBufferToBase64(buffer),
        };
        this.refs.set(buffer, state);
        return state;
    }

    writeTypedArray(type, array) {
        const state = {
            $class: type,
            $value: [this.writeArrayBuffer(array.buffer), array.byteOffset, type === "DataView" ? array.byteLength : array.length],
        };
        this.refs.set(array, state);
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
        const state = { $class: classID };
        this.refs.set(object, state);      // register ref before recursing
        const written = this.write(value, path, false);
        // only use $value property if necessary
        if (typeof written !== "object" || written.$class || Array.isArray(written)) state.$value = written;
        else Object.assign(state, written);
        return state;
    }

    writeRef(object) {
        const state = this.refs.get(object);
        if (typeof state !== "object") throw Error("Non-object in refs: " + object);
        if (Array.isArray(state)) {
            // usually, extra properties on arrays don't get serialized to JSON
            // so we use this hack that does a one-time replacement of toJSON
            // on this particular array (and restore it in readAsArray() below)
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
        if (key[0] === '$') {
            if (!this.okayToIgnore[key]) {
                displayWarning(`snapshot: ignoring property ${key} (declare as okayToIgnore to suppress warning)`, { only: "once" });
                this.okayToIgnore[key] = true;
            }
            return;
        }
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

class VMReader {
    static newOrRecycled(vm) {
        let inst = this.reusableInstance;
        if (!inst) {
            inst = this.reusableInstance = new this(vm);
        } else {
            inst.vm = vm;
            inst.refs = new Map();
            inst.todo = [];
            inst.unresolved = [];
        }
        return inst;
    }

    static get reusableInstance() { return this[this.name + "-instance"]; }

    static set reusableInstance(val) { this[this.name + "-instance"] = val; }

    static resetInstance() { this.reusableInstance = null; }

    constructor(vm) {
        this.vm = vm;
        this.refs = new Map();
        this.todo = [];   // we use breadth-first deferred reading to limit stack depth
        this.unresolved = [];
        this.readers = new Map();
        this.addReader("Teatime:Message", Message);
        this.addReader("Teatime:Data", DataHandleSpec);
        this.readers.set("Undefined", () => undefined);
        this.readers.set("NaN", () => NaN);
        this.readers.set("Infinity", sign => sign * Infinity);
        this.readers.set("NegZero", () => -0);
        this.readers.set("ArrayBuffer", data => base64ToArrayBuffer(data));
        this.readers.set("DataView", args => new DataView(...args));
        this.readers.set("Int8Array", args => new Int8Array(...args));
        this.readers.set("Uint8Array", args => new Uint8Array(...args));
        this.readers.set("Uint8ClampedArray", args => new Uint8ClampedArray(...args));
        this.readers.set("Int16Array", args => new Int16Array(...args));
        this.readers.set("Uint16Array", args => new Uint16Array(...args));
        this.readers.set("Int32Array", args => new Int32Array(...args));
        this.readers.set("Uint32Array", args => new Uint32Array(...args));
        this.readers.set("Float32Array", args => new Float32Array(...args));
        this.readers.set("Float64Array", args => new Float64Array(...args));
        for (const [classId, ClassOrSpec] of Model.allClassTypes()) {
            this.addReader(classId, ClassOrSpec);
        }
    }

    addReader(classId, ClassOrSpec) {
        const read = (typeof ClassOrSpec === "object") ? ClassOrSpec.read
            : state => Object.assign(Object.create(ClassOrSpec.prototype), state);
        this.readers.set(classId, read);
    }

    readVM(snapshot, root) {
        if (root !== "vm") throw Error("VirtualMachine must be root object");
        const vmData = {
            _random: new SeedRandom(null, { state: snapshot._random }),
        };
        for (const [key, value] of Object.entries(snapshot)) {
            if (!vmData[key]) this.readInto(vmData, key, value, `vm.${key}`);
        }
        this.readDeferred();
        this.resolveRefs();
        return vmData;
    }

    readDeferred() {
        while (this.todo.length > 0) {
            const {object, key, value, path} = this.todo.shift();
            this.readInto(object, key, value, path, false);
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

    read(value, path, defer=true) {
        // if defer is false, this is the $value property of an object,
        // which is either a plain Array or a plain Object
        switch (typeof value) {
            case "number":
            case "string":
            case "boolean":
                return value;
            default: {
                const type = Object.prototype.toString.call(value).slice(8, -1);
                switch (type) {
                    case "Array": return this.readArray(value, path, defer);
                    case "Null": return null;
                    case "Object": {
                        const { $class, $model, $ref } = value;
                        if ($ref) throw Error("refs should have been handled in readInto()");
                        if ($model) return this.readModel(value, path);
                        if ($class) return this.readAs($class, value, path);
                        return this.readObject(Object, value, path, defer);
                    }
                    default:
                        throw Error(`Don't know how to deserialize ${type} at ${path}`);
                }
            }
        }
    }

    readModel(state, path) {
        const model = Model.instantiateClassID(state.$model, state.id);
        if (state.$id) this.refs.set(state.$id, model);
        for (const [key, value] of Object.entries(state)) {
            if (key === "id" || key[0] === '$') continue;
            this.readInto(model, key, value, path);
        }
        return model;
    }

    readObject(Class, state, path, defer=true) {
        const object = new Class();
        if (state.$id) this.refs.set(state.$id, object);
        for (const [key, value] of Object.entries(state)) {
            if (key[0] === '$') continue;
            this.readInto(object, key, value, path, defer);
        }
        return object;
    }

    readArray(array, path, defer=true) {
        const result = [];
        if (array.$id) this.refs.set(array.$id, result);
        for (let i = 0; i < array.length; i++) {
            if (array[i] !== undefined) this.readInto(result, i, array[i], path, defer); // allow for missing indices
        }
        return result;
    }

    // special case for arrays with a $id property which is not preserved by JSON
    // instead they were serialized as { $class: "Array", $value: [...], $id: ... }
    // in writeRef(), so we restore the $id property here
    readAsArray(state, path, defer=true) {
        const array = state.$value;
        if (state.$id) array.$id = state.$id;
        return this.readArray(array, path, defer);
    }

    readAsSet(state, path) {
        const set = new Set();
        if (state.$id) this.refs.set(state.$id, set);
        const contents = this.read(state.$value, path, false);
        for (const item of contents) set.add(item);
        return set;
    }

    readAsMap(state, path) {
        const map = new Map();
        if (state.$id) this.refs.set(state.$id, map);
        const contents = this.read(state.$value, path, false);
        for (let i = 0; i < contents.length; i +=2) map.set(contents[i], contents[i + 1]);
        return map;
    }

    readAsClass(classID, state, path) {
        let temp = {};
        const unresolved = new Map();
        if ("$value" in state) temp = this.read(state.$value, path, false);
        else for (const [key, value] of Object.entries(state)) {
            if (key[0] === '$') continue;
            const ref = value && value.$ref;
            if (ref) {
                if (this.refs.has(ref)) temp[key] = this.refs.get(ref);
                else {
                    temp[key] = "<unresolved>";
                    unresolved.set(ref, key);
                }
            } else {
                this.readInto(temp, key, value, path, false);
            }
        }
        const reader = this.readers.get(classID);
        const object = reader(temp, path);
        if (!object && classID !== "Undefined" && classID !== "NaN" && classID !== "NegZero") console.warn(`Reading "${classID}" returned ${object} at ${path}`);
        if (state.$id) this.refs.set(state.$id, object);
        for (const [ref, key] of unresolved.entries()) {
            this.unresolved.push({object, key, ref, path});
        }
        return object;
    }

    readAs(classID, state, path) {
        switch (classID) {
            case "Array": return this.readAsArray(state, path);
            case "Set": return this.readAsSet(state, path);
            case "Map": return this.readAsMap(state, path);
            default: return this.readAsClass(classID, state, path);
        }
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

    readInto(object, key, value, path, defer=true) {
        if (this.readRef(object, key, value, path)) return;
        if (defer && typeof value === "object") {
            this.todo.push({object, key, value, path});
            return;
        }
        const simpleKey = typeof key === "string" && key.match(/^[_a-z][_a-z0-9]*$/i);
        const newPath = path + (simpleKey ? `.${key}` : `[${JSON.stringify(key)}]`);
        object[key] = this.read(value, newPath); // always deferred
    }
}

class MessageArgumentEncoder extends VMWriter {
    encode(args) {
        const encoded = this.writeArray(args, "args");
        this.writeDeferred();
        return encoded;
    }

    writeModel(model) {
        return { $ref: model.id };
    }
}

class MessageArgumentDecoder extends VMReader {
    decode(args) {
        const decoded = this.readArray(args, "args");
        this.readDeferred();
        this.resolveRefs();
        return decoded;
    }

    resolveRefs() {
        for (const {object, key, ref, path} of this.unresolved) {
            if (this.refs.has(ref)) {
                object[key] = this.refs.get(ref);
            } else {
                const model = this.vm.lookUpModel(ref);
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
    VMReader.resetInstance();
    VMWriter.resetInstance();
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
        const className = prefix + '.' + obj.constructor.name;
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

function arrayBufferToBase64(buffer) {
    const array = new Uint8Array(buffer);
    const dest = [];
    for (let i = 0; i < array.byteLength; i += 4096) {
        const chunk = array.subarray(i, i + 4096);
        dest.push(String.fromCharCode.apply(null, chunk));
    }
    return globalThis.btoa(dest.join(''));
}

function base64ToArrayBuffer(base64) {
    const string = globalThis.atob(base64);
    const n = string.length;
    const array = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        array[i] = string.charCodeAt(i);
    }
    return array.buffer;
}
