// This is an in-browser WebSocket server which lets us reuse the reflector code
// for running without an actual server connection.
//
// This version does not communicate with anything, not even other tabs/windows
// in the same browser.
//
// This is used as fallback in 'ws.js' if no other option is available.

import hotreload from "../hotreload.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }


class CallbackHandler {
    constructor() { this._callbacks = [];  }

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
        this.remoteAddress = options.host || '::fake';
        this.remotePort = options.port || (Math.random() * 0x10000 | 0x8000);
        this._otherEnd = null;
        this._callbacks = [];
        // if we were given server, connect to it
        // otherwise this is a server-side socket
        if (options.server) hotreload.setTimeout(() => options.server._accept(this), 0);
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
        this._otherEnd = socket;
        this.readyState = WebSocket.OPEN;
        this._callback('open');
    }

    _processIncoming(data) {
        this._callback('message', { data });
    }
}


class Client extends CallbackHandler {
    constructor(socket, options) {
        super();
        this._socket = new Socket({ host: options.host, port: options.port});
        this._socket.onopen = () => this._callback('open');
        this._socket.onclose = () => this._callback('close');
        this._socket.onerror = () => this._callback('error');
        this._socket.onmessage = ({data}) => this._callback('message', data);
        this._socket._connectTo(socket);
        socket._connectTo(this._socket);
    }

    send(data) {
        this._socket.send(data);
    }
}


export class Server extends CallbackHandler {

    constructor(options = {}) {
        super();
        this.options = {host: '::server', port: 1234, ...options};
        this.clients = new Set();
    }

    // Private

    _accept(socket) {
        const client = new Client(socket, this.options);
        this.clients.add(client);
        const request = { connection: socket };
        this._callback('connection', client, request);
    }
}
