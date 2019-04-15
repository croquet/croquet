// This is an in-browser WebSocket server which lets us reuse the reflector code
// for running without an actual server connection.
//
// It communicates with other browser tabs/windows using the
// BroadcastChannel API, which is available natively on Chrome and Firefox,
// and emulated via IndexedDB on Safari (using the "broadcast-channel" package).
//
// This file is aliased to the 'ws' module in package.json so require('ws') in
// the reflector resolves to this instead of the actual 'ws' module.


import BroadcastChannel from "broadcast-channel";
import hotreload from "util/hotreload";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


// We are opening a single BroadcastChannel for communication.
// Each window gets a random unique ID, stored as myPort.
// Sockets referring to other windows are stored in channelSockets.
// Their socket.remotePort is the unique ID of that window.
const NO_SERVER = -1;

let channel = new BroadcastChannel("croquet-reflector", { webWorkerSupport: false });
const myPort = Math.floor(Math.random() * 10e15);
let serverPort = NO_SERVER;
const channelSockets = {};  // all the sockets connected via channel, indexed by remote port

// This is my Server instance. It is only used if I am the
// active, that is, myPort === serverPort
let myServer = null;

// This is how we discover the serverPort on startup
const whenDiscovered = [];
let timeout = 0;
function discover(ms, callback) {
    if (callback) whenDiscovered.push(callback);
    channel._post("discover", {from: myPort});
    if (timeout) clearTimeout(timeout);
    timeout = hotreload.setTimeout(() => {
        if (ms < 500) discover(ms * 1.5);
        else {
            console.log("Channel: TIMEOUT for discover");
            discovered(myPort);
        }
    }, ms);
}
function discovered(port) {
    clearTimeout(timeout);
    if (serverPort === NO_SERVER) serverPort = port;
    const me = serverPort === myPort ? "(me)" : "(not me)";
    console.log("Channel: discovered", serverPort, me);
    document.getElementById("error").innerText = 'Using in-browser reflector ' + me;
    while (whenDiscovered.length) whenDiscovered.shift()(serverPort);
}

// This is the central message handler listening to the shared channel
channel.onmessage = msg => {
    if (msg.what !== "packet") console.log("Channel: RECEIVE", msg.what, JSON.stringify(msg, (k, v) => k === "what" ? undefined : v));
    switch (msg.what) {
        case "discover":
            // a new window is trying to discover a server
            if (serverPort === myPort) {
                // if we are the server, reply with our port
                channel._post("discovered", {to: msg.from, server: myPort });
            }
            break;
        case "discovered":
            // a server answered our discover request
            if (msg.to === myPort) {
                discovered(msg.server);
            }
            break;
        case "connect":
            // sent from client that wants to connect
            if (msg.to === myPort) {
                myServer._accept(new Socket({ port: msg.client }));
                channel._post("accept", { to: msg.client, server: myPort });
            }
            break;
        case "accept":
            // sent from server that accepted connection
            if (msg.to === myPort) {
                const { server } = msg;
                const socket = channelSockets[server]; // we stashed it there in _connectToServer()
                socket._connectTo({remotePort: server});
                console.log('Channel:', myPort, 'got accepted by', server);
            }
            break;
        case "packet":
            // receive a packet if it is meant for me
            if (msg.to === myPort) {
                const socket = channelSockets[msg.from];
                if (socket) socket._processIncoming(msg.data);
                else console.warn('Channel: cannot find socket', msg.from);
            }
            break;
        case "ping":
            // receive a ping if it is meant for me
            if (msg.to === myPort) {
                const socket = channelSockets[msg.from];
                if (socket) socket._processPing(msg.data);
                else console.warn('Channel: cannot find socket', msg.from);
            }
            break;
        case "pong":
            // receive a pong if it is meant for me
            if (msg.to === myPort) {
                const socket = channelSockets[msg.from];
                if (socket) socket._processPong(msg.data);
                else console.warn('Channel: cannot find socket', msg.from);
            }
            break;
        case "close":
            // a window was closed
            for (const socket of Object.values(channelSockets)) {
                if (socket.remotePort === msg.port) {
                    if (socket.readyState !== WebSocket.CLOSED) {
                        console.log("Channel: closing socket", socket.remotePort);
                        socket.close();
                        delete channelSockets[socket.remotePort];
                    }
                }
            }
            break;
        default: throw Error("Unknown: " + msg.what);
    }
};

channel.onmessageerror = err => {
    console.log("Channel: broadcast error", err);
};

channel._post = (what, args={}) => {
    if (what !== "packet") console.log("Channel: SENDING", what, JSON.stringify(args));
    channel.postMessage({ what, ...args });
};


class CallbackHandler {
    constructor() { this._callbacks = [];  }

    on(event, callback) { this._callbacks[event] = callback; }

    // Private

    _callback(event, ...args) {
        const callback = this._callbacks[event];
        if (callback) {
            if (event === 'close') callback(...args);  // needs to be sync for hot reload dispose
            else hotreload.promiseResolveThen(() => callback(...args));    // async but in order
        }
    }
}


export class Socket extends CallbackHandler {

    constructor(options = {}) {
        super();
        this.readyState = WebSocket.CONNECTING;
        this.remoteAddress = options.host || 'channel';
        this.remotePort = options.port || myPort;
        /** @type {Socket} if connecting directly to myServer, the server's socket */
        this._otherEnd = null;
        // if we were given a server, connect to it
        if (options.server) {
            this.url = options.server;
            this._connectToServerUrl(options.server);
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
        // if connected to this window, send directly
        if (this._otherEnd) this._otherEnd._processIncoming(data);
        // otherwise, send via channel
        else if (channel) channel._post("packet", { from: myPort, to: this.remotePort, data });
    }

    _ping(data) {
        // if connected to this window, send directly
        if (this._otherEnd) this._otherEnd._processPing(data);
        // otherwise, send via channel
        else if (channel) channel._post("ping", { from: myPort, to: this.remotePort, data });
    }

    close(code, reason) {
        if (this.readyState !== WebSocket.CLOSED) {
            this.readyState = WebSocket.CLOSED;
            if (this._otherEnd) {
                this._otherEnd.close(code, reason);
                this._otherEnd = null;
            }
            this._callback('close', {code, reason});
        }
    }

    // Private

    _connectTo(socket) {
        // if server is in this window, connect directly
        if (this.remotePort === socket.remotePort) this._connectDirectlyTo(socket);
        // otherwise, turn this local socket into a remote socket via channel
        else this._connectViaChannelTo(socket);
    }

    _connectDirectlyTo(socket) {
        if (this._otherEnd) return;
        this.readyState = WebSocket.OPEN;
        this._otherEnd = socket;
        this._otherEnd._connectDirectlyTo(this);
        this._callback('open');
    }

    _connectViaChannelTo(socket) {
        if (this.remotePort !== myPort) throw Error("wrong direction of connecting");
        this.remotePort = socket.remotePort;
        this.url = `channel://server:${this.remotePort}`;
        channelSockets[this.remotePort] = this;
        console.log('Channel: registering remote socket', this.remotePort);
        this.readyState = WebSocket.OPEN;
        this._callback('open');
    }

    // some data for this socket arrived
    _processIncoming(data) {
        this._callback('message', { data });
    }

    // we got a ping, send back pong
    _processPing(data) {
        // if connected to this window, send directly
        if (this._otherEnd) this._otherEnd._processPong(data);
        // otherwise, send via channel
        else if (channel) channel._post("pong", { from: myPort, to: this.remotePort, data });
    }

    // got a pong
    _processPong(data) {
        this._callback('pong', data);
    }

    _connectToServerUrl(serverUrl) {
        const port = Number.parseInt(serverUrl.match(/:([0-9]+)/)[1], 10);
        if (port) { this._connectToServerPort(port); return; }
        // kick off discovery of server
        if (serverPort !== NO_SERVER) throw Error("Channel: why is there a server?");
        discover(50, discoveredPort => {
            this._connectToServerPort(discoveredPort);
        });
    }

    _connectToServerPort(port) {
        // if we are the active server, connect directly to it
        if (port === myPort) myServer._accept(this);
        else {
            // otherwise connect via broadcast channel
            channelSockets[port] = this;
            channel._post("connect", { to: port, client: myPort });
            // will be connected in "accept" handler
        }
    }
}


class Client extends CallbackHandler {
    constructor(socket, options, server) {
        super();
        this._socket = new Socket({ host: options.host, port: options.port});
        this._socket.onopen = (...args) => this._callback('open', ...args);
        this._socket.onclose = (...args) => {server.clients.delete(this); this._callback('close', ...args); };
        this._socket.onerror = (...args) => this._callback('error', ...args);
        this._socket.onmessage = ({data}) => this._callback('message', data);
        this._socket._callbacks['pong'] = arg => this._callback('pong', arg);
        this._socket._connectTo(socket);
    }

    send(data) {
        this._socket.send(data);
    }

    ping(data) {
        this._socket._ping(data);
    }
}


export class Server extends CallbackHandler {

    constructor(options = {}) {
        super();
        this.options = { ...options, host: 'server', port: myPort };
        this.clients = new Set();
        myServer = this;
    }

    address() {
        return {
            address: this.options.host,
            port: this.options.port,
            family: 'CHANNEL',
        };
    }

    // Private

    _accept(socket) {
        socket.url = this._url;
        const client = new Client(socket, this.options, this);
        this.clients.add(client);
        const request = { connection: socket };
        this._callback('connection', client, request);
    }

    get _url() {
        const {address, port, family} = this.address();
        return `${family.toLowerCase()}://${address}:${port}/`;
    }
}


hotreload.addDisposeHandler("broadcast-channel", () => {
    if (channel) {
        // notify everyone with a socket to this window
        channel._post("close", {port: myPort });
        channel.onmessage = () => {};
        channel = null;
    }
});
