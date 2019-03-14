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

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const channel = ChannelSocket.isSupported();

export const Socket = channel ? ChannelSocket : FakeSocket;
export const Server = channel ? ChannelServer : FakeServer;
