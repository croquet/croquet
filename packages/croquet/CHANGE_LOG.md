# Changelog

This is a private summary of changes. The released changes are in the public [README.md](../../../docs/croquet/README.md#changelog).

# latest

* 1.0.5-3 fix data API for regional buckets
* 1.0.5-2 island => vitual machine (ISLAND => CROQUETVM)
* 1.0.5-1 use dev-sign func if dev flag

# 2021-08-24: 1.0.4

* 1.0.4 stricter session parameter checks
* 1.0.3 fix latency calculation
* 1.0.2 fix session arg check
* 1.0.1 rebuild

# 2021-08-23: 1.0.0

* 1.0.0 enforce using apiKey, allow hashOverride
* 0.5.1-18 message-sending stats displayed if window.logMessageStats
* 0.5.1-17 confirm session password in SYNC
* 0.5.1-16 add eventRateLimit session option
* 0.5.1-15 use event bundling to raise allowable send rate
* 0.5.1-14 add per-client rate limit on sends via reflector
* 0.5.1-13 fix failure to transfer persistentId to session; allow string handlers in view subscribe
* 0.5.1-12 replace tuttiSeq for identifying votes; cache code hash; various renames in Controller
* 0.5.1-11 use files.croquet.org for downloads, and uploads if apiKey provided
* 0.5.1-10 fix deadlock in failed seamless rejoin
* 0.5.1-9 warn about Date usage in model code
* 0.5.1-8 more rationalisation of session stepping
* 0.5.1-7 add cloudflare reflector url option `reflector=cf` or `reflector=FRA`
* 0.5.1-6 improve dormancy logic for out-of-sight apps
* 0.5.1-5 use TICK to help check for dormancy in backgrounded tabs
* 0.5.1-4 wait longer before deciding a socket is unresponsive
* 0.5.1-3 workaround for unresponsive sockets sometimes seen if load balancer had to retry
* 0.5.1-2 simplify controller synchronisation states
* 0.5.1-1 distinguish consensus and dissidence in persistence uploads
* 0.5.1-0 persistSession always increments tutti seq

# 2021-05-18: 0.5.0

* 0.4.1-33 fix App.root, fix badge&spinner positioning, autoPassword keyless option, prerelease on croquet hosts only
* 0.4.1-32 adapt synced event threshold to low TPS
* 0.4.1-31 bug fix for view.future
* 0.4.1-30 allow construction of views any time, enforce passing model to view constructor, view.future sets proper realm
* 0.4.1-29 add static wellKnownModel()
* 0.4.1-28 default rejoinLimit of 1000 ms
* 0.4.1-27 fix join/exit when rejoining
* 0.4.1-26 fix external message order when reconnecting
* 0.4.1-25 fire synced event when disconnected
* 0.4.1-24 add rejoinLimit session parameter
* 0.4.1-23 preserve undefined values when serializing
* 0.4.1-22 seamless rejoin
* 0.4.1-21 make Data handles url-safe
* 0.4.1-20 add Model.viewCount, delay view construction until view-join
* 0.4.1-19 add session accessor to View
* 0.4.1-18 optimize hashing of user types
* 0.4.1-17 optimize serialization of user types
* 0.4.1-16 handle serialization of objects with non-function constructors
* 0.4.1-15 no style injection unless enabled
* 0.4.1-14 ensure viewIdDebugSuffix is alphanum or underscore
* 0.4.1-13 encode viewIdDebugSuffix if not alphanum ASCII
* 0.4.1-12 treat /dev/ as equivalent to localhost
* 0.4.1-11 expose persistentId and versionId, fix firefox hashing
* 0.4.1-10 messenger fix
* 0.4.1-9 allow heraldUrl to be 256 chars
* 0.4.1-8 add heraldUrl
* 0.4.1-7 catch errors during snapshot
* 0.4.1-6 async autoSession and autoPassword
* 0.4.1-5 catch errors in view subscription handlers
* 0.4.1-4 hide QR code in Q
* 0.4.1-3 show only QR code unless debug enabled
* 0.4.1-2 add optional "keep" arg to Data.store()
* 0.4.1-1 fix ts types

# 2020-11-20: 0.4.0

* 0.4.0-40 warn if no appId, undefined tps uses default
* 0.4.0-39 rename release
* 0.3.4-38 use named args in Session.join()
* 0.3.4-37 warn about missing session password
* 0.3.4-36 make modelRoot well-known before init again
* 0.3.4-35 allow passing persistent data to Model.create()
* 0.3.4-34 allow non-function in persistSession()
* 0.3.4-33 add autoPassword()
* 0.3.4-32 allow persistSession() during init()
* 0.3.4-31 ignore persistSession() if unchanged
* 0.3.4-30 provide Data.hash() API
* 0.3.4-29 binary encryption for Snapshot and Data
* 0.3.4-28 fix Base64 encoding of large buffers
* 0.3.4-27 snapshot all kinds of TypedArray, ArrayBuffer as Base64
* 0.3.4-26 separate data directories per app
* 0.3.4-25 fix persistentId (should not depend on tps)
* 0.3.4-24 add persistSession()
* 0.3.4-23 add extrapolatedNow(), add appId
* 0.3.4-22 fix build
* 0.3.4-21 include both commonjs and ready-to-use versions in npm
* 0.3.4-20 allow reflector:region session option
* 0.3.4-19 allow reflector=region url option
* 0.3.4-18 fix build, include sourcemaps
* 0.3.4-17 encrypt snapshots and data (still uses base64)
* 0.3.4-16 ignore join/exit of same view in one event, rename .users to .views
* 0.3.4-15 fix a potential exit mismatch, send view-exit-mismatch to reflector LOG
* 0.3.4-14 gzip and upload snapshots in web worker
* 0.3.4-13 remove simpleapp stuff, switch from parcel to rollup
* 0.3.4-12 early error for unregistered model subclasses, _ in viewIdDebugSuffix
* 0.3.4-11 removed all parcel magic
* 0.3.4-10 add model.getModel(id)
* 0.3.4-9 require classId argument for Model.register()
* 0.3.4-8 add controller.sendLog() for logging to reflector
* 0.3.4-7 reduce message size
* 0.3.4-6 add viewIdDebugSuffix session option
* 0.3.4-5 add Data.toId(handle) and Data.fromId(id)
* 0.3.4-4 fix snapshot stats
* 0.3.4-3 fix race in session join
* 0.3.4-2 remove warning when deserializing NegZero
* 0.3.4-1 re-enable crypto
* 0.3.4-0 version bump

# 2020-09-03: 0.3.3

* 0.3.3-8 fix session.leave() return value
* 0.3.3-7 temporarily back out crypto to reduce bundle size
* 0.3.3-6 rename to pub/croquet-croquet.js
* 0.3.3-5 types() for mixins, rebuilt @croquet/math
* 0.3.3-4 expander support
* 0.3.3-3 report divergent snapshots to reflector
* 0.3.3-2 do not force dev reflectors anymore
* 0.3.3-1 add message encryption
* 0.3.3-0 version bump

# 2020-08-23: 0.3.2

* 0.3.2-13 hash methods of classes transpiled to functions
* 0.3.2-12 show INFO messages from reflector, handle SERV snapshot request
* 0.3.2-11 start session without snapshot, use dev reflectors if pre-release
* 0.3.2-10 Messenger: add start/stopPublishingPointerMove API
* 0.3.2-9 distinguish between 0 and -0 in serialization, update dependencies
* 0.3.2-8 autoSession() defaults to ?q=fragment, accepts #fragment from old URLs
* 0.3.2-7 optimize stats graph display
* 0.3.2-6 add messenger for inter-frame communication
* 0.3.2-5 better base36 ids, autoSession keyless ?fragment, toasts on right, session badge fixedSize or alwaysPinned
* 0.3.2-4 sanitize referrer, autoSession("key")
* 0.3.2-3 fix dormancy detection, stop timers when leaving session
* 0.3.2-2 fix modelOnly(), add Session.thisSession()
* 0.3.2-1 detect dormancy in iFrames
* 0.3.2-0 accept `autoSleep: seconds` argument

# 2020-06-08: 0.3.1

* 0.3.1-5 remove names and location from internal join/exit events
* 0.3.1-4 fix asymmetric view-join/exit events when reconnecting with same viewId
* 0.3.1-3 make PINGs adaptive to TPS, allow 0 TPS (30s per TICK)
* 0.3.1-2 fixed detection of model divergence
* 0.3.1-1 made `"view-join"` and `"view-exit"` model-only

# 2020-05-18: 0.3.0

* deprecated `startSession`, use `Session.join` instead
* `future` messages arguments are passed by identity, not copied anymore
* allow `viewOnly` sessions (removed DEMO hack)
* added `Data` API (undocumented)
* added `App.autoSession` (undocumented)
* debug badge state is stored in localStorage

# 2020-03-24: 0.2.7

* added `options` for model root to Session.join (documented)
* added `latency` and `latencies` accessors to session (undocumented)
* messages are simulated before view is created
* added `hashing` debug option
* fixed view.update() and immediate view handlers to run in view realm
* fixed queued events to be handled after oncePerFrame events
* fixed passing models as event data when reflected
* fixed a bug with multiple event handlers per topic
* fixed reading NaNs in snapshot
* fixed npm not having proper hash by including version name in code hash
* warnings and errors are logged to console
* warn about missing crypto.subtle.digest (insecure origin)
* made our CSS overridable
* added "once" option to log warnings only once per session
* recycle message encoder instead of allocating for every send
* do not use session name in snapshot name
* controller accepts `args.time` for TICKs
* sending latency of each previous message to reflector
* reflector: new START logic
* reflector: consistent session ids / connection ids in log entries
* reflector: collect connection stats

# 2019-12-16: 0.2.6

* switch to croquet.io/reflector/v1 and croquet.io/files/v1
* fixes to work on Microsoft Edge
* add `dev` url option to use croquet.io/reflector-dev/dev
* `"synced"` event delayed by 200 ms
* startup delayed until snapshot uploaded
* fixed snapshot voting
* detect upload failure
* simplified message latency statistics
* fixed message replay after SYNC
* add support for message filtering in reflector `sendTagged()`
* fix simulation non-determinism (no more external messages in future queue)
* debug url options accept singular or plural, like `debug=snapshot/s`

# 2019-10-18: 0.2.5

* debug badge ("widget dock")
* new `Croquet.App` API for debug UI etc.
* send session URL, code hash, and Croquet version when joining

# Ancient ...

If someone feels like going through these changes, please do so.

* 2019-09-30: 0.2.4
* 2019-09-23: 0.2.3
* 2019-09-20: 0.2.2
* 2019-09-13: 0.2.1
* 2019-09-06: 0.2.0
* 2019-08-14: 0.1.9 controller sends PULSE
* 2019-07-24: 0.1.7
* 2019-07-18: 0.1.6
* 2019-07-10: 0.1.5
* 2019-07-09: 0.1.4
* 2019-07-01: 0.1.3
* 2019-06-29: 0.1.2
* 2019-06-28: 0.1.1
* 2019-06-26: 0.1.0
* 2019-06-25: 0.0.10
* 2019-06-24: 0.0.9
* 2019-06-24: 0.0.8
* 2019-06-24: 0.0.7
* 2019-06-23: 0.0.6
* 2019-06-22: 0.0.5
* 2019-06-18: 0.0.4
* 2019-06-18: 0.0.3
* 2019-06-12: 0.0.3
* 2019-06-10: 0.0.2
* 2019-06-09: 0.0.1
* 2019-04-10: split teatime from croquet-kit
* 2019-03-07: + Controller = First working version of Teatime
* 2019-03-06: + Reflector
* 2019-03-01: + Future Messages
* 2019-02-22: + Serialization
* 2019-02-16: Model + View + VirtualMachine
