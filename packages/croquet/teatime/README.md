# Teatime

TODO: document how everything actually works

## Modularization (new: March 2024)

### Connection Method Selection

**Idea:** Do not hard-code URLs into the client.

Instead the app specifies a "method" to use (*TODO: need a better term, e.g. "network", "backend", ...*) which is just a string.

There are plugins for each named method. The default client library likely will have two plugins, maybe `"cloud"` and `"depin"`, mapping to the reflector network on GCP and the DePIN. (*TODO: find good names*)

Possibly there should be separate plugins encapsulating the synchronizer connection for sending real-time messages (formerly "reflectors"), and the persistent bulk data storage (formerly "fileservers"). This would allow to mix-and-match (like how we initially used the depin reflectors with the google fileservers).

Preferably each plugin would only hard-code one URL, the initial API entry.

That API call would return info about how to connect to a reflector, and how to upload files. The exact structure of the JSON is probably plugin-dependent, but would likely have URLs for the reflector and fileserver to use.

After wallet integration this same API call should verify the user's credentials.

### Environment

There should also be plugins providing the environment – things outside of the teatime core. E.g. the browser or node.js or Unity. Possibly these are not plugins but frameworks using the teatime core.


## Packages

We should have separate packages that together are the equivalent of the "kitchensink" `@croquet/croquet` but allow leaner usage.

The following might be overkill, I'm just trying to find a way to be able to have useful minimal systems that do not include anything unnecessary. E.g. a minimal web app could leave out option parsing, qr code, autosession/autopassword etc. It might not need to be able to connect to Google. It might not use the Data API. Etc.

* `@croquet/client` – the "kitchen-sink", combining everything, as before. TBD: should this be the same for web and node? I'm assuming Unity will not use this one but just the packages it needs.
* `@croquet/web` – the harness for the web
* `@croquet/web-app` – option parsing, qr code, autosession/autopassword
* `@croquet/node` – the harness for node
* `@croquet/node-app` – option parsing
* `@croquet/teatime` – basically, just VM and Model class. Only the bare minimum to instantiate a VM, either new or from a decrypted snapshot, ability to advance the computation to a specific teatime given a list of messages (with ability to limit the processing time), a callback function for each `publish()` operation, and to take a snapshot when asked
* `@croquet/random` – optional – if the model uses no random, we don't need this
* `@croquet/math` – optional – if you can guarantee that all users will have bit identical results, you don't need this
* `@croquet/views` – 
* `@croquet/session` – 
* `@croquet/controller` – event routing between models, views, and reflector
* `@croquet/data` – the data api
* `@croquet/plugin-trans-websocket` – the websocket message transport
* `@croquet/plugin-trans-webrtc` – the webrtc message transport
* `@croquet/plugin-auth-gcp` – authorization for GCP
* `@croquet/plugin-auth-cloudflare` – authorization for cloudflare
* `@croquet/plugin-encryption-xyz` - default encryption strategy crypto-js

