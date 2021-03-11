import "@croquet/util/deduplicate";
import stableStringify from "fast-json-stable-stringify";
import Base64 from "crypto-js/enc-base64";
import Utf8 from "crypto-js/enc-utf8";
import PBKDF2 from "crypto-js/pbkdf2";
import AES from "crypto-js/aes";
import WordArray from "crypto-js/lib-typedarrays";
import HmacSHA256 from "crypto-js/hmac-sha256";

import pako from "pako"; // gzip-aware compressor
import { Stats } from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { App, displayStatus, displayWarning, displayError, displayAppError } from "@croquet/util/html";
import { baseUrl, hashSessionAndCode, hashString } from "@croquet/util/hashing";
import { inViewRealm } from "./realms";
import { viewDomain } from "./domain";
import Island, { Message, inSequence } from "./island";
import UploadWorkerFactory from "web-worker:./upload";

/** @typedef { import('./model').default } Model */
/** @typedef { {} } Session */

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
        initsnapshot: urlOptions.has("debug", "initsnapshot", "localhost"), // check snapshotting after initFn
        reflector: urlOptions.has("debug", "reflector", urlOptions.dev || "localhost"), // use dev reflector
    };
}

const NOCHEAT = urlOptions.nocheat;

// schedule a snapshot after this many ms of CPU time have been used for simulation
const SNAPSHOT_EVERY = 5000;
// add this many ms for each external message scheduled
const EXTERNAL_MESSAGE_CPU_PENALTY = 5;

// backlog threshold in ms to publish "synced(true|false)" event (to start/stop rendering)
const SYNCED_MIN = 100;
const SYNCED_MAX = 1000;
const SYNCED_ANNOUNCE_DELAY = 200; // ms to delay setting synced, mainly to accommodate immediate post-SYNC messages (notably "users") from reflector

function randomString() { return Math.floor(Math.random() * 36**10).toString(36); }


// start upload worker (upload.js)
const UploadWorker = new UploadWorkerFactory();
UploadWorker.onerror = e => console.error(`UploadWorker error: ${e.message}`);
let UploadJobs = 0;

const Controllers = new Set();

export function sessionProps(sessionId) {
    for (const controller of Controllers) {
        if (controller.id === sessionId) {
            const { appId, islandId } = controller.islandCreator;
            return {
                appId, islandId,
                uploadEncrypted: opts => controller.uploadEncrypted(opts),
                downloadEncrypted: opts => controller.downloadEncrypted(opts),
            };
        }
    }
    return {};
}

export default class Controller {

    constructor() {
        initDEBUG();
        this.reset();
    }

    reset() {
        if (window.ISLAND === this.island) delete window.ISLAND;
        /** @type {Island} */
        this.island = null;
        /** @type {Session} the session object as returned from Session.join, set in session.js. Not to be used here but only so that View.session can find it. Needs redesign. */
        this.session = null;
        /**  @type {Connection} our websocket connection for talking to the reflector */
        this.connection = this.connection || new Connection(this);
        /** the messages received from reflector */
        this.networkQueue = [];
        /** the time stamp of last message received from reflector */
        this.time = 0;
        /** the local time at which we received the last time stamp, minus that time stamp */
        this.extrapolatedTimeBase = Date.now();
        /** key generated from password, shared by all clients in session */
        this.key = null;
        /** @type {String} the client id (different in each replica, but stays the same on reconnect) */
        this.viewId = this.viewId || randomString(); // todo: have reflector assign unique ids
        /** @type {String} stateless reflectors always start new session, this is the only way to notice that */
        this.reflectorSession = '';
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
        viewDomain.addSubscription(this.viewId, "__views__", this.viewId, data => displayStatus(`users now ${data.count}`), "oncePerFrameWhileSynced");
        // "leaving" is set in session.js if we are leaving by user's request (rather than going dormant/reconnecting)
        if (!this.leaving) App.showSyncWait(true); // enable (i.e., not synced)
    }

    /** @type {String} the session id (same for all replicas running with same options on the same app version) */
    get id() { return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    /** @type {String} the persistent id (same for all replicas with same options across app versions) */
    get persistentId() { return this.islandCreator.islandId; }

    /** @type {String} identifies SDK version and app code */
    get versionId() { return this.islandCreator.codeHash; }

    /** @type {Number} the reflector time extrapolated beyond last received tick */
    get extrapolatedNow() { return Date.now() - this.extrapolatedTimeBase; }

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

    /** @type {Boolean} should the connection call leave() when disconnected? */
    get shouldLeaveWhenDisconnected() { return this.leaving || !this.canRejoinSeamlessly; }

    /** @type {Boolean} does the reflector support seamless rejoin? */
    get canRejoinSeamlessly() { return !!this.reflectorSession; } //

    checkForConnection(force) { this.connection.checkForConnection(force); }

    dormantDisconnect() {
        if (!this.connected) return;
        this.connection.dormantDisconnect();
    }

    /**
     * Join or create a session by connecting to the reflector
     * - the island/session id is created from `name` and
     *   a hash of registered options and source code
     *
     * @param {String} name - A (human-readable) name for the session/room
     * @param {Object} sessionSpec - Spec for the session
     * @param {Function} sessionSpec.initFn - the island initializer `initFn(options)`
     * @param {Function} sessionSpec.destroyerFn - optional island destroyer (called with a snapshot when disconnecting)
     * @param {Object} sessionSpec.options - options to pass to the island initializer
     * @param {Object} sessionSpec.snapshot - an optional snapshot to use (instead of running the island initializer if this is the first user in the session
     * @param {Array<String>} sessionSpec.optionsFromUrl - names of additional island initializer options to take from URL
     * @param {String} sessionSpec.appId - a unique identifier for an app
     * @param {String} sessionSpec.password - password for end-to-end encryption
     * @param {String} sessionSpec.viewIdDebugSuffix - suffix for viewIds tohelp debugging
     * @param {Number|String} sessionSpec.tps - ticks per second (can be overridden by `options.tps` or `urlOptions.tps`)
     *
     * @returns {Promise}
     */
    async establishSession(sessionSpec) {
        // If we add more options here, add them to SESSION_PARAMS in session.js
        const { name: n, optionsFromUrl, password, appId, viewIdDebugSuffix} = sessionSpec;
        const name = appId ? `${appId}/${n}` : n;
        if (viewIdDebugSuffix) this.viewId = this.viewId.replace(/_.*$/, '') + "_" + encodeURIComponent((""+viewIdDebugSuffix).slice(0,16))
            .replace(/[^a-z0-9]/ig, c => `_${c === '%' ? '' : c.charCodeAt(0).toString(16).toUpperCase()}`); // ensure only a-z0-9_ in suffix
        // root model options are only those explicitly requested by app
        const options = {...sessionSpec.options};
        if (optionsFromUrl) for (const key of optionsFromUrl) {
            if (key in urlOptions) options[key] = urlOptions[key];
        }
        // session parameters are additional properties that cause a new session
        const params = {};
        for (const key of [ 'tps' ] ) {
            if (key in urlOptions) params[key] = urlOptions[key];
            else if (key in sessionSpec) params[key] = sessionSpec[key];
        }
        this.key = PBKDF2(password, "", { keySize: 256/32 });
        this.oldKey = PBKDF2("THIS SHOULDN'T BE IN LOGS", "", { keySize: 256/32 });
        const { id, islandId, codeHash } = await hashSessionAndCode(name, options, params, SDK_VERSION);
        if (DEBUG.session) console.log(`Croquet sessionId for "${name}": ${id} viewId: ${this.viewId}`);
        this.islandCreator = {...sessionSpec, options, name, islandId, codeHash };

        let initSnapshot = false;
        if (!this.islandCreator.snapshot) initSnapshot = true;
        else if (this.islandCreator.snapshot.id !== id) {
            const sameSession = this.islandCreator.snapshot.islandId === islandId;
            console.warn(`Existing snapshot was for different ${sameSession ? "code base" : "session"}!`);
            initSnapshot = true;
        }
        if (initSnapshot) this.islandCreator.snapshot = { id, time: 0, meta: { id, islandId, codeHash, created: (new Date()).toISOString() } };

        // create promise before join to prevent race
        const synced = new Promise((resolve, reject) => this.islandCreator.sessionSynced = { resolve, reject } );
        if (this.reboot) this.reboot(); // if reconnect in progress, continue on the await in SYNC
        else this.join();   // when socket is ready, join server
        await synced;  // resolved after receiving `SYNC`, installing island, and replaying messages
        return this.island.modelsByName;
    }

    lastKnownTime(islandOrSnapshot) { return Math.max(islandOrSnapshot.time, islandOrSnapshot.externalTime); }

    // DEBUG SUPPORT - NORMALLY NOT USED
    async syncCheck(time, tuttiSeq, summaryHash) {
        if (this.synced !== true) return;
        const tally = await this.sendTutti(time, tuttiSeq, summaryHash);
        const hashStrings = Object.keys(tally);
        if (hashStrings.length > 1) {
            console.warn("sync check failed:", hashStrings);
        } else console.log("sync check ok");
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

    handlePollForSnapshot(time, tuttiSeq) {
        // !!! THIS IS BEING EXECUTED INSIDE THE SIMULATION LOOP!!!
        // !!! IT MUST NOT MODIFY ISLAND !!!

        if (this.synced !== true) return;  // not going to vote, so don't waste time on creating the hash

        const localCpuTime = this.triggeringCpuTime || this.cpuTime;
        this.triggeringCpuTime = null;
        this.cpuTime = 0;

        let start, voteData, ms;
        try {
            start = Stats.begin("snapshot");
            voteData = {
                cpuTime: localCpuTime,
                hash: this.island.getSummaryHash(),
                viewId: this.viewId,
            }
        } catch (error) {
            displayAppError("snapshot", error);
            return;
        } finally {
            ms = Stats.end("snapshot") - start;
            // exclude snapshot time from cpu time for logic in this.simulate()
            this.cpuTime -= ms;  // give ourselves a time credit for the non-simulation work
        }
        if (DEBUG.snapshot) console.log(this.id, `Summary hashing took ${Math.ceil(ms)}ms`);

        // sending the vote is handled asynchronously, because we want to add a view-side random()
        Promise.resolve().then(() => this.pollForSnapshot(time, tuttiSeq, voteData));
    }

    async pollForSnapshot(time, tuttiSeq, voteData) {
        voteData.cpuTime += Math.random(); // fuzzify by 0-1ms to further reduce [already minuscule] risk of exact agreement.  NB: this is a view-side random().
        if (DEBUG.snapshot) console.log(this.id, 'sending snapshot vote', voteData);

        const tally = await this.sendTutti(time, tuttiSeq, voteData);

        if (this.synced !== true) {
            if (DEBUG.snapshot) console.log(this.id, "Ignoring snapshot vote during sync");
            return;
        }
        if (DEBUG.snapshot) console.log(this.id, "received snapshot votes", tally);

        const voteStrings = Object.keys(tally);
        const votes = voteStrings.map(k => JSON.parse(k)); // objects { hash, cpuTime, viewId }
        const votesByHash = {};

        // figure out whether there's a consensus on the summary hashes
        votes.forEach(({ hash }, i) => {
            if (!votesByHash[hash]) votesByHash[hash] = [];
            votesByHash[hash].push(i);
            });

        const snapshotFromGroup = (groupHash, isConsensus) => {
            const clientIndices = votesByHash[groupHash];
            if (clientIndices.length > 1) clientIndices.sort((a, b) => votes[a].cpuTime - votes[b].cpuTime); // ascending order
            const selectedClient = clientIndices[0];
            if (votes[selectedClient].viewId === this.viewId) {
                const dissidentFlag = isConsensus ? null : { groupSize: clientIndices.length };
                this.serveSnapshot(dissidentFlag);
            }
            };

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
        let start, ms, snapshot;
        try {
            start = Stats.begin("snapshot");
            snapshot = this.takeSnapshot();
        } catch (error) {
            displayAppError("snapshot", error);
            return;
        } finally {
            ms = Stats.end("snapshot") - start;
        }
        if (DEBUG.snapshot) console.log(this.id, `Snapshotting took ${Math.ceil(ms)} ms`);
        this.uploadSnapshot(snapshot, dissidentFlag);
    }

    snapshotUrl(time, seq, hash) {
        const base = `${baseUrl('snapshots')}${this.id}`;
        const pad = n => ("" + n).padStart(10, '0');
        // snapshot time is full precision. for storage name, we use full ms.
        const filename = `${pad(Math.ceil(time))}_${seq}-${hash}.snap`;
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
        const content = JSON.stringify(snapshot);
        const stringMS = Stats.end("snapshot") - start;
        if (DEBUG.snapshot) console.log(this.id, `snapshot stringified (${content.length} bytes) in ${Math.ceil(stringMS)}ms`);

        const {time, seq, hash} = snapshot.meta;
        const url = this.snapshotUrl(time, seq, hash);
        const socket = this.connection.socket;
        try {
            await this.uploadEncrypted({
                url,
                content,
                key: this.key,
                gzip: true,
                debug: DEBUG.snapshot,
                what: "snapshot",
            });
            if (this.connection.socket !== socket) { console.warn(this.id, "Controller was reset while trying to upload snapshot"); return false; }
        } catch (e) { console.error(this.id, "Failed to upload snapshot"); return false; }
        this.announceSnapshotUrl(time, seq, hash, url, dissidentFlag);
        return true;
    }

    // was sendSnapshotToReflector
    announceSnapshotUrl(time, seq, hash, url, dissidentFlag) {
        if (DEBUG.snapshot) {
            let logProps = `time: ${time}, seq: ${seq}, hash: ${hash}`;
            if (dissidentFlag) logProps += ", dissident: " + JSON.stringify(dissidentFlag);
            console.log(this.id, `sending snapshot url to reflector (${logProps}): ${url}`);
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

    async downloadEncrypted({url, gzip, key, debug, json, what}) {
        let timer = Date.now();
        const response = await fetch(url, {
            method: "GET",
            mode: "cors",
            headers: {
                "X-Croquet-App": this.islandCreator.appId,
                "X-Croquet-Id": this.islandCreator.islandId,
            },
            referrer: App.referrerURL(),
        });
        const encrypted = await response.arrayBuffer();
        if (debug) console.log(this.id, `${what} fetched (${encrypted.byteLength} bytes) in ${-timer + (timer = Date.now())}ms`);
        const decrypted = this.decryptBinary(encrypted, key); // Uint8Array
        if (debug) console.log(this.id, `${what} decrypted (${decrypted.length} bytes) in ${-timer + (timer = Date.now())}ms`);
        const uncompressed = gzip ? pako.inflate(decrypted) : decrypted;
        if (debug && gzip) console.log(this.id, `${what} inflated (${uncompressed.length} bytes) in ${-timer + (timer = Date.now())}ms`);
        return json ? JSON.parse(new TextDecoder().decode(uncompressed)) : uncompressed;
    }

    /** upload string or array buffer as binary encrypted, optionally gzipped */
    async uploadEncrypted({url, content, key, gzip, keep, debug, what}) {
        // leave actual work to our UploadWorker
        const buffer = typeof content === "string" ? new TextEncoder().encode(content).buffer : content;
        const transfer = keep ? undefined : [buffer];
        const keyBase64 = typeof key === "string" ? key : Base64.stringify(key);
        const job = ++UploadJobs;
        return new Promise( (resolve, reject) => {
            UploadWorker.postMessage({
                job,
                cmd: "uploadEncrypted",
                url,
                buffer,
                keyBase64,
                gzip,
                referrer: App.referrerURL(),
                id: this.id,
                appId: this.islandCreator.appId,
                islandId: this.islandCreator.islandId,
                debug,
                what,
            }, transfer);
            const onmessage = msg => {
                if (job !== msg.data.job) return;
                const {url, ok, status, statusText} = msg.data;
                UploadWorker.removeEventListener("message", onmessage);
                if (ok) resolve(url);
                else reject(Error(`${status}: ${statusText}`));
            };
            UploadWorker.addEventListener("message", onmessage);
        });
    }

    persistentUrl(hash) {
        const { appId, islandId } = this.islandCreator;
        return `${baseUrl('apps')}${appId}/${islandId}/save/${hash}`;
    }

    async persist(time, tuttiSeq, persistentString, persistentHash, ms) {
        if (!this.synced) return; // ignore during fast-forward
        if (!this.islandCreator.appId) throw Error('Persistence API requires appId');
        const shouldUpload = await this.persistenceVoting(time, tuttiSeq, persistentHash, ms);
        if (!shouldUpload) return;
        const url = this.persistentUrl(persistentHash);
        await this.uploadEncrypted({
            url,
            content: persistentString,
            key: this.key,
            gzip: true,
            debug: DEBUG.snapshot,
            what: "persistent data",
        });
        if (DEBUG.snapshot) console.log(this.id, `sending persistent data url to reflector: ${url}`);
        try {
            this.connection.send(JSON.stringify({
                id: this.id,
                action: 'SAVE',
                args: { url },
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
    }

    async persistenceVoting(time, tuttiSeq, hash, ms) {
        if (this.synced !== true) return false; // we don't participate unless we're synced
        const ourVote = {
            view: this.viewId,                // to identify our own vote
            hash,                             // if this differs, each group will upload
            ms: ms + Math.random() * 0.001,   // for sorting within a group, plus add a tiny bit of randomness
        };
        if (DEBUG.snapshot) console.log(this.id, 'sending persistence vote', ourVote);
        const tally = await this.sendTutti(time, tuttiSeq, ourVote);
        if (DEBUG.snapshot) console.log(this.id, 'received persistence votes', tally);
        // find min ms in our hash group
        let minMs = Infinity;
        let minView = '';
        for (const each of Object.keys(tally)) {
            const { view, hash, ms } = JSON.parse(each);
            if (hash !== ourVote.hash) continue;    // ignore other groups
            if (ms > minMs || ms === minMs && view > minView) continue; // not min
            minMs = ms;
            minView = view;
        }
        // we upload if we were fastest
        const shouldUpload = minView === this.viewId;
        return shouldUpload;
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
                const event = "__views__";
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
                const tuttiIndex = this.tuttiHistory.findIndex(hist => hist.tuttiSeq === tuttiSeq);
                const local = tuttiIndex !== -1 && this.tuttiHistory.splice(tuttiIndex, 1)[0];
                // if we participated, resolve our promise
                if (local) local.resolve(tally);
                // if a target message was passed, execute it
                if (tallyTarget) {
                    const convertedArgs = { tuttiSeq, tally };
                    if (local) convertedArgs._local = local.payload;
                    let topic;
                    [ receiver, selector, topic ] = tallyTarget;
                    args = [ topic, convertedArgs ];
                }
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
                const {messages, url, persisted, time, seq, snapshotTime, snapshotSeq, reflector, reflectorSession} = args;
                const persistedOrSnapshot = persisted ? "persisted session" : "snapshot";
                if (DEBUG.session) console.log(this.id, `received SYNC from ${reflector} reflector: time ${time}, ${messages.length} messages, ${persistedOrSnapshot} ${url || "<none>"}`);
                // if we are rejoining, check if we can do that seamlessly without taking down the view
                // meaning we have all the messages we missed while disconnected
                let rejoining = !!this.island;
                if (rejoining) {
                    // old reflector does not send seq, snapshotSeq, reflectorSession, cannot rejoin
                    const sameSession  = !!reflectorSession && reflectorSession === this.reflectorSession;
                    const ourOldest = this.island.seq;
                    const ourNewest = this.networkQueue.length > 0 ? this.networkQueue[this.networkQueue.length-1].seq : ourOldest;
                    const syncNewest = seq;
                    const syncOldest = snapshotSeq !== undefined ? snapshotSeq
                        : messages.length > 0 ? messages[0][1] : syncNewest;
                    const seamlessRejoin = sameSession        //
                        && inSequence(syncOldest, ourNewest)   // there must be no gap between our last message and the first synced message
                        && inSequence(ourOldest, syncNewest);  // the reflector state must not be older than our island
                    if (seamlessRejoin) {
                        // rejoin is safe, just drop duplicate messages
                        if (messages[0] && inSequence(messages[0][1], ourNewest)) {
                            messages.splice(0, 1 + (ourNewest - messages[0][1]));
                        }
                        // proceed to enqueue the messages we missed while disconnected
                    } else {
                        // likely a snapshot happened while disconnected. Reboot.
                        if (DEBUG.session) console.log(this.id, "cannot rejoin seamlessly, rebooting model/view")
                        this.leave(true);
                        if (DEBUG.session) console.log(this.id, "waiting for model/view reboot finished")
                        await new Promise(resolve => this.reboot = () => {
                            this.reboot = null;
                            resolve();
                        });
                        if (DEBUG.session) console.log(this.id, "finished model/view reboot")
                        rejoining = false;
                    }
                }
                // enqueue all messages now because the reflector will start sending more messages
                // while we are waiting for the snapshot.
                // if any conversion of custom reflector messages is to be done, do it before
                // waiting for the snapshot to arrive (because there might be some meta-processing
                // that happens immediately on conversion; this is the case for "users" messages)
                for (const msg of messages) {
                    if (typeof msg[2] !== "string") {
                        this.convertReflectorMessage(msg);
                    } else try {
                        msg[2] = this.decryptPayload(msg[2])[0];
                    } catch(err) {
                        this.connection.closeConnectionWithError('SYNC', Error(`failed to decrypt message: ${err.message}`), 4200); // do not retry
                        return;
                    }
                    if (DEBUG.messages) console.log(this.id, 'received in SYNC ' + JSON.stringify(msg));
                    this.networkQueue.push(msg);
                }
                this.timeFromReflector(time);
                // if we were rejoining, then our work is done here: we got all the missing messages
                if (rejoining) {
                    if (DEBUG.session) console.log(this.id, "rejoined successfully")
                    return;
                }
                this.reflectorSession = reflectorSession; // stored only on initial connection
                // otherwise we need go to work
                if (DEBUG.session) console.log(`${this.id} fetching ${persistedOrSnapshot} ${url}`);
                let data;
                if (url) try {
                    data = await this.downloadEncrypted({url, gzip: true, key: this.key, debug: DEBUG.snapshot, json: true, what: persistedOrSnapshot});
                } catch(err) {
                    this.connection.closeConnectionWithError('SYNC', Error(`failed to fetch ${persistedOrSnapshot}: ${err.message}`), 4200); // do not retry
                    return;
                }
                if (!this.connected) { console.log(this.id, 'disconnected during SYNC'); return; }
                if (persisted) {
                    // run initFn() with persisted data, if any
                    this.install(data);
                } else {
                    if (data) this.islandCreator.snapshot = data;  // set snapshot for building the island
                    this.install();  // will run initFn() if no snapshot
                }
                // after install() sets this.island, the main loop may also trigger simulation
                if (DEBUG.session) console.log(`${this.id} fast-forwarding from ${Math.round(this.island.time)}`);
                // execute pending events, up to (at least) our own view-join
                const success = await new Promise(resolve => {
                    const fastForwardIsland = () => {
                        if (!this.connected) { console.log(this.id, 'disconnected during SYNC fast-forwarding'); resolve(false); return; }
                        const caughtUp = this.simulate(Date.now() + 200);
                        const joined = this.viewId in this.island.views;
                        if (caughtUp && joined) resolve(true);
                        else setTimeout(fastForwardIsland, 0);
                    };
                    fastForwardIsland();
                });
                if (!success) return;
                if (DEBUG.session) console.log(`${this.id} fast-forwarded to ${Math.round(this.island.time)}`);
                // return from establishSession()
                this.islandCreator.sessionSynced.resolve(this.island);
                // TODO: if we don't resolve nor reject this promise due to the returns above, does this leak memory?
                return;
            }
            case 'RECV': {
                // We received a message from reflector.
                // Put it in the queue, and set time.
                // Actual processing happens in main loop.
                const msg = args;
                msg[1] >>>= 0; // make sure it's uint32 (reflector used to send int32)
                // the reflector might insert messages on its own, indicated by a non-string payload
                // we need to convert the payload to the message format this client is using
                if (typeof msg[2] !== "string") {
                    if (DEBUG.messages) console.log(this.id, 'received META ' + JSON.stringify(msg));
                    this.convertReflectorMessage(msg);
                    if (DEBUG.messages) console.log(this.id, 'converted to ' + JSON.stringify(msg));
                } else try {
                    const [payload, viewId, lastSent] = this.decryptPayload(msg[2]);
                    msg[2] = payload;
                    // if we sent this message, add it to latency statistics
                    if (viewId === this.viewId) this.addToStatistics(lastSent, this.lastReceived);
                    if (DEBUG.messages) console.log(this.id, 'received ' + JSON.stringify(msg));
                } catch(err) {
                    this.connection.closeConnectionWithError('RECV', Error(`failed to decrypt message: ${err.message}`), 4200); // do not retry
                    return;
                }
                this.networkQueue.push(msg);
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
            default: console.warn("Unknown action:", action, args);
        }
    }

    // create the Island for this Controller, based on the islandCreator
    install(persistentData) {
        if (DEBUG.session) console.log(`${this.id} installing island`);
        const {snapshot, initFn, options} = this.islandCreator;
        let newIsland = new Island(snapshot, () => {
            try { return initFn(options, persistentData); }
            catch (error) {
                displayAppError("initFn", error);
                throw error;
            }
        });
        if (DEBUG.initsnapshot && !snapshot.modelsById) {
            // exercise serializer if we came from initFn
            const initialIslandSnap = JSON.stringify(newIsland.snapshot());
            newIsland = new Island(JSON.parse(initialIslandSnap), () => initFn(options));
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

    // // create an island in its initial state
    // createCleanIsland() {
    //     const { options, initFn } = this.islandCreator;
    //     const snapshot = { id: this.id };
    //     return new Island(snapshot, () => initFn(options));
    // }

    // network queue

    async join() {
        this.checkForConnection(false); // don't force it
        if (DEBUG.session) console.log(this.id, "awaiting connection promise")
        await this.connection.connectionPromise; // wait until there is a connection

        Controllers.add(this);

        if (DEBUG.session) console.log(this.id, 'Controller sending JOIN');

        const { tick, delay } = this.getTickAndMultiplier();
        const { name, codeHash, appId, islandId, heraldUrl } = this.islandCreator;

        const args = {
            name,                   // for debugging only
            version: VERSION,       // protocol version
            user: this.viewId,      // see island.generateJoinExit() for getting location data
            ticks: { tick, delay },
            url: App.referrerURL(), // for debugging only
            codeHash,               // for debugging only
            sdk: SDK_VERSION,       // for debugging only
        };
        if (appId) Object.assign(args, {
            appId,                  // identifies developer/app
            islandId,               // identifies island across sessions
        });
        if (heraldUrl) Object.assign(args, {
            heraldUrl,              // url to receive POST for join/leave events
        });

        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args,
        }));
    }

    // either the connection has been broken or the reflector has sent LEAVE
    leave(keepController=false) {
        const {destroyerFn} = this.islandCreator;
        this.reset();
        if (DEBUG.session) console.log(this.id, `resetting ${keepController ? "(but keeping)" : "and discarding"} controller`)
        if (!keepController) Controllers.delete(this);   // after reset so it does not re-enable the SYNC overlay
        if (!this.islandCreator) throw Error("do not discard islandCreator!");
        if (destroyerFn) destroyerFn();
    }

    async encrypt(plaintext) {
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

    decrypt(encrypted, key=this.key) {
        const iv = Base64.parse(encrypted.slice(0, 24));
        const mac = Base64.parse(encrypted.slice(24, 24 + 44));
        const ciphertext = encrypted.slice(24 + 44);
        const decrypted = AES.decrypt(ciphertext, key, { iv });
        let plaintext = '';
        try { plaintext = Utf8.stringify(decrypted) } catch (err) { /* ignore */};
        const hmac = HmacSHA256(plaintext, this.key);
        if (this.compareHmacs(mac.words, hmac.words)) return plaintext;
        if (key !== this.oldKey) return this.decrypt(encrypted, this.oldKey);
        throw Error('Decryption error');
    }

    decryptBinary(buffer, key) {
        const version = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
        if (typeof key === "string") key = Base64.parse(key);
        let encrypted, iv, mac, ciphertext, decrypted;
        switch (version) {
            case "CRQ0": // Base64
                encrypted = new TextDecoder().decode(buffer);
                iv = Base64.parse(encrypted.slice(4, 4 + 24));
                mac = Base64.parse(encrypted.slice(4 + 24, 4 + 24 + 44));
                ciphertext = encrypted.slice(4 + 24 + 44);
                decrypted = AES.decrypt(ciphertext, key, { iv });        // implicitly creates { ciphertext }
                break;
            case "CRQ1": // Binary
                encrypted = new Uint8Array(buffer);
                iv = WordArray.create(encrypted.subarray(4, 4 + 16));
                mac = WordArray.create(encrypted.subarray(4 + 16, 4 + 16 + 32));
                ciphertext = WordArray.create(encrypted.subarray(4 + 16 + 32));
                decrypted = AES.decrypt({ ciphertext }, key, { iv });
                break;
            default: throw Error(`${this.id} unknown encryption version ${version}`);
        }
        decrypted.clamp(); // clamping manually because of bug in HmacSHA256
        const hmac = HmacSHA256(decrypted, key);
        if (this.compareHmacs(mac.words, hmac.words)) return this.cryptoJsWordArrayToUint8Array(decrypted);
        if (key !== this.oldKey) return this.decryptBinary(buffer, this.oldKey);
        throw Error('Decryption error');
    }

    cryptoJsWordArrayToUint8Array(wordArray) {
        const l = wordArray.sigBytes;
        const words = wordArray.words;
        const result = new Uint8Array(l);
        let i = 0, j = 0;
        while (true) {
            if (i === l) break;
            const w = words[j++];
            result[i++] = (w & 0xff000000) >>> 24; if (i === l) break;
            result[i++] = (w & 0x00ff0000) >>> 16; if (i === l) break;
            result[i++] = (w & 0x0000ff00) >>> 8;  if (i === l) break;
            result[i++] = (w & 0x000000ff);
        }
        return result;
    }

    async encryptMessage(msg, viewId, lastSent) {
        const [time, seq, msgPayload] = msg.asState();
        const encryptedPayload = await this.encryptPayload([msgPayload, viewId, lastSent]);
        return [time, seq, encryptedPayload];
    }

    async encryptPayload(payload) {
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
    async sendMessage(msg) {
        // SEND: Broadcast a message to all participants.
        if (!this.connected) return; // probably view sending event while connection is closing
        if (this.viewOnly) return;
        if (DEBUG.sends) console.log(this.id, `sending SEND ${msg.asState()}`);
        this.lastSent = Date.now();
        const encryptedMsg = await this.encryptMessage(msg, this.viewId, this.lastSent); // [time, seq, payload]
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
    async sendTagged(msg, tags) {
        // reflector SEND protocol now allows for an additional tags property.  previous
        // reflector versions will handle as a standard SEND.
        if (!this.connected) return; // probably view sending event while connection is closing
        if (this.viewOnly) return;
        if (DEBUG.sends) console.log(this.id, `sending tagged SEND ${msg.asState()} with tags ${JSON.stringify(tags)}`);
        this.lastSent = Date.now();
        const encryptedMsg = await this.encryptMessage(msg, this.viewId, this.lastSent); // [time, seq, payload]
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'SEND',
            args: [...encryptedMsg, this.latency],
            tags
        }));
    }

    /** send a TUTTI Message
     * @param {Message} msg
     * @returns {Promise} tally or null
    */
    async sendTutti(time, tuttiSeq, data, firstMessage=null, wantsVote=true, tallyTarget=null) {
        // TUTTI: Send a message that multiple instances are expected to send identically.
        // The reflector will optionally broadcast the first received message immediately,
        // then gather all messages up to a deadline and send a TALLY message summarising the results
        // (whatever those results, if wantsVote is true; otherwise, only if there is some variation among them).
        if (!this.connected) return null; // probably view sending event while connection is closing
        if (this.viewOnly) return null;
        const payload = stableStringify(data); // stable, to rule out platform differences
        if (DEBUG.sends) console.log(this.id, `sending TUTTI ${payload} ${firstMessage && firstMessage.asState()} ${tallyTarget}`);
        this.lastSent = Date.now();
        const encryptedMsg = firstMessage && await this.encryptMessage(firstMessage, this.viewId, this.lastSent); // [time, seq, payload]
        this.connection.send(JSON.stringify({
            id: this.id,
            action: 'TUTTI',
            args: [time, tuttiSeq, payload, encryptedMsg, wantsVote, tallyTarget],
        }));
        // will resolve to tally
        return new Promise(resolve => {
            if (this.tuttiHistory.length > 100) this.tuttiHistory.shift();
            this.tuttiHistory.push({ tuttiSeq, payload, resolve })
        });
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
        const tps = ["number", "string"].includes(typeof options.tps) ? options.tps
            : ["number", "string"].includes(typeof this.islandCreator.tps) ? this.islandCreator.tps
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
            let weHaveTime = true;
            const nothingToDo = this.networkQueue.length + this.island.messages.size === 0;
            if (nothingToDo) {
                // only advance time, do not accumulate any cpuTime
                weHaveTime = this.island.advanceTo(this.time, deadline);
            } else {
                // perform simulation accumulating cpuTime
                const simStart = Stats.begin("simulate");
                // simulate all received external messages
                while (weHaveTime) {
                    const msgData = this.networkQueue[0];
                    if (!msgData) break;
                    // finish simulating internal messages up to message time
                    // (otherwise, external messages could end up in the future queue,
                    // making snapshots non-deterministic)
                    weHaveTime = this.island.advanceTo(msgData[0], deadline);
                    if (!weHaveTime) break;
                    // Remove message from the network queue
                    this.networkQueue.shift();
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
            }
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
        this.extrapolatedTimeBase = Date.now() - time;
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


// Socket Connection

/** send PULSEs using this interval until hearing back from server */
const KEEP_ALIVE_INTERVAL = 100;
/** if we haven't sent anything to the reflector for this long, send a PULSE to reassure it */
const PULSE_TIMEOUT = 20000;
/** warn about unsent outgoing bytes after this many ms */
const UNSENT_TIMEOUT = 500;
/** increase reconnect timeout exponentially up to this many ms */
const RECONNECT_TIMEOUT_MAX = 30000;


class Connection {
    constructor(controller) {
        this.controller = controller;
        this.connectBlocked = false;
        this.connectRestricted = false;
        this.connectHasBeenCalled = false;
        this.reconnectTimeout = 0;
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

    // this used to be async, but now just resolves this.connectionPromise once connected
    connectToReflector() {
        this.connectHasBeenCalled = true;
        this.connectBlocked = false;
        this.connectRestricted = false;

        let reflectorUrl = DEBUG.reflector ? DEV_DEFAULT_REFLECTOR : DEFAULT_REFLECTOR;
        let region = "";
        if (urlOptions.reflector) {
            if (urlOptions.reflector.match(/^[-a-z0-9]+$/i)) region = `?${urlOptions.reflector}`;
            else reflectorUrl = urlOptions.reflector;
        }
        if (!reflectorUrl.match(/^wss?:/)) throw Error('Cannot interpret reflector address ' + reflectorUrl);
        if (!reflectorUrl.endsWith('/')) reflectorUrl += '/';

        const socket = new WebSocket(`${reflectorUrl}${this.controller.id}${region}`);
        socket.onopen = _event => {
            this.socket = socket;
            if (DEBUG.session) console.log(this.id, this.socket.constructor.name, "connected to", this.socket.url);
            this.reconnectTimeout = 0;
            Stats.connected(true);
            // normally JOIN is sent in establishSession but when rejoining, the controller still is in the session
            if (this.controller.island) {
                if (DEBUG.session) console.log(this.id, "reconnected, trying to seamlessly rejoin")
                this.controller.join();
            }
            this.resolveConnection(null); // the value itself isn't currently used
            if (DEBUG.session) console.log(this.id, "resolved connection promise")
        };
        socket.onmessage = event => {
            this.receive(event.data);
        },
        socket.onerror = _event => {
            if (DEBUG.session) console.log(this.id, socket.constructor.name, "connection error");
        };
        socket.onclose = event => {
            // event codes from 4100 and up mean a disconnection from which the client
            // shouldn't automatically try to reconnect
            // e.g., 4100 is for out-of-date reflector protocol
            const autoReconnect = event.code !== 1000 && event.code < 4100;
            const dormant = event.code === 4110;
            // don't display error if going dormant or normal close or reconnecting
            if (!dormant && event.code !== 1000 && !this.reconnectTimeout) {
                // but also wait 300 ms to see if reconnect succeeded
                setTimeout(() => {
                    if (this.connected) return; // yay - connected again
                    // leave it there for 1 hour if unrecoverable
                    displayError(`Connection closed: ${event.code} ${event.reason}`, { duration: autoReconnect ? undefined : 3600000 });
                }, 300);
            }
            if (DEBUG.session) console.log(this.id, socket.constructor.name, "closed with code:", event.code, event.reason);
            Stats.connected(false);
            if (dormant) this.connectRestricted = true; // only reconnect on session step
            else this.connectBlocked = true; // only reconnect using connectToReflector
            this.disconnected();
            if (autoReconnect) {
                if (DEBUG.session) console.log(this.id, `reconnecting in ${this.reconnectTimeout} ms`);
                window.setTimeout(() => this.connectToReflector(), this.reconnectTimeout);
                // we start reconnecting immediately once (0ms) and then back off exponentially
                // also randomly to avoid hitting the dispatchers at the same time
                this.reconnectTimeout = Math.min(RECONNECT_TIMEOUT_MAX, Math.round((this.reconnectTimeout + 100) * (1 + Math.random())));
            }
        };
    }

    // socket was disconnected, destroy the island
    disconnected() {
        if (!this.socket) return;
        this.socket = null;
        this.lastReceived = 0;
        this.lastSent = 0;
        this.connectHasBeenCalled = false;
        this.setUpConnectionPromise();
        // only leave if necessary, otherwise we try to seamlessly rejoin
        if (this.controller.shouldLeaveWhenDisconnected) this.controller.leave();
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
        if (DEBUG.session) console.log(this.id, "dormant; disconnecting from reflector");
        this.socket.close(4110, 'Going dormant');
    }

    closeConnectionWithError(caller, error, code=4000) {
        console.error(error);
        console.warn('closing socket');
        this.socket.close(code, 'Error in ' + caller);
        // closing with error code < 4100 will try to reconnect
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
