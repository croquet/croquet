import AsyncQueue from "@croquet/util/asyncQueue";
import Stats from "@croquet/util/stats";
import hotreload from "@croquet/util/hotreload";
import urlOptions from "@croquet/util/urlOptions";
import { baseUrl, hashNameAndCode } from "@croquet/util/modules";
import { inViewRealm } from "./realms";
import Island, { addMessageTranscoder } from "./island";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


const DEBUG = {
    messages: urlOptions.has("debug", "messages", false),
    ticks: urlOptions.has("debug", "ticks", false),
    pong: urlOptions.has("debug", "pong", false),
    snapshot: urlOptions.has("debug", "snapshot", "localhost"),
};

const OPTIONS_FROM_URL = [ 'session', 'user', 'tps' ];

const Controllers = {};

export default class Controller {
    static addMessageTranscoder(...args) { addMessageTranscoder(...args); }
    static connectToReflector(...args) { connectToReflector(...args); }


    // socket was connected, join session for all islands
    static join(controller) {
        Controllers[controller.id] = controller;
        if (TheSocket) controller.join(TheSocket);
    }

    static joinAll(socket) {
        if (TheSocket) throw Error("TheSocket already set?");
        TheSocket = socket;
        for (const controller of Object.values(Controllers)) {
            if (!controller.socket) controller.join(socket);
        }
    }

    // socket was disconnected, destroy all islands
    static leaveAll() {
        if (!TheSocket) return;
        TheSocket = null;
        for (const controller of Object.values(Controllers)) {
            controller.leave();
        }
    }

    // dispatch to right controller
    static receive(data) {
        const { id, action, args } = JSON.parse(data);
        if (id) {
            try { Controllers[id].receive(action, args); }
            catch (e) { this.closeConnectionWithError('receive', e); }
        } else switch (action) {
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

    /**
     * Generate an ID from a name and file versions.
     *
     * Two participants running the same code will generate the same ID
     * for the same name.
     * @param {String} name a name for the room.
     * @returns {String} ID
     */
    static versionIDFor(name) {
        return hashNameAndCode(name);
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
        /** the number of concurrent users in our island */
        this.users = 0;
        /** wallclock time we last heard from reflector */
        this.lastReceived = Date.now();
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
        const { moduleID, optionsFromUrl } = creator;
        const options = {...creator.options};
        for (const key of [...OPTIONS_FROM_URL, ...optionsFromUrl||[]]) {
            if (key in urlOptions) options[key] = urlOptions[key];
        }
        // include options in name & hash
        if (Object.keys(options).length) {
            name += '?' + Object.entries(options).map(([k,v])=>`${k}=${v}`).join('&');
        }
        const id = await Controller.versionIDFor(name, moduleID);
        console.log(`ID for ${name}: ${id}`);
        this.islandCreator = { name, ...creator, options };
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

    takeSnapshot() {
        return this.island.snapshot();
    }

    snapshotUrl() {
        // name includes JSON options
        const options = this.islandCreator.name.split(/[^A-Z0-9]+/i);
        const snapshotName = `${options.filter(_=>_).join('-')}-${this.id}`;
        const base = baseUrl('snapshots');
        return `${base}${snapshotName}.json`;
    }

    /** upload a snapshot to the asset server */
    async uploadSnapshot(hashes) {
        if (!this.island) return false;
        if (this.lastSnapshotTime === this.island.time) return false;
        this.lastSnapshotTime = this.island.time;
        // take snapshot
        const snapshot = this.takeSnapshot();
        snapshot.meta = {
            ...this.islandCreator.snapshot.meta,
            room: this.islandCreator.room,
            options: this.islandCreator.options,
            date: (new Date()).toISOString(),
            host: window.location.hostname,
        };
        if (hashes) snapshot.meta.code = hashes;
        const string = JSON.stringify(snapshot);
        const url = this.snapshotUrl();
        console.log(this.id, `Controller uploading snapshot (${string.length} bytes) to ${url}`);
        try {
            await fetch(url, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/json" },
                body: string,
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    async fetchSnapshot() {
        const url = this.snapshotUrl();
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

    /** @type String: this controller's island id */
    get id() {return this.island ? this.island.id : this.islandCreator.snapshot.id; }

    // handle messages from reflector
    async receive(action, args) {
        this.lastReceived = LastReceived;
        switch (action) {
            case 'START': {
                // We are starting a new island session.
                console.log(this.id, 'Controller received START - creating island');
                this.install(false);
                this.requestTicks();
                break;
            }
            case 'SYNC': {
                // We are joining an island session.
                this.islandCreator.snapshot = args;    // set snapshot
                console.log(this.id, 'Controller received SYNC - resuming snapshot');
                this.install(true);
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
                break;
            }
            case 'SERVE': {
                if (!this.island) { console.log("SERVE received but no island"); break; } // can't serve if we don't have an island
                if (this.backlog > 1000) { console.log("SERVE received but backlog", this.backlog); break; } // don't serve if we're not up-to-date
                // We received a request to serve a current snapshot
                console.log(this.id, 'Controller received SERVE - replying with snapshot');
                const snapshot = this.takeSnapshot();
                // send the snapshot
                this.socket.send(JSON.stringify({
                    action: args, // reply action
                    args: snapshot,
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
            default: console.warn("Unknown action:", action, args);
        }
    }

    async install(drainQueue=false) {
        const {snapshot, creatorFn, options, callbackFn} = this.islandCreator;
        let newIsland = new Island(snapshot, () => creatorFn(options));
        if (DEBUG.snapshot && !snapshot.models) {
            // exercise save & load if we came from init
            newIsland = new Island(JSON.parse(JSON.stringify(newIsland.snapshot())), () => creatorFn(options));
        }
        const snapshotTime = newIsland.time;
        this.time = snapshotTime;
        // eslint-disable-next-line no-constant-condition
        while (drainQueue) {
            // eslint-disable-next-line no-await-in-loop
            const nextMsg = await this.networkQueue.next();
            if (nextMsg[0] > snapshotTime) {
                // This is the first 'real' message arriving.
                newIsland.processExternalMessage(nextMsg);
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
        if (this.fetchUpdatedSnapshot) await this.updateSnapshot();
        console.log(this.id, 'Controller sending JOIN');
        this.socket = socket;
        const name = this.islandCreator.name;
        socket.send(JSON.stringify({
            id: this.id,
            action: 'JOIN',
            args: {name},
        }));
    }

    leave() {
        const island = this.island;
        this.reset();
        if (!this.islandCreator) throw Error("do not discard islandCreator!");
        const {destroyerFn} = this.islandCreator;
        if (destroyerFn) {
            const snapshot = island && island.snapshot();
            destroyerFn(snapshot);
        }
    }

    /** send a Message to all island replicas via reflector
     * @param {Message} msg
    */
    sendMessage(msg) {
        // SEND: Broadcast a message to all participants.
        if (!this.socket) return;  // probably view sending event while connection is closing
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

    /** parse tps "target tick rate:local ticks"
     *
     * default taken from `islandCreator.tps` unless `islandCreator.options.tps`` is present
     *
     * @returns {{tick: Number, local: Number}}
     *          reflector tick period in ms and number of local ticks per reflector tick
     */
    getTickAndLocal() {
        const options = this.islandCreator.options;
        const tps = options.tps ? options.tps
            : this.islandCreator.tps ? this.islandCreator.tps
            : 20;
        const [rate, local] = (tps + ":").split(':').map(n => Number(n));
        const reflectorRate = rate / (local + 1);
        const tick = 1000 / reflectorRate;
        return { tick, local };
    }

    /** request ticks from the server */
    requestTicks(args = {}) {
        if (!this.socket || !this.island) return;
        const { tick, local } = this.getTickAndLocal();
        const delay = tick * local / (local + 1);
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
            Stats.begin("simulate");
            let weHaveTime = true;
            while (weHaveTime) {
                // Get the next message from the (concurrent) network queue
                const msgData = this.networkQueue.nextNonBlocking();
                if (!msgData) break;
                // have the island decode and schedule that message
                const msg = this.island.processExternalMessage(msgData);
                // simulate up to that message
                weHaveTime = this.island.advanceTo(msg.time, deadline);
            }
            if (weHaveTime) weHaveTime = this.island.advanceTo(this.time, deadline);
            Stats.end("simulate");
            Stats.backlog(this.backlog);
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

    /** Got the official time from reflector server */
    timeFromReflector(time, isLocalTick) {
        this.time = time;
        if (this.island) Stats.backlog(this.backlog);
        if (isLocalTick) return;
        if (this.localTicker) window.clearInterval(this.localTicker);
        const { tick, local } = this.getTickAndLocal();
        if (tick && local) {
            const ms = tick / (local + 1);
            let n = 1;
            this.localTicker = hotreload.setInterval(() => {
                this.timeFromReflector(time + n * ms, "local");
                if (DEBUG.ticks) console.log(this.id, 'Controller generate TICK ' + this.time, n);
                if (++n > local) window.clearInterval(this.localTicker);
            }, ms);
        }
}
}


// Socket

let TheSocket = null;
let LastReceived = 0;

/** start sending PINGs to server after not receiving anything for this timeout */
const PING_TIMEOUT = 500;
/** send PINGs using this interval until hearing back from server */
const PING_INTERVAL = 1000 / 5;

function PING() {
    if (!TheSocket || TheSocket.readyState !== WebSocket.OPEN) return;
    TheSocket.send(JSON.stringify({ action: 'PING', args: Date.now()}));
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
            Controller.joinAll(socket);
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
            Controller.leaveAll();
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
