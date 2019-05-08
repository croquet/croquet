import AsyncQueue from "@croquet/util/asyncQueue";
import Stats from "@croquet/util/stats";
import hotreload from "@croquet/util/hotreload";
import urlOptions from "@croquet/util/urlOptions";
import { baseUrl, hashNameAndCode, uploadCode, croquetDev, hashString } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import Island from "./island";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

let codeHashes = null;

const DEBUG = {
    messages: urlOptions.has("debug", "messages", false),
    ticks: urlOptions.has("debug", "ticks", false),
    pong: urlOptions.has("debug", "pong", false),
    snapshot: urlOptions.has("debug", "snapshot", "localhost"),
    consistency: urlOptions.has("debug", "consistency", false),
};

const NOCHEAT = urlOptions.nocheat;

const OPTIONS_FROM_URL = [ 'session', 'user', 'tps' ];

// schedule a snapshot after this amount of CPU time has been used for simulation
const SNAPSHOT_EVERY = 5000;

const Controllers = {};
const SessionCallbacks = {};

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
            try { Controllers[id].receive(action, args); }
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
        /** sequence number of last message received from reflector */
        this.sequence = 0;
        /** the number of concurrent users in our island */
        this.users = 0;
        /** wallclock time we last heard from reflector */
        this.lastReceived = Date.now();
        /** old snapshots */
        this.snapshots = [];
        /** external messages already scheduled in the island */
        this.oldMessages = [];
        /** CPU time spent simulating since last snapshot */
        this.cpuTime = 0;
    }

    /**
     * Create a new Island by requesting to join the reflector
     *
     * Detail: the island/session id is created from fileName and a hash of
     *         all source code that is imported by that file
     *
     * TODO: convert callback to promise
     * @param {String} name A (human-readable) name for the room
     * @param {{moduleID:String, creatorFn:Function}} creator The moduleID and function creating the island
     * @param {{}} snapshot The island's initial state (if hot-reloading)
     * @returns {Promise<Island>}
     */
    async createIsland(name, creator) {
        const { optionsFromUrl } = creator;
        const options = {...creator.options};
        for (const key of [...OPTIONS_FROM_URL, ...optionsFromUrl||[]]) {
            if (key in urlOptions) options[key] = urlOptions[key];
        }
        // include options in name & hash
        if (Object.keys(options).length) {
            name += '?' + Object.entries(options).map(([k,v])=>`${k}=${v}`).join('&');
        }
        const hash = await hashNameAndCode(name);
        const id = await this.sessionIDFor(hash);
        console.log(`ID for ${name}: ${id}`);
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
        Stats.begin("snapshot");
        if (!snapshot) snapshot = this.island.snapshot();
        // keep history
        this.snapshots.push(snapshot);
        // limit storage for old snapshots
        while (this.snapshots.length > 2) this.snapshots.shift();
        // keep only messages newer than the oldest snapshot
        const keep = this.snapshots[0].time;
        const keepIndex = this.oldMessages.findIndex(msg => msg[0] >= keep);
        this.oldMessages.splice(0, keepIndex);
        Stats.end("snapshot");
    }

    takeSnapshot() {
        if (!this.island) return null;
        // ensure all messages up to this point are in the snapshot
        for (let msg = this.networkQueue.nextNonBlocking(); msg; msg = this.networkQueue.nextNonBlocking()) {
           this.island.scheduleExternalMessage(msg);
        }
        return this.island.snapshot();
    }

    // we have spent a certain amount of CPU time on simulating, schedule a snapshot
    scheduleSnapshot() {
        // round up to next ms to make URLs shorter
        const time = Math.ceil(this.island.time + 0.0000001);
        this.island.scheduleSnapshot(time - this.island.time);
    }

    scheduledSnapshot() {
        this.keepSnapshot();
        // for now, just upload every snapshot - later, reflector will tell us when we should upload
        this.uploadLatest();
    }

    snapshotUrl(suffix) {
        // name includes JSON options
        const options = this.islandCreator.name.split(/[^A-Z0-9]+/i);
        const snapshotName = `${options.filter(_=>_).join('-')}-${this.id}_${suffix}`;
        const base = baseUrl('snapshots');
        return `${base}${snapshotName}.json`;
    }

    /** upload a snapshot to the asset server */
    async uploadSnapshot(snapshot) {
        snapshot.meta = {
            ...this.islandCreator.snapshot.meta,
            room: this.islandCreator.room,
            options: this.islandCreator.options,
            date: (new Date()).toISOString(),
            host: window.location.hostname,
        };
        if (codeHashes) snapshot.meta.code = codeHashes;
        const body = JSON.stringify(snapshot);
        const url = this.snapshotUrl(`${snapshot.time}-snap`);
        console.log(this.id, `Controller uploading snapshot (${body.length} bytes) to ${url}`);
        try {
            await fetch(url, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body,
            });
            return url;
        } catch (e) {
            return false;
        }
    }

    // upload snapshot and message history
    async uploadLatest() {
        const snapshotUrl = await this.uploadSnapshot(this.lastSnapshot);
        if (!snapshotUrl) { console.error("Failed to upload snapshot"); return; }
        if (!this.prevSnapshot) return;
        const lastTime = this.lastSnapshot.time;
        const prevTime = this.prevSnapshot.time;
        const prevIndex = this.oldMessages.findIndex(msg => msg[0] >= prevTime);
        const lastIndex = this.oldMessages.findIndex(msg => msg[0] >= lastTime);
        const messages = {
            start: this.snapshotUrl(`${prevTime}-snap`),
            end: snapshotUrl,
            time: [prevTime, lastTime],
            messages: this.oldMessages.slice(prevIndex, lastIndex),
        };
        const messagesUrl = this.snapshotUrl(`${prevTime}-msgs`);

        const body = JSON.stringify(messages);
        console.log(this.id, `Controller uploading latest messages (${body.length} bytes) to ${messagesUrl}`);
        try {
            await fetch(messagesUrl, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body,
            });
        } catch (e) { /*ignore */ }
    }

    /*
    async fetchSnapshot(time) {
        const url = this.snapshotUrl(time);
        const response = await fetch(url, {
            mode: "cors",
        });
        return response.json();
    }

    async updateSnapshot() {
        // try to fetch latest snapshot
        try {
            const snapshot = await this.fetchSnapshot();
            if (snapshot.id !== this.id) {
                console.warn(this.id ,'fetched snapshot of different version!');
                snapshot.originalID = snapshot.id;
                snapshot.id = this.id;
            }
            if (snapshot.time >= this.islandCreator.snapshot.time) {
                this.islandCreator.snapshot = snapshot;
                console.log(this.id, `Controller fetched snapshot (time: ${Math.floor(snapshot.time)})`);
            } else {
                console.log(this.id, "Controller fetched snapshot but older than local" +
                    ` (remote: ${snapshot.time}, local: ${this.islandCreator.snapshot.time})`);
            }
        } catch (e) {
            console.log(this.id, 'Controller got no snapshot');
        }
    }
    */

    /** the latest snapshot of this island */
    get lastSnapshot() { return this.snapshots[this.snapshots.length - 1]; }

    /** the snapshot before latest snapshot */
    get prevSnapshot() { return this.snapshots[this.snapshots.length - 2]; }

    /** @type String: this controller's island id */
    get id() { return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    async sessionIDFor(islandID) {
        return new Promise(resolve => {
            SessionCallbacks[islandID] = sessionId => {
                delete SessionCallbacks[islandID];
                resolve(sessionId);
            };
            Controller.withSocketDo(socket => {
                socket.send(JSON.stringify({
                    id: islandID,
                    action: 'SESSION'
                }));
            });
        });
    }

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

    // handle messages from reflector
    async receive(action, args) {
        this.lastReceived = LastReceived;
        switch (action) {
            case 'START': {
                // We are starting a new island session.
                console.log(this.id, 'Controller received START - creating island');
                await this.install(false);
                this.requestTicks();
                this.keepSnapshot();
                this.uploadLatest(); // upload initial snapshot
                break;
            }
            case 'SYNC': {
                // We are joining an island session.
                const snapshot = JSON.parse(args);
                if (DEBUG.consistency) console.log(`Received snapshot hash: ${await hashString(args)}`);
                if (DEBUG.consistency) console.log(`Parsed snapshot hash: ${await hashString(JSON.stringify(snapshot))}`);
                this.islandCreator.snapshot = snapshot;    // set snapshot
                console.log(this.id, 'Controller received SYNC - resuming snapshot');
                await this.install(true, async islandBeforeDrain => {
                    if (DEBUG.consistency) {
                        const restoredStateSnapshot = islandBeforeDrain.snapshot();
                        const restoredStateSnapshotHash = await hashString(JSON.stringify(restoredStateSnapshot));
                        console.log(`Restored state snapshot hash: ${restoredStateSnapshotHash}`);
                    }
                });
                this.getTickAndMultiplier();
                this.keepSnapshot(args);
                break;
            }
            case 'RECV': {
                // We received a message from reflector.
                // Put it in the queue, and set time.
                // Actual processing happens in main loop.
                if (DEBUG.messages) console.log(this.id, 'Controller received RECV ' + args);
                const msg = args;   // [time, seq, payload]
                const time = msg[0];
                const seq = msg[1];
                this.sequence = (this.sequence ? this.sequence + 1 : seq) & 0xFFFFFFFF;
                if (this.sequence !== seq) throw Error(`Out of sequence message from reflector (expected ${this.sequence} got ${seq})`);
                msg[1] = seq * 2 + 1;  // make odd sequence from controller
                //if (msg.sender === this.senderID) this.addToStatistics(msg);
                this.networkQueue.put(msg);
                this.timeFromReflector(time);
                break;
            }
            case 'TICK': {
                // We received a tick from reflector.
                // Just set time so main loop knows how far it can advance.
                if (!this.island) break; // ignore ticks before we are simulating
                const time = args;
                if (DEBUG.ticks) console.log(this.id, 'Controller received TICK ' + time);
                this.timeFromReflector(time);
                if (this.tickMultiplier) this.multiplyTick(time);
                break;
            }
            case 'SERVE': {
                if (!this.island) { console.log("SERVE received but no island"); break; } // can't serve if we don't have an island
                if (this.backlog > 1000) { console.log("SERVE received but backlog", this.backlog); break; } // don't serve if we're not up-to-date
                // We received a request to serve a current snapshot
                console.log(this.id, 'Controller received SERVE - replying with snapshot');
                const snapshot = this.takeSnapshot();
                const snapshotString = JSON.stringify(snapshot);
                if (DEBUG.consistency) console.log(this.id, `Snapshot hash in SERVE: ${await hashString(snapshotString)}`);
                // send the snapshot
                this.socket.send(JSON.stringify({
                    action: args, // reply action
                    args: snapshotString,
                }));
                // and send a dummy message so that the other guy can drop
                // old messages in their controller.install()
                this.island.sendNoop();
                break;
            }
            case 'USERS': {
                // a user joined or left this island
                console.log(this.id, 'Controller received USERS', args);
                this.users = args;
                break;
            }
            case 'LEAVE': {
                // the server wants us to leave this session and rejoin
                console.log(this.id, 'Controller received LEAVE', args);
                this.leave(false);
                break;
            }
            default: console.warn("Unknown action:", action, args);
        }
    }

    async install(drainQueue=false, beforeDrainCallback) {
        const {snapshot, creatorFn, options, callbackFn} = this.islandCreator;
        let newIsland = new Island(snapshot, () => creatorFn(options));
        if (DEBUG.snapshot && !snapshot.modelsById) {
            // exercise save & load if we came from init
            const initialIslandSnap = JSON.stringify(newIsland.snapshot());
            newIsland = new Island(JSON.parse(initialIslandSnap), () => creatorFn(options));
            const restoredIslandSnap = JSON.stringify(newIsland.snapshot());
            const hashes = [(await hashString(initialIslandSnap)), (await hashString(restoredIslandSnap))];
            if (hashes[0] !== hashes[1]) {
                throw new Error("Initial save/load cycle hash inconsistency!");
            }
        }
        const snapshotTime = Math.max(newIsland.time, newIsland.externalTime);
        this.time = snapshotTime;
        if (beforeDrainCallback) {
            await beforeDrainCallback(newIsland);
        }
        while (drainQueue) {
            // eslint-disable-next-line no-await-in-loop
            const nextMsg = await this.networkQueue.next();
            if (nextMsg[0] > snapshotTime) {
                // This is the first 'real' message arriving.
                newIsland.scheduleExternalMessage(nextMsg);
                drainQueue = false;
            }
            // otherwise, silently skip the message
        }
        this.setIsland(newIsland); // install island
        callbackFn(this.island);
    }

    setIsland(island) {
        this.island = island;
        this.island.controller = this;
    }

    // create an island in its initial state
    createCleanIsland() {
        const { options, creatorFn } = this.islandCreator;
        const snapshot = { id: this.id };
        return new Island(snapshot, () => creatorFn(options));
    }

    // network queue

    async join(socket) {
        console.log(this.id, 'Controller sending JOIN');
        this.socket = socket;
        const args = { name: this.islandCreator.name };
        const user = urlOptions.user || croquetDev("user");
        if (user) args.user = user;
        socket.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args,
        }));
    }

    leave(preserveSnapshot) {
        delete Controllers[this.id];
        const {destroyerFn} = this.islandCreator;
        const snapshot = preserveSnapshot && destroyerFn && this.takeSnapshot();
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
        if (DEBUG.messages) console.log(this.id, `Controller sending SEND ${msg.asState()}`);
        try {
            this.socket.send(JSON.stringify({
                id: this.id,
                action: 'SEND',
                args: msg.asState(),
            }));
        } catch (e) {
            console.error('ERROR while sending', e);
        }
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
        if (!args.time) args.time = this.island.time;    // ignored by reflector unless this is sent right after START
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
            Stats.backlog(this.backlog);
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
        if (time < this.time) { console.warn(`time is ${this.time}, ignoring time ${time} from ${src}`); return; }
        this.time = time;
        if (this.island) Stats.backlog(this.backlog);
    }

    /** we received a tick from reflector, generate local ticks */
    multiplyTick(time) {
        if (this.localTicker) window.clearInterval(this.localTicker);
        const { tick, multiplier } = this.tickMultiplier;
        const ms = tick / multiplier;
        let n = 1;
        this.localTicker = hotreload.setInterval(() => {
            this.timeFromReflector(time + n * ms, "controller");
            if (DEBUG.ticks) console.log(this.id, 'Controller generate TICK ' + this.time, n);
            if (++n >= multiplier) { window.clearInterval(this.localTicker); this.localTicker = 0; }
        }, ms);
    }
}


// Socket

let TheSocket = null;
const TheSocketWaitList = [];
let LastReceived = 0;

/** start sending PINGs to server after not receiving anything for this timeout */
const PING_TIMEOUT = 500;
/** send PINGs using this interval until hearing back from server */
const PING_INTERVAL = 1000 / 5;

function PING() {
    if (!TheSocket || TheSocket.readyState !== WebSocket.OPEN) return;
    if (TheSocket.bufferedAmount) console.log(`Stalled: ${TheSocket.bufferedAmount} bytes unsent`);
    else TheSocket.send(JSON.stringify({ action: 'PING', args: Date.now()}));
}

// one reason for having this is to prevent the connection from going idle,
// which caused some router/computer combinations to buffer packets instead
// of delivering them immediately (observed on AT&T Fiber + Mac)
hotreload.setInterval(() => {
    if (Date.now() - LastReceived < PING_TIMEOUT) return;
    PING();
}, PING_INTERVAL);

async function startReflectorInBrowser() {
    document.getElementById("error").innerText = 'No Connection';
    console.log("Starting in-browser reflector");
    // we defer starting the server until hotreload has finished
    // loading all new modules
    await hotreload.waitTimeout(0);
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
            hotreload.setTimeout(PING, 0);
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
                hotreload.setTimeout(() => connectToReflector(reflectorUrl), 1000);
            }
        },
        onmessage: event => {
            LastReceived = Date.now();
            Controller.receive(event.data);
        }
    });
    hotreload.addDisposeHandler("socket", () => socket.readyState !== WebSocket.CLOSED && socket.close(1000, "hotreload "+moduleVersion));
}
