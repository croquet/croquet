# Changelog

This is a private summary of changes. The public changes are in [README.md](./README.md).

# 0.3.3 prereleases

* 0.3.3-1 add message encryption
* 0.3.3-0 version bump


# 0.3.2

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

# 0.3.1

* 0.3.1-5 remove names and location from internal join/exit events
* 0.3.1-4 fix asymmetric view-join/exit events when reconnecting with same viewId
* 0.3.1-3 make PINGs adaptive to TPS, allow 0 TPS (30s per TICK)
* 0.3.1-2 fixed detection of model divergence
* 0.3.1-1 made `"view-join"` and `"view-exit"` model-only

# 0.3.0

* deprecated `startSession`, use `Session.join` instead
* `future` messages arguments are passed by identity, not copied anymore
* allow `viewOnly` sessions (removed DEMO hack)
* added `Data` API (undocumented)
* added `App.autoSession` (undocumented)
* debug badge state is stored in localStorage

# 0.2.7

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

# 0.2.6

* switch to croquet.io/reflector/v1 and croquet.io/files-v1
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

# 0.2.5

* debug badge ("widget dock")
* new `Croquet.App` API for debug UI etc.
* send session URL, code hash, and SDK version when joining

# Ancient ...

If someone feels like going through older changes, please do so.
