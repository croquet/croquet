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


// We are opening a single BroadcastChannel for communication.
// Each window gets a random unique ID, stored as myPort.
// Sockets referring to other windows are stored in channelSockets.
// Their socket.remotePort is the unique ID of that window.
const NO_SERVER = -1;

let channel = new BroadcastChannel("croquet-reflector");
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
    }, 10);
}
function discovered(port) {
    clearTimeout(timeout);
    if (serverPort === NO_SERVER) serverPort = port;
    const me = serverPort === myPort ? "(me)" : "(not me)";
    console.log("Channel: discovered", serverPort, me);
    document.getElementById("error").innerText = 'Using in-browser reflector ' + me;
    while (whenDiscovered.length) whenDiscovered.shift()();
}

// This is the central message handler listening to the shared channel
channel.onmessage = ({ data: msg }) => {
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
                if (serverPort !== myPort) throw Error("Connecting to wrong server?");
                myServer._accept(new ChannelSocket({ port: msg.client }));
                channel._post("accept", { to: msg.client, server: myPort });
            }
            break;
        case "accept":
            // sent from server that accepted connection
            if (msg.to === myPort) {
                const { server } = msg;
                if (serverPort !== server) throw Error("Accept from wrong server?");
                const socket = channelSockets[server]; // we stashed it there in _connectToServer()
                socket._connectTo({remotePort: server});
                console.log('Channel: got accepted', myPort, 'by', server);
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


export class ChannelSocket extends FakeSocket {

    static isSupported() { return !!window.BroadcastChannel; }

    constructor(options = {}) {
        super({ host: 'channel', port: myPort, ...options });
    }

    send(data) {
        // if connected to this window, send directly
        if (this._otherEnd) super.send(data);
        // otherwise, send via channel
        else if (channel) channel._post("packet", { from: myPort, to: this.remotePort, data });
    }

    // Private

    _connectTo(socket) {
        // if server is in this window, connect directly
        if (this.remotePort === socket.remotePort) { super._connectTo(socket); return; }
        // otherwise, turn this local socket into a remote socket via channel
        if (this.remotePort !== myPort) throw Error("wrong direction of connecting");
        this.remotePort = socket.remotePort;
        channelSockets[this.remotePort] = this;
        console.log('Channel: registering remote socket', this.remotePort);
        this.readyState = WebSocket.OPEN;
        this._callback('open');
    }

    _connectToServer(server) {
        // kick off discovery of server
        if (serverPort !== NO_SERVER) throw Error("Channel: why is there a server?");
        discover(50, () => {
            // if we are the active server, connect directly to it
            if (serverPort === myPort) server._accept(this);
            else {
                // otherwise connect via broadcast channel
                channelSockets[serverPort] = this;
                channel._post("connect", { to: serverPort, client: myPort });
                // will be connected in "accept" handler
            }
        });
    }
}


export class ChannelServer extends FakeServer {

    constructor(options = {}) {
        options = { ...options, host: 'channel-server', port: myPort };
        super(options);
        myServer = this;
    }

    address() { return { ...super.address(), family: 'CHANNEL' }; }
}


hotreload.addDisposeHandler("broadcast-channel", () => {
    if (channel) {
        // notify everyone with a socket to this window
        channel._post("close", {port: myPort });
        channel.onmessage = () => {};
        channel = null;
    }
});
