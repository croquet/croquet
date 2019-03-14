// This is an in-browser WebSocket server which lets us reuse the reflector code
// for running without an actual server connection.
//
// It does not communicate with anything, not even other tabs/windows
// in the same browser.
//
// This file is aliased to the 'ws' module in package.json so require('ws') in
// the reflector resolves to this instead of the actual 'ws' module.


import { Socket as FakeSocket, Server as FakeServer } from "./fakeWS.js";
import { Socket as ChannelSocket, Server as ChannelServer } from "./channelWS.js";

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const channel = ChannelServer.isSupported();

export const Socket = channel ? ChannelSocket : FakeSocket;
export const Server = channel ? ChannelServer : FakeServer;
