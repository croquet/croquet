/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable object-shorthand */
/* eslint-disable prefer-arrow-callback */

const SYNCH_VERSION = "2.1.2";

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');
const { performance } = require('node:perf_hooks');
const WebSocket = require('ws');
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
    TIME_STABILIZED: "--time-stabilized",
    DEPIN: "--depin", // optionally followed by DePIN Registry arg, e.g. --depin localhost:8787
    SYNCNAME: "--sync-name",  // followed by a name, e.g. --sync-name abcd1234
    LAUNCHER: "--launcher",   // followed by a launch vehicle, e.g. --launcher app-1.2.1
    WALLET: "--wallet",       // followed by full wallet ID
    ACCOUNT: "--account",     // followed by a Multisynq account ID
};

const EXIT = {
    NORMAL: 0,         // a planned shutdown
    FATAL: 1,          // something unrecoverable (including syntax error in this file)
    SHOULD_RESTART: 2, // emergency shutdown; DePIN app can try to restart
    NEEDS_UPDATE: 3,   // DePIN registry rejected our registration
};

const knownArgs = Object.values(ARGS);
for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!knownArgs.includes(arg)) {
        // might be following an arg that can take a value
        const prevArg = process.argv[i - 1];
        if (![ARGS.DEPIN, ARGS.SYNCNAME, ARGS.WALLET, ARGS.ACCOUNT, ARGS.LAUNCHER].includes(prevArg)) {
            console.error(`Error: Unrecognized option ${arg}`);
            process.exit(EXIT.FATAL);
        }
    }
}

function parseArgWithValue(argKey) {
    if (process.argv.includes(argKey)) {
        const maybeValueArg = process.argv[process.argv.indexOf(argKey) + 1];
        return maybeValueArg && !maybeValueArg.startsWith('-') ? maybeValueArg : null;
    }
    return null;
}

let WALLET, ACCOUNT, DEV_MODE, LAUNCHER;
let DEPIN = process.argv.includes(ARGS.DEPIN);
if (DEPIN) {
    // value argument is optional (defaults to prod)
    const depinValue = parseArgWithValue(ARGS.DEPIN);
    if (depinValue) DEPIN = depinValue;

    WALLET = parseArgWithValue(ARGS.WALLET);
    ACCOUNT = parseArgWithValue(ARGS.ACCOUNT);
    // since 2.1.0, an account ID can be supplied even with a wallet (e.g., for tracking our
    // beta synqers).  but supplying an account ID _without_ a wallet implies developer mode,
    // as it always has.
    DEV_MODE = !!(ACCOUNT && !WALLET)

    if (!WALLET && !DEV_MODE) {
        // $$$ figure out what to do here.  for now, this will be the case for
        // all GCP-deployed synchronizers.  supply a default wallet.
        console.warn("No wallet specified for DePIN; using community default"); // no loggers yet
        WALLET = '5B3aFyxpnGY36fBeocsLfia5vgAUrbD5pTXorCcMeV7t';
    }

    LAUNCHER = parseArgWithValue(ARGS.LAUNCHER);
    if (!LAUNCHER) LAUNCHER = 'unknown';

    const walletStr = WALLET ? `wallet=${WALLET} ` : "";
    const accountStr = ACCOUNT ? `account=${ACCOUNT} ` : "";
    const devModeStr = DEV_MODE ? "developer mode " : "";
    console.log(`DePIN ${devModeStr}with ${walletStr}${accountStr}launched from ${LAUNCHER} on ${os.platform()} ${os.arch()}`);
}

function getRandomString(length) {
    return Math.random()
        .toString(36)
        .substring(2, 2 + length);
}
const SYNCNAME = parseArgWithValue(ARGS.SYNCNAME) || getRandomString(8) + getRandomString(8);

const GCP_PROJECT = process.env.GCP_PROJECT; // only set if we're running on Google Cloud

const NO_STORAGE = !!DEPIN || process.argv.includes(ARGS.NO_STORAGE); // no GCP bucket access (true on DePIN, because the session DO receives state)
const NO_DISPATCHER = NO_STORAGE || process.argv.includes(ARGS.STANDALONE); // no session deregistration
const APPS_ONLY = !NO_STORAGE && process.argv.includes(ARGS.APPS_ONLY); // no session resume
const USE_HTTPS = process.argv.includes(ARGS.HTTPS); // serve via https
const VERIFY_TOKEN = GCP_PROJECT && !process.argv.includes(ARGS.STANDALONE);
const STORE_SESSION = !NO_STORAGE && !APPS_ONLY;
const STORE_MESSAGE_LOGS = !NO_STORAGE && !APPS_ONLY;
const STORE_PERSISTENT_DATA = !NO_STORAGE;
const NO_LOGTIME = process.argv.includes(ARGS.NO_LOGTIME); // don't prepend the time to each log even when running locally
const PER_MESSAGE_LATENCY = !DEPIN && !process.argv.includes(ARGS.NO_LOGLATENCY); // log latency of each message
const TIME_STABILIZED = process.argv.includes(ARGS.TIME_STABILIZED); // watch for jumps in Date.now and use them to rescale performance.now (needed for Docker standalone)

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
    help: 'The number of client connections to the synchronizer.'
});
const prometheusSessionGauge = new prometheus.Gauge({
    name: 'reflector_sessions',
    help: 'The number of concurrent sessions on synchronizer.'
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

// the timeouts here are tuned to the expectations of the Croquet library.
// on DePIN they are not overridable by the registry.
const PORT = 9090;
const PROTOCOL_VERSION = "v1";
const SERVER_HEADER = `croquet-synchronizer-${PROTOCOL_VERSION}`;
const DELETION_DEBOUNCE = 10000; // time in ms to wait before deleting an island
const TICK_MS = 1000 / 5;     // default tick interval
const INITIAL_SEQ = 0xFFFFFFF0; // initial sequence number, must match island.js
const ARTIFICIAL_DELAY = 0;   // delay messages randomly by 50% to 150% of this
const MAX_MESSAGES = 100000;   // messages per island to retain since last snapshot
const REQU_SNAPSHOT = 60000;   // request a snapshot if this many messages retained
const MIN_SCALE = 1 / 64;     // minimum ratio of island time to wallclock time
const MAX_SCALE = 64;         // maximum ratio of island time to wallclock time
const TALLY_INTERVAL = 1000;  // maximum time to wait to tally TUTTI contributions
const MAX_TALLY_AGE = 60000;  // don't start a new tally if vote is more than this far behind
const MAX_COMPLETED_TALLIES = 20; // maximum number of past tallies to remember
const USERS_INTERVAL = 200;   // time to gather user entries/exits before sending a "users" message (a.k.a. view-join)
const CHECK_INTERVAL = 5000;        // how often to checkForActivity
const PING_THRESHOLD = 35000;       // if a pre-background-aware client is not heard from for this long, start pinging
const DISCONNECT_THRESHOLD = 60000; // if not responding for this long, disconnect
const DISPATCH_RECORD_RETENTION = 5000; // how long we must wait to delete a dispatch record (set on the bucket)
const LATE_DISPATCH_DELAY = 1000;  // how long to allow for clients arriving from the dispatcher even though the session has been deregistered

// if running locally, there is the option to run with or without using the session-
// related storage (for snapshots, dispatcher records etc).
// if "localWithStorage" is chosen, the synchronizer itself will create a dummy dispatcher
// record the first time it sees a session, and will delete it when the session is
// offloaded.
const LOCAL_CONFIG = NO_STORAGE ? "local" : "localWithStorage"; // todo: remove localWithStorage and use NO_STORAGE instead
const CLUSTER = fs.existsSync("/var/run/secrets/kubernetes.io") ? process.env.CLUSTER_NAME : LOCAL_CONFIG;
const CLUSTER_LABEL = process.env.CLUSTER_LABEL || CLUSTER;
const RUNNING_ON_LOCALHOST = CLUSTER.startsWith("local");
const HOSTNAME = os.hostname();
const HOSTIP = RUNNING_ON_LOCALHOST ? "localhost" : Object.values(os.networkInterfaces()).flat().filter(addr => !addr.internal && addr.family === 'IPv4')[0].address;
// const IS_DEV = RUNNING_ON_LOCALHOST || HOSTNAME.includes("-dev-");

if (!CLUSTER) {
    console.error("FATAL: no CLUSTER_NAME env var");
    process.exit(EXIT.FATAL);
}

const DISCONNECT_UNRESPONSIVE_CLIENTS = !RUNNING_ON_LOCALHOST;

// Map pino levels to GCP, https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
// the choice of log level currently follows no strict rules.  loosely:
//   - "error" for something that definitely shouldn't have happened
//   - "warn" for undesirable situations that can be coped with
//   - "notice" for salient states that will later be analysed to gather statistics (session length, etc)
//   - "info" for normal milestones in session and client management
//   - "debug" for less significant behind-the-scenes steps
const GCP_SEVERITY = {
    trace:  'DEFAULT',  // 10 default min on local
    meter:  'DEFAULT',  // 15 not a pino level, default min
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
    messageKey: 'message', // expected by at least GCP logger; may as well standardise
    timestamp: RUNNING_ON_LOCALHOST && !NO_LOGTIME,
    level: 'debug',
    customLevels: {
        meter: 15,
        notice: 35,
    },
    formatters: {
        level: label => (RUNNING_ON_LOCALHOST ? {level: label} : { severity: GCP_SEVERITY[label] || 'DEFAULT'}),
    },
});

// the global logger. we have per-session and per-connection loggers, too,
// but they are all children of the empty_logger to avoid duplication of
// properties in the JSON which causes problems in StackDriver
// (e.g. {scope: "session", scope: "connection"} arrives as {scope: "connect"})
const global_logger = empty_logger.child({ scope: "process", hostIp: HOSTIP });
// Logging out the initial start-up event message
const walletMsg = WALLET ? ` for wallet ${WALLET}` : '';
global_logger.notice({ event: "start", synchVersion: SYNCH_VERSION }, `synchronizer v${SYNCH_VERSION} started ${CLUSTER_LABEL} ${HOSTIP}${walletMsg}`);

// secret shared with sign cloud func
const SECRET_NAME = `projects/${GCP_PROJECT}/secrets/signurl-jwt-hs256/versions/latest`;
let SECRET;

// on GCP, we use Google Cloud Storage for session state
const storage = new Storage();

const SESSION_BUCKET = NO_STORAGE ? null
                        : GCP_PROJECT === 'croquet-proj' ? storage.bucket(`croquet-sessions-v1`)
                        : storage.bucket(`${GCP_PROJECT}-sessions-v1`);

const DISPATCHER_BUCKET = NO_DISPATCHER ? null
                            : GCP_PROJECT === 'croquet-proj' ? storage.bucket(`croquet-reflectors-v1`)
                            : storage.bucket(`${GCP_PROJECT}-reflectors-v1`);

// pointer to latest persistent data is stored in user buckets
// direct bucket access (instead of going via load-balancer as clients do)
// avoids CDN caching
const US_BUCKET = GCP_PROJECT === 'croquet-proj' ? 'files.us.croquet.io' : `files.us.${GCP_PROJECT}.croquet.dev`;
const EU_BUCKET = GCP_PROJECT === 'croquet-proj' ? 'files.eu.croquet.io' : `files.eu.${GCP_PROJECT}.croquet.dev`;
const FILE_BUCKETS = {
    us: STORE_PERSISTENT_DATA ? storage.bucket(US_BUCKET) : null,
    eu: STORE_PERSISTENT_DATA ? storage.bucket(EU_BUCKET) : null,
};
FILE_BUCKETS.default = FILE_BUCKETS.us;

// return codes for closing connection
// client wil try to reconnect for codes < 4100
const REASON = {};
REASON.UNKNOWN_SESSION = [4000, "unknown session"];
REASON.UNRESPONSIVE = [4001, "client unresponsive"];
REASON.INACTIVE = [4002, "client inactive"];
REASON.RECONNECT = [4003, "please reconnect"];  // also used in cloudflare synchronizer
// non-reconnect codes
REASON.BAD_PROTOCOL = [4100, "outdated protocol"];
REASON.BAD_APPID = [4101, "bad appId"];
REASON.MALFORMED_MESSAGE = [4102, "malformed message"];
REASON.BAD_APIKEY = [4103, "bad apiKey"];
REASON.UNKNOWN_ERROR = [4109, "unknown error"];
REASON.DORMANT = [4110, "dormant"]; // sent by client, will not display error
REASON.NO_JOIN = [4121, "client never joined"];

let server;

// ============ DEPIN-specific initialisation ===========

const depinTimeouts = {
    // these can all be overridden by the registry, on successful registration
    PROXY_STATUS_DELAY: 10_000,       // update this often when running sessions
    PROXY_PING_DELAY: 10_000,         // simple PINGs are handled by auto-response
    PROXY_KEEP_ALIVE_DELAY: 28_000,   // chosen so that when not running sessions, every 3rd PING is replaced by ALIVE
    PROXY_ACK_DELAY_LIMIT: 2000,      // after this, go into RECONNECTING
    PROXY_INTERRUPTION_LIMIT: 30_000, // after this, UNAVAILABLE
    PROXY_CONNECTION_LIMIT: 60_000,   // if no response at all on connection, try again
    PROXY_RECONNECT_DELAY_MAX: 30_000,

    SESSION_CONNECT_LIMIT: 4000,
    SESSION_UPDATE_DELAY: 250,
    SESSION_PING_DELAY: 1000,
    SESSION_SILENCE_LIMIT: 2000,   // after this time since last hearing from session runner, go into RECONNECTING
    SESSION_RECONNECT_LIMIT: 3000, // after this time in RECONNECTING, offload the session

    AUDIT_INTERVAL: 60_000,
};

// generate a key that will be passed to the proxy so it can detect and reject
// multiple independent connecting processes.
const NODE_PROCESS_KEY = getRandomString(6);

let sendToDepinProxy;
let registerRegion = ''; // the region registry this sync has been listed in
const depinCreditTallies = {
    // report as -1 until initialised from the proxy
    syncLifeTraffic: -1,  // lifetime bytes handled by this synq
    syncLifePoints: -1,   // lifetime points earned
    walletLifePoints: -1, // lifetime points added to wallet via any synq
    walletBalance: -1     // balance of that wallet, in SOL
}
let depinNumApps = 0;

async function startServerForDePIN() {
    // create a fake server.  startServerForWebSockets (below) makes an http/websocket
    // server that manages the socket connections from all clients, regardless of
    // which session they are joining.  this depin "server" performs the equivalent
    // role for all clients connecting via WebRTC.
    // in general the servers work rather differently - but for backwards compatibility,
    // this server object provides a meaningful value for
    //     server.clients.size
    // - which is the total number of clients connected to the synchronizer.  in
    // the non-DePIN case this is automatically available as the number of websockets
    // currently connected.
    //
    // we keep maps from client id to RTCPeerConnection and, separately, client id
    // to an object made by createClient() on opening of its data channel.  the latter
    // map is what we use for the total client count, given that a client isn't really
    // connected until the data channel is set up.
    //
    // to ensure that different sessions' clients are kept separate, the keys to
    // these maps are "global" ids composed from the sessionId (shortened) and clientId.
    //
    // oct 2024: creation of the server object used to be the last action of this function,
    // but was moved up front because we had seen cases where ICE-server initialisation was
    // slow, and (for example) the watchStats function crashed out for lack of a server.
    server = {
        peerConnections: new Map(), // global client id => peerConnection
        clients: new Map(),         // global client id => client object
        removeClient: function (globalClientId, reason) {
            // invoked from
            // - clientLeft, or
            // - on processing a DISCONNECT for a client that doesn't yet have a dataChannel, or
            // - on sessionSocketClosed - again, for clients that have no dataChannel
            const reasonMsg = reason ? ` (${reason})` : "";
            const connectedClient = this.clients.get(globalClientId);
            if (connectedClient) {
                try {
                    connectedClient.island = null; // checked in client close handler
                    connectedClient.close();
                    global_logger.debug({ event: "close-client-data-channel", globalClientId, reason }, `client ${globalClientId} data channel closed${reasonMsg}`);
                }
                catch (e) { /* */ }
                this.clients.delete(globalClientId);
            }

            const peerConnection = this.peerConnections.get(globalClientId);
            if (peerConnection) {
                try {
                    peerConnection.close(); // API suggests destroy(), but that doesn't exist??
                    global_logger.debug({ event: "close-client-peer-connection", globalClientId, reason }, `client ${globalClientId} peer connection closed${reasonMsg}`);
                }
                catch (e) { /* */ }
                this.peerConnections.delete(globalClientId);
            }
        }
    };

    // in advance, get the iceServers that we'll be using on all connections
    const iceServers = [];
    const response = await fetch(process.env.ICE_SERVERS_URL);
    // (previous) const response = await fetch(process.env.ICE_SERVERS_URL);
    const iceServersRaw = await response.json();

    /*
    Examples of what the node-datachannel setup is expecting
    STUN Server Example          : stun:stun.l.google.com:19302
    TURN Server Example          : turn:USERNAME:PASSWORD@TURN_IP_OR_ADDRESS:PORT
    TURN Server Example (TCP)    : turn:USERNAME:PASSWORD@TURN_IP_OR_ADDRESS:PORT?transport=tcp
    TURN Server Example (TLS)    : turns:USERNAME:PASSWORD@TURN_IP_OR_ADDRESS:PORT

    ...so we need to do some transforming on this kind of response:
    [   {"urls":"stun:stun.relay.metered.ca:80"},
        {"urls":"turn:standard.relay.metered.ca:80","username":"d05d...f84e","credential":"b3Da...G6sI"},
        {"urls":"turn:standard.relay.metered.ca:80?transport=tcp","username":"d05d...f84e","credential":"b3Da...G6sI"},
        {"urls":"turn:standard.relay.metered.ca:443","username":"d05d...f84e","credential":"b3Da...G6sI"},
        {"urls":"turns:standard.relay.metered.ca:443?transport=tcp","username":"d05d...f84e","credential":"b3Da...G6sI"}]
    */
    iceServersRaw.forEach(spec => {
        if (typeof spec === "string") iceServers.push(spec);
        else {
            const { urls, username, credential } = spec;
            if (!username) iceServers.push(urls);
            else {
                const splitUrl = urls.split(':');
                const type = splitUrl.shift();
                const newSpec = `${type}:${username}:${credential}@${splitUrl.join(':')}`;
                iceServers.push(newSpec);
            }
        }
    });

    global_logger.info({ event: "ice-servers", iceServers }, `set ICE servers: ${JSON.stringify(iceServers)}`);

    // note: API described at https://github.com/murat-dogan/node-datachannel/blob/c8197e28b39fd81f55818c0301995414fa877ff9/API.md
    // also see https://github.com/murat-dogan/node-datachannel/blob/c8197e28b39fd81f55818c0301995414fa877ff9/lib/index.d.ts

    // eslint-disable-next-line import/no-unresolved
    const nodeDataChannel = await import('node-datachannel'); // can't (and in fact don't want to) use static require()
    nodeDataChannel.initLogger('Warning'); // 'Verbose' | 'Debug' | 'Info' | 'Warning' | 'Error' | 'Fatal';
    nodeDataChannel.preload();

    // Signaling connection

    // Precedence: --depin command line arg, DEPIN env var, default
    const DEPIN_API_DEFAULT = 'wss://api.multisynq.io/depin';
    const DEPIN_API_DEV = 'wss://api.multisynq.dev/depin';
    const DEPIN_API_LOCAL = 'ws://localhost:8787';
    if (typeof DEPIN !== 'string') DEPIN = DEPIN_API_DEFAULT;
    if (DEPIN === 'prod') DEPIN = DEPIN_API_DEFAULT;
    else if (DEPIN === 'dev') DEPIN = DEPIN_API_DEV;
    else if (DEPIN === 'local') DEPIN = DEPIN_API_LOCAL;

    // be nice and accommodate a trailing slash, http(s)://, or missing protocol
    if (DEPIN.endsWith('/')) DEPIN = DEPIN.slice(0, -1);
    DEPIN = DEPIN.replace(/^http(s):/, 'ws$1:');
    if (!DEPIN.startsWith('ws')) DEPIN = 'ws://' + DEPIN;

    // a production synchronizer can only use bundled app code
    const UTILITY_APP_PATH = DEPIN === DEPIN_API_DEFAULT ? 'internal' : 'https://downloads.multisynq.dev';

    let proxyId;        // the ID of the worker running the proxy for this sync
    let proxySocket = null;
    let proxyConnectionState = 'RECONNECTING'; // "CONNECTED", "RECONNECTING", "UNAVAILABLE"
    const setProxyConnectionState = state => {
        global_logger.debug({ event: "proxy-connection-state", state }, `proxy connection state: "${state}"`);
        proxyConnectionState = state;
    };
    let proxyWasToldWeHaveSessions;
    let proxyWasToldWeHaveApps;
    let lastNonPingSent = Date.now();
    let proxyReconnectDelay = 0;
    let synchronizerUnavailableTimeout; // on synchronizer startup, and after any disconnection from the proxy, deadline for successful registration to avoid declaring this synchronizer unavailable and offloading any remaining sessions.  attempts to reconnect to the proxy will continue.

    // use proxyLatestConnectTime to tell which socket connection we're working with now, to
    // filter out events and timeouts relating to a socket that has since been replaced.
    let proxyLatestConnectTime;
    let proxyConnectResponseTimeout; // in case a connection attempt never comes back
    const sendToProxy = msgObject => {
        if (!proxySocket) return;
        if (proxySocket.readyState !== WebSocket.OPEN) {
            global_logger.warn({ event: "proxy-not-ready" }, `attempt to send ${msgObject.what} on unconnected proxy channel`);
            return;
        }

        proxySocket.send(JSON.stringify(msgObject));
    };
    sendToDepinProxy = sendToProxy;

    // set up a timeout to mark ourselves as UNAVAILABLE if connection/reconnection attempts remain unsuccessful for a total of PROXY_INTERRUPTION_LIMIT (currently 30s).
    // timeout is cleared on successful receipt of a REGISTERED message.
    // the UNAVAILABLE state will appear prominently in the app dashboard.
    function declareUnavailableAfterDelay(ms) {
        if (synchronizerUnavailableTimeout) clearTimeout(synchronizerUnavailableTimeout);

        synchronizerUnavailableTimeout = setTimeout(() => {
            if (aborted) return; // process was abandoned anyway

            // reconnection hasn't happened, so offload any remaining sessions (though attempts to reconnect will continue, at increasing intervals).
            global_logger.notice({ event: "proxy-connection-lost" }, 'Proxy reconnection timed out. Offloading any remaining sessions.');
            setProxyConnectionState('UNAVAILABLE');
            offloadAllSessions();
        }, ms);
    }
    declareUnavailableAfterDelay(depinTimeouts.PROXY_INTERRUPTION_LIMIT);

    const connectToProxy = () => {
        if (aborted) return; // probably on an old timeout

        if (proxyConnectResponseTimeout) clearTimeout(proxyConnectResponseTimeout); // remove any old one
        let proxyContactTimeout; // next time we should send a PING or STATS, as appropriate
        let proxyAckTimeout; // deadline for hearing back from the proxy
        proxyWasToldWeHaveSessions = false;
        proxyWasToldWeHaveApps = false;
        const thisConnectTime = proxyLatestConnectTime = Date.now();

        function contactProxy() {
            // first sent on successful receipt of REGISTERED from the proxy

            const isHandlingSessions = ALL_SESSIONS.size > 0; // whether active or not
            // if we aren't now but were before, send one last update with the zero sessions
            const isRunningApps = !!depinNumApps;
            const now = Date.now();
            const timeSinceLastNonPing = now - lastNonPingSent;
            if (isHandlingSessions || proxyWasToldWeHaveSessions || isRunningApps || proxyWasToldWeHaveApps) {
                const statsAggregationSeconds = Math.max(1, timeSinceLastNonPing / 1000);
                sendToProxy({ what: 'STATUS', status: statusForProxy(statsAggregationSeconds) });
                lastNonPingSent = now;
                contactProxyAfterDelay(depinTimeouts.PROXY_STATUS_DELAY);
            } else {
                if (timeSinceLastNonPing > depinTimeouts.PROXY_KEEP_ALIVE_DELAY) {
                    sendToProxy({ what: 'ALIVE' }); // wake up the DO and say we're alive
                    lastNonPingSent = now;
                } else {
                    sendToProxy({ what: 'PING' }); // proxy looks for exactly the string '{"what":"PING"}'
                }
                contactProxyAfterDelay(depinTimeouts.PROXY_PING_DELAY);
            }
            proxyWasToldWeHaveSessions = isHandlingSessions;
            proxyWasToldWeHaveApps = isRunningApps;

            // set up a timeout within which we expect to receive an acknowledgement from the proxy.
            // the timeout is cleared by receipt of ACK or PONG.
            proxyAckTimeout = setTimeout(() => {
                if (aborted || thisConnectTime !== proxyLatestConnectTime) return; // connection superseded, or process abandoned

                // no ack received in time.  force a socket disconnection, which will trigger reconnection attempts with increasing backoff.
                global_logger.info({ event: "proxy-connection-timeout" }, 'acknowledgement from proxy timed out. Reconnecting.');
                clearTimeout(proxyContactTimeout); // don't contact again until we figure out what's going on
                try {
                    proxySocket.close(1000, "proxy acknowledgement timed out");
                    proxySocket.terminate(); // otherwise 'close' event might not be raised for 30 seconds; see https://github.com/websockets/ws/issues/2203
                } catch (err) { /* ignore */ }

            }, depinTimeouts.PROXY_ACK_DELAY_LIMIT);
        }

        function contactProxyAfterDelay(ms) {
            proxyContactTimeout = setTimeout(() => {
                if (aborted || thisConnectTime !== proxyLatestConnectTime) return; // connection superseded, or process abandoned

                contactProxy();
            }, ms);
        }

        const proxyUrl = new URL(`${DEPIN}/synchronizers/register`);
        const { searchParams } = proxyUrl;
        searchParams.set('launcher', LAUNCHER);
        searchParams.set('version', SYNCH_VERSION);
        searchParams.set('nickname', SYNCNAME);
        searchParams.set('processKey', NODE_PROCESS_KEY);
        searchParams.set('connectTime', proxyLatestConnectTime);
        if (registerRegion) searchParams.set('registerRegion', registerRegion);
        if (WALLET) searchParams.set('wallet', WALLET);
        if (ACCOUNT) searchParams.set('account', ACCOUNT);
        proxySocket = new WebSocket(proxyUrl.toString(), {
            perMessageDeflate: false, // this was in the node-datachannel example; not sure if it's helping
        });

        // under the websocket protocol, the far end can swallow a connection attempt without us ever hearing anything about it.  after waiting a while (default is 60s), try again.
        proxyConnectResponseTimeout = setTimeout(() => {
            global_logger.warn({ event: "proxy-connection-timeout" }, `proxy connection was silently ignored; retrying.`);
            connectToProxy();
        }, depinTimeouts.PROXY_CONNECTION_LIMIT);

        proxySocket.on('open', () => {
            if (thisConnectTime !== proxyLatestConnectTime) return; // this connection has (somehow, already) been superseded

            clearTimeout(proxyConnectResponseTimeout);
            proxyConnectResponseTimeout = null;

            global_logger.info({ event: "proxy-connected", registry: DEPIN },`proxy socket connected in registry ${DEPIN}`);
        });

        proxySocket.on('error', function onError(err) {
            if (thisConnectTime !== proxyLatestConnectTime) return; // this connection has been superseded

            if (err.code === 'ECONNREFUSED') {
                global_logger.error({ event: "proxy-connection-refused" }, `proxy socket connection refused`);
            } else {
                global_logger.error({ event: "proxy-connection-error", err }, `proxy socket error: ${err}`);
            }
        });

        proxySocket.on('message', function onMessage(depinStr) {
            if (thisConnectTime !== proxyLatestConnectTime) return; // this connection has been superseded

            try {
                const depinMsg = JSON.parse(depinStr);
                switch (depinMsg.what) {
                    case "REGISTERED": {
                        proxyId = depinMsg.proxyId;
                        const { registerRegion: newRegisterRegion, ip, lifeTraffic, lifePoints, timeoutSettings } = depinMsg;
                        const shortProxyId = proxyId.slice(0, 8);
                        if (registerRegion && registerRegion !== newRegisterRegion) {
                            global_logger.notice({ event: "registered", shortProxyId, oldRegisterRegion: registerRegion, registerRegion: newRegisterRegion, ip }, `proxy id ${shortProxyId} moved from ${registerRegion} to ${newRegisterRegion}`);
                        } else {
                            global_logger.notice({ event: "registered", shortProxyId, registerRegion: newRegisterRegion, ip }, `proxy id ${shortProxyId} registered in ${newRegisterRegion}`);
                        }
                        registerRegion = newRegisterRegion;

                        if (timeoutSettings) {
                            let overrides = [];
                            for (const [k, v] of Object.entries(timeoutSettings)) {
                                if (depinTimeouts[k] !== v) {
                                    depinTimeouts[k] = v;
                                    overrides.push([k, v]);
                                }
                            }
                            if (overrides.length) {
                                global_logger.notice({ event: "timeout-overrides", overrides }, `${overrides.map(([key, val]) => `${key}=${val}`).join(', ')}`);
                            }
                        }

                        // don't be too hasty to reset the reconnection delay, because
                        // even when registration goes through we may be seconds away
                        // from another glitch.  so wait 1 minute, and only reset if the
                        // same proxy connection has remained in play up to that point.
                        setTimeout(() => {
                            if (thisConnectTime === proxyLatestConnectTime) proxyReconnectDelay = 0;
                        }, 60_000);

                        setProxyConnectionState('CONNECTED');
                        // be sure to cancel any timeout that would take us to UNAVAILABLE
                        clearTimeout(synchronizerUnavailableTimeout);
                        contactProxy(); // immediately PING

                        // set up latest tallies announced by the proxy,
                        // in time for the electron app pulling stats.
                        // wallet life points will come later.
                        depinCreditTallies.syncLifeTraffic = lifeTraffic;
                        depinCreditTallies.syncLifePoints = lifePoints;

                        // if there is a connected parent process (assumed to be Electron),
                        // give it some details now.
                        const electronMain = process.parentPort;
                        electronMain?.postMessage({ what: 'syncDetails', ip, version: SYNCH_VERSION, region: registerRegion });
                        break;
                    }
                    case "SESSION": {
                        const { sessionId, dispatchSeq, canEarnCredit } = depinMsg;
                        const shortSessionId = sessionId.slice(0, 8);
                        const session = ALL_SESSIONS.get(sessionId);
                        if (session) {
                            // if we already (i.e., still) have the session, ignore the
                            // request but update our session tracker to curtail any
                            // reconnection attempts from this end.  in a few seconds the
                            // session-runner will try a different synq.
                            // $$$ figure out whether an attempt to offload on expiry of
                            // a reconnection timeout will cause problems at the session
                            // runner.
                            global_logger.debug({ event: "dispatch-ignored", sessionId },`ignoring session dispatch for ${shortSessionId}; already being handled here`);
                            session.updateTracker.dispatchSeq = dispatchSeq;
                        } else {
                            global_logger.notice({ event: "dispatch", sessionId }, `new session dispatch for ${shortSessionId}`);
                            acceptSession(sessionId, dispatchSeq, canEarnCredit);
                        }
                        break;
                    }
                    case 'ACK':
                    case 'PONG':
                        clearTimeout(proxyAckTimeout);
                        break;
                    case 'DEMO_TOKEN': {
                        const { token } = depinMsg;
                        const electronMain = process.parentPort;
                        electronMain?.postMessage({ what: 'demoToken', token });
                        break;
                    }
                    case 'DEVELOPER_TOKEN': {
                        const { token } = depinMsg;
                        const electronMain = process.parentPort;
                        electronMain?.postMessage({ what: 'developerToken', token });
                        break;
                    }
                    case 'UPDATE_TALLIES': {
                        const { lifeTraffic, lifePoints, walletPoints, walletBalance } = depinMsg;
                        depinCreditTallies.syncLifeTraffic = lifeTraffic;
                        depinCreditTallies.syncLifePoints = lifePoints;
                        depinCreditTallies.walletLifePoints = walletPoints;
                        depinCreditTallies.walletBalance = walletBalance
                        break;
                    }
                    case 'STATS': {
                        // these are just copies of the stats made available by a
                        // standard WebSocket reflector
                        const { type, options } = depinMsg;
                        switch (type) {
                            case 'metrics':
                                gatherMetricsStats(options).then(metrics => sendStats('metrics', metrics));
                                break;
                            case 'sessions':
                                sendStats('sessions', gatherSessionsStats());
                                break;
                            case 'users':
                                sendStats('users', gatherUsersStats(options));
                                break;
                            case 'healthz':
                            default:
                                sendStats('healthz', `Multisynq synchronizer-${PROTOCOL_VERSION}`);
                                break;
                        }
                        break;
                    }
                    case 'RUN-APP': {
                        const { appName, synchSpec, testKey } = depinMsg;
                        startUtilityApp(UTILITY_APP_PATH, appName, synchSpec, testKey );
                        break;
                    }
                    case 'ERROR':
                        switch (depinMsg.reason) {
                            case 'VERSION-INVALID':
                                global_logger.warn({ event: "exit-needs-update", version: depinMsg.details.version }, `invalid synchronizer version ${depinMsg.details.version}`);
                                process.exit(EXIT.NEEDS_UPDATE);
                                break;
                            case 'VERSION-UNSUPPORTED':
                                global_logger.warn({ event: "exit-needs-update", version: depinMsg.details.version, expected: depinMsg.details.expected }, `unsupported synchronizer version ${depinMsg.details.version} (expected ${depinMsg.details.expected})`);
                                process.exit(EXIT.NEEDS_UPDATE);
                                break;
                            default:
                                global_logger.error({ event: "unknown-registry-error", reason: depinMsg.reason, details: depinMsg.details}, `unhandled registry error: ${depinMsg.reason}${depinMsg.details ? " " + JSON.stringify(depinMsg.details) : ''}`);
                        }
                        break;
                    default:
                        if (depinMsg.error) {
                            global_logger.warn({ event: "registry-error", err: depinMsg.error }, `registry error: ${depinMsg.error}`);
                        } else {
                            global_logger.warn({ event: "unrecognized-proxy-message", depinStr }, `unrecognized message from proxy: "${depinStr}"`);
                        }
                }
            } catch (err) {
                global_logger.error({ event: "proxy-message-error", depinStr }, `error processing proxy message "${depinStr}": ${err}`);
            }
        });

        proxySocket.on('close', function onClose(code, reasonBuf) {
            // this is due to one of the following:
            // - intentionally on shutdown, to which the proxy responds by closing the connection
            // - intentionally due to expiry of proxyAckTimeout (proxy failed to ack in time); used to trigger indefinite attempts to reconnect, with increasing backoff
            // - unexpectedly due to network or registry conditions (@@ maybe including DO eviction? - needs more testing).  again used to trigger reconnection.
            let closeReason = code.toString();
            const reason = reasonBuf.toString();
            if (reason) closeReason += ` - ${reason}`;

            const noRetry = code >= 4100;
            if (thisConnectTime !== proxyLatestConnectTime || noRetry) {
                // this connection has been superseded
                global_logger.debug({ event: "old-proxy-socket-closed", closeReason },`proxy socket closed with no retry (${closeReason})`);
                if (reason === 'PROCESS-SUPERSEDED') process.exit(EXIT.NORMAL);
                return;
            }

            // we might successfully reconnect in due course.  in the meantime, make sure
            // there aren't any lingering timeouts that relate to the closing socket.
            clearTimeout(proxyContactTimeout);
            clearTimeout(proxyAckTimeout);
            proxySocket = null;

            const reconnectMsg = aborted ? "" : `  retrying after ${proxyReconnectDelay}ms`;
            global_logger.debug({ event: "proxy-socket-closed", closeReason, aborted, reconnect: reconnectMsg }, `proxy socket closed (${closeReason}).${reconnectMsg}`);

            if (aborted) return; // closure was part of a shutdown

            if (proxyConnectionState === 'CONNECTED') {
                setProxyConnectionState('RECONNECTING');
                declareUnavailableAfterDelay(proxyReconnectDelay + depinTimeouts.PROXY_INTERRUPTION_LIMIT); // standard timeout period after the reconnection we're about to schedule
            }

            setTimeout(connectToProxy, proxyReconnectDelay);
            proxyReconnectDelay = Math.min(depinTimeouts.PROXY_RECONNECT_DELAY_MAX, Math.round((proxyReconnectDelay + 100) * (1 + Math.random())));
        });
    };
    connectToProxy();

    const SESSION_UPDATE_TRIGGER_BYTES = 100000; // @@ artificially low.  as long as we're not interleaving updates, this should be taking advantage of most of the 1MB limit to ensure that we maximise throughput.  on the other hand, that will open us up to having to split large chunks of messages when they arrive at the DO, to fit the 128KB storage-value limit.

    function acceptSession(sessionId, runnerDispatchSeq, canEarnCredit) {
        // this is invoked only once per session, on first accepting the assignment.
        // by contrast, connectToSessionRunner might be invoked repeatedly
        // if the network is unstable.
        const shortSessionId = sessionId.slice(0, 8);

        registerSession(sessionId);
        const session = ALL_SESSIONS.get(sessionId);
        session.updateTracker = {
            dispatchSeq: runnerDispatchSeq,
            lastUpdateSeq: 0,   // received from session runner on confirmation of assignment; incremented each time we build an update.
            updatedProps: {},   // values for island properties that have been sent, or at least buffered
            forcedUpdateProps: new Map(),
            newMessages: [],    // replicated messages since last update
            newMessageTotal: 0, // rough estimate of aggregate size of messages
            updateBuffer: []    // queue of updates that we want to send.  an update stays in the queue (at the front) until the DO acknowledges receipt.
        };
        // for DePIN we are required to track the session stats that will be used to generate synq rewards and developer costs.
        // the synq also includes some of these stats in its regular status reports (to the proxy DO) for each session it's currently hosting.
        const depinStats = session.depinStats = {
            canEarnCredit,  // currently only used when reporting stats to synch app

            joins: 0,       // in this reporting period
            totalJoins: 0,  // since this synq picked up the session

            // track the total number of users announced in 'users' messages
            auditLastUsers: -1,
            auditMinUsers: -1,
            auditMaxUsers: -1,

            messagesIn: 0,
            totalMessagesIn: 0,

            auditPayloadTally: 0, // cumulative sum of message-payload lengths in this work unit

            // all bytes received from clients over webrtc
            bytesIn: 0,
            auditBytesIn: 0,
            totalBytesIn: 0,

            // all bytes sent out to clients over webrtc (including for ticks)
            bytesOut: 0,
            auditBytesOut: 0,
            totalBytesOut: 0,

            auditTicks: 0,   // count of ticks sent in this work unit

            runner: {
                auditBytesIn: 0,  // all bytes over socket - including ICE negotiations, session state etc
                auditBytesOut: 0, // all bytes - including ICE, all island updates etc
                latency: { min: null, max: null, count: 0, sum: 0 }
            },

            // work unit stats at the time of the last snapshot (if any) this work unit,
            // as supplied by the client taking the snapshot
            auditAtLastSnapshot: {
                lastUsers: -1,
                minUsers: -1,
                maxUsers: -1,
                payloadTally: 0
            },

            sessionTimeAtDispatch: 0, // teatime after which this synq has been responsible for the session

            auditForSessionRunner: null, // during an audit, this holds the session-related values until the update is actually sent to the session DO, at which point we stir in the comms-related values
        };
        session.offload = reason => {
            session.stage = 'offloading'; // only on DePIN
            const island = ALL_ISLANDS.get(sessionId);
            if (island) deleteIsland(island, reason);
            else deregisterSession(sessionId, reason);
        };
        session.reconnectDelay = 0; // delay for reconnecting to session DO after a drop

        // on first acceptance of the session, and after any disconnection from the session runner, we set a deadline for successful (re)assignment before offloading the session (and telling any connected clients to go elsewhere).  this reflects that a session cannot be run in the absence of a solid session-runner connection for recording session progress.
        // this is independent from the session.timeout created by scheduleShutdownIfNoJoin - set up as 7 seconds from initial registration of a session, and refreshed on first client connection - that offloads a session if no client manages to join it in a timely manner.  that keeps synchronizers from getting clogged with sessions for non-viable (typically buggy) apps.
        // the no-session-runner timeout is quicker; currently 2 seconds.  on a failed initial assignment (due to network problems finding the session runner), it will have cleared out the session long before no-JOIN gets a chance.  once the session is running with some client(s), the aim is to bail
        let noSessionRunnerTimeout;
        let sessionRunnerConnectionState = 'CONNECTING'; // "CONNECTED", "CONNECTING"

        // set up a timeout to offload this session if connection/reconnection attempts remain unsuccessful for the designated period.
        // timeout is cleared on successful receipt of an ASSIGNED message.
        function declareNoSessionRunnerAfterDelay(ms) {
            if (noSessionRunnerTimeout) clearTimeout(noSessionRunnerTimeout);

            noSessionRunnerTimeout = setTimeout(() => {
                if (aborted) return; // process was abandoned anyway

                // reconnection hasn't happened, so offload this session.
                session.logger.info({ event: "connection-timeout" }, `Session ${shortSessionId} reconnection timed out. Offloading.`);
                session.offload("no session runner"); // clear the decks, even though we can't contact the session runner
            }, ms);
        }
        declareNoSessionRunnerAfterDelay(depinTimeouts.SESSION_CONNECT_LIMIT);

        const connectToSessionRunner = () => {
            // invoked each time we need a new connection to the session DO (including
            // after any glitch that causes the connection to drop)

            if (session.stage === 'offloading' || session.stage === 'closed') {
                session.logger.debug({ event: "defunct", stage: session.stage },`Session ${shortSessionId} is defunct; abandoning scheduled reconnection`);
                return;
            }

            if (session.updateTracker.dispatchSeq !== runnerDispatchSeq) {
                session.logger.debug({ event: "dispatch-sequence-mismatch", runnerDispatchSeq, previousDispatchSeq: session.updateTracker.dispatchSeq }, `Session ${shortSessionId} has been re-dispatched; abandoning scheduled reconnection`);
                return;
            }

            const key = session.socketKey = String(Math.random()).slice(2, 10); // timeouts and handler invocations set up under the auspices of one connection are ignored if that connection has been replaced
            const sessionSocket = new WebSocket(`${DEPIN}/synchronizers/connect?session=${sessionId}&dispatchSeq=${runnerDispatchSeq}&synchronizer=${proxyId}`, {
                perMessageDeflate: false, // this was in the node-datachannel example; not sure if it's helping
            });
            session.sessionSocket = sessionSocket;
            session.sendToSessionRunner = msgObject => {
                const socket = session.sessionSocket; // make sure it's still there
                if (socket?.readyState !== WebSocket.OPEN) {
                    session.logger.warn({ event: "runner-not-ready" }, `attempt to send ${msgObject.what} on unconnected channel for session ${shortSessionId}`);
                    return;
                }
                const msg = JSON.stringify(msgObject);
                socket.send(msg);
                depinStats.runner.auditBytesOut += msg.length;
            };

            // the session has responsibility for periodically contacting the session
            // DO - with an island update if there are changed properties or additional
            // messages; otherwise with a 1Hz PING.  if the DO doesn't hear anything on
            // its synq connection for 2 seconds, it will draw the conclusion that this
            // synq is no longer capable of running the session.
            // every 250ms we check...
            // - are we free to send an update (i.e., not waiting for acknowledgement of a previously sent one)?
            //   - if so, are there updates pending (in updateBuffer)?
            //     - if so, send the first pending update
            //     - else: are there messages pending?
            //       - if so, gather an update that includes the messages
            //       - else: has it been 1000ms since last send?
            //         - if so, gather a props-only update and send that
            //         - else: send PING
            //   - else (not free to send update): if over 1000ms since last send, send PING
            let lastSendTime = 0; // last time we sent a SESSION_UPDATE or PING
            let sessionUpdateTimeout;
            let sessionContactTimeout;

            function watchForBrokenSessionContact() {
                if (sessionContactTimeout) clearTimeout(sessionContactTimeout);

                sessionContactTimeout = setTimeout(() => {
                    if (key !== session.socketKey) return; // ignore a timeout if socket has been replaced

                    // no ack received in time.  force a socket disconnection, which will trigger reconnection attempts with increasing backoff.
                    session.logger.info({ event: "runner-ack-timeout" }, `Session ${shortSessionId} acknowledgements from session runner timed out. Reconnecting.`);
                    clearTimeout(sessionUpdateTimeout); // don't contact again until we figure out what's going on
                    // @@ according to our design proposals, we should put the session into BUFFERING, not sending any further events to clients until reconnection to the session runner is achieved.  to be implemented later.
                    try {
                        sessionSocket.close(1000, "update acknowledgement timed out");
                        sessionSocket.terminate(); // otherwise 'close' event might not be raised for 30 seconds; see https://github.com/websockets/ws/issues/2203
                    } catch (err) { /* */ }
                }, depinTimeouts.SESSION_SILENCE_LIMIT);
            }

            const scheduleNextSessionUpdate = () => {
                if (sessionUpdateTimeout) clearTimeout(sessionUpdateTimeout);

                sessionUpdateTimeout = setTimeout(() => {
                    if (key !== session.socketKey) return; // ignore a timeout if socket has been replaced

                    const now = Date.now();
                    const mustSendSomething = now - lastSendTime >= depinTimeouts.SESSION_PING_DELAY;
                    const { updateBuffer, newMessages } = session.updateTracker;
                    let whatWasSent = null;
                    const awaitingAck = updateBuffer.length && updateBuffer[0].awaitingAck;
                    if (!awaitingAck) {
                        if (!updateBuffer.length) {
                            // no updates yet.  let's see if it's time to build one.
                            if (newMessages.length || mustSendSomething) session.gatherUpdateIfNeeded(true); // true => any change will do
                        }
                        if (updateBuffer.length) { // maybe after the processing above
                            const update = updateBuffer[0];
                            const updateIncludesAudit = !!update.lastAuditTime;
                            if (updateIncludesAudit) {
                                const { auditForSessionRunner } = depinStats;
                                if (auditForSessionRunner) {
                                    const { auditBytesIn: runnerBytesIn, auditBytesOut: runnerBytesOut } = depinStats.runner;
                                    auditForSessionRunner.runnerBytesIn = runnerBytesIn;
                                    auditForSessionRunner.runnerBytesOut = runnerBytesOut;
                                    update.auditFromSync = auditForSessionRunner;
                                    depinStats.auditForSessionRunner = null;
                                    // to ensure that the synq gets credit from the session DO for sending the bytes in this last update of the work unit, we measure the expected size of the update message and add it to the stats.
                                    const msgSize = JSON.stringify({ what: "SESSION_UPDATE", update }).length;
                                    update.auditFromSync.runnerBytesOut += msgSize;
                                } else console.error("failed to find auditForSessionRunner to accompany lastAuditTime");

                            }
                            session.sendToSessionRunner({ what: "SESSION_UPDATE", update });
                            update.awaitingAck = true;
                            if (updateIncludesAudit) {
                                // reset comms stats _after_ sending the update
                                depinStats.runner.auditBytesIn = depinStats.runner.auditBytesOut = 0;
                            }
                            whatWasSent = `update ${update.updateSeq}`;
                        }
                    }
                    if (!whatWasSent && mustSendSomething) {
                        session.sendToSessionRunner({ what: "PING" });
                        whatWasSent = "ping";
                    }

                    if (whatWasSent) lastSendTime = now;

                    scheduleNextSessionUpdate();
                }, depinTimeouts.SESSION_UPDATE_DELAY);
            };

            session.addMessageToUpdate = msg => {
                const { updateTracker } = session;
                const { newMessages } = updateTracker;
                const sizeEstimate = payloadSizeForAccounting(msg) + 50; // @@ only need an approximate amount, and over-estimating is better than under.
                newMessages.push(msg);
                updateTracker.newMessageTotal += sizeEstimate;
            };

            // we send incremental updates that will ensure
            // that the session DO has an up-to-date copy of all of the island's
            // savable properties.
            // updateTracker.updatedProps holds the values that we have either already
            // sent to the session DO, or at least scheduled for sending (as an entry
            // in updateBuffer).
            // most of the properties are of immutable type, so a simple comparison
            // with what's in updatedProps is enough to decide whether an update
            // is needed.
            // for those that are not, we rely on code that updates the property
            // to add the updated value to forcedUpdateProps, meaning that the
            // value as a whole will be sent.  this currently applies only to
            // completedTallies.
            // the message array has its own handling.  every outgoing message is
            // added to updateTracker.newMessages, which is cleared each time an
            // update is assembled.
            // therefore, for each property (other than messages):
            // - if forcedUpdateProps includes the property, send the attached value
            // - else if updatedProps has no value for this property, or the value it has is not object-identical to the island's current one, send the value
            session.gatherUpdateIfNeeded = anyChangeWillDo => {
                // if the session has moved on since the last update that was sent, add
                // to the update buffer a bundle with all the changes (and return true).
                const island = ALL_ISLANDS.get(sessionId); // if there is one
                if (!island || island.storedUrl === null) return false; // not initialised yet from stored state (if any)

                const { updateTracker } = session;
                const { updatedProps, forcedUpdateProps, newMessages, newMessageTotal } = updateTracker;

                // if this was not driven by the regular-update clock, only capture an
                // update if the message buffer has hit its threshold.
                if (!anyChangeWillDo && newMessageTotal < SESSION_UPDATE_TRIGGER_BYTES) return false;

                const thisUpdate = {};
                savableKeys(island).forEach(prop => {
                    if (prop === 'messages') return; // handled separately

                    const forced = forcedUpdateProps.has(prop);
                    const value = forced ? forcedUpdateProps.get(prop) : island[prop];
                    if (forced || updatedProps[prop] !== value) {
                        thisUpdate[prop] = value;
                        updatedProps[prop] = value;
                    }
                });
                forcedUpdateProps.clear();

                if (newMessages.length) {
                    thisUpdate.messages = [...newMessages];
                    newMessages.length = 0;
                    updateTracker.newMessageTotal = 0;
                }
                if (Object.keys(thisUpdate).length) {
                    thisUpdate.updateSeq = ++updateTracker.lastUpdateSeq;
                    updateTracker.updateBuffer.push(thisUpdate);
                    return true;
                }

                return false;
            };

            sessionSocket.on('open', () => {
                // if the session is already in 'offloading' or 'closed' state, this must
                // be a late response to a connection that we initiated in happier times.
                // immediately shut it down, forcing the session DO to think again.
                if (session.stage === 'offloading' || session.stage === 'closed') {
                    session.logger.info({ event: "defunct-record" }, "rejecting session-runner connection; session record is defunct");
                    try {
                        sessionSocket.close(1000, "session record is defunct");
                        sessionSocket.terminate();
                        session.socketKey = ''; // suppress socket 'close' handling
                        session.sessionSocketClosed(); // and force it through now
                    } catch (err) { /* */ }
                    return;
                }

                session.logger.info({ event: "runner-connection-opened" }, `session runner for ${shortSessionId} opened our socket`);
                // nothing else to do.  the opening might even have happened just so
                // the DO can send us a REJECTED message.
            });

            sessionSocket.on('error', function onError(err) {
                if (key !== session.socketKey) return;

                // @@ generate appropriate logger output
                if (err.code === 'ECONNREFUSED') {
                    session.logger.info({ event: "runner-connection-refused" }, `session runner for ${shortSessionId} refused`);
                } else {
                    session.logger.warn({ event: "runner-connection-error" }, `session runner for ${shortSessionId} error: ${err}`);
                }
            });

            sessionSocket.on('message', function onMessage(depinStr) {
                if (key !== session.socketKey) return;

                depinStats.runner.auditBytesIn += depinStr.length;

                try {
                    const depinMsg = JSON.parse(depinStr);
                    const clientId = depinMsg.id;
                    const globalClientId = `${shortSessionId}:${clientId}`;
                    switch (depinMsg.what) {
                        case "ASSIGNED": {
                            // session runner has accepted our connection (or reconnection)
                            clearTimeout(noSessionRunnerTimeout);
                            sessionRunnerConnectionState = 'CONNECTED';

                            const runnerLastUpdate = depinMsg.lastUpdateSeq;
                            session.reconnectDelay = 0;
                            const { updateTracker } = session;
                            const { updateBuffer } = updateTracker;
                            if (updateBuffer.length) {
                                // if this is a reconnection, the first buffered update
                                // might have been left awaiting acknowledgement.  if the
                                // session runner's reported lastUpdateSeq corresponds to
                                // that update, we can remove it from the buffer.  but if
                                // the session runner is telling us that it has not received
                                // that update, we must ensure that the awaitingAck flag is
                                // clear so it gets re-sent.
                                const firstBufferedUpdate = updateBuffer[0].updateSeq;
                                const lastBufferedUpdate = updateBuffer[updateBuffer.length - 1].updateSeq;
                                if (runnerLastUpdate === firstBufferedUpdate) {
                                    const ackWarning = updateBuffer[0].awaitingAck ? '' : ".  WARNING: awaitingAck was not set";
                                    session.logger.debug({ event: "runner-reconnect" }, `session runner already has our first buffered update${ackWarning}`);
                                    updateBuffer.shift();
                                } else if (runnerLastUpdate === firstBufferedUpdate - 1) {
                                    session.logger.debug({ event: "runner-reconnect" }, `session runner is ready for our first buffered update`);
                                    delete updateBuffer[0].awaitingAck; // if it was set
                                } else {
                                    session.logger.warn({ event: "runner-reconnect-mismatch", runnerLastUpdate, firstBufferedUpdate }, `session runner has update ${runnerLastUpdate}, but our first is ${firstBufferedUpdate}`);
                                }
                                // take a note of the last updateSeq we've already used
                                updateTracker.lastUpdateSeq = lastBufferedUpdate;
                            } else updateTracker.lastUpdateSeq = runnerLastUpdate;

                            watchForBrokenSessionContact(); // start checking connection status
                            scheduleNextSessionUpdate(); // start sending updates/PINGs
                            break;
                        }
                        case "REJECTED":
                            // session runner has rejected this synchronizer's attempt to
                            // take the session (for example, if we took too long to connect)
                            clearTimeout(noSessionRunnerTimeout); // no point waiting any more
                            session.logger.info({ event: "runner-rejected" },`session runner for ${shortSessionId} rejected our connection`);
                            session.offload("rejected by session runner");
                            break;
                        case "ABANDONED":
                            // session runner has decided that this synchronizer no longer
                            // deserves to run this session (for example, because of an
                            // error on session updates).
                            clearTimeout(sessionContactTimeout);
                            session.logger.info({ event: "runner-abandoned" }, `session runner for ${shortSessionId} abandoned this synchronizer`);
                            session.offload("abandoned by session runner");
                            break;
                        case "CONNECT":
                            // a peer connection isn't set up until the client sends an offer.
                            // therefore, for now, there's nothing to do here.
                            session.logger.debug({ event: "client-connected", clientId }, `new client connection ${globalClientId}`);
                            break;
                        case "DISCONNECT":
                            session.logger.debug({ event: "client-signaling-closed", clientId }, `client ${globalClientId} closed signaling`);
                            // if the client already has a data channel, this disconnection
                            // has probably been triggered by the client deciding that the channel
                            // setup is now complete - so it's not a client disconnection at all.
                            if (!server.clients.get(globalClientId)) {
                                // there *isn't* a data channel, so this might be the only
                                // disconnection signal we'll get.  make sure to tidy up.
                                server.removeClient(globalClientId, "ICE disconnect");
                            }
                            break;
                        case "ICE_MSG": {
                            let msg;
                            try {
                                msg = JSON.parse(depinMsg.data);
                            } catch (e) {
                                session.logger.warn({ event: "malformed-ice-message", clientId, content: depinMsg.data }, `error parsing ICE message from client ${globalClientId}: ${depinMsg.data}`);
                                return;
                            }
                            switch (msg.type) {
                                case 'offer': {
                                    // supposedly always the first message through.
                                    // @@ for now, every ICE negotiation message includes
                                    // the client's ip address as reported in Cloudflare's
                                    // CF-Connecting-IP header.
                                    const peerConnection = createPeerConnection(clientId, globalClientId, sessionId, sessionSocket);
                                    peerConnection.mq_clientIp = depinMsg.ip;
                                    peerConnection.setRemoteDescription(msg.sdp, msg.type);
                                    break;
                                }
                                case 'candidate':
                                    // the API for PeerConnection doesn't understand empty or null candidate
                                    if (msg.candidate) {
                                        // client might have already been forced to leave.
                                        server.peerConnections.get(globalClientId)?.addRemoteCandidate(msg.candidate, msg.sdpMid);
                                    }
                                    break;
                                case 'selectedCandidatePair': {
                                    const connectionType = { c: msg.clientType, s: msg.syncType };
                                    session.logger.info({ event: "client-connection-type", client: connectionType.c, synch: connectionType.s }, `client ${globalClientId} client=${connectionType.c}, sync=${connectionType.s}`);
                                    // if the client already exists, update it.  otherwise
                                    // update the peerConnection, and the client will copy
                                    // from there when it is initialised.
                                    const client = server.clients.get(globalClientId);
                                    if (client) client.connectionType = connectionType;
                                    else {
                                        const peerConnection = server.peerConnections.get(globalClientId);
                                        if (peerConnection) peerConnection.mq_connectionType = connectionType;
                                    }
                                    break;
                                }
                                default:
                                    session.logger.warn({ event: "unknown-ice-message", clientId, type: msg.type }, `unknown ICE message type "${msg.type}" from client ${globalClientId}`);
                                    break;
                            }
                            break;
                        }
                        case 'SESSION_STATE': {
                            const { spec, persisted } = depinMsg;
                            session.sessionSpecReady({spec, persisted});
                            break;
                        }
                        case 'SESSION_UPDATE_RECEIVED': {
                            logRoundTrip(Date.now() - lastSendTime);
                            watchForBrokenSessionContact(); // reset the clock

                            const { updateSeq } = depinMsg;
                            const { updateBuffer } = session.updateTracker;
                            if (!updateBuffer.length) {
                                session.logger.debug({ event: "unexpected-ack" }, `ack ${updateSeq} received, but not in buffer`);
                                return;
                            }

                            const firstUpdate = updateBuffer[0];
                            const firstUpdateSeq = firstUpdate.updateSeq;
                            if (updateSeq > firstUpdateSeq) {
                                throw Error(`later ack ${updateSeq} received while waiting for ${firstUpdateSeq}`);
                            }

                            if (updateSeq < firstUpdateSeq) {
                                const waitingMsg = firstUpdate.awaitingAck ? ` (waiting for ${firstUpdate.updateSeq})` : "";
                                session.logger.debug({ event: "out-of-sequence-ack" }, `earlier ack ${updateSeq} received${waitingMsg}`);
                                return;
                            }

                            updateBuffer.shift();
                            break;
                        }
                        case 'PONG': {
                            logRoundTrip(Date.now() - lastSendTime);
                            // only reset the contact clock if we're not awaiting a
                            // SESSION_UPDATE_RECEIVED
                            const { updateBuffer } = session.updateTracker;
                            if (updateBuffer.length && updateBuffer[0].awaitingAck) return;

                            watchForBrokenSessionContact(); // reset the clock
                            break;
                        }
                        default:
                            session.logger.warn({ event: "unknown-message", clientId, what: depinMsg.what }, `unknown message "${depinMsg.what}" from client ${globalClientId}`);
                            break;
                    }
                } catch (err) {
                    session.logger.error({ event: "message-handling-failed", err}, `error processing message "${depinStr}" in session ${shortSessionId}: ${err}`);
                }
            });

            sessionSocket.on('close', function onClose() {
                if (key !== session.socketKey) return; // an earlier connection

                session.sessionSocketClosed();
            });

            session.sessionSocketClosed = () => {
                // if session.stage is already 'closed', the socket closure was as a result of
                // an intentional shutdown (see deregisterSession).
                // otherwise, it must be due to a network glitch.  try to re-establish the
                // connection, using an increasing backoff delay.
                // initially, a break in the sessionSocket connection needn't have any
                // impact on our existing dataChannel connections to clients that have
                // completed ICE negotiation.
                // any clients with a peerConnection but no dataChannel should, however,
                // be discarded because their negotiations are now in doubt.
                const sessionIsClosed = session.stage === 'offloading' || session.stage === 'closed';

                const sessionPrefix = shortSessionId + ':';
                const allConnectedClients = [...server.peerConnections.keys()].filter(id => id.startsWith(sessionPrefix));
                let disconnected = 0;
                for (const globalClientId of allConnectedClients) {
                    if (!server.clients.has(globalClientId)) {
                        server.removeClient(globalClientId, "session socket closed");
                        disconnected++;
                    }
                }

                session.sessionSocket = null;
                session.socketKey = '';
                clearTimeout(sessionUpdateTimeout);
                clearTimeout(sessionContactTimeout);

                if (sessionIsClosed) {
                    session.logger.info({ event: "runner-closed" }, `runner for closed session ${shortSessionId} disconnected`);
                    return;
                }

                // if session was connected, start a new reconnection timeout
                if (sessionRunnerConnectionState === 'CONNECTED') {
                    sessionRunnerConnectionState = 'CONNECTING';
                    declareNoSessionRunnerAfterDelay(depinTimeouts.SESSION_RECONNECT_LIMIT);
                }

                const disconnectMsg = disconnected ? ` and ${disconnected} unconnected clients discarded` : '';
                session.logger.info({ event: "runner-disconnected" }, `session runner for ${shortSessionId} disconnected${disconnectMsg}.  retrying after ${session.reconnectDelay}ms`);
                setTimeout(connectToSessionRunner, session.reconnectDelay);
                session.reconnectDelay = Math.round((session.reconnectDelay + 100) * (1 + Math.random()));
            };

            function createPeerConnection(clientId, globalClientId) {
                // triggered by receiving an ICE offer from a client
                const signalToClient = signalObject => {
                    const msgObject = { id: clientId, what: "ICE_MSG", data: JSON.stringify(signalObject) };
                    session.sendToSessionRunner(msgObject);
                };

                const peerConnection = new nodeDataChannel.PeerConnection('synchronizer', {
                    iceServers
                    // iceServers: ['stun:stun.l.google.com:19302']
                    // ['stun:freeturn.net:3478', 'turn:free:free@freeturn.net:3478']
                });
                server.peerConnections.set(globalClientId, peerConnection);
                peerConnection.onStateChange(state => {
                    session.logger.debug({ event: "client-connection-state", clientId, state }, `client ${globalClientId} connection state: "${state}"`);
                    if (state === 'closed') {
                        // note: once a client's data channel has been established, any
                        // disconnection must be handled by the 'close' handler that we
                        // install on it (see the call to setUpClientHandlers below).  until that
                        // point - i.e., if the link has dropped early in ICE negotiation - we
                        // just silently clean up this peerConnection.
                        if (server.clients.get(globalClientId)) return;

                        server.removeClient(globalClientId, "peerconnection state change");
                    }
                });
                peerConnection.onGatheringStateChange(state => {
                    session.logger.debug({ event: "client-gathering-state", clientId, state }, `client ${globalClientId} gathering state: "${state}"`);
                    // @@ sometimes we see another couple of candidates *after* this event
                    // has fired.  if the client reacts quickly to the 'gathering-complete'
                    // event by closing the signalling channel, it might not receive them.
                    // in theory a synchronizer could be behind some obscure form of NAT such
                    // that this would cause the connection to fail overall.
                    if (state === 'complete') signalToClient({ type: 'gathering-complete' });
                });
                peerConnection.onLocalDescription((sdp, type) => {
                    signalToClient({ type, sdp });
                });
                peerConnection.onLocalCandidate((candidate, sdpMid) => {
                    if (!candidate) session.logger.debug({ event: "client-empty-candidate", clientId }, `empty local candidate: ${candidate}`);
                    signalToClient({ type: 'candidate', candidate, sdpMid });
                });
                peerConnection.onDataChannel(dataChannel => {
                    const label = dataChannel.getLabel();
                    const client = createClient(globalClientId, peerConnection, dataChannel);
                    client.meta.label = label;
                    server.clients.set(globalClientId, client);
                    setUpClientHandlers(client); // adds 'message', 'close', 'error'
                    registerClientInSession(client, sessionId); // includes setting up logger
                    client.logger.notice({ event: "start" }, `opened connection for client ${globalClientId} at ${peerConnection.mq_clientIp} with label "${label}"`);
                    dataChannel.onMessage(msg => {
                        if (msg.startsWith('!pong')) {
                            const time = Number(msg.split('@')[1]);
                            client.handleEvent('pong', time);
                        } else client.handleEvent('message', msg);
                    });
                    dataChannel.onError(evt => client.handleEvent('error', evt));
                    dataChannel.onClosed(_evt => {
                        const { localCloseSpec } = client; // if close was requested by synq
                        const code = localCloseSpec?.[0] || 1000;
                        const reason = localCloseSpec?.[1] || "Client closed data channel";
                        client.handleEvent('close', code, reason);
                    });
                });
                return peerConnection;
            }

            function createClient(globalClientId, peerConnection, dataChannel) {
                // a client object that has the needed DePIN-supporting properties, and
                // can also work with legacy synchronizer code that expects a client to be
                // a socket.
                return {
                    globalId: globalClientId,
                    pc: peerConnection,
                    dc: dataChannel,
                    isConnected: function () { return this.dc.isOpen() },
                    send: function (data) {
                        try { this.dc.sendMessage(data) }
                        catch(err) {
                            this.logger?.error({ event: "send-failed", err }, `send to client ${this.globalId} failed: ${err}`)
                        }
                    },
                    // all locally requested closures (typically due to error conditions)
                    // are expected to trigger the client's 'close' event handler.  on
                    // DePIN, that is achieved by closing the client's dataChannel.
                    close: function (code, reason) {
                        // on WebRTC there is no information sent with a close(), so we
                        // send it ahead of time.
                        this.localCloseSpec = [code, reason]; // a copy for local logging
                        try { this.dc.sendMessage(`!close|${code}|${reason}`) }
                        catch (e) { /* */ }
                        try { this.dc.close() }
                        catch (e) { /* */ }
                    },
                    handlers: {},
                    on: function (eventName, handler) { this.handlers[eventName] = handler },
                    handleEvent: function (eventName, ...args) { this.handlers[eventName](...args) },
                    ping: function (time) { this.send(`!ping@${time}`) },
                    since: Date.now(),
                    connectionType: peerConnection.mq_connectionType || { c: '', s: '' }, // webrtc chosen candidate types, for client and synq
                    bufferedAmount: 0, // dummy value, used in stats collection
                    latency: { min: null, max: null, count: 0, sum: 0 },
                    meta: {
                        shortId: globalClientId.split(':')[1], // messy, but silly not to
                        // label: added by caller
                        scope: "connection",
                        userIp: peerConnection.mq_clientIp
                    }
                };
            }

            function logRoundTrip(ms) {
                const { latency } = depinStats.runner;
                latency.count++;
                latency.sum += ms;
                if (latency.min === null || ms < latency.min) latency.min = ms;
                if (latency.max === null || ms > latency.max) latency.max = ms;
            }
        };

        session.fetchLatestSessionSpec = async () => {
            let fetchTimeout;
            let timedOut = false;
            const fetchFromRunner = new Promise((resolve, reject) => {
                session.sessionSpecReady = resolve;
                session.sendToSessionRunner({ what: "FETCH_SESSION_STATE" });
                fetchTimeout = setTimeout(() => {
                    timedOut = true;
                    reject();
                }, depinTimeouts.SESSION_SILENCE_LIMIT);
            }).catch(_err => null) // error or timeout delivers null
            .finally(() => clearTimeout(fetchTimeout));

            const specOrPersisted = await fetchFromRunner;
            let errorDetails;
            if (specOrPersisted) {
                const { spec, persisted } = specOrPersisted;
                if (Object.keys(spec).length) return spec;

                errorDetails = ["empty spec", 404, persisted];
            } else errorDetails = timedOut
                ? ["fetch timed out", 504]
                : ["fetch failed", 500];

            throw {
                message: errorDetails[0],
                code: errorDetails[1],
                persisted: errorDetails[2]
            };
        };

        session.gatherAndFlushSessionUpdates = () => {
            // invoked only by deleteIsland.  returns true if there were any updates to
            // send.
            session.gatherUpdateIfNeeded(true); // true => any change will do
            session.updateTracker.updateBuffer.forEach(update => {
                session.sendToSessionRunner({ what: "SESSION_UPDATE", update, noAckNeeded: true });
            });
            const anySent = session.updateTracker.updateBuffer.length > 0;
            session.updateTracker.updateBuffer.length = 0;
            return anySent;
        };

        connectToSessionRunner();
    }

    function sendStats(statType, statResult) {
        sendToProxy({ what: 'STATS', type: statType, result: statResult });
    }

    function statusForProxy(aggregationSeconds) {
        /* report:
            {
                seconds: aggregationSeconds,
                sessions: [
                    {
                        id: shortSessionId1,
                        comms: {
                            joins,
                            totalJoins,
                            messagesIn,
                            totalMessagesIn,
                            bytesIn,
                            totalBytesIn,
                            bytesOut,
                            totalBytesOut,
                            totalSnapshots
                        },
                        runner: {
                            latency?: { avg, min, max }, // if any to report
                            backlog?, // number of unsent update chunks, if non-zero
                        },
                        clients?: [
                            {
                                id: shortClientId1,
                                conn: { c, s },
                                latency?: { avg, min, max } // if any to report
                            },
                            { id: shortClientId2... }
                        ]
                    },
                    { id: shortSessionId2... }
                ],
                numApps
            }
        */
        const report = { seconds: aggregationSeconds };
        if (depinNumApps) report.numApps = depinNumApps;
        // $$$ we only gather for sessions that are active right now.  the final stats
        // for any session that was offloaded at some point since the previous report
        // will therefore be lost.  in due course we'll need to fix this.
        let sessionRecords = [];
        for (const [id, session] of ALL_SESSIONS.entries()) { // running or not
            const sessionRecord = { id: id.slice(0, 8) };
            const { depinStats } = session;
            const { joins, totalJoins, messagesIn, totalMessagesIn, bytesIn, totalBytesIn, bytesOut, totalBytesOut, runner } = depinStats;
            sessionRecord.comms = { j: joins, tj: totalJoins, mi: messagesIn, tmi: totalMessagesIn, bi: bytesIn, tbi: totalBytesIn, bo: bytesOut, tbo: totalBytesOut };
            depinStats.joins = depinStats.messagesIn = depinStats.bytesIn = depinStats.bytesOut = 0;

            let runnerRecord;
            if (runner.latency.count) {
                const avg = Math.round(runner.latency.sum / runner.latency.count);
                runnerRecord = { latency: { avg, min: runner.latency.min, max: runner.latency.max } };
                runner.latency = { min: null, max: null, count: 0, sum: 0 };
            }
            const backlog = session.updateTracker.updateBuffer.length;
            if (backlog) {
                runnerRecord = runnerRecord || {};
                runnerRecord.backlog = backlog;
            }
            if (runnerRecord) sessionRecord.runner = runnerRecord;

            const island = ALL_ISLANDS.get(id);
            if (island) {
                const clientRecords = [];
                for (const client of island.clients) {
                    const { connectionType, latency, meta } = client;
                    const { shortId: id } = meta;
                    const clientRecord = { id, conn: connectionType };
                    if (latency.count) {
                        const avg = Math.round(latency.sum / latency.count);
                        clientRecord.latency = { avg, min: latency.min, max: latency.max };
                        client.latency = { min: null, max: null, count: 0, sum: 0 };
                    }
                    clientRecords.push(clientRecord);
                }
                sessionRecord.clients = clientRecords;
            }

            sessionRecords.push(sessionRecord);
        }
        if (sessionRecords.length) report.sessions = sessionRecords;

        return report;
    }

    function appStats() {
        const allSessions = ALL_ISLANDS.size;
        let demoSessions = 0;
        for (const id of ALL_ISLANDS.keys()) {
            if (ALL_SESSIONS.get(id)?.depinStats.canEarnCredit !== true) demoSessions++;
        }
        const { syncLifeTraffic, syncLifePoints, walletLifePoints, walletBalance } = depinCreditTallies;
        return {
            now: Date.now(),
            sessions: allSessions,
            demoSessions, // of the total reported above
            users: server.peerConnections.size, // active and currently connecting clients
            // the STATS are periodically merged into TOTALS
            bytesOut: TOTALS.OUT + STATS.OUT,
            bytesIn: TOTALS.IN + STATS.IN,
            proxyConnectionState,
            syncLifeTraffic,
            syncLifePoints,
            walletLifePoints,
            walletBalance,
        };
    }

    function startUtilityApp(pathUrl, appName, synchSpec, testKey) {
        const decoder = new TextDecoder()

        const appFile = path.join(__dirname, 'app_wrapper.js');
        const args = [pathUrl, appName, testKey]; // app_wrapper puts the third arg into Constants, to make a dedicated session
        if (synchSpec) args.push(`--synchSpec=${synchSpec}`);
        args.push(`--depin=${DEPIN}`, `--debug=session,snapshot`);
        // console.log(`child process: ${appFile} ${args.join(' ')}`);
        const utilityAppProcess = child_process.fork(appFile, args, {
            stdio: 'pipe',
        })

        const shortKey = testKey.split(':').slice(-1)[0] || '<key>';

        setTimeout(() => console.info(`started utility process with PID=${utilityAppProcess.pid}`), 200) // for info only
        depinNumApps++;
        global_logger.info({
            event: "utility-start",
            testKey,
        }, `utility process for ${shortKey} started; number of running apps now ${depinNumApps}`);

        const pruneLine = line => line.length <= 500 ? line : line.slice(0, 250) + "...(snip)..." + line.slice(-250);

        utilityAppProcess.stdout.on('data', data => {
            const dat = decoder.decode(data);
            const lines = dat.split('\n').filter(line => line);
            for (const l of lines) {
                console.log(`[app-${shortKey}] ${pruneLine(l)}`);
            }
        });
        utilityAppProcess.stderr.on('data', data => {
            const dat = decoder.decode(data)
            const lines = dat.split('\n').filter(line => line);
            for (const l of lines) {
                console.error(`[app-${shortKey}] ${pruneLine(l)}`);
            }
        });
        utilityAppProcess.on('message', msg => {
            if (msg.what === 'sendSynchDetails') {
                const details = { region: registerRegion }; // @@ maybe later add our QoS?
                utilityAppProcess.send({ what: 'synchDetails', details });
            } else if (msg.what === 'stressReport') {
                sendToDepinProxy?.({ what: 'STRESS_REPORT', report: msg.report });
            } else {
                global_logger.debug({
                    event: 'unknown-app-message',
                    message: msg,
                    testKey
                    }, `unknown message from app-${shortKey}: ${JSON.stringify(msg)}`);
            }
        })
        utilityAppProcess.on('exit', code => {
            depinNumApps--;
            global_logger.info({
                event: "utility-exit",
                testKey,
                code
            }, `utility process for ${shortKey} exited with code ${code}; number of running apps now ${depinNumApps}`);
        });

    }

    // listen for messages from Electron
    if (process.parentPort) {
        // receive app-main's synchProcess.postMessage()
        const electronMain = process.parentPort;
        electronMain.on('message', e => {
            try {
                const msg = e.data;
                switch (msg.what) {
                    case 'shutdown':
                        handleTerm(false); // cannot restart
                        break;
                    case 'pingFromMain':
                        electronMain.postMessage({ what: 'pong' });
                        break;
                    case 'stats':
                        electronMain.postMessage({ what: 'stats', value: appStats() });
                        break;
                    case 'debug':
                        electronMain.postMessage({ what: 'debug', value: gatherSessionsStats() });
                        break;
                    case 'queryWalletStats':
                        sendToDepinProxy?.({ what: 'QUERY_WALLET_STATS' });
                        break;
                    default:
                        global_logger.warn({ event: "unrecognized-app-message", what: msg.what }, `unrecognized message from app: "${msg.what}`);
                }
            } catch(err) {
                global_logger.error({ event: "app-message-error", data: e.data }, `error processing app message "${JSON.stringify(e.data)}": ${err}`);
            }

        });
    }

    // =========================== to test utility apps locally =====================
    // setTimeout(() => startUtilityApp(UTILITY_APP_PATH, 'stress_test_core.js', '', 'uvwxyz'), 10_000)

}

// =======================================================

async function startServerForWebSockets() {
    // this webServer is only for http:// requests to the synchronizer url
    // (e.g. the load-balancer's health check),
    // not ws:// requests for an actual websocket connection
    let webServer;
    // eslint-disable-next-line global-require
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
            const body = await gatherMetricsStats();
            res.writeHead(200, {
                'Server': SERVER_HEADER,
                'Content-Length': body.length,
                'Content-Type': prometheus.register.contentType,
            });
            return res.end(body);
        }
        if (req.url === '/sessions') {
            const body = gatherSessionsStats();
            res.writeHead(200, {
                'Server': SERVER_HEADER,
                'Content-Length': body.length,
                'Content-Type': 'text/plain',
            });
            return res.end(body);
        }
        if (req.url.includes('/users/')) {
            const id = req.url.replace(/.*\//, '');
            const body = gatherUsersStats({ id });
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
        const body = `Croquet reflector-${PROTOCOL_VERSION} ${HOSTIP} ${CLUSTER_LABEL}\n\nAh, ha, ha, ha, stayin' alive!`;
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

    // the WebSocket.Server will intercept the UPGRADE request made by a ws:// websocket connection
    server = new WebSocket.Server({ server: webServer });

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

    webServer.on('upgrade', (req, socket, _head) => {
        const { sessionId } = parseUrl(req);
        // connection is a unique identifier used to group all log entries for this connection
        // it is a combination of the dispatcher address, port, and a timestamp in seconds because port numbers are reused
        const connection = `${socket.remoteAddress.replace(/^::ffff:/, '')}:${socket.remotePort}.${Math.floor(Date.now()/1000).toString(36)}`;
        socket.connectionId = connection;
        if (sessionId) {
            const session = ALL_SESSIONS.get(sessionId);
            if (session?.stage === 'closed') {
                // a request to delete the dispatcher record has already been sent.  reject this connection, forcing the client to ask the dispatchers again.
                global_logger.debug({
                    event: "upgrade-rejected",
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    sessionId,
                    connection
                }, `rejecting socket on upgrade; session has been deregistered`);
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

    server.on('error', err => global_logger.error({ event: "server-socket-error", err }, `Server Socket Error: ${err.message}`));

    server.on('connection', (client, req) => {
        // client is a WebSocket.  our hope is that the properties added here don't
        // clash with those of the base socket.
        const { version, sessionId, token } = parseUrl(req);
        if (!sessionId) {
            global_logger.warn({ event: "request-session-missing", ...client.meta, url: req.url }, `Missing session id in request "${req.url}"`);
            client.close(...REASON.BAD_PROTOCOL); // safeClose doesn't exist yet
            return;
        }
        // set up client meta data (also used for logging)
        client.since = Date.now();
        client.meta = {
            scope: "connection",
            connection: req.socket.connectionId, // assigned during upgrade
            dispatcher: req.headers['x-croquet-dispatcher'],
            userIp: (req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].replace(/^::ffff:/, ''),
        };
        // location header is added by load balancer, see region-servers/apply-changes
        if (req.headers['x-location']) try {
            const [region, city, lat, lng] = req.headers['x-location'].split(",");
            client.meta.location = { region };
            if (city) client.meta.location.city = { name: city, lat: +lat, lng: +lng };
        } catch (ex) { /* ignore */ }

        client.isConnected = () => client.readyState === WebSocket.OPEN;

        setUpClientHandlers(client);
        registerClientInSession(client, sessionId);

        // connection log sink filters on scope="connection" and event="start|join|end"
        const forwarded = `via ${req.headers['x-croquet-dispatcher']} (${(req.headers['x-forwarded-for'] || '').split(/\s*,\s*/).map(a => a.replace(/^::ffff:/, '')).join(', ')}) `;
        client.logger.notice({ event: "start", token, url: req.url }, `opened connection ${version} ${forwarded || ''}${req.headers['x-location'] || ''}`);

        // start validating token now (awaited in JOIN)
        if (VERIFY_TOKEN && token) {
            client.tokenPromise = verifyToken(token);
        }
    });

    if (VERIFY_TOKEN) SECRET = await fetchSecret();
    webServer.listen(PORT);
    global_logger.info({
        event: "listen",
    }, `starting ${server.constructor.name} ${USE_HTTPS ? "wss" : "ws"}://${RUNNING_ON_LOCALHOST ? "localhost" : HOSTNAME}:${PORT}/`);
}

const STATS_TO_AVG = ["RECV", "SEND", "TICK", "IN", "OUT"];
const STATS_TO_MAX = ["USERS"]; // "BUFFER" no longer reported
const STATS_KEYS = [...STATS_TO_MAX, ...STATS_TO_AVG];
const STATS = {
    time: Date.now(),
};
const TOTALS = {};
for (const key of STATS_KEYS) { STATS[key] = 0; TOTALS[key] = 0 }

function watchStats() {
    setInterval(showStats, 10000);

    function showStats() {
        const time = Date.now();
        const delta = time - STATS.time;
        STATS.time = time;
        STATS.USERS = Math.max(STATS.USERS, server.clients.size);
        const out = [];
        let any = 0;
        for (const key of STATS_TO_MAX) {
            out.push(`${key}: ${STATS[key]}`);
            any |= STATS[key];
        }
        for (const key of STATS_TO_AVG) {
            out.push(`${key}/s: ${Math.round(STATS[key] * 1000 / delta)}`);
            any |= STATS[key];
        }
        if (any === 0) return;
        global_logger.debug({ event: "stats" }, out.join(', '));
        for (const key of STATS_TO_AVG) TOTALS[key] += STATS[key];
        for (const key of STATS_KEYS) STATS[key] = 0;
    }
}

async function gatherMetricsStats(options) {
    if (!options) return prometheus.register.metrics(); // all metrics in Prometheus exposition format
    if (options.metrics) {
        const selected = options.metrics.map(m => prometheus.register.getSingleMetricAsString(m));
        const values = await Promise.all(selected);
        return values.join('');
    }
    if (options.regex) {
        const all = await prometheus.register.metrics();
        const lines = all.split('\n');
        const matches = lines.filter(line => options.regex.test(line));
        return matches.join('\n');
    }
    global_logger.error({ event: "metrics-error", options }, `unhandled metrics options: ${JSON.stringify(options)}`);
    return '';
}

function gatherSessionsStats(_options) {
    // no options currently supported
    return [...ALL_ISLANDS.values()].map(({ id, clients, appId, name, url }) => `${id} ${clients.size} ${appId || name} ${url}\n`).join('');
}

function gatherUsersStats(options) {
    // options can be { id } - a single session ID whose users are wanted
    const island = ALL_ISLANDS.get(options.id);
    const users = (island ? [...island.clients] : []).map(client => client.user);
    return JSON.stringify(users);
}


// Begin reading from stdin so the process does not exit (see https://nodejs.org/api/process.html)
process.stdin.resume();

async function offloadAllSessions() {
    // offload all sessions, whether currently running (i.e., with an active island)
    // or not.
    const promises = [];
    // if some island is waiting for its dispatcher record to be deletable,
    // we need to wait it out here too.
    for (const [id, session] of ALL_SESSIONS.entries()) {
        const { timeout, earliestDeregister } = session;
        if (timeout) clearTimeout(timeout); // we're in charge now
        const now = Date.now();
        const wait = now >= earliestDeregister
            ? Promise.resolve()
            : new Promise(resolve => { setTimeout(resolve, earliestDeregister - now) });
        const cleanup = wait.then(() => {
            const island = ALL_ISLANDS.get(id);
            return island
                ? deleteIsland(island, "emergency offload")
                : deregisterSession(id, "emergency offload without island");
        });
        promises.push(cleanup);
    }

    if (promises.length) {
        global_logger.notice({
            event: "offload",
            sessionCount: promises.length,
        }, `EMERGENCY OFFLOAD OF ${promises.length} SESSION(S)`);

        // add one more promise that will make the synq hang around for at least
        // 1000ms to give the sessions time to shut down.
        promises.push(new Promise(r => { setTimeout(r, 1000) }));

        await Promise.allSettled(promises);
    }
}

let aborted = false;
function handleTerm(canRestartOnDepin = true) {
    if (!aborted) {
        aborted = true; // checked by all DePIN timeouts related to periodic updates (to proxy or to session DOs)

        sendToDepinProxy?.({ what: 'SHUTDOWN' }); // prevent any further session dispatch, at least for a while

        offloadAllSessions().then(() => {
            global_logger.notice({ event: "end" }, "synchronizer shutdown");
            // take a breath to let the SHUTDOWN message fly
            setTimeout(() => process.exit((DEPIN && canRestartOnDepin) ? EXIT.SHOULD_RESTART : EXIT.NORMAL), 100);
        });
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
    global_logger.error({
        event: "unhandled-rejection",
        err,
    }, `Unhandled rejection: ${err.message}`);
    handleTerm();
});

function openToClients() {
    // start server
    if (DEPIN) {
        startServerForDePIN();
    } else {
        startServerForWebSockets();
    }
    if (RUNNING_ON_LOCALHOST) watchStats();
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
 * @property {string} stage - "runnable", "running", "closable", "offloading", "closed"
 * @property {number} earliestDeregister - estimate of Date.now() when dispatcher record can be removed
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
        island.logger.warn({
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

/** Get (integer) raw time for island, as ms since it was set up on this synchronizer
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
    // housekeeping values for a running island
    return {
        lag: 0,              // aggregate ms lag in tick requests
        clients: new Set(),  // connected web sockets (or client objects, under DePIN)
        usersJoined: [],     // the users who joined since last report
        usersLeft: [],       // the users who left since last report
        usersTimer: null,    // timeout for sending USERS message
        leaveDelay: 0,       // delay in ms before leave event is generated
        dormantDelay: 0,     // delay in s until a hidden client will go dormant
        heraldUrl: '',       // announce join/leave events
        ticker: null,        // interval for serving TICKs
        auditTimer: null,    // interval for triggering audits (DePIN only)
        yetToCheckLatest: true, // flag used while fetching latest.json during startup
        storedUrl: null,     // url of snapshot in latest.json (null before we've checked latest.json)
        storedSeq: INITIAL_SEQ, // seq of last message in latest.json message addendum
        deletionTimeout: null, // pending deletion after all clients disconnect
        syncClients: [],     // clients waiting to SYNC
        tallies: {},
        tagRecords: {},
        developerId: null,   // app developer
        apiKey: null,
        region: "default",   // the apiKey region for persisted data
        url: null,
        resumed: new Date(), // session init/resume time, needed for billing to count number of sessions
        logger: null,        // the logger for this session (shared with ALL_SESSIONS[id])
        flags: {},           // flags for experimental synchronizer features.  currently only "rawtime" is checked
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
    const shortSessionId = id.slice(0, 8);
    const connectedFor = Date.now() - client.since;
    const session = ALL_SESSIONS.get(id);
    if (!session) {
        // shouldn't normally happen, but perhaps possible due to network delays
        global_logger.warn({event: "reject-join", connectedFor}, "rejecting JOIN; unknown session");
        client.safeClose(...REASON.RECONNECT);
        return;
    }

    // NOTE: if this is the first client, then the session logger does not have the JOIN args yet
    // To cover that case, the client loggers for the session will be recreated again below
    client.logger = empty_logger.child({ ...session.logger.bindings(), ...client.meta });

    switch (session.stage) {
        case 'offloading':
        case 'closed':
            // a request to delete the dispatcher record (on GCP) or to offload
            // (on DePIN) has already been sent (but we didn't know that in time
            // to prevent the client from connecting at all).  tell client to reconnect.
            client.logger.info({ event: "reject-join", connectedFor}, "rejecting JOIN; session record is defunct");
            client.safeClose(...REASON.RECONNECT);
            return;
        case 'runnable':
        case 'closable':
            session.stage = 'running';
            // if the session was 'runnable', there will be a timeout (set in scheduleShutdownIfNoJoin, called from registerClientInSession) to delete the local island record and the dispatch record if no-one sends JOIN in time.
            // if 'closable', the timeout is set in provisionallyDeleteIsland to go ahead with deletion.
            clearTimeout(session.timeout);
            session.timeout = null;
            break;
        default:
    }

    const { name: appIdAndName, version, apiKey, url, sdk, appId, codeHash, persistentId, user, location, heraldUrl, leaveDelay, dormantDelay, tove } = args;
    // split name from `${appId}/${name}`
    let name = appIdAndName;    // for older clients without appId
    if (appId && name[appId.length] === '/' && name.startsWith(appId)) name = name.slice(appId.length + 1);
    const unverifiedDeveloperId = args.developerId;

    if (apiKey === undefined) {
        client.logger.info({ event: "reject-join", connectedFor }, "rejecting JOIN; apiKey is undefined");
        client.safeClose(...REASON.BAD_APIKEY);
        return;
    }

    const flags = {};
    // set flags only for the features this synchronizer can support
    if (args.flags) ['rawtime', 'microverse'].forEach(flag => { if (args.flags[flag]) flags[flag] = true; });

    // BigQuery wants a single data type, but user can be string or object or array
    client.meta.user = typeof user === "string" ? user : JSON.stringify(user);

    // connection log sink filters on scope="connection" and event="start|join|end"
    client.logger.notice({
        event: "join",
        sessionName: name,
        appId,
        persistentId,
        developerId: unverifiedDeveloperId,
        flags,
        codeHash,
        apiKey,
        url,
        sdk,
        heraldUrl,
        allArgs: JSON.stringify(args),  //  BigQuery wants a specific schema, so don't simply log all args separately
        connectedFor,
    }, `JOIN ${shortSessionId} as ${client.meta.user} ${url}`);

    if (DEPIN) {
        session.depinStats.joins++;
        session.depinStats.totalJoins++;
        // note: audit stats are updated within USERS()
    }

    // create island data if this is the first client
    let island = ALL_ISLANDS.get(id);
    if (!island) {
        let timeline = ''; do timeline = Math.random().toString(36).substring(2); while (!timeline);
        island = {
            id,                  // the island id
            name,                // the island name (or could be null)
            version,             // the client version
            time: 0,             // the current simulation time
            seq: INITIAL_SEQ,    // sequence number for messages (uint32, wraps around)
            scale: 1,            // ratio of island time to wallclock time
            tick: TICK_MS,       // default tick rate
            delay: 0,            // hold messages until this many ms after last tick
            snapshotTime: -1,    // time of last snapshot
            snapshotSeq: null,   // seq of last snapshot
            snapshotUrl: '',     // url of last snapshot
            lastAuditTime: 0,    // island time when last AUDIT message was sent
            appId,
            persistentId,        // new protocol as of 0.5.1
            persistentUrl: '',   // url of persistent data
            timeline,            // if a stateless synchronizer resumes the session, this is the only way to tell
            tove,                // an encrypted secret clients use to check if they have the right password
            location,            // send location data?
            messages: [],        // messages since last snapshot
            lastTick: -1000,     // time of last TICK sent (-1000 to avoid initial delay)
            lastMsgTime: 0,      // time of last message reflected
            completedTallies: {}, // TUTTI sendTime keyed by tally key (or tuttiSeq, for old clients) for up to MAX_TALLY_AGE in the past.  capped at MAX_COMPLETED_TALLIES entries.
            ...nonSavableProps(),
            [Symbol.toPrimitive]: () => `${name} ${id}`,
            };
        island.rawStart = island.scaledStart = Math.floor(stabilizedPerformanceNow()); // before TICKS()
        island.logger = session.logger;
        ALL_ISLANDS.set(id, island);
        prometheusSessionGauge.inc();
        TICKS(client, args.ticks); // client will not request ticks
    }
    // the following are in the nonSavable list, and can be updated on every JOIN
    island.heraldUrl = heraldUrl || '';
    island.leaveDelay = leaveDelay || 0;
    island.dormantDelay = dormantDelay;
    island.url = url;
    island.flags = flags;

    client.island = island; // set island before await

    let validToken;
    if (client.tokenPromise) try {
        validToken = await client.tokenPromise;
        client.logger.info({ event: "token-verified" }, "token verified");
    } catch (err) {
        client.logger.warn({ event: "token-verify-failed", err }, `token verification failed: ${err.message}`);
    }

    // check API key
    island.apiKey = apiKey;
    // if there is no valid token, we check the API key ourselves
    if (validToken) {
        island.developerId = validToken.developerId;
        if (validToken.region && island.region === "default") island.region = validToken.region;
    } else {
        // will disconnect everyone with error if failed (await could throw an exception)
        // $$$ NB: on DePIN, always unquestioningly approves the developerId.
        const apiResponse = await verifyApiKey(apiKey, url, appId, persistentId, id, sdk, client, unverifiedDeveloperId);
        if (!apiResponse) return;
        island.developerId = apiResponse.developerId;
        if (apiResponse.region && island.region === "default") island.region = apiResponse.region;
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
    if (island.snapshotUrl || island.persistentUrl) { SYNC(island); return }

    // if we haven't yet checked latest.json, look there first
    if (island.yetToCheckLatest) {
        island.yetToCheckLatest = false;

        const sessionMeta = {
            ...global_logger.bindings(),
            ...session.logger.bindings(),
            sessionName: name,
            appId,
            persistentId,
            codeHash,
            apiKey,
            developerId: island.developerId,
            flags,
            url,
            sdk,
            heraldUrl,
        };
        session.logger = empty_logger.child(sessionMeta);
        // loggers need to be updated now that session logger has more meta data
        island.logger = session.logger;
        for (const each of island.syncClients) {
            each.logger = empty_logger.child({...sessionMeta, ...each.meta});
        }

        let joinSuccess = true;
        try {
            // for compatibility with GCP handling, in which we detect a new session
            // by the absence of a stored latest.json, the DePIN fetchLatestSessionSpec
            // will throw a 404 error if the session runner returns an empty spec.
            // this gives us a chance in either case to check for persistent data.
            const latestSpec = DEPIN
                ? await session.fetchLatestSessionSpec()
                : await fetchJSON(`${id}/latest.json`);
            island.logger.notice({
                event: "start",
                snapshot: {
                    time: latestSpec.time,
                    seq: latestSpec.seq,
                    messages: latestSpec.messages.length,
                    url: latestSpec.snapshotUrl,
                },
            }, `resuming ${shortSessionId} from ${DEPIN ? "session-runner state" : "latest.json"}`);
            // as we migrate from one style of island properties to another, a
            // latest.json does not necessarily have all the properties a freshly
            // minted island has.  fill in whichever of those properties were
            // supplied (and ignore any properties that we no longer keep).
            const receivedProps = DEPIN ? {} : null;
            savableKeys(island).forEach(key => {
                const value = latestSpec[key];
                if (value !== undefined) {
                    island[key] = value;
                    if (DEPIN) receivedProps[key] = value;
                }
                });
            if (DEPIN) {
                session.updateTracker.updatedProps = receivedProps;
                // calculate the payload tally so far, resetting on each audit
                let payloadTally = 0;
                for (const msg of latestSpec.messages) {
                    if (typeof msg[2] !== 'string' && msg[2].what === 'audit') payloadTally = 0;
                    else payloadTally += payloadSizeForAccounting(msg);
                }
                // make sure that all work-unit stats are suitably initialised
                const { depinStats } = session;
                depinStats.lastUsers = depinStats.minUsers = depinStats.maxUsers = -1;
                depinStats.auditPayloadTally = payloadTally;
                depinStats.sessionTimeAtDispatch = latestSpec.time;
            }

            island.scaledStart = stabilizedPerformanceNow() - island.time / island.scale;
            island.storedUrl = latestSpec.snapshotUrl;
            island.storedSeq = latestSpec.seq;
        } catch (err) {
            if (typeof err !== "object") err = { message: ""+JSON.stringify(err) }; // eslint-disable-line no-ex-assign
            else if (!err.message) err.message = "<empty>";

            if (err.code !== 404) {
                island.logger.error({event: "fetch-latest-failed", err}, `failed to fetch latest.json: ${err.message}`);
                if (DEPIN) {
                    // on DePIN we regard an error in fetching session state as a
                    // reason to refuse to SYNC any clients.  force all that are
                    // waiting (including the current one) to reconnect, in the
                    // hope of having better luck next time.
                    for (const each of island.syncClients) {
                        each.safeClose(...REASON.RECONNECT);
                    }
                    island.syncClients.length = 0;
                    island.yetToCheckLatest = true; // next JOIN attempt will look again
                    joinSuccess = false;
                }
            }

            if (joinSuccess) {
                island.storedUrl = ''; // replace the null that means we haven't looked

                // no session state was found.  check if there is persistent data.
                let persisted;
                if (DEPIN) {
                    if (err.persisted) persisted = { url: err.persisted };
                } else { // GCP
                    if (island.developerId) {
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
                }
                if (persisted) {
                    island.persistentUrl = persisted.url;
                    island.logger.notice({
                        event: "start",
                        persisted: {
                            url: island.persistentUrl,
                        },
                    }, `resuming ${shortSessionId} from persisted data`);
                } else {
                    island.logger.notice({event: "start"}, `starting fresh session ${shortSessionId}`);
                }
            }
        } finally {
            if (joinSuccess) SYNC(island);
        }
    }

    // if some earlier run through JOIN() has already processed latest.json, and updated
    // storedUrl (but not snapshotUrl, as checked above), send a SYNC.
    if (island.storedUrl !== null) {
        SYNC(island);
        return;
    }

    // otherwise, nothing to do at this point.  log that this client is waiting
    // for a snapshot (or empty string) from latest.json.
    client.logger.debug({event: "waiting-for-session-state"}, "waiting for session state");
}

function SYNC(island) {
    // invoked from:
    //    JOIN(), on successful join of a client or after fetchLatestSessionSpec
    //    SNAP(), to take advantage of the new snapshot
    const { id, seq, timeline, snapshotUrl: url, snapshotTime, snapshotSeq, persistentUrl, messages, tove, flags } = island;
    const time = advanceTime(island, "SYNC");
    const reflector = DEPIN ? registerRegion : CLUSTER;
    const args = { url, messages, time, seq, tove, reflector, timeline, flags };
    if (url) {args.snapshotTime = snapshotTime; args.snapshotSeq = snapshotSeq }
    else if (persistentUrl) { args.url = persistentUrl; args.persisted = true }
    if (DEPIN) {
        // a client will typically be joining in the middle of a work unit, and perhaps
        // after a snapshot - in which case the client won't see some of the messages
        // that contribute to this work unit's tallies.  to bring the client up to date,
        // we therefore send the tallies as they were at the time of the last snapshot
        // (if any) in this work unit, to set up before it starts fast-forwarding.
        const { depinStats } = ALL_SESSIONS.get(island.id);
        args.auditStatsInitializer = { ...depinStats.auditAtLastSnapshot, sessionTimeAtDispatch: depinStats.sessionTimeAtDispatch };
    }
    const response = JSON.stringify({ id, action: 'SYNC', args });
    const range = !messages.length ? '' : ` (#${messages[0][1]}...${messages[messages.length - 1][1]})`;
    const what = args.persisted ? "persisted" : "snapshot";
    for (const syncClient of island.syncClients) {
        if (syncClient.isConnected()) {
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
            announceUserJoined(syncClient);
        } else {
            syncClient.logger.debug({event: "send-sync-skipped"}, `socket closed before SYNC`);
        }
    }
    // synced all that were waiting
    island.syncClients.length = 0;
    // prepare to delete island if no-one has actually joined.
    if (island.clients.size === 0) provisionallyDeleteIsland(island);
    // on DePIN, ensure there is an audit timer (though the audits can be suppressed
    // under control of depinStats.canEarnCredit)
    if (DEPIN && !island.auditTimer) island.auditTimer = setInterval(() => AUDIT(island), depinTimeouts.AUDIT_INTERVAL);
}

function clientLeft(client, reason='') {
    if (DEPIN) server.removeClient(client.globalId, reason || "client left");

    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island) return;
    const wasClient = island.clients.delete(client);
    if (!wasClient) return;
    const remaining = island.clients.size + island.syncClients.length;
    client.logger.debug({
        event: "deleted",
        clientCount: island.clients.size,
        syncClientCount: island.syncClients.length,
    }, `session ${client.sessionId.slice(0, 8)} client deleted; ${remaining} remaining`);
    if (remaining === 0) provisionallyDeleteIsland(island);
    announceUserLeft(client);
}

function announceUserJoined(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island || !client.user || client.active === true) return;
    client.active = true;
    const didLeave = island.usersLeft.indexOf(client.user);
    if (didLeave !== -1) island.usersLeft.splice(didLeave, 1);
    else island.usersJoined.push(client.user);
    scheduleUsersMessage(island);
    client.logger.debug({
        event: "user-joined",
        user: typeof client.user === "string" ? client.user : JSON.stringify(client.user), // BigQuery wants a single data type
    }, `user ${JSON.stringify(client.user)} joined session ${client.sessionId.slice(0, 8)}`);
}

function announceUserLeft(client) {
    const island = ALL_ISLANDS.get(client.sessionId);
    if (!island || !client.user || client.active !== true) return;
    client.active = false;
    const didJoin = island.usersJoined.indexOf(client.user);
    if (didJoin !== -1) island.usersJoined.splice(didJoin, 1);
    else island.usersLeft.push(client.user);
    scheduleUsersMessage(island);
    client.logger.debug({
        event: "user-left",
        user: typeof client.user === "string" ? client.user : JSON.stringify(client.user), // BigQuery wants a single data type
    }, `user ${JSON.stringify(client.user)} left session ${client.sessionId.slice(0, 8)}`);
}

function scheduleUsersMessage(island) {
    if (!island.usersTimer) island.usersTimer = setTimeout(() => USERS(island), USERS_INTERVAL);
}

/** answer true if seqB comes after seqA */
function after(seqA, seqB) {
    const seqDelta = (seqB - seqA) >>> 0; // make unsigned
    return seqDelta > 0 && seqDelta < 0x8000000;
}

/** a size for a single message.  the client's Controller uses the same calculation. */
function payloadSizeForAccounting(message) {
    // every message needs to be associated with a size, that will be
    // aggregated into a byte tally for measuring synchronizer use.
    // for a string-encoded payload, the size is the length of the
    // string.  no room for interpretation.
    // for a custom (synchronizer-generated) object payload, we will have added
    // a _size property to ensure that synchronizer and clients see the same
    // value.
    // in both cases, we then add a constant 16 bytes to account for the
    // time and sequence properties - in that the summation needs to be
    // consistent and fair, even if not absolutely accurate.
    let messageSize = typeof message[2] === "string"
        ? message[2].length
        : message[2]._size;
    messageSize += 16; // as explained above
    return messageSize;
}

/** keep a histogram of observed latencies */

const Latencies = new Map();

// log latencies every 5 minutes
setInterval(logLatencies, 5 * 60 * 1000);

function logLatencies() {
    if (!Latencies.size) return;
    let ms = Date.now();
    for (const entry of Latencies.values()) {
        entry.latency.limits = LATENCY_BUCKETS;
        let count = 0;
        for (let i = 0; i < LATENCY_BUCKETS.length + 1; i++) count += entry.latency.hist[i];
        // latency log sink filters on scope="process" and event="latency"
        global_logger.notice(entry, `Latency ${Math.ceil(entry.latency.sum / count)} ms (${entry.latency.min}-${entry.latency.max} ms)`);
    }
    ms = Date.now() - ms;
    global_logger.debug({event: "latencies", ms, count: Latencies.size}, `Logged latency for ${Latencies.size} IP addresses in ${ms} ms`);
    Latencies.clear();
}

function recordLatency(client, ms) {
    if (ms >= 60000) return; // ignore > 1 min (likely old client sending time stamp not latency)

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

    if (client.latency) {
        // a DePIN client
        const { latency } = client;
        if (latency.min === null || ms < latency.min) latency.min = ms;
        if (latency.max === null || ms > latency.max) latency.max = ms;
        latency.count++;
        latency.sum += ms;
    }
}

/** client uploaded a snapshot
 * @param {Client} client - we received from this client
 * @param {{time: Number, seq: Number, hash: String, url: String}} args - the snapshot details
 */
function SNAP(client, args) {
    const id = client.sessionId;
    const shortSessionId = id.slice(0, 8);
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_SESSION); return }

    const { time, seq, hash, url, dissident, auditStats } = args; // details of the snapshot that has been uploaded
    const teatime = `@${time}#${seq}`;

    if (dissident) {
        client.logger.debug({
            event: "snapshot-dissident",
            teatime,
            hash,
            data: url,
            dissident: JSON.stringify(dissident),
        }, `dissident snapshot for ${shortSessionId}`);
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
        }, `ignoring snapshot for ${shortSessionId}`);
        return;
    }

    client.logger.debug({
        event: "snapshot",
        teatime,
        hash,
        data: url
    }, `got snapshot for ${shortSessionId}`);

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

    if (!DEPIN && STORE_MESSAGE_LOGS && messagesToStore.length) {
        // upload to the message-log bucket (not used under DePIN) a blob with all messages since the previous snapshot
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

    // keep snapshot
    island.snapshotTime = time;
    island.snapshotSeq = seq;
    island.snapshotUrl = url;

    if (DEPIN) {
        // capture the transition to the new snapshot, along with all messages currently
        // in the newMessages buffer - some of which might be before the snapshot, some
        // after - as an update that will be sent to the session runner as soon as
        // possible.
        const session = ALL_SESSIONS.get(id);
        session.gatherUpdateIfNeeded(true); // true => any change will do
        island.storedSeq = seq;
        island.storedUrl = url;
        if (auditStats) session.depinStats.auditAtLastSnapshot = auditStats;
        else console.error("snapshot uploaded without audit stats");
    }

    // SYNC waiting clients
    if (island.syncClients.length > 0) SYNC(island);
}

/** client uploaded persistent data
 * @param {Client} client - we received from this client
 * @param {{url: String}} args - the persistent data details
 */
function SAVE(client, args) {
    const id = client.sessionId;
    const island = ALL_ISLANDS.get(id);
    if (!island) { client.safeClose(...REASON.UNKNOWN_SESSION); return }
    const { developerId, region, appId, persistentId } = island;
    if (!appId || !persistentId) { client.safeClose(...REASON.BAD_APPID); return }

    const { persistTime, url, dissident } = args; // details of the persistent data that has been uploaded
    const descriptor = `@${persistTime}`;

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
    } else if (DEPIN) {
        const session = ALL_SESSIONS.get(id);
        session.sendToSessionRunner({ what: "PERSIST", url});
        client.logger.debug({event: "persist-sent", persistTime: descriptor, data: url}, "sent persistent data to session runner");
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
                msg: `Synchronizer message buffer almost full. Need snapshot ASAP.`,
                options: { level: "warning" }
            });
        }
    }

    const time = advanceTime(island, "SEND");
    if (island.delay) {
        const delay = island.lastTick + island.delay + 0.1 - time;    // add 0.1 ms to combat rounding errors
        if (island.delayed || delay > 0) { DELAY_SEND(island, delay, messages); return }
    }
    // @@ on cleanup of a session, it is possible for a SEND to be invoked after
    // the island has already been de-registered (for example, from a USERS() invoked
    // from usersTimer).  that's why we protect the DEPIN uses of it below.
    const session = ALL_SESSIONS.get(island.id);
    for (const message of messages) {
        // message = [time, seq, payload, ...] - keep whatever controller.sendMessage sends
        message[0] = time;
        message[1] = island.seq = (island.seq + 1) >>> 0; // seq is always uint32
        if (island.flags.rawtime) {
            const rawTime = getRawTime(island);
            message[message.length - 1] = rawTime; // overwrite the latency information from the controller
        }

        // see comment in payloadSizeForAccounting()
        // $$$ a malicious synchronizer could set an arbitrarily large _size
        // in the hope of boosting traffic stats.
        if (typeof message[2] !== "string") {
            const messageSize = JSON.stringify(message[2]).length;
            message[2]._size = messageSize;
        }

        const msg = JSON.stringify({ id: island.id, action: 'RECV', args: message });
        island.logger.trace({event: "broadcast-message", t: time, seq: island.seq}, `broadcasting RECV ${JSON.stringify(message)}`);
        prometheusMessagesCounter.inc();
        STATS.RECV++;
        STATS.SEND += island.clients.size;
        island.clients.forEach(each => each.active && each.safeSend(msg));
        if (DEPIN && session) {
            session.addMessageToUpdate(message); // the raw message
            const { depinStats } = session;
            // update stats, matching what will be in messages array (and therefore sent with any SYNC)
            depinStats.messagesIn++;
            depinStats.totalMessagesIn++;
            depinStats.auditPayloadTally += payloadSizeForAccounting(message);
        }
        island.messages.push(message); // raw message sent again in SYNC
    }
    island.lastMsgTime = time;
    if (DEPIN && session) session.gatherUpdateIfNeeded(false); // false => not a timeout; only gather if message buffer has hit its threshold (due to the messages just added)
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
    if (!island) { client.safeClose(...REASON.UNKNOWN_SESSION); return }

    // clients prior to 0.5.1 sent a tutti sequence number in second place.
    // clients now supply a seventh argument that is a tutti key made up of a
    // message topic or placeholder such as "snapshot" or "persist", suffixed with
    // the sendTime.
    // we keep a list of the sendTime and key/seq of completed tallies for up to
    // MAX_TALLY_AGE (currently 60s) since the sendTime.  a vote on a previously
    // unseen key and more than MAX_TALLY_AGE in the past will always be ignored.
    // see cleanUpCompletedTallies() for how we cope if the list accumulates more
    // than MAX_COMPLETED_TALLIES recent entries.
    const [ sendTime, _deprecatedTuttiSeq, payload, firstMsg, wantsVote, tallyTarget, tuttiKey ] = args;

    function tallyComplete() {
        const tally = island.tallies[tuttiKey];
        const { timeout, expecting: missing } = tally;
        clearTimeout(timeout);
        if (missing) island.logger.debug({
            event: "tutti-missing",
            tutti: tuttiKey,
            missingCount: missing
        }, `missing ${missing} ${missing === 1 ? "client" : "clients"} from tally ${tuttiKey}`);
        if (wantsVote || Object.keys(tally.payloads).length > 1) {
            const payloads = { what: 'tally', sendTime, tally: tally.payloads, tallyTarget, tuttiKey, missingClients: missing };
            const msg = [0, 0, payloads];
            if (island.flags.rawtime) msg.push(0); // will be overwritten with time value
            SEND(island, [msg]);
        }
        delete island.tallies[tuttiKey];
        island.completedTallies[tuttiKey] = sendTime;
        cleanUpCompletedTallies(island);
    }

    let tally = island.tallies[tuttiKey];
    if (!tally) { // either first client we've heard from, or one that's missed the party entirely
        const historyLimit = cleanUpCompletedTallies(island); // the limit of how far back we're currently tracking
        if (sendTime < historyLimit) {
            client.logger.debug({event: "tutti-reject", tutti: tuttiKey}, `rejecting vote for old tally ${tuttiKey} (${island.time - sendTime}ms)`);
            return;
        }
        if (island.completedTallies[tuttiKey]) {
            client.logger.debug({event: "tutti-reject", tutti: tuttiKey},  `rejecting vote for completed tally ${tuttiKey}`);
            return;
        }

        if (firstMsg) {
            const sendableMsg = [...firstMsg];
            if (island.flags.rawtime) sendableMsg.push(0); // will be overwritten with time value
            SEND(island, [sendableMsg]);
        }

        tally = island.tallies[tuttiKey] = {
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

    if (DEPIN) ALL_SESSIONS.get(island.id).updateTracker.forcedUpdateProps.set('completedTallies', {...completed});

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
    if (usersJoined.length + usersLeft.length === 0) return; // no-one joined or left
    const activeClients = [...clients].filter(each => each.active); // a client in the set but not active is between JOIN and SYNC
    const active = activeClients.length;
    const total = clients.size;
    const payload = { what: 'users', active, total };
    if (usersJoined.length > 0) payload.joined = [...usersJoined];
    if (usersLeft.length > 0) payload.left = [...usersLeft];
    if (active) {
        // do not trigger a SEND unless we expect someone to hear
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

        if (DEPIN) {
            const session = ALL_SESSIONS.get(island.id);
            if (session) {
                const { depinStats } = session;
                depinStats.auditLastUsers = total;
                if (depinStats.auditMinUsers === -1 || total < depinStats.auditMinUsers) depinStats.auditMinUsers = total;
                if (total > depinStats.auditMaxUsers) depinStats.auditMaxUsers = total;
            }
        }
    }
    if (heraldUrl) heraldUsers(island, activeClients.map(each => each.user), payload.joined, payload.left);
    usersJoined.length = 0;
    usersLeft.length = 0;
}

/** SEND a replicated message when it's time to audit the session
 * @param {IslandData} island
*/
function AUDIT(island) {
    const sessionId = island.id;
    const session = ALL_SESSIONS.get(sessionId);
    if (!session) return; // no stats to report
    if (!island.clients.size) return; // no-one to ask

    const { depinStats } = session;
    if (!depinStats.canEarnCredit) return; // demo and developer sessions cannot earn

    const payload = { what: 'audit' };
    const msg = [0, 0, payload];
    if (island.flags.rawtime) msg.push(0); // will be overwritten with time value
    SEND(island, [msg]);
    const { time } = island;
    island.logger.debug({
        event: "send-audit",
        teatime: time,
    }, `requesting audit for ${sessionId.slice(0, 8)} at time ${time}`);

    // the 'audit' message will have been sent immediately to clients, but only added to
    // the updateBuffer for sending to the session DO - where it might not get sent
    // for some time (and we can't necessarily flush that buffer immediately, because
    // we could be awaiting acknowledgement of a previous update blob).  so we build
    // it now, but store it in the depinStats and wait until the update blob that
    // includes the new audit time is about to be sent.  then we add the audit to that blob.

    const { auditLastUsers: lastUsers, auditMinUsers: minUsers, auditMaxUsers: maxUsers, auditPayloadTally: payloadTally, auditBytesIn: bytesIn, auditBytesOut: bytesOut, auditTicks: ticks } = depinStats;
    const audit = { syncName: SYNCNAME, time, lastUsers, minUsers, maxUsers, payloadTally, bytesIn, bytesOut, ticks };
    depinStats.auditForSessionRunner = audit;

    depinStats.auditMinUsers = depinStats.auditMaxUsers = lastUsers;
    depinStats.auditPayloadTally = depinStats.auditBytesIn = depinStats.auditBytesOut = depinStats.auditTicks = 0;

    island.lastAuditTime = time;
}

/** send back arguments as received.  iff the "rawtime" feature has been enabled for this client's session, and the client has supplied an object argument, add the time as a rawTime property on that object */
function PONG(client, args) {
    const island = client.island || ALL_ISLANDS.get(client.sessionId);
    if (island && island.flags.rawtime && typeof args === 'object') {
        const rawTime = getRawTime(island);
        args.rawTime = rawTime;
    }
    client.safeSend(JSON.stringify({ action: 'PONG', args }));
}

/** send a TICK message to advance time
 * @param {IslandData} island
 */
function TICK(island) {
    // we will send ticks if a client has joined, and the socket is open, and it is not backlogged
    const sendingTicksTo = client => client.active && client.isConnected() && !client.bufferedAmount;
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
        // only send ticks if joined and not backlogged
        if (sendingTicksTo(client)) {
            client.safeSend(msg);
            STATS.TICK++;
        }
    });
    if (DEPIN) {
        const session = ALL_SESSIONS.get(island.id);
        if (session) session.depinStats.auditTicks++;
    }
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
    if (!island) { client.safeClose(...REASON.UNKNOWN_SESSION); return }
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
    // invoked from
    //   clientLeft(), when remaining clients has dropped to zero
    //   SYNC(), if it turns out we have no clients
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
    }, `provisionally scheduling end of session ${id.slice(0, 8)}`);
    // NB: the deletion delay is currently safely longer than the retention on the dispatcher record
    session.timeout = setTimeout(() => deleteIsland(island, "no clients"), DELETION_DEBOUNCE);
}

// delete our live record of the island, rewriting latest.json if necessary and
// removing the dispatcher's record of the island being on this synchronizer.
// in case some clients have been dispatched to here just as the record's deletion
// is being requested, we maintain the session record for a brief period so we can
// tell those late-arriving clients that they must connect again (because any clients
// *after* them will be dispatched afresh).  because the dispatchers could end up
// assigning the session to this same synchronizer again, we only turn away clients
// for a second or so after the deregistering has gone through.
async function deleteIsland(island, reason) {
    const { id, snapshotUrl, time, seq, storedUrl, storedSeq, messages } = island;
    if (!ALL_ISLANDS.has(id)) {
        island.logger.debug({event: "delete-ignored", reason: "already-deleted"}, `island already deleted, ignoring deleteIsland();`);
        return;
    }
    const shortSessionId = id.slice(0, 8);
    if (island.usersTimer) {
        clearTimeout(island.usersTimer);
        USERS(island); // ping heraldUrl one last time
    }
    prometheusSessionGauge.dec();
    // stop ticking
    stopTicker(island);

    island.logger.notice({event: "end", reason}, `island ${shortSessionId} deleted`);

    // remove session, including deleting dispatcher record if there is one
    // (deleteIsland is only ever invoked after at least long enough to
    // outlast the record's retention limit).
    const teatime = `@${time}#${seq}`;
    if (DEPIN) {
        clearInterval(island.auditTimer);

        // in the DePIN case, we're hoping that the sessionSocket is still up and running.  if it is, we'll send whatever increment is needed to bring the session runner fully up to date.
        const session = ALL_SESSIONS.get(id);
        if (session.sessionSocket?.readyState === WebSocket.OPEN) {
            try {
                island.logger.info({
                    event: "flush-updates",
                    teatime,
                    msgCount: messages.length,
                }, `sending final updates to runner for session ${shortSessionId}`);
                // if there were any updates to send to the session DO, force a pause
                // to increase the chance that the session DO has those updates before
                // transferring the session to a new synq.
                const anySent = session.gatherAndFlushSessionUpdates();
                if (anySent) await new Promise(r => { setTimeout(r, 200) });
            } catch (err) {
                island.logger.warn({
                    event: "flush-updates-failed",
                    teatime,
                    err
                }, `failed to flush updates for session ${shortSessionId}. ${err.code}: ${err.message}`);
            }
        } else {
            island.logger.info({
                event: "flush-updates-skipped",
                teatime,
                msgCount: messages.length,
            }, `no connection for flushing updates for session ${shortSessionId}`);
        }
    } else {
        // not DePIN.
        // if we've been told of a snapshot since the one (if any) stored in this
        // island's latest.json, or there are messages since the snapshot referenced
        // there, write a new latest.json.
        // eslint-disable-next-line no-lonely-if
        if (STORE_SESSION && (snapshotUrl !== storedUrl || after(storedSeq, seq))) {
            cleanUpCompletedTallies(island);
            const path = `${id}/latest.json`;
            try {
                island.logger.debug({
                    event: "upload-latest",
                    teatime,
                    msgCount: messages.length,
                    path
                }, `uploading latest session spec with ${messages.length} messages`);
                const latestSpec = {};
                savableKeys(island).forEach(key => latestSpec[key] = island[key]);
                await uploadJSON(path, latestSpec);
            } catch (err) {
                island.logger.error({
                    event: "upload-latest-failed",
                    teatime,
                    msgCount: messages.length,
                    path,
                    err
                }, `failed to upload latest session spec. ${err.code}: ${err.message}`);
            }
        }
    }

    ALL_ISLANDS.delete(id);

    await deregisterSession(id, teatime); // on DePIN, will return immediately after telling the session runner (if connected) to abandon this synq.  await is used because in emergency shutdown on GCP we want to be sure to have removed the dispatch records before exiting.

    // rather than close the connections to any remaining clients, tell them explicitly
    // to reconnect (presumably to a different synq).
    if (DEPIN && island.clients.size > 0) {
        island.clients.forEach(client => client.safeSend(JSON.stringify({ id, action: 'RECONNECT' })));
    }
}

function scheduleShutdownIfNoJoin(id, targetTime, detail) {
    // invoked from registerSession (and refreshed on client connection), to schedule
    // a cleanup in case no JOIN happens in time.
    let session = ALL_SESSIONS.get(id); // callers always ensure that it's in the map...
    if (session.timeout) clearTimeout(session.timeout);
    const now = Date.now();
    session.timeout = setTimeout(() => {
        session = ALL_SESSIONS.get(id); // ...but by now it might have been removed
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
                deleteIsland(island, "no JOIN"); // will invoke deregisterSession
                return;
            }
            session.logger.debug({
                event: "delete-ignored",
                reason: "island-missing",
                detail,
            }, `stage=closable but no island to delete`);
        }
        deregisterSession(id, "no island");
    }, targetTime - now);
}

async function deregisterSession(id, detail) {
    // invoked...
    // - in a timeout from scheduleShutdownIfNoJoin
    // - from deleteIsland
    // - from offloadAllSessions, for a session that doesn't have an island
    // - from DePIN's session.offload - e.g., if session runner rejects synchronizer's connection - again, directly only if the session doesn't have an island
    const session = ALL_SESSIONS.get(id);
    if (session?.timeout) clearTimeout(session.timeout);
    if (!session || session.stage === 'closed') {
        const reason = session ? `stage=${session.stage}` : "no session record";
        global_logger.debug({sessionId: id, event: "deregister-ignored", reason, detail}, `ignoring deregister: ${reason}`);
        return;
    }

    session.logger.info({event: "deregister", detail}, `deregistering session ${id.slice(0, 8)}: ${detail}`);

    session.stage = 'closed';

    const finalDelete = () => {
        // on DePIN (only) there will be a socket connection to the session DO
        const { sessionSocket } = session;
        if (sessionSocket?.readyState === WebSocket.OPEN) {
            // we don't explicitly close the socket from here, but indicate that the
            // connection is over by sending SESSION_OFFLOADED.  the session runner
            // will close the socket from its end.
            session.sendToSessionRunner({ what: "SESSION_OFFLOADED", detail });
            session.socketKey = ''; // disable onClose processing (whenever the close comes through)
            session.sessionSocketClosed(); // includes cleaning up any clients that are still in negotiation (whereas any remaining fully connected clients in DEPIN are told explicitly to reconnect by deleteIsland)
        }
        ALL_SESSIONS.delete(id);
    };

    if (!DISPATCHER_BUCKET) {
        // no bucket to wait for
        finalDelete();
        return;
    }

    let filename = `${id}.json`;
    if (CLUSTER === "localWithStorage") filename = `testing/${filename}`;
    try {
        await DISPATCHER_BUCKET.file(filename).delete();
    } catch (err) {
        if (err.code === 404) session.logger.info({event: "deregister-failed", err}, `failed to deregister. ${err.code}: ${err.message}`);
        else session.logger.warn({event: "deregister-failed", err}, `failed to deregister. ${err.code}: ${err.message}`);
    }

    setTimeout(() => finalDelete, LATE_DISPATCH_DELAY);
}

function setUpClientHandlers(client) {
    const handleMessage = incomingMsg => {
        if (!client.isConnected()) return; // ignore messages arriving after we disconnected the client
        client.lastActivity = Date.now();
        const msgLength = incomingMsg.length;
        STATS.IN += msgLength;
        client.stats.mi += 1;             // messages in
        client.stats.bi += msgLength;     // bytes in

        let session;
        if (DEPIN && (session = ALL_SESSIONS.get(client.sessionId))) {
            session.depinStats.bytesIn += msgLength;
            session.depinStats.auditBytesIn += msgLength;
            session.depinStats.totalBytesIn += msgLength;
        }

        let parsedMsg;
        try {
            parsedMsg = JSON.parse(incomingMsg);
            if (typeof parsedMsg !== "object") throw Error("JSON did not contain an object");
        } catch (err) {
            client.logger.error({ event: "message-parsing-failed", err, incomingMsg }, `message parsing error: ${err.message}`);
            client.safeClose(...REASON.MALFORMED_MESSAGE);
            return;
        }
        try {
            const { action, args, tags } = parsedMsg;
            switch (action) {
                case 'JOIN': {
                    client.joinedSession = true;
                    JOIN(client, args);
                    break;
                }
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
                    // if (args && args.latency > 0) recordLatency(client, args.latency); - not actually sent by clients yet
                    client.logger.trace({ event: 'pulse' }, `receiving PULSE`);
                    break;
                case 'LOG': {
                    const clientLog = typeof args === "string" ? args : JSON.stringify(args);
                    client.logger.info({
                        event: "client-log",
                        reason: clientLog.replace(/ .*/, ''),
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
            client.logger.error({ event: "message-handling-failed", err }, `message handling failed: ${err.message}`);
            client.safeClose(...REASON.UNKNOWN_ERROR);
        }
    };
    client.on('message', incomingMsg => {
        if (ARTIFICIAL_DELAY) {
            const timeout = ARTIFICIAL_DELAY * (0.5 + Math.random());
            setTimeout(() => handleMessage(incomingMsg), timeout);
        } else {
            handleMessage(incomingMsg);
        }
    });

    client.on('close', (code, reason) => {
        // when the 'client' is a WebSocket, this will be triggered naturally by
        // any form of disconnection.
        // when working with WebRTC connections, the object representing a client
        // is only created once the data channel is set up.  we therefore only
        // trigger this event on closure of that channel - whether as a result of
        // deliberate local closure, or by the client, or due to a network glitch.
        prometheusConnectionGauge.dec();
        const island = client.island || ALL_ISLANDS.get(client.sessionId) || {};

        // connection duration in seconds
        client.stats.s = Math.ceil((Date.now() - client.since) / 1000);

        // connection log sink filters on scope="connection" and event="start|join|end"
        client.logger.notice({
            event: "end",
            stats: client.stats,
            code,
            reason,
            resumed: island.resumed, // to identify session starts
        }, `client closed connection [${code},"${reason}"]`);

        if (island && island.clients && island.clients.has(client)) {
            // on DePIN, sessions can be forcibly offloaded and _then_ tell the
            // clients.  in that case, no point processing a delayed departure.
            const session = ALL_SESSIONS.get(island.id);
            if (!session || session.stage === 'offloading' || session.stage === 'closed') {
                client.logger.debug({
                    event: "immediate-delete",
                }, `immediate deletion of client`);
                clientLeft(client, "disconnect from defunct session");
            } else {
                client.logger.debug({
                    event: "schedule-delete",
                    delay: island.leaveDelay,
                }, `scheduling client deletion in ${island.leaveDelay} ms`);
                setTimeout(() => clientLeft(client, "scheduled deletion"), island.leaveDelay);
            }
        } else if (DEPIN) {
            // on GCP, a closed client will automatically drop out of server.clients,
            // so if it has not yet joined an island there will be no lingering record.
            // not so on DePIN.
            client.logger.debug({
                event: "immediate-delete",
            }, `immediate deletion of non-joined client`);
            clientLeft(client, "disconnect without joining session");
        }
    });

    client.on('error', err => client.logger.error({ event: "client-socket-error", err }, `Client Socket Error: ${err.message}`));

    client.stats = { mi: 0, mo: 0, bi: 0, bo: 0 }; // messages / bytes, in / out
    client.safeSend = data => {
        if (!client.isConnected()) return;

        const dataLength = data.length;
        STATS.BUFFER = Math.max(STATS.BUFFER, client.bufferedAmount);
        const CHUNK_SIZE = DEPIN ? 64000 : 1000000;
        try {
            if (dataLength <= CHUNK_SIZE) client.send(data);
            else {
                const header = '_CHUNK';
                let ind = 0;
                let isFirst = true;
                let isLast;
                while (ind < dataLength) {
                    isLast = ind + CHUNK_SIZE >= dataLength;
                    const chunkData = `${header}${isFirst ? '1' : '0'}${isLast ? '1' : '0'}${data.slice(ind, ind + CHUNK_SIZE)}`;
                    client.send(chunkData);
                    ind += CHUNK_SIZE;
                    isFirst = false;
                }
            }
        } catch (err) {
            // NB: if node-datachannel throws an error, it will be logged in full to
            // the console because of our initLogger settings.  but it is being caught,
            // as intended.
            client.logger.error({ event: "send-failed", err }, `failed to send to client. ${err.code}: ${err.message}`);
            client.safeClose(...REASON.RECONNECT);
            return; // skip the bookkeeping
        }

        // NB: for better or for worse, we don't count any overhead introduced by
        // chunking (and neither does the client).  just the effective bytes transferred.
        STATS.OUT += dataLength;
        client.stats.mo += 1;               // messages out
        client.stats.bo += dataLength;     // bytes out

        let session;
        if (DEPIN && (session = ALL_SESSIONS.get(client.sessionId))) {
            const { depinStats } = session;
            depinStats.bytesOut += dataLength;
            depinStats.auditBytesOut += dataLength;
            depinStats.totalBytesOut += dataLength;
        }
    };
    client.safeClose = (code, data) => {
        try {
            client.close(code, data);
        } catch (err) {
            client.logger.warn({ event: "close-failed", err }, `failed to close client connection. ${err.code}: ${err.message}`);
            clientLeft(client, "failed safeClose"); // normally invoked by onclose handler
        }
    };
}

function registerSession(sessionId) {
    // record that this session has been assigned here (though it won't have a
    // corresponding island until the first client joins).
    // add a buffer to how long we wait before trying to delete the dispatcher
    // record.  one purpose served by this buffer is to stay available for a
    // client that finds its connection isn't working (SYNC fails to arrive), and
    // after 5 seconds will try to reconnect.  so we respect it even on DePIN.
    let deregisterDelay = DISPATCH_RECORD_RETENTION + 2000;
    if (!DEPIN && CLUSTER === 'localWithStorage') {
        // FOR TESTING WITH LOCAL SYNCHRONIZER ONLY
        // no dispatcher was involved in getting here.  create for ourselves a dummy
        // record in the /testing sub-bucket.
        deregisterDelay += 2000; // creating the record probably won't take longer than this
        const filename = `testing/${sessionId}.json`;
        const dummyContents = { dummy: "imadummy" };
        const start = Date.now();
        uploadJSON(filename, dummyContents, DISPATCHER_BUCKET)
            .then(() => global_logger.debug({ event: "dummy-register" }, `dummy dispatcher record created in ${Date.now() - start}ms`))
            .catch(err => global_logger.error({ event: "dummy-register-failed", err }, `failed to create dummy dispatcher record. ${err.code}: ${err.message}`));
    }
    const earliestDeregister = Date.now() + deregisterDelay;
    const session = {
        stage: 'runnable',
        earliestDeregister,
        reconnectDelay: 0,
        // interim logger, which will be replaced when first user joins
        logger: empty_logger.child({
            ...global_logger.bindings(),
            scope: "session",
            sessionId,
        }),
    };
    ALL_SESSIONS.set(sessionId, session);
    scheduleShutdownIfNoJoin(sessionId, earliestDeregister, "no JOIN in time");
}

function registerClientInSession(client, sessionId) {
    // the client has been successfully set up with a connection (which takes more
    // steps in DePIN than otherwise).  now sign it up with the session it belongs to.
    let session = ALL_SESSIONS.get(sessionId);
    if (session) {
        switch (session.stage) {
            case 'offloading':
            case 'closed':
                // a request to delete the dispatcher record (on GCP) or to offload
                // (on DePIN) has already been sent.  tell client to reconnect.
                session.logger.info({ event: "defunct-record", ...client.meta }, "rejecting connection; session record is defunct");
                client.close(...REASON.RECONNECT); // safeClose doesn't exist yet
                return;
            case 'runnable':
            case 'closable': {
                // make sure the deregister timeout has at least 7s to run - same as
                // the initial deregisterDelay set up below - to give this client a
                // chance to join (even if it's in a very busy browser)
                const now = Date.now();
                const targetTime = Math.max(session.earliestDeregister, now + 7000);
                scheduleShutdownIfNoJoin(sessionId, targetTime, "no JOIN after connection");
                break;
                }
            default:
                // session must be 'running'.  just continue to set up the client.
        }
    } else if (!DEPIN) {
        // it's a session that this synchronizer didn't already have running.  under
        // GCP, that's normal for the first client.
        registerSession(sessionId);
        session = ALL_SESSIONS.get(sessionId); // now that it's there
    } else {
        // on DePIN, it's not supposed to happen
        global_logger.warn({ event: "session-not-found", ...client.meta, sessionId }, `rejecting connection; session not found`);
        client.close(...REASON.RECONNECT);
        return;
    }

    prometheusConnectionGauge.inc(); // connection accepted
    client.logger = empty_logger.child({...session.logger.bindings(), ...client.meta});

    STATS.USERS = Math.max(STATS.USERS, server.clients.size);

    client.lastActivity = Date.now();
    client.on('pong', time => {
        client.lastActivity = Date.now();
        const latency = client.lastActivity - time;
        client.logger.debug({event: "pong", latency}, `pong from ${client.meta.userIp} after ${latency} ms`);
        });
    setTimeout(() => client.isConnected() && client.ping(Date.now()), 100);

    client.joinedSession = false;
    if (DISCONNECT_UNRESPONSIVE_CLIENTS) {
        // eslint-disable-next-line no-inner-declarations
        function checkForActivity() {
            if (!client.isConnected()) return;
            const now = Date.now();
            const quiescence = now - client.lastActivity;
            if (quiescence > DISCONNECT_THRESHOLD) {
                client.logger.debug({event: "disconnecting", reason: "inactive", quiescence}, `inactive for ${quiescence} ms, disconnecting`);
                client.safeClose(...REASON.INACTIVE); // NB: close event won't arrive for a while
                return;
            }
            if (quiescence > PING_THRESHOLD) {
                if (!client.joinedSession) {
                    client.logger.debug({event: "disconnecting", reason: "no-join", quiescence}, `did not join within ${quiescence} ms, disconnecting`);
                    client.safeClose(...REASON.NO_JOIN);
                    return;
                }
            }
            setTimeout(checkForActivity, CHECK_INTERVAL);
        }
        setTimeout(checkForActivity, PING_THRESHOLD + 2000); // allow some time for establishing session
    }

    client.sessionId = sessionId; // successfully registered
}

async function fetchSecret() {
    let secret;
    try {
        global_logger.info({event: "fetching-secret", name: SECRET_NAME}, "fetching secret");
        const version = await new SecretManagerServiceClient().accessSecretVersion({ name: SECRET_NAME });
        secret = version[0].payload.data;
    } catch (err) {
        global_logger.error({event: "fetch-secret-failed", err}, `failed to fetch secret: ${err.message}`);
        process.exit(EXIT.FATAL);
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


const PROD_SIGN_SERVER = "https://api.croquet.io/sign";
const DEV_SIGN_SERVER = `https://api.${GCP_PROJECT}.croquet.dev/sign`;
const API_SERVER_URL = GCP_PROJECT === 'croquet-proj' ? PROD_SIGN_SERVER : DEV_SIGN_SERVER;

async function verifyApiKey(apiKey, url, appId, persistentId, id, sdk, client, unverifiedDeveloperId) {
    // VERIFY_TOKEN is always false on DePIN
    if (!VERIFY_TOKEN) return { developerId: unverifiedDeveloperId, region: "default" };
    try {
        const urlObj = new URL(url);
        const origin = urlObj.origin;
        const path = urlObj.pathname;
        const response = await fetch(`${API_SERVER_URL}/reflector/${CLUSTER}/${HOSTNAME}?meta=verify`, {
            headers: {
                "Origin": origin,
                "Referer": url, // [sic]
                "X-Croquet-Path": path,
                "X-Croquet-Auth": apiKey,
                "X-Croquet-App": appId,
                "X-Croquet-Id": persistentId,
                "X-Croquet-Session": id,
                "X-Croquet-Version": sdk,
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
            INFO(island || {id},
                {
                    code: "KEY_VERIFICATION_FAILED",
                    msg: error,
                    options: { level: "error", only: "once" }
                },
                [client]
                );
            client.safeClose(...REASON.BAD_APIKEY);
        }
    } catch (err) {
        client.logger.error({event: "apikey-verify-error", err}, `error verifying API key: ${err.message}`);
    }
    return false;
}

/** fetch from our storage bucket an object that was JSON-encoded */
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
        } catch (err) { reject(err) }
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
        } catch (err) { reject(err) }
    });
}

let performanceNowAdjustment = 0;
function stabilizedPerformanceNow() { return performance.now() + performanceNowAdjustment }

if (TIME_STABILIZED) {
    // to provide a close-to-real rate of advance of teatime and raw time on Docker, which has a known clock-drift issue that they work around with periodic NTP-based compensatory jumps of Date.now, we watch for telltale jumps of Date.now against performance.now.  based on the aggregated total of jumps seen since synchronizer startup, we continuously calculate the implied rate of drift and use that to accumulate an offset (performanceNowAdjustment) to be applied to all performance.now queries on this synchronizer.
    const dateAtStart = Date.now();
    let totalJumps = 0;
    let dateAdjustmentRatio = 0; // the ratio of Date.now advance engineered with the help of jumps, relative to if the jumps had not been there
    let lastOffset = null;
    let lastCheck = null;
    let lastReport = Date.now();
    const REPORT_INTERVAL = 15 * 60 * 1000; // every 15 mins
    const REPORT_THRESHOLD = 6 / 60000; // anything under 6ms per minute isn't worth shouting about
    // eslint-disable-next-line no-inner-declarations
    function measureDatePerformanceOffset() {
        const boostAsMsPerMin = boost => `${(boost * 60000).toFixed(1)}ms/min`;
        const now = Date.now();
        const perfNow = performance.now(); // could try to stabilise this too, but since we're checking every 1000ms obviously 2nd-order effects are negligible
        const newOffset = now - perfNow;
        if (lastOffset !== null) {
            const jump = newOffset - lastOffset; // if Date has been jumped forwards, this will be +ve - possibly some tens of ms
            totalJumps += jump;
            const impliedRatio = totalJumps / (now - dateAtStart); // assumption is that - especially after any jump - Date _is_ advancing at a 1:1 rate wrt atomic time
            if (Math.abs(jump) > 5) {
                global_logger.notice({
                    event: "stabilization-jump",
                }, `estimated jump of ${Math.round(jump)}ms (total since start ${Math.round(totalJumps)}ms); implied boost ${boostAsMsPerMin(impliedRatio)}`);
                lastReport = now;
            }
            const smooth = 0.2;
            dateAdjustmentRatio = impliedRatio * smooth + dateAdjustmentRatio * (1 - smooth);

            const gap = perfNow - lastCheck;
            // if dateAdjustmentRatio is positive, performance.now is running slow and should be boosted.
            const extraDateAdjustment = gap * dateAdjustmentRatio; // how much Docker would have boosted Date.now during this gap
            performanceNowAdjustment += extraDateAdjustment;
        }
        lastOffset = newOffset;
        lastCheck = perfNow;

        if (now - lastReport >= REPORT_INTERVAL) {
            if (Math.abs(dateAdjustmentRatio) >= REPORT_THRESHOLD) {
                global_logger.notice({
                    event: "stabilization-report",
                }, `estimated drift since start ${Math.round(totalJumps)}ms; current boost ${boostAsMsPerMin(dateAdjustmentRatio)}`);
            }
            lastReport = now;
        }
    }

    global_logger.notice({
        event: "stabilization-start",
    }, "starting time-stabilization watcher");
    setInterval(measureDatePerformanceOffset, 1000); // keeps going as long as the synchronizer is running
}

openToClients();

exports.server = server;
exports.Socket = WebSocket.Socket;
