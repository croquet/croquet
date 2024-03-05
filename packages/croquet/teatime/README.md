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

## Controller

## VM

### Time

### Models

### Future messages

#### Future Queue

### Events

View-to-Model events add messages to the future queue

### Snapshotting

## Views

### Time

### Events

### Bulk Data

## App
