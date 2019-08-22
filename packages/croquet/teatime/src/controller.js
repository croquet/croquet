import stableStringify from "fast-json-stable-stringify";
import "@croquet/util/deduplicate";
import AsyncQueue from "@croquet/util/asyncQueue";
import Stats from "@croquet/util/stats";
//import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import urlOptions from "@croquet/util/urlOptions";
import { login, getUser } from "@croquet/util/user";
import { displaySpinner, displayStatus, displayWarning, displayError, displayAppError } from "@croquet/util/html";
import { baseUrl, CROQUET_HOST, hashNameAndCode, hashString } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import { viewDomain } from "./domain";
import Island, { Message, inSequence } from "./island";

const pako = require('pako'); // gzip-aware compressor

/** @typedef { import('./model').default } Model */


// when reflector has a new feature, we increment this value
// only newer clients get to use it
const VERSION = 1;

export const SDK_VERSION = process.env.CROQUET_VERSION || "<unknown>";
console.log("Croquet SDK " + SDK_VERSION);


const PUBLIC_REFLECTOR = `wss://reflector.croquet.studio`;
const DEFAULT_REFLECTOR = process.env.CROQUET_REFLECTOR || PUBLIC_REFLECTOR;    // replaced by parcel at build time from app's .env file

const codeHashes = null; // individual codeHashes are not uploaded for now, will need to re-add for replay

let DEBUG = null;

function initDEBUG() {
    // to capture whatever was passed to th latest startSession({debug:...})
    // call we simply redo this every time establishSession() is called
    // TODO: turn this into a reasonable API
    DEBUG = {
        messages: urlOptions.has("debug", "messages", false),               // received messages
        sends: urlOptions.has("debug", "sends", false),                     // sent messages
        ticks: urlOptions.has("debug", "ticks", false),                     // received ticks
        pong: urlOptions.has("debug", "pong", false),                       // received PONGs
        snapshot: urlOptions.has("debug", "snapshot", false),               // snapshotting, uploading etc
        session: urlOptions.has("debug", "session", false),                 // session logging
        initsnapshot: urlOptions.has("debug", "initsnapshot", "localhost"), // check snapshotting after init
        init: urlOptions.has("debug", "init", "localhost"),                 // always run init() if first user in session
    };
}

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

    constructor() {
        this.reset();
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
        /** CPU time spent simulating since last snapshot */
        this.cpuTime = 0;
        /** CPU time spent at the point when we realised a snapshot is needed */
        this.triggeringCpuTime = null;
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
        /** @type {Array} recent TUTTI sends and their payloads, for matching up with incoming votes and divergence alerts */
        this.tuttiHistory = [];
        /** island time when last pollForSnapshot was executed */
        this.lastSnapshotPoll = 0;

        viewDomain.removeAllSubscriptionsFor(this); // in case we're recycling
        viewDomain.addSubscription(this.viewId, "__users__", this, data => displayStatus(`users now ${data.count}`), "oncePerFrameWhileSynced");
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

    dormantDisconnect() {
        if (!this.connected) return;
        this.connection.dormantDisconnect();
    }

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
        initDEBUG();
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

    lastKnownTime(islandOrSnapshot) { return Math.max(islandOrSnapshot.time, islandOrSnapshot.externalTime); }

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

    // we have spent a certain amount of CPU time on simulating, so schedule a snapshot
    scheduleSnapshot() {
        // abandon if this call (delayed by up to 2s) has been overtaken by a
        // poll initiated by another client.
        const now = this.island.time;
        const sinceLast = now - this.lastSnapshotPoll;
        if (sinceLast < 2500) {
            console.log(`not sending snapshot poll request (${sinceLast}ms since poll scheduled)`);
            return;
        }

        const message = new Message(now, 0, this.island.id, "pollForSnapshot", []);
        this.sendMessage(message);
        if (DEBUG.snapshot) console.log(this.id, 'Controller scheduling snapshot via reflector');
    }

    pollForSnapshot() {
        const now = this.island.time;
        const sinceLast = now - this.lastSnapshotPoll;
        // make sure this isn't just a clash between clients simultaneously deciding
        // that it's time for someone to take a snapshot
        if (sinceLast < 5000) { // arbitrary - needs to be long enough to ensure this isn't part of the same batch
            console.log(`rejecting snapshot poll ${sinceLast}ms after previous`);
            return;
        }
        this.lastSnapshotPoll = now;
        const localCpuTime = this.triggeringCpuTime || this.cpuTime;
        this.triggeringCpuTime = null;
        this.cpuTime = 0;

        const tuttiSeq = this.island.getNextTuttiSeq(); // move it along, even if we won't be using it
        if (this.synced !== true) return;

        const data = { hash: stableStringify(this.island.getSummaryHash()), cpuTime: localCpuTime + Math.random() }; // fuzzify by 0-1ms to further reduce [already minuscule] risk of exact agreement
        const voteMessage = [this.id, "handleSnapshotVote", 'snapshotVote']; // topic is ignored
        this.sendTutti(this.island.time, tuttiSeq, data, null, true, voteMessage);
    }

    handleSnapshotVote(data) {
        if (this.synced !== true) {
            if (DEBUG.snapshot) console.log(`Ignoring snapshot vote during sync`);
            return;
        }

        // data is { _local, tuttiSeq, tally } where tally is an object keyed by
        // the JSON for { cpuTime, hash } with a count for each key (which we
        // treat as guaranteed to be 1 in each case, because of the cpuTime
        // precision and fuzzification).

        const { _local, tally } = data;
        const voteStrings = Object.keys(tally);
        if (!_local || !voteStrings.includes(_local)) {
            if (DEBUG.snapshot) console.log(this.id, "Snapshot: local vote not found");
            this.cpuTime = 0; // a snapshot will be taken by someone
            return;
        }

        const snapshotFromGroup = (groupHash, announce) => {
            const clientIndices = votesByHash[groupHash];
            if (clientIndices.length > 1) clientIndices.sort((a, b) => votes[a].cpuTime - votes[b].cpuTime); // ascending order
            const selectedClient = clientIndices[0];
            if (voteStrings[selectedClient] === _local) this.serveSnapshot(announce);
            };

        // figure out whether there's a consensus on the summary hashes
        const votes = voteStrings.map(k => JSON.parse(k)); // objects { hash, cpuTime }
        const votesByHash = {};
        votes.forEach(({ hash }, i) => {
            if (!votesByHash[hash]) votesByHash[hash] = [];
            votesByHash[hash].push(i);
            });
        const hashGroups = Object.keys(votesByHash);
        let consensusHash = hashGroups[0];
        if (hashGroups.length > 1) {
            if (DEBUG.snapshot) console.log(this.id, `Snapshots fall into ${hashGroups.length} groups`);
            // decide consensus by majority vote; in a tie, summary hash first in
            // lexicographic order is taken as the consensus.
            hashGroups.sort((a, b) => votesByHash[b].length - votesByHash[a].length); // descending order of number of matching votes
            if (votesByHash[hashGroups[0]].length === votesByHash[hashGroups[1]].length) {
                if (DEBUG.snapshot) console.log(this.id, `Deciding consensus by tie-break`);
                consensusHash = hashGroups[0] < hashGroups[1] ? hashGroups[0] : hashGroups[1];
            }
        }
        hashGroups.forEach(hash => snapshotFromGroup(hash, hash === consensusHash));
    }

    serveSnapshot(announce) {
        const start = Stats.begin("snapshot");
        const snapshot = this.takeSnapshot();
        const ms = Stats.end("snapshot") - start;
        // exclude snapshot time from cpu time for logic in this.simulate()
        this.cpuTime -= ms;
        if (DEBUG.snapshot) console.log(this.id, `Snapshotting took ${Math.ceil(ms)} ms`);
        this.uploadSnapshot(snapshot, announce);
    }

    snapshotUrl(filetype, time, seq, hash, optExt) {
        // island name includes JSON options
        const options = this.islandCreator.name.split(/[^A-Z0-9]+/i);
        const sessionName = `${options.filter(_=>_).join('-')}-${this.id}`;
        const base = `${baseUrl('snapshots')}${sessionName}`;
        const extn = `.json${optExt ? "." + optExt : ""}`;
        const pad = n => ("" + n).padStart(10, '0');
        // snapshot time is full precision.  for storage name, we round to nearest ms.
        const filename = `${pad(Math.round(time))}_${seq}-${filetype}-${hash}${extn}`;
        return `${base}/${filename}`;
    }

    hashSnapshot(snapshot) {
        // returns a Promise if hash isn't available yet
        if (snapshot.meta.hash) return snapshot.meta.hash;
        if (!snapshot.meta.hashPromise) {
            snapshot.meta.hashPromise = new Promise(resolve => {
                // exclude meta data, which has the current (real-world) time in it
                const snapshotWithoutMeta = {...snapshot};
                delete snapshotWithoutMeta.meta;
                hashString(JSON.stringify(snapshotWithoutMeta))
                .then(hash => {
                    snapshot.meta.hash = hash;
                    delete snapshot.meta.hashPromise;
                    resolve(hash);
                    });
                });
        }
        return snapshot.meta.hashPromise;
    }

    /** upload a snapshot to the file server, and optionally inform reflector */
    async uploadSnapshot(snapshot, announceToReflector=true) {
        await this.hashSnapshot(snapshot);

        const start = Date.now();
        const body = JSON.stringify(snapshot);
        const stringMS = Date.now()-start;

        const {time, seq, hash} = snapshot.meta;
        const gzurl = this.snapshotUrl('snap', time, seq, hash, 'gz');
        if (DEBUG.snapshot) console.log(this.id, `Controller uploading snapshot (${body.length} bytes, ${stringMS}ms) to ${gzurl}`);
        const socket = this.connection.socket;
        const success = await this.uploadGzipped(gzurl, body);
        if (this.connection.socket !== socket) { console.error("Controller was reset while trying to upload snapshot"); return; }
        if (!success) { console.error("Failed to upload snapshot"); return; }
        if (announceToReflector) this.announceSnapshotUrl(time, seq, hash, gzurl);
    }

    // was sendSnapshotToReflector
    announceSnapshotUrl(time, seq, hash, url) {
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
            if (url.endsWith('.gz')) {
                const buffer = await response.arrayBuffer();
                const jsonString = pako.inflate(new Uint8Array(buffer), { to: 'string' });
                return JSON.parse(jsonString);
            }
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

    /** upload a stringy source object as binary gzip */
    async uploadGzipped(gzurl, stringyContent) {
        const start = Date.now();
        const chars = new TextEncoder().encode(stringyContent);
        const bytes = pako.gzip(chars, { level: 1 }); // sloppy but quick
        if (DEBUG.snapshot) console.log(`Snapshot gzipping took ${Date.now()-start}ms`);
        try {
            await fetch(gzurl, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/octet-stream" },
                body: bytes
            });
            return gzurl;
        } catch (e) { /*ignore */ }
        return false;
    }

    checkMetaMessage(_msgData) { /* currently no needs */ }

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
            case "tally": {
                // the message from the reflector will contain the tuttiSeq, a tally, and an array containing the id, selector and topic that it was told to use.
                // if we have a record of supplying a value for this TUTTI, add it to the args.
                const { tuttiSeq, tally, tallyTarget } = msg[2];
                const convertedArgs = { tuttiSeq, tally };
                const local = this.tuttiHistory.find(hist => hist.tuttiSeq === tuttiSeq);
                if (local) convertedArgs._local = local.payload;
                let topic;
                [ receiver, selector, topic ] = tallyTarget;
                args = [ topic, convertedArgs ];
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
                // aug 2019: START is now only sent if the reflector has no record
                // of this island (in memory or in the snapshot bucket).  this client
                // has the job of creating the first snapshot for the session.
                if (DEBUG.session) console.log(this.id, 'Controller received START');
                this.install();
                this.requestTicks();
                const snapshot = this.takeSnapshot();
                this.uploadSnapshot(snapshot, true); // upload initial snapshot, and announce
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
                this.islandCreator.snapshot = snapshot;  // set snapshot for building the island
                if (!this.connected) { console.log(this.id, 'socket went away during SYNC'); return; }
                for (const msg of messages) {
                    if (DEBUG.messages) console.log(this.id, 'Controller got message in SYNC ' + JSON.stringify(msg));
                    msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
                }
                this.install(messages, time);
                this.getTickAndMultiplier();
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
                msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
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
        const islandTime = this.lastKnownTime(newIsland);
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
    leave() {
        if (this.connected) {
            console.log(this.id, `Controller LEAVING session for ${this.islandCreator.name}`);
            this.connection.send(JSON.stringify({ id: this.id, action: 'LEAVING' }));
        }
        Controllers.delete(this);
        const {destroyerFn} = this.islandCreator;
        this.reset();
        if (!this.islandCreator) throw Error("do not discard islandCreator!");
        if (destroyerFn) destroyerFn();
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

    /** send a TUTTI Message
     * @param {Message} msg
    */
    sendTutti(time, tuttiSeq, data, firstMessage, wantsVote, tallyTarget) {
        // TUTTI: Send a message that multiple instances are expected to send identically.  The reflector will optionally broadcast the first received message immediately, then gather all messages up to a deadline and send a TALLY message summarising the results (whatever those results, if wantsVote is true; otherwise, only if there is some variation among them).
        if (!this.connected) return; // probably view sending event while connection is closing
        if (this.viewOnly) return;
        const payload = stableStringify(data); // stable, to rule out platform differences
        if (DEBUG.sends) console.log(this.id, `Controller sending TUTTI ${payload} ${firstMessage && firstMessage.asState()} ${tallyTarget}`);
        this.tuttiHistory.push({ tuttiSeq, payload });
        if (this.tuttiHistory.length > 100) this.tuttiHistory.shift();
        this.lastSent = Date.now();
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'TUTTI',
            args: [time, tuttiSeq, payload, firstMessage && firstMessage.asState(), wantsVote, tallyTarget],
        }));
    }

    sendVote(tuttiSeq, event, data) {
        const voteMessage = [this.island.id, "handleModelEventInView", this.island.id+":"+event];
        this.sendTutti(this.island.time, tuttiSeq, data, null, true, voteMessage);
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
            args.time = this.lastKnownTime(this.island);
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
            const simStart = Stats.begin("simulate");
            let weHaveTime = true;
            // simulate all received external messages
            while (weHaveTime) {
                // Get the next message from the (concurrent) network queue
                const msgData = this.networkQueue.nextNonBlocking();
                if (!msgData) break;
                // have the island decode and schedule that message
                const msg = this.island.scheduleExternalMessage(msgData);
                // boost cpuTime by a fixed cost per message, to impose an upper limit on
                // the number of messages we'll accumulate before taking a snapshot
                this.cpuTime += EXTERNAL_MESSAGE_CPU_PENALTY;
                // simulate up to that message
                weHaveTime = this.island.advanceTo(msg.time, deadline);
            }
            // now simulate up to last tick (whether received or generated)
            if (weHaveTime) weHaveTime = this.island.advanceTo(this.time, deadline);
            this.cpuTime += Math.max(0.01, Stats.end("simulate") - simStart); // ensure that we move forward even on a browser that rounds performance.now() to 1ms
            const backlog = this.backlog;
            Stats.backlog(backlog);
            if (typeof this.synced === "boolean" && (this.synced && backlog > SYNCED_MAX || !this.synced && backlog < SYNCED_MIN)) {
                this.synced = !this.synced;
                displaySpinner(!this.synced);
                this.island.publishFromView(this.viewId, "synced", this.synced);
            }
            if (weHaveTime && this.cpuTime > SNAPSHOT_EVERY) {
                this.triggeringCpuTime = this.cpuTime;
                this.cpuTime = 0;
                // first level of defence against clients simultaneously deciding
                // that it's time to take a snapshot: stagger pollForSnapshot sends,
                // so we might have heard from someone else before we send.
                setTimeout(() => this.scheduleSnapshot(), Math.floor(Math.random()*2000));
            }
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
        this.localTicker = window.setInterval(() => {
            this.timeFromReflector(time + n * ms, "controller");
            if (DEBUG.ticks) console.log(this.id, 'Controller generate TICK ' + this.time, n);
            if (++n >= multiplier) { window.clearInterval(this.localTicker); this.localTicker = 0; }
        }, ms);
    }
}

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
                        window.setTimeout(() => this.connectToReflector(), 2000);
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
