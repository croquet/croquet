# Changelog

This is a private summary of changes. The public changes are in [README.md](./README.md).

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
