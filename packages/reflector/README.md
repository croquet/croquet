

# Reflector

See [../../docker/reflectors/README.md](../../docker/reflectors/README.md) for more info on how the reflectors fit into the broader architecture.

## Running locally

First install dependencies:

```
$ npm i
```

To run the reflector locally:

```
$ node reflector.js --standalone
```

This will open a web socket server on `ws://localhost:9090/`. To route a client application to your locally running reflector, modify the client's url in the browser to point to the local web socket server. For example, we can take this example application called "2d" at the following url https://croquet.io/2d/index.html, and change it to the url https://croquet.io/2d/index.html?&debug=session,snapshots&reflector=ws://localhost:9090.


## Deploying the reflector to a test environment

TODO

## Deploying to production

TODO

## Logging

[reflector.js](./reflector.js) contains multiple logging functions (LOG, WARN, ERROR, DEBUG, etc.), use the corresponding function depending on the severity level. See Google Cloud docs on [LogSeverity](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity) for more.

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

## Other stuff

### Difference between islands and sessions

As it relates to logging, both island and session ids are logged as "sessionId". However there are situations where the difference between an "island" and a "session" may matter.

* ALL_ISLANDS represents sessions with connected clients.
* ALL_SESSIONS represents all sessions, superset of ALL_ISLANDS

### Problems on M1 Macbook

One of the dependencies (fast-crc32c) has a bug due to an upstream dependency not working on the new M1 chip architecture. To fix the issue, you can simply uninstall the fast-crc32c module by running `npm uninstall fast-crc32c`. However, do not commit that change, as the dependency is used in the production environment. 

Another fix is to go into the node_modules directory and modify the fast-crc32c code (`node_modules/fast-crc32c/loader.js`) by commenting out the sse4_crc32c implementation from the array of implementations. It should look like this:

```javascript
  const impls = [
    // './impls/sse4_crc32c',
    './impls/js_crc32c',
  ];
```