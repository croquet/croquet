import SeedRandom from "seedrandom";
import PriorityQueue from "@croquet/util/priorityQueue";
import hotreload from "@croquet/util/hotreload";
import Model from "./model";
import { inModelRealm, inViewRealm } from "./realms";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


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

        this.viewsById = {};
        this.modelsById = {};
        this.modelsByName = {};
        // Models can only subscribe to other model events
        // Views can subscribe to model or other view events
        this.modelSubscriptions = {};
        this.viewSubscriptions = {};
        /** queue of view events generated by model in this frame */
        this.frameEventQueue = [];
        /** data of oncePerFrame events generated by model in this frame */
        this.frameEventMap = new Map();
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
                        const ModelClass = Model.classFromState(modelState);
                        const model = new ModelClass();
                        this.registerModel(model, modelState.id);
                    }

                    for (const [modelName, modelId] of Object.entries(snapshot.namedModels)) {
                        this.set(modelName, this.lookUpModel(modelId));
                    }

                    // restore model snapshot, allow resolving object references
                    for (const modelState of snapshot.models || []) {
                        const model = this.modelsById[modelState.id];
                        model.load(modelState, this.modelsById);
                    }
                    // restore messages
                    for (const messageState of snapshot.messages || []) {
                        const message = Message.fromState(messageState);
                        this.messages.add(message);
                    }
                    // now it's safe to use stored random
                    this._random = new SeedRandom(null, { state: snapshot.random });
                    // start all models
                    for (const model of Object.values(this.modelsById)) {
                        model.start();
                    }
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
        this.modelsById[id] = model;
        return id;
    }

    deregisterModel(id) {
        if (CurrentIsland !== this) throw Error("Island Error");
        delete this.modelsById[id];
        this.messages.removeMany(msg => msg.hasReceiver(id));
    }

    lookUpModel(id) {
        if (id === this.id) return this;
        return this.modelsById[id];
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
        const model = this.lookUpModel(modelId);
        if (!model) { console.error(Error(`Model not found: ${modelId}`)); return; }
        const recipient = model.lookUp(subPartPath);
        if (!recipient) { console.error(Error(`Model part not found: ${modelId}.${subPartPath}`)); return; }
        const message = new Message(this.time, 0, recipient.id, selector, args);
        this.controller.sendMessage(message);
    }

    sendNoop() {
        // this is only used for syncing after a snapshot
        const message = new Message(this.time, 0, this.id, "noop", []);
        this.controller.sendMessage(message);
    }

    noop() {}

    /** decode msgData and sort it into future queue
     * @param {MessageData} msgData - encoded message
     * @return {Message} decoded message
     */
    processExternalMessage(msgData) {
        const message = Message.fromState(msgData);
        if (message.time < this.time) throw Error("past message from reflector " + msgData);
        this.messages.add(message);
        this.externalTime = message.time; // we have all external messages up to this time
        return message;
    }

    futureSend(tOffset, receiverID, selector, args) {
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

    addModelSubscription(scope, event, subscriberId, methodNameOrCallback) {
        if (CurrentIsland !== this) throw Error("Island Error");
        let methodName = methodNameOrCallback;
        if (typeof methodNameOrCallback === "function") {
            // match                   foo              =>  this .   bar               (    baz               )
            const HANDLER_REGEX = /^\(?([a-z][a-z0-9]*)?\)? *=> *this\.([a-z][a-z0-9]*) *\( *([a-z][a-z0-9]*)? *\) *$/i;
            const source = methodNameOrCallback.toString();
            const match = source.match(HANDLER_REGEX);
            if (!match || (match[3] && match[3] !== match[1])) {
                throw Error(`Subscription handler must look like "data => this.method(data)" not "${methodNameOrCallback}"`);
            }
            methodName = match[2];
        }
        if (typeof methodName !== "string") {
            throw Error(`Subscription handler for "${event}" must be a method name`);
        }
        const model = this.lookUpModel(subscriberId);
        if (typeof model[methodName] !== "function") {
            throw Error(`Subscriber method for "${event}" not found: ${model}.${methodName}()`);
        }
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + methodName;
        // model subscriptions need to be ordered, so we're using an array
        if (!this.modelSubscriptions[topic]) this.modelSubscriptions[topic] = [];
        else if (this.modelSubscriptions[topic].indexOf(handler) !== -1) {
            throw Error(`${model}.${methodName} already subscribed to ${event}`);
        }
        this.modelSubscriptions[topic].push(handler);
    }

    removeModelSubscription(scope, event, subscriberId, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = subscriberId + "." + methodName;
        const handlers = this.modelSubscriptions[topic];
        if (handlers) {
            const indexToRemove = handlers.indexOf(handler);
            handlers.splice(indexToRemove, 1);
            if (handlers.length === 0) delete this.modelSubscriptions[topic];
        }
    }


    removeAllSubscriptionsFor(subscriberId) {
        const topicPrefix = `${subscriberId}:`;
        const handlerPrefix = `${subscriberId}.`;
        // TODO: optimize this - reverse lookup table?
        for (const [topic, handlers] of Object.entries(this.modelSubscriptions)) {
            if (topic.startsWith(topicPrefix)) delete this.modelSubscriptions[topic];
            else {
                for (let i = handlers.length - 1; i >= 0; i--) {
                    if (handlers[i].startsWith(handlerPrefix)) {
                        handlers.splice(i, 1);
                    }
                }
                if (handlers.size === 0) delete this.modelSubscriptions[topic];
            }
        }
        // TODO: optimize this - reverse lookup table?
        for (const [topic, subs] of Object.entries(this.viewSubscriptions)) {
            if (topic.startsWith(topicPrefix)) delete this.viewSubscriptions[topic];
            else {
                for (const kind of ["onceHandlers", "queueHandlers"]) {
                    for (const handler of subs[kind]) {
                        if (handler.for === subscriberId || handler.for.startsWith(handlerPrefix)) {
                            subs[kind].delete(handler);
                        }
                    }
                }
                if (subs.onceHandlers.size + subs.queueHandlers.size === 0) {
                    delete this.viewSubscriptions[topic];
                }
            }
        }
    }

    removeAllModelSubscriptionsFor(subscriberId) {
        this.removeAllSubscriptionsFor(subscriberId);
    }

    addViewSubscription(scope, event, subscriberId, methodNameOrCallback, oncePerFrame) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        let handler;
        if (typeof methodNameOrCallback === "string") {
            handler = (...args) => {
                this.viewsById[subscriberId][methodNameOrCallback](...args);
            };
            handler.for = subscriberId + "." + methodNameOrCallback;
        } else {
            handler = methodNameOrCallback;
            handler.for = subscriberId;
        }
        let subs = this.viewSubscriptions[topic];
        if (!subs) subs = this.viewSubscriptions[topic] = {
            data: [],
            onceHandlers: new Set(),
            queueHandlers: new Set(),
        };
        if (oncePerFrame) subs.onceHandlers.add(handler);
        else subs.queueHandlers.add(handler);
    }

    removeViewSubscription(scope, event, subscriberId, methodNameOrCallback) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        const subs = this.viewSubscriptions[topic];
        let handlerToRemove;
        if (subs) {
            if (typeof methodNameOrCallback === "string") {
                handlerToRemove = [...subs.onceHandlers].find(
                    handler => handler.for === subscriberId + "." + methodNameOrCallback
                );
                handlerToRemove = handlerToRemove || [...subs.queueHandlers].find(
                    handler => handler.for === subscriberId + "." + methodNameOrCallback
                );
            } else {
                handlerToRemove = methodNameOrCallback;
            }
            subs.onceHandlers.delete(handlerToRemove);
            subs.queueHandlers.delete(handlerToRemove);
            if (subs.onceHandlers.size + subs.queueHandlers.size === 0) {
                delete this.viewSubscriptions[topic];
            }
        }
    }

    removeAllViewSubscriptionsFor(subscriberId) {
        this.removeAllSubscriptionsFor(subscriberId);
    }

    publishFromModel(scope, event, data) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        this.handleModelEventInModel(topic, data);
        this.handleModelEventInView(topic, data);
    }

    publishFromView(scope, event, data) {
        if (CurrentIsland) throw Error("Island Error");
        const topic = scope + ":" + event;
        this.handleViewEventInModel(topic, data);
        this.handleViewEventInView(topic, data);
    }

    handleModelEventInModel(topic, data) {
        // model=>model events are always handled synchronously
        // because making them async would mean having to use future messages
        if (CurrentIsland !== this) throw Error("Island Error");
        if (this.modelSubscriptions[topic]) {
            for (const handler of this.modelSubscriptions[topic]) {
                const [id, methodName] = handler.split('.');
                const model = this.lookUpModel(id);
                model[methodName](data);
            }
        }
    }

    handleViewEventInModel(topic, data) {
        // view=>model events are converted to model=>model events via reflector
        if (this.modelSubscriptions[topic]) {
            const message = new Message(this.time, 0, this.id, "handleModelEventInModel", [topic, data]);
            this.controller.sendMessage(message);
        }
    }

    handleModelEventInView(topic, data) {
        // model=>view events are typically queued for later execution from the main loop
        // The subscriber is encouraged to request batch handling, which only invokes the handler
        // for the latest event per render frame (e.g. to batch multiple position updates into one)
        // TODO: The subscriber may request immediate handling, but it must not modify model state!
        const topicSubscribers = this.viewSubscriptions[topic];
        if (topicSubscribers) {
            if (topicSubscribers.queueHandlers.size > 0) this.frameEventQueue.push({topic, data});
            if (topicSubscribers.onceHandlers.size > 0) this.frameEventMap.set(topic, data);
            // for (const handler of topicSubscribers.immediateHandlers) handler(data);
        }
    }

    handleViewEventInView(topic, data) {
        // view=>view events are handled immediately
        const subscriptions = this.viewSubscriptions[topic];
        if (subscriptions) {
            for (const handler of subscriptions.queueHandlers) handler(data);
            for (const handler of subscriptions.onceHandlers) handler(data);
        }
    }

    // this is called from main loop to process queued model=>view events
    processModelViewEvents() {
        if (CurrentIsland) throw Error("Island Error");
        inViewRealm(this, () => {
            // process queued events in order
            for (const {topic, data} of this.frameEventQueue) {
                const subscriptions = this.viewSubscriptions[topic];
                if (subscriptions) {
                    for (const handler of subscriptions.queueHandlers) handler(data);
                }
            }
            this.frameEventQueue.length = 0;
            // process oncePerFrame events in any order
            for (const [topic, data] of this.frameEventMap) {
                const subscriptions = this.viewSubscriptions[topic];
                if (subscriptions) {
                    for (const handler of subscriptions.onceHandlers) handler(data);
                }
            }
            this.frameEventMap.clear();
        });
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
            models: Object.values(this.modelsById).map(model => {
                const state = {};
                model.save(state);
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


/** Message encoders / decoders.
 * Pattern is "receiver#selector" or "*#selector" or "*"
 * @type { { pattern: {encoder: Function, decoder: Function} }'receiver#selector'
 */
const transcoders = {};

export function addMessageTranscoder(pattern, transcoder) {
    transcoders[pattern] = transcoder;
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

    hasReceiver(id) {
        return this.payload.split('#')[0] === id;
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
        const object = island.lookUpModel(receiver);
        if (!object) console.warn(`Error executing ${this}: receiver not found`);
        else if (typeof object[selector] !== "function") console.warn(`Error executing ${this}: method not found`);
        else execOnIsland(island, () => {
            inModelRealm(island, () => {
                try {
                    object[selector](...args);
                } catch (error) {
                    console.error(`Error executing ${this}`, error);
                }
            });
        });
    }

    [Symbol.toPrimitive]() {
        const { receiver, selector, args } = decode(this.payload);
        return `${this.seq & 1 ? 'External' : 'Future'}Message[${this.time}:${this.seq} ${receiver}.${selector}(${args.map(JSON.stringify).join(', ')})]`;
    }
}
