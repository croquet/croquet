# Croquet Client Library Deployment

We use semantic versioning, see semver.org

## Pre-releases a.b.c-n

* update non-public [CHANGELOG.md](./CHANGELOG.md)
  - add a line for this pre-release
* update `version` in `package.json`
  - e.g. `a.b.c-5` becomes `a.b.c-6`
* commit these two files using that version number as the commit message
  - `[teatime] changelog and version bump to a.b.c-n`
  - the deploy script checks that the repo is clean and this is the last commit
* run `./deploy.sh` here
* `git push` to release to croquet.io/dev/lib
  - the CI server will copy that to the croquet.io bucket
* `deploy-from-dev-to-test.sh lib` and `release-from-test-to-public.sh lib`
  - to copy lib from croquet.io/dev/lib to croquet.io/test/lib and croquet.io/lib
  - build scripts (e.g. in WorldCore) use version at croquet.io/lib/croquet-latest-pre.txt

## Release a.b.c

* make sure `types.d.ts` reflects changed API (see our private [CHANGELOG.md](./CHANGELOG.md))
* make sure JSDoc comments reflect changed API (`teatime/index.js`, `teatime/src/{model|view|session}.js`)
  - test using `(cd sdk; ./deploy.sh docs)` and check generated `servers/croquet-io-dev/sdk/docs/*.html`
* deploy release
  - follow pre-release steps above but with release version number
* deploy npm
  - ... to be written ...
* publish new docs:
  - update public change log [sdk/README.md#changelog](../../../sdk/README.md#changelog)
    (select notable changes from our private [CHANGELOG.md](./CHANGELOG.md))
  - update tutorials `sdk/tutorials/*.md`
  - test using `(cd sdk; ./deploy.sh docs)` and check generated `servers/croquet-io-dev/sdk/docs/*.html`
  - deploy using `(cd sdk; ./deploy.sh docs --commit)`
