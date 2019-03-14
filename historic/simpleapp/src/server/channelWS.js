// This is an in-browser WebSocket server which lets us reuse the reflector code
// for running without an actual server connection.
//
// This version communicates with other browser tabs/windows using the
// BroadcastChannel API, which is only available on Chrome and Firefox
//
// This is used as in 'ws.js' if the BroadcastChannel API is available.


import hotreload from "../hotreload.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }


// discover: find active server or be active server
const NO_SERVER = 1000;

const channel = new BroadcastChannel("croquet-reflector");
const myID = Math.random();
let myServer = null;
let activeServerID = NO_SERVER;

const whenConnected = [];
const openSockets = {};

let timeout = 0;
function discover() {
    channel.postMessage({ what: "discover" });
    console.log("discover", myID);
    if (timeout) clearTimeout(timeout);
    timeout = hotreload.setTimeout(() => discovered(myID), 500);
}
function discovered(id) {
    if (timeout) { clearTimeout(timeout); timeout = 0; }
    if (activeServerID === NO_SERVER) activeServerID = id;
    console.log("Active server:", activeServerID, activeServerID === myID ? "(me)" : "(not me)");
    channel._processWaiting();
}
discover();

hotreload.addDisposeHandler("broadcast-channel", () => {
    try {
        channel.postMessage({ what: "close", id: myID });
    } catch (e) {
        // ignore
    }
});

channel.onmessage = ({ data: msg }) => {
    //console.log("RECEIVE", msg);
    switch (msg.what) {
        case "discover":
            // a new window is trying to discover a server
            if (activeServerID === myID) {
                channel.postMessage({ what: "discovered", id: myID });
            }
            break;
        case "discovered":
            // a server answered the discover request
            if (timeout) { clearTimeout(timeout); timeout = 0; }
            if (activeServerID === NO_SERVER) {
                discovered(msg.id);
            } else if (msg.id !== activeServerID) {
                throw Error("new active server");
            }
            break;
        case "close":
            // a server window was closed (not working yet?)
            console.log("channel closed", msg.id);
            for (const socket of Object.values(openSockets)) {
                if (socket._id === msg.id) {
                    socket.close();
                }
            }
            break;
        case "connect":
            // sent from client that wants to connect
            if (activeServerID === myID) {
                const {id, host, port} = msg;
                const socket = new Socket({ id, host, port });
                openSockets[id + socket._addr] = socket;
                myServer._accept(socket);
                openSockets['server:*'] = socket._otherEnd;
                channel._post("accept", { id, client: socket._addr});
                console.log('ACCEPTING', id, socket._addr);
            }
            break;
        case "accept":
            // sent from server that accepted connection
            if (msg.id === myID) {
                const { client } = msg;
                const clientSocket = openSockets[client];
                const serverSocket = new Socket({ id: activeServerID, host: 'server', port: '*' });
                serverSocket._connectTo(clientSocket);
                console.log('ACCEPTED', client, serverSocket._addr);
            }
            break;
        case "packet":
            // receive a packet if it is meant for me
            if (msg.id === myID) {
                const socket = openSockets[msg.addr];
                if (socket) socket._processIncoming(msg.data);
                else console.warn('Cannot find socket', msg.addr);
            }
            break;
        default: throw Error("Unknown: " + msg.what);
    }
};

channel.onmessageerror = err => {
    console.log("Broadcast channel error:", err);
};

channel._connectSocket = socket => {
    if (activeServerID === NO_SERVER) throw Error("no server yet");
    if (activeServerID === myID) throw Error("only for channel connections");
    channel._post("connect", {id: myID, host: socket.remoteAddress, port: socket.remotePort});
    openSockets[socket._addr] = socket;
};

channel._processWaiting = () => {
    while (whenConnected.length > 0) {
        const fn = whenConnected.shift();
        fn();
   }
};

channel._post = (what, options={}) => {
    channel.postMessage({ what, ...options });
//    console.log("EMIT", { what, ...options });
};


// now the actual classes

class CallbackHandler {
    constructor() { this._callbacks = []; }

    on(event, callback) { this._callbacks[event] = callback; }

    // Private

    _callback(event, ...args) {
        const callback = this._callbacks[event];
        if (callback) {
            if (event === 'close') callback(...args);  // needs to be sync for hot reload dispose
            else hotreload.setTimeout(() => callback(...args));
        }
    }
}


export class Socket extends CallbackHandler {
    constructor(options = {}) {
        super();
        this.readyState = WebSocket.CONNECTING;
        this.remoteAddress = options.host || (myID === activeServerID ? '::fake' : '::channel');
        this.remotePort = options.port || (Math.random() * 0x10000 | 0x8000);
        this._id = options.id || myID;
        this._addr = `${this.remoteAddress}:${this.remotePort}`;
        this._otherEnd = null;
        this._callbacks = [];
        // if we were given server, connect to it
        // otherwise this is a server-side socket
        const server = options.server;
        if (server) {
            const accept = () => {
                // if we are the active server, connect directly to it
                if (activeServerID === myID) server._accept(this);
                else {
                    // otherwise connect via broadcast channel
                    const {host, port} = server.options;
                    channel._connectSocket(this, host, port);
                }
            };
            if (activeServerID === NO_SERVER) whenConnected.push(accept);
            else hotreload.setTimeout(accept, 0);
        }
    }

    get onopen() { return this._callbacks['open']; }
    set onopen(fn) { this._callbacks['open'] = fn; }
    get onerror() { return this._callbacks['error']; }
    set onerror(fn) { this._callbacks['error'] = fn; }
    get onclose() { return this._callbacks['close']; }
    set onclose(fn) { this._callbacks['close'] = fn; }
    get onmessage() { return this._callbacks['message']; }
    set onmessage(fn) { this._callbacks['message'] = fn; }

    send(data) {
        if (this._id !== myID) debugger;
        this._otherEnd._processIncoming(data);
    }

    close() {
        if (this.readyState !== WebSocket.CLOSED) {
            this.readyState = WebSocket.CLOSED;
            if (this._otherEnd) {
                this._otherEnd.close();
                this._otherEnd = null;
            }
            this._callback('close', {});
        }
    }

    // Private

    _connectTo(socket) {
        if (this._otherEnd) return;
        this.readyState = WebSocket.OPEN;
        this._otherEnd = socket;
        this._otherEnd._connectTo(this);
        this._callback('open');
    }

    _processIncoming(data) {
        if (this._id === myID) this._callback('message', { data });
        else channel._post("packet", {id: this._id, addr: this._addr, data});
    }
}


class Client extends CallbackHandler {
    constructor(socket, options) {
        super();
        this._socket = new Socket({ host: options.host, port: options.port });
        this._socket.onopen = () => this._callback('open');
        this._socket.onclose = () => this._callback('close');
        this._socket.onerror = () => this._callback('error');
        this._socket.onmessage = ({ data }) => this._callback('message', data);
        this._socket._connectTo(socket);
    }

    send(data) {
        this._socket.send(data);
    }
}


export class Server extends CallbackHandler {

    static isSupported() { return window.BroadcastChannel; }

    constructor(options = {}) {
        super();
        this.options = { host: '::server', port: 1234, ...options };
        this.clients = new Set();
        myServer = this;
    }

    // Private

    _accept(socket) {
        const client = new Client(socket, this.options);
        this.clients.add(client);
        const request = { connection: socket };
        this._callback('connection', client, request);
    }
}
