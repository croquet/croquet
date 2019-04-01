// This is an in-browser WebSocket server which lets us reuse the reflector code
// for running without an actual server connection.
//
// It does not communicate with anything, not even other tabs/windows
// in the same browser.
//
// This file is aliased to the 'ws' module in package.json so require('ws') in
// the reflector resolves to this instead of the actual 'ws' module.


import { FakeSocket, FakeServer } from "./fakeWS.js";
import { ChannelSocket, ChannelServer } from "./channelWS.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const channel = ChannelSocket.isSupported();

export const Socket = channel ? ChannelSocket : FakeSocket;
export const Server = channel ? ChannelServer : FakeServer;
