import stableStringify from "fast-json-stable-stringify";
import "@croquet/util/deduplicate";
import AsyncQueue from "@croquet/util/asyncQueue";
import { Stats } from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { login, getUser } from "@croquet/util/user";
import { App, displayStatus, displayWarning, displayError, displayAppError } from "@croquet/util/html";
import { baseUrl, hashSessionAndCode, hashString } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import { viewDomain } from "./domain";
import Island, { Message } from "./island";

const pako = require('pako'); // gzip-aware compressor

/** @typedef { import('./model').default } Model */

// when reflector has a new feature, we increment this value
// only newer clients get to use it
const VERSION = 1;

export const SDK_VERSION = process.env.CROQUET_VERSION || "<unknown>";
console.log("Croquet SDK " + SDK_VERSION);

// *croquet.io/reflector/v1 is used as reflector for pages served from *croquet.io
// (specifically, pi.croquet.io must use its own reflector)
// everything else uses croquet.io/reflector/v1
// ...unless overridden by a CROQUET_REFLECTOR setting in the .env
// ...unless overridden by a "dev" url option, which selects the dev dispatcher and reflector
// ...unless overridden by a "reflector=<url>" url option, which sets the specified url

const PUBLIC_REFLECTOR_BASE = window.location.hostname.endsWith("croquet.io") ? `${window.location.host}/reflector` : "croquet.io/reflector";
const PUBLIC_REFLECTOR = `wss://${PUBLIC_REFLECTOR_BASE}/v${VERSION}`;
const DEFAULT_REFLECTOR = process.env.CROQUET_REFLECTOR || PUBLIC_REFLECTOR;    // replaced by parcel at build time from app's .env file
const DEV_DEFAULT_REFLECTOR = "wss://croquet.io/reflector-dev/dev";

const codeHashes = null; // individual codeHashes are not uploaded for now, will need to re-add for replay

let DEBUG = null;

function initDEBUG() {
    // to capture whatever was passed to th latest Session.join({debug:...})
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
        reflector: urlOptions.has("debug", "reflector", urlOptions.dev || "localhost"), // use dev reflector
        // init: urlOptions.has("debug", "init", false),                      // always run init() if first user in session
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
const SYNCED_ANNOUNCE_DELAY = 200; // ms to delay setting synced, mainly to accommodate immediate post-SYNC messages (notably "users") from reflector

function randomString() { return Math.floor(Math.random() * 2**53).toString(36); }

const Controllers = new Set();

export default class Controller {

    constructor() {
        this.reset();
    }

    reset() {
        if (window.ISLAND === this.island) delete window.ISLAND;
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
        /** @type {Boolean} backlog was below SYNCED_MIN */
        this.synced = null; // null indicates never synced before
        /** last measured latency in ms */
        this.latency = 0;
        // only collect latency history if asked for
        if (this.latencyHistory) {
            /** @type {Array<Number>} */
            this.latencyHistory = [];
        }
        // make sure we have no residual "multiply" ticks
        if (this.localTicker) {
            window.clearInterval(this.localTicker);
            delete this.localTicker;
        }
        // in case we were still waiting for sync
        if (this.syncTimer) {
            window.clearTimeout(this.syncTimer);
            delete this.syncTimer;
        }
        /** @type {Array} recent TUTTI sends and their payloads, for matching up with incoming votes and divergence alerts */
        this.tuttiHistory = [];

        // controller (only) gets to subscribe to events using the shared viewId as the "subscriber" argument
        viewDomain.removeAllSubscriptionsFor(this.viewId); // in case we're recycling
        viewDomain.addSubscription(this.viewId, "__users__", this.viewId, data => displayStatus(`users now ${data.count}`), "oncePerFrameWhileSynced");
        // "leaving" is set in session.js if we are leaving by user's request (rather than going dormant/reconnecting)
        if (!this.leaving) App.showSyncWait(true); // enable (i.e., not synced)
    }

    /** @type {String} the session id (same for all replicas) */
    get id() { return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    /** @type {Object} {id, name} the user id (identifying this client) and name (from login or "GUEST") */
    get user() { return { id: this.viewId, name: getUser("name", "GUEST") }; }

    /** @type {Boolean} if true, sends to the reflector are disabled */
    get viewOnly() { return this.islandCreator.viewOnly; }

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
            if (!multiRoom) { // multiRoom handles this elsewhere
                urlOptions.setSession(this.session, newSession);
                App.sessionURL = window.location.href;
            }
            // the island id (name) is "room/user/random?opt=val&opt=val"
            name = `${room}/${user}/${random}`;
        }
        const { id, sessionHash, codeHash } = await hashSessionAndCode(name, options, SDK_VERSION);
        console.log(`Session ID for "${name}": ${id}`);
        this.islandCreator = {...sessionSpec, options, name, sessionHash, codeHash };

        let initSnapshot = false;
        if (!this.islandCreator.snapshot) initSnapshot = true;
        else if (this.islandCreator.snapshot.id !== id) {
            const sameSession = this.islandCreator.snapshot.sessionHash === sessionHash;
            console.warn(`Existing snapshot was for different ${sameSession ? "code base" : "session"}!`);
            initSnapshot = true;
        }
        if (initSnapshot) this.islandCreator.snapshot = { id, time: 0, meta: { id, sessionHash, codeHash, created: (new Date()).toISOString() } };
        await this.join();   // when socket is ready, join server
        await this.startedOrSynced();
        return this.island.modelsByName;
    }

    lastKnownTime(islandOrSnapshot) { return Math.max(islandOrSnapshot.time, islandOrSnapshot.externalTime); }

    handleSyncCheckVote(data) {
        if (this.synced !== true) return;

        // data is { _local, tuttiSeq, tally } where tally is an object keyed by
        // the JSON for { cpuTime, hash } with a count for each key (which we
        // treat as guaranteed to be 1 in each case, because of the cpuTime
        // precision and fuzzification).

        const { _local, tally } = data;
        const hashStrings = Object.keys(tally);
        if (!_local || !hashStrings.includes(_local)) {
            console.log(this.id, "Sync: local vote not found", _local, tally);
            return;
        }

        if (hashStrings.length > 1) {
            console.log(hashStrings);
        } else console.log("ok");
    }

    takeSnapshot() {
        const snapshot = this.island.snapshot();
        const time = this.lastKnownTime(snapshot);
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
        // abandon if this call (delayed by up to 2s - possibly more, if browser is busy)
        // has been overtaken by a poll initiated by another client.  or if the controller
        // has been reset.
        if (!this.island) return;

        const now = this.island.time;
        const sinceLast = now - this.island.lastSnapshotPoll;
        if (sinceLast < 5000) {
            if (DEBUG.snapshot) console.log(`not requesting snapshot poll (${sinceLast}ms since poll scheduled)`);
            return;
        }

        const message = new Message(now, 0, this.island.id, "pollForSnapshot", []);
        // tell reflector only to reflect this message if no message with same ID has been sent in past 5000ms (wall-clock time)
        this.sendTagged(message, { debounce: 5000, msgID: "pollForSnapshot" });
        if (DEBUG.snapshot) console.log(this.id, 'Controller scheduling snapshot via reflector');
    }

    preparePollForSnapshot() {
        // read and reset cpuTime whether or not we'll be participating in the vote
        const localCpuTime = this.triggeringCpuTime || this.cpuTime;
        this.triggeringCpuTime = null;
        this.cpuTime = 0;

        const voteData = this.synced === true ? { cpuTime: localCpuTime } : null; // if not true, we don't want to participate
        return voteData;
    }

    pollForSnapshot(time, tuttiSeq, voteData) {
        voteData.cpuTime += Math.random(); // fuzzify by 0-1ms to further reduce [already minuscule] risk of exact agreement.  NB: this is a view-side random().
        const voteMessage = [this.id, "handleSnapshotVote", "snapshotVote"]; // direct message to the island (3rd arg - topic - will be ignored)
        this.sendTutti(time, tuttiSeq, voteData, null, true, voteMessage);
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
        const base = `${baseUrl('snapshots')}${this.id}`;
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
        if (this.connection.socket !== socket) { console.error("Controller was reset while trying to upload snapshot"); return false; }
        if (!success) { console.error("Failed to upload snapshot"); return false; }
        if (announceToReflector) this.announceSnapshotUrl(time, seq, hash, gzurl);
        return true;
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
            const { ok } = await fetch(url, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body,
            });
            return ok;
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
            const { ok } = await fetch(gzurl, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/octet-stream" },
                body: bytes
            });
            return ok;
        } catch (e) { /*ignore */ }
        return false;
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
                // HACK: clear location info until #333 is fixed
                for (const userArray of data.entered) if (userArray.length > 2) userArray.length = 2;
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
                const snapshot = this.takeSnapshot();
                const success = await this.uploadSnapshot(snapshot, true); // upload initial snapshot, and announce
                // return from establishSession()
                this.islandCreator.startedOrSynced.resolve(this.island);
                if (success) this.requestTicks();
                else this.connection.closeConnectionWithError("start", "failed to establish session");
                return;
            }
            case 'SYNC': {
                // We are joining an island session.
                const {messages, url, time} = args;
                if (DEBUG.session) console.log(this.id, `Controller received SYNC: time ${time}, ${messages.length} messages, ${url}`);
                // enqueue all messages now because the reflector will start sending more messages
                // while we are waiting for the snapshot.
                // if any conversion of custom reflector messages is to be done, do it before
                // waiting for the snapshot to arrive (because there might be some meta-processing
                // that happens immediately on conversion; this is the case for "users" messages)
                for (const msg of messages) {
                    if (DEBUG.messages) console.log(this.id, 'Controller received message in SYNC ' + JSON.stringify(msg));
                    msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
                    if (typeof msg[2] !== "string") this.convertReflectorMessage(msg);
                    this.networkQueue.put(msg);
                    this.timeFromReflector(msg[0]);
                }
                this.timeFromReflector(time);
                if (DEBUG.session) console.log(`${this.id} fetching snapshot ${url}`);
                const snapshot = await this.fetchJSON(url);
                this.islandCreator.snapshot = snapshot;  // set snapshot for building the island
                if (!this.connected) { console.log(this.id, 'socket went away during SYNC'); return; }
                this.install();
                // after install() sets this.island, the main loop may also trigger simulation
                if (DEBUG.session) console.log(`${this.id} fast forwarding from ${Math.round(this.island.time)} to ${time}`);
                this.getTickAndMultiplier();
                // simulate messages before continuing, but only up to the SYNC time
                const simulateSyncMessages = () => {
                    const caughtUp = this.simulate(Date.now() + 200);
                    // if more messages, finish those first
                    if (!caughtUp) setTimeout(simulateSyncMessages, 0);
                    // return from establishSession()
                    else {
                        if (DEBUG.session) console.log(`${this.id} fast forwarded to ${Math.round(this.island.time)}`);
                        this.islandCreator.startedOrSynced.resolve(this.island);
                    }
                };
                setTimeout(simulateSyncMessages, 0);
                return;
            }
            case 'RECV': {
                // We received a message from reflector.
                // Put it in the queue, and set time.
                // Actual processing happens in main loop.
                if (DEBUG.messages) console.log(this.id, 'Controller received RECV ' + JSON.stringify(args));
                const msg = args;   // [0:time, 1:seq, 2:payload, 3:senderId, 4:timeSent, 5:prevLatency, ...]
                // the reflector might insert messages on its own, indicated by a non-string payload
                // we need to convert the payload to the message format this client is using
                if (typeof msg[2] !== "string") this.convertReflectorMessage(msg);
                msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
                // if we sent this message, add it to latency statistics
                if (msg[3] === this.viewId) this.addToStatistics(msg[4], this.lastReceived);
                this.networkQueue.put(msg);
                this.timeFromReflector(msg[0]);
                return;
            }
            case 'TICK': {
                // We received a tick from reflector.
                // Just set time so main loop knows how far it can advance.
                if (!this.island) return; // ignore ticks before we are simulating
                const time = (typeof args === 'number') ? args : args.time;
                if (DEBUG.ticks) console.log(this.id, 'Controller received TICK ' + time);
                this.timeFromReflector(time);
                if (this.tickMultiplier) this.multiplyTick(time);
                return;
            }
            case 'LEAVE': {
                // the server wants us to leave this session and rejoin
                console.log(this.id, 'Controller received LEAVE');
                this.leave();
                return;
            }
            default: console.warn("Unknown action:", action, args);
        }
    }

    // create the Island for this Controller, based on the islandCreator
    install() {
        if (DEBUG.session) console.log(`${this.id} installing island`);
        const {snapshot, init, options} = this.islandCreator;
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
       // our time is the latest of this.time (we may have received a tick already) and the island time in the snapshot
        const islandTime = this.lastKnownTime(newIsland);
        this.time = Math.max(this.time, islandTime);
        this.setIsland(newIsland); // make this our island
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
            name: this.islandCreator.name,
            version: VERSION,
            user: [id, name],
            url: App.sessionURL,
            codeHash: this.islandCreator.codeHash,
            sdk: SDK_VERSION
        };

        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args,
        }));
    }

    async startedOrSynced() {
        return new Promise((resolve, reject) => this.islandCreator.startedOrSynced = { resolve, reject } );
    }

    // either the connection has been broken or the reflector has sent LEAVE
    leave() {
        if (this.connected) {
            console.log(this.id, `Controller LEAVING session for ${this.islandCreator.name}`);
            this.connection.send(JSON.stringify({ id: this.id, action: 'LEAVING' }));
        }
        const {destroyerFn} = this.islandCreator;
        this.reset();
        Controllers.delete(this);   // after reset so it does not re-enable the SYNC overlay
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
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: [...msg.asState(), this.viewId, this.lastSent, this.latency],
        }));
    }

    /** send a Message to all island replicas via reflector, subject to reflector preprocessing as determined by the tag(s)
     * @param {Message} msg
     * @param {Object} tags
    */
    sendTagged(msg, tags) {
        // reflector SEND protocol now allows for an additional tags property.  previous
        // reflector versions will handle as a standard SEND.
        if (!this.connected) return; // probably view sending event while connection is closing
        if (this.viewOnly) return;
        if (DEBUG.sends) console.log(this.id, `Controller sending tagged SEND ${msg.asState()} with tags ${JSON.stringify(tags)}`);
        this.lastSent = Date.now();
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: [...msg.asState(), this.viewId, this.lastSent],
            tags
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

    addToStatistics(timeSent, timeReceived) {
        this.latency = timeReceived - timeSent;
        if (this.latencyHistory) {
            if (this.latencyHistory.length >= 100) this.latencyHistory.shift();
            this.latencyHistory.push({time: timeReceived, ms: this.latency});
        }
    }

    get latencies() {
        if (!this.latencyHistory) this.latencyHistory = [];
        return this.latencyHistory;
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
        const tps = 'tps' in options ? options.tps
            : 'tps' in this.islandCreator ? this.islandCreator.tps
            : 20;
        const [rate, mult] = (tps + "x").split('x').map(n => Number.parseInt("0" + n, 10));
        const tick = 1000 / Math.max(1/30, Math.min(60, rate));     // minimum 1 tick per 30 seconds
        const multiplier = Math.max(1, mult);      // default multiplier is 1 (no local ticks)
        if (multiplier > 1 && !NOCHEAT) this.tickMultiplier = { tick, multiplier };
        return { tick, multiplier };
    }

    /** request ticks from the server */
    requestTicks(args = {}) { // simpleapp can send { scale }
        if (!this.connected || !this.island) return;
        const { tick, multiplier } = this.getTickAndMultiplier();
        args.tick = tick;
        args.delay = tick * (multiplier - 1) / multiplier;
        if (DEBUG.session) console.log(this.id, 'Controller requesting TICKS', args);
        // args: {tick, delay, scale}
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
                const msgData = this.networkQueue.peek();
                if (!msgData) break;
                // finish simulating internal messages up to message time
                // (otherwise, external messages could end up in the future queue,
                // making snapshots non-deterministic)
                weHaveTime = this.island.advanceTo(msgData[0], deadline);
                if (!weHaveTime) break;
                // Remove message from the (concurrent) network queue
                this.networkQueue.nextNonBlocking();
                // have the island decode and schedule that message
                // it will end up first in the future message queue
                const msg = this.island.scheduleExternalMessage(msgData);
                // simulate that message
                weHaveTime = this.island.advanceTo(msg.time, deadline);
                // boost cpuTime by a fixed cost per message, to impose an upper limit on
                // the number of messages we'll accumulate before taking a snapshot
                this.cpuTime += EXTERNAL_MESSAGE_CPU_PENALTY;
            }
            // finally, simulate up to last tick (whether received or generated)
            if (weHaveTime) weHaveTime = this.island.advanceTo(this.time, deadline);
            this.cpuTime += Math.max(0.01, Stats.end("simulate") - simStart); // ensure that we move forward even on a browser that rounds performance.now() to 1ms
            const backlog = this.backlog;
            Stats.backlog(backlog);
            // synced will be non-boolean until this.time is given its first meaningful value from a message or tick
            if (typeof this.synced === "boolean" && (this.synced && backlog > SYNCED_MAX || !this.synced && backlog < SYNCED_MIN)) {
                const nowSynced = !this.synced;
                // nov 2019: impose a delay before setting synced to true, to hold off processing that depends on being synced (notably, subscriptions with handling "oncePerFrameWhileSynced") long enough to incorporate processing of messages that rightfully belong with the sync batch - e.g., "users" messages after SYNC from reflector.  SYNCED_ANNOUNCE_DELAY is therefore chosen with reference to the reflector's USERS_INTERVAL used for batching the "users" messages.
                if (nowSynced) {
                    // this will be triggered every cycle until synced is eventually set to true.  capture with one timeout.
                    if (!this.syncTimer) {
                        this.syncTimer = setTimeout(() => {
                            delete this.syncTimer;
                            if (this.backlog < SYNCED_MIN) this.applySyncChange(true); // iff we haven't somehow dropped out of sync again
                            }, SYNCED_ANNOUNCE_DELAY);
                    }
                } else this.applySyncChange(false); // switch to out-of-sync is acted on immediately
            }
            if (weHaveTime && this.cpuTime > SNAPSHOT_EVERY) { // won't be triggered during sync, because weHaveTime won't be true
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

    applySyncChange(bool) {
        this.synced = bool;
        App.showSyncWait(!bool); // true if not synced
        this.island.publishFromView(this.viewId, "synced", bool);
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
        if (this.tickHook) this.tickHook();
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
        let reflectorUrl = urlOptions.reflector || (DEBUG.reflector ? DEV_DEFAULT_REFLECTOR : DEFAULT_REFLECTOR);
        if (!reflectorUrl.match(/^wss?:/)) throw Error('Cannot interpret reflector address ' + reflectorUrl);
        if (!reflectorUrl.endsWith('/')) reflectorUrl += '/';
        return new Promise( resolve => {
            const socket = Object.assign(new WebSocket(`${reflectorUrl}${this.controller.id}`), {
                onopen: _event => {
                    this.socket = socket;
                    if (DEBUG.session || DEBUG.reflector) console.log(this.socket.constructor.name, "connected to", this.socket.url);
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
                    // don't display error if going dormant or normal close
                    if (!dormant && event.code !== 1000) displayError(`Connection closed: ${event.code} ${event.reason}`, { duration: autoReconnect ? undefined : 3600000 }); // leave it there for 1 hour if unrecoverable
                    if (DEBUG.session) console.log(socket.constructor.name, "closed:", event.code, event.reason);
                    Stats.connected(false);
                    if (dormant) this.connectRestricted = true; // only reconnect on session step
                    else this.connectBlocked = true; // only reconnect using connectToReflector
                    this.disconnected();
                    if (autoReconnect) {
                        displayWarning('Reconnecting ...');
                        window.setTimeout(() => this.connectToReflector(), 2000);
                    }
                },
            });
         });
    }

    // socket was disconnected, destroy the island
    disconnected() {
        if (!this.socket) return;
        this.socket = null;
        this.lastReceived = 0;
        this.lastSent = 0;
        this.connectHasBeenCalled = false;
        this.setUpConnectionPromise();
        this.controller.leave();
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
