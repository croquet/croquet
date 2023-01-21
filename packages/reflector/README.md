

# Reflector

See [../../docker/reflectors/README.md](../../docker/reflectors/README.md) for more info on how the reflectors fit into the broader architecture.

## Running locally

First install dependencies:

```
npm ci
```

To run the reflector locally:

```
node reflector.js --standalone --storage=none | node node_modules/pino-pretty/bin.js -Sctlm message
```

This will open a web socket server on `ws://localhost:9090/`. To route a client application to your locally running reflector, modify the client's url in the browser to point to the local web socket server. For example, we can take this example application called "2d" at the following url https://croquet.io/2d/index.html, and change it to the url https://croquet.io/2d/index.html?&debug=session,snapshots&reflector=ws://localhost:9090.

## Running via https

You can use the built-in https server using the `--https` command line flag.
However, you need to [create a key and certificate](https://nodejs.org/en/knowledge/HTTP/servers/how-to-create-a-HTTPS-server/) first:

```
openssl genrsa -out reflector-key.pem
openssl req -new -key reflector-key.pem -out csr.pem
openssl x509 -req -days 9999 -in csr.pem -signkey reflector-key.pem -out reflector-cert.pem
rm csr.pem
```
After you have the `reflector-key.pem` and `reflector-cert.pem` files in the reflector directory, run it:
```
node reflector.js --https --standalone --storage=none | node node_modules/pino-pretty/bin.js -Sctlm message
```


## Running Tests

To run tests locally, execute:

```
npm test
```

## Deploying the reflector to a test environment

TODO

## Deploying to production

TODO

## Logging

[reflector.js](./reflector.js) contains multiple logging functions (LOG, NOTICE, WARN, ERROR, DEBUG, etc.), use the corresponding function depending on the severity level. See Google Cloud docs on [LogSeverity](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity) for more.

Many of the logs are useful for troubleshooting. Some logs, however, are aggregated and used for billing data as well as feeding developer dashboards.

Here are some of the key pieces we log (data types are strings unless noted otherwise):

* sessionId
  * identifies the given Croquet session
* connection
  * client ip address and port number
* stats
  * the stats object contains the following 4 properties
    * bi - bytes in (number)
    * bo - bytes out (number)
    * mi - messages in (number)
    * mo - messages out (number)
* developerId
  * identifies the developer of the app
* userIp
  * ip address of the user of the current connection
* dispatcher
  * the dispatcher that forwarded the connection to the reflector
* appId
  * identifies the client application
* persistentId
  * identifies the persisted session
* apiKey
  * the API key of the developer of the client application


### The NOTICE function

Logs that designate a significant event (often associated with log queries), should use the NOTICE function. The NOTICE function requires both a "scope" and an "event" to be passed in. At this time, "scope" could be one of "process", "session", or "connection" to indicate that the event relates to either the reflector process itself, a session, or a connection. The "event" can be anything, but common ones are "start" and "end".

```javascript
// we might want to indicate that a session has started:
NOTICE("session", "start");

// similar to the other log functions, we can also pass a metadata object and a message
NOTICE("session", "start", {sessionId: id}, "receiving JOIN");
```


## Other stuff

### Difference between islands and sessions

As it relates to logging, both island and session ids are logged as "sessionId". However there are situations where the difference between an "island" and a "session" may matter.

* ALL_ISLANDS represents sessions with connected clients.
* ALL_SESSIONS represents all sessions, superset of ALL_ISLANDS

### Problems on M1 Macbook

    > node reflector.js
    dyld[17909]: missing symbol called
    [1]    17909 abort      node reflector.js

One of the dependencies (fast-crc32c) has a bug due to an upstream dependency not working on the new M1 chip architecture. To work around the issue, uninstall the fast-crc32c module by running `npm uninstall fast-crc32c`. However, do not commit that change, as the dependency is used in the production environment.

Another fix is to go into the node_modules directory and modify the fast-crc32c code (`node_modules/fast-crc32c/loader.js`) by commenting out the sse4_crc32c implementation from the array of implementations. It should look like this:

```javascript
  const impls = [
    // './impls/sse4_crc32c',
    './impls/js_crc32c',
  ];
```
