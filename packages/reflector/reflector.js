// when running on node, 'ws' is the actual web socket module
// when running in browser, 'ws' is our own './ws.js'
// (in-browser mode is not supported right now)

const os = require('os');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const prometheus = require('prom-client');
const { Storage } = require('@google-cloud/storage');

// do not show pre 1.0 warning if these strings appear in session name or url
const SPECIAL_CUSTOMERS = [
    "queue",
    "mathgenie",
];

// debugging (should read env vars)
const collectRawSocketStats = false;
const debugLogs = true;

// collect metrics in Prometheus format
const prometheusConnectionGauge = new prometheus.Gauge({
    name: 'reflector_connections',
    help: 'The number of client connections to the reflector.'
});
const prometheusSessionGauge = new prometheus.Gauge({
    name: 'reflector_sessions',
    help: 'The number of concurrent sessions on reflector.'
});
const prometheusMessagesCounter = new prometheus.Counter({
    name: 'reflector_messages',
    help: 'The number of messages received.'
});
const prometheusTicksCounter = new prometheus.Counter({
    name: 'reflector_ticks',
    help: 'The number of ticks generated.'
});
prometheus.collectDefaultMetrics(); // default metrics like process start time, heap usage etc

const PORT = 9090;
const VERSION = "v1";
const SERVER_HEADER = `croquet-reflector-${VERSION}`;
const DELETION_DEBOUNCE = 10000; // time in ms to wait before deleting an island
const TICK_MS = 1000 / 5;     // default tick interval
const INITIAL_SEQ = 0xFFFFFFF0; // initial sequence number, must match island.js
const ARTIFICIAL_DELAY = 0;   // delay messages randomly by 50% to 150% of this
const MAX_MESSAGES = 10000;   // messages per island to retain since last snapshot
const REQU_SNAPSHOT = 6000;   // request a snapshot if this many messages retained
const MIN_SCALE = 1 / 64;     // minimum ratio of island time to wallclock time
const MAX_SCALE = 64;         // maximum ratio of island time to wallclock time
const TALLY_INTERVAL = 1000;  // maximum time to wait to tally TUTTI contributions
const MAX_TALLY_AGE = 60000;  // don't start a new tally if vote is more than this far behind
const MAX_COMPLETED_TALLIES = 20; // maximum number of past tallies to remember
const USERS_INTERVAL = 200;   // time to gather user entries/exits before sending a "users" message (a.k.a. view-join)

const HOSTNAME = os.hostname();
const HOSTIP = Object.values(os.networkInterfaces()).flat().filter(addr => !addr.internal && addr.family === 'IPv4')[0].address;
// if running locally, there is the option to run with or without using the session-
// related storage (for snapshots, dispatcher records etc).
// if "localWithStorage" is chosen, the reflector itself will create a dummy dispatcher
// record the first time it sees a session, and will delete it when the session is
// offloaded.
const LOCAL_CONFIG = "localWithStorage"; // or "local" to run without storage dependency
const CLUSTER = fs.existsSync("/var/run/secrets/kubernetes.io") ? process.env.CLUSTER_NAME : LOCAL_CONFIG;
const CLUSTER_LABEL = process.env.CLUSTER_LABEL || CLUSTER;
const CLUSTER_IS_LOCAL = CLUSTER.startsWith("local");
const IS_DEV = CLUSTER_IS_LOCAL || HOSTNAME.includes("-dev-");

if (!CLUSTER) {
    // should have been injected to container via config map
    console.error("FATAL: no CLUSTER_NAME env var");
    process.exit(1);
}

const DISCONNECT_UNRESPONSIVE_CLIENTS = CLUSTER_IS_LOCAL;
const CHECK_INTERVAL = 5000;        // how often to checkForActivity
const PING_INTERVAL = 5000;         // while inactive, send pings at this rate
const SNAP_TIMEOUT = 30000;         // if no SNAP received after waiting this number of ms, disconnect
const PING_THRESHOLD = 35000;       // if a pre-background-aware client is not heard from for this long, start pinging
const DISCONNECT_THRESHOLD = 60000; // if not responding for this long, disconnect
const DISPATCH_RECORD_RETENTION = 5000; // how long we must wait to delete a dispatch record (set on the bucket)
const LATE_DISPATCH_DELAY = 1000;  // how long to allow for clients arriving from the dispatcher even though the session has been unregistered

function logtime() {
    if (CLUSTER_IS_LOCAL) return "";
    const d = new Date();
    const dd = new Date(d - d.getTimezoneOffset() * 60 * 1000);
    return dd.toISOString().replace(/.*T/, "").replace("Z", " ");
}
function LOG( ...args) { console.log(`${logtime()}Reflector-${VERSION}(${CLUSTER}:${HOSTIP}):`, ...args); }
function WARN(...args) { console.warn(`${logtime()}Reflector-${VERSION}(${CLUSTER}:${HOSTIP}):`, ...args); }
function ERROR(...args) { console.error(`${logtime()}Reflector-${VERSION}(${CLUSTER}:${HOSTIP}):`, ...args); }
function DEBUG(...args) { if (debugLogs) LOG(...args); }
function LOCAL_DEBUG(...args) { if (debugLogs && CLUSTER_IS_LOCAL) LOG(...args); }


const ARGS = {
    NO_STORAGE: "--storage=none",
    APPS_ONLY: "--storage=persist",
    STANDALONE: "--standalone",
};

for (const arg of process.argv.slice(2)) {
    if (!Object.values(ARGS).includes(arg)) {
        console.error(`Error: Unrecognized option ${arg}`);
        process.exit(1);
    }
}

const NO_STORAGE = CLUSTER === "local" || process.argv.includes(ARGS.NO_STORAGE); // no bucket access
const NO_DISPATCHER = NO_STORAGE || process.argv.includes(ARGS.STANDALONE); // no session deregistration
const APPS_ONLY = !NO_STORAGE && process.argv.includes(ARGS.APPS_ONLY); // no session resume
const STORE_SESSION = !NO_STORAGE && !APPS_ONLY;
const STORE_MESSAGE_LOGS = !NO_STORAGE && !APPS_ONLY;
const STORE_PERSISTENT_DATA = !NO_STORAGE;

// we use Google Cloud Storage for session state
const storage = new Storage();
const SESSION_BUCKET = NO_STORAGE ? null : storage.bucket('croquet-sessions-v1');
const DISPATCHER_BUCKET = NO_DISPATCHER ? null : storage.bucket('croquet-reflectors-v1');

// return codes for closing connection
// client wil try to reconnect for codes < 4100
const REASON = {};
REASON.UNKNOWN_ISLAND = [4000, "unknown island"];
REASON.UNRESPONSIVE = [4001, "client unresponsive"];
REASON.INACTIVE = [4002, "client inactive"];
REASON.RECONNECT = [4003, "please reconnect"];  // also used in cloudflare reflector
// non-reconnect codes
REASON.BAD_PROTOCOL = [4100, "outdated protocol"];
REASON.BAD_APPID = [4101, "bad appId"];
REASON.MALFORMED_MESSAGE = [4102, "malformed message"];
REASON.BAD_APIKEY = [4103, "bad apiKey"];
REASON.UNKNOWN_ERROR = [4109, "unknown error"];
REASON.DORMANT = [4110, "dormant"]; // sent by client, will not display error
REASON.NO_JOIN = [4121, "client never joined"];

// this webServer is only for http:// requests to the reflector url
// (e.g. the load-balancer's health check),
// not ws:// requests for an actual websocket connection
const webServer = http.createServer( async (req, res) => {
    if (req.url === '/metrics') {
        const body = await prometheus.register.metrics();
        res.writeHead(200, {
            'Server': SERVER_HEADER,
            'Content-Length': body.length,
            'Content-Type': prometheus.register.contentType,
        });
        return res.end(body);
    }
    if (req.url === '/sessions') {
        const body = [...ALL_ISLANDS.values()].map(({id, clients, appId, name}) => `${id} ${clients.size} ${appId || name}\n`).join('');
        res.writeHead(200, {
            'Server': SERVER_HEADER,
            'Content-Length': body.length,
            'Content-Type': 'text/plain',
        });
        return res.end(body);
    }
    if (req.url.includes('/users/')) {
        const id = req.url.replace(/.*\//, '');
        const island = ALL_ISLANDS.get(id);
        const users = (island ? [...island.clients] : []).map(client => client.user);
        const body = JSON.stringify(users);
        res.writeHead(200, {
            'Server': SERVER_HEADER,
            'Content-Length': body.length,
            'Content-Type': 'text/json',
        });
        return res.end(body);
    }
    // we don't log any of the above or health checks
    const is_health_check = req.url.endsWith('/healthz');
    if (!is_health_check) LOG(`GET ${req.url} ${JSON.stringify(req.headers)}`);
    // otherwise, show host and cluster
    const body = `Croquet reflector-${VERSION} ${HOSTIP} ${CLUSTER_LABEL}\n\nAh, ha, ha, ha, stayin' alive!`;
    res.writeHead(200, {
      "Server": SERVER_HEADER,
      "Content-Length": body.length,
      "Content-Type": "text/plain",
      "X-Powered-By": "Croquet",
      "X-Croquet-0": ":             .'\\   /`.             ",
      "X-Croquet-1": ":           .'.-.`-'.-.`.           ",
      "X-Croquet-2": ":      ..._:   .-. .-.   :_...      ",
      "X-Croquet-3": ":    .'    '-.(o ) (o ).-'    `.    ",
      "X-Croquet-4": ":   :  _    _ _`~(_)~`_ _    _  :   ",
      "X-Croquet-5": ":  :  /:   ' .-=_   _=-. `   ;\\  :  ",
      "X-Croquet-6": ":  :   :|-.._  '     `  _..-|:   :  ",
      "X-Croquet-7": ":   :   `:| |`:-:-.-:-:'| |:'   :   ",
      "X-Croquet-8": ":    `.   `.| | | | | | |.'   .'    ",
      "X-Croquet-9": ":      `.   `-:_| | |_:-'   .'      ",
      "X-Croquet-A": ":   jgs  `-._   ````    _.-'        ",
      "X-Croquet-B": ":            ``-------''            ",
      "X-Hiring": "Seems like you enjoy poking around in http headers. You might have even more fun working with us. Let us know via jobs@croquet.io!",
      "X-Hacker-Girls": "Unite!",
    });
    return res.end(body);
  });

webServer.on('upgrade', (req, socket, _head) => {
    const { sessionId } = parseUrl(req);
    const clientAddr = `${socket.remoteAddress.replace(/^::ffff:/, '')}:${socket.remotePort}`;
    if (sessionId) {
        const session = ALL_SESSIONS.get(sessionId);
        if (session && session.stage === 'closed') {
            // a request to delete the dispatcher record has already been sent.  reject this connection, forcing the client to ask the dispatchers again.
            LOG(`${sessionId}/${clientAddr} rejecting connection on upgrade; session has been unregistered`);
            socket.end('HTTP/1.1 404 Session Closed\r\n');
            return;
        }
    }
    LOG(`${sessionId}/${clientAddr} upgrading connection for ${req.url}`);
});

// the WebSocket.Server will intercept the UPGRADE request made by a ws:// websocket connection
const server = new WebSocket.Server({ server: webServer });

function startServer() {
    webServer.listen(PORT);
    LOG(`starting ${server.constructor.name} ws://${HOSTNAME}:${PORT}/`);
}

const STATS_TO_AVG = ["RECV", "SEND", "TICK", "IN", "OUT"];
const STATS_TO_MAX = ["USERS", "BUFFER"];
const STATS_KEYS = [...STATS_TO_MAX, ...STATS_TO_AVG];
const STATS = {
    time: Date.now(),
};
for (const key of STATS_KEYS) STATS[key] = 0;


function watchStats() {
    setInterval(showStats, 10000);

    function showStats() {
        const time = Date.now();
        const delta = time - STATS.time;
        STATS.time = time;
        STATS.USERS = Math.max(STATS.USERS, server.clients.size);
        const out = [];
        let sum = 0;
        for (const key of STATS_TO_MAX) {
            out.push(`${key}: ${STATS[key]}`);
            sum += STATS[key];
        }
        for (const key of STATS_TO_AVG) {
            out.push(`${key}/s: ${Math.round(STATS[key] * 1000 / delta)}`);
            sum += STATS[key];
        }
        if (sum === 0) return;
        LOG(out.join(', '));
        for (const key of STATS_KEYS) STATS[key] = 0;
    }
}

// Begin reading from stdin so the process does not exit (see https://nodejs.org/api/process.html)
process.stdin.resume();

let aborted = false;
function handleTerm() {
    if (!aborted) {
        aborted = true;
        const promises = [];
        // if some island is waiting for its dispatcher record to be deletable,
        // we need to wait it out here too.
        for (const [id, session] of ALL_SESSIONS.entries()) {
            const { timeout, earliestUnregister } = session;
            if (timeout) clearTimeout(timeout); // we're in charge now
            const now = Date.now();
            const wait = now >= earliestUnregister
                ? Promise.resolve()
                : new Promise(resolve => setTimeout(resolve, earliestUnregister - now));
            const island = ALL_ISLANDS.get(id);
            const cleanup = wait.then(() => island
                ? deleteIsland(island)
                : unregisterSession(id, "emergency shutdown without island")
                );
            promises.push(cleanup);
        }
        if (promises.length) {
            DEBUG(`\nEMERGENCY SHUTDOWN OF ${promises.length} ISLAND(S)`);
            Promise.allSettled(promises).then(() => process.exit());
        } else process.exit();
    }
}
process.on('SIGINT', handleTerm);
process.on('SIGTERM', handleTerm);
process.on('uncaughtException', err => {
    ERROR("Uncaught", err);
    handleTerm();
});
process.on('unhandledRejection', (reason, promise) => {
    WARN("Unhandled Rejection", reason, promise);
    // TODO: call handleTerm();
    // (not terminating yet, need to see what rejections we do not handle first)
});

// start server
startServer();
if (CLUSTER_IS_LOCAL) watchStats();

/**
 * @typedef ID - A random 128 bit hex ID
 * @type string
 */

/**
 * @typedef Client - A WebSocket subclass
 * @type {object}
 * @property {number} readyState - WebSocket state
 * @property {function} send - send data
 * @property {string} addr - identifies the remote socket
 */

/**
 * @typedef IslandData
 * @type {object}
 * @property {number} time - the island's time
 * @property {Set<Client>} clients - the clients currently using this island
 */

/** @type {Map<ID,IslandData>} */
const ALL_ISLANDS = new Map();

/**
 * @typedef SessionData
 * @type {object}
 * @property {string} stage - "runnable", "running", "closable", "closed"
 * @property {number} earliestUnregister - estimate of Date.now() when dispatcher record can be removed
 * @property {number} timeout - ID of system timeout in "runnable" or "closable" stages, to go ahead and close if no client joins
 */

/** @type {Map<ID,SessionData>} */
const ALL_SESSIONS = new Map();

/** Get current time for island
 * @param {IslandData} island
 */
function getTime(island, _reason) {
    const now = Date.now();
    const delta = now - island.before;     // might be < 0 if system clock went backwards
    if (delta > 0) {
        // tick requests usually come late; sometimes tens of ms late.  keep track of such overruns, and whenever there is a net lag inject a small addition to the delta (before scaling) to help the island catch up.
        const desiredTick = island.tick; // can be fractional ms
        let advance = delta; // default
        if (delta > desiredTick / 2) { // don't interfere with rapid-fire message-driven requests
            const over = delta - desiredTick;
            if (over > 0) {
                advance = desiredTick; // lower limit, subject to possible adjustment below
                if (over < 100) island.lag += Math.ceil(over); // don't try to cater for very large delays (e.g., at startup)
            }
            if (island.lag > 0) {
                const boost = 4; // seems to be about the smallest that will rein things in
                advance += boost;
                island.lag -= boost;
            }
        }
        island.time += Math.round(island.scale * advance);
        island.before = now;
        //LOCAL_DEBUG(`${island.id} getTime(${_reason}) => ${island.time}`);
    }
    return island.time;
}

function nonSavableProps() {
    return {
        lag: 0,              // aggregate ms lag in tick requests
        apiKey: '',          // mandatory since 1.0
        clients: new Set(),  // connected web sockets
        usersJoined: [],     // the users who joined since last report
        usersLeft: [],       // the users who left since last report
        usersTimer: null,    // timeout for sending USERS message
        leaveDelay: 0,       // delay in ms before leave event is generated
        dormantDelay: 0,     // delay in s until a hidden client will go dormant
        heraldUrl: '',       // announce join/leave events
        ticker: null,        // interval for serving TICKs
        before: 0,           // last getTime() call
        yetToCheckLatest: true, // flag used while fetching latest.json during startup
        storedUrl: null,     // url of snapshot in latest.json (null before we've checked latest.json)
        storedSeq: INITIAL_SEQ, // seq of last message in latest.json message addendum
        startClient: null,   // the client we sent START
        startTimeout: null,  // pending START request timeout (should send SNAP)
        deletionTimeout: null, // pending deletion after all clients disconnect
        syncClients: [],     // clients waiting to SYNC
        tallies: {},
        tagRecords: {},
        [Symbol.toPrimitive]: () => "dummy",
        };
}

function savableKeys(island) {
    const nonSavable = nonSavableProps(); // make a new one
    return Object.keys(island).filter(key => !Object.prototype.hasOwnProperty.call(nonSavable, key));
}

/** A new island controller is joining
 * @param {Client} client - we received from this client
 * @param {{name: String, version: Number, appId?: string, persistentId?: string, user: string}} args
 */
function JOIN(client, args) {
    if (typeof args === "number" || !args.version) {
        client.safeClose(...REASON.BAD_PROTOCOL);
        return;
    }
    const id = client.sessionId;
    const session = ALL_SESSIONS.get(id);
    if (!session) {
        // shouldn't normally happen, but perhaps possible due to network delays
        LOG(`${id}/${client.addr} rejecting JOIN; unknown session`);
        client.safeClose(...REASON.RECONNECT);
        return;
    }

    switch (session.stage) {
        case 'closed':
            // a request to delete the dispatcher record has already been
            // sent (but we didn't know that in time to prevent the
            // client from connecting at all).  tell client to ask the
            // dispatchers again.
            LOG(`${id}/${client.addr} rejecting JOIN; session has been unregistered`);
            client.safeClose(...REASON.RECONNECT);
            return;
        case 'runnable':
        case 'closable':
            session.stage = 'running';
            clearTimeout(session.timeout);
            session.timeout = null;
            break;
        default:
    }

    // the connection log filter matches on (" connection " OR " JOIN ")
    LOG(`${id}/${client.addr} receiving JOIN ${JSON.stringify(args)}`);

    const { name, version, apiKey, url, sdk, appId, user, location, heraldUrl, leaveDelay, dormantDelay, tove } = args;
    // islandId deprecated since 0.5.1, but old clients will send it rather than persistentId
    const persistentId = args.persistentId || args.islandId;

    // new clients (>=0.3.3) send ticks in JOIN
    const syncWithoutSnapshot = 'ticks' in args;
    // clients >= 0.5.1 send dormantDelay, which we use as a reason not to send pings to inactive clients
    const noInactivityPings = 'dormantDelay' in args;
    // create island data if this is the first client
    let island = ALL_ISLANDS.get(id);
    if (!island) {
        let timeline = ''; do timeline = Math.random().toString(36).substring(2); while (!timeline);
        island = {
            id,                  // the island id
            name,                // the island name, including options (or could be null)
            version,             // the client version
            time: 0,             // the current simulation time
            seq: INITIAL_SEQ,    // sequence number for messages (uint32, wraps around)
            scale: 1,            // ratio of island time to wallclock time
            tick: TICK_MS,       // default tick rate
            delay: 0,            // hold messages until this many ms after last tick
            snapshotTime: -1,    // time of last snapshot
            snapshotSeq: null,   // seq of last snapshot
            snapshotUrl: '',     // url of last snapshot
            appId,
            islandId: persistentId, // jul 2021: deprecated, but old reflectors will expect it when initialising from latest.json
            persistentId,        // new protocol as of 0.5.1
            persistentUrl: '',   // url of persistent data
            syncWithoutSnapshot, // new protocol as of 0.3.3
            noInactivityPings,   // new protocol as of 0.5.1
            timeline,            // if a stateless reflector resumes the session, this is the only way to tell
            tove,                // an encrypted secret clients use to check if they have the right password
            location,            // send location data?
            messages: [],        // messages since last snapshot
            lastTick: -1000,     // time of last TICK sent (-1000 to avoid initial delay)
            lastMsgTime: 0,      // time of last message reflected
            lastCompletedTally: null, // jul 2021: deprecated, but old reflectors will expect it when initialising from latest.json
            completedTallies: {}, // TUTTI sendTime keyed by tally key (or tuttiSeq, for old clients) for up to MAX_TALLY_AGE in the past.  capped at MAX_COMPLETED_TALLIES entries.
            ...nonSavableProps(),
            [Symbol.toPrimitive]: () => `${name} ${id}`,
            };
        ALL_ISLANDS.set(id, island);
        prometheusSessionGauge.inc();
        if (syncWithoutSnapshot) TICKS(client, args.ticks); // client will not request ticks
    }
    // the following are in the nonSavable list, and can be updated on every JOIN
    island.heraldUrl = heraldUrl || '';
    island.leaveDelay = leaveDelay || 0;
    island.dormantDelay = dormantDelay; // only provided by clients since 0.5.1

    // check API key
    if (!apiKey) {
        // old client: accept for now, but let them know. Unless they're special.
        const specialCustomer = SPECIAL_CUSTOMERS.find(value => url.includes(value) || name.includes(value));
        if (!specialCustomer) INFO(island, {
            code: "MISSING_KEY",
            msg: "Croquet versions before 1.0 will stop being supported soon. Please update your app now! croquet.io/docs/croquet",
            options: { level: "warning", only: "once" }
        }, [client]);
    } else if (apiKey !== island.apiKey) {
        // first client, or joining with different key
        island.apiKey = apiKey;
        // this is a formality – the controller already checks the apiKey before sending join
        // so we assume good intent and do not await result, to not delay SYNC unnecessarily
        verifyApiKeyInBackground(apiKey, url, appId, persistentId, id, sdk, client);
        // will disconnect everyone with error if failed
    }

    client.island = island;

    if (user) {
        client.user = user;
        if (island.location && client.location) {
            if (Array.isArray(user)) user.push(client.location);
            else if (typeof user === "object") user.location = client.location;
        }
    }

    // start broadcasting messages to client
    island.clients.add(client);

    // we need to SYNC
    island.syncClients.push(client);

    // if we have a current snapshot, reply with that
    if (island.snapshotUrl || island.persistentUrl) { SYNC(island); return; }

    // if we haven't yet checked latest.json, look there first
    if (island.yetToCheckLatest) {
        island.yetToCheckLatest = false;
        const fileName = `${id}/latest.json`;
        fetchJSON(fileName)
        .then(latestSpec => {
            if (!latestSpec.snapshotUrl && !latestSpec.syncWithoutSnapshot) throw Error("latest.json has no snapshot, ignoring");
            DEBUG(`${id} resuming from latest.json @${latestSpec.time}#${latestSpec.seq} messages: ${latestSpec.messages.length} snapshot: ${latestSpec.snapshotUrl || "<none>"}`);
            // as we migrate from one style of island properties to another, a
            // latest.json does not necessarily have all the properties a freshly
            // minted island has.
            savableKeys(island).forEach(key => {
                const value = latestSpec[key];
                if (value !== undefined) island[key] = value;
                });

            // migrate from old stored data, if needed
            if (island.lastCompletedTally) island.lastCompletedTally = null;
            if (!island.completedTallies) island.completedTallies = {};

            island.before = Date.now();
            island.storedUrl = latestSpec.snapshotUrl;
            island.storedSeq = latestSpec.seq;
            if (latestSpec.reflectorSession) island.timeline = latestSpec.reflectorSession; // TODO: remove reflectorSession after 0.4.1 release
            if (island.tick) startTicker(island, island.tick);
            if (island.syncClients.length > 0) SYNC(island);
        }).catch(err => {
            if (typeof err !== "object") err = { message: ""+JSON.stringify(err) };
            if (!err.message) err.message = "<empty>";
            if (err.code !== 404) ERROR(`${id} failed to fetch latest.json: ${err.message}`);
            // this is a brand-new session, check if there is persistent data
            const persistName = `apps/${appId}/${persistentId}.json`;
            const persistPromise = appId && persistentId
                ? fetchJSON(persistName).catch(() => { /* ignore */})
                : Promise.resolve(false);
            persistPromise.then(persisted => {
                if (persisted) {
                    island.persistentUrl = persisted.url;
                    DEBUG(`${id} resuming from persisted ${persistName}: ${island.persistentUrl || "<none>"}`);
                }
            }).finally(() => {
                island.storedUrl = ''; // replace the null that means we haven't looked
                START(island);
            });
        });

        return;
    }

    // if we've checked latest.json, and updated storedUrl (but not snapshotUrl,
    // as checked above), this must be a brand new island.  send a START.
    if (island.storedUrl !== null && !island.startTimeout) { START(island); return; }

    // otherwise, nothing to do at this point.  log that this client is waiting
    // for a snapshot either from latest.json or from a STARTed client.
    DEBUG(`${id}/${client.addr} waiting for snapshot`);
}

function START(island) {
    // as of 0.3.3, clients do not want START but SYNC with an empty snapshot
    if (island.syncWithoutSnapshot) { SYNC(island); return; }
    // find next client
    do {
        island.startClient = island.syncClients.shift();
        if (!island.startClient) return; // no client waiting
    } while (island.startClient.readyState !== WebSocket.OPEN);
    const client = island.startClient;
    const msg = JSON.stringify({ id: island.id, action: 'START' });
    client.safeSend(msg);
    DEBUG(`${island.id}/${client.addr} sending START ${msg}`);
    // if the client does not provide a snapshot in time, we need to start over
    if (DISCONNECT_UNRESPONSIVE_CLIENTS) island.startTimeout = setTimeout(() => {
        if (island.startClient !== client) return; // success
        client.safeClose(...REASON.UNRESPONSIVE);
        // the client's on('close') handler will call START again
        }, SNAP_TIMEOUT);
}

function SYNC(island) {
    const { id, seq, timeline, snapshotUrl: url, snapshotTime, snapshotSeq, persistentUrl, messages, tove } = island;
    const time = getTime(island, "SYNC");
    const args = { url, messages, time, seq, tove, reflector: CLUSTER, timeline, reflectorSession: timeline };  // TODO: remove reflectorSession after 0.4.1 release
    if (url) {args.snapshotTime = snapshotTime; args.snapshotSeq = snapshotSeq; }
    else if (persistentUrl) { args.url = persistentUrl; args.persisted = true; }
    const response = JSON.stringify({ id, action: 'SYNC', args });
    const range = !messages.length ? '' : ` (#${messages[0][1]}...${messages[messages.length - 1][1]})`;
    for (const syncClient of island.syncClients) {
        if (syncClient.readyState === WebSocket.OPEN) {
            syncClient.safeSend(response);
            DEBUG(`${id}/${syncClient.addr} sending SYNC @${time}#${seq} ${response.length} bytes, ${messages.length} messages${range}, ${args.persisted ? "persisted" : "snapshot"} ${args.url || "<none>"}`);
            announceUserDidJoin(syncClient);
        } else {
            DEBUG(`${id}/${syncClient.addr} socket closed before SYNC`);
        }
    }
    // synced all that were waiting
    island.syncClients.length = 0;
}

function clientLeft(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island) return;
    island.clients.delete(client);
    if (island.clients.size === 0) provisionallyDeleteIsland(island);
    announceUserDidLeave(client);
}

function announceUserDidJoin(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island || !client.user || client.active === true) return;
    client.active = true;
    const didLeave = island.usersLeft.indexOf(client.user);
    if (didLeave !== -1) island.usersLeft.splice(didLeave, 1);
    else island.usersJoined.push(client.user);
    scheduleUsersMessage(island);
    LOCAL_DEBUG(`${island.id} user ${JSON.stringify(client.user)} joined`);
}

function announceUserDidLeave(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island || !client.user || client.active !== true) return;
    client.active = false;
    const didJoin = island.usersJoined.indexOf(client.user);
    if (didJoin !== -1) island.usersJoined.splice(didJoin, 1);
    else island.usersLeft.push(client.user);
    scheduleUsersMessage(island);
    LOCAL_DEBUG(`${island.id} user ${JSON.stringify(client.user)} left`);
}

function scheduleUsersMessage(island) {
    if (!island.usersTimer) island.usersTimer = setTimeout(() => USERS(island), USERS_INTERVAL);
}

/** answer true if seqB comes after seqA */
function after(seqA, seqB) {
    const seqDelta = (seqB - seqA) >>> 0; // make unsigned
    return seqDelta > 0 && seqDelta < 0x8000000;
}

/** client uploaded a snapshot
 * @param {Client} client - we received from this client
 * @param {{time: Number, seq: Number, hash: String, url: String}} args - the snapshot details
 */
function SNAP(client, args) {
    const id = client.sessionId;
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_ISLAND); return; }

    const { time, seq, hash, url, dissident } = args; // details of the snapshot that has been uploaded

    if (dissident) {
        DEBUG(`${id}/${client.addr} dissident snapshot @${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'} ${JSON.stringify(dissident)}`);
        return;
    }

    // to decide if the announced snapshot deserves to replace the existing one we
    // compare times rather than message seq, since (at least in principle) a new
    // snapshot can be taken after some elapsed time but no additional external messages.
    if (time <= island.snapshotTime) {
        DEBUG(`${id}/${client.addr} ignoring snapshot @${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'}`);
        return;
    }

    DEBUG(`${id}/${client.addr} got snapshot @${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'}`);

    if (island.syncWithoutSnapshot || island.snapshotUrl) {
        // forget older messages, setting aside the ones that need to be stored
        let messagesToStore = [];
        const msgs = island.messages;
        if (msgs.length > 0) {
            const firstToKeep = msgs.findIndex(msg => after(seq, msg[1]));
            if (firstToKeep > 0) {
                DEBUG(id, `forgetting ${firstToKeep} of ${msgs.length} messages #${msgs[0][1] >>> 0} to #${msgs[firstToKeep - 1][1] >>> 0} (keeping #${msgs[firstToKeep][1] >>> 0})`);
                messagesToStore = msgs.splice(0, firstToKeep); // we'll store all those we're forgetting
            } else if (firstToKeep === -1) {
                DEBUG(id, `forgetting all of ${msgs.length} messages (#${msgs[0][1] >>> 0} to #${msgs[msgs.length - 1][1] >>> 0})`);
                messagesToStore = msgs.slice();
                msgs.length = 0;
            } // else if firstToKeep is 0 there's nothing to do
        }

        if (STORE_MESSAGE_LOGS && messagesToStore.length) {
            // upload to the message-log bucket a blob with all messages since the previous snapshot
            const messageLog = {
                start: island.snapshotUrl,  // previous snapshot, if any
                end: url,                   // new snapshot
                time: [island.snapshotTime, time],
                seq: [island.snapshotSeq, seq], // snapshotSeq will be null first time through
                messagesToStore,
            };
            const pad = n => (""+n).padStart(10, '0');
            const firstSeq = messagesToStore[0][1] >>> 0;
            const logName = `${id}/${pad(Math.ceil(time))}_${firstSeq}-${seq}-${hash}.json`;
            DEBUG(id, `uploading ${messagesToStore.length} messages #${firstSeq} to #${seq} as ${logName}`);
            uploadJSON(logName, messageLog).catch(err => ERROR(`${id} failed to upload messages. ${err.code}: ${err.message}`));
        }
    } else if (island.startClient === client) {
        // this is the initial snapshot from the user we sent START
        DEBUG(id, `@${island.time}#${island.seq} init ${time}#${seq} from SNAP`);
        island.time = time;
        island.seq = seq;
        island.before = Date.now();
        announceUserDidJoin(client);
    } else {
        // this is the initial snapshot, but it's an old client (<=0.2.5) that already requested TICKS()
        DEBUG(id, `@${island.time}#${island.seq} not initializing time from snapshot (old client)`);
    }

    // keep snapshot
    island.snapshotTime = time;
    island.snapshotSeq = seq;
    island.snapshotUrl = url;

    // start waiting clients
    if (island.startClient) { clearTimeout(island.startTimeout); island.startTimeout = null; island.startClient = null; }
    if (island.syncClients.length > 0) SYNC(island);
}

/** client uploaded persistent data
 * @param {Client} client - we received from this client
 * @param {{url: String}} args - the persistent data details
 */
function SAVE(client, args) {
    const id = client.sessionId;
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_ISLAND); return; }
    const { appId, persistentId } = island;
    if (!appId || !persistentId) { client.safeClose(...REASON.BAD_APPID); return; }

    // clients since 0.5.1 will send only persistTime in place of time, seq, tuttiSeq
    const { persistTime, time, seq, tuttiSeq, url, dissident } = args; // details of the persistent data that has been uploaded
    const descriptor = persistTime === undefined ? `@${time}#${seq} T${tuttiSeq}` : `@${persistTime}`;

    if (dissident) {
        DEBUG(`${id}/${client.addr} dissident persistent data for ${descriptor} ${url} ${JSON.stringify(dissident)}`);
        return;
    }

    DEBUG(`${id}/${client.addr} got persistent data for @${descriptor} ${url}`);

    // do *not* change our own session's persistentUrl!
    // we only upload this to be used to init the next session of this island
    const saved = { url };
    if (STORE_PERSISTENT_DATA) uploadJSON(`apps/${appId}/${persistentId}.json`, saved).catch(err => ERROR(`${id} failed to record persistent-data upload. ${err.code}: ${err.message}`));
}

/** send a message to all participants after time stamping it
 * @param {Island} island - the island to send to
 * @param {Array<Message>} messages - an array so that DELAYED_SEND can submit a batch of messages
 */
function SEND(island, messages) {
    if (!island) return; // client never joined?!

    if (island.messages.length >= MAX_MESSAGES) {
        REQU(island);
        INFO(island, {
            code: "SNAPSHOT_NEEDED",
            msg: "Cannot buffer more messages. Need snapshot.",
            options: { level: "warning" }
        });
        return;
    }

    if (island.messages.length >= REQU_SNAPSHOT) {
        const headroom = MAX_MESSAGES - island.messages.length;
        const every = Math.max(1, (headroom / 100 | 0) * 10);
        // this will request a snapshot with increasing frequency:
        // 6000,6290,6720,6820,7290,7500,8000,8320,8540,8760,9000,9090,9120,9200,9240,9360,9450,9500,9520,9560,
        // 9600,9630,9660,9690,9720,9740,9760,9780,9800,9810,9820,9830,9840,9850,9860,9870,9880,9890,9900
        // the last 100 times before buffer is full it will be every message
        if (island.messages.length % every === 0) {
            WARN(`${island.id} reached ${island.messages.length} messages, sending REQU`);
            REQU(island);
            // send warnings if safety buffer is less than 25%
            if (headroom < (MAX_MESSAGES - REQU_SNAPSHOT) / 4) INFO(island, {
                code: "SNAPSHOT_NEEDED",
                msg: `Reflector message buffer almost full. Need snapshot ASAP.`,
                options: { level: "warning" }
            });
        }
    }

    const time = getTime(island, "SEND");
    if (island.delay) {
        const delay = island.lastTick + island.delay + 0.1 - time;    // add 0.1 ms to combat rounding errors
        if (island.delayed || delay > 0) { DELAY_SEND(island, delay, messages); return; }
    }
    for (const message of messages) {
        // message = [time, seq, payload, ...] - keep whatever controller.sendMessage sends
        message[0] = time;
        message[1] = island.seq = (island.seq + 1) >>> 0; // seq is always uint32
        const msg = JSON.stringify({ id: island.id, action: 'RECV', args: message });
        LOCAL_DEBUG(`${island.id} broadcasting RECV ${JSON.stringify(message)}`);
        prometheusMessagesCounter.inc();
        STATS.RECV++;
        STATS.SEND += island.clients.size;
        island.clients.forEach(each => each.active && each.safeSend(msg));
        island.messages.push(message); // raw message sent again in SYNC
    }
    island.lastMsgTime = time;
    startTicker(island, island.tick);
}

/** send a message to all participants subject to tag-defined filter policies
 * @param {Island} island - the island to send to
 * @param {Message} message
 * @param {Object} tags
 */
function SEND_TAGGED(island, message, tags) {
    if (!island) return; // client never joined

    // tag pattern example: { debounce: 1000, msgID: "pollForSnapshot" }
    if (tags.debounce) {
        const { msgID } = tags;
        const now = Date.now(); // debounce uses wall-clock time
        const msgRecord = island.tagRecords[msgID];
        if (!msgRecord || (now - msgRecord > tags.debounce)) {
            island.tagRecords[msgID] = now;
        } else {
            DEBUG(island.id, `debounce suppressed: ${JSON.stringify(message)}`);
            return;
        }
    }

    // not suppressed by any recognised pattern, so send as usual
    SEND(island, [message]);
}

/** handle a message that all clients are expected to be sending
 * @param {?Client} client - we received from this client
 * @param {[sendTime: Number, sendSeq: Number, payload: String, firstMsg: Array, wantsVote: Boolean, tallyTarget: Array]} args
 */
function TUTTI(client, args) {
    const id = client.sessionId;
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_ISLAND); return; }

    // clients prior to 0.5.1 send a tutti sequence number in second place; later
    // clients send a dummy sequence number in second place - so that an old reflector's
    // sequence-checking logic will still work - but add a seventh argument that is
    // a tutti key made up of a message topic or placeholder such as "snapshot" or
    // "persist", suffixed with the sendTime.
    // we keep a list of the sendTime and key/seq of completed tallies for up to
    // MAX_TALLY_AGE (currently 60s) since the sendTime.  a vote on a previously
    // unseen key and more than MAX_TALLY_AGE in the past will always be ignored.
    // see cleanUpCompletedTallies() for how we cope if the list accumulates more
    // than MAX_COMPLETED_TALLIES recent entries.
    const [ sendTime, tuttiSeq, payload, firstMsg, wantsVote, tallyTarget, tuttiKey ] = args;

    const keyOrSeq = tuttiKey || tuttiSeq;
    function tallyComplete() {
        const tally = island.tallies[keyOrSeq];
        const { timeout, expecting: missing } = tally;
        clearTimeout(timeout);
        if (missing) DEBUG(`${id} missing ${missing} ${missing === 1 ? "client" : "clients"} from tally ${keyOrSeq}`);
        if (wantsVote || Object.keys(tally.payloads).length > 1) {
            const payloads = { what: 'tally', sendTime, tally: tally.payloads, tallyTarget, missingClients: missing };
            // only include the tuttiSeq if the client didn't provide a tuttiKey
            if (tuttiKey) payloads.tuttiKey = tuttiKey;
            else payloads.tuttiSeq = tuttiSeq;
            const msg = [0, 0, payloads];
            SEND(island, [msg]);
        }
        delete island.tallies[keyOrSeq];
        island.completedTallies[keyOrSeq] = sendTime;
        cleanUpCompletedTallies(island);
    }

    let tally = island.tallies[keyOrSeq];
    if (!tally) { // either first client we've heard from, or one that's missed the party entirely
        const historyLimit = cleanUpCompletedTallies(island); // the limit of how far back we're currently tracking
        if (sendTime < historyLimit) {
            DEBUG(`${id}/${client.addr} rejecting vote for old tally ${keyOrSeq} (${island.time - sendTime}ms)`);
            return;
        }
        if (island.completedTallies[keyOrSeq]) {
            DEBUG(`${id}/${client.addr} rejecting vote for completed tally ${keyOrSeq}`);
            return;
        }

        if (firstMsg) SEND(island, [firstMsg]);

        tally = island.tallies[keyOrSeq] = {
            sendTime,
            expecting: island.clients.size, // we could ignore clients that are not active (i.e., still in the process of joining), but with a TALLY_INTERVAL of 1000ms it's painless to give them all a chance
            payloads: {},
            timeout: setTimeout(tallyComplete, TALLY_INTERVAL)
            };
    }

    tally.payloads[payload] = (tally.payloads[payload] || 0) + 1;
    if (--tally.expecting === 0) tallyComplete();
}

function cleanUpCompletedTallies(island) {
    // in normal use we keep MAX_TALLY_AGE of history.
    // in the [pathological] case of there being too many recent tallies to
    // keep, discard the oldest ones and add a sentinel entry holding the
    // time of the most recent entry that was discarded.  the time on the
    // sentinel thus represents the limit of the history we're keeping.
    const completed = island.completedTallies;
    const now = island.time;
    let historyLimit = Math.max(0, now - MAX_TALLY_AGE + 1);
    const sendTimesToKeep = Object.values(completed).filter(time => time >= historyLimit);
    let newSentinel;
    if (sendTimesToKeep.length > MAX_COMPLETED_TALLIES) {
        sendTimesToKeep.sort((a, b) => b - a); // descending, so most recent come first
        historyLimit = sendTimesToKeep[MAX_COMPLETED_TALLIES - 2]; // leave room for sentinel
        newSentinel = sendTimesToKeep[MAX_COMPLETED_TALLIES - 1];
    }
    Object.keys(completed).forEach(keyOrSeq => {
        if (completed[keyOrSeq] < historyLimit) delete completed[keyOrSeq];
        });
    if (newSentinel) completed['sentinel'] = newSentinel;

    const sentinel = completed['sentinel']; // new or previous
    if (sentinel) historyLimit = sentinel;

    return historyLimit;
}

// delay for the client to generate local ticks
function DELAY_SEND(island, delay, messages) {
    if (!island.delayed) {
        stopTicker(island);
        island.delayed = [];
        setTimeout(() => DELAYED_SEND(island), delay);
        LOCAL_DEBUG(`${island.id} last tick: @${island.lastTick}, delaying for ${delay} ms`);
    }
    island.delayed.push(...messages);
    if (debugLogs) for (const msg of messages) LOCAL_DEBUG(`${island.id} delaying ${JSON.stringify(msg)}`);
}

function DELAYED_SEND(island) {
    const { delayed } = island;
    island.delayed = null;
    SEND(island, delayed);
}

/** SEND a replicated message when clients joined or left
 * @param {IslandData} island
*/
function USERS(island) {
    island.usersTimer = null;
    const { id, clients, usersJoined, usersLeft, heraldUrl } = island;
    if (usersJoined.length + usersLeft.length === 0) return; // someone joined & left
    const activeClients = [...clients].filter(each => each.active); // a client in the set but not active is between JOIN and SYNC
    const active = activeClients.length;
    const total = clients.size;
    const payload = { what: 'users', active, total };
    if (usersJoined.length > 0) payload.joined = [...usersJoined];
    if (usersLeft.length > 0) payload.left = [...usersLeft];
    if (active) {
        // do not trigger a SEND before someone successfully joined
        const msg = [0, 0, payload];
        SEND(island, [msg]);
        DEBUG(id, `Users ${island}: +${usersJoined.length}-${usersLeft.length}=${active}/${total} (total ${ALL_ISLANDS.size} islands, ${server.clients.size} users)`);
    }
    if (heraldUrl) heraldUsers(island, activeClients.map(each => each.user), payload.joined, payload.left);
    usersJoined.length = 0;
    usersLeft.length = 0;
}

/** send back arguments as received */
function PONG(client, args) {
    client.safeSend(JSON.stringify({ action: 'PONG', args }));
}

/** send a TICK message to advance time
 * @param {IslandData} island
 */
function TICK(island) {
    if (island.clients.size === 0) return; // probably in provisional island deletion

    const time = getTime(island, "TICK");
    // const { id, lastMsgTime, tick, scale } = island;
    // if (time - lastMsgTime < tick * scale) return;
    island.lastTick = time;
    const msg = JSON.stringify({ id: island.id, action: 'TICK', args: time });
    prometheusTicksCounter.inc();
    island.clients.forEach(client => {
        // only send ticks if joined and not back-logged
        if (client.active && !client.bufferedAmount) {
            client.safeSend(msg);
            STATS.TICK++;
        }
    });
}

/** send REQU to all clients */
function REQU(island) {
    const msg = JSON.stringify({ id: island.id, action: 'REQU' });
    island.clients.forEach(client => client.safeSend(msg));
}

/** send INFO to all clients */
function INFO(island, args, clients = island.clients) {
    const msg = JSON.stringify({ id: island.id, action: 'INFO', args });
    clients.forEach(client => client.safeSend(msg));
}

/** client is requesting ticks for an island
 * @param {Client} client - we received from this client
 * @param {*} args
 */
function TICKS(client, args) {
    const id = client.sessionId;
    const { tick, delay, scale } = args;
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_ISLAND); return; }
    if (!island.syncWithoutSnapshot && !island.snapshotUrl) {
         // this must be an old client (<=0.2.5) that requests TICKS before sending a snapshot
        const { time, seq } = args;
        DEBUG(`${id}/${client.addr} @${island.time}#${island.seq} init ${time}#${seq} from TICKS (old client)`);
        island.time = typeof time === "number" ? Math.ceil(time) : 0;
        island.seq = typeof seq === "number" ? seq : 0;
        island.before = Date.now();
        announceUserDidJoin(client);
    }
    if (delay > 0) island.delay = delay;
    if (scale > 0) island.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (tick > 0) startTicker(island, tick);
}

function startTicker(island, tick) {
    LOCAL_DEBUG(`${island.id} ${island.ticker ? "restarting" : "started"} ticker: ${tick} ms`);
    if (island.ticker) stopTicker(island);
    island.tick = tick;
    island.ticker = setInterval(() => TICK(island), tick);
}

function stopTicker(island) {
    clearInterval(island.ticker);
    island.ticker = null;
}

async function heraldUsers(island, all, joined, left) {
    const {heraldUrl, id} = island;
    const payload = {time: Date.now(), id, all, joined, left};
    const body = JSON.stringify(payload);
    let success = false;
    try {
        const logdetail = `${payload.time}: +${joined&&joined.length||0}-${left&&left.length||0}=${all.length}`;
        DEBUG(`${id} heralding users ${logdetail} ${body.length} bytes to ${heraldUrl}`);
        const response = await fetch(heraldUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            size: 512, // limit response size
        });
        success = response.ok;
        if (success) DEBUG(`${id} heralding success ${payload.time}: ${response.status} ${response.statusText}`);
        else {
            LOG(`${id} heralding failed ${payload.time}: ${response.status} ${response.statusText}`);
            INFO(island, {
                code: "HERALDING_FAILED",
                msg: `POST ${body.length} bytes to heraldUrl "${heraldUrl}" failed: ${response.status} ${response.statusText}`,
                options: { level: "warning" }
            });
        }
    } catch (err) {
        ERROR(`${id} heralding error ${payload.time}: ${err.message}`);
        if (!success) INFO(island, {
            code: "HERALDING_FAILED",
            msg: `POST ${body.length} bytes to heraldUrl "${heraldUrl}" failed: ${err.message}`,
            options: { level: "error" }
        });
    }
}

// shut down session (presumably because of unrecoverable error)
function disconnectAllAndDeleteIsland(island, reason) {
    for (const client of island.clients) client.safeClose(...reason);
    provisionallyDeleteIsland(island);
}

// impose a delay on island deletion, in case clients are only going away briefly
function provisionallyDeleteIsland(island) {
    const { id } = island;
    const session = ALL_SESSIONS.get(id);
    if (!session) {
        DEBUG(`${id} ignoring deletion of missing session`);
        return;
    }
    if (session.stage !== 'running') {
        DEBUG(`${id} ignoring out-of-sequence deletion (stage=${session.stage})`);
        return;
    }
    session.stage = 'closable';
    // NB: the deletion delay is currently safely longer than the retention on the dispatcher record
    session.timeout = setTimeout(() => deleteIsland(island), DELETION_DEBOUNCE);
}

// delete our live record of the island, rewriting latest.json if necessary and
// removing the dispatcher's record of the island being on this reflector.
// in case some clients have been dispatched to here just as the record's deletion
// is being requested, we maintain the session record for a brief period so we can
// tell those late-arriving clients that they must connect again (because any clients
// *after* them will be dispatched afresh).  because the dispatchers could end up
// assigning the session to this same reflector again, we only turn away clients
// for a second or so after the unregistering has gone through.
async function deleteIsland(island) {
    const { id, syncWithoutSnapshot, snapshotUrl, time, seq, storedUrl, storedSeq, messages } = island;
    if (!ALL_ISLANDS.has(id)) {
        DEBUG(`${id} island already deleted, ignoring deleteIsland();`);
        return;
    }
    if (island.usersTimer) {
        clearTimeout(island.usersTimer);
        USERS(island); // ping heraldUrl one last time
    }
    prometheusSessionGauge.dec();
    // stop ticking and delete
    stopTicker(island);
    ALL_ISLANDS.delete(id);
    LOG(`${id} island deleted`);

    // remove session, including deleting dispatcher record if there is one
    // (deleteIsland is only ever invoked after at least long enough to
    // outlast the record's retention limit).
    const unregistered = unregisterSession(id, `@${time}#${seq}`);

    // if we've been told of a snapshot since the one (if any) stored in this
    // island's latest.json, or there are messages since the snapshot referenced
    // there, write a new latest.json.
    if (STORE_SESSION && (syncWithoutSnapshot || snapshotUrl) && (snapshotUrl !== storedUrl || after(storedSeq, seq))) {
        const fileName = `${id}/latest.json`;
        DEBUG(id, `@${time}#${seq} uploading latest.json with ${messages.length} messages`);
        cleanUpCompletedTallies(island);
        const latestSpec = {};
        savableKeys(island).forEach(key => latestSpec[key] = island[key]);
        try {
            await uploadJSON(fileName, latestSpec);
        } catch (err) { LOG(`${id} failed to upload latest.json. ${err.code}: ${err.message}` ); }
    }

    await unregistered; // wait because in emergency shutdown we need to clean up before exiting
}

function scheduleShutdownIfNoJoin(id, targetTime, detail) {
    // invoked on client connection, to schedule a cleanup in case no JOIN
    // happens in time.
    let session = ALL_SESSIONS.get(id);
    if (session.timeout) clearTimeout(session.timeout);
    const now = Date.now();
    session.timeout = setTimeout(() => {
        session = ALL_SESSIONS.get(id);
        if (!session || (session.stage !== 'runnable' && session.stage !== 'closable')) {
            const reason = session ? `stage=${session.stage}` : "no session record";
            DEBUG(id, `ignoring shutdown (${detail}): ${reason}`);
            return;
        }
        DEBUG(id, `shutting down session - ${detail}`);
        if (session.stage === 'closable') {
            // there is (supposedly) an island, but it has no clients
            const island = ALL_ISLANDS.get(id);
            if (island) {
                deleteIsland(island); // will invoke unregisterSession
                return;
            }
            DEBUG(id, `stage=closable but no island to delete`);
        }
        unregisterSession(id, "no island");
        }, targetTime - now);
}

async function unregisterSession(id, detail) {
    // invoked on a timeout from scheduleShutdownIfNoJoin, or in handleTerm
    // for a session that doesn't have an island, or from deleteIsland.
    const session = ALL_SESSIONS.get(id);
    if (!session || session.stage === 'closed') {
        const reason = session ? `stage=${session.stage}` : "no session record";
        DEBUG(id, `ignoring unregister: ${reason}`);
        return;
    }

    DEBUG(id, `unregistering session - ${detail}`);

    if (!DISPATCHER_BUCKET) {
        // nothing to wait for
        ALL_SESSIONS.delete(id);
        return;
    }

    session.stage = 'closed';
    let filename = `${id}.json`;
    if (CLUSTER === "localWithStorage") filename = `testing/${filename}`;
    try {
        await DISPATCHER_BUCKET.file(filename).delete();
    } catch (err) {
        if (err.code === 404) LOG(`${id} failed to unregister. ${err.code}: ${err.message}`);
        else WARN(`${id} failed to unregister. ${err.code}: ${err.message}`);
    }

    setTimeout(() => ALL_SESSIONS.delete(id), LATE_DISPATCH_DELAY);
}

function parseUrl(req) {
    // extract version, session, and token from /foo/bar/v1beta0/session?region=region&token=token
    // (same func as in dispatcher.js)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.pathname.replace(/.*\//, "");
    const versionMatch = url.pathname.match(/\/(v[0-9]+[^/]*|dev)\/[^/]*$/);
    const version = versionMatch ? versionMatch[1] : "";
    const token = url.searchParams.get("token");
    return { sessionId, version, token };
}


server.on('error', err => ERROR(`Server Socket Error: ${err.message}`));

server.on('connection', (client, req) => {
    const { version, sessionId } = parseUrl(req);
    if (!sessionId) { ERROR(`Missing session id in request "${req.url}"`); client.close(...REASON.BAD_PROTOCOL); return; }
    client.addr = `${req.socket.remoteAddress.replace(/^::ffff:/, '')}:${req.socket.remotePort}`;
    let session = ALL_SESSIONS.get(sessionId);
    if (session) {
        switch (session.stage) {
            case 'closed':
                // a request to delete the dispatcher record has already been
                // sent.  tell client to ask the dispatchers again.
                LOG(`${sessionId}/${client.addr} rejecting connection; session has been unregistered`);
                client.close(...REASON.RECONNECT); // safeClose doesn't exist yet
                return;
            case 'runnable':
            case 'closable': {
                // make sure the unregister timeout has at least 7s to run - same as
                // the initial unregisterDelay set up below - to give this client a
                // chance to join (even if it's in a very busy browser)
                const now = Date.now();
                const targetTime = Math.max(session.earliestUnregister, now + 7000);
                scheduleShutdownIfNoJoin(sessionId, targetTime, "no JOIN after connection");
                break;
                }
            default:
                // session must be 'running'.  just continue to set up the client.
        }
    } else {
        // add a buffer to how long we wait before trying to delete the dispatcher
        // record.  one purpose served by this buffer is to stay available for a
        // client that finds its socket isn't working (SYNC fails to arrive), and
        // after 5 seconds will try to reconnect.
        let unregisterDelay = DISPATCH_RECORD_RETENTION + 2000;
        if (CLUSTER === 'localWithStorage') {
            // FOR TESTING WITH LOCAL REFLECTOR ONLY
            // no dispatcher was involved in getting here.  create for ourselves a dummy
            // record in the /testing sub-bucket.
            unregisterDelay += 2000; // creating the record probably won't take longer than this
            const filename = `testing/${sessionId}.json`;
            const dummyContents = { dummy: "imadummy" };
            const start = Date.now();
            uploadJSON(filename, dummyContents, DISPATCHER_BUCKET)
            .then(() => LOG(`${sessionId} dummy dispatcher record created in ${Date.now() - start}ms`))
            .catch(err => ERROR(`${sessionId} failed to create dummy dispatcher record. ${err.code}: ${err.message}`));
        }
        const earliestUnregister = Date.now() + unregisterDelay;
        session = {
            stage: 'runnable',
            earliestUnregister
            };
        ALL_SESSIONS.set(sessionId, session);
        scheduleShutdownIfNoJoin(sessionId, earliestUnregister, "no JOIN in time");
    }
    prometheusConnectionGauge.inc(); // connection accepted
    client.sessionId = sessionId;
    // if this is a forwarded connection, extract the forwarding headers for logging.
    // if this connection is through a Croquet dispatcher, its proxy will have appended
    // the address of its incoming connection - typically a load balancer - and will
    // have added x-croquet-dispatcher with the name of the dispatcher's cluster.
    if (req.headers['x-forwarded-for']) client.forwarded = `via ${req.headers['x-croquet-dispatcher'||'']} (${req.headers['x-forwarded-for'].split(/\s*,\s*/).map(a => a.replace(/^::ffff:/, '')).join(', ')}) `;
    // location header is added by load balancer, see region-servers/apply-changes
    if (req.headers['x-location']) try {
        const [region, city, lat, lng] = req.headers['x-location'].split(",");
        client.location = { region };
        if (city) client.location.city = { name: city, lat: +lat, lng: +lng };
    } catch (ex) { /* ignore */}
    client.stats = { mi: 0, mo: 0, bi: 0, bo: 0 }; // messages / bytes, in / out
    client.safeSend = data => {
        if (client.readyState !== WebSocket.OPEN) return;
        STATS.BUFFER = Math.max(STATS.BUFFER, client.bufferedAmount);
        client.send(data);
        STATS.OUT += data.length;
        client.stats.mo += 1;               // messages out
        client.stats.bo += data.length;     // bytes out
    };
    client.safeClose = (code, data) => {
        if (client.readyState !== WebSocket.OPEN) return;
        client.close(code, data);
    };
    if (collectRawSocketStats) {
        client.stats.ri = 0;
        client.stats.ro = 0;
        client._socket.write_orig = client._socket.write_orig || client._socket.write;
        client._socket.write = (buf, ...args) => {
            client.stats.ro += buf.length;
            client._socket.write_orig(buf, ...args);
        };
        client._socket.on('data', buf => client.stats.ri += buf.length);
    }
    // the connection log filter matches on (" connection " OR " JOIN ")
    LOG(`${sessionId}/${client.addr} opened connection ${version} ${client.forwarded||''}${req.headers['x-location']||''}`);
    STATS.USERS = Math.max(STATS.USERS, server.clients.size);

    let lastActivity = Date.now();
    client.on('pong', time => {
        lastActivity = Date.now();
        DEBUG(`${sessionId}/${client.addr} receiving pong after ${Date.now() - time} ms`);
        });
    setTimeout(() => client.readyState === WebSocket.OPEN && client.ping(Date.now()), 100);

    let joined = false;
    if (DISCONNECT_UNRESPONSIVE_CLIENTS) {
        function checkForActivity() {
            if (client.readyState !== WebSocket.OPEN) return;
            const now = Date.now();
            const quiescence = now - lastActivity;
            if (quiescence > DISCONNECT_THRESHOLD) {
                DEBUG(`${sessionId}/${client.addr} inactive for ${quiescence} ms, disconnecting`);
                client.safeClose(...REASON.INACTIVE); // NB: close event won't arrive for a while
                return;
            }
            let nextCheck = CHECK_INTERVAL;
            if (quiescence > PING_THRESHOLD) {
                if (!joined) {
                    DEBUG(`${sessionId}/${client.addr} did not join within ${quiescence} ms, disconnecting`);
                    client.safeClose(...REASON.NO_JOIN);
                    return;
                }

                // joined is true, so client.island must have been set up
                if (!client.island.noInactivityPings) {
                    DEBUG(`${sessionId}/${client.addr} inactive for ${quiescence} ms, sending ping`);
                    client.ping(now);
                    nextCheck = PING_INTERVAL;
                }
            }
            setTimeout(checkForActivity, nextCheck);
        }
        setTimeout(checkForActivity, PING_THRESHOLD + 2000); // allow some time for establishing session
    }

    client.on('message', incomingMsg => {
        const handleMessage = () => {
            if (client.readyState !== WebSocket.OPEN) return; // ignore messages arriving after we disconnected the client
            lastActivity = Date.now();
            STATS.IN += incomingMsg.length;
            client.stats.mi += 1;                      // messages in
            client.stats.bi += incomingMsg.length;     // bytes in
            let parsedMsg;
            try {
                parsedMsg = JSON.parse(incomingMsg);
                if (typeof parsedMsg !== "object") throw Error("JSON did not contain an object");
            } catch (error) {
                ERROR(`${sessionId}/${client.addr} message parsing error: ${error.message}`, incomingMsg);
                client.close(...REASON.MALFORMED_MESSAGE);
                return;
            }
            try {
                const { action, args, tags } = parsedMsg;
                switch (action) {
                    case 'JOIN': { joined = true; JOIN(client, args); break; }
                    case 'SEND': if (tags) SEND_TAGGED(client.island, args, tags); else SEND(client.island, [args]); break; // SEND accepts an array of messages
                    case 'TUTTI': TUTTI(client, args); break;
                    case 'TICKS': TICKS(client, args); break;
                    case 'SNAP': SNAP(client, args); break;
                    case 'SAVE': SAVE(client, args); break;
                    case 'LOG': LOG(`${sessionId}/${client.addr} LOG ${typeof args === "string" ? args : JSON.stringify(args)}`); break;
                    case 'PING': PONG(client, args); break;
                    case 'PULSE': LOCAL_DEBUG(`${sessionId}/${client.addr} receiving PULSE`); break; // sets lastActivity, otherwise no-op
                    default: WARN(`${sessionId}/${client.addr} unknown action ${JSON.stringify(action)}`);
                }
            } catch (error) {
                ERROR(`${sessionId}/${client.addr} message handling error: ${error.message}`, error);
                client.close(...REASON.UNKNOWN_ERROR);
            }
        };

        if (ARTIFICIAL_DELAY) {
            const timeout = ARTIFICIAL_DELAY * (0.5 + Math.random());
            setTimeout(handleMessage, timeout);
        } else {
            handleMessage();
        }
    });

    client.on('close', (...reason) => {
        prometheusConnectionGauge.dec();
        // the connection log filter matches on (" connection " OR " JOIN ")
        LOG(`${client.sessionId}/${client.addr} closed connection ${JSON.stringify(reason)} ${JSON.stringify(client.stats)}`);
        const island = ALL_ISLANDS.get(client.sessionId);
        if (island && island.clients.has(client)) {
            if (island.startClient === client) {
                DEBUG(`${island.id}/${client.addr} START client failed to respond`);
                clearTimeout(island.startTimeout);
                island.startTimeout = null;
                island.startClient = null;
                // start next client
                START(island);
            }
            setTimeout(() => clientLeft(client), island.leaveDelay);
        }
    });

    client.on('error', err => ERROR(`Client Socket Error: ${err.message}`));
});


const DEFAULT_SIGN_SERVER = "https://api.croquet.io/sign";
const DEV_SIGN_SERVER = "https://api.croquet.io/dev/sign";
const API_SERVER_URL = IS_DEV ? DEV_SIGN_SERVER : DEFAULT_SIGN_SERVER;

async function verifyApiKeyInBackground(apiKey, url, appId, persistentId, id, sdk, client) {
    try {
        const response = await fetch(`${API_SERVER_URL}/reflector/${CLUSTER}/${HOSTNAME}?meta=verify`, {
            headers: {
                "X-Croquet-Auth": apiKey,
                "X-Croquet-App": appId,
                "X-Croquet-Id": persistentId,
                "X-Croquet-Session": id,
                "X-Croquet-Version": sdk,
                "Referrer": url,
            },
        });
        // we don't reject clients because of HTTP Errors
        if (!response.ok) {
            throw Error(`HTTP Error ${response.status} ${response.statusText} ${await response.text()}`);
        }
        // even key-not-found is 200 OK, but sets JSON error property
        const { developerId, error } = await response.json();
        const island = ALL_ISLANDS.get(id); // fetch island now, in case it went away during await
        if (developerId) {
            LOG(`${id}/${client.addr} API key verified: ${developerId}`);
        } else if (error && island) {
            ERROR(`${id}/${client.addr} API key verification failed: ${error}`);
            INFO(island, {
                code: "KEY_VERIFICATION_FAILED",
                msg: error,
                options: { level: "error", only: "once" }
                });
            disconnectAllAndDeleteIsland(island, REASON.BAD_APIKEY);
        }
    } catch (err) {
        ERROR(`${id}/${client.addr} error verifying API key: ${err.message}`);
    }
}

/** fetch a JSON-encoded object from our storage bucket */
async function fetchJSON(filename) {
    // somewhat of a hack to not having to guard the fetchJSON calls in JOIN()
    if (NO_STORAGE || (APPS_ONLY && !filename.startsWith('apps/'))) {
        return Promise.reject(Object.assign(new Error("fetch disabled"), { code: 404 }));
    }
    const file = SESSION_BUCKET.file(filename);
    const stream = await file.createReadStream();
    return new Promise((resolve, reject) => {
        try {
            let string = '';
            stream.on('data', data => string += data);
            stream.on('end', () => resolve(JSON.parse(string)));
            stream.on('error', reject);
        } catch (err) { reject(err); }
    });
}

/** upload an object as JSON file to our storage bucket */
async function uploadJSON(filename, object, bucket=SESSION_BUCKET) {
    if (NO_STORAGE || (APPS_ONLY && !filename.startsWith('apps/'))) {
        throw Error("storage disabled but upload called?!");
    }
    const file = bucket.file(filename);
    const stream = await file.createWriteStream({
        resumable: false,
        metadata: {
            contentType: 'text/json',
            cacheControl: 'no-cache',
        }
    });
    return new Promise((resolve, reject) => {
        try {
            stream.on('finish', resolve);
            stream.on('error', reject);
            stream.write(JSON.stringify(object));
            stream.end();
        } catch (err) { reject(err); }
    });
}

exports.server = server;
exports.Socket = WebSocket.Socket;
