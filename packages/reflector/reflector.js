// when running on node, 'ws' is the actual web socket module
// when running in browser, 'ws' is our own './ws.js'
// (in-browser mode is not supported right now)

const os = require('os');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const prometheus = require('prom-client');
const { Storage } = require('@google-cloud/storage');

// debugging (should read env vars)
const googleCloudProfiler = true;
const googleCloudDebugger = false;

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

// we use Google Cloud Storage for session state
const storage = new Storage();
const bucket = storage.bucket('croquet-sessions-v1');

const port = 9090;
const VERSION = "v1";
const SERVER_HEADER = `croquet-reflector-${VERSION}`;
const SNAP_TIMEOUT = 30000;   // time in ms to wait for SNAP from island's first client
const DELETION_DEBOUNCE = 10000; // time in ms to wait before deleting an island
const TICK_MS = 1000 / 5;     // default tick interval
const ARTIFICIAL_DELAY = 0;   // delay messages randomly by 50% to 150% of this
const MAX_MESSAGES = 10000;   // messages per island to retain since last snapshot
const MIN_SCALE = 1 / 64;     // minimum ratio of island time to wallclock time
const MAX_SCALE = 64;         // maximum ratio of island time to wallclock time
const TALLY_INTERVAL = 1000;  // maximum time to wait to tally TUTTI contributions

const hostname = os.hostname();
const {wlan0, eth0, en0} = os.networkInterfaces();
const hostip = (wlan0 || eth0 || en0).find(each => each.family==='IPv4').address;
let cluster = fs.existsSync("/var/run/secrets/kubernetes.io") ? "" : "local"; // name set async for k8s

function logtime() {
    if (cluster !== "local" ) return "";
    const d = new Date();
    const dd = new Date(d - d.getTimezoneOffset() * 60 * 1000);
    return dd.toISOString().replace(/.*T/, "").replace("Z", " ");
}
function LOG( ...args) { console.log( `${logtime()}Reflector-${VERSION}(${cluster}:${hostip}):`, ...args); }
function WARN(...args) { console.warn(`${logtime()}Reflector-${VERSION}(${cluster}:${hostip}):`, ...args); }
function ERROR(...args) { console.error(`${logtime()}Reflector-${VERSION}(${cluster}:${hostip}):`, ...args); }

// return codes for closing connection
// client wil try to reconnect for codes < 4100
const REASON = {};
REASON.UNKNOWN_ISLAND = [4000, "unknown island"];
REASON.UNRESPONSIVE = [4001, "client unresponsive"];
REASON.INACTIVE = [4002, "client inactive"];
REASON.BAD_PROTOCOL = [4100, "outdated protocol"];
REASON.DORMANT = [4110, "dormant"]; // sent by client, will not display error
REASON.NO_JOIN = [4121, "client never joined"];

// this webServer is only for http:// requests to the reflector url
// (e.g. the load-balancer's health check),
// not ws:// requests for an actual websocket connection
const webServer = http.createServer( (req, res) => {
    if (req.url === '/metrics') {
        const body = prometheus.register.metrics();
        res.writeHead(200, {
            'Server': SERVER_HEADER,
            'Content-Length': body.length,
            'Content-Type': prometheus.register.contentType,
        });
        return res.end(body);
    }
    if (req.url === '/sessions') {
        const body = [...ALL_ISLANDS.values()].map(({id, clients}) => `${id} ${clients.size}\n`).join('');
        res.writeHead(200, {
            'Server': SERVER_HEADER,
            'Content-Length': body.length,
            'Content-Type': 'text/plain',
        });
        return res.end(body);
    }
    // redirect http-to-https, unless it's a health check
    if (req.headers['x-forwarded-proto'] === 'http' && req.url !== '/healthz') {
        res.writeHead(301, {
            'Server': SERVER_HEADER,
            'Location': `https://${req.headers.host}${req.url}`
        });
        return res.end();
    }
    // otherwise, show hostname, url, and http headers
    const body = `Croquet reflector-${VERSION} ${hostname} (${cluster}:${hostip})\n${req.method} http://${req.headers.host}${req.url}\n${JSON.stringify(req.headers, null, 4)}`;
    res.writeHead(200, {
      'Server': SERVER_HEADER,
      'Content-Length': body.length,
      'Content-Type': 'text/plain'
    });
    return res.end(body);
  });
// the WebSocket.Server will intercept the UPGRADE request made by a ws:// websocket connection
const server = new WebSocket.Server({ server: webServer });

function startServer() {
    webServer.listen(port);
    LOG(`starting ${server.constructor.name} ws://${hostname}:${port}/`);
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
        for (const [_id, island] of ALL_ISLANDS.entries()) {
            if (island.deletionTimeout) clearTimeout(island.deletionTimeout);
            promises.push(deleteIsland(island));
        }
        if (promises.length) {
            console.log(`\nEMERGENCY SHUTDOWN OF ${promises.length} ISLAND(S)`);
            Promise.all(promises).then(() => process.exit());
        } else process.exit();
    }
}
process.on('SIGINT', handleTerm);
process.on('SIGTERM', handleTerm);


// start server
if (cluster === "local") {
    startServer();
    watchStats();
} else {
    // Start Debugger & Profiler
    // eslint-disable-next-line global-require
    if (googleCloudProfiler) require('@google-cloud/profiler').start({
        serviceContext: { service: 'reflector' },
    });
    // eslint-disable-next-line global-require
    if (googleCloudDebugger) require('@google-cloud/debug-agent').start({
        allowExpressions: true,
        serviceContext: { service: 'reflector' },
    });
    http.get('http://metadata.google.internal/computeMetadata/v1/instance/attributes/cluster-name',
        { headers: {'Metadata-Flavor' : 'Google'} },
        response => {
            response.on('data', data => cluster += data);
            response.on('end', () => startServer());
        }
    ).on("error", err => {
        ERROR("FATAL: failed to get cluster name.", err.message);
        process.exit(1);
    });
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

/** Get current time for island
 * @param {IslandData} island
 */
function getTime(island) {
    const now = Date.now();
    const delta = now - island.before;     // might be < 0 if system clock went backwards
    if (delta > 0) {
        // tick requests usually come late; sometimes tens of ms late.  keep track of such overruns, and whenever there is a net lag inject a small addition to the delta (before scaling) to help the island catch up.
        const desiredTick = island.tick;
        let advance = delta; // default
        if (delta > desiredTick / 2) { // don't interfere with rapid-fire message-driven requests
            const over = delta - desiredTick;
            if (over > 0) {
                advance = desiredTick; // upper limit, subject to possible adjustment below
                if (over < 100) island.lag += over; // don't try to cater for very large delays (e.g., at startup)
            }
            if (island.lag > 0) {
                const boost = 4; // seems to be about the smallest that will rein things in
                advance += boost;
                island.lag -= boost;
            }
        }
        island.time += island.scale * advance;
        island.before = now;
    }
    return island.time;
}

function nonSavableProps() {
    return {
        lag: 0,              // aggregate ms lag in tick requests
        clients: new Set(),  // connected web sockets
        usersJoined: [],     // the users who joined since last report
        usersLeft: [],       // the users who left since last report
        ticker: null,        // interval for serving TICKs
        before: Date.now(),  // last getTime() call
        yetToCheckLatest: true, // flag used while fetching latest.json during startup
        storedUrl: null,     // url of snapshot in latest.json (null before we've checked latest.json)
        storedSeq: -1,       // seq of last message in latest.json message addendum
        startTimeout: null,  // pending START request timeout (should send SNAP)
        deletionTimeout: null, // pending deletion after all clients disconnect
        syncClients: [],     // clients waiting to SYNC
        tallies: {},
        [Symbol.toPrimitive]: () => "dummy",
        };
}

function savableKeys(island) {
    const nonSavable = nonSavableProps(); // make a new one
    return Object.keys(island).filter(key => !Object.prototype.hasOwnProperty.call(nonSavable, key));
}

/** A new island controller is joining
 * @param {Client} client - we received from this client
 * @param {{time: Number, name: String, version: Number, user: [name, id]}} args
 */
function JOIN(client, args) {
    if (typeof args === "number" || !args.version) {
        client.close(...REASON.BAD_PROTOCOL);
        return;
    }
    const id = client.sessionId;
    LOG(id, "received JOIN", JSON.stringify(args));
    const { name, version, user } = args;
    if (user) {
        // strip off any existing user info
        const baseAddr = client.addr.split(' [')[0];
        client.addr = `${baseAddr} ${JSON.stringify(user)}`;
        client.user = user;
        if (client.location) {
            if (Array.isArray(user)) user.push(client.location);
            else if (typeof user === "object") user.location = client.location;
        }
    }
    // create island data if this is the first client
    let island = ALL_ISLANDS.get(id);
    if (!island) {
        island = {
            id,                  // the island id
            name,                // the island name, including options (or could be null)
            version,             // the client version
            time: 0,             // the current simulation time
            seq: 0,              // sequence number for messages (uint32, wraps around)
            scale: 1,            // ratio of island time to wallclock time
            tick: TICK_MS,       // default tick rate
            delay: 0,            // hold messages until this many ms after last tick
            snapshotTime: -1,    // time of last snapshot
            snapshotSeq: null,   // seq of last snapshot
            snapshotUrl: '',     // url of last snapshot
            messages: [],        // messages since last snapshot
            lastTick: 0,         // time of last TICK sent
            lastMsgTime: 0,      // time of last message reflected
            lastCompletedTally: null,
            ...nonSavableProps(),
            [Symbol.toPrimitive]: () => `${name} ${id}`,
            };
        ALL_ISLANDS.set(id, island);
        prometheusSessionGauge.inc();
    }
    client.island = island;

    // if we had provisionally scheduled deletion of the island, cancel that
    if (island.deletionTimeout) {
        clearTimeout(island.deletionTimeout);
        island.deletionTimeout = null;
    }

    // start broadcasting messages to client
    island.clients.add(client);

    // we need to SYNC
    island.syncClients.push(client);

    // if we have a current snapshot, reply with that
    if (island.snapshotUrl) { SYNC(island); return; }

    // if we haven't yet checked latest.json, look there first
    if (island.yetToCheckLatest) {
        island.yetToCheckLatest = false;
        const fileName = `${id}/latest.json`;
        fetchJSON(fileName)
        .then(latestSpec => {
            LOG(id, "spec from latest.json: snapshot url ", latestSpec.snapshotUrl, "number of messages", latestSpec.messages.length);
            savableKeys(island).forEach(key => island[key] = latestSpec[key]);
            island.storedUrl = latestSpec.snapshotUrl;
            island.storedSeq = latestSpec.seq;
            if (island.tick) startTicker(island, island.tick);
            if (island.syncClients.length > 0) SYNC(island);
        }).catch(err => {
            if (err.code !== 404) ERROR(id, err.message);
            island.storedUrl = ''; // replace the null that means we haven't looked
            START();
        });

        return;
    }

    // if we've checked latest.json, and updated storedUrl (but not snapshotUrl,
    // as checked above), this must be a brand new island.  send a START.
    if (island.storedUrl !== null && !island.startTimeout) { START(); return; }

    // otherwise, nothing to do at this point.  log that this client is waiting
    // for a snapshot either from latest.json or from a STARTed client.
    LOG(id, "client waiting for snapshot", client.addr);

    function START() {
        // find next client
        do {
            client = island.syncClients.shift();
            if (!client) return; // no client waiting
        } while (client.readyState !== WebSocket.OPEN);
        const msg = JSON.stringify({ id, action: 'START' });
        client.safeSend(msg);
        LOG(id, 'sending START', client.addr, msg);
        // if the client does not provide a snapshot in time, we need to start over
        island.startTimeout = setTimeout(() => {
            island.startTimeout = null;
            // kill client
            LOG(id, "START client failed to respond", client.addr);
            if (client.readyState === WebSocket.OPEN) client.close(...REASON.UNRESPONSIVE);
            // start next client
            START();
            }, SNAP_TIMEOUT);
    }
}

function SYNC(island) {
    const { id, snapshotUrl: url, messages } = island;
    const time = getTime(island);
    const response = JSON.stringify({ id, action: 'SYNC', args: { url, messages, time } });
    const range = !messages.length ? '' : ` (#${messages[0][1]}...${messages[messages.length - 1][1]})`;
    for (const syncClient of island.syncClients) {
        if (syncClient.readyState === WebSocket.OPEN) {
            syncClient.safeSend(response);
            LOG(id, `@${island.time}#${island.seq} sending SYNC ${syncClient.addr} ${response.length} bytes, ${messages.length} messages${range}, snapshot: ${url}`);
            announceUserDidJoin(island, syncClient);
        } else {
            LOG(id, 'cannot send SYNC to', syncClient.addr);
        }
    }
    // synced all that were waiting
    island.syncClients.length = 0;
}

/** An island controller is leaving
 * @param {Client} client - we received from this client
 */
function LEAVING(client) {
    const id = client.sessionId;
    LOG(id, 'received', client.addr, 'LEAVING');
    const island = ALL_ISLANDS.get(id);
    if (!island) return;
    island.clients.delete(client);
    if (island.clients.size === 0) provisionallyDeleteIsland(island);
    else announceUserDidLeave(island, client);
}

function announceUserDidJoin(island, client) {
    if (!client.user || client.active === true) return;
    client.active = true;
    island.usersJoined.push(client.user);
}

function announceUserDidLeave(island, client) {
    if (!client.user || client.active === false) return;
    client.active = false;
    island.usersLeft.push(client.user);
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
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(...REASON.UNKNOWN_ISLAND); return; }

    const { time, seq, hash, url } = args; // details of the snapshot that has been uploaded

    // to decide if the announced snapshot deserves to replace the existing one we
    // compare times rather than message seq, since (at least in principle) a new
    // snapshot can be taken after some elapsed time but no additional external messages.
    if (time <= island.snapshotTime) {
        LOG(id, `@${island.time}#${island.seq} ignoring snapshot ${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'}`);
        return;
    }

    LOG(id, `@${island.time}#${island.seq} got snapshot ${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'}`);

    if (island.snapshotUrl) {
        // forget older messages, setting aside the ones that need to be stored
        let messagesToStore = [];
        const msgs = island.messages;
        if (msgs.length > 0) {
            const keep = msgs.findIndex(msg => after(seq, msg[1]));
            if (keep > 0) {
                LOG(id, `forgetting ${msgs.length - keep} of ${msgs.length} messages #${msgs[0][1] >>> 0} to #${msgs[keep - 1][1] >>> 0} (keeping #${msgs[keep][1] >>> 0})`);
                messagesToStore = msgs.splice(0, keep); // we'll store all those we're forgetting
            } else if (keep === -1) {
                LOG(id, `forgetting all of ${msgs.length} messages (#${msgs[0][1] >>> 0} to #${msgs[msgs.length - 1][1] >>> 0})`);
                messagesToStore = msgs.slice();
                msgs.length = 0;
            }
        }

        if (messagesToStore.length) {
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
            const logName = `${id}/${pad(time)}_${firstSeq}-${seq}-${hash}.json`;
            LOG(id, `@${island.time}#${island.seq} uploading messages between times ${island.snapshotTime} and ${time} (seqs ${firstSeq} to ${seq}) to ${logName}`);
            uploadJSON(logName, messageLog);
        }
    } else if (island.time === 0) {
        // this is the initial snapshot from the user we sent START
        LOG(id, `@${island.time}#${island.seq} init ${time}#${seq} from SNAP`);
        island.time = time;
        island.seq = seq;
        announceUserDidJoin(island, client);
    } else {
        // this is the initial snapshot, but it's an old client (<=0.2.5) that already requested TICKS()
        LOG(id, `@${island.time}#${island.seq} not initializing time from snapshot (old client)`);
    }

    // keep snapshot
    island.snapshotTime = time;
    island.snapshotSeq = seq;
    island.snapshotUrl = url;

    // start waiting clients
    if (island.startTimeout) { clearTimeout(island.startTimeout); island.startTimeout = null; }
    if (island.syncClients.length > 0) SYNC(island);
}

/** send a message to all participants after time stamping it
 * @param {Island} island - the island to send to
 * @param {Array<Message>} messages
 */
function SEND(island, messages) {
    if (!island) return; // client never joined?!
    const time = getTime(island);
    if (island.delay) {
        const delay = island.lastTick + island.delay + 0.1 - time;    // add 0.1 ms to combat rounding errors
        if (island.delayed || delay > 0) { DELAY_SEND(island, delay, messages); return; }
    }
    for (const message of messages) {
        // message = [time, seq, payload, ...] - keep whatever controller.sendMessage sends
        message[0] = time;
        message[1] = island.seq = (island.seq + 1) >>> 0; // seq is always uint32
        const msg = JSON.stringify({ id: island.id, action: 'RECV', args: message });
        //LOG(id, "broadcasting RECV", message);
        prometheusMessagesCounter.inc();
        STATS.RECV++;
        STATS.SEND += island.clients.size;
        island.clients.forEach(each => each.safeSend(msg));
        island.messages.push(message); // raw message sent again in SYNC
    }
    island.lastMsgTime = time;
    if (island.messages.length > MAX_MESSAGES) {
        island.messages.splice(0, MAX_MESSAGES - island.messages.length);
        island.snapshot = null;
    }
    startTicker(island, island.tick);
}

/** handle a message that all clients are expected to be sending
 * @param {?Client} client - we received from this client
 * @param {[sendTime: Number, sendSeq: Number, payload: String, firstMsg: Array, wantsVote: Boolean, tallyTarget: Array]} args
 */
function TUTTI(client, args) {
    const id = client.sessionId;
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client && client.readyState === WebSocket.OPEN) client.close(...REASON.UNKNOWN_ISLAND); return; }

    const [ sendTime, tuttiSeq, payload, firstMsg, wantsVote, tallyTarget ] = args;

    const tallyHash = `${tuttiSeq}:${sendTime}`;
    function tallyComplete() {
        const tally = island.tallies[tallyHash];
        clearTimeout(tally.timeout);
        if (wantsVote || Object.keys(tally.payloads).length > 1) {
            const payloads = { what: 'tally', tuttiSeq, tally: tally.payloads, tallyTarget };
            const msg = [0, 0, payloads];
            SEND(island, [msg]);
        }
        delete island.tallies[tallyHash];
        const lastComplete = island.lastCompletedTally;
        if (lastComplete === null || after(lastComplete, tuttiSeq)) island.lastCompletedTally = tuttiSeq;
    }

    if (!island.tallies[tallyHash]) { // either first client we've heard from, or one that's missed the party entirely
        const lastComplete = island.lastCompletedTally;
        if (lastComplete !== null && (tuttiSeq === lastComplete || after(tuttiSeq, lastComplete))) {
            // too late
            LOG(id, `rejecting tally of ${tuttiSeq} cf completed ${lastComplete}`);
            return;
        }

        if (firstMsg) SEND(island, [firstMsg]);
        island.tallies[tallyHash] = {
            expecting: island.clients.size,
            payloads: {},
            timeout: setTimeout(tallyComplete, TALLY_INTERVAL)
            };
    }

    const tally = island.tallies[tallyHash];
    tally.payloads[payload] = (tally.payloads[payload] || 0) + 1;
    if (--tally.expecting === 0) tallyComplete();
}

// delay for the client to generate local ticks
function DELAY_SEND(island, delay, messages) {
    if (!island.delayed) {
        stopTicker(island);
        island.delayed = [];
        setTimeout(() => DELAYED_SEND(island), delay);
        //LOG(island.id, ">>>>>>>>>>>>>> Delaying for", delay, "ms");
    }
    island.delayed.push(...messages);
    //LOG(island.id, ">>>>>>>>>>>>>> Delaying", ...args);
}

function DELAYED_SEND(island) {
    const { delayed } = island;
    island.delayed = null;
    //LOG(island.id, ">>>>>>>>>>>>>> Sending delayed messages", delayed);
    SEND(island, delayed);
}

/** SEND a replicated message when clients joined or left
 * @param {IslandData} island
*/
function USERS(island) {
    const { id, clients, usersJoined, usersLeft } = island;
    const active = [...clients].filter(each => each.active).length;
    const total = clients.size;
    const payload = { what: 'users', active, total };
    if (usersJoined.length > 0) payload.joined = [...usersJoined];
    if (usersLeft.length > 0) payload.left = [...usersLeft];
    const msg = [0, 0, payload];
    SEND(island, [msg]);
    LOG(id, `Users ${island}: +${usersJoined.length}-${usersLeft.length}=${clients.size} (total ${ALL_ISLANDS.size} islands, ${server.clients.size} users)`);
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

    const { id, usersJoined, usersLeft, lastMsgTime, tick, scale } = island;
    if (usersJoined.length + usersLeft.length > 0) { USERS(island); return; }
    const time = getTime(island);
    if (time - lastMsgTime < tick * scale) return;
    island.lastTick = time;
    const msg = JSON.stringify({ id, action: 'TICK', args: time });
    //LOG(id, 'broadcasting', msg);
    prometheusTicksCounter.inc();
    island.clients.forEach(client => {
        // only send ticks if not back-logged
        if (client.bufferedAmount) return;
        client.safeSend(msg);
        STATS.TICK++;
    });
}

/** client is requesting ticks for an island
 * @param {Client} client - we received from this client
 * @param {*} args
 */
function TICKS(client, args) {
    const id = client.sessionId;
    const { tick, delay, scale } = args;
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(...REASON.UNKNOWN_ISLAND); return; }
    if (!island.snapshotUrl) {
         // this must be an old client (<=0.2.5) that requests TICKS before sending a snapshot
        const { time, seq } = args;
        LOG(id, `@${island.time}#${island.seq} init ${time}#${seq} from TICKS (old client)`);
        island.time = typeof time === "number" ? Math.ceil(time) : 0;
        island.seq = typeof seq === "number" ? seq : 0;
        announceUserDidJoin(island, client);
    }
    if (!island.time) {
        // only accept delay if new island
        if (delay > 0) island.delay = delay;
    }
    if (scale > 0) island.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (tick > 0) startTicker(island, tick);
}

function startTicker(island, tick) {
    if (island.ticker) stopTicker(island);
    island.tick = tick;
    island.ticker = setInterval(() => TICK(island), tick);
    //LOG(id, `Sending TICKs every ${tick} ms to ${island}`)
}

function stopTicker(island) {
    clearInterval(island.ticker);
    island.ticker = null;
    //LOG(id, "STOPPED TICKS");
}

// impose a delay on island deletion, in case clients are only going away briefly
function provisionallyDeleteIsland(island) {
    if (!island.deletionTimeout) island.deletionTimeout = setTimeout(() => deleteIsland(island), DELETION_DEBOUNCE);
}

// delete our live record of the island, rewriting latest.json if necessary
async function deleteIsland(island) {
    prometheusSessionGauge.dec();
    const { id, snapshotUrl, time, seq, storedUrl, storedSeq, messages } = island;
    // stop ticking and delete
    stopTicker(island);
    ALL_ISLANDS.delete(id);
    // house keeping below only in fleet mode
    if (cluster === "local") return true;
    // remove ourselves from session registry, ignoring errors
    // TODO: return this promise along with the other promise below
    unregisterSession(island);
    // if we've been told of a snapshot since the one (if any) stored in this
    // island's latest.json, or there are messages since the snapshot referenced
    // there, write a new latest.json.
    if (snapshotUrl !== storedUrl || after(storedSeq, seq)) {
        const fileName = `${id}/latest.json`;
        LOG(id, `@${time}#${seq} uploading latest.json with ${messages.length} messages`);
        const latestSpec = {};
        savableKeys(island).forEach(key => latestSpec[key] = island[key]);
        return uploadJSON(fileName, latestSpec);
    }
    return true;
}

async function unregisterSession(island) {
    if (cluster === "local") return;
    const { id, time, seq } = island;
    LOG(id, `@${time}#${seq} unregistering session`);
    try {
        await storage.bucket('croquet-reflectors-v1').file(`${id}.json`).delete();
    } catch (err) {
        WARN("Failed to unregister", id, err);
    }
}

function sessionIdAndVersionFromUrl(url) {
    // extract version and session from /foo/bar/v1/session?baz
    const path = url.replace(/\?.*/, "");
    const sessionId = path.replace(/.*\//, "");
    const versionMatch = path.match(/\/(v[0-9]+[^/]*|dev)\/[^/]*$/);
    const version = versionMatch ? versionMatch[1] : "v0";
    return { sessionId, version };
}

server.on('connection', (client, req) => {
    prometheusConnectionGauge.inc();
    const { version, sessionId } = sessionIdAndVersionFromUrl(req.url);
    if (!sessionId) { ERROR(`Missing session id in request "${req.url}"`); client.close(...REASON.BAD_PROTOCOL); return; }
    client.sessionId = sessionId;
    client.addr = `${req.connection.remoteAddress.replace(/^::ffff:/, '')}:${req.connection.remotePort}`;
    if (req.headers['x-forwarded-for']) client.addr += ` (${req.headers['x-forwarded-for'].split(/\s*,\s*/).map(a => a.replace(/^::ffff:/, '')).join(', ')})`;
    // location header is added by load balancer, see region-servers/apply-changes
    if (req.headers['x-location']) try {
        const [region, city, lat, lng] = req.headers['x-location'].split(",");
        client.location = { region };
        if (city) client.location.city = { name: city, lat: +lat, lng: +lng };
    } catch (ex) { /* ignore */}
    client.safeSend = data => {
        if (client.readyState !== WebSocket.OPEN) return;
        STATS.BUFFER = Math.max(STATS.BUFFER, client.bufferedAmount);
        client.send(data);
        STATS.OUT += data.length;
    };
    LOG(sessionId, `connection ${version} from ${client.addr} ${req.headers['x-location']}`);
    STATS.USERS = Math.max(STATS.USERS, server.clients.size);

    let lastActivity = Date.now();
    client.on('pong', time => {
        lastActivity = Date.now();
        LOG(sessionId, 'pong from', client.addr, 'after', Date.now() - time, 'ms');
        });
    setTimeout(() => client.readyState === WebSocket.OPEN && client.ping(Date.now()), 100);

    let joined = false;
    const CHECK_INTERVAL = 5000;
    const PING_THRESHOLD = 30000; // if not heard from for this long, start pinging
    const PING_INTERVAL = 5000;
    const DISCONNECT_THRESHOLD = 60000; // if not for this long, disconnect
    function checkForActivity() {
        if (client.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        const quiescence = now - lastActivity;
        if (quiescence > DISCONNECT_THRESHOLD) {
            LOG(sessionId, "inactive client: closing connection from", client.addr, "inactive for", quiescence, "ms");
            client.close(...REASON.INACTIVE); // NB: close event won't arrive for a while
            return;
        }
        let nextCheck;
        if (quiescence > PING_THRESHOLD) {
            if (!joined) {
                LOG(sessionId, "client never joined: closing connection from", client.addr, "after", quiescence, "ms");
                client.close(...REASON.NO_JOIN);
                return;
            }

            LOG(sessionId, "pinging client", client.addr, "inactive for", quiescence, "ms");
            client.ping(now);
            nextCheck = PING_INTERVAL;
        } else nextCheck = CHECK_INTERVAL;
        setTimeout(checkForActivity, nextCheck);
    }
    setTimeout(checkForActivity, PING_THRESHOLD + 2000); // allow some time for establishing session

    client.on('message', incomingMsg => {
        lastActivity = Date.now();
        STATS.IN += incomingMsg.length;
        const handleMessage = () => {
            const { action, args } = JSON.parse(incomingMsg);
            switch (action) {
                case 'JOIN': { joined = true; JOIN(client, args); break; }
                case 'SEND': SEND(client.island, [args]); break;
                case 'TUTTI': TUTTI(client, args); break;
                case 'TICKS': TICKS(client, args); break;
                case 'SNAP': SNAP(client, args); break;
                case 'LEAVING': LEAVING(client); break;
                case 'PING': PONG(client, args); break;
                case 'PULSE': if (cluster === "local") LOG('PULSE', client.addr); break; // nothing to do
                default: WARN(sessionId, "unknown action", action);
            }
        };

        if (ARTIFICIAL_DELAY) {
            const timeout = ARTIFICIAL_DELAY * (0.5 + Math.random());
            setTimeout(handleMessage, timeout);
        } else {
            handleMessage();
        }
    });

    client.on('close', () => {
        prometheusConnectionGauge.dec();
        LOG(`${client.sessionId} closed connection from ${client.addr}`);
        const island = ALL_ISLANDS.get(client.sessionId);
        if (!island) unregisterSession(client.sessionId);
        else {
            island.clients.delete(client);
            if (island.clients.size === 0) provisionallyDeleteIsland(island);
            else announceUserDidLeave(island, client);
        }
    });
});

/** fetch a JSON-encoded object from our storage bucket */
async function fetchJSON(filename) {
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
async function uploadJSON(filename, object) {
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
