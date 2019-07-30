import "@croquet/util/deduplicate";
import AsyncQueue from "@croquet/util/asyncQueue";
import Stats from "@croquet/util/stats";
import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import urlOptions from "@croquet/util/urlOptions";
import { login, getUser } from "@croquet/util/user";
import { displaySpinner, displayStatus, displayWarning, displayError, displayAppError } from "@croquet/util/html";
import { baseUrl, CROQUET_HOST, hashNameAndCode, hashString } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import { viewDomain } from "./domain";
import Island, { Message, inSequence } from "./island";


/** @typedef { import('./model').default } Model */


// when reflector has a new feature, we increment this value
// only newer clients get to use it
const VERSION = 1;

export const SDK_VERSION = process.env.CROQUET_VERSION || "<unknown>";
console.log("Croquet SDK " + SDK_VERSION);


const FALLBACK_REFLECTOR = `wss://${CROQUET_HOST}/reflector-v1`;
const DEFAULT_REFLECTOR = process.env.CROQUET_REFLECTOR || FALLBACK_REFLECTOR;    // replaced by parcel at build time from app's .env file

const codeHashes = null; // individual codeHashes are not uploaded for now, will need to re-add for replay

const DEBUG = {
    messages: urlOptions.has("debug", "messages", false),               // received messages
    sends: urlOptions.has("debug", "sends", false),                     // sent messages
    ticks: urlOptions.has("debug", "ticks", false),                     // received ticks
    pong: urlOptions.has("debug", "pong", false),                       // received PONGs
    snapshot: urlOptions.has("debug", "snapshot", false),               // snapshotting, uploading etc
    session: urlOptions.has("debug", "session", false),                 // session logging
    initsnapshot: urlOptions.has("debug", "initsnapshot", "localhost"), // check snapshotting after init
    init: urlOptions.has("debug", "init", "localhost"),                 // always run init() if first user in session
};

const NOCHEAT = urlOptions.nocheat;

const OPTIONS_FROM_URL = [ 'tps' ];

// schedule a snapshot after this many ms of CPU time have been used for simulation
const SNAPSHOT_EVERY = 5000;
// add this many ms for each external message scheduled
const EXTERNAL_MESSAGE_CPU_PENALTY = 5;

// backlog threshold in ms to publish "synced(true|false)" event (to start/stop rendering)
const SYNCED_MIN = 100;
const SYNCED_MAX = 1000;

function randomString() { return Math.floor(Math.random() * 2**53).toString(36); }

const Controllers = new Set();

export default class Controller {

    static uploadOnPageClose() {
        for (const controller of Controllers) {
            controller.uploadOnPageClose();
        }
    }

    constructor() {
        this.reset();
        viewDomain.addSubscription(this.viewId, "__users__", this, data => displayStatus(`users now ${data.count}`), "oncePerFrameWhileSynced");
    }

    reset() {
        /** @type {Island} */
        this.island = null;
        /**  @type {Connection} our websocket connection for talking to the reflector */
        this.connection = this.connection || new Connection(this);
        /** the messages received from reflector */
        this.networkQueue = new AsyncQueue();
        /** the time stamp of last message received from reflector */
        this.time = 0;
        /** the human-readable session name (e.g. "room/user/random") */
        this.session = '';
        /** @type {String} the client id (different in each replica, but stays the same on reconnect) */
        this.viewId = this.viewId || randomString(); // todo: have reflector assign unique ids
        /** the number of concurrent users in our island (excluding spectators) */
        this.users = 0;
        /** the number of concurrent users in our island (including spectators) */
        this.usersTotal = 0;
        /** old snapshots */
        this.snapshots = [];
        /** external messages already scheduled in the island */
        this.oldMessages = [];
        /** CPU time spent simulating since last snapshot */
        this.cpuTime = 0;
        // on reconnect, show spinner
        if (this.synced) displaySpinner(true);
        /** @type {Boolean} backlog was below SYNCED_MIN */
        this.synced = null; // null indicates never synced before
        /** latency statistics */
        this.statistics = {
            /** for identifying our own messages */
            id: this.viewId,
            /** for identifying each message we sent */
            seq: 0,
            /** time when message was sent */
            sent: {},
        };
        /** last measured latency in ms */
        this.latency = 0;
        // make sure we have no residual "multiply" ticks
        if (this.localTicker) {
            window.clearInterval(this.localTicker);
            delete this.localTicker;
        }
    }

    /** @type {String} the session id (same for all replicas) */
    get id() { return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    /** @type {Object} {id, name} the user id (identifying this client) and name (from login or "GUEST") */
    get user() { return { id: this.viewId, name: getUser("name", "GUEST") }; }

    /**  @type {Number} how many ms the simulation is lagging behind the last tick from the reflector */
    get backlog() { return this.island ? this.time - this.island.time : 0; }

    /** @type {Number} how many ms passed since we received something from reflector */
    get starvation() { return Date.now() - this.lastReceived; }

    /** @type {Number} how many ms passed since we sent a message via the reflector */
    get activity() { return Date.now() - this.lastSent; }

    /** @type {Boolean} true if our connection is fine */
    get connected() { return this.connection.connected; }

    checkForConnection(force) { this.connection.checkForConnection(force); }

    dormantDisconnect() { this.connection.dormantDisconnect(); }

    /**
     * Join or create a session by connecting to the reflector
     * - the island/session id is created from `name` and
     *   a hash of registered options and source code
     * - if `autoSession` is enabled then the session name is taken
     *   from the URL, or a random session is created
     *
     * @param {String} name - A (human-readable) name for the session/room
     * @param {Object} sessionSpec - Spec for the session
     * @param {Function} sessionSpec.init - the island initializer `init(options)`
     * @param {Function} sessionSpec.destroyerFn - optional island destroyer (called with a snapshot when disconnecting)
     * @param {Object} sessionSpec.options - options to pass to the island initializer
     * @param {Object} sessionSpec.snapshot - an optional snapshot to use (instead of running the island initializer if this is the first user in the session
     * @param {Array<String>} sessionSpec.optionsFromUrl - names of additional island initializer options to take from URL
     * @param {Number|String} sessionSpec.tps - ticks per second (can be overridden by `options.tps` or `urlOptions.tps`)
     * @param {Boolean} sessionSpec.login - if `true` perform login
     * @param {Boolean} sessionSpec.autoSession - if `true` take session name from URL or create new random session name
     * @param {Boolean} sessionSpec.multiRoom - if `true` then autoSession includes the room name
     *
     * @returns {Promise<{rootModel:Model}>} list of named models (as returned by init function)
     */
    async establishSession(name, sessionSpec) {
        const { optionsFromUrl, multiRoom, autoSession, login: doLogin } = sessionSpec;
        const options = {...sessionSpec.options};
        for (const key of [...OPTIONS_FROM_URL, ...optionsFromUrl||[]]) {
            if (key in urlOptions) options[key] = urlOptions[key];
        }
        if (doLogin) await login();
        if (autoSession) {
            // session is either "user/random" or "room/user/random" (for multi-room)
            const room = name;
            const session = urlOptions.getSession().split('/');
            let user = multiRoom ? session[1] : session[0];
            let random = multiRoom ? session[2] : session[1];
            const newSession = !user || !random;
            if (newSession) {
                if (autoSession.user) user = autoSession.user;
                if (autoSession.random) random = autoSession.random;
                // incomplete session: create a new session id
                if (!user) user = getUser("name", "").toLowerCase() || "GUEST";
                if (!random) random = randomString();
            }
            this.session = multiRoom ? `${room}/${user}/${random}` : `${user}/${random}`;
            if (!multiRoom) urlOptions.setSession(this.session, newSession);   // multiRoom handles this elsewhere
            // the island id (name) is "room/user/random?opt=val&opt=val"
            name = `${room}/${user}/${random}`;
            if (user === 'DEMO') this.viewOnly = getUser("demoViewOnly", true);
        }
        // include options in the island's id
        const nameWithOptions = Object.keys(options).length
            ? name + '?' + Object.entries(options).map(([k,v])=>`${k}=${v}`).join('&')
            : name;
        const id = await hashNameAndCode(nameWithOptions);
        console.log(`Session ID for "${nameWithOptions}": ${id}`);
        this.islandCreator = { name, nameWithOptions, ...sessionSpec, options };

        let initSnapshot = false;
        if (!this.islandCreator.snapshot) initSnapshot = true;
        else if (this.islandCreator.snapshot.id !== id) {
            console.warn(`Existing snapshot was for different code base!`);
            initSnapshot = true;
        }
        if (initSnapshot) this.islandCreator.snapshot = { id, time: 0, meta: { id, created: (new Date()).toISOString() } };
        await this.join();   // when socket is ready, join server
        const island = await new Promise(resolve => this.islandCreator.resolveIslandPromise = resolve );
        return island.modelsByName;
    }

    // keep a snapshot in case we need to upload it or for replay
    keepSnapshot(snapshot=null) {
        const start = Stats.begin("snapshot");
        if (!snapshot) snapshot = this.takeSnapshot();
        // keep history
        this.snapshots.push(snapshot);
        // limit storage for old snapshots
        while (this.snapshots.length > 2) this.snapshots.shift();
        // keep only messages newer than the oldest snapshot
        const keep = this.snapshots[0].externalSeq + 1 >>> 0;
        const keepIndex = this.oldMessages.findIndex(msg => inSequence(keep, msg[1]));
        if (DEBUG.snapshot && keepIndex > 0) console.log(`Deleting old messages from ${this.oldMessages[0][1]} to ${this.oldMessages[keepIndex - 1][1]}`);
        this.oldMessages.splice(0, keepIndex);
        return Stats.end("snapshot") - start;
    }

    // look for a snapshot with the specified meta-properties (hash optional) in
    // our old-snapshot history
    findSnapshot(time, seq, hash='') {
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const snapshot = this.snapshots[i];
            const meta = snapshot.meta;
            if (meta.time === time && meta.seq === seq) {
                if (hash && meta.hash !== hash) throw Error('wrong hash in snapshot');
                return snapshot;
            }
        }
        return null;
    }

    takeSnapshot() {
        const snapshot = this.island.snapshot();
        const time = Math.max(snapshot.time, snapshot.externalTime);
        const seq = snapshot.externalSeq;
        snapshot.meta = {
            ...this.islandCreator.snapshot.meta,
            options: this.islandCreator.options,
            time,
            seq,
            date: (new Date()).toISOString(),
            host: window.location.hostname,
            sdk: SDK_VERSION,
        };
        delete snapshot.meta.hash; // old hash is invalid
        if (codeHashes) snapshot.meta.code = codeHashes;
        return snapshot;
    }

    finalSnapshot() {
        if (!this.island) return null;
        // ensure all messages up to this point are in the snapshot
        for (let msg = this.networkQueue.nextNonBlocking(); msg; msg = this.networkQueue.nextNonBlocking()) {
           this.island.scheduleExternalMessage(msg);
        }
        return this.takeSnapshot();
    }

    // we have spent a certain amount of CPU time on simulating, schedule a snapshot
    scheduleSnapshot() {
        const message = new Message(this.island.time, 0, this.island.id, "scheduledSnapshot", []);
        this.sendMessage(message);
        if (DEBUG.snapshot) console.log(this.id, 'Controller scheduling snapshot via reflector');
    }

    // this is called from inside the simulation loop
    async scheduledSnapshot() {
        // bail out if backlog is too large (e.g. we're just starting up)
        if (this.backlog > 300) { console.warn(`Controller not doing scheduled snapshot because backlog is ${this.backlog} ms`); return; }
        // otherwise, do snapshot
        const ms = this.keepSnapshot();
        // exclude snapshot time from cpu time for logic in this.simulate()
        this.cpuTime -= ms;
        if (DEBUG.snapshot) console.log(this.id, `Controller snapshotting took ${Math.ceil(ms)} ms`);
        // taking the snapshot needed to be synchronous, now we can go async
        await this.hashSnapshot(this.lastSnapshot);
        // inform reflector that we have a snapshot
        const {time, seq, hash} = this.lastSnapshot.meta;
        if (DEBUG.snapshot) console.log(this.id, `Controller sending hash for ${time}#${seq} to reflector: ${hash}`);
        try {
            this.connection.send(JSON.stringify({
                id: this.id,
                action: 'SNAP',
                args: {time, seq, hash},
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
    }

    snapshotUrl(time_seq) {
        // name includes JSON options
        const options = this.islandCreator.name.split(/[^A-Z0-9]+/i);
        const sessionName = `${options.filter(_=>_).join('-')}-${this.id}`;
        return `${baseUrl('snapshots')}${sessionName}/${time_seq}.json`;
    }

    async hashSnapshot(snapshot) {
        if (snapshot.meta.hash) return snapshot.meta.hash;
        // exclude meta data, which has the current (real-world) time in it
        const snapshotWithoutMeta = {...snapshot};
        delete snapshotWithoutMeta.meta;
        return snapshot.meta.hash = await hashString(JSON.stringify(snapshotWithoutMeta));
    }

    /** upload a snapshot to the asset server */
    async uploadSnapshot(snapshot) {
        await this.hashSnapshot(snapshot);
        const body = JSON.stringify(snapshot);
        const {time, seq, hash} = snapshot.meta;
        const url = this.snapshotUrl(`${time}_${seq}-snap-${hash}`);
        if (DEBUG.snapshot) console.log(this.id, `Controller uploading snapshot (${body.length} bytes) to ${url}`);
        return this.uploadJSON(url, body);
    }

    async isOlderThanLatest(snapshot) {
        const latest = await this.fetchJSON(this.snapshotUrl('latest'));
        if (!latest) return false;
        const {time, seq} = snapshot.meta;
        if (time !== latest.time) return time < latest.time;
        return inSequence(seq, latest.seq);
    }

    // was uploadSnapshotAndSendToReflector
    // we sent a snapshot hash to the reflector, it elected us to upload
    async serveSnapshot(time, seq, hash) {
        const snapshot = this.findSnapshot(time, seq, hash);
        if (snapshot !== this.lastSnapshot) {
            const last = this.lastSnapshot.meta;
            console.error(this.id, `snapshot is not last (expected ${time}#${seq}, have ${last.time}#${last.seq})`);
            return;
        }
        this.uploadLatest(true);
    }

    // a snapshot hash came from the reflector, compare to ours
    compareHash(time, seq, hash) {
        const snapshot = this.findSnapshot(time, seq);
        const last = this.lastSnapshot.meta;
        if (snapshot !== this.lastSnapshot) {
            console.warn(this.id, `snapshot is not last (expected ${time}#${seq}, have ${last.time}#${last.seq})`);
            return;
        }
        if (last.hash !== hash) {
            console.warn(this.id, `local snapshot hash ${time}#${seq} is ${last.hash} (got ${hash} from reflector)`);
            this.uploadLatest(false); // upload but do not send to reflector
        }
    }

    // upload snapshot and message history, and optionally inform reflector
    async uploadLatest(sendToReflector=true) {
        const viewId = this.viewId;
        const snapshotUrl = await this.uploadSnapshot(this.lastSnapshot);
        // if upload is slow and the reflector loses patience, controller will have been reset
        if (this.viewId !== viewId) { console.error("Controller was reset while trying to upload snapshot"); return; }
        if (!snapshotUrl) { console.error("Failed to upload snapshot"); return; }
        const last = this.lastSnapshot.meta;
        if (sendToReflector) this.announceSnapshotUrl(last.time, last.seq, last.hash, snapshotUrl);
        if (!this.prevSnapshot) return;
        const prev = this.prevSnapshot.meta;
        let messages = [];
        if (prev.seq !== last.seq) {
            const prevIndex = this.oldMessages.findIndex(msg => msg[1] >= prev.seq);
            const lastIndex = this.oldMessages.findIndex(msg => msg[1] >= last.seq);
            messages = this.oldMessages.slice(prevIndex, lastIndex + 1);
        }
        const messageLog = {
            start: this.snapshotUrl(`${prev.time}_${prev.seq}-snap-${prev.hash}`),
            end: snapshotUrl,
            time: [prev.time, last.time],
            seq: [prev.seq, last.seq],
            messages,
        };
        const url = this.snapshotUrl(`${prev.time}_${prev.seq}-msgs-${prev.hash}`);
        const body = JSON.stringify(messageLog);
        if (DEBUG.snapshot) console.log(this.id, `Controller uploading latest messages (${body.length} bytes) to ${url}`);
        this.uploadJSON(url, body);
    }

    uploadOnPageClose() {
        // cannot use await, page is closing
        if (!this.island || this.lastSnapshot.meta.seq === this.island.externalSeq) return;
        const url = this.snapshotUrl('latest');
        const snapshot = this.finalSnapshot();
        const {time, seq} = snapshot.meta;
        const body = JSON.stringify({time, seq, snapshot});
        if (DEBUG.snapshot) console.log(this.id, `page is closing, uploading snapshot (${time}#${seq}, ${body.length} bytes):`, url);
        this.uploadJSON(url, body);
    }

    // was sendSnapshotToReflector
    announceSnapshotUrl(time, seq, hash, url) {
        if (DEBUG.snapshot) console.log(this.id, `Controller updating ${this.snapshotUrl('latest')})`);
        this.uploadJSON(this.snapshotUrl('latest'), JSON.stringify({time, seq, hash, url}));
        if (DEBUG.snapshot) console.log(this.id, `Controller sending snapshot url to reflector (time: ${time}, seq: ${seq}, hash: ${hash}): ${url}`);
        try {
            this.connection.send(JSON.stringify({
                id: this.id,
                action: 'SNAP',
                args: {time, seq, hash, url},
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
    }

    async fetchJSON(url, defaultValue) {
        try {
            const response = await fetch(url, { mode: "cors" });
            return await response.json();
        } catch (err) { /* ignore */}
        return defaultValue;
    }

    async uploadJSON(url, body) {
        try {
            await fetch(url, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body,
            });
            return url;
        } catch (e) { /*ignore */ }
        return false;
    }

    /** the latest snapshot of this island */
    get lastSnapshot() { return this.snapshots[this.snapshots.length - 1]; }

    /** the snapshot before latest snapshot */
    get prevSnapshot() { return this.snapshots[this.snapshots.length - 2]; }


    checkMetaMessage(msgData) {
        if (Message.hasReceiverAndSelector(msgData, this.id, "scheduledSnapshot")) {
            // some client has scheduled a snapshot, so reset our own estimate
            // now, even before we actually execute that message
            if (DEBUG.snapshot) console.log(this.id, `Controller resetting CPU time (was ${this.cpuTime|0} ms) because snapshot was scheduled for ${msgData[0]}#${msgData[1]}`);
            this.cpuTime = 0;
        }
    }

    // convert a message generated by the reflector itself to our own format
    convertReflectorMessage(msg) {
        // default to do nothing
        let receiver = this.id;
        let selector = "noop";
        let args = [];
        // build message
        switch (msg[2].what) {
            case "users": {
                // get arguments
                const {joined, left, active, total} = msg[2];
                this.users = active;
                this.usersTotal = total;
                // create event
                const scope = this.id;
                const event = "__users__";
                const data = {entered: joined||[], exited: left||[], count: active};
                // create event message
                receiver = this.id;
                selector = "publishFromModel";
                args = [scope, event, data];

                // also immediately publish as view event, which this controller will
                // have subscribed to (in its constructor).
                viewDomain.handleEvent(this.viewId + ":" + event, data);
                break;
            }
            // no default
        }
        // convert to serialized state
        const message = new Message(0, 0, receiver, selector, args);
        msg[2] = message.asState()[2];
    }

    // handle messages from reflector
    async receive(action, args) {
        this.lastReceived = this.connection.lastReceived;
        switch (action) {
            case 'START': {
                // We are starting a new island session.
                if (DEBUG.session) console.log(this.id, 'Controller received START');
                // we may have a snapshot from hot reload or reconnect
                let snapshot = this.islandCreator.snapshot; // could be just the placeholder set up in establishSession (which has no modelsById property)
                const local = snapshot.modelsById && {
                    time: snapshot.meta.time,
                    seq: snapshot.meta.seq,
                    snapshot,
                };
                // see if there is a remote or in-memory snapshot
                let latest = null;
                if (!DEBUG.init) { // setting "init" option forces ignore of stored snapshots
                    latest = await this.fetchJSON(this.snapshotUrl('latest'));
                    // which one's newer?
                    if (!latest || (local && local.time > latest.time)) latest = local;
                }
                // fetch snapshot
                if (latest) {
                    console.log(this.id, latest.snapshot ? "using snapshot still in memory" : `fetching latest snapshot ${latest.url}`);
                    snapshot = latest.snapshot || await this.fetchJSON(latest.url);
                } else snapshot = null; // we found no actual snapshot (e.g., only the placeholder)
                if (!this.connected) { console.log(this.id, 'socket went away during START'); return; }
                if (snapshot) this.islandCreator.snapshot = snapshot;
                this.install();
                this.requestTicks();
                this.keepSnapshot(snapshot);
                if (latest && latest.url) this.announceSnapshotUrl(latest.time, latest.seq, latest.hash, latest.url);
                else this.uploadLatest(true); // upload initial snapshot
                return;
            }
            case 'SYNC': {
                // We are joining an island session.
                const {messages, url, time} = args;
                if (DEBUG.session) console.log(this.id, `Controller received SYNC: time ${time}, ${messages.length} messages, ${url}`);
                // if any conversion of custom reflector messages is to be done, do it before
                // waiting for the snapshot to arrive (because there might be some meta-processing
                // that happens immediately on conversion; this is the case for "users" messages)
                for (const msg of messages) {
                    if (typeof msg[2] !== "string") this.convertReflectorMessage(msg);
                }
                const snapshot = await this.fetchJSON(url);
                this.islandCreator.snapshot = snapshot;  // set snapshot
                if (!this.connected) { console.log(this.id, 'socket went away during SYNC'); return; }
                for (const msg of messages) {
                    if (DEBUG.messages) console.log(this.id, 'Controller got message in SYNC ' + JSON.stringify(msg));
                    msg[1] >>>= 0;      // reflector sends int32, we want uint32
                }
                this.install(messages, time);
                this.getTickAndMultiplier();
                this.keepSnapshot(snapshot);
                return;
            }
            case 'RECV': {
                // We received a message from reflector.
                // Put it in the queue, and set time.
                // Actual processing happens in main loop.
                if (DEBUG.messages) console.log(this.id, 'Controller received RECV ' + JSON.stringify(args));
                const msg = args;   // [time, seq, payload, senderId, senderSeq]
                // the reflector might insert messages on its own, indicated by a non-string payload
                // we need to convert the payload to the message format this client is using
                if (typeof msg[2] !== "string") this.convertReflectorMessage(msg);
                const time = msg[0];
                msg[1] >>>= 0;      // reflector sends int32, we want uint32
                // if we sent this message, add it to latency statistics
                if (msg[3] === this.statistics.id) this.addToStatistics(msg[4]);
                this.networkQueue.put(msg);
                this.timeFromReflector(time);
                this.checkMetaMessage(msg);
                return;
            }
            case 'TICK': {
                // We received a tick from reflector.
                // Just set time so main loop knows how far it can advance.
                if (!this.island) return; // ignore ticks before we are simulating
                const time = args;
                if (DEBUG.ticks) console.log(this.id, 'Controller received TICK ' + time);
                this.timeFromReflector(time);
                if (this.tickMultiplier) this.multiplyTick(time);
                return;
            }
            case 'HASH': {
                // we received a snapshot hash from reflector
                const {time, seq, hash, serve} = args;
                if (serve) this.serveSnapshot(time, seq, hash);
                else this.compareHash(time, seq, hash);
                return;
            }
            case 'LEAVE': {
                // the server wants us to leave this session and rejoin
                console.log(this.id, 'Controller received LEAVE');
                this.leave(false);
                return;
            }
            default: console.warn("Unknown action:", action, args);
        }
    }

    // create the Island for this Controller, based on the islandCreator and optionally an array of messages that are known to post-date the islandCreator's snapshot
    install(messagesSinceSnapshot=[], syncTime=0) {
        const {snapshot, init, options, resolveIslandPromise} = this.islandCreator;
        let newIsland = new Island(snapshot, () => {
            try { return init(options); }
            catch (error) {
                displayAppError("init", error);
                throw error;
            }
        });
        if (DEBUG.initsnapshot && !snapshot.modelsById) {
            // exercise save & load if we came from init
            const initialIslandSnap = JSON.stringify(newIsland.snapshot());
            newIsland = new Island(JSON.parse(initialIslandSnap), () => init(options));
        }
        if (DEBUG.messages) {
            const expected = (newIsland.externalSeq - newIsland.seq) >>> 0;
            console.log(this.id, `Controller expected ${expected} unsimulated external messages in snapshot (${newIsland.seq}-${newIsland.externalSeq})`);
            const external = newIsland.messages.asArray().filter(m => m.isExternal());
            console.log(this.id, `Controller found ${external.length} unsimulated external messages in snapshot`, external);
        }
        // schedule the supplied messages, if any
        if (messagesSinceSnapshot.length > 0) {
            if  (DEBUG.messages) console.log(this.id, `Controller scheduling ${messagesSinceSnapshot.length} messages after snapshot`, messagesSinceSnapshot);
            for (const msg of messagesSinceSnapshot) {
                if (typeof msg[2] !== "string") this.convertReflectorMessage(msg);
                newIsland.scheduleExternalMessage(msg);
            }
        }
        // drain network queue of messages that have been at least scheduled.
        const nextSeq = (newIsland.externalSeq + 1) >>> 0; // externalSeq is last scheduled message
        for (let msg = this.networkQueue.peek(); msg; msg = this.networkQueue.peek()) {
            if (!inSequence(msg[1], nextSeq)) throw Error(`Missing message (expected ${nextSeq} got ${msg[1]})`);
            // found the next message
            if (msg[1] === nextSeq) break;
            // silently skip old messages
            this.networkQueue.nextNonBlocking();
        }
        // our time is the latest of this.time (we may have received a tick already), the island time in the snapshot, and the reflector time at SYNC
        const islandTime = Math.max(newIsland.time, newIsland.externalTime);
        if (syncTime && syncTime < islandTime) console.warn(`ignoring SYNC time from reflector (time was ${islandTime.time}, received ${syncTime})`);
        this.time = Math.max(this.time, islandTime, syncTime);
        this.setIsland(newIsland); // make this our island
        resolveIslandPromise(this.island);
    }

    setIsland(island) {
        this.island = island;
        this.island.controller = this;
    }

    // create an island in its initial state
    createCleanIsland() {
        const { options, init } = this.islandCreator;
        const snapshot = { id: this.id };
        return new Island(snapshot, () => init(options));
    }

    // network queue

    async join() {
        this.checkForConnection(false); // don't force it
        await this.connection.connectionPromise; // wait until there is a connection

        Controllers.add(this);

        if (DEBUG.session) console.log(this.id, 'Controller sending JOIN');

        const {name, id} = this.user;
        const args = {
            name: this.islandCreator.nameWithOptions,
            version: VERSION,
            user: [id, name],
        };

        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args,
        }));
    }

    // either the connection has been broken or the reflector has sent LEAVE
    leave(preserveSnapshot) {
        if (this.connected) {
            console.log(this.id, `Controller LEAVING session for ${this.islandCreator.name}`);
            this.connection.send(JSON.stringify({ id: this.id, action: 'LEAVING' }));
        }
        Controllers.delete(this);
        const {destroyerFn} = this.islandCreator;
        const snapshot = preserveSnapshot && destroyerFn && this.finalSnapshot();
        this.reset();
        if (!this.islandCreator) throw Error("do not discard islandCreator!");
        if (destroyerFn) destroyerFn(snapshot);
    }

    /** send a Message to all island replicas via reflector
     * @param {Message} msg
    */
    sendMessage(msg) {
        // SEND: Broadcast a message to all participants.
        if (!this.connected) return; // probably view sending event while connection is closing
        if (this.viewOnly) return;
        if (DEBUG.sends) console.log(this.id, `Controller sending SEND ${msg.asState()}`);
        this.lastSent = Date.now();
        this.statistics.sent[++this.statistics.seq] = this.lastSent;
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: [...msg.asState(), this.statistics.id, this.statistics.seq],
        }));
    }

    addToStatistics(statSeq) {
        const {sent} = this.statistics;
        this.latency = Date.now() - sent[statSeq];
        delete sent[statSeq];
    }

    /** parse tps `ticks x multiplier` ticks are from server, multiplied by locally generated ticks
     *
     * default taken from `islandCreator.tps` unless `islandCreator.options.tps` is present
     *
     * @returns {{tick: Number, multiplier: Number}}
     *          reflector tick period in ms and local multiplier
     */
    getTickAndMultiplier() {
        const options = this.islandCreator.options;
        const tps = options.tps ? options.tps
            : this.islandCreator.tps ? this.islandCreator.tps
            : 20;
        const [rate, mult] = (tps + "x").split('x').map(n => Number.parseInt("0" + n, 10));
        const tick = 1000 / Math.max(1, Math.min(60, rate));     // minimum 1 tick per second
        const multiplier = Math.max(1, mult);      // default multiplier is 1 (no local ticks)
        if (multiplier > 1 && !NOCHEAT) this.tickMultiplier = { tick, multiplier };
        return { tick, multiplier };
    }

    /** request ticks from the server */
    requestTicks(args = {}) {
        if (!this.connected || !this.island) return;
        const { tick, multiplier } = this.getTickAndMultiplier();
        const delay = tick * (multiplier - 1) / multiplier;
        if (delay) { args.delay = delay; args.tick = tick; }
        else if (!args.tick) args.tick = tick;
        if (!args.time) {
            // ignored by reflector unless this is sent right after START
            args.time = Math.max(this.island.time, this.island.externalTime);
            args.seq = this.island.externalSeq;
        }
        if (DEBUG.session) console.log(this.id, 'Controller requesting TICKS', args);
        // args: {time, tick, delay, scale}
        try {
            this.connection.send(JSON.stringify({
                id: this.id,
                action: 'TICKS',
                args,
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
    }

    /**
     * Process pending messages for this island and advance simulation
     * @param {Number} deadline CPU time deadline before interrupting simulation
     * @return {Boolean} true if simulation finished before deadline
     */
    simulate(deadline) {
        if (!this.island) return true;     // we are probably still sync-ing
        try {
            this.cpuTime -= Stats.begin("simulate");
            let weHaveTime = true;
            while (weHaveTime) {
                // Get the next message from the (concurrent) network queue
                const msgData = this.networkQueue.nextNonBlocking();
                if (!msgData) break;
                // have the island decode and schedule that message
                const msg = this.island.scheduleExternalMessage(msgData);
                // remember msgData for upload / replay
                this.oldMessages.push(msgData);
                // boost cpuTime by a fixed cost per message, to impose an upper limit on
                // the number of messages we'll accumulate before taking a snapshot
                this.cpuTime += EXTERNAL_MESSAGE_CPU_PENALTY;
                // simulate up to that message
                weHaveTime = this.island.advanceTo(msg.time, deadline);
            }
            if (weHaveTime) weHaveTime = this.island.advanceTo(this.time, deadline);
            this.cpuTime += Stats.end("simulate");
            const backlog = this.backlog;
            Stats.backlog(backlog);
            if (typeof this.synced === "boolean" && (this.synced && backlog > SYNCED_MAX || !this.synced && backlog < SYNCED_MIN)) {
                this.synced = !this.synced;
                displaySpinner(!this.synced);
                this.island.publishFromView(this.viewId, "synced", this.synced);
            }
            if (weHaveTime && this.cpuTime > SNAPSHOT_EVERY) { this.cpuTime = 0; this.scheduleSnapshot(); }
            return weHaveTime;
        } catch (error) {
            displayAppError("simulate", error);
            this.connection.closeConnectionWithError('simulate', error);
            return "error";
        }
    }

    /** execute something in the view realm */
    inViewRealm(fn) {
        return inViewRealm(this.island, () => fn(this.island));
    }

    /** call this from main loop to process queued model=>view events
     * @returns {Number} number of processed events
     */
    processModelViewEvents() {
        if (this.island) {
            return this.island.processModelViewEvents();
        }
        return 0;
    }

    /** Got the official time from reflector server, or local multiplier */
    timeFromReflector(time, src="reflector") {
        if (time < this.time) { if (src !== "controller" || DEBUG.ticks) console.warn(`time is ${this.time}, ignoring time ${time} from ${src}`); return; }
        if (typeof this.synced !== "boolean") this.synced = false;
        this.time = time;
        if (this.island) Stats.backlog(this.backlog);
    }

    /** we received a tick from reflector, generate local ticks */
    multiplyTick(time) {
        if (this.localTicker) window.clearInterval(this.localTicker);
        const { tick, multiplier } = this.tickMultiplier;
        const ms = tick / multiplier;
        let n = 1;
        this.localTicker = hotreloadEventManger.setInterval(() => {
            this.timeFromReflector(time + n * ms, "controller");
            if (DEBUG.ticks) console.log(this.id, 'Controller generate TICK ' + this.time, n);
            if (++n >= multiplier) { window.clearInterval(this.localTicker); this.localTicker = 0; }
        }, ms);
    }
}

// upload snapshot when the page gets unloaded
hotreloadEventManger.addEventListener(document.body, "unload", Controller.uploadOnPageClose);
// ... and on hotreload
hotreloadEventManger.addDisposeHandler('snapshots', Controller.uploadOnPageClose);

// Socket Connection

/** start sending PINGs to server after not receiving anything for this timeout */
const PING_TIMEOUT = 100;
/** send PINGs using this interval until hearing back from server */
const PING_INTERVAL = 100;
/** if we haven't sent anything to the reflector for this long, send a PULSE to reassure it */
const PULSE_TIMEOUT = 20000;


class Connection {
    constructor(controller) {
        this.controller = controller;
        this.connectBlocked = false;
        this.connectRestricted = false;
        this.connectHasBeenCalled = false;
        this.setUpConnectionPromise();
    }

    setUpConnectionPromise() {
        this.connectionPromise = new Promise(resolve => this.resolveConnection = resolve);
    }

    get connected() { return this.socket && this.socket.readyState === WebSocket.OPEN; }

    checkForConnection(force) {
        if (this.socket || this.connectHasBeenCalled) return;

        // there are three levels of rights to (re)connect:
        // 1. fully blocked (e.g., to force a pause in attempted reconnection; only a direct connectToReflector will work)
        // 2. blocked unless requested from a session step (force === true)
        // 3. not blocked: any call has the right to connect (e.g., on first connect to a session)
        if (this.connectBlocked) return;
        if (this.connectRestricted && !force) return;

        this.connectToReflector();
    }

    async connectToReflector() {
        this.connectHasBeenCalled = true;
        this.connectBlocked = false;
        this.connectRestricted = false;
        let reflectorUrl = urlOptions.reflector || DEFAULT_REFLECTOR;
        if (!reflectorUrl.match(/^wss?:/)) throw Error('Cannot interpret reflector address ' + reflectorUrl);
        if (!reflectorUrl.endsWith('/')) reflectorUrl += '/';
        return new Promise( resolve => {
            const socket = Object.assign(new WebSocket(`${reflectorUrl}${this.controller.id}`), {
                onopen: _event => {
                    this.socket = socket;
                    if (DEBUG.session) console.log(this.socket.constructor.name, "connected to", this.socket.url);
                    Stats.connected(true);
                    this.resolveConnection(null); // the value itself isn't currently used
                    resolve();
                },
                onmessage: event => {
                    this.receive(event.data);
                },
                onerror: _event => {
                    displayError('Connection error');
                    console.log(socket.constructor.name, "error");
                },
                onclose: event => {
                    // event codes from 4100 and up mean a disconnection from which the client
                    // shouldn't automatically try to reconnect
                    // e.g., 4100 is for out-of-date reflector protocol
                    const autoReconnect = event.code !== 1000 && event.code < 4100;
                    const dormant = event.code === 4110;
                    // don't display error if going dormant
                    if (!dormant) displayError(`Connection closed: ${event.code} ${event.reason}`, { duration: autoReconnect ? undefined : 3600000 }); // leave it there for 1 hour if unrecoverable
                    if (DEBUG.session) console.log(socket.constructor.name, "closed:", event.code, event.reason);
                    Stats.connected(false);
                    if (dormant) this.connectRestricted = true; // only reconnect on session step
                    else this.connectBlocked = true; // only reconnect using connectToReflector
                    this.disconnected(true);
                    if (autoReconnect) {
                        displayWarning('Reconnecting ...');
                        hotreloadEventManger.setTimeout(() => this.connectToReflector(), 2000);
                    }
                },
            });
         });
    }

    // socket was disconnected, destroy the island
    disconnected(preserveSnapshot) {
        if (!this.socket) return;
        this.socket = null;
        this.lastReceived = 0;
        this.lastSent = 0;
        this.connectHasBeenCalled = false;
        this.setUpConnectionPromise();
        this.controller.leave(preserveSnapshot);
    }

    send(data) {
        this.lastSent = Date.now();
        this.socket.send(data);
    }

    receive(data) {
        this.lastReceived = Date.now();
        const { id, action, args } = JSON.parse(data);
        if (id) {
            try { this.controller.receive(action, args); }
            catch (e) { this.closeConnectionWithError('receive', e); }
        } else switch (action) {
            case 'PONG': if (DEBUG.pong) console.log('PONG after', Date.now() - args, 'ms');
                break;
            default: console.warn('Unknown action', action);
        }
    }

    dormantDisconnect() {
        if (!this.connected) return; // not connected anyway
        console.log("dormant; disconnecting from reflector");
        this.socket.close(4110, 'Going dormant');
    }

    closeConnectionWithError(caller, error) {
        console.error(error);
        console.warn('closing socket');
        this.socket.close(4000, 'Error in ' + caller);
        // closing with error code will force reconnect
    }

    PING() {
        if (!this.connected) return;
        if (this.socket.bufferedAmount) console.log(`Reflector connection stalled: ${this.socket.bufferedAmount} bytes unsent`);
        else this.send(JSON.stringify({ action: 'PING', args: Date.now()}));
    }

    PULSE() {
        if (!this.connected) return;
        if (this.socket.bufferedAmount) console.log(`Reflector connection stalled: ${this.socket.bufferedAmount} bytes unsent`);
        this.send(JSON.stringify({ action: 'PULSE' }));
    }

    keepAlive() {
        if (this.lastReceived === 0) return; // haven't yet consummated the connection
        // one reason for having PINGs is to prevent the connection from going idle,
        // which causes some router/computer combinations to buffer packets instead
        // of delivering them immediately (observed on AT&T Fiber + Mac)
        if (Date.now() - this.lastReceived > PING_TIMEOUT) this.PING();
        // if *not* sending a PING, check to see if it's time to send a PULSE
        else if (Date.now() - this.lastSent > PULSE_TIMEOUT) this.PULSE();
    }
}

window.setInterval(() => {
    for (const controller of Controllers) {
        if (!controller.connected) continue;
        controller.connection.keepAlive();
    }
}, PING_INTERVAL);
