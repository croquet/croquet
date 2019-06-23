// when running on node, 'ws' is the actual web socket module
// when running in browser, 'ws' is our own './ws.js'
const WebSocket = require('ws');

const port = 9090;
const SERVE_TIMEOUT = 10000;  // time in ms to wait for SERVE
const TICK_MS = 1000 / 5;     // default tick interval
const ARTIFICAL_DELAY = 0;    // delay messages randomly by 50% to 150% of this
const MAX_MESSAGES = 10000;   // messages per island to retain since last snapshot
const MAX_SNAPSHOT_MS = 5000; // time in ms before a snapshot is considered too "old" to serve
const MIN_SCALE = 1 / 64;     // minimum ratio of island time to wallclock time
const MAX_SCALE = 64;         // maximum ratio of island time to wallclock time

function LOG(...args) { console.log((new Date()).toISOString(), "Reflector:", ...args); }
function WARN(...args) { console.warn((new Date()).toISOString(), "Reflector:", ...args); }

const server = new WebSocket.Server({ port });
LOG(`starting ${server.constructor.name} ws://localhost:${server.address().port}/`);

const STATS_TO_AVG = [ "RECV", "SEND", "TICK", "IN", "OUT" ];
const STATS_TO_MAX = [ "USERS", "BUFFER" ];
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
        appendFile(fileName, line, _err => {});
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
        if (delta > desiredTick/2) { // don't interfere with rapid-fire message-driven requests
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

/** @returns {ID} A random 128 bit hex ID */
function randomID() {
    let id = '';
    for (let i = 0; i < 4; i++) id += (Math.random() * 0x10000|0).toString(16).padStart(4, '0');
    return id;
}

/** remove a random element, return it */
function removeRandomElement(array) {
    const index = Math.floor(Math.random() * array.length);
    const element = array[index];
    array.splice(index, 1);
    return element;
}

/** A new island controller is joining
 * @param {Client} client - we received from this client
 * @param {ID} id - island ID
 * @param {number} time
 */
function JOIN(client, id, args) {
    if (typeof args === "number") args = {time: args};    // very old clients send just time
    if (!args.version) args.version = 0;                  // clients before V1 send no version
    if (args.version >= 1) { JOIN1(client, id, args); return; }
    LOG('received', client.addr, 'JOIN', id, args);
    const {time, name, user} = args;
    if (user) client.addr += ` [${user}]`;
    // create island data if this is the first client
    const island = ALL_ISLANDS.get(id) || {
        id,                  // the island id
        name,                // the island name (might be null)
        time,                // the current simulation time
        seq: 0xFFFFFFF0,     // sequence number for messages with same time
        scale: 1,            // ratio of island time to wallclock time
        tick: TICK_MS,       // default tick rate
        delay: 0,            // hold messages until this many ms after last tick
        lag: 0,              // aggregate ms lag in tick requests
        clients: new Set(),  // connected web sockets
        providers: new Set(),// clients that are running
        snapshot: null,      // a current snapshot or null
        messages: [],        // messages since last snapshot
        before: Date.now(),  // last getTime() call
        lastTick: 0,         // time of last TICK sent
        lastMsgTime: 0,      // time of last message reflected
        ticker: null,        // interval for serving TICKs
        serveTimeout: null,  // pending SERVE request timeout
        syncClients: [],     // clients waiting to SYNC
        [Symbol.toPrimitive]: () => `${name} ${id}`,
    };
    ALL_ISLANDS.set(id, island);

    // start broadcasting messages to client
    island.clients.add(client);

    // all other running clients can potentially provide a snapshot
    const providers = Array.from(island.providers).filter(ea => ea.readyState === WebSocket.OPEN);

    // if first client, start it
    if (!providers.length) { START(); return; }

    function START() {
        // only older clients send a time on JOIN, newer ones explicitly request TICKS
        if (time !== undefined) {
            island.time = Math.ceil(time);
            startTicker(island, 1000 / 20);
        }
        const msg = JSON.stringify({id, action: 'START'});
        if (client.readyState === WebSocket.OPEN) {
            client.safeSend(msg);
            LOG('sending', client.addr, msg);
            island.providers.add(client);
        } else {
            LOG('cannot send START to', client.addr);
        }
    }

    function SYNC(syncClients, snapshot, firstMessage) {
        const response = JSON.stringify({ id, action: 'SYNC', args: snapshot });
        for (const syncClient of syncClients) {
            if (syncClient.readyState === WebSocket.OPEN) {
                syncClient.safeSend(response);
                LOG('sending', syncClient.addr, 'SYNC', response.length, 'bytes, time:', snapshot.time);
                island.providers.add(client);
                const msg = JSON.stringify({ id, action: 'RECV', args: firstMessage });
                if (firstMessage) syncClient.safeSend(msg);
            } else {
                LOG('cannot send SYNC to', syncClient.addr);
            }
        }
        // synced all that were waiting
        syncClients.length = 0;
    }

    // otherwise, we need to SYNC
    island.syncClients.push(client);

    // if we have a current snapshot, reply with that
    // first message after snapshot is noop, so still good
    if (island.snapshot && island.messages.length <= 1 && island.time - island.snapshot.time < MAX_SNAPSHOT_MS) {
        SYNC(island.syncClients, island.snapshot, island.messages[0]);
        return;
    }
    LOG(`>>> ${island.snapshot ? 'Have' : 'No'} snapshot, ${island.messages.length} messages${island.snapshot ? ' delta: ' + (island.time - island.snapshot.time) : ''}`);

    // if SERVE request is already pending, return
    if (island.syncClients.length > 1)  {
        LOG(`adding ${client.addr} to sync wait list (now ${island.syncClients.length} waiting)`);
        return;
    }

    // otherwise, send a new SERVE request
    const reply = randomID();

    // when reply comes in with the snapshot, send it back
    replies[reply] = snapshot => {
        LOG("received snapshot", id, snapshot.time);
        delete replies[reply];
        clearTimeout(island.serveTimeout);
        island.snapshot = snapshot;
        island.messages = [];
        SYNC(island.syncClients, snapshot);
    };

    sendServeRequest("initial " + client.addr);

    function sendServeRequest(debug) {
        LOG(">>> sendServeRequest ", debug);

        // send serve requests to all providers, waiting 200 ms inbetween
        const provider = removeRandomElement(providers);
        if (provider) {
            if (provider.readyState !== WebSocket.OPEN) { sendServeRequest("provider closing " + provider.addr); return; }
            const msg = JSON.stringify({ id, action: 'SERVE', args: reply });
            LOG('sending', provider.addr, msg);
            provider.safeSend(msg);
            clearTimeout(island.serveTimeout);
            island.serveTimeout = setTimeout(() => sendServeRequest("SERVE timeout from " + provider.addr), SERVE_TIMEOUT);
            return;
        }

        // when no more providers left to try, START instead
        LOG(">>> no providers left to SERVE");

        // remove this client from the sync list. It should be the first one, and not started yet, right?
        const firstToSync = island.syncClients.shift();
        if (!firstToSync) return; // no client waiting
        if (client !== firstToSync) { console.error('>>> sendServeRequest ERROR client not firstToSync'); }
        client = firstToSync;
        if (island.providers.has(client)) { console.error('>>> sendServeRequest ERROR client already started?'); }

        // kill clients that did not respond to SERVE request
        for (const unresponsive of island.providers) {
            LOG(">>> killing unresponsive ", unresponsive.addr);
            if (unresponsive.readyState === WebSocket.OPEN) unresponsive.close(4000, "client unresponsive");
        }
        island.providers.clear();
        clearTimeout(island.serveTimeout);
        // send this client a START - there can only be one
        START();
        // if there are still clients waiting to sync, request a SERVE from this one
        if (island.syncClients.length) {
            providers.push(client);
            const list = island.syncClients.map(ea => ea.addr).join(' ');
            sendServeRequest(`started ${client.addr} syncing ${list}`);
        } else {
            delete replies[reply];
        }
    }
}

/** A new island controller is joining
 * @param {Client} client - we received from this client
 * @param {ID} id - island ID
 * @param {{name: String, version: Number}} args
 */
function JOIN1(client, id, args) {
    LOG('received', client.addr, 'JOIN', id, args);
    const {time, name, version, user} = args;
    if (user) {
        client.addr += ` [${JSON.stringify(user)}]`;
        client.user = user;
    }
    // create island data if this is the first client
    const island = ALL_ISLANDS.get(id) || {
        id,                  // the island id
        name,                // the island name (might be null)
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
    if (island.snapshotUrl) { SYNC1(island); return; }

    // if first client, start it
    if (!island.startTimeout) { START1(); return; }

    // otherwise, the first client has not started yet (not provided a snapshot via SNAP)
    console.log(`>>> client ${client.addr} waiting for snapshot`);

    function START1() {
        // find next client
        do {
            client = island.syncClients.shift();
            if (!client) return; // no client waiting
        } while (client.readyState !== WebSocket.OPEN);
        const msg = JSON.stringify({id, action: 'START'});
        client.safeSend(msg);
        LOG('sending', client.addr, msg);
        // if the client does not provide a snapshot in time, we need to start over
        island.startTimeout = setTimeout(() => {
            island.startTimeout = null;
            // kill client
            LOG(">>> killing unresponsive ", client.addr);
            if (client.readyState === WebSocket.OPEN) client.close(4000, "client unresponsive");
            // start next client
            START1();
        }, SERVE_TIMEOUT);
    }
}

function SYNC1(island) {
    const {snapshotUrl: url, messages} = island;
    const time = getTime(island);
    const response = JSON.stringify({ id: island.id, action: 'SYNC', args: {url, messages, time}});
    const range = !messages.length ? '' : ` (#${messages[0][1]}...${messages[messages.length-1][1]})`;
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
 * @param {{time: Number, url: String}} args - the time and url of the snapshot
 */
function SNAP(client, id, args) {
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    const {time, seq, hash, url} = args;
    if (time <= island.snapshotTime) return;
    LOG(`${island} got snapshot ${time}#${seq} (hash: ${hash || 'no hash'}): ${url || 'no url'}`);
    if (!url) {
        // if another client was faster, ignore
        if (time <= island.pendingSnapshotTime) return;
        island.pendingSnapshotTime = time;
        // if no url, tell that client (the fastest one) to upload it
        const serveMsg = JSON.stringify({ id, action: 'HASH', args: {...args, serve: true}});
        LOG('sending', client.addr, serveMsg);
        client.safeSend(serveMsg);
        // and tell everyone else the hash
        const others = [...island.clients].filter(each => each !== client);
        if (others.length > 0) {
            const hashMsg = JSON.stringify({ id, action: 'HASH', args: {...args, serve: false}});
            LOG('sending to', others.length, 'other clients:', hashMsg);
            others.forEach(each => each.safeSend(hashMsg));
        }
        return;
    }
    // send USERS to first client
    if (!island.snapshotUrl) userDidJoin(island, client);
    // keep snapshot
    island.snapshotTime = time;
    island.snapshotUrl = url;
    // forget older messages
    if (island.messages.length > 0) {
        const msgs = island.messages;
        const keep = msgs.findIndex(msg => after(seq, msg[1]));
        if (keep > 0) {
            LOG(`${island} forgetting messages #${msgs[0][1]>>>0} to #${msgs[keep - 1][1]>>>0} (keeping #${msgs[keep][1]>>>0})`);
            msgs.splice(0, keep);
        } if (keep === -1) {
            LOG(`${island} forgetting all messages (#${msgs[0][1]>>>0} to #${msgs[msgs.length - 1][1]>>>0})`);
            msgs.length = 0;
        }
    }
    // start waiting clients
    if (island.startTimeout) { clearTimeout(island.startTimeout); island.startTimeout = null; }
    if (island.syncClients.length > 0) SYNC1(island);
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
    const {id, clients, usersJoined, usersLeft} = island;
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
    const {id, usersJoined, usersLeft, lastMsgTime, tick, scale } = island;
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
    const {time, seq, tick, delay, scale} = args;
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    if (!island.time) {
        // only accept time, sequence, and delay if new island
        island.time = typeof time === "number" ? Math.ceil(time) : 0;
        island.seq = typeof seq === "number" ? seq : 0xFFFFFFF0;    // v0 clients expect this value
        if (delay > 0) island.delay = delay;
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

function currentSession(hash) {
    return `${hash}-${SESSIONS[hash] || 0}`;
}

function newSession(hash) {
    SESSIONS[hash] = (SESSIONS[hash] || 0) + 1;
    currentSession(hash);
}

/** client is requesting a session for an island
 * @param {Client} client - we received from this client
 * @param {ID} hash - island hash
 * @param {*} args
 */
function SESSION(client, hash, args) {
    if (!args) args = {};
    const island = ALL_ISLANDS.get(currentSession(hash));
    const id = args.new ? newSession(hash) : currentSession(hash);

    const response = JSON.stringify({ action: 'SESSION', args: {hash, id} });
    LOG(`Session ${client.addr} for ${hash} is ${id}`);
    client.safeSend(response);

    if (args.new && island) deleteIsland(island);
}

function deleteIsland(island) {
    const { id } = island;
    const msg = JSON.stringify({id, action: 'LEAVE'});
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
    client.safeSend = data => {
        if (client.readyState !== WebSocket.OPEN) return;
        STATS.BUFFER = Math.max(STATS.BUFFER, client.bufferedAmount);
        client.send(data);
        STATS.OUT += data.length;
    };
    LOG(`connection #${server.clients.size} from ${client.addr}`);
    STATS.USERS = Math.max(STATS.USERS, server.clients.size);

    client.on('pong', time => LOG('PONG from', client.addr, 'after', Date.now() - time, 'ms'));
    setTimeout(() => client.readyState === WebSocket.OPEN && client.ping(Date.now()), 100);

    client.on('message', incomingMsg => {
        STATS.IN += incomingMsg.length;
        const handleMessage = () => {
            const { id, action, args } = JSON.parse(incomingMsg);
            if (action in replies) {
                LOG('received', client.addr, 'reply', action, incomingMsg.length, 'bytes');
                replies[action](args);
            } else switch (action) {
                case 'JOIN': JOIN(client, id, args); break;
                case 'SEND': SEND(client, id, [args]); break;
                case 'TICKS': TICKS(client, id, args); break;
                case 'SNAP': SNAP(client, id, args); break;
                case 'LEAVING': LEAVING(client, id); break;
                case 'PING': PONG(client, args); break;
                case 'SESSION': SESSION(client, id, args); break;
                default: WARN("unknown action", action);
            }
        };

        if (ARTIFICAL_DELAY) {
            const timeout = ARTIFICAL_DELAY * (0.5 + Math.random());
            setTimeout(handleMessage, timeout);
        } else {
            handleMessage();
        }
    });

    client.on('close', () => {
        LOG(`closing connection from ${client.addr}`);
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
