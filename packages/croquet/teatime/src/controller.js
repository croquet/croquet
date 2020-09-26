import "@croquet/util/deduplicate";
import stableStringify from "fast-json-stable-stringify";
import Base64 from "crypto-js/enc-base64";
import Utf8 from "crypto-js/enc-utf8";
import PBKDF2 from "crypto-js/pbkdf2";
import AES from "crypto-js/aes";
import WordArray from "crypto-js/lib-typedarrays";
import HmacSHA256 from "crypto-js/hmac-sha256";

import pako from "pako"; // gzip-aware compressor
import AsyncQueue from "@croquet/util/asyncQueue";
import { Stats } from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { App, displayStatus, displayWarning, displayError, displayAppError } from "@croquet/util/html";
import { baseUrl, hashSessionAndCode, hashString } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import { viewDomain } from "./domain";
import Island, { Message } from "./island";

/** @typedef { import('./model').default } Model */

// when reflector has a new feature, we increment this value
// only newer clients get to use it
const VERSION = 1;

export const SDK_VERSION = process.env.CROQUET_VERSION || "<unknown>";

// codepen cannot deal with styled console output
if (window.location.hostname.match(/co?de?pe?n\.io/)) console.log("Croquet SDK " + SDK_VERSION);
else console.log("%cCroquet%c SDK %c" + SDK_VERSION, "color:#F0493E", "color:inherit", `color:${SDK_VERSION.includes("+") ? "#909" : "inherit"}`);

// use dev reflectors for pre-release SDKs, unless dev=false given
// (only needed for periods when code changes below require dev reflectors,
// comment out once deployed to production reflectors)
// if (!("dev" in urlOptions) && (SDK_VERSION === "<unknown>" || SDK_VERSION.includes("-"))) urlOptions.dev = true;

// *croquet.io/reflector/v1 is used as reflector for pages served from *croquet.io
// (specifically, pi.croquet.io must use its own reflector)
// everything else uses croquet.io/reflector/v1
// ...unless overridden by a CROQUET_REFLECTOR setting in the .env
// ...unless overridden by a "dev" url option, which selects the dev dispatcher and reflector
// ...unless overridden by a "reflector=<url>" url option, which sets the specified url

const PUBLIC_REFLECTOR_HOST = window.location.hostname.match(/^(.*\.)?croquet\.io$/i) ? window.location.host : "croquet.io";
const PUBLIC_REFLECTOR = `wss://${PUBLIC_REFLECTOR_HOST}/reflector/v${VERSION}`;
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

function randomString() { return Math.floor(Math.random() * 36**10).toString(36); }


// start Snapshot worker executing snapshotWorkerOnMessage (below)
const snapshotWorkerBlob = new Blob([`
${import_pako_deflate()}
onmessage=${snapshotWorkerOnMessage}`]);
const SnapshotWorker = new Worker(window.URL.createObjectURL(snapshotWorkerBlob));


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
        /** @type {String} the human-readable session name (e.g. "room/user/random") */
        this.session = '';
        /** key generated from password, shared by all clients */
        this.key = null;
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
        // If we add more options here, add them to SESSION_OPTIONS in session.js
        const { optionsFromUrl, password, viewIdDebugSuffix} = sessionSpec;
        if (viewIdDebugSuffix) this.viewId = this.viewId.replace(/_.*$/, '') + "_" + (""+viewIdDebugSuffix).slice(0,16);
        const options = {...sessionSpec.options};
        for (const key of [...OPTIONS_FROM_URL, ...optionsFromUrl||[]]) {
            if (key in urlOptions) options[key] = urlOptions[key];
        }
        // if the default shows up in logs we have a problem
        const keyMaterial = password || urlOptions.pw || "THIS SHOULDN'T BE IN LOGS";
        const pbkdf2Result = PBKDF2(keyMaterial, "", { keySize: 256/32 });
        this.key = WordArray.create(pbkdf2Result.words.slice(0, 256/32));
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

        // create promise before join to prevent race
        const synced = new Promise((resolve, reject) => this.islandCreator.sessionSynced = { resolve, reject } );
        this.join();   // when socket is ready, join server
        await synced;  // resolved after receiving `SYNC`, installing island, and replaying messages
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

        const message = new Message(now, 0, this.island.id, "handlePollForSnapshot", []);
        // tell reflector only to reflect this message if no message with same ID has been sent in past 5000ms (wall-clock time)
        this.sendTagged(message, { debounce: 5000, msgID: "pollForSnapshot" });
        if (DEBUG.snapshot) console.log(this.id, 'requesting snapshot poll via reflector');
    }

    handlePollForSnapshot() {
        // !!! THIS IS BEING EXECUTED INSIDE THE SIMULATION LOOP!!!
        const { island } = this;
        const tuttiSeq = this.island.getNextTuttiSeq(); // move it along, even if this client decides not to participate

        // make sure there isn't a clash between clients simultaneously deciding
        // that it's time for someone to take a snapshot.
        const now = island.time;
        const sinceLast = now - island.lastSnapshotPoll;
        if (sinceLast < 5000) { // arbitrary - needs to be long enough to ensure this isn't part of the same batch
            console.log(`rejecting snapshot poll ${sinceLast}ms after previous`);
            return;
        }

        island.lastSnapshotPoll = now; // whether or not the controller agrees to participate

        const voteData = this.preparePollForSnapshot(); // at least resets cpuTime
        if (!voteData) return; // not going to vote, so don't waste time on creating the hash

        const start = Stats.begin("snapshot");
        voteData.hash = island.getSummaryHash();
        const ms = Stats.end("snapshot") - start;
        // exclude snapshot time from cpu time for logic in this.simulate()
        this.cpuTime -= ms;  // give ourselves a time credit for the non-simulation work
        if (DEBUG.snapshot) console.log(this.id, `Summary hashing took ${Math.ceil(ms)}ms`);

        // sending the vote is handled asynchronously, because we want to add a view-side random()
        Promise.resolve().then(() => this.pollForSnapshot(now, tuttiSeq, voteData));
    }


    preparePollForSnapshot() {
        // !!! THIS IS BEING EXECUTED INSIDE THE SIMULATION LOOP!!!

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
        if (DEBUG.snapshot) console.log(this.id, 'sending snapshot vote', voteData);
        this.sendTutti(time, tuttiSeq, voteData, null, true, voteMessage);
    }

    handleSnapshotVote(data) {
        // !!! THIS IS BEING EXECUTED INSIDE THE SIMULATION LOOP!!!

        if (this.synced !== true) {
            if (DEBUG.snapshot) console.log(`Ignoring snapshot vote during sync`);
            return;
        }
        if (DEBUG.snapshot) console.log(this.id, "received snapshot votes", data);

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

        const snapshotFromGroup = (groupHash, isConsensus) => {
            const clientIndices = votesByHash[groupHash];
            if (clientIndices.length > 1) clientIndices.sort((a, b) => votes[a].cpuTime - votes[b].cpuTime); // ascending order
            const selectedClient = clientIndices[0];
            if (voteStrings[selectedClient] === _local) {
                const dissidentFlag = isConsensus ? null : { groupSize: clientIndices.length };
                this.serveSnapshot(dissidentFlag);
            }
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
            console.warn(this.id, `Snapshots fall into ${hashGroups.length} groups`);
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

    serveSnapshot(dissidentFlag) {
        // !!! THIS IS BEING EXECUTED INSIDE THE SIMULATION LOOP!!!
        const start = Stats.begin("snapshot");
        const snapshot = this.takeSnapshot();
        const ms = Stats.end("snapshot") - start;
        // exclude snapshot time from cpu time for logic in this.simulate()
        this.cpuTime -= ms;
        if (DEBUG.snapshot) console.log(this.id, `Snapshotting took ${Math.ceil(ms)} ms`);
        // ... here we go async
        this.uploadSnapshot(snapshot, dissidentFlag);
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

    /* upload a snapshot to the file server, optionally with a dissident argument that the reflector can interpret as meaning that this is not the snapshot to serve to new clients */
    async uploadSnapshot(snapshot, dissidentFlag=null) {
        await this.hashSnapshot(snapshot);

        const start = Stats.begin("snapshot");
        const body = JSON.stringify(snapshot);
        const stringMS = Stats.end("snapshot") - start;
        if (DEBUG.snapshot) console.log(this.id, `Snapshot stringification (${body.length} bytes) took ${Math.ceil(stringMS)}ms`);

        const {time, seq, hash} = snapshot.meta;
        const gzurl = this.snapshotUrl('snap', time, seq, hash, 'gz');
        const socket = this.connection.socket;
        const success = await this.uploadGzipped(gzurl, body);
        if (this.connection.socket !== socket) { console.error("Controller was reset while trying to upload snapshot"); return false; }
        if (!success) { console.error("Failed to upload snapshot"); return false; }
        this.announceSnapshotUrl(time, seq, hash, gzurl, dissidentFlag);
        return true;
    }

    // was sendSnapshotToReflector
    announceSnapshotUrl(time, seq, hash, url, dissidentFlag) {
        if (DEBUG.snapshot) {
            let logProps = `time: ${time}, seq: ${seq}, hash: ${hash}`;
            if (dissidentFlag) logProps += ", dissident: " + JSON.stringify(dissidentFlag);
            console.log(this.id, `Controller sending snapshot url to reflector (${logProps}): ${url}`);
        }
        try {
            this.connection.send(JSON.stringify({
                id: this.id,
                action: 'SNAP',
                args: {time, seq, hash, url, dissident: dissidentFlag},
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
    }

    async fetchJSON(url, defaultValue) {
        try {
            const response = await fetch(url, { mode: "cors", referrer: App.referrerURL() });
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
                referrer: App.referrerURL(),
                body,
            });
            return ok;
        } catch (e) { /*ignore */ }
        return false;
    }

    /** upload a stringy source object as binary gzip */
    async uploadGzipped(gzurl, stringyContent) {
        // leave actual work to our SnapshotWorker
        return new Promise( (resolve, reject) => {
            SnapshotWorker.postMessage({
                cmd: "uploadGzipped",
                gzurl,
                stringyContent,
                referrer: App.referrerURL(),
                debug: DEBUG.snapshot,
            });
            const onmessage = msg => {
                const {url, ok, status, statusText} = msg.data;
                if (url !== gzurl) return;
                SnapshotWorker.removeEventListener("message", onmessage);
                if (ok) resolve(ok);
                else reject(Error(`${status}: ${statusText}`));
            };
            SnapshotWorker.addEventListener("message", onmessage);
        });
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
                selector = "publishFromModelOnly";
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
                    if (typeof msg[2] !== "string") {
                        this.convertReflectorMessage(msg);
                    } else {
                        msg[2] = this.decryptPayload(msg[2])[0];
                    }
                    if (DEBUG.messages) console.log(this.id, 'Controller received message in SYNC ' + JSON.stringify(msg));
                    msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
                    this.networkQueue.put(msg);
                }
                this.timeFromReflector(time);
                if (DEBUG.session) console.log(`${this.id} fetching snapshot ${url}`);
                const snapshot = url && await this.fetchJSON(url);
                if (!this.connected) { console.log(this.id, 'socket went away during SYNC'); return; }
                if (url && !snapshot) {
                    this.connection.closeConnectionWithError('SYNC', Error("failed to fetch snapshot"));
                    return;
                }
                if (snapshot) this.islandCreator.snapshot = snapshot;  // set snapshot for building the island
                this.install();  // will run init() if no snapshot
                // after install() sets this.island, the main loop may also trigger simulation
                if (DEBUG.session) console.log(`${this.id} fast forwarding from ${Math.round(this.island.time)} to ${time}`);
                // simulate messages before continuing, but only up to the SYNC time
                const simulateSyncMessages = () => {
                    const caughtUp = this.simulate(Date.now() + 200);
                    // if more messages, finish those first
                    if (!caughtUp) setTimeout(simulateSyncMessages, 0);
                    // return from establishSession()
                    else {
                        if (DEBUG.session) console.log(`${this.id} fast forwarded to ${Math.round(this.island.time)}`);
                        this.islandCreator.sessionSynced.resolve(this.island);
                    }
                };
                setTimeout(simulateSyncMessages, 0);
                return;
            }
            case 'RECV': {
                // We received a message from reflector.
                // Put it in the queue, and set time.
                // Actual processing happens in main loop.
                const msg = args;
                // the reflector might insert messages on its own, indicated by a non-string payload
                // we need to convert the payload to the message format this client is using
                if (typeof msg[2] !== "string") {
                    this.convertReflectorMessage(msg);
                } else {
                    const [payload, viewId, lastSent] = this.decryptPayload(msg[2]);
                    msg[2] = payload;
                    // if we sent this message, add it to latency statistics
                    if (viewId === this.viewId) this.addToStatistics(lastSent, this.lastReceived);
                }
                msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
                if (DEBUG.messages) console.log(this.id, 'Controller received RECV ' + JSON.stringify(msg));
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
            case 'INFO': {
                // information the reflector wants us to know
                // for the moment just show it
                const { msg, options } = args;
                App.showMessage(msg, options);
                return;
            }
            case 'REQU': {
                // reflector requests a snapshot
                this.cpuTime = 10000;
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

        const { tick, delay } = this.getTickAndMultiplier();

        const args = {
            name: this.islandCreator.name,
            version: VERSION,
            user: this.viewId,  // see island.generateJoinExit() for getting location data
            ticks: { tick, delay },
            url: App.referrerURL(),
            codeHash: this.islandCreator.codeHash,
            sdk: SDK_VERSION
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
        const {destroyerFn} = this.islandCreator;
        this.reset();
        Controllers.delete(this);   // after reset so it does not re-enable the SYNC overlay
        if (!this.islandCreator) throw Error("do not discard islandCreator!");
        if (destroyerFn) destroyerFn();
    }

    encrypt(plaintext) {
        const iv = WordArray.random(16);
        const ciphertext = AES.encrypt(plaintext, this.key, {
            iv,
            // padding: Pkcs7, // default
            // mode: CBC       // default
          });
        const hmac = HmacSHA256(plaintext, this.key);
        const encrypted = `${Base64.stringify(iv)}${Base64.stringify(hmac)}${ciphertext}`;
        return encrypted;
    }

    decrypt(encrypted) {
        const iv = Base64.parse(encrypted.slice(0, 24));
        const mac = Base64.parse(encrypted.slice(24, 24 + 44));
        const ciphertext = encrypted.slice(24 + 44);
        const decrypted = AES.decrypt(ciphertext, this.key, { iv });
        const plaintext = Utf8.stringify(decrypted);
        const hmac = HmacSHA256(plaintext, this.key);
        if (this.compareHmacs(mac.words, hmac.words)) return plaintext;
        console.warn("decryption hmac mismatch");
        return "";
    }

    encryptMessage(msg, viewId, lastSent) {
        const [time, seq, msgPayload] = msg.asState();
        const encryptedPayload = this.encryptPayload([msgPayload, viewId, lastSent]);
        return [time, seq, encryptedPayload];
    }

    encryptPayload(payload) {
        return this.encrypt(JSON.stringify(payload));
    }

    decryptPayload(encrypted) {
        return JSON.parse(this.decrypt(encrypted));
    }

    compareHmacs(fst, snd) {
        let ret = fst.length === snd.length;
        for (let i=0; i<fst.length; i++) {
            if (!(fst[i] === snd[i])) {
                ret = false;
            }
        }
        return ret;
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
        const encryptedMsg = this.encryptMessage(msg, this.viewId, this.lastSent); // [time, seq, payload]
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: [...encryptedMsg, this.latency],
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
        const encryptedMsg = this.encryptMessage(msg, this.viewId, this.lastSent); // [time, seq, payload]
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: [...encryptedMsg, this.latency],
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
        const encryptedMsg = firstMessage && this.encryptMessage(firstMessage, this.viewId, this.lastSent); // [time, seq, payload]
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'TUTTI',
            args: [time, tuttiSeq, payload, encryptedMsg, wantsVote, tallyTarget],
        }));
    }

    sendVote(tuttiSeq, event, data) {
        const voteMessage = [this.island.id, "handleModelEventInView", this.island.id+":"+event];
        this.sendTutti(this.island.time, tuttiSeq, data, null, true, voteMessage);
    }

    sendLog(...args) {
        if (!this.connected) return;
        if (args.length < 2) args = args[0];
        this.connection.send(JSON.stringify({ action: 'LOG', args }));
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
     * @returns {{tick: Number, multiplier: Number, delay: Number}}
     *          reflector tick period in ms, local multiplier, and delay to account for locally produced ticks
     */
    getTickAndMultiplier() {
        const options = this.islandCreator.options;
        const tps = 'tps' in options ? options.tps
            : 'tps' in this.islandCreator ? this.islandCreator.tps
            : 20;
        const [rate, mult] = (tps + "x").split('x').map(n => Number.parseInt("0" + n, 10));
        const tick = 1000 / Math.max(1/30, Math.min(60, rate));     // minimum 1 tick per 30 seconds
        const multiplier = Math.max(1, mult);      // default multiplier is 1 (no local ticks)
        let delay = 0;
        if (multiplier > 1 && !NOCHEAT) {
            this.tickMultiplier = { tick, multiplier };
            delay = Math.ceil(tick * (multiplier - 1) / multiplier);
        }
        return { tick, multiplier, delay };
    }

    /** request ticks from the server */
    requestTicks(args = {}) { // simpleapp can send { scale }
        if (!this.connected || !this.island) return;
        const { tick, delay } = this.getTickAndMultiplier();
        args.tick = tick;
        args.delay = delay;
        this.connection.setTick(tick);
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

    toString() { return `Controller[${this.id}]`; }

    [Symbol.toPrimitive]() { return this.toString(); }
}

// This function is stringified and run as SnapshotWorker
// MAKE SURE TO TEST AFTER MINIFICATION!
// (it can not uses async / await for example)
function snapshotWorkerOnMessage(msg) {
    const { cmd, gzurl, stringyContent, referrer, debug } = msg.data;
    switch (cmd) {
        case "uploadGzipped": uploadGzipped(); break;
        default: console.error("Unkown worker command", cmd);
    }

    // pako deflate is being injected when creating SnapshotWorker

    function uploadGzipped() {
        const start = Date.now();
        const chars = new TextEncoder().encode(stringyContent);
        // eslint-disable-next-line no-restricted-globals
        const bytes = self.pako.gzip(chars, { level: 1 }); // sloppy but quick
        const ms = Date.now() - start;
        if (debug) console.log(`Worker: snapshot gzipping (${bytes.length} bytes) took ${Math.ceil(ms)}ms`);
        if (debug) console.log(`Worker: uploading snapshot to ${gzurl}`);
        fetch(gzurl, {
            method: "PUT",
            mode: "cors",
            headers: { "Content-Type": "application/octet-stream" },
            referrer,
            body: bytes
        }).then(response => {
            const { ok, status, statusText } = response;
            if (debug) console.log(`Worker: uploaded (${status} ${statusText}) ${gzurl}`);
            postMessage({url: gzurl, ok, status, statusText});
        }).catch(e => {
            if (debug) console.log(`Worker: upload error ${e.message}`);
            postMessage({url: gzurl, ok: false, status: -1, statusText: e.message});
        });
    }
}


// Socket Connection

/** send PULSEs using this interval until hearing back from server */
const KEEP_ALIVE_INTERVAL = 100;
/** if we haven't sent anything to the reflector for this long, send a PULSE to reassure it */
const PULSE_TIMEOUT = 20000;
/** warn about unsent outgoing bytes after this many ms */
const UNSENT_TIMEOUT = 500;


class Connection {
    constructor(controller) {
        this.controller = controller;
        this.connectBlocked = false;
        this.connectRestricted = false;
        this.connectHasBeenCalled = false;
        this.missingTickThreshold = Infinity;
        this.setUpConnectionPromise();
    }

    get id() { return this.controller.id; }

    setTick(ms) {
        this.missingTickThreshold = Math.min(ms * 3, 45000); // send PULSE after
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

    PULSE(now) {
        if (!this.connected) return;
        if (this.socket.bufferedAmount === 0) {
            // only send a pulse if no other outgoing data pending
            this.send(JSON.stringify({ action: 'PULSE' }));
        } else if (now - this.lastSent > UNSENT_TIMEOUT) {
            // only warn about unsent data after a certain time
            console.log(`${this.id} Reflector connection stalled: ${this.socket.bufferedAmount} bytes unsent for ${now - this.lastSent} ms`);
        }
    }

    keepAlive(now) {
        if (this.lastReceived === 0) return; // haven't yet consummated the connection
        // the reflector expects to hear from us at least every 30 seconds
        if (now - this.lastSent > PULSE_TIMEOUT) this.PULSE(now);
        // also, if we are expecting steady ticks, prevent the connection from going idle,
        // which causes some router/computer combinations to buffer packets instead
        // of delivering them immediately (observed on AT&T Fiber + Mac)
        else if (now - this.lastReceived > this.missingTickThreshold) this.PULSE(now);
    }
}

window.setInterval(() => {
    for (const controller of Controllers) {
        if (!controller.connected) continue;
        controller.connection.keepAlive(Date.now());
    }
}, KEEP_ALIVE_INTERVAL);


/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

LOGIC TO DETECT BROKEN CONNECTIONS

REFLECTOR:

    32s after JOIN:
        every 5s:
            if quiescence > 60s:
                disconnect client
            else if quiescence > 30s:
                ping client

    on pong from client:
        reset quiescence

    on message from client:
        reset quiescence


CONTROLLER:

    every 100ms:
        if lastSent > 20000:
            send PULSE to server
        else if lastReceived > min(3*TICK, 45s):
            send PULSE to server

    on any message from server:
        reset lastReceived

    on any send to server:
        reset lastSent

* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

// this is node_modules/pako/dist/pako_deflate.min.js for use in our SnapshotWorker
function import_pako_deflate() {
    return `!function(t){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=t();else if("function"==typeof define&&define.amd)define([],t);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).pako=t()}}(function(){return function i(s,h,l){function o(e,t){if(!h[e]){if(!s[e]){var a="function"==typeof require&&require;if(!t&&a)return a(e,!0);if(_)return _(e,!0);var n=new Error("Cannot find module '"+e+"'");throw n.code="MODULE_NOT_FOUND",n}var r=h[e]={exports:{}};s[e][0].call(r.exports,function(t){return o(s[e][1][t]||t)},r,r.exports,i,s,h,l)}return h[e].exports}for(var _="function"==typeof require&&require,t=0;t<l.length;t++)o(l[t]);return o}({1:[function(t,e,a){"use strict";var n="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Int32Array;a.assign=function(t){for(var e,a,n=Array.prototype.slice.call(arguments,1);n.length;){var r=n.shift();if(r){if("object"!=typeof r)throw new TypeError(r+"must be non-object");for(var i in r)e=r,a=i,Object.prototype.hasOwnProperty.call(e,a)&&(t[i]=r[i])}}return t},a.shrinkBuf=function(t,e){return t.length===e?t:t.subarray?t.subarray(0,e):(t.length=e,t)};var r={arraySet:function(t,e,a,n,r){if(e.subarray&&t.subarray)t.set(e.subarray(a,a+n),r);else for(var i=0;i<n;i++)t[r+i]=e[a+i]},flattenChunks:function(t){var e,a,n,r,i,s;for(e=n=0,a=t.length;e<a;e++)n+=t[e].length;for(s=new Uint8Array(n),e=r=0,a=t.length;e<a;e++)i=t[e],s.set(i,r),r+=i.length;return s}},i={arraySet:function(t,e,a,n,r){for(var i=0;i<n;i++)t[r+i]=e[a+i]},flattenChunks:function(t){return[].concat.apply([],t)}};a.setTyped=function(t){t?(a.Buf8=Uint8Array,a.Buf16=Uint16Array,a.Buf32=Int32Array,a.assign(a,r)):(a.Buf8=Array,a.Buf16=Array,a.Buf32=Array,a.assign(a,i))},a.setTyped(n)},{}],2:[function(t,e,a){"use strict";var l=t("./common"),r=!0,i=!0;try{String.fromCharCode.apply(null,[0])}catch(t){r=!1}try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(t){i=!1}for(var o=new l.Buf8(256),n=0;n<256;n++)o[n]=252<=n?6:248<=n?5:240<=n?4:224<=n?3:192<=n?2:1;function _(t,e){if(e<65534&&(t.subarray&&i||!t.subarray&&r))return String.fromCharCode.apply(null,l.shrinkBuf(t,e));for(var a="",n=0;n<e;n++)a+=String.fromCharCode(t[n]);return a}o[254]=o[254]=1,a.string2buf=function(t){var e,a,n,r,i,s=t.length,h=0;for(r=0;r<s;r++)55296==(64512&(a=t.charCodeAt(r)))&&r+1<s&&56320==(64512&(n=t.charCodeAt(r+1)))&&(a=65536+(a-55296<<10)+(n-56320),r++),h+=a<128?1:a<2048?2:a<65536?3:4;for(e=new l.Buf8(h),r=i=0;i<h;r++)55296==(64512&(a=t.charCodeAt(r)))&&r+1<s&&56320==(64512&(n=t.charCodeAt(r+1)))&&(a=65536+(a-55296<<10)+(n-56320),r++),a<128?e[i++]=a:(a<2048?e[i++]=192|a>>>6:(a<65536?e[i++]=224|a>>>12:(e[i++]=240|a>>>18,e[i++]=128|a>>>12&63),e[i++]=128|a>>>6&63),e[i++]=128|63&a);return e},a.buf2binstring=function(t){return _(t,t.length)},a.binstring2buf=function(t){for(var e=new l.Buf8(t.length),a=0,n=e.length;a<n;a++)e[a]=t.charCodeAt(a);return e},a.buf2string=function(t,e){var a,n,r,i,s=e||t.length,h=new Array(2*s);for(a=n=0;a<s;)if((r=t[a++])<128)h[n++]=r;else if(4<(i=o[r]))h[n++]=65533,a+=i-1;else{for(r&=2===i?31:3===i?15:7;1<i&&a<s;)r=r<<6|63&t[a++],i--;1<i?h[n++]=65533:r<65536?h[n++]=r:(r-=65536,h[n++]=55296|r>>10&1023,h[n++]=56320|1023&r)}return _(h,n)},a.utf8border=function(t,e){var a;for((e=e||t.length)>t.length&&(e=t.length),a=e-1;0<=a&&128==(192&t[a]);)a--;return a<0?e:0===a?e:a+o[t[a]]>e?a:e}},{"./common":1}],3:[function(t,e,a){"use strict";e.exports=function(t,e,a,n){for(var r=65535&t|0,i=t>>>16&65535|0,s=0;0!==a;){for(a-=s=2e3<a?2e3:a;i=i+(r=r+e[n++]|0)|0,--s;);r%=65521,i%=65521}return r|i<<16|0}},{}],4:[function(t,e,a){"use strict";var h=function(){for(var t,e=[],a=0;a<256;a++){t=a;for(var n=0;n<8;n++)t=1&t?3988292384^t>>>1:t>>>1;e[a]=t}return e}();e.exports=function(t,e,a,n){var r=h,i=n+a;t^=-1;for(var s=n;s<i;s++)t=t>>>8^r[255&(t^e[s])];return-1^t}},{}],5:[function(t,e,a){"use strict";var l,u=t("../utils/common"),o=t("./trees"),f=t("./adler32"),c=t("./crc32"),n=t("./messages"),_=0,d=4,p=0,g=-2,m=-1,b=4,r=2,v=8,w=9,i=286,s=30,h=19,y=2*i+1,k=15,z=3,x=258,B=x+z+1,A=42,C=113,S=1,j=2,E=3,U=4;function D(t,e){return t.msg=n[e],e}function I(t){return(t<<1)-(4<t?9:0)}function O(t){for(var e=t.length;0<=--e;)t[e]=0}function q(t){var e=t.state,a=e.pending;a>t.avail_out&&(a=t.avail_out),0!==a&&(u.arraySet(t.output,e.pending_buf,e.pending_out,a,t.next_out),t.next_out+=a,e.pending_out+=a,t.total_out+=a,t.avail_out-=a,e.pending-=a,0===e.pending&&(e.pending_out=0))}function T(t,e){o._tr_flush_block(t,0<=t.block_start?t.block_start:-1,t.strstart-t.block_start,e),t.block_start=t.strstart,q(t.strm)}function L(t,e){t.pending_buf[t.pending++]=e}function N(t,e){t.pending_buf[t.pending++]=e>>>8&255,t.pending_buf[t.pending++]=255&e}function R(t,e){var a,n,r=t.max_chain_length,i=t.strstart,s=t.prev_length,h=t.nice_match,l=t.strstart>t.w_size-B?t.strstart-(t.w_size-B):0,o=t.window,_=t.w_mask,d=t.prev,u=t.strstart+x,f=o[i+s-1],c=o[i+s];t.prev_length>=t.good_match&&(r>>=2),h>t.lookahead&&(h=t.lookahead);do{if(o[(a=e)+s]===c&&o[a+s-1]===f&&o[a]===o[i]&&o[++a]===o[i+1]){i+=2,a++;do{}while(o[++i]===o[++a]&&o[++i]===o[++a]&&o[++i]===o[++a]&&o[++i]===o[++a]&&o[++i]===o[++a]&&o[++i]===o[++a]&&o[++i]===o[++a]&&o[++i]===o[++a]&&i<u);if(n=x-(u-i),i=u-x,s<n){if(t.match_start=e,h<=(s=n))break;f=o[i+s-1],c=o[i+s]}}}while((e=d[e&_])>l&&0!=--r);return s<=t.lookahead?s:t.lookahead}function H(t){var e,a,n,r,i,s,h,l,o,_,d=t.w_size;do{if(r=t.window_size-t.lookahead-t.strstart,t.strstart>=d+(d-B)){for(u.arraySet(t.window,t.window,d,d,0),t.match_start-=d,t.strstart-=d,t.block_start-=d,e=a=t.hash_size;n=t.head[--e],t.head[e]=d<=n?n-d:0,--a;);for(e=a=d;n=t.prev[--e],t.prev[e]=d<=n?n-d:0,--a;);r+=d}if(0===t.strm.avail_in)break;if(s=t.strm,h=t.window,l=t.strstart+t.lookahead,o=r,_=void 0,_=s.avail_in,o<_&&(_=o),a=0===_?0:(s.avail_in-=_,u.arraySet(h,s.input,s.next_in,_,l),1===s.state.wrap?s.adler=f(s.adler,h,_,l):2===s.state.wrap&&(s.adler=c(s.adler,h,_,l)),s.next_in+=_,s.total_in+=_,_),t.lookahead+=a,t.lookahead+t.insert>=z)for(i=t.strstart-t.insert,t.ins_h=t.window[i],t.ins_h=(t.ins_h<<t.hash_shift^t.window[i+1])&t.hash_mask;t.insert&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[i+z-1])&t.hash_mask,t.prev[i&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=i,i++,t.insert--,!(t.lookahead+t.insert<z)););}while(t.lookahead<B&&0!==t.strm.avail_in)}function F(t,e){for(var a,n;;){if(t.lookahead<B){if(H(t),t.lookahead<B&&e===_)return S;if(0===t.lookahead)break}if(a=0,t.lookahead>=z&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+z-1])&t.hash_mask,a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),0!==a&&t.strstart-a<=t.w_size-B&&(t.match_length=R(t,a)),t.match_length>=z)if(n=o._tr_tally(t,t.strstart-t.match_start,t.match_length-z),t.lookahead-=t.match_length,t.match_length<=t.max_lazy_match&&t.lookahead>=z){for(t.match_length--;t.strstart++,t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+z-1])&t.hash_mask,a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart,0!=--t.match_length;);t.strstart++}else t.strstart+=t.match_length,t.match_length=0,t.ins_h=t.window[t.strstart],t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+1])&t.hash_mask;else n=o._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++;if(n&&(T(t,!1),0===t.strm.avail_out))return S}return t.insert=t.strstart<z-1?t.strstart:z-1,e===d?(T(t,!0),0===t.strm.avail_out?E:U):t.last_lit&&(T(t,!1),0===t.strm.avail_out)?S:j}function K(t,e){for(var a,n,r;;){if(t.lookahead<B){if(H(t),t.lookahead<B&&e===_)return S;if(0===t.lookahead)break}if(a=0,t.lookahead>=z&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+z-1])&t.hash_mask,a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),t.prev_length=t.match_length,t.prev_match=t.match_start,t.match_length=z-1,0!==a&&t.prev_length<t.max_lazy_match&&t.strstart-a<=t.w_size-B&&(t.match_length=R(t,a),t.match_length<=5&&(1===t.strategy||t.match_length===z&&4096<t.strstart-t.match_start)&&(t.match_length=z-1)),t.prev_length>=z&&t.match_length<=t.prev_length){for(r=t.strstart+t.lookahead-z,n=o._tr_tally(t,t.strstart-1-t.prev_match,t.prev_length-z),t.lookahead-=t.prev_length-1,t.prev_length-=2;++t.strstart<=r&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+z-1])&t.hash_mask,a=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),0!=--t.prev_length;);if(t.match_available=0,t.match_length=z-1,t.strstart++,n&&(T(t,!1),0===t.strm.avail_out))return S}else if(t.match_available){if((n=o._tr_tally(t,0,t.window[t.strstart-1]))&&T(t,!1),t.strstart++,t.lookahead--,0===t.strm.avail_out)return S}else t.match_available=1,t.strstart++,t.lookahead--}return t.match_available&&(n=o._tr_tally(t,0,t.window[t.strstart-1]),t.match_available=0),t.insert=t.strstart<z-1?t.strstart:z-1,e===d?(T(t,!0),0===t.strm.avail_out?E:U):t.last_lit&&(T(t,!1),0===t.strm.avail_out)?S:j}function M(t,e,a,n,r){this.good_length=t,this.max_lazy=e,this.nice_length=a,this.max_chain=n,this.func=r}function P(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=v,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new u.Buf16(2*y),this.dyn_dtree=new u.Buf16(2*(2*s+1)),this.bl_tree=new u.Buf16(2*(2*h+1)),O(this.dyn_ltree),O(this.dyn_dtree),O(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new u.Buf16(k+1),this.heap=new u.Buf16(2*i+1),O(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new u.Buf16(2*i+1),O(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function G(t){var e;return t&&t.state?(t.total_in=t.total_out=0,t.data_type=r,(e=t.state).pending=0,e.pending_out=0,e.wrap<0&&(e.wrap=-e.wrap),e.status=e.wrap?A:C,t.adler=2===e.wrap?0:1,e.last_flush=_,o._tr_init(e),p):D(t,g)}function J(t){var e,a=G(t);return a===p&&((e=t.state).window_size=2*e.w_size,O(e.head),e.max_lazy_match=l[e.level].max_lazy,e.good_match=l[e.level].good_length,e.nice_match=l[e.level].nice_length,e.max_chain_length=l[e.level].max_chain,e.strstart=0,e.block_start=0,e.lookahead=0,e.insert=0,e.match_length=e.prev_length=z-1,e.match_available=0,e.ins_h=0),a}function Q(t,e,a,n,r,i){if(!t)return g;var s=1;if(e===m&&(e=6),n<0?(s=0,n=-n):15<n&&(s=2,n-=16),r<1||w<r||a!==v||n<8||15<n||e<0||9<e||i<0||b<i)return D(t,g);8===n&&(n=9);var h=new P;return(t.state=h).strm=t,h.wrap=s,h.gzhead=null,h.w_bits=n,h.w_size=1<<h.w_bits,h.w_mask=h.w_size-1,h.hash_bits=r+7,h.hash_size=1<<h.hash_bits,h.hash_mask=h.hash_size-1,h.hash_shift=~~((h.hash_bits+z-1)/z),h.window=new u.Buf8(2*h.w_size),h.head=new u.Buf16(h.hash_size),h.prev=new u.Buf16(h.w_size),h.lit_bufsize=1<<r+6,h.pending_buf_size=4*h.lit_bufsize,h.pending_buf=new u.Buf8(h.pending_buf_size),h.d_buf=1*h.lit_bufsize,h.l_buf=3*h.lit_bufsize,h.level=e,h.strategy=i,h.method=a,J(t)}l=[new M(0,0,0,0,function(t,e){var a=65535;for(a>t.pending_buf_size-5&&(a=t.pending_buf_size-5);;){if(t.lookahead<=1){if(H(t),0===t.lookahead&&e===_)return S;if(0===t.lookahead)break}t.strstart+=t.lookahead,t.lookahead=0;var n=t.block_start+a;if((0===t.strstart||t.strstart>=n)&&(t.lookahead=t.strstart-n,t.strstart=n,T(t,!1),0===t.strm.avail_out))return S;if(t.strstart-t.block_start>=t.w_size-B&&(T(t,!1),0===t.strm.avail_out))return S}return t.insert=0,e===d?(T(t,!0),0===t.strm.avail_out?E:U):(t.strstart>t.block_start&&(T(t,!1),t.strm.avail_out),S)}),new M(4,4,8,4,F),new M(4,5,16,8,F),new M(4,6,32,32,F),new M(4,4,16,16,K),new M(8,16,32,32,K),new M(8,16,128,128,K),new M(8,32,128,256,K),new M(32,128,258,1024,K),new M(32,258,258,4096,K)],a.deflateInit=function(t,e){return Q(t,e,v,15,8,0)},a.deflateInit2=Q,a.deflateReset=J,a.deflateResetKeep=G,a.deflateSetHeader=function(t,e){return t&&t.state?2!==t.state.wrap?g:(t.state.gzhead=e,p):g},a.deflate=function(t,e){var a,n,r,i;if(!t||!t.state||5<e||e<0)return t?D(t,g):g;if(n=t.state,!t.output||!t.input&&0!==t.avail_in||666===n.status&&e!==d)return D(t,0===t.avail_out?-5:g);if(n.strm=t,a=n.last_flush,n.last_flush=e,n.status===A)if(2===n.wrap)t.adler=0,L(n,31),L(n,139),L(n,8),n.gzhead?(L(n,(n.gzhead.text?1:0)+(n.gzhead.hcrc?2:0)+(n.gzhead.extra?4:0)+(n.gzhead.name?8:0)+(n.gzhead.comment?16:0)),L(n,255&n.gzhead.time),L(n,n.gzhead.time>>8&255),L(n,n.gzhead.time>>16&255),L(n,n.gzhead.time>>24&255),L(n,9===n.level?2:2<=n.strategy||n.level<2?4:0),L(n,255&n.gzhead.os),n.gzhead.extra&&n.gzhead.extra.length&&(L(n,255&n.gzhead.extra.length),L(n,n.gzhead.extra.length>>8&255)),n.gzhead.hcrc&&(t.adler=c(t.adler,n.pending_buf,n.pending,0)),n.gzindex=0,n.status=69):(L(n,0),L(n,0),L(n,0),L(n,0),L(n,0),L(n,9===n.level?2:2<=n.strategy||n.level<2?4:0),L(n,3),n.status=C);else{var s=v+(n.w_bits-8<<4)<<8;s|=(2<=n.strategy||n.level<2?0:n.level<6?1:6===n.level?2:3)<<6,0!==n.strstart&&(s|=32),s+=31-s%31,n.status=C,N(n,s),0!==n.strstart&&(N(n,t.adler>>>16),N(n,65535&t.adler)),t.adler=1}if(69===n.status)if(n.gzhead.extra){for(r=n.pending;n.gzindex<(65535&n.gzhead.extra.length)&&(n.pending!==n.pending_buf_size||(n.gzhead.hcrc&&n.pending>r&&(t.adler=c(t.adler,n.pending_buf,n.pending-r,r)),q(t),r=n.pending,n.pending!==n.pending_buf_size));)L(n,255&n.gzhead.extra[n.gzindex]),n.gzindex++;n.gzhead.hcrc&&n.pending>r&&(t.adler=c(t.adler,n.pending_buf,n.pending-r,r)),n.gzindex===n.gzhead.extra.length&&(n.gzindex=0,n.status=73)}else n.status=73;if(73===n.status)if(n.gzhead.name){r=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>r&&(t.adler=c(t.adler,n.pending_buf,n.pending-r,r)),q(t),r=n.pending,n.pending===n.pending_buf_size)){i=1;break}L(n,i=n.gzindex<n.gzhead.name.length?255&n.gzhead.name.charCodeAt(n.gzindex++):0)}while(0!==i);n.gzhead.hcrc&&n.pending>r&&(t.adler=c(t.adler,n.pending_buf,n.pending-r,r)),0===i&&(n.gzindex=0,n.status=91)}else n.status=91;if(91===n.status)if(n.gzhead.comment){r=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>r&&(t.adler=c(t.adler,n.pending_buf,n.pending-r,r)),q(t),r=n.pending,n.pending===n.pending_buf_size)){i=1;break}L(n,i=n.gzindex<n.gzhead.comment.length?255&n.gzhead.comment.charCodeAt(n.gzindex++):0)}while(0!==i);n.gzhead.hcrc&&n.pending>r&&(t.adler=c(t.adler,n.pending_buf,n.pending-r,r)),0===i&&(n.status=103)}else n.status=103;if(103===n.status&&(n.gzhead.hcrc?(n.pending+2>n.pending_buf_size&&q(t),n.pending+2<=n.pending_buf_size&&(L(n,255&t.adler),L(n,t.adler>>8&255),t.adler=0,n.status=C)):n.status=C),0!==n.pending){if(q(t),0===t.avail_out)return n.last_flush=-1,p}else if(0===t.avail_in&&I(e)<=I(a)&&e!==d)return D(t,-5);if(666===n.status&&0!==t.avail_in)return D(t,-5);if(0!==t.avail_in||0!==n.lookahead||e!==_&&666!==n.status){var h=2===n.strategy?function(t,e){for(var a;;){if(0===t.lookahead&&(H(t),0===t.lookahead)){if(e===_)return S;break}if(t.match_length=0,a=o._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++,a&&(T(t,!1),0===t.strm.avail_out))return S}return t.insert=0,e===d?(T(t,!0),0===t.strm.avail_out?E:U):t.last_lit&&(T(t,!1),0===t.strm.avail_out)?S:j}(n,e):3===n.strategy?function(t,e){for(var a,n,r,i,s=t.window;;){if(t.lookahead<=x){if(H(t),t.lookahead<=x&&e===_)return S;if(0===t.lookahead)break}if(t.match_length=0,t.lookahead>=z&&0<t.strstart&&(n=s[r=t.strstart-1])===s[++r]&&n===s[++r]&&n===s[++r]){i=t.strstart+x;do{}while(n===s[++r]&&n===s[++r]&&n===s[++r]&&n===s[++r]&&n===s[++r]&&n===s[++r]&&n===s[++r]&&n===s[++r]&&r<i);t.match_length=x-(i-r),t.match_length>t.lookahead&&(t.match_length=t.lookahead)}if(t.match_length>=z?(a=o._tr_tally(t,1,t.match_length-z),t.lookahead-=t.match_length,t.strstart+=t.match_length,t.match_length=0):(a=o._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++),a&&(T(t,!1),0===t.strm.avail_out))return S}return t.insert=0,e===d?(T(t,!0),0===t.strm.avail_out?E:U):t.last_lit&&(T(t,!1),0===t.strm.avail_out)?S:j}(n,e):l[n.level].func(n,e);if(h!==E&&h!==U||(n.status=666),h===S||h===E)return 0===t.avail_out&&(n.last_flush=-1),p;if(h===j&&(1===e?o._tr_align(n):5!==e&&(o._tr_stored_block(n,0,0,!1),3===e&&(O(n.head),0===n.lookahead&&(n.strstart=0,n.block_start=0,n.insert=0))),q(t),0===t.avail_out))return n.last_flush=-1,p}return e!==d?p:n.wrap<=0?1:(2===n.wrap?(L(n,255&t.adler),L(n,t.adler>>8&255),L(n,t.adler>>16&255),L(n,t.adler>>24&255),L(n,255&t.total_in),L(n,t.total_in>>8&255),L(n,t.total_in>>16&255),L(n,t.total_in>>24&255)):(N(n,t.adler>>>16),N(n,65535&t.adler)),q(t),0<n.wrap&&(n.wrap=-n.wrap),0!==n.pending?p:1)},a.deflateEnd=function(t){var e;return t&&t.state?(e=t.state.status)!==A&&69!==e&&73!==e&&91!==e&&103!==e&&e!==C&&666!==e?D(t,g):(t.state=null,e===C?D(t,-3):p):g},a.deflateSetDictionary=function(t,e){var a,n,r,i,s,h,l,o,_=e.length;if(!t||!t.state)return g;if(2===(i=(a=t.state).wrap)||1===i&&a.status!==A||a.lookahead)return g;for(1===i&&(t.adler=f(t.adler,e,_,0)),a.wrap=0,_>=a.w_size&&(0===i&&(O(a.head),a.strstart=0,a.block_start=0,a.insert=0),o=new u.Buf8(a.w_size),u.arraySet(o,e,_-a.w_size,a.w_size,0),e=o,_=a.w_size),s=t.avail_in,h=t.next_in,l=t.input,t.avail_in=_,t.next_in=0,t.input=e,H(a);a.lookahead>=z;){for(n=a.strstart,r=a.lookahead-(z-1);a.ins_h=(a.ins_h<<a.hash_shift^a.window[n+z-1])&a.hash_mask,a.prev[n&a.w_mask]=a.head[a.ins_h],a.head[a.ins_h]=n,n++,--r;);a.strstart=n,a.lookahead=z-1,H(a)}return a.strstart+=a.lookahead,a.block_start=a.strstart,a.insert=a.lookahead,a.lookahead=0,a.match_length=a.prev_length=z-1,a.match_available=0,t.next_in=h,t.input=l,t.avail_in=s,a.wrap=i,p},a.deflateInfo="pako deflate (from Nodeca project)"},{"../utils/common":1,"./adler32":3,"./crc32":4,"./messages":6,"./trees":7}],6:[function(t,e,a){"use strict";e.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"}},{}],7:[function(t,e,a){"use strict";var l=t("../utils/common"),h=0,o=1;function n(t){for(var e=t.length;0<=--e;)t[e]=0}var _=0,s=29,d=256,u=d+1+s,f=30,c=19,g=2*u+1,m=15,r=16,p=7,b=256,v=16,w=17,y=18,k=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],z=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],x=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],B=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],A=new Array(2*(u+2));n(A);var C=new Array(2*f);n(C);var S=new Array(512);n(S);var j=new Array(256);n(j);var E=new Array(s);n(E);var U,D,I,O=new Array(f);function q(t,e,a,n,r){this.static_tree=t,this.extra_bits=e,this.extra_base=a,this.elems=n,this.max_length=r,this.has_stree=t&&t.length}function i(t,e){this.dyn_tree=t,this.max_code=0,this.stat_desc=e}function T(t){return t<256?S[t]:S[256+(t>>>7)]}function L(t,e){t.pending_buf[t.pending++]=255&e,t.pending_buf[t.pending++]=e>>>8&255}function N(t,e,a){t.bi_valid>r-a?(t.bi_buf|=e<<t.bi_valid&65535,L(t,t.bi_buf),t.bi_buf=e>>r-t.bi_valid,t.bi_valid+=a-r):(t.bi_buf|=e<<t.bi_valid&65535,t.bi_valid+=a)}function R(t,e,a){N(t,a[2*e],a[2*e+1])}function H(t,e){for(var a=0;a|=1&t,t>>>=1,a<<=1,0<--e;);return a>>>1}function F(t,e,a){var n,r,i=new Array(m+1),s=0;for(n=1;n<=m;n++)i[n]=s=s+a[n-1]<<1;for(r=0;r<=e;r++){var h=t[2*r+1];0!==h&&(t[2*r]=H(i[h]++,h))}}function K(t){var e;for(e=0;e<u;e++)t.dyn_ltree[2*e]=0;for(e=0;e<f;e++)t.dyn_dtree[2*e]=0;for(e=0;e<c;e++)t.bl_tree[2*e]=0;t.dyn_ltree[2*b]=1,t.opt_len=t.static_len=0,t.last_lit=t.matches=0}function M(t){8<t.bi_valid?L(t,t.bi_buf):0<t.bi_valid&&(t.pending_buf[t.pending++]=t.bi_buf),t.bi_buf=0,t.bi_valid=0}function P(t,e,a,n){var r=2*e,i=2*a;return t[r]<t[i]||t[r]===t[i]&&n[e]<=n[a]}function G(t,e,a){for(var n=t.heap[a],r=a<<1;r<=t.heap_len&&(r<t.heap_len&&P(e,t.heap[r+1],t.heap[r],t.depth)&&r++,!P(e,n,t.heap[r],t.depth));)t.heap[a]=t.heap[r],a=r,r<<=1;t.heap[a]=n}function J(t,e,a){var n,r,i,s,h=0;if(0!==t.last_lit)for(;n=t.pending_buf[t.d_buf+2*h]<<8|t.pending_buf[t.d_buf+2*h+1],r=t.pending_buf[t.l_buf+h],h++,0===n?R(t,r,e):(R(t,(i=j[r])+d+1,e),0!==(s=k[i])&&N(t,r-=E[i],s),R(t,i=T(--n),a),0!==(s=z[i])&&N(t,n-=O[i],s)),h<t.last_lit;);R(t,b,e)}function Q(t,e){var a,n,r,i=e.dyn_tree,s=e.stat_desc.static_tree,h=e.stat_desc.has_stree,l=e.stat_desc.elems,o=-1;for(t.heap_len=0,t.heap_max=g,a=0;a<l;a++)0!==i[2*a]?(t.heap[++t.heap_len]=o=a,t.depth[a]=0):i[2*a+1]=0;for(;t.heap_len<2;)i[2*(r=t.heap[++t.heap_len]=o<2?++o:0)]=1,t.depth[r]=0,t.opt_len--,h&&(t.static_len-=s[2*r+1]);for(e.max_code=o,a=t.heap_len>>1;1<=a;a--)G(t,i,a);for(r=l;a=t.heap[1],t.heap[1]=t.heap[t.heap_len--],G(t,i,1),n=t.heap[1],t.heap[--t.heap_max]=a,t.heap[--t.heap_max]=n,i[2*r]=i[2*a]+i[2*n],t.depth[r]=(t.depth[a]>=t.depth[n]?t.depth[a]:t.depth[n])+1,i[2*a+1]=i[2*n+1]=r,t.heap[1]=r++,G(t,i,1),2<=t.heap_len;);t.heap[--t.heap_max]=t.heap[1],function(t,e){var a,n,r,i,s,h,l=e.dyn_tree,o=e.max_code,_=e.stat_desc.static_tree,d=e.stat_desc.has_stree,u=e.stat_desc.extra_bits,f=e.stat_desc.extra_base,c=e.stat_desc.max_length,p=0;for(i=0;i<=m;i++)t.bl_count[i]=0;for(l[2*t.heap[t.heap_max]+1]=0,a=t.heap_max+1;a<g;a++)c<(i=l[2*l[2*(n=t.heap[a])+1]+1]+1)&&(i=c,p++),l[2*n+1]=i,o<n||(t.bl_count[i]++,s=0,f<=n&&(s=u[n-f]),h=l[2*n],t.opt_len+=h*(i+s),d&&(t.static_len+=h*(_[2*n+1]+s)));if(0!==p){do{for(i=c-1;0===t.bl_count[i];)i--;t.bl_count[i]--,t.bl_count[i+1]+=2,t.bl_count[c]--,p-=2}while(0<p);for(i=c;0!==i;i--)for(n=t.bl_count[i];0!==n;)o<(r=t.heap[--a])||(l[2*r+1]!==i&&(t.opt_len+=(i-l[2*r+1])*l[2*r],l[2*r+1]=i),n--)}}(t,e),F(i,o,t.bl_count)}function V(t,e,a){var n,r,i=-1,s=e[1],h=0,l=7,o=4;for(0===s&&(l=138,o=3),e[2*(a+1)+1]=65535,n=0;n<=a;n++)r=s,s=e[2*(n+1)+1],++h<l&&r===s||(h<o?t.bl_tree[2*r]+=h:0!==r?(r!==i&&t.bl_tree[2*r]++,t.bl_tree[2*v]++):h<=10?t.bl_tree[2*w]++:t.bl_tree[2*y]++,i=r,(h=0)===s?(l=138,o=3):r===s?(l=6,o=3):(l=7,o=4))}function W(t,e,a){var n,r,i=-1,s=e[1],h=0,l=7,o=4;for(0===s&&(l=138,o=3),n=0;n<=a;n++)if(r=s,s=e[2*(n+1)+1],!(++h<l&&r===s)){if(h<o)for(;R(t,r,t.bl_tree),0!=--h;);else 0!==r?(r!==i&&(R(t,r,t.bl_tree),h--),R(t,v,t.bl_tree),N(t,h-3,2)):h<=10?(R(t,w,t.bl_tree),N(t,h-3,3)):(R(t,y,t.bl_tree),N(t,h-11,7));i=r,(h=0)===s?(l=138,o=3):r===s?(l=6,o=3):(l=7,o=4)}}n(O);var X=!1;function Y(t,e,a,n){var r,i,s,h;N(t,(_<<1)+(n?1:0),3),i=e,s=a,h=!0,M(r=t),h&&(L(r,s),L(r,~s)),l.arraySet(r.pending_buf,r.window,i,s,r.pending),r.pending+=s}a._tr_init=function(t){X||(function(){var t,e,a,n,r,i=new Array(m+1);for(n=a=0;n<s-1;n++)for(E[n]=a,t=0;t<1<<k[n];t++)j[a++]=n;for(j[a-1]=n,n=r=0;n<16;n++)for(O[n]=r,t=0;t<1<<z[n];t++)S[r++]=n;for(r>>=7;n<f;n++)for(O[n]=r<<7,t=0;t<1<<z[n]-7;t++)S[256+r++]=n;for(e=0;e<=m;e++)i[e]=0;for(t=0;t<=143;)A[2*t+1]=8,t++,i[8]++;for(;t<=255;)A[2*t+1]=9,t++,i[9]++;for(;t<=279;)A[2*t+1]=7,t++,i[7]++;for(;t<=287;)A[2*t+1]=8,t++,i[8]++;for(F(A,u+1,i),t=0;t<f;t++)C[2*t+1]=5,C[2*t]=H(t,5);U=new q(A,k,d+1,u,m),D=new q(C,z,0,f,m),I=new q(new Array(0),x,0,c,p)}(),X=!0),t.l_desc=new i(t.dyn_ltree,U),t.d_desc=new i(t.dyn_dtree,D),t.bl_desc=new i(t.bl_tree,I),t.bi_buf=0,t.bi_valid=0,K(t)},a._tr_stored_block=Y,a._tr_flush_block=function(t,e,a,n){var r,i,s=0;0<t.level?(2===t.strm.data_type&&(t.strm.data_type=function(t){var e,a=4093624447;for(e=0;e<=31;e++,a>>>=1)if(1&a&&0!==t.dyn_ltree[2*e])return h;if(0!==t.dyn_ltree[18]||0!==t.dyn_ltree[20]||0!==t.dyn_ltree[26])return o;for(e=32;e<d;e++)if(0!==t.dyn_ltree[2*e])return o;return h}(t)),Q(t,t.l_desc),Q(t,t.d_desc),s=function(t){var e;for(V(t,t.dyn_ltree,t.l_desc.max_code),V(t,t.dyn_dtree,t.d_desc.max_code),Q(t,t.bl_desc),e=c-1;3<=e&&0===t.bl_tree[2*B[e]+1];e--);return t.opt_len+=3*(e+1)+5+5+4,e}(t),r=t.opt_len+3+7>>>3,(i=t.static_len+3+7>>>3)<=r&&(r=i)):r=i=a+5,a+4<=r&&-1!==e?Y(t,e,a,n):4===t.strategy||i===r?(N(t,2+(n?1:0),3),J(t,A,C)):(N(t,4+(n?1:0),3),function(t,e,a,n){var r;for(N(t,e-257,5),N(t,a-1,5),N(t,n-4,4),r=0;r<n;r++)N(t,t.bl_tree[2*B[r]+1],3);W(t,t.dyn_ltree,e-1),W(t,t.dyn_dtree,a-1)}(t,t.l_desc.max_code+1,t.d_desc.max_code+1,s+1),J(t,t.dyn_ltree,t.dyn_dtree)),K(t),n&&M(t)},a._tr_tally=function(t,e,a){return t.pending_buf[t.d_buf+2*t.last_lit]=e>>>8&255,t.pending_buf[t.d_buf+2*t.last_lit+1]=255&e,t.pending_buf[t.l_buf+t.last_lit]=255&a,t.last_lit++,0===e?t.dyn_ltree[2*a]++:(t.matches++,e--,t.dyn_ltree[2*(j[a]+d+1)]++,t.dyn_dtree[2*T(e)]++),t.last_lit===t.lit_bufsize-1},a._tr_align=function(t){var e;N(t,2,3),R(t,b,A),16===(e=t).bi_valid?(L(e,e.bi_buf),e.bi_buf=0,e.bi_valid=0):8<=e.bi_valid&&(e.pending_buf[e.pending++]=255&e.bi_buf,e.bi_buf>>=8,e.bi_valid-=8)}},{"../utils/common":1}],8:[function(t,e,a){"use strict";e.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0}},{}],"/lib/deflate.js":[function(t,e,a){"use strict";var s=t("./zlib/deflate"),h=t("./utils/common"),l=t("./utils/strings"),r=t("./zlib/messages"),i=t("./zlib/zstream"),o=Object.prototype.toString,_=0,d=-1,u=0,f=8;function c(t){if(!(this instanceof c))return new c(t);this.options=h.assign({level:d,method:f,chunkSize:16384,windowBits:15,memLevel:8,strategy:u,to:""},t||{});var e=this.options;e.raw&&0<e.windowBits?e.windowBits=-e.windowBits:e.gzip&&0<e.windowBits&&e.windowBits<16&&(e.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new i,this.strm.avail_out=0;var a=s.deflateInit2(this.strm,e.level,e.method,e.windowBits,e.memLevel,e.strategy);if(a!==_)throw new Error(r[a]);if(e.header&&s.deflateSetHeader(this.strm,e.header),e.dictionary){var n;if(n="string"==typeof e.dictionary?l.string2buf(e.dictionary):"[object ArrayBuffer]"===o.call(e.dictionary)?new Uint8Array(e.dictionary):e.dictionary,(a=s.deflateSetDictionary(this.strm,n))!==_)throw new Error(r[a]);this._dict_set=!0}}function n(t,e){var a=new c(e);if(a.push(t,!0),a.err)throw a.msg||r[a.err];return a.result}c.prototype.push=function(t,e){var a,n,r=this.strm,i=this.options.chunkSize;if(this.ended)return!1;n=e===~~e?e:!0===e?4:0,"string"==typeof t?r.input=l.string2buf(t):"[object ArrayBuffer]"===o.call(t)?r.input=new Uint8Array(t):r.input=t,r.next_in=0,r.avail_in=r.input.length;do{if(0===r.avail_out&&(r.output=new h.Buf8(i),r.next_out=0,r.avail_out=i),1!==(a=s.deflate(r,n))&&a!==_)return this.onEnd(a),!(this.ended=!0);0!==r.avail_out&&(0!==r.avail_in||4!==n&&2!==n)||("string"===this.options.to?this.onData(l.buf2binstring(h.shrinkBuf(r.output,r.next_out))):this.onData(h.shrinkBuf(r.output,r.next_out)))}while((0<r.avail_in||0===r.avail_out)&&1!==a);return 4===n?(a=s.deflateEnd(this.strm),this.onEnd(a),this.ended=!0,a===_):2!==n||(this.onEnd(_),!(r.avail_out=0))},c.prototype.onData=function(t){this.chunks.push(t)},c.prototype.onEnd=function(t){t===_&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=h.flattenChunks(this.chunks)),this.chunks=[],this.err=t,this.msg=this.strm.msg},a.Deflate=c,a.deflate=n,a.deflateRaw=function(t,e){return(e=e||{}).raw=!0,n(t,e)},a.gzip=function(t,e){return(e=e||{}).gzip=!0,n(t,e)}},{"./utils/common":1,"./utils/strings":2,"./zlib/deflate":5,"./zlib/messages":6,"./zlib/zstream":8}]},{},[])("/lib/deflate.js")});`;
}
