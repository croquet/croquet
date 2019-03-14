// This is an in-browser WebSocket server which lets us reuse the reflector code
// for running without an actual server connection.
//
// This version communicates with other browser tabs/windows using the
// BroadcastChannel API, which is available on Chrome and Firefox.
//
// This is used as in './ws.js' if the BroadcastChannel API is available.

import { FakeSocket, FakeServer } from "./fakeWS.js";
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
    const me = activeServerID === myID ? "(me)" : "(not me)";
    console.log("Active server:", activeServerID, me);
    document.getElementById("error").innerText = 'Using in-browser reflector ' + me;
    channel._processWaiting();
}

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
                const socket = new ChannelSocket({ id, host, port });
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
                const serverSocket = new ChannelSocket({ id: activeServerID, host: 'server', port: '*' });
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


export class ChannelSocket extends FakeSocket {

    static isSupported() { return !!window.BroadcastChannel; }

    constructor(options = {}) {
        super(options);
        this._id = options.id || myID;
        this._addr = `${this.remoteAddress}:${this.remotePort}`;
    }

    // Private

    _processIncoming(data) {
        if (this._id === myID) super._processIncoming(data);
        else channel._post("packet", {id: this._id, addr: this._addr, data});
    }

    _runServer(server) {
        const accept = () => {
            // if we are the active server, connect directly to it
            if (activeServerID === myID) server._accept(this);
            else {
                // otherwise connect via broadcast channel
                const { host, port } = server.options;
                channel._connectSocket(this, host, port);
            }
        };
        if (activeServerID === NO_SERVER) {
            // kick off discovery of server
            discover();
            whenConnected.push(accept);
        } else hotreload.setTimeout(accept, 0);
    }
}


export class ChannelServer extends FakeServer {

    constructor(options = {}) {
        super(options);
        myServer = this;
    }

    address() {
        return {
            ...super.address(),
            family: 'CHANNEL',
        };
    }
}

hotreload.addDisposeHandler("broadcast-channel", () => {
    try {
        channel.postMessage({ what: "close", id: myID });
    } catch (e) {
        // ignore
    }
});
