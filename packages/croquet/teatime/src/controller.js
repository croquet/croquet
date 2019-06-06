import "@croquet/util/deduplicate";
import AsyncQueue from "@croquet/util/asyncQueue";
import Stats from "@croquet/util/stats";
import hotreloadEventManger from "@croquet/util/hotreloadEventManager";
import urlOptions from "@croquet/util/urlOptions";
import { login, getUser } from "@croquet/util/user";
import { displaySpinner } from "@croquet/util/html";
import { baseUrl, hashNameAndCode, hashString, uploadCode } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import Island, { Message } from "./island";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


/** @typedef { import('./model').default } Model */


// when reflector has a new feature, we increment this value
// only newer clients get to use it
const VERSION = 1;


let codeHashes = null;

const DEBUG = {
    messages: urlOptions.has("debug", "messages", false),               // received messages
    sends: urlOptions.has("debug", "sends", false),                     // sent messages
    ticks: urlOptions.has("debug", "ticks", false),                     // received ticks
    pong: urlOptions.has("debug", "pong", false),                       // received PONGs
    snapshot: urlOptions.has("debug", "snapshot", false),               // snapshotting, uploading etc
    initsnapshot: urlOptions.has("debug", "initsnapshot", "localhost"), // check snapshotting after init
};

const NOCHEAT = urlOptions.nocheat;

const OPTIONS_FROM_URL = [ 'tps' ];

// schedule a snapshot after this amount of CPU time has been used for simulation
const SNAPSHOT_EVERY = 5000;

// backlog threshold in ms to publish "synced(true|false)" event (to start/stop rendering)
const SYNCED_MIN = 100;
const SYNCED_MAX = 1000;

const Controllers = {};
const SessionCallbacks = {};

/** answer true if seqA comes before seqB */
function inSequence(seqA, seqB) {
    const seqDelta = (seqB - seqA) >>> 0; // make unsigned
    return seqDelta < 0x8000000;
}


export default class Controller {
    static connectToReflector(mainModuleID, reflectorUrl) {
        if (!urlOptions.noupload) uploadCode(mainModuleID).then(hashes => codeHashes = hashes);
        connectToReflector(reflectorUrl);
    }

    // socket was connected, join session for all islands
    static join(controller) {
        Controllers[controller.id] = controller;
        this.withSocketDo(socket => controller.join(socket));
    }

    static withSocketDo(callback) {
        if (TheSocket) callback(TheSocket);
        else TheSocketWaitList.push(callback);
    }

    static setSocket(socket) {
        if (TheSocket) throw Error("TheSocket already set?");
        TheSocket = socket;
        while (TheSocketWaitList.length > 0) {
            const callback = TheSocketWaitList.shift();
            callback(socket);
        }
    }

    // socket was disconnected, destroy all islands
    static leaveAll(preserveSnapshot) {
        if (!TheSocket) return;
        TheSocket = null;
        for (const controller of Object.values(Controllers)) {
            controller.leave(preserveSnapshot);
        }
    }

    // dispatch to right controller
    static receive(data) {
        const { id, action, args } = JSON.parse(data);
        if (id) {
            try { if (Controllers[id]) Controllers[id].receive(action, args); }
            catch (e) { this.closeConnectionWithError('receive', e); }
        } else switch (action) {
            case 'SESSION': SessionCallbacks[args.hash](args.id);
                break;
            case 'PONG': if (DEBUG.pong) console.log('PONG after', Date.now() - args, 'ms');
                break;
            default: console.warn('Unknown action', action);
        }
    }

    static closeConnectionWithError(caller, error) {
        console.error(error);
        console.warn('closing socket');
        TheSocket.close(4000, 'Error in ' + caller);
        // closing with error code will force reconnect
    }

    static uploadOnPageClose() {
        for (const controller of Object.values(Controllers)) {
            controller.uploadOnPageClose();
        }
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
        /** the human-readable session (e.g. "room/user/random") */
        this.session = '';
        /** the number of concurrent users in our island */
        this.users = 0;
        /** wallclock time we last received from reflector */
        this.lastReceived = Date.now();
        /** wallclock time we last sent a message to reflector */
        this.lastSent = Date.now();
        /** old snapshots */
        this.snapshots = [];
        /** external messages already scheduled in the island */
        this.oldMessages = [];
        /** CPU time spent simulating since last snapshot */
        this.cpuTime = 0;
        /** @type {Boolean} backlog was below SYNCED_MIN */
        this.synced = null; // indicates never synced before
        /** latency statistics */
        this.statistics = {
            /** for identifying our own messages */
            id: Math.floor(Math.random() * 0x100000000),
            /** for identifying each message we sent */
            seq: 0,
            /** time when message was sent */
            sent: {},
        };
        /** last measured latency in ms */
        this.latency = 0;
    }

    /**
     * Join or create a session by connecting to the reflector
     * - the island/session id is created from the session name (found in the URL)
     *   and a hash of all source code that is imported by that file
     * - if no session name is in the URL, a random session is created
     *
     * @param {String} room - A (human-readable) name for the room
     * @param {{moduleID:String, init:Function}} creator - The moduleID and function creating the island
     *
     * @returns {Promise<{modelName:Model}>} list of named models (as returned by init function)
     */
    async establishSession(room, creator) {
        await login();
        const { optionsFromUrl, multiRoom } = creator;
        const options = {...creator.options};
        for (const key of [...OPTIONS_FROM_URL, ...optionsFromUrl||[]]) {
            if (key in urlOptions) options[key] = urlOptions[key];
        }
        // session is either "user/random" or "room/user/random" (for multi-room)
        const session = urlOptions.getSession().split('/');
        let user = multiRoom ? session[1] : session[0];
        let random = multiRoom ? session[2] : session[1];
        const newSession = !user || !random;
        if (newSession) {
            // incomplete session: create a new session id
            if (!user) user = getUser("name", "").toLowerCase() || "GUEST";
            if (!random) {
                random = '';
                for (let i = 0; i < 10; i++) random += '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.random() * 36|0];
            }
        }
        this.session = multiRoom ? `${room}/${user}/${random}` : `${user}/${random}`;
        if (!multiRoom) urlOptions.setSession(this.session, newSession);   // multiRoom handles this elsewhere
        // the island id (name) is "room/user/random?opt=val&opt=val"
        let name = `${room}/${user}/${random}`;
        if (user === 'DEMO') this.viewOnly = getUser("demoViewOnly", true);
        // include options in name & hash
        if (Object.keys(options).length) {
            name += '?' + Object.entries(options).map(([k,v])=>`${k}=${v}`).join('&');
        }
        const hash = await hashNameAndCode(name);
        const id = await this.sessionIDFor(hash);
        console.log(`Session ID for ${name}: ${id}`);
        this.islandCreator = { name, ...creator, options, hash };
        if (!this.islandCreator.snapshot) {
            this.islandCreator.snapshot = { id, time: 0, meta: { created: (new Date()).toISOString() } };
        }
        if (this.islandCreator.snapshot.id !== id) console.warn(`Resuming snapshot on different code base!`);
        const island = await new Promise(resolve => {
            this.islandCreator.callbackFn = resolve;
            Controller.join(this);   // when socket is ready, join server
        });
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
        const keep = this.snapshots[0].externalSeq;
        const keepIndex = this.oldMessages.findIndex(msg => msg[1] > keep);
        if (DEBUG.snapshot && keepIndex > 0) console.log(`Deleting old messages from ${this.oldMessages[0][1]} to ${this.oldMessages[keepIndex - 1][1]}`);
        this.oldMessages.splice(0, keepIndex);
        return Stats.end("snapshot") - start;
    }

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
            this.socket.send(JSON.stringify({
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

    // we sent a snapshot hash to the reflector, it elected us to upload
    async uploadSnapshotAndSendToReflector(time, seq, hash) {
        const snapshot = this.findSnapshot(time, seq, hash);
        const last = this.lastSnapshot.meta;
        if (snapshot !== this.lastSnapshot) {
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

    // upload snapshot and message history, and inform reflector
    async uploadLatest(sendToReflector=true) {
        const snapshotUrl = await this.uploadSnapshot(this.lastSnapshot);
        if (!snapshotUrl) { console.error("Failed to upload snapshot"); return; }
        const last = this.lastSnapshot.meta;
        if (sendToReflector) this.sendSnapshotToReflector(last.time, last.seq, last.hash, snapshotUrl);
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

    sendSnapshotToReflector(time, seq, hash, url) {
        if (DEBUG.snapshot) console.log(this.id, `Controller updating ${this.snapshotUrl('latest')})`);
        this.uploadJSON(this.snapshotUrl('latest'), JSON.stringify({time, seq, hash, url}));
        if (DEBUG.snapshot) console.log(this.id, `Controller sending snapshot url to reflector (time: ${time}, seq: ${seq}, hash: ${hash}): ${url}`);
        try {
            this.socket.send(JSON.stringify({
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
            return response.json();
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

    /** @type String: this controller's island id */
    get id() { return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    /** Ask reflector for a session
     * @param {String} hash - hashed island name, options, and code base
     */
    async sessionIDFor(hash) {
        return new Promise(resolve => {
            SessionCallbacks[hash] = sessionId => {
                delete SessionCallbacks[hash];
                resolve(sessionId);
            };
            console.log(hash, 'Controller asking reflector for session ID');
            Controller.withSocketDo(socket => {
                socket.send(JSON.stringify({
                    id: hash,
                    action: 'SESSION'
                }));
            });
        });
    }

    /** Ask reflector for a new session. Everyone will be kicked out and rejoin, including us. */
    requestNewSession() {
        const { hash } = this.islandCreator;
        if (SessionCallbacks[hash]) return;
        SessionCallbacks[hash] = newSession => console.log(this.id, 'new session:', newSession);
        Controller.withSocketDo(socket => {
            socket.send(JSON.stringify({
                id: hash,
                action: 'SESSION',
                args: { new: true },
            }));
        });
    }

    checkMetaMessage(msgData) {
        if (Message.hasReceiverAndSelector(msgData, this.id, "scheduledSnapshot")) {
            // some client has scheduled a snapshot, so reset our own estimate
            // now, even before we actually execute that message
            if (DEBUG.snapshot) console.log(this.id, `Controller resetting CPU time (was ${this.cpuTime|0} ms) because snapshot was scheduled for ${msgData[0]}#${msgData[1]}`);
            this.cpuTime = 0;
        }
    }

    // handle messages from reflector
    async receive(action, args) {
        this.lastReceived = LastReceived;
        switch (action) {
            case 'START': {
                // We are starting a new island session.
                console.log(this.id, 'Controller received START');
                // we may have a snapshot from hot reload or reconnect
                let snapshot = this.islandCreator.snapshot;
                const local = snapshot.modelsById && {
                    time: snapshot.meta.time,
                    seq: snapshot.meta.seq,
                    snapshot,
                };
                // see if there is a remote snapshot
                let latest = await this.fetchJSON(this.snapshotUrl('latest'));
                // which one's newer?
                if (!latest || (local && local.time > latest.time)) latest = local;
                // fetch snapshot
                if (latest) {
                    console.log(this.id, `fetching latest snapshot ${latest.snapshot ? '(embedded)' :  latest.url}`);
                    snapshot = latest.snapshot ||await this.fetchJSON(latest.url);
                } else snapshot = null;
                if (!this.socket) { console.log(this.id, 'socket went away during START'); return; }
                if (snapshot) this.islandCreator.snapshot = snapshot;
                this.install();
                this.requestTicks();
                this.keepSnapshot(snapshot);
                if (latest && latest.url) this.sendSnapshotToReflector(latest.time, latest.seq, latest.hash, latest.url);
                else this.uploadLatest(true); // upload initial snapshot
                return;
            }
            case 'SYNC': {
                // We are joining an island session.
                const {messages, url, time} = args;
                console.log(this.id, `Controller received SYNC: time ${time}, ${messages.length} messages, ${url}`);
                const snapshot = await this.fetchJSON(url);
                this.islandCreator.snapshot = snapshot;  // set snapshot
                if (!this.socket) { console.log(this.id, 'socket went away during SYNC'); return; }
                for (const msg of messages) {
                    if (DEBUG.messages) console.log(this.id, 'Controller got message in SYNC ' + msg);
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
                if (DEBUG.messages) console.log(this.id, 'Controller received RECV ' + args);
                const msg = args;   // [time, seq, payload, senderId, senderSeq]
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
                if (serve) this.uploadSnapshotAndSendToReflector(time, seq, hash);
                else this.compareHash(time, seq, hash);
                return;
            }
            case 'USERS': {
                // a user joined or left this island
                console.log(this.id, 'Controller received USERS', args);
                this.users = args;
                return;
            }
            case 'LEAVE': {
                // the server wants us to leave this session and rejoin
                console.log(this.id, 'Controller received LEAVE', args);
                this.leave(false);
                return;
            }
            default: console.warn("Unknown action:", action, args);
        }
    }

    install(messagesSinceSnapshot=[], syncTime=0) {
        const {snapshot, init, options, callbackFn} = this.islandCreator;
        let newIsland = new Island(snapshot, () => init(options));
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
        if (messagesSinceSnapshot.length > 0) {
            if  (DEBUG.messages) console.log(this.id, `Controller scheduling ${messagesSinceSnapshot.length} messages after snapshot`, messagesSinceSnapshot);
            for (const msg of messagesSinceSnapshot) newIsland.scheduleExternalMessage(msg);
        }
        // drain message queue
        const nextSeq = (newIsland.externalSeq + 1) >>> 0;
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
        this.setIsland(newIsland); // install island
        callbackFn(this.island);
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

    async join(socket) {
        console.log(this.id, 'Controller sending JOIN');
        this.socket = socket;
        const args = { name: this.islandCreator.name, version: VERSION };
        const user = getUser("name");
        if (user) args.user = user;
        socket.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args,
        }));
    }

    leave(preserveSnapshot) {
        if (this.socket.readyState === WebSocket.OPEN) {
            console.log(this.id, `Controller LEAVING session for ${this.islandCreator.name}`);
            this.socket.send(JSON.stringify({ id: this.id, action: 'LEAVING' }));
        }
        delete Controllers[this.id];
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
        if (!this.socket) return;  // probably view sending event while connection is closing
        if (this.socket.readyState !== WebSocket.OPEN) return;
        if (this.viewOnly) return;
        if (DEBUG.sends) console.log(this.id, `Controller sending SEND ${msg.asState()}`);
        this.lastSent = Date.now();
        this.statistics.sent[++this.statistics.seq] = this.lastSent;
        this.socket.send(JSON.stringify({
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
        const tick = 1000 / Math.max(1, rate);     // minimum 1 tick per second
        const multiplier = Math.max(1, mult);      // default multiplier is 1 (no local ticks)
        if (multiplier > 1 && !NOCHEAT) this.tickMultiplier = { tick, multiplier };
        return { tick, multiplier };
    }

    /** request ticks from the server */
    requestTicks(args = {}) {
        if (!this.socket || !this.island) return;
        const { tick, multiplier } = this.getTickAndMultiplier();
        const delay = tick * (multiplier - 1) / multiplier;
        if (delay) { args.delay = delay; args.tick = tick; }
        else if (!args.tick) args.tick = tick;
        if (!args.time) {
            // ignored by reflector unless this is sent right after START
            args.time = Math.max(this.island.time, this.island.externalTime);
            args.seq = this.island.externalSeq;
        }
        console.log(this.id, 'Controller requesting TICKS', args);
        // args: {time, tick, delay, scale}
        try {
            this.socket.send(JSON.stringify({
                id: this.id,
                action: 'TICKS',
                args,
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
    }

    /** how many ms the simulation is lagging behind the last tick from the reflector */
    get backlog() { return this.island ? this.time - this.island.time : 0; }

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
                this.island.publishFromView(this.id, "synced", this.synced);
            }
            if (weHaveTime && this.cpuTime > SNAPSHOT_EVERY) { this.cpuTime = 0; this.scheduleSnapshot(); }
            return weHaveTime;
        } catch (e) {
            Controller.closeConnectionWithError('simulate', e);
            return "error";
        }
    }

    /** execute something in the view realm */
    inViewRealm(fn) {
        return inViewRealm(this.island, () => fn(this.island));
    }

    /** call this from main loop to process queued model=>view events */
    processModelViewEvents() {
        if (this.island) {
            this.island.processModelViewEvents();
        }
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


// Socket

let TheSocket = null;
const TheSocketWaitList = [];
let LastReceived = 0;

/** start sending PINGs to server after not receiving anything for this timeout */
const PING_TIMEOUT = 100;
/** send PINGs using this interval until hearing back from server */
const PING_INTERVAL = 100;

function PING() {
    if (!TheSocket || TheSocket.readyState !== WebSocket.OPEN) return;
    if (TheSocket.bufferedAmount) console.log(`Reflector connection stalled: ${TheSocket.bufferedAmount} bytes unsent`);
    else TheSocket.send(JSON.stringify({ action: 'PING', args: Date.now()}));
}

// one reason for having this is to prevent the connection from going idle,
// which caused some router/computer combinations to buffer packets instead
// of delivering them immediately (observed on AT&T Fiber + Mac)
hotreloadEventManger.setInterval(() => {
    if (Date.now() - LastReceived < PING_TIMEOUT) return;
    PING();
}, PING_INTERVAL);

async function startReflectorInBrowser() {
    document.getElementById("error").innerText = 'No Connection';
    console.log("Starting in-browser reflector");
    // we defer starting the server until hotreload has finished
    // loading all new modules
    await hotreloadEventManger.waitTimeout(0);
    // The following import runs the exact same code that's
    // executing on Node normally. It imports 'ws' which now
    // comes from our own fakeWS.js
    // ESLint doesn't know about the alias in package.json:
    // eslint-disable-next-line global-require
    require("@croquet/reflector"); // start up local server
    // we could return require("@croquet/reflector").server._url
    // to connect to our server.
    // However, we want to discover servers in other tabs
    // so we use the magic port 0 to connect to that.
    return 'channel://server:0/';
}

function newInBrowserSocket(server) {
    // eslint-disable-next-line global-require
    const Socket = require("@croquet/reflector").Socket;
    return new Socket({ server });
}

async function connectToReflector(reflectorUrl) {
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
            Controller.setSocket(socket);
            Stats.connected(true);
            hotreloadEventManger.setTimeout(PING, 0);
        },
        onerror: _event => {
            document.getElementById("error").innerText = 'Connection error';
            console.log(socket.constructor.name, "error");
        },
        onclose: event => {
            document.getElementById("error").innerText = 'Connection closed:' + event.code + ' ' + event.reason;
            console.log(socket.constructor.name, "closed:", event.code, event.reason);
            Stats.connected(false);
            Controller.leaveAll(true);
            if (event.code !== 1000) {
                // if abnormal close, try to connect again
                document.getElementById("error").innerText = 'Reconnecting ...';
                hotreloadEventManger.setTimeout(() => connectToReflector(reflectorUrl), 1000);
            }
        },
        onmessage: event => {
            LastReceived = Date.now();
            Controller.receive(event.data);
        }
    });
    hotreloadEventManger.addDisposeHandler("socket", () => socket.readyState !== WebSocket.CLOSED && socket.close(1000, "hotreload "+moduleVersion));
}
