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

function LOG(...args) {
    console.log((new Date()).toISOString(), "Reflector:", ...args);
}

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
        island.time += island.scale * Math.min(island.tick, delta); // advance clock at most by a TICK
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
    if (!args.version) args.version = 0;                  // old clients send no version
    if (args.version >= 1) { JOIN1(client, id, args); return; }
    LOG('received', client.addr, 'JOIN', id, args);
    const {time, name, user} = args;
    if (user) client.addr += ` [${user}]`;
    // create island data if this is the first client
    const island = ALL_ISLANDS.get(id) || {
        id,                  // the island id
        name,                // the island name (might be null)
        time,                // the current simulation time
        sequence: 0xFFFFFFF0,// sequence number for messages with same time
        scale: 1,            // ratio of island time to wallclock time
        tick: TICK_MS,       // default tick rate
        delay: 0,            // hold messages until this many ms after last tick
        clients: new Set(),  // connected web sockets
        users: 0,            // number of clients already reported
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
            island.time = time;
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
                if (firstMessage) syncClient.safeSend(firstMessage);
            } else {
                LOG('cannot send SYNC to', syncClient.addr);
            }
        }
        // synced all that were waiting
        syncClients.length = 0;
        // force reporting on next TICK even if same number joins and leaves
        island.users = 0;
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
    if (user) client.addr += ` [${user}]`;
    // create island data if this is the first client
    const island = ALL_ISLANDS.get(id) || {
        id,                  // the island id
        name,                // the island name (might be null)
        version,             // the client version
        time,                // the current simulation time
        sequence: 0xFFFFFFF0,// sequence number for messages with same time
        scale: 1,            // ratio of island time to wallclock time
        tick: TICK_MS,       // default tick rate
        delay: 0,            // hold messages until this many ms after last tick
        clients: new Set(),  // connected web sockets
        users: 0,            // number of clients already reported
        snapshotTime: -1,    // time of last snapshot
        snapshotUrl: '',     // url of last snapshot
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

    // if first client, start it
    if (!island.startTimeout) { START1(); return; }

    function START1() {
        const msg = JSON.stringify({id, action: 'START'});
        client.safeSend(msg);
        LOG('sending', client.addr, msg);
        // if the client does not provide a snapshot in time, we need to start over
        island.startTimeout = setTimeout(() => {
            island.startTimeout = null;
            // kill client
            LOG(">>> killing unresponsive ", client.addr);
            if (client.readyState === WebSocket.OPEN) client.close(4000, "client unresponsive");
            // find a listening client
            do {
                client = island.syncClients.shift();
                if (!client) return; // no client waiting
            } while (client.readyState !== WebSocket.OPEN);
            // start it
            START1();
        }, SERVE_TIMEOUT);
    }

    // otherwise, we need to SYNC
    island.syncClients.push(client);

    // if we have a current snapshot, reply with that
    if (island.snapshotUrl) { SYNC1(island); return; }

    // if we get here, the first client has not started yet (not provided a snapshot via SNAP)
    console.log(`>>> client ${client} waiting for snapshot`);
}

function SYNC1(island) {
    const {snapshotUrl, messages} = island;
    const response = JSON.stringify({ id: island.id, action: 'SYNC', args: {snapshotUrl, messages}});
    for (const syncClient of island.syncClients) {
        if (syncClient.readyState === WebSocket.OPEN) {
            syncClient.safeSend(response);
            LOG(`sending ${syncClient.addr} SYNC ${response.length} bytes, ${messages.length} messages, snapshot: ${snapshotUrl}`);
        } else {
            LOG('cannot send SYNC to', syncClient.addr);
        }
    }
    // synced all that were waiting
    island.syncClients.length = 0;
    // force reporting on next TICK even if same number joins and leaves
    island.users = 0;
}


/** client uploaded a snapshot
 * @param {Client} client - we received from this client
 * @param {ID} id - island ID
 * @param {{time: Number, url: String}} args - the time and url of the snapshot
 */
function SNAP(client, id, args) {
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    const {time, url} = args;
    if (time < island.snapshotTime) return;
    // keep snapshot
    island.snapshotTime = time;
    island.snapshotUrl = url;
    // forget older messages
    const keepIndex = island.messages.findIndex(msg => msg[0] > time);
    island.messages.splice(0, keepIndex);
    // start waiting clients
    if (island.startTimeout) { clearTimeout(island.startTimeout); island.startTimeout = null; }
    if (island.syncClients.size > 0) SYNC1(island);
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
        message[1] = island.sequence = (island.sequence + 1) & 0xFFFFFFFF;
        const msg = JSON.stringify({ id, action: 'RECV', args: message });
        //LOG("broadcasting RECV", message);
        STATS.RECV++;
        STATS.SEND += island.clients.size;
        island.clients.forEach(each => each.safeSend(msg));
        island.messages.push(msg); // raw message sent again in SYNC
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

/** broadcast the number of users to other clients of an island when a client joins or leaves
 * @param {ID} id - island ID
*/
function USERS(id) {
    const island = ALL_ISLANDS.get(id);
    const clients = island.clients;
    island.users = clients.size;
    const msg = JSON.stringify({ id, action: 'USERS', args: island.users });
    clients.forEach(each => each.safeSend(msg));
    LOG(`${island}: ${island.users} users (total ${ALL_ISLANDS.size} islands, ${server.clients.size} users)`);
}

/** send back arguments as received */
function PONG(client, args) {
    client.safeSend(JSON.stringify({ action: 'PONG', args }));
}

/** send a TICK message to advance time
 * @param {IslandData} island
 */
function TICK(island) {
    const {id, users, clients, lastMsgTime, tick, scale} = island;
    if (users !== clients.size) USERS(id);
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
    const {time, tick, delay, scale} = args;
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(4000, "unknown island"); return; }
    if (!island.time) {
        // only accept time and delay if new island
        island.time = typeof time === "number" ? time : 0;
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
                case 'PING': PONG(client, args); break;
                case 'SESSION': SESSION(client, id, args); break;
                default: console.warn("Reflector: unknown action", action);
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
            island.clients.delete(client);
            if (island.providers) island.providers.delete(client);  // only in v0
            if (island.clients.size === 0) deleteIsland(island);
        }
    });
});

exports.server = server;
exports.Socket = WebSocket.Socket;
