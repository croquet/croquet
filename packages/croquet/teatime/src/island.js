import SeedRandom from "seedrandom/seedrandom";
import PriorityQueue from "@croquet/util/priorityQueue";
import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import Model from "./model";
import { inModelRealm, inViewRealm, currentRealm } from "./realms";
import { viewDomain } from "./domain";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** @type {Island} */
let CurrentIsland = null;

const Math_random = Math.random.bind(Math);
Math.random = () => {
    if (CurrentIsland) return CurrentIsland.random();
    return Math_random();
};
hotreloadEventManger.addDisposeHandler("math-random", () => Math.random = Math_random);

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
                /** @type {Number} number for giving ids to model */
                this.modelsId = 0;
                if (snapshot.modelsById) {
                    // read island from snapshot
                    const reader = new IslandReader(this);
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

    /** decode msgData and sort it into future queue
     * @param {MessageData} msgData - encoded message
     * @return {Message} decoded message
     */
    scheduleExternalMessage(msgData) {
        const message = Message.fromState(msgData);
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
        this.futureSeq = (this.futureSeq + 2) % (Number.MAX_SAFE_INTEGER + 1);
        const message = new Message(this.time + tOffset, this.futureSeq, receiverID, selector, args);
        this.messages.add(message);
        return message;
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
     * @param {Number} newTime - simulate at most up to this time
     * @param {Number} deadline - CPU time deadline for interrupting simulation
     * @returns {Boolean} true if finished simulation before deadline
     */
    advanceTo(newTime, deadline) {
        if (CurrentIsland) throw Error("Island Error");
        let count = 0;
        let message;
        while ((message = this.messages.peek()) && message.time <= newTime) {
            const { time, seq } = message;
            if (time < this.time) throw Error("past message encountered: " + message);
            if (seq & 1) {
                this.seq = (this.seq + 1) >>> 0;  // uint32 rollover
                if ((seq/2) >>> 0 !== this.seq) throw Error(`Sequence error: expected ${this.seq} got ${(seq/2) >>> 0} in ${message}`);
            }
            this.messages.poll();
            if (this.time !== message.time) {
                this.time = message.time;
                // advance random number generator
                this._random.int32();
            }
            message.executeOn(this);
            if (++count > 100) { count = 0; if (Date.now() > deadline) return false; }
        }
        this.time = newTime;
        return true;
    }


    // Pub-sub

    addSubscription(scope, event, modelId, methodNameOrCallback) {
        if (CurrentIsland !== this) throw Error("Island Error");
        let methodName = methodNameOrCallback;
        if (typeof methodNameOrCallback === "function") {
            // match:                (   foo             )   =>  this .  bar              (    baz               )
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
        const model = this.lookUpModel(modelId);
        if (typeof model[methodName] !== "function") {
            throw Error(`Subscriber method for "${event}" not found: ${model}.${methodName}()`);
        }
        const topic = scope + ":" + event;
        const handler = modelId + "." + methodName;
        // model subscriptions need to be ordered, so we're using an array
        if (!this.subscriptions[topic]) this.subscriptions[topic] = [];
        else if (this.subscriptions[topic].indexOf(handler) !== -1) {
            throw Error(`${model}.${methodName} already subscribed to ${event}`);
        }
        this.subscriptions[topic].push(handler);
    }

    removeSubscription(scope, event, modelId, methodName) {
        if (CurrentIsland !== this) throw Error("Island Error");
        const topic = scope + ":" + event;
        const handler = modelId + "." + methodName;
        const handlers = this.subscriptions[topic];
        if (handlers) {
            const indexToRemove = handlers.indexOf(handler);
            handlers.splice(indexToRemove, 1);
            if (handlers.length === 0) delete this.subscriptions[topic];
        }
    }

    removeAllSubscriptionsFor(modelId) {
        const topicPrefix = `${modelId}:`;
        const handlerPrefix = `${modelId}.`;
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
        if (this.subscriptions[topic]) {
            for (const handler of this.subscriptions[topic]) {
                const [id, methodName] = handler.split('.');
                const model = this.lookUpModel(id);
                model[methodName](data);
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
        viewDomain.handleEvent(topic, data);
    }

    handleViewEventInView(topic, data) {
        viewDomain.handleEvent(topic, data);
    }

    processModelViewEvents() {
        if (CurrentIsland) throw Error("Island Error");
        inViewRealm(this, () => viewDomain.processFrameEvents());
    }

    scheduledSnapshot() {
        this.controller.scheduledSnapshot();
    }

    snapshot() {
        const writer = new IslandWriter(this);
        return writer.snapshot(this, "$");
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
        const encoder = new MessageArgumentEncoder();
        args = encoder.encode(args);
    }
    return `${receiver}>${selector}${args.length > 0 ? JSON.stringify(args):""}`;
}

function decode(payload, island) {
    const [_, msg, argString] = payload.match(/^([^[]+)(\[.*)?$/i);
    const [receiver, selector] = msg.split('>');
    let args = [];
    if (argString) {
        const decoder = new MessageArgumentDecoder(island);
        args = decoder.decode(JSON.parse(argString));
    }
    return {receiver, selector, args};
}

function hasReceiver(payload, id) {
    return payload.match(new RegExp(`^${id}>`));
}

function hasSelector(payload, selector) {
    return payload.match(new RegExp(`>${selector}\\b`));
}

function hasReceiverAndSelector(payload, id, selector) {
    return payload.match(new RegExp(`^${id}>${selector}\\b`));
}

/** answer true if seqA comes before seqB */
function inSequence(seqA, seqB) {
    const seqDelta = (seqB - seqA) >>> 0; // make unsigned
    return seqDelta < 0x8000000;
}

export class Message {
    static hasReceiver(msgData, id) { return hasReceiver(msgData[2], id); }
    static hasSelector(msgData, sel) { return hasSelector(msgData[2], sel); }
    static hasReceiverAndSelector(msgData, id, sel) { return hasReceiverAndSelector(msgData[2], id, sel); }

    constructor(time, seq, receiver, selector, args) {
        this.time = time;
        this.seq = seq;
        this.payload = encode(receiver, selector, args);
    }

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
    hasSelector(sel) { return hasSelector(this.payload, sel); }
    hasReceiverAndSelector(id, sel) { return hasReceiverAndSelector(this.payload, id, sel); }

    isExternal() { return this.seq & 1; }
    get externalSeq() { return (this.seq / 2) >>> 0; }
    set externalSeq(seq) { this.seq = seq * 2 + 1; }
    get internalSeq() { return (this.seq / 2) >>> 0; }
    set internalSeq(seq) { this.seq = seq * 2; }

    asState() {
        return [this.time, this.seq, this.payload];
    }

    static fromState(state) {
        const [time, seq, payload] = state;
        const { receiver, selector, args } = decode(payload);
        return new Message(time, seq, receiver, selector, args);
    }

    executeOn(island) {
        const { receiver, selector, args } = decode(this.payload, island);
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

    toString() {
        const { receiver, selector, args } = decode(this.payload);
        const ext = this.isExternal();
        const seq = ext ? this.externalSeq : this.internalSeq;
        return `${ext ? 'External' : 'Future'}Message[${this.time}${':#'[+ext]}${seq} ${receiver}.${selector}(${args.map(JSON.stringify).join(', ')})]`;
    }

    [Symbol.toPrimitive]() { return this.toString(); }
}

const floats = new Float64Array(2);
const ints = new Uint32Array(floats.buffer);

class IslandWriter {
    constructor(island) {
        this.island = island;
        this.nextRef = 1;
        this.refs = new Map();
        this.todo = []; // we use breadth-first writing to limit stack depth
        this.writers = new Map();
        this.addWriter("Teatime:Message", Message);
        for (const modelClass of Model.allClasses()) {
            if (!Object.prototype.hasOwnProperty.call(modelClass, "types")) continue;
            for (const [classId, ClassOrSpec] of Object.entries(modelClass.types())) {
                this.addWriter(classId, ClassOrSpec);
            }
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
        const descriptors = Object.getOwnPropertyDescriptors(model);
        for (const key of Object.keys(descriptors).sort()) {
            if (key === "__realm") continue;
            const descriptor = descriptors[key];
            if (descriptor.value !== undefined) {
                this.writeInto(state, key, descriptor.value, path);
            }
        }
        return state;
    }

    writeObject(object, path, defer=true) {
        if (this.refs.has(object)) return this.writeRef(object);
        const state = {};
        this.refs.set(object, state);      // register ref before recursing
        const descriptors = Object.getOwnPropertyDescriptors(object);
        for (const key of Object.keys(descriptors).sort()) {
            const descriptor = descriptors[key];
            if (descriptor.value !== undefined) {
                this.writeInto(state, key, descriptor.value, path, defer);
            }
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
        floats[0] = value;
        floats[1] = JSON.parse(JSON.stringify(value));
        if (ints[0] !== ints[2] || ints[1] !== ints[3]) throw Error("Float serialization error");
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
        if (key[0] === '$') { console.warn(`ignoring property ${path}`); return; }
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
    constructor(island) {
        this.island = island;
        this.refs = new Map();
        this.todo = [];   // we use breadth-first reading to limit stack depth
        this.unresolved = [];
        this.readers = new Map();
        this.addReader("Teatime:Message", Message);
        for (const modelClass of Model.allClasses()) {
            if (!Object.prototype.hasOwnProperty.call(modelClass, "types")) continue;
            for (const [classId, ClassOrSpec] of Object.entries(modelClass.types())) {
                this.addReader(classId, ClassOrSpec);
            }
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
        const ModelClass = Model.classFromID(state.$model);
        const model = this.readObject(ModelClass, state, path);
        model.__realm = currentRealm();
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
        for (let i = 0; i < array.length; i++) {
            this.readInto(result, i, array[i], path, nodefer);
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
                    temp[key] = "placeholder";
                    unresolved.set(ref, key);
                }
            } else {
                this.readInto(temp, key, value, path, 1);
            }
        }
        const reader = this.readers.get(classID);
        const object = reader(temp, path);
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
            object[key] = "placeholder";
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
        return decoded;
    }

    resolveRefs() {
        for (const {object, key, ref, path} of this.unresolved) {
            if (this.refs.has(ref)) {
                object[key] = this.refs.get(ref);
            } else {
                const model = this.island.lookUp(ref);
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
