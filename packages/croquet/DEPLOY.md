# Croquet Client Library Deployment

We use semantic versioning, see semver.org

## Pre-releases a.b.c-n

* update [CHANGE_LOG.md](./CHANGE_LOG.md)
  - add a line for this pre-release
* update `version` in `package.json`
  - e.g. `a.b.c-5` becomes `a.b.c-6`
* commit these two files using that version number as the commit message
  - `[teatime] changelog and version bump to a.b.c-n`
  - the deploy script checks that the repo is clean and this is the last commit
* run `./build.sh` here, it will show the `npm publish` command
* run a smoke test:
  - in this directory, run `npm link`
  - go to `apps/hello/`, open `index.html`, check it's running and logs the right version number. Note the auto-generated session name and password
  - go to `apps/hello_node/`, run `npm link @croquet/croquet`, then `npm start <session-name> <password>`, check it logs the right version number and is in the same session as the web version
* if successful, `git push` (in case you haven't yet)
* deploy to npm (for a pre-release use --tag $dev)

## Release a.b.c

* update README with major changes
* make sure `types.d.ts` reflects changed API (see [CHANGE_LOG.md](./CHANGE_LOG.md))
* make sure JSDoc comments reflect changed API (`teatime/index.js`, `teatime/src/{model|view|session}.js`)
* publish new docs
* deploy release
  - follow pre-release steps above but with release version number
* deploy npm
  - ... to be written ...
