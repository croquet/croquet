// when running on node, 'ws' is the actual web socket module
// when running in browser, 'ws' is our own './ws.js'
// (in-browser mode is not supported right now)

const os = require('os');
const fs = require('fs');
const { performance } = require("perf_hooks");
const WebSocket = require('ws');
const fetch = require('node-fetch');
const prometheus = require('prom-client');
const jwt = require('jsonwebtoken');
const pino = require('pino');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// command line args

const ARGS = {
    NO_STORAGE: "--storage=none",
    APPS_ONLY: "--storage=persist",
    STANDALONE: "--standalone",
    HTTPS: "--https",
    NO_LOGTIME: "--no-logtime",
    NO_LOGLATENCY: "--no-loglatency",
    TIME_STABILIZED: "--time-stabilized"
};

for (const arg of process.argv.slice(2)) {
    if (!Object.values(ARGS).includes(arg)) {
        console.error(`Error: Unrecognized option ${arg}`);
        process.exit(1);
    }
}

const NO_STORAGE = process.argv.includes(ARGS.NO_STORAGE); // no bucket access
const NO_DISPATCHER = NO_STORAGE || process.argv.includes(ARGS.STANDALONE); // no session deregistration
const APPS_ONLY = !NO_STORAGE && process.argv.includes(ARGS.APPS_ONLY); // no session resume
const USE_HTTPS = process.argv.includes(ARGS.HTTPS); // serve via https on port 443
const VERIFY_TOKEN = !process.argv.includes(ARGS.STANDALONE);
const STORE_SESSION = !NO_STORAGE && !APPS_ONLY;
const STORE_MESSAGE_LOGS = !NO_STORAGE && !APPS_ONLY;
const STORE_PERSISTENT_DATA = !NO_STORAGE;
const NO_LOGTIME = process.argv.includes(ARGS.NO_LOGTIME); // don't prepend the time to each log even when running locally
const PER_MESSAGE_LATENCY = !process.argv.includes(ARGS.NO_LOGLATENCY); // log latency of each message
const TIME_STABILIZED = process.argv.includes(ARGS.TIME_STABILIZED); // watch for jumps in Date.now and use them to rescale performance.now (needed for Docker standalone)

// do not show pre 1.0 warning if these strings appear in session name or url
const SPECIAL_CUSTOMERS = [
    "queue",
    "mathgenie",
];

// debugging (should read env vars)
const collectRawSocketStats = false;

const LATENCY_BUCKET_0 = 8;
const LATENCY_BUCKET_1 = 10;
const LATENCY_BUCKET_2 = 13;
const LATENCY_BUCKET_3 = 17;
const LATENCY_BUCKET_4 = 22;
const LATENCY_BUCKET_5 = 29;
const LATENCY_BUCKET_6 = 38;
const LATENCY_BUCKET_7 = 50;
const LATENCY_BUCKET_8 = 66;
const LATENCY_BUCKET_9 = 87;
const LATENCY_BUCKET_10 = 115;
const LATENCY_BUCKET_11 = 153;
const LATENCY_BUCKET_12 = 203;
const LATENCY_BUCKET_13 = 270;
const LATENCY_BUCKET_14 = 360;

const LATENCY_BUCKETS = [
    LATENCY_BUCKET_0,
    LATENCY_BUCKET_1,
    LATENCY_BUCKET_2,
    LATENCY_BUCKET_3,
    LATENCY_BUCKET_4,
    LATENCY_BUCKET_5,
    LATENCY_BUCKET_6,
    LATENCY_BUCKET_7,
    LATENCY_BUCKET_8,
    LATENCY_BUCKET_9,
    LATENCY_BUCKET_10,
    LATENCY_BUCKET_11,
    LATENCY_BUCKET_12,
    LATENCY_BUCKET_13,
    LATENCY_BUCKET_14,
];

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
const prometheusLatencyHistogram = new prometheus.Histogram({
    name: 'reflector_latency',
    help: 'Latency measurements in milliseconds.',
    buckets: LATENCY_BUCKETS,
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

// if running locally, there is the option to run with or without using the session-
// related storage (for snapshots, dispatcher records etc).
// if "localWithStorage" is chosen, the reflector itself will create a dummy dispatcher
// record the first time it sees a session, and will delete it when the session is
// offloaded.
const LOCAL_CONFIG = NO_STORAGE ? "local" : "localWithStorage"; // todo: remove localWithStorage and use NO_STORAGE instead
const CLUSTER = fs.existsSync("/var/run/secrets/kubernetes.io") ? process.env.CLUSTER_NAME : LOCAL_CONFIG;
const CLUSTER_LABEL = process.env.CLUSTER_LABEL || CLUSTER;
const CLUSTER_IS_LOCAL = CLUSTER.startsWith("local");
const HOSTNAME = os.hostname();
const HOSTIP = CLUSTER_IS_LOCAL ? "localhost" : Object.values(os.networkInterfaces()).flat().filter(addr => !addr.internal && addr.family === 'IPv4')[0].address;
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


// Map pino levels to GCP, https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
const GCP_SEVERITY = {
    trace:  'DEFAULT',  // 10 default min on local
    meter:  'DEFAULT',  // 15 default min otherwise
    debug:  'DEBUG',    // 20
    info:   'INFO',     // 30
    notice: 'NOTICE',   // 35 not a pino level
    warn:   'WARNING',  // 40
    error:  'ERROR',    // 50
    fatal:  'CRITICAL', // 60
};

// every log entry should have scope and event properties, as well as a message.
// the scope is "session" if we have a sessionId, "connection" if we have
// a connectionId (client address), and "process" if we don't have either.
const empty_logger = pino({
    base: null,
    messageKey: 'message',
    timestamp: CLUSTER_IS_LOCAL && !NO_LOGTIME,
    level: process.env.LOG_LEVEL ? process.env.LOG_LEVEL.toLowerCase() : CLUSTER_IS_LOCAL ? 'trace' : 'meter',
    customLevels: {
        meter: 25,
        notice: 35,
    },
    formatters: {
        level: label => ({ severity: GCP_SEVERITY[label] || 'DEFAULT'}),
    },
});

// the global logger. we have per-session and per-connection loggers, too,
// but they are all children of the empty_logger to avoid duplication of
// properties in the JSON which causes problems in StackDriver
// (e.g. {scope: "session", scope: "connection"} arrives as {scope: "connect"})
const global_logger = empty_logger.child({ scope: "process", hostIp: HOSTIP });

// Logging out the initial start-up event message
global_logger.notice({ event: "start" }, `reflector started ${CLUSTER_LABEL} ${HOSTIP}`);

// secret shared with sign cloud func
const SECRET_NAME = "projects/croquet-proj/secrets/signurl-jwt-hs256/versions/latest";
let SECRET;

// we use Google Cloud Storage for session state
const storage = new Storage();
const SESSION_BUCKET = NO_STORAGE ? null : storage.bucket('croquet-sessions-v1');
const DISPATCHER_BUCKET = NO_DISPATCHER ? null : storage.bucket('croquet-reflectors-v1');

// pointer to latest persistent data is stored in user buckets
// direct bucket access (instead of going via load-balancer as clients do)
// avoids CDN caching
const FILE_BUCKETS = {
    us: STORE_PERSISTENT_DATA ? storage.bucket('files.us.croquet.io') : null,
    eu: STORE_PERSISTENT_DATA ? storage.bucket('files.eu.croquet.io') : null,
};
FILE_BUCKETS.default = FILE_BUCKETS.us;

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
let webServer;
const webServerModule = USE_HTTPS ? require("https") : require("http");
if (USE_HTTPS) {
    webServer = webServerModule.createServer({
        key: fs.readFileSync('reflector-key.pem'),
        cert: fs.readFileSync('reflector-cert.pem'),
    }, requestListener);
} else {
    webServer = webServerModule.createServer(requestListener);
}

async function requestListener(req, res) {
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
        const body = [...ALL_ISLANDS.values()].map(({id, clients, appId, name, url}) => `${id} ${clients.size} ${appId || name} ${url}\n`).join('');
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
    if (!is_health_check) global_logger.info({
        event: "request",
        method: req.method,
        url: req.url,
        headers: req.headers,
    }, `GET ${req.url}`);
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
}

webServer.on('upgrade', (req, socket, _head) => {
    const { sessionId } = parseUrl(req);
    const connection = `${socket.remoteAddress.replace(/^::ffff:/, '')}:${socket.remotePort}`;
    if (sessionId) {
        const session = ALL_SESSIONS.get(sessionId);
        if (session && session.stage === 'closed') {
            // a request to delete the dispatcher record has already been sent.  reject this connection, forcing the client to ask the dispatchers again.
            global_logger.debug({
                event: "upgrade-rejected",
                method: req.method,
                url: req.url,
                headers: req.headers,
                sessionId,
                connection
            }, `rejecting socket on upgrade; session has been unregistered`);
            socket.end('HTTP/1.1 404 Session Closed\r\n');
            return;
        }
    }
    global_logger.debug({
        event: "upgrade",
        method: req.method,
        url: req.url,
        headers: req.headers,
        sessionId,
        connection
    }, `upgrading socket for ${req.url}`);
});

// the WebSocket.Server will intercept the UPGRADE request made by a ws:// websocket connection
const server = new WebSocket.Server({ server: webServer });

async function startServer() {
    if (VERIFY_TOKEN) SECRET = await fetchSecret();
    webServer.listen(PORT);
    global_logger.info({
        event: "listen",
    }, `starting ${server.constructor.name} ${USE_HTTPS ? "wss" : "ws"}://${CLUSTER_IS_LOCAL ? "localhost" : HOSTNAME}:${PORT}/`);
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
        global_logger.trace({ event: "stats" }, out.join(', '));
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
            global_logger.warn({
                event: "shutdown",
                sessionCount: promises.length,
            }, `EMERGENCY SHUTDOWN OF ${promises.length} ISLAND(S)`);
            Promise.allSettled(promises).then(() => {
                global_logger.notice({ event: "end" }, "reflector shutdown");
                process.exit();
            });
        } else {
            global_logger.notice({ event: "end" }, "reflector shutdown");
            process.exit();
        }
    }
}
process.on('SIGINT', handleTerm);
process.on('SIGTERM', handleTerm);
process.on('uncaughtException', err => {
    global_logger.error({
        event: "uncaught-exception",
        err
    }, `Uncaught exception: ${err.message}`);
    handleTerm();
});
process.on('unhandledRejection', (err, _promise) => {
    global_logger.warn({
        event: "unhandled-rejection",
        err,
    }, `Unhandled rejection: ${err.message}`);
    // TODO: call handleTerm();
    // (not terminating yet, need to see what rejections we do not handle first)
});

function openToClients() {
    // start server
    startServer();
    if (CLUSTER_IS_LOCAL) watchStats();
}

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

/** Set and return current (integer) time for island, advancing at the island's current scale
 * @param {IslandData} island
 */
function advanceTime(island, _reason) {
    const prevTime = island.time;

    // this is the actual advance, everything else is just debug code
    const scaledTime = Math.floor(getScaledTime(island));
    island.time = scaledTime;

    // warn about time jumps
    const scaledAdvance = island.time - prevTime;
    if (scaledAdvance < 0 || scaledAdvance > 60000) {
        island.warn({
            event: "time-jump",
            scaledAdvance,
            islandPrev: prevTime,
            islandTime: island.time,
            islandStart: island.scaledStart,
            islandScale: island.scale,
            performanceNowAdjustment,
            stabilizedPerformanceNow: stabilizedPerformanceNow(),
            tickMS: island.tick,
            reason: _reason,
        }, `time jumped by ${scaledAdvance} ms`);
    }
    // island.logger.trace({event: "advance-time", ms: scaledAdvance, newTime: island.time}, `advanceTime(${_reason}) => ${island.time}`);
    return island.time;
}

/** Get (integer) raw time for island, as ms since it was set up on this reflector
 * @param {IslandData} island
 */
function getRawTime(island) {
    const now = stabilizedPerformanceNow();
    const rawTime = Math.floor(now - island.rawStart);
    return rawTime;
}

/** Get (float) current time for island, advancing at the island's scale
 * @param {IslandData} island
 */
function getScaledTime(island) {
    const now = stabilizedPerformanceNow();
    const sinceStart = now - island.scaledStart;
    const scaledTime = sinceStart * island.scale;
    return scaledTime;
}


function nonSavableProps() {
    return {
        lag: 0,              // aggregate ms lag in tick requests
        clients: new Set(),  // connected web sockets
        usersJoined: [],     // the users who joined since last report
        usersLeft: [],       // the users who left since last report
        usersTimer: null,    // timeout for sending USERS message
        leaveDelay: 0,       // delay in ms before leave event is generated
        dormantDelay: 0,     // delay in s until a hidden client will go dormant
        heraldUrl: '',       // announce join/leave events
        ticker: null,        // interval for serving TICKs
        yetToCheckLatest: true, // flag used while fetching latest.json during startup
        storedUrl: null,     // url of snapshot in latest.json (null before we've checked latest.json)
        storedSeq: INITIAL_SEQ, // seq of last message in latest.json message addendum
        startClient: null,   // the client we sent START
        startTimeout: null,  // pending START request timeout (should send SNAP)
        deletionTimeout: null, // pending deletion after all clients disconnect
        syncClients: [],     // clients waiting to SYNC
        tallies: {},
        tagRecords: {},
        developerId: null,
        apiKey: null,
        region: "default",   // the apiKey region for persisted data
        url: null,
        resumed: new Date(), // session init/resume time, needed for billing to count number of sessions
        logger: null,        // the logger for this session (shared with ALL_SESSIONS[id])
        flags: {},           // flags for experimental reflector features.  currently only "rawtime" is checked
        rawStart: 0,         // stabilizedPerformanceNow() for start of this session
        scaledStart: 0,      // synthetic stabilizedPerformanceNow() for session start at current scale
        [Symbol.toPrimitive]: () => "dummy",
        };
}

function savableKeys(island) {
    const nonSavable = nonSavableProps(); // make a new one
    return Object.keys(island).filter(key => !(key in nonSavable));
}

/** A new island controller is joining
 * @param {Client} client - we received from this client
 * @param {{name: String, version: Number, appId?: string, persistentId?: string, user: string}} args
 */
async function JOIN(client, args) {
    if (typeof args === "number" || !args.version) {
        client.safeClose(...REASON.BAD_PROTOCOL);
        return;
    }
    const id = client.sessionId;
    const connectedFor = Date.now() - client.since;
    const session = ALL_SESSIONS.get(id);
    if (!session) {
        // shouldn't normally happen, but perhaps possible due to network delays
        client.logger.info({event: "reject-join", connectedFor}, "rejecting JOIN; unknown session");
        client.safeClose(...REASON.RECONNECT);
        return;
    }

    switch (session.stage) {
        case 'closed':
            // a request to delete the dispatcher record has already been
            // sent (but we didn't know that in time to prevent the
            // client from connecting at all).  tell client to ask the
            // dispatchers again.
            client.logger.info({ event: "reject-join", connectedFor}, "rejecting JOIN; session has been unregistered");
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

    const { name, version, apiKey, url, sdk, appId, codeHash, user, location, heraldUrl, leaveDelay, dormantDelay, tove, flags } = args;
    // islandId deprecated since 0.5.1, but old clients will send it rather than persistentId
    const persistentId = args.persistentId || args.islandId;
    const unverifiedDeveloperId = args.developerId;

    // BigQuery wants a single data type, but user can be string or object or array
    client.meta.user = typeof user === "string" ? user : JSON.stringify(user);
    // recreate client logger with data from JOIN
    // NOTE: if this is the first client, then the session logger does not have the JOIN args yet
    // in that case, the client loggers for the session will be recreated again below
    client.logger = empty_logger.child({...session.logger.bindings(), ...client.meta});

    // connection log sink filters on scope="connection" and event="start|join|end"
    client.logger.notice({
        event: "join",
        appId,
        persistentId,
        codeHash,
        apiKey,
        url,
        sdk,
        heraldUrl,
        allArgs: JSON.stringify(args),  //  BigQuery wants a specific schema, so don't simply log all args separately
        connectedFor,
    }, `receiving JOIN ${client.meta.user} ${url}`);

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
        island.rawStart = island.scaledStart = Math.floor(stabilizedPerformanceNow()); // before TICKS()
        island.logger = session.logger;
        ALL_ISLANDS.set(id, island);
        prometheusSessionGauge.inc();
        if (syncWithoutSnapshot) TICKS(client, args.ticks); // client will not request ticks
    }
    // the following are in the nonSavable list, and can be updated on every JOIN
    island.heraldUrl = heraldUrl || '';
    island.leaveDelay = leaveDelay || 0;
    island.dormantDelay = dormantDelay; // only provided by clients since 0.5.1
    island.url = url;
    island.flags = {};
    // set flags only for the features this reflector can support
    ['rawtime'].forEach(prop => { if ((flags || {})[prop]) island.flags[prop] = true; });

    client.island = island; // set island before await

    const { token } = client.meta;
    let validToken;
    if (VERIFY_TOKEN && token) try {
        validToken = await verifyToken(token);
        client.logger.info({ event: "token-verified" }, "token verified");
    } catch (err) {
        client.logger.warn({ event: "token-verify-failed", err }, `token verification failed: ${err.message}`);
    }

    // check API key
    let apiKeyPromise;
    if (apiKey === undefined) {
        // old client: accept for now, but let them know. Unless they're special.
        const specialCustomer = SPECIAL_CUSTOMERS.find(value => url.includes(value) || name.includes(value));
        if (!specialCustomer) INFO(island, {
            code: "MISSING_KEY",
            msg: "Croquet versions before 1.0 will stop being supported soon. Please update your app now! croquet.io/docs/croquet",
            options: { level: "warning", only: "once" }
        }, [client]);
    } else {
        island.apiKey = apiKey;
        // this should be a formality – the controller already checks the apiKey before sending join
        // so we assume good intent and do not await result, to not delay SYNC unnecessarily
        // ... unless there is no token, in which case we await below
        apiKeyPromise = verifyApiKey(apiKey, url, appId, persistentId, id, sdk, client, unverifiedDeveloperId);
        // unless we have a valid token, do not let the client proceed
        if (validToken) {
            island.developerId = validToken.developerId;
            if (validToken.region && island.region === "default") island.region = validToken.region;
        } else {
            // will disconnect everyone with error if failed (await could throw an exception)
            const apiResponse = await apiKeyPromise;
            if (!apiResponse) return;
            island.developerId = apiResponse.developerId;
            if (apiResponse.region && island.region === "default") island.region = apiResponse.region;
        }
    }

    if (user) {
        client.user = user;
        if (island.location && client.meta.location) {
            if (Array.isArray(user)) user.push(client.meta.location);
            else if (typeof user === "object") user.location = client.meta.location;
        }
    }

    // we need to SYNC
    island.syncClients.push(client);

    // if we have a current snapshot, reply with that
    if (island.snapshotUrl || island.persistentUrl) { SYNC(island); return; }

    // if we haven't yet checked latest.json, look there first
    if (island.yetToCheckLatest) {
        island.yetToCheckLatest = false;

        const sessionMeta = {
            ...global_logger.bindings(),
            ...session.logger.bindings(),
            appId,
            persistentId,
            codeHash,
            apiKey,
            developerId: island.developerId,
            url,
            sdk,
            heraldUrl,
        };
        session.logger = empty_logger.child(sessionMeta);
        island.logger = session.logger;
        // client loggers need to be updated now that session logger has more meta data
        for (const each of island.syncClients) {
            each.logger = empty_logger.child({...sessionMeta, ...each.meta});
        }
        // new clients will be based on new session.logger

        const fileName = `${id}/latest.json`;
        try {
            const latestSpec = await fetchJSON(fileName);
            if (!latestSpec.snapshotUrl && !latestSpec.syncWithoutSnapshot) throw Error("latest.json has no snapshot, ignoring");
            island.logger.notice({
                event: "start",
                snapshot: {
                    time: latestSpec.time,
                    seq: latestSpec.seq,
                    messages: latestSpec.messages.length,
                    url: latestSpec.snapshotUrl,
                },
            }, "resuming session from latest.json");
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

            island.scaledStart = stabilizedPerformanceNow() - island.time / island.scale;
            island.storedUrl = latestSpec.snapshotUrl;
            island.storedSeq = latestSpec.seq;
            if (latestSpec.reflectorSession) island.timeline = latestSpec.reflectorSession; // TODO: remove reflectorSession after 0.4.1 release
        } catch (err) {
            if (typeof err !== "object") err = { message: ""+JSON.stringify(err) }; // eslint-disable-line no-ex-assign
            if (!err.message) err.message = "<empty>";
            if (err.code !== 404) island.logger.error({event: "fetch-latest-failed", err}, `failed to fetch latest.json: ${err.message}`);
            // this is a brand-new session, check if there is persistent data
            let persisted;
            if (island.developerId) {
                // new location for persistent data is in regional files buckets
                const bucket = FILE_BUCKETS[island.region] || FILE_BUCKETS.default;
                const path = `u/${island.developerId}/${appId}/${persistentId}/saved.json`;
                persisted = await fetchJSON(path, bucket).catch(ex => {
                    if (ex.code !== 404) island.logger.error({
                        event: "fetch-saved-failed",
                        bucket: bucket.name,
                        path,
                        err: ex,
                    }, `failed to fetch saved.json: ${ex.message}`);
                });
            }
            if (!persisted && appId) {
                // old location for persistent data in sessions bucket
                const path = `apps/${appId}/${persistentId}.json`;
                const bucket = SESSION_BUCKET;
                persisted = await fetchJSON(path, bucket).catch(ex => {
                    if (ex.code !== 404) island.logger.error({
                        event: "fetch-persist-failed",
                        bucket: bucket.name,
                        path,
                        err: ex,
                    }, `failed to fetch old persistence: ${ex.message}`);
                });
            }
            if (persisted) {
                island.persistentUrl = persisted.url;
                island.logger.notice({
                    event: "start",
                    persisted: {
                        url: island.persistentUrl,
                    },
                }, "resuming session from persisted data");
            } else {
                island.logger.notice({event: "start"}, "starting fresh session");
            }
        } finally {
            island.storedUrl = ''; // replace the null that means we haven't looked
            // as of 0.3.3, clients do not want START but SYNC with an empty snapshot
            if (island.syncWithoutSnapshot) SYNC(island);
            else START(island);
        }

        return;
    }

    // if we've checked latest.json, and updated storedUrl (but not snapshotUrl,
    // as checked above), this must be a brand new island.  send a START or SYNC,
    // as appropriate.
    if (island.storedUrl !== null && !island.startTimeout) {
        if (island.syncWithoutSnapshot) SYNC(island);
        else START(island);
        return;
    }

    // otherwise, nothing to do at this point.  log that this client is waiting
    // for a snapshot either from latest.json or from a STARTed client.
    client.logger.debug({event: "waiting-for-snapshot"}, "waiting for snapshot");
}

function START(island) {
    // find next client
    do {
        island.startClient = island.syncClients.shift();
        if (!island.startClient) return; // no client waiting
    } while (island.startClient.readyState !== WebSocket.OPEN);
    const client = island.startClient;
    const msg = JSON.stringify({ id: island.id, action: 'START' });
    client.safeSend(msg);
    client.logger.debug({event: "send-start"}, `sending START ${msg}`);
    // if the client does not provide a snapshot in time, we need to start over
    if (DISCONNECT_UNRESPONSIVE_CLIENTS) island.startTimeout = setTimeout(() => {
        if (island.startClient !== client) return; // success
        client.safeClose(...REASON.UNRESPONSIVE);
        // the client's on('close') handler will call START again
        }, SNAP_TIMEOUT);
}

function SYNC(island) {
    const { id, seq, timeline, snapshotUrl: url, snapshotTime, snapshotSeq, persistentUrl, messages, tove, flags } = island;
    const time = advanceTime(island, "SYNC");
    const args = { url, messages, time, seq, tove, reflector: CLUSTER, timeline, reflectorSession: timeline, flags };  // TODO: remove reflectorSession after 0.4.1 release
    if (url) {args.snapshotTime = snapshotTime; args.snapshotSeq = snapshotSeq; }
    else if (persistentUrl) { args.url = persistentUrl; args.persisted = true; }
    const response = JSON.stringify({ id, action: 'SYNC', args });
    const range = !messages.length ? '' : ` (#${messages[0][1]}...${messages[messages.length - 1][1]})`;
    const what = args.persisted ? "persisted" : "snapshot";
    for (const syncClient of island.syncClients) {
        if (syncClient.readyState === WebSocket.OPEN) {
            syncClient.safeSend(response);
            syncClient.logger.debug({
                event: "send-sync",
                data: args.url,
                what,
                msgCount: messages.length,
                bytes: response.length,
                connectedFor: Date.now() - syncClient.since,
            }, `sending SYNC @${time}#${seq} ${response.length} bytes, ${messages.length} messages${range}, ${what} ${args.url || "<none>"}`);
            island.clients.add(syncClient);
            announceUserDidJoin(syncClient);
        } else {
            syncClient.logger.debug({event: "send-sync-skipped"}, `socket closed before SYNC`);
        }
    }
    // synced all that were waiting
    island.syncClients.length = 0;
    // delete island if nobody actually joined
    if (island.clients.size === 0) provisionallyDeleteIsland(island);
}

function clientLeft(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island) return;
    const wasClient = island.clients.delete(client);
    if (!wasClient) return;
    client.logger.debug({
        event: "deleted",
        clientCount: island.clients.size,
    }, `client deleted, ${island.clients.size} remaining`);
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
    client.logger.trace({
        event: "user-joined",
        user: typeof client.user === "string" ? client.user : JSON.stringify(client.user), // BigQuery wants a single data type
    }, `user ${JSON.stringify(client.user)} joined`);
}

function announceUserDidLeave(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island || !client.user || client.active !== true) return;
    client.active = false;
    const didJoin = island.usersJoined.indexOf(client.user);
    if (didJoin !== -1) island.usersJoined.splice(didJoin, 1);
    else island.usersLeft.push(client.user);
    scheduleUsersMessage(island);
    client.logger.trace({
        event: "user-left",
        user: typeof client.user === "string" ? client.user : JSON.stringify(client.user), // BigQuery wants a single data type
    }, `user ${JSON.stringify(client.user)} left`);
}

function scheduleUsersMessage(island) {
    if (!island.usersTimer) island.usersTimer = setTimeout(() => USERS(island), USERS_INTERVAL);
}

/** answer true if seqB comes after seqA */
function after(seqA, seqB) {
    const seqDelta = (seqB - seqA) >>> 0; // make unsigned
    return seqDelta > 0 && seqDelta < 0x8000000;
}

/** keep a histogram of observed latencies */

const Latencies = new Map();

// log latencies every 15 min
setInterval(logLatencies, 15 * 60 * 1000);

function logLatencies() {
    if (!Latencies.size) return;
    let ms = Date.now();
    for (const entry of Latencies.values()) {
        entry.latency.limits = LATENCY_BUCKETS;
        let count = 0;
        for (let i = 0; i < LATENCY_BUCKETS.length; i++) count += entry.latency.hist[i];
        // latency log sink filters on scope="process" and event="latency"
        global_logger.notice(entry, `Latency ${Math.ceil(entry.latency.sum / count)} ms (${entry.latency.min}-${entry.latency.max} ms)`);
    }
    ms = Date.now() - ms;
    global_logger.notice({event: "latencies", ms, count: Latencies.size}, `Logged latency for ${Latencies.size} IP addresses in ${ms} ms`);
    Latencies.clear();
}

function recordLatency(client, ms) {
    // global latency
    prometheusLatencyHistogram.observe(ms);

    if (PER_MESSAGE_LATENCY) {
        client.logger.meter({event: "message-latency", ms}, `Latency ${ms} ms`);
    }

    // fine-grained latency by IP address
    const userIp = client.meta.userIp;
    let entry = Latencies.get(userIp);
    if (!entry) {
        // directly used as log entry meta data
        // latency log sink filters on scope="process" and event="latency"
        entry = {
            event: "latency",
            latency: {
                min: ms,
                max: ms,
                sum: 0,
                hist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            },
            userIp,
        };
        if (client.meta.dispatcher) entry.dispatcher = client.meta.dispatcher;
        if (client.meta.location) Object.assign(entry, client.meta.location);
        Latencies.set(userIp, entry);
    }

    const bucket = (ms <= LATENCY_BUCKET_7
        ? (ms <= LATENCY_BUCKET_3
            ? (ms <= LATENCY_BUCKET_1
                ? (ms <= LATENCY_BUCKET_0 ? 0 : 1)
                : (ms <= LATENCY_BUCKET_2 ? 2 : 3)
            )
            : (ms <= LATENCY_BUCKET_5
                ? (ms <= LATENCY_BUCKET_4 ? 4 : 5)
                : (ms <= LATENCY_BUCKET_6 ? 6 : 7)
            )
        )
        : (ms <= LATENCY_BUCKET_11
            ? (ms <= LATENCY_BUCKET_9
                ? (ms <= LATENCY_BUCKET_8 ? 8 : 9)
                : (ms <= LATENCY_BUCKET_10 ? 10 : 11)
            )
            : (ms <= LATENCY_BUCKET_13
                ? (ms <= LATENCY_BUCKET_12 ? 12 : 13)
                : (ms <= LATENCY_BUCKET_14 ? 14 : 15)
            )
        )
    );

    const latency = entry.latency;
    latency.hist[bucket]++;
    latency.sum += ms;
    if (ms < latency.min) latency.min = ms;
    if (ms > latency.max) latency.max = ms;
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
    const teatime = `@${time}#${seq}`;

    if (dissident) {
        client.logger.debug({
            event: "snapshot-dissident",
            teatime,
            hash,
            data: url,
            dissident: JSON.stringify(dissident),
        }, "dissident snapshot");
        return;
    }

    // to decide if the announced snapshot deserves to replace the existing one we
    // compare times rather than message seq, since (at least in principle) a new
    // snapshot can be taken after some elapsed time but no additional external messages.
    if (time <= island.snapshotTime) {
        client.logger.debug({
            event: "snapshot-ignored",
            teatime,
            hash,
            data: url
        }, "ignoring snapshot");
        return;
    }

    client.logger.debug({
        event: "snapshot",
        teatime,
        hash,
        data: url
    }, "got snapshot");

    if (island.syncWithoutSnapshot || island.snapshotUrl) {
        // forget older messages, setting aside the ones that need to be stored
        let messagesToStore = [];
        const msgs = island.messages;
        if (msgs.length > 0) {
            const firstToKeep = msgs.findIndex(msg => after(seq, msg[1]));
            if (firstToKeep > 0) {
                island.logger.trace({
                    event: "purging-messages",
                    fromSeq: msgs[0][1] >>> 0,
                    toSeq: msgs[firstToKeep - 1][1] >>> 0,
                    keepSeq: msgs[firstToKeep][1] >>> 0,
                    msgCount: msgs.length,
                }, `forgetting ${firstToKeep} of ${msgs.length} messages`);
                messagesToStore = msgs.splice(0, firstToKeep); // we'll store all those we're forgetting
            } else if (firstToKeep === -1) {
                island.logger.trace({
                    event: "purging-messages",
                    fromSeq: msgs[0][1] >>> 0,
                    toSeq: msgs[msgs.length - 1][1] >>> 0,
                    msgCount: msgs.length,
                }, `forgetting all of ${msgs.length} messages`);
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
            island.logger.debug({
                event: "upload-messages",
                fromSeq: firstSeq,
                toSeq: seq,
                path: logName,
            }, `uploading ${messagesToStore.length} messages #${firstSeq} to #${seq} as ${logName}`);
            uploadJSON(logName, messageLog).catch(err => island.logger.error({event: "upload-messages-failed", err}, `failed to upload messages. ${err.code}: ${err.message}`));
        }
    } else if (island.startClient === client) {
        // the initial snapshot from the user we sent START (only old clients)
        client.logger.debug({event: "init-time", teatime}, `init ${teatime} from SNAP (old client)`);
        island.time = time;
        island.scaledStart = stabilizedPerformanceNow() - island.time / island.scale;
        island.seq = seq;
        announceUserDidJoin(client);
    } else {
        // this is the initial snapshot, but it's an even older client (<=0.2.5) that already requested TICKS()
        client.logger.debug({event: "init-time", teatime}, `not initializing time from snapshot (very old client)`);
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
    const { developerId, region, appId, persistentId } = island;
    if (!appId || !persistentId) { client.safeClose(...REASON.BAD_APPID); return; }

    // clients since 0.5.1 will send only persistTime in place of time, seq, tuttiSeq
    const { persistTime, time, seq, tuttiSeq, url, dissident } = args; // details of the persistent data that has been uploaded
    const descriptor = persistTime === undefined ? `@${time}#${seq} T${tuttiSeq}` : `@${persistTime}`;

    if (dissident) {
        client.logger.debug({
            event: "persist-dissident",
            persistTime: descriptor,
            data: url,
            dissident: JSON.stringify(dissident),
        }, "dissident persistent data");
        return;
    }

    client.logger.debug({
        event: "persist",
        persistTime: descriptor,
        data: url,
    }, "got persistent data");

    // do *not* change our own session's persistentUrl!
    // we only upload this to be used to init the next session of this island
    if (STORE_PERSISTENT_DATA) {
        const saved = { url };
        const bucket = developerId ? FILE_BUCKETS[region] || FILE_BUCKETS.default : SESSION_BUCKET;
        const path = developerId ? `u/${developerId}/${appId}/${persistentId}/saved.json` : `apps/${appId}/${persistentId}.json`;
        uploadJSON(path, saved, bucket)
        .then(() => client.logger.debug({event: "persist-uploaded", persistTime: descriptor, data: url, region, bucket: bucket.name, path}, "uploaded persistent data"))
        .catch(err => client.logger.error({event: "persist-failed", persistTime: descriptor, data: url, region, bucket: bucket.name, path, err}, `failed to record persistent-data upload. ${err.code}: ${err.message}`));
    }
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
            island.logger.warn({
                event: "request-snapshot",
                msgCount: island.messages.length,
            }, `reached ${island.messages.length} messages, sending REQU`);
            REQU(island);
            // send warnings if safety buffer is less than 25%
            if (headroom < (MAX_MESSAGES - REQU_SNAPSHOT) / 4) INFO(island, {
                code: "SNAPSHOT_NEEDED",
                msg: `Reflector message buffer almost full. Need snapshot ASAP.`,
                options: { level: "warning" }
            });
        }
    }

    const time = advanceTime(island, "SEND");
    if (island.delay) {
        const delay = island.lastTick + island.delay + 0.1 - time;    // add 0.1 ms to combat rounding errors
        if (island.delayed || delay > 0) { DELAY_SEND(island, delay, messages); return; }
    }
    for (const message of messages) {
        // message = [time, seq, payload, ...] - keep whatever controller.sendMessage sends
        message[0] = time;
        message[1] = island.seq = (island.seq + 1) >>> 0; // seq is always uint32
        if (island.flags.rawtime) {
            const rawTime = getRawTime(island);
            message[message.length - 1] = rawTime; // overwrite the latency information from the controller
        }
        const msg = JSON.stringify({ id: island.id, action: 'RECV', args: message });
        island.logger.trace({event: "broadcast-message", t: time, seq: island.seq}, `broadcasting RECV ${JSON.stringify(message)}`);
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
            island.logger.trace({ event: "debounce-suppressed", message: JSON.stringify(message)}, `debounce suppressed: ${JSON.stringify(message)}`);
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
    // clients instead use a seventh argument that is a tutti key made up of a
    // message topic or placeholder such as "snapshot" or "persist", suffixed with
    // the sendTime.
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
        if (missing) island.logger.debug({
            event: "tutti-missing",
            tutti: keyOrSeq,
            missingCount: missing
        }, `missing ${missing} ${missing === 1 ? "client" : "clients"} from tally ${keyOrSeq}`);
        if (wantsVote || Object.keys(tally.payloads).length > 1) {
            const payloads = { what: 'tally', sendTime, tally: tally.payloads, tallyTarget, missingClients: missing };
            // only include the tuttiSeq if the client didn't provide a tuttiKey
            if (tuttiKey) payloads.tuttiKey = tuttiKey;
            else payloads.tuttiSeq = tuttiSeq;
            const msg = [0, 0, payloads];
            if (island.flags.rawtime) msg.push(0); // will be overwritten with time value
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
            client.logger.debug({event: "tutti-reject", tutti: keyOrSeq}, `rejecting vote for old tally ${keyOrSeq} (${island.time - sendTime}ms)`);
            return;
        }
        if (island.completedTallies[keyOrSeq]) {
            client.logger.debug({event: "tutti-reject", tutti: keyOrSeq},  `rejecting vote for completed tally ${keyOrSeq}`);
            return;
        }

        if (firstMsg) {
            const sendableMsg = [...firstMsg];
            if (island.flags.rawtime) sendableMsg.push(0); // will be overwritten with time value
            SEND(island, [sendableMsg]);
        }

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
        island.logger.trace({event: "delay-send", delay}, `last tick: @${island.lastTick}, delaying for ${delay} ms`);
    }
    island.delayed.push(...messages);
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
    const { clients, usersJoined, usersLeft, heraldUrl } = island;
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
        if (island.flags.rawtime) msg.push(0); // will be overwritten with time value
        SEND(island, [msg]);
        island.logger.debug({
            event: "send-users",
            joinedCount: usersJoined.length,
            leftCount: usersLeft.length,
            activeCount: active,
            clientCount: total,
            allSessionCount: ALL_ISLANDS.size,
            allClientCount: server.clients.size,
        }, `Users: +${usersJoined.length}-${usersLeft.length}=${active}/${total} (total ${ALL_ISLANDS.size} islands, ${server.clients.size} users)`);
    }
    if (heraldUrl) heraldUsers(island, activeClients.map(each => each.user), payload.joined, payload.left);
    usersJoined.length = 0;
    usersLeft.length = 0;
}

/** send back arguments as received.  iff the "rawtime" feature has been enabled for this client's session, and the client has supplied an object argument, add the time as a rawTime property on that object */
function PONG(client, args) {
    const island = client.island || ALL_ISLANDS.get(client.sessionId);
    if (island && island.flags.rawtime && typeof args === 'object') {
        const rawTime = getRawTime(island);
        args.rawTime = rawTime;
args.perfNowAdjust = performanceNowAdjustment; // DEBUG
    }
    client.safeSend(JSON.stringify({ action: 'PONG', args }));
}

/** send a TICK message to advance time
 * @param {IslandData} island
 */
function TICK(island) {
    // we will send ticks if a client has joined, and the socket is open, and it is not backlogged
    const sendingTicksTo = client => client.active && client.readyState === WebSocket.OPEN && !client.bufferedAmount;
    // avoid advancing time if nobody hears us
    let anyoneListening = false;
    for (const each of island.clients) if (sendingTicksTo(each)) {
        anyoneListening = true;
        break;
    }
    if (!anyoneListening) return; // probably in provisional island deletion

    const time = advanceTime(island, "TICK");
    // const { id, lastMsgTime, tick, scale } = island;
    // if (time - lastMsgTime < tick * scale) return;
    island.lastTick = time;
    const msg = JSON.stringify({ id: island.id, action: 'TICK', args: time });
    prometheusTicksCounter.inc();
    island.clients.forEach(client => {
        // only send ticks if joined and not back-logged
        if (sendingTicksTo(client)) {
            client.safeSend(msg);
            STATS.TICK++;
        }
    });
}

/** send REQU to all clients */
function REQU(island) {
    const msg = JSON.stringify({ id: island.id, action: 'REQU' });
    island.clients.forEach(client => client.active && client.safeSend(msg));
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
    const { tick, delay, scale } = args; // jan 2022: for all recent clients, scale is undefined
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_ISLAND); return; }
    if (!island.syncWithoutSnapshot && !island.snapshotUrl) {
         // this must be an old client (<=0.2.5) that requests TICKS before sending a snapshot
        const { time, seq } = args;
        island.logger.debug({event: "init-time", teatime: `@${time}#${seq}`}, "init from TICKS (old client)");
        island.time = typeof time === "number" ? Math.ceil(time) : 0;
        island.scaledStart = stabilizedPerformanceNow() - island.time / island.scale; // will be re-calculated below
        island.seq = typeof seq === "number" ? seq : 0;
        announceUserDidJoin(client);
    }
    if (delay > 0) island.delay = delay;
    const currentScaledTime = getScaledTime(island);
    let scaleToApply = 1;
    if (scale !== undefined && scale > 0) scaleToApply = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    island.scale = scaleToApply;
    // we maintain the scaledStart property at full precision, so there should be no
    // risk of time slipping back even by 1ms when scale is changed.
    island.scaledStart = stabilizedPerformanceNow() - currentScaledTime / scaleToApply;
    if (tick > 0) startTicker(island, tick);
}

function startTicker(island, tick) {
    island.logger.trace({event: "start-ticker", tick}, `${island.ticker ? "restarting" : "started"} ticker: ${tick} ms`);
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
        island.logger.debug({
            event: "heralding",
            heraldId: payload.time,
            endpoint: heraldUrl,
            bytes: body.length,
        }, `heralding users ${logdetail} ${body.length} bytes to ${heraldUrl}`);
        const response = await fetch(heraldUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            size: 512, // limit response size
        });
        success = response.ok;
        if (success) {
            island.logger.debug({
                event: "heralded",
                heraldId: payload.time,
                endpoint: heraldUrl,
                responseStatus: response.status,
                responseStatusText: response.statusText,
            }, `heralding success ${payload.time}: ${response.status} ${response.statusText}`);
        } else {
            island.logger.warn({
                event: "herald-failed",
                heraldId: payload.time,
                endpoint: heraldUrl,
                responseStatus: response.status,
                responseStatusText: response.statusText,
            }, `heralding failed ${payload.time}: ${response.status} ${response.statusText}`);
            INFO(island, {
                code: "HERALDING_FAILED",
                msg: `POST ${body.length} bytes to heraldUrl "${heraldUrl}" failed: ${response.status} ${response.statusText}`,
                options: { level: "warning" }
            });
        }
    } catch (err) {
        island.logger.error({
            event: "herald-error",
            heraldId: payload.time,
            endpoint: heraldUrl,
            err,
        }, `heralding error ${payload.time}: ${err.message}`);
        if (!success) INFO(island, {
            code: "HERALDING_FAILED",
            msg: `POST ${body.length} bytes to heraldUrl "${heraldUrl}" failed: ${err.message}`,
            options: { level: "error" }
        });
    }
}

// impose a delay on island deletion, in case clients are only going away briefly
function provisionallyDeleteIsland(island) {
    const { id } = island;
    const session = ALL_SESSIONS.get(id);
    if (!session) {
        island.logger.debug({event: "delete-ignored", reason: "session-missing"}, `ignoring deletion of missing session`);
        return;
    }
    if (session.stage !== 'running') {
        island.logger.debug({event: "delete-ignored", reason: `stage=${session.stage}`}, `ignoring out-of-sequence deletion (stage=${session.stage})`);
        return;
    }
    session.stage = 'closable';
    island.logger.debug({
        event: "schedule-delete",
        delay: DELETION_DEBOUNCE,
    }, `provisionally scheduling session end`);
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
        island.logger.debug({event: "delete-ignored", reason: "already-deleted"}, `island already deleted, ignoring deleteIsland();`);
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

    island.logger.notice({event: "end"}, `island deleted`);

    // remove session, including deleting dispatcher record if there is one
    // (deleteIsland is only ever invoked after at least long enough to
    // outlast the record's retention limit).
    const teatime = `@${time}#${seq}`;
    const unregistered = unregisterSession(id, teatime);

    // if we've been told of a snapshot since the one (if any) stored in this
    // island's latest.json, or there are messages since the snapshot referenced
    // there, write a new latest.json.
    if (STORE_SESSION && (syncWithoutSnapshot || snapshotUrl) && (snapshotUrl !== storedUrl || after(storedSeq, seq))) {
        const fileName = `${id}/latest.json`;
        island.logger.debug({
            event: "upload-latest",
            teatime,
            msgCount: messages.length,
            path: fileName,
        }, `uploading latest.json with ${messages.length} messages`);
        cleanUpCompletedTallies(island);
        const latestSpec = {};
        savableKeys(island).forEach(key => latestSpec[key] = island[key]);
        try {
            await uploadJSON(fileName, latestSpec);
        } catch (err) {
            island.logger.error({
                event: "upload-latest-failed",
                teatime,
                msgCount: messages.length,
                path: fileName,
                err
            }, `failed to upload latest.json. ${err.code}: ${err.message}`);
        }
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
        if (!session) {
            global_logger.debug({
                sessionId: id,
                event: "delete-ignored",
                reason: "session-missing",
                detail,
            }, `ignoring shutdown (${detail}): no session record`);
            return;
        }
        if (session.stage !== 'runnable' && session.stage !== 'closable') {
            session.logger.debug({event: "delete-ignored", reason: `stage=${session.stage}`, detail}, `ignoring shutdown (${detail}): stage=${session.stage}`);
            return;
        }
        session.logger.debug({event: "delete", detail}, `shutting down session - ${detail}`);
        if (session.stage === 'closable') {
            // there is (supposedly) an island, but it has no clients
            const island = ALL_ISLANDS.get(id);
            if (island) {
                deleteIsland(island); // will invoke unregisterSession
                return;
            }
            session.logger.debug({
                event: "delete-ignored",
                reason: "island-missing",
                detail,
            }, `stage=closable but no island to delete`);
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
        global_logger.debug({sessionId: id, event: "unregister-ignored", reason, detail}, `ignoring unregister: ${reason}`);
        return;
    }

    session.logger.debug({event: "unregister", detail}, `unregistering session - ${detail}`);

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
        if (err.code === 404) session.logger.info({event: "unregister-failed", err}, `failed to unregister. ${err.code}: ${err.message}`);
        else session.logger.warn({event: "unregister-failed", err}, `failed to unregister. ${err.code}: ${err.message}`);
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


server.on('error', err => global_logger({event: "server-socket-error", err}, `Server Socket Error: ${err.message}`));

server.on('connection', (client, req) => {
    const { version, sessionId, token } = parseUrl(req);
    // set up client meta data (also used for logging)
    client.sessionId = sessionId;
    client.since = Date.now();
    const addr = req.socket.remoteAddress.replace(/^::ffff:/, '');
    const port = req.socket.remotePort;
    client.meta = {
        scope: "connection",
        connection: `${addr}:${port}`,
        dispatcher: req.headers['x-croquet-dispatcher'],
        userIp: (req.headers['x-forwarded-for'] || '').split(',')[0].replace(/^::ffff:/, '') || addr,
    };
    // location header is added by load balancer, see region-servers/apply-changes
    if (req.headers['x-location']) try {
        const [region, city, lat, lng] = req.headers['x-location'].split(",");
        client.meta.location = { region };
        if (city) client.meta.location.city = { name: city, lat: +lat, lng: +lng };
    } catch (ex) { /* ignore */}

    if (!sessionId) {
        global_logger.warn({ event: "request-session-missing", ...client.meta, url: req.url }, `Missing session id in request "${req.url}"`);
        client.close(...REASON.BAD_PROTOCOL); // safeClose doesn't exist yet
        return;
    }

    let session = ALL_SESSIONS.get(sessionId);
    if (session) {
        switch (session.stage) {
            case 'closed':
                // a request to delete the dispatcher record has already been
                // sent.  tell client to ask the dispatchers again.
                session.logger.info({ event: "session-unregistered", ...client.meta }, "rejecting connection; session has been unregistered");
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
            .then(() => global_logger.info({event: "dummy-register"}, `dummy dispatcher record created in ${Date.now() - start}ms`))
            .catch(err => global_logger.error({event: "dummy-register-failed", err}, `failed to create dummy dispatcher record. ${err.code}: ${err.message}`));
        }
        const earliestUnregister = Date.now() + unregisterDelay;
        session = {
            stage: 'runnable',
            earliestUnregister,
            logger: empty_logger.child({
                ...global_logger.bindings(),
                scope: "session",
                sessionId,
            }),
        };
        ALL_SESSIONS.set(sessionId, session);
        scheduleShutdownIfNoJoin(sessionId, earliestUnregister, "no JOIN in time");
    }
    prometheusConnectionGauge.inc(); // connection accepted
    client.logger = empty_logger.child({...session.logger.bindings(), ...client.meta});
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
        try {
            client.close(code, data);
        } catch (err) {
            client.logger.error({event: "close-failed", err}, `failed to close client socket. ${err.code}: ${err.message}`);
            clientLeft(client); // normally invoked by onclose handler
        }
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
    // connection log sink filters on scope="connection" and event="start|join|end"
    const forwarded = `via ${req.headers['x-croquet-dispatcher']} (${(req.headers['x-forwarded-for'] || '').split(/\s*,\s*/).map(a => a.replace(/^::ffff:/, '')).join(', ')}) `;
    client.logger.notice({ event: "start", token, url: req.url }, `opened connection ${version} ${forwarded||''}${req.headers['x-location']||''}`);
    STATS.USERS = Math.max(STATS.USERS, server.clients.size);

    let lastActivity = Date.now();
    client.on('pong', time => {
        lastActivity = Date.now();
        const latency = lastActivity - time;
        client.logger.debug({event: "pong", latency}, `receiving pong after ${latency} ms`);
        });
    setTimeout(() => client.readyState === WebSocket.OPEN && client.ping(Date.now()), 100);

    let joined = false;
    if (DISCONNECT_UNRESPONSIVE_CLIENTS) {
        function checkForActivity() {
            if (client.readyState !== WebSocket.OPEN) return;
            const now = Date.now();
            const quiescence = now - lastActivity;
            if (quiescence > DISCONNECT_THRESHOLD) {
                client.logger.debug({event: "disconnecting", reason: "inactive", quiescence}, `inactive for ${quiescence} ms, disconnecting`);
                client.safeClose(...REASON.INACTIVE); // NB: close event won't arrive for a while
                return;
            }
            let nextCheck = CHECK_INTERVAL;
            if (quiescence > PING_THRESHOLD) {
                if (!joined) {
                    client.logger.debug({event: "disconnecting", reason: "no-join", quiescence}, `did not join within ${quiescence} ms, disconnecting`);
                    client.safeClose(...REASON.NO_JOIN);
                    return;
                }

                // joined is true, so client.island must have been set up
                if (!client.island.noInactivityPings) {
                    client.logger.debug({event: "ping", quiescence}, `inactive for ${quiescence} ms, sending ping`);
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
            } catch (err) {
                client.logger.error({event: "message-parsing-failed", err, incomingMsg}, `message parsing error: ${err.message}`);
                client.safeClose(...REASON.MALFORMED_MESSAGE);
                return;
            }
            try {
                const { action, args, tags } = parsedMsg;
                switch (action) {
                    case 'JOIN': { joined = true; JOIN(client, args); break; }
                    case 'SEND': {
                        const latency = args[args.length - 1];  // might be modified in-place by rawtime logic
                        if (tags) SEND_TAGGED(client.island, args, tags);
                        else SEND(client.island, [args]); // SEND accepts an array of messages
                        if (latency > 0) recordLatency(client, latency);  // record after broadcasting
                        break;
                    }
                    case 'TUTTI': TUTTI(client, args); break;
                    case 'TICKS': TICKS(client, args); break;
                    case 'SNAP': SNAP(client, args); break;
                    case 'SAVE': SAVE(client, args); break;
                    case 'PING': PONG(client, args); break;
                    case 'PULSE':  // sets lastActivity, otherwise no-op
                        if (args && args.latency > 0) recordLatency(client, args.latency); // not actually sent by clients yet
                        client.logger.trace({event: 'pulse'}, `receiving PULSE`);
                        break;
                    case 'LOG': {
                            const clientLog = typeof args === "string" ? args : JSON.stringify(args);
                            client.logger.info({
                                event: "client-log",
                                reason: clientLog.replace(/ .*/,''),
                                clientLog,
                            }, `LOG ${clientLog}`);
                        }
                        break;
                    default: client.logger.warn({
                        event: "unknown-action",
                        action: typeof action === "string" ? action : JSON.stringify(action),
                        incomingMsg
                    }, `unknown action ${JSON.stringify(action)}`);
                }
            } catch (err) {
                client.logger.error({event: "message-handling-failed", err}, `message handling failed: ${err.message}`);
                client.safeClose(...REASON.UNKNOWN_ERROR);
            }
        };

        if (ARTIFICIAL_DELAY) {
            const timeout = ARTIFICIAL_DELAY * (0.5 + Math.random());
            setTimeout(handleMessage, timeout);
        } else {
            handleMessage();
        }
    });

    client.on('close', (code, reason) => {
        prometheusConnectionGauge.dec();
        const island = client.island || ALL_ISLANDS.get(client.sessionId) || {};

        // connection log sink filters on scope="connection" and event="start|join|end"
        client.logger.notice({
            event: "end",
            stats: client.stats,
            code,
            reason,
            resumed: island.resumed, // to identify session starts
        }, `closed connection [${code},"${reason}"]`);

        if (island && island.clients && island.clients.has(client)) {
            if (island.startClient === client) {
                // old client
                client.logger.debug({event: "start-failed"}, "START client failed to respond");
                clearTimeout(island.startTimeout);
                island.startTimeout = null;
                island.startClient = null;
                // start next client
                START(island);
            }
            client.logger.debug({
                event: "schedule-delete",
                delay: island.leaveDelay,
            }, `scheduling client deletion in ${island.leaveDelay} ms`);
            setTimeout(() => clientLeft(client), island.leaveDelay);
        }
    });

    client.on('error', err => client.logger.error({event: "client-socket-error", err}, `Client Socket Error: ${err.message}`));
});

async function fetchSecret() {
    let secret;
    try {
        global_logger.info({event: "fetching-secret", name: SECRET_NAME}, "fetching secret");
        const version = await new SecretManagerServiceClient().accessSecretVersion({ name: SECRET_NAME });
        secret = version[0].payload.data;
    } catch (err) {
        global_logger.error({event: "fetch-secret-failed", err}, `failed to fetch secret: ${err.message}`);
        process.exit(1);
    }
    return secret;
}

async function verifyToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, SECRET, (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded);
        });
    });
}

const DEFAULT_SIGN_SERVER = "https://api.croquet.io/sign";
const DEV_SIGN_SERVER = "https://api.croquet.io/dev/sign";
const API_SERVER_URL = IS_DEV ? DEV_SIGN_SERVER : DEFAULT_SIGN_SERVER;

async function verifyApiKey(apiKey, url, appId, persistentId, id, sdk, client, unverifiedDeveloperId) {
    if (!VERIFY_TOKEN) return { developerId: unverifiedDeveloperId, region: "default" };
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
        const { developerId, region, error } = await response.json();
        if (developerId) {
            client.logger.info({event: "apikey-verified", developerId, region}, `API key verified`);
            return { developerId, region };
        }
        if (error) {
            client.logger.warn({event: "apikey-verify-failed", error}, `API key verification failed: ${error}`);
            const island = ALL_ISLANDS.get(id); // fetch island now, in case it went away during await
            // deal with no-island case
            INFO(island || {id}, {
                code: "KEY_VERIFICATION_FAILED",
                msg: error,
                options: { level: "error", only: "once" }
                },
                [client]);
            client.safeClose(...REASON.BAD_APIKEY);
        }
    } catch (err) {
        client.logger.error({event: "apikey-verify-error", err}, `error verifying API key: ${err.message}`);
    }
    return false;
}

/** fetch a JSON-encoded object from our storage bucket */
async function fetchJSON(filename, bucket=SESSION_BUCKET) {
    // somewhat of a hack to not having to guard the fetchJSON calls in JOIN()
    if (NO_STORAGE || (APPS_ONLY && !filename.startsWith('apps/'))) {
        return Promise.reject(Object.assign(new Error("fetch disabled"), { code: 404 }));
    }
    const file = bucket.file(filename);
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

let performanceNowAdjustment = 0;
function stabilizedPerformanceNow() { return performance.now() + performanceNowAdjustment; }

if (!TIME_STABILIZED) openToClients();
else {
    // to provide a close-to-real rate of advance of teatime and raw time on Docker, which has a known clock-drift issue that they work around with periodic NTP-based compensatory jumps of Date.now, we set aside about a minute at startup to watch for telltale jumps of Date.now against performance.now.  once we've seen two jumps (on MacOS they appear to happen 30s apart) we calculate a smoothed rate of drift and use that to start accumulating continuously an offset (performanceNowAdjustment) to be applied to all performance.now queries on this reflector.  at that point we open the reflector to client connections.  we continue to monitor the jumps, in case the rate of drift somehow changes.
    // if no jumps have been seen after the first 70s, that suggests that adjustments are not needed... so we go ahead and open to clients anyway.  but we keep checking, in case jumps are happening but on a sparser schedule.
    let serverStarted = false;
    const timeJumpHistory = []; // { date, jump, timeRatio }
    const baseDate = Date.now();
    let dateAdjustmentRatio = 0;
    let lastOffset = null;
    let lastCheck = null;
    function measureDatePerformanceOffset() {
        const now = Date.now();
        const perfNow = performance.now(); // could try to stabilise this too, but 2nd-order effects should be negligible
        const newOffset = now - perfNow;
        if (lastOffset !== null) {
            let ready = false; // ready for clients?
            const jump = newOffset - lastOffset;
            if (Math.abs(jump) > 2) { // only interested in real corrections
                const jumpRecord = { perfNow, jump };
                timeJumpHistory.push(jumpRecord);
                if (timeJumpHistory.length > 1) {
                    // accept the first gap between jumps as providing a reasonable starting point.
                    // thereafter, only replace dateAdjustmentRatio if the two latest jumps
                    // bespeak a ratio within 1% of each other.
                    const prev = timeJumpHistory[0];
                    // dateBoostRatio is the rate at which Docker has decided Date.now should be boosted relative to performance.now.  if it is positive (the Date jumps are positive), performance.now must be running behind.
                    const dateBoostRatio = jump / (perfNow - prev.perfNow);
                    jumpRecord.dateBoostRatio = dateBoostRatio;
                    if (prev.dateBoostRatio === undefined || Math.abs((dateBoostRatio - prev.dateBoostRatio) / dateBoostRatio) < 0.01) {
                        global_logger.notice({
                            event: "stabilization-result",
                        }, `performance time will be boosted by ${(dateBoostRatio * 100).toFixed(4)}%`);
                        dateAdjustmentRatio = dateBoostRatio;
                    }
                    timeJumpHistory.shift();
                    ready = true;
                }
            }
            if (!serverStarted) {
                const JUMP_CHECK_TIMEOUT = 70000; // start anyway if we haven't managed to calibrate in this time (on MacOS Docker we typically see a jump every 30s)
                if (ready || now - baseDate >= JUMP_CHECK_TIMEOUT) {
                    serverStarted = true;
                    openToClients();
                }
            }
        }
        lastOffset = newOffset;
        if (lastCheck !== null) {
            const gap = perfNow - lastCheck;
            // if dateAdjustmentRatio is positive, performance.now is running slow and should be boosted.
            const extraDateAdjustment = gap * dateAdjustmentRatio; // how much Docker would have boosted Date.now during this gap
            performanceNowAdjustment += extraDateAdjustment;
        }
        lastCheck = perfNow;
    }

    global_logger.notice({
        event: "stabilization-start",
    }, "starting time-stabilization watcher");
    setInterval(measureDatePerformanceOffset, 1000); // keeps going as long as the reflector is running
}

exports.server = server;
exports.Socket = WebSocket.Socket;
