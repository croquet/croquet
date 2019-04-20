// when running on node, 'ws' is the actual web socket module
// when running in browser, 'ws' is our own 'src/server/ws.js'
const WebSocket = require('ws');

const port = 9090;
const TICK_RATE = 1000 / 20;  // default tick rate
const ARTIFICAL_DELAY = 0;    // delay messages randomly by 50% to 150% of this
const MAX_MESSAGES = 10000;   // messages per island to retain since last snapshot
const MAX_SNAPSHOT_MS = 5000; // time in ms before a snapshot is considered too "old" to serve

function LOG(...args) {
    console.log((new Date()).toISOString(), "Reflector:", ...args);
}

const server = new WebSocket.Server({ port });
LOG(`starting ${server.constructor.name} ws://localhost:${server.address().port}/`);

const STATS = {
    RECV: 0,
    SEND: 0,
    TICK: 0,
    IN: 0,
    OUT: 0,
}
let lastStats = Date.now();

setInterval(showStats, 10000);

// if running on node, log stats to file
let appendFile = (typeof process !== 'undefined') && require("fs").appendFile;
const fileName = `${lastStats}.txt`;

function showStats() {
    const now = Date.now();
    const delta = now - lastStats;
    lastStats = now;
    let out = [];
    let sum = 0;
    for (const [key, value] of Object.entries(STATS)) {
        out.push(`${key}/s: ${(value * 1000 / delta).toFixed(0).padStart(6)}`);
        sum += value;
    }
    if (sum === 0) return;
    LOG(out.join(', '));
    if (appendFile) {
        const line = `${(new Date()).toISOString().slice(0, 19)}Z ${[ "RECV", "SEND", "TICK", "IN", "OUT" ].map(key => STATS[key]).join(' ')}\n`;
        appendFile("stats.txt", line, err => {});
    }
    for (const key of Object.keys(STATS)) STATS[key] = 0;
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
let before = Date.now();
let sequence = 0;

/** Get current time for island
 * @param {ID} id - island ID
 */
function getTime(id) {
    const now = Date.now();
    const delta = now - before;     // might be < 0 if system clock went backwards
    if (delta > 0) {
        for (const islandData of ALL_ISLANDS.values()) {
           islandData.time += Math.min(TICK_RATE, delta);       // advance clock at most by a TICK
        }
        sequence = 0;
        before = now;
    }
    return ALL_ISLANDS.get(id).time;
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
    if (typeof args === "number") args = {time: args};    // old clients send time
    LOG('received', client.addr, 'JOIN', id, args);
    const {time, name} = args;
    // create island data if this is the first client
    const island = ALL_ISLANDS.get(id) || {
        name,                // the island name (might be null)
        time,                // the current simulation time
        clients: new Set(),  // connected web sockets
        users: 0,            // number of clients already reported
        providers: new Set(),// clients that are running
        snapshot: null,      // a current snapshot or null
        messages: [],        // messages since last snapshot
        lastMessageTime: 0,  // time of last message reflected
        serveTimeout: 0,     // pending SERVE request timeout
        syncClients: [],     // clients waiting to SYNC
    };
    ALL_ISLANDS.set(id, island);

    // start broadcasting messages to client
    island.clients.add(client);

    // all other running clients can potentially provide a snapshot
    const providers = Array.from(island.providers).filter(ea => ea.readyState === WebSocket.OPEN);

    // if first client, start it
    if (!providers.length) { START(); return; }

    function START() {
        island.time = time;
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
            island.serveTimeout = setTimeout(() => sendServeRequest("SERVE timeout from " + provider.addr), 1000);
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
            if (unresponsive.readyState === WebSocket.OPEN) unresponsive.close();
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

/** reflect a message to all participants
 * after time stamping it
 * @param {ID} id - island ID
 * @param {Message} message
 */
function SEND(client, id, message) {
    STATS.RECV++;
    const island = ALL_ISLANDS.get(id);
    if (!island) { if (client.readyState === WebSocket.OPEN) client.close(5000, "unknown island"); return; };
    // message = [time, seq, payload]
    message[0] = getTime(id);
    message[1] = ++sequence;
    const msg = JSON.stringify({ id, action: 'RECV', args: message });
    // LOG('broadcasting RECV', message);
    STATS.SEND += island.clients.size;
    island.clients.forEach(each => each.safeSend(msg));
    island.messages.push(msg); // raw message sent again in SYNC
    island.lastMessageTime = message[0];
    if (island.messages.length > MAX_MESSAGES) {
        island.messages.splice(0, MAX_MESSAGES - island.messages.length);
        island.snapshot = null;
    }
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
    LOG(`${id}: ${island.users} users (total ${ALL_ISLANDS.size} islands, ${server.clients.size} users)`);
}

/** send back arguments as received */
function PONG(client, args) {
    client.safeSend(JSON.stringify({ action: 'PONG', args }));
}

/** send a TICK message to advance time
 *
 * TODO: individual tick rates for different clients/islands
 */
function TICK() {
    for (const [id, island] of ALL_ISLANDS) {
        const time = getTime(id);
        if (time - island.lastMessageTime < TICK_RATE) continue;
        const msg = JSON.stringify({ id, action: 'TICK', args: time });
        // LOG('broadcasting', msg);
        STATS.TICK += island.clients.size;
        island.clients.forEach(each => each.safeSend(msg));
        if (island.users !== island.clients.size) USERS(id);
    }
}

let TICKER = 0;

function startTicker() { if (!TICKER) TICKER = setInterval(TICK, TICK_RATE); }
function stopTicker() { clearInterval(TICKER); TICKER = 0; }

const replies = {};

server.on('connection', (client, req) => {
    client.addr = `${req.connection.remoteAddress}:${req.connection.remotePort}`;
    if (req.headers['x-forwarded-for']) client.addr += ` (${req.headers['x-forwarded-for'].split(/\s*,\s*/).join(', ')})`;
    client.safeSend = data => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
        STATS.OUT += data.length;
    }
    LOG(`connection #${server.clients.size} from ${client.addr}`);
    startTicker();

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
                case 'SEND': SEND(client, id, args); break;
                case 'PING': PONG(client, args); break;
                default: console.warn("Reflector: unknown action:", action);
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
        for (const [id, island] of ALL_ISLANDS) {
            island.clients.delete(client);
            island.providers.delete(client);
            if (island.clients.size === 0) ALL_ISLANDS.delete(id);
        }
        if (!ALL_ISLANDS.size) stopTicker();
    });
});

exports.server = server;
exports.Socket = WebSocket.Socket;
