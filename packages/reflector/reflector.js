// when running on node, 'ws' is the actual web socket module
// when running in browser, 'ws' is our own './ws.js'
// (in-browser mode is not supported right now)

const os = require('os');
const http = require('http');
const WebSocket = require('ws');

const port = 9090;
const SERVER_HEADER = "croquet-reflector";
const SNAP_TIMEOUT = 10000;   // time in ms to wait for SNAP from island's first client
const TICK_MS = 1000 / 5;     // default tick interval
const ARTIFICIAL_DELAY = 0;   // delay messages randomly by 50% to 150% of this
const MAX_MESSAGES = 10000;   // messages per island to retain since last snapshot
const MIN_SCALE = 1 / 64;     // minimum ratio of island time to wallclock time
const MAX_SCALE = 64;         // maximum ratio of island time to wallclock time

function LOG(...args) { console.log((new Date()).toISOString(), "Reflector:", ...args); }
function WARN(...args) { console.warn((new Date()).toISOString(), "Reflector:", ...args); }

// this webServer is only for http:// requests to the reflector url
// (e.g. the load-balancer's health check),
// not ws:// requests for an actual websocket connection
const webServer = http.createServer( (req, res) => {
    // redirect http-to-https, unless it's a health check
    if (req.headers['x-forwarded-proto'] === 'http' && req.url !== '/healthz') {
        res.writeHead(301, {
            'Server': SERVER_HEADER,
            'Location': `https://${req.headers.host}${req.url}`
        });
        return res.end();
    }
    // otherwise, show hostname, url, and http headers
    const body = `Croquet reflector ${os.hostname()}\n${req.method} http://${req.headers.host}${req.url}\n${JSON.stringify(req.headers, null, 4)}`;
    res.writeHead(200, {
      'Server': SERVER_HEADER,
      'Content-Length': body.length,
      'Content-Type': 'text/plain'
    });
    return res.end(body);
  });
// the WebSocket.Server will intercept the UPGRADE request made by a ws:// websocket connection
const server = new WebSocket.Server({ server: webServer });
webServer.listen(port);
LOG(`starting ${server.constructor.name} ws://${os.hostname()}:${server.address().port}/`);

const STATS_TO_AVG = ["RECV", "SEND", "TICK", "IN", "OUT"];
const STATS_TO_MAX = ["USERS", "BUFFER"];
const STATS_KEYS = [...STATS_TO_MAX, ...STATS_TO_AVG];
const STATS = {
    time: Date.now(),
};
for (const key of STATS_KEYS) STATS[key] = 0;

setInterval(showStats, 10000);

// if running on node, log stats to file
const appendFile = (typeof process !== 'undefined') && require("fs").appendFile; // eslint-disable-line global-require

const fileName = "stats.txt";

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
    if (appendFile) {
        const line = `${(new Date(time)).toISOString().slice(0, 19)}Z ${STATS_KEYS.map(key => STATS[key]).join(' ')}\n`;
        appendFile(fileName, line, _err => { });
    }
    for (const key of STATS_KEYS) STATS[key] = 0;
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

/** A new island controller is joining
 * @param {Client} client - we received from this client
 * @param {ID} id - island ID
 * @param {{time: Number, name: String, version: Number, user: [name, id]}} args
 */
function JOIN(client, id, args) {
    if (typeof args === "number" || !args.version) {
        client.close(4100, "outdated protocol"); // in the range for errors that are unrecoverable
        return;
    }

    LOG('received', client.addr, 'JOIN', id, args);
    const { time, name, version, user } = args;
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
    const island = ALL_ISLANDS.get(id) || {
        id,                  // the island id
        name,                // the island name, including options (or could be null)
        version,             // the client version
        time,                // the current simulation time
        seq: 0,              // sequence number for messages (uint32, wraps around)
        scale: 1,            // ratio of island time to wallclock time
        tick: TICK_MS,       // default tick rate
        delay: 0,            // hold messages until this many ms after last tick
        lag: 0,              // aggregate ms lag in tick requests
        clients: new Set(),  // connected web sockets
        usersJoined: [],     // the users who joined since last report
        usersLeft: [],       // the users who left since last report
        snapshotTime: -1,    // time of last snapshot
        snapshotUrl: '',     // url of last snapshot
        pendingSnapshotTime: -1, // time of pending snapshot
        messages: [],        // messages since last snapshot
        before: Date.now(),  // last getTime() call
        lastTick: 0,         // time of last TICK sent
        lastMsgTime: 0,      // time of last message reflected
        ticker: null,        // interval for serving TICKs
        startTimeout: null,   // pending START request timeout (should send SNAP)
        syncClients: [],     // clients waiting to SYNC
        [Symbol.toPrimitive]: () => `${name} ${id}`,
    };
    ALL_ISLANDS.set(id, island);

    // start broadcasting messages to client
    island.clients.add(client);

    // we need to SYNC
    island.syncClients.push(client);

    // if we have a current snapshot, reply with that
    if (island.snapshotUrl) { SYNC(island); return; }

    // if first client, start it
    if (!island.startTimeout) { START(); return; }

    // otherwise, the first client has not started yet (not provided a snapshot via SNAP)
    console.log(`>>> client ${client.addr} waiting for snapshot`);

    function START() {
        // find next client
        do {
            client = island.syncClients.shift();
            if (!client) return; // no client waiting
        } while (client.readyState !== WebSocket.OPEN);
        const msg = JSON.stringify({ id, action: 'START' });
        client.safeSend(msg);
        LOG('sending', client.addr, msg);
        // if the client does not provide a snapshot in time, we need to start over
        island.startTimeout = setTimeout(() => {
            island.startTimeout = null;
            // kill client
            LOG(">>> killing unresponsive ", client.addr);
            if (client.readyState === WebSocket.OPEN) client.close(4001, "client unresponsive");
            // start next client
            START();
            }, SNAP_TIMEOUT);
    }
}

function SYNC(island) {
    const { snapshotUrl: url, messages } = island;
    const time = getTime(island);
    const response = JSON.stringify({ id: island.id, action: 'SYNC', args: { url, messages, time } });
    const range = !messages.length ? '' : ` (#${messages[0][1]}...${messages[messages.length - 1][1]})`;
    for (const syncClient of island.syncClients) {
        if (syncClient.readyState === WebSocket.OPEN) {
            syncClient.safeSend(response);
            LOG(`sending ${syncClient.addr} SYNC ${response.length} bytes, ${messages.length} messages${range}, snapshot: ${url}`);
            userDidJoin(island, syncClient);
        } else {
            LOG('cannot send SYNC to', syncClient.addr);
        }
    }
    // synced all that were waiting
    island.syncClients.length = 0;
}

/** An island controller is leaving
 * @param {Client} client - we received from this client
 * @param {ID} id - island ID
 */
function LEAVING(client, id) {
    LOG('received', client.addr, 'LEAVING', id);
    const island = ALL_ISLANDS.get(id);
    if (!island) return;
    island.clients.delete(client);
    if (island.clients.size === 0) deleteIsland(island);
    else userDidLeave(island, client);
}

function userDidJoin(island, client) {
    if (!client.user) return;
    client.active = true;
    island.usersJoined.push(client.user);
}

function userDidLeave(island, client) {
    if (!client.user) return;
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
 * @param {ID} id - island ID
 * @param {{time: Number, seq: Number, hash: String, url: String}} args - the snapshot details
 */
function SNAP(client, id, args) {
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    const { time, seq, hash, url } = args;
    if (time <= island.snapshotTime) return;
    LOG(`${island} got snapshot ${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'}`);
    if (!url) {
        // if another client was faster, ignore
        if (time <= island.pendingSnapshotTime) return;
        island.pendingSnapshotTime = time;
        // if no url, tell that client (the fastest one) to upload it
        const serveMsg = JSON.stringify({ id, action: 'HASH', args: { ...args, serve: true } });
        LOG('sending', client.addr, serveMsg);
        client.safeSend(serveMsg);
        // and tell everyone else the hash
        const others = [...island.clients].filter(each => each !== client);
        if (others.length > 0) {
            const hashMsg = JSON.stringify({ id, action: 'HASH', args: { ...args, serve: false } });
            LOG('sending to', others.length, 'other clients:', hashMsg);
            others.forEach(each => each.safeSend(hashMsg));
        }
        return;
    }
    // keep snapshot
    island.snapshotTime = time;
    island.snapshotUrl = url;
    // forget older messages
    if (island.messages.length > 0) {
        const msgs = island.messages;
        const keep = msgs.findIndex(msg => after(seq, msg[1]));
        if (keep > 0) {
            LOG(`${island} forgetting messages #${msgs[0][1] >>> 0} to #${msgs[keep - 1][1] >>> 0} (keeping #${msgs[keep][1] >>> 0})`);
            msgs.splice(0, keep);
        } else if (keep === -1) {
            LOG(`${island} forgetting all messages (#${msgs[0][1] >>> 0} to #${msgs[msgs.length - 1][1] >>> 0})`);
            msgs.length = 0;
        }
    }
    // start waiting clients
    if (island.startTimeout) { clearTimeout(island.startTimeout); island.startTimeout = null; }
    if (island.syncClients.length > 0) SYNC(island);
}

/** reflect a message to all participants after time stamping it
 * @param {?Client} client - we received from this client
 * @param {ID} id - island ID
 * @param {Array<Message>} messages
 */
function SEND(client, id, messages) {
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client && client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    const time = getTime(island);
    if (island.delay) {
        const delay = island.lastTick + island.delay + 0.1 - time;    // add 0.1 ms to combat rounding errors
        if (island.delayed || delay > 0) { DELAY_SEND(island, delay, messages); return; }
    }
    for (const message of messages) {
        // message = [time, seq, payload]
        message[0] = time;
        message[1] = island.seq = (island.seq + 1) | 0;               // clients before V1 expect int32
        const msg = JSON.stringify({ id, action: 'RECV', args: message });
        //LOG("broadcasting RECV", message);
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

// delay for the client to generate local ticks
function DELAY_SEND(island, delay, messages) {
    if (!island.delayed) {
        stopTicker(island);
        island.delayed = [];
        setTimeout(() => DELAYED_SEND(island), delay);
        //console.log(">>>>>>>>>>>>>> Delaying for", delay, "ms");
    }
    island.delayed.push(...messages);
    //console.log(">>>>>>>>>>>>>> Delaying", ...args);
}

function DELAYED_SEND(island) {
    const { id, delayed } = island;
    island.delayed = null;
    //console.log(">>>>>>>>>>>>>> Sending delayed messages", delayed);
    SEND(null, id, delayed);
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
    SEND(null, id, [msg]);
    LOG(`${island}: ${clients.size} users (total ${ALL_ISLANDS.size} islands, ${server.clients.size} users)`);
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
    const { id, usersJoined, usersLeft, lastMsgTime, tick, scale } = island;
    if (usersJoined.length + usersLeft.length > 0) { USERS(island); return; }
    const time = getTime(island);
    if (time - lastMsgTime < tick * scale) return;
    island.lastTick = time;
    const msg = JSON.stringify({ id, action: 'TICK', args: time });
    //LOG('broadcasting', msg);
    island.clients.forEach(client => {
        // only send ticks if not back-logged
        if (client.bufferedAmount) return;
        client.safeSend(msg);
        STATS.TICK++;
    });
}

/** client is requesting ticks for an island
 * @param {Client} client - we received from this client
 * @param {ID} id - island ID
 * @param {*} args
 */
function TICKS(client, id, args) {
    const { time, seq, tick, delay, scale } = args;
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    if (!island.time) {
        // only accept time, sequence, and delay if new island
        island.time = typeof time === "number" ? Math.ceil(time) : 0;
        island.seq = typeof seq === "number" ? seq : 0xFFFFFFF0;    // v0 clients expect this value
        if (delay > 0) island.delay = delay;
        // now that we know time & seq, send USERS to first client
        userDidJoin(island, client);
        USERS(island);
    }
    if (scale > 0) island.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (tick > 0) startTicker(island, tick);
}

function startTicker(island, tick) {
    if (island.ticker) stopTicker(island);
    island.tick = tick;
    island.ticker = setInterval(() => TICK(island), tick);
    //LOG(`Sending TICKs every ${tick} ms to ${island}`)
}

function stopTicker(island) {
    clearInterval(island.ticker);
    island.ticker = null;
    //console.log("STOPPED TICKS");
}

// map island hashes to island/session ids
const SESSIONS = {};

function sessionIdForHash(hash) {
    if (!SESSIONS[hash]) SESSIONS[hash] = ("" + Math.random()).slice(2, 8); // 6 digits should be more than enough

    return `${hash}-${SESSIONS[hash]}`;
}

/** client is requesting a session for an island
 * @param {Client} client - we received from this client
 * @param {ID} hash - island hash
 * @param {*} args
 */
function SESSION(client, hash, args) {
    if (!args) args = {};
    const id = sessionIdForHash(hash);
    const response = JSON.stringify({ action: 'SESSION', args: { hash, id } });
    LOG(`SESSION ${client.addr} for ${hash} is ${id}`);
    client.safeSend(response);
}

/** client is requesting a session reset
 * @param {Client} client - we received from this client
 * @param {ID} hash - island hash
 */
function SESSION_RESET(client, hash) {
    const oldID = sessionIdForHash(hash);
    const island = ALL_ISLANDS.get(oldID);
    if (island) deleteIsland(island);
    delete SESSIONS[hash]; // force a new ID...
    LOG(`SESSION_RESET ${hash}; new ID is ${sessionIdForHash(hash)}`); // ...which will be generated by this!
}

function deleteIsland(island) {
    const { id } = island;
    const msg = JSON.stringify({ id, action: 'LEAVE' });
    for (const client of island.clients) {
        client.safeSend(msg);
    }
    stopTicker(island);
    ALL_ISLANDS.delete(id);
}


const replies = {};

server.on('connection', (client, req) => {
    client.addr = `${req.connection.remoteAddress}:${req.connection.remotePort}`;
    if (req.headers['x-forwarded-for']) client.addr += ` (${req.headers['x-forwarded-for'].split(/\s*,\s*/).join(', ')})`;
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
    LOG(`connection #${server.clients.size} from ${client.addr}`);
    STATS.USERS = Math.max(STATS.USERS, server.clients.size);

    let lastActivity = Date.now();
    client.on('pong', time => {
        lastActivity = Date.now();
        LOG('socket-level pong from', client.addr, 'after', Date.now() - time, 'ms');
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
            LOG("inactive client: closing connection from", client.addr, "inactive for", quiescence, "ms");
            client.close(4120, "client inactive"); // NB: close event won't arrive for a while
            return;
        }
        let nextCheck;
        if (quiescence > PING_THRESHOLD) {
            if (!joined) {
                LOG("client never joined: closing connection from", client.addr, "after", quiescence, "ms");
                client.close(4121, "client never joined");
                return;
            }

            LOG("pinging client", client.addr, "inactive for", quiescence, "ms");
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
            const { id, action, args } = JSON.parse(incomingMsg);
            if (action in replies) {
                LOG('received', client.addr, 'reply', action, incomingMsg.length, 'bytes');
                replies[action](args);
            } else switch (action) {
                case 'JOIN': { joined = true; JOIN(client, id, args); break; }
                case 'SEND': SEND(client, id, [args]); break;
                case 'TICKS': TICKS(client, id, args); break;
                case 'SNAP': SNAP(client, id, args); break;
                case 'LEAVING': LEAVING(client, id); break;
                case 'PING': PONG(client, args); break;
                case 'SESSION': SESSION(client, id, args); break;
                case 'SESSION_RESET': SESSION_RESET(client, id); break;
                case 'PULSE': LOG('PULSE', client.addr); break; // nothing to do
                default: WARN("unknown action", action);
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
        LOG(`closed connection from ${client.addr}`);
        for (const island of ALL_ISLANDS.values()) {
            if (!island.clients.has(client)) continue;
            island.clients.delete(client);
            if (island.providers) island.providers.delete(client);  // only in v0
            if (island.clients.size === 0) deleteIsland(island);
            else userDidLeave(island, client);
        }
    });
});

exports.server = server;
exports.Socket = WebSocket.Socket;
