# Croquet 🦩
[![NPM Version](https://img.shields.io/npm/v/%40croquet%2Fcroquet)](http://npmjs.com/package/@croquet/croquet)
[![NPM Dev](https://img.shields.io/npm/v/%40croquet%2Fcroquet/dev?color=%23C33)](https://www.npmjs.com/package/@croquet/croquet?activeTab=versions)

*Croquet lets you build real-time multiuser apps without writing server-side code. Unlike traditional client/server architectures, the multiplayer code is executed on each client in a synchronized virtual machine, rather than on a server.*

Croquet is available as a JavaScript library that synchronizes Croquet apps using Multisynq's global DePIN network. Additionally, the reflector server keeping VMs in sync is available as a node.js package.

## License

Croquet is licensed under [Apache-2.0](LICENSE.txt).

## Testing

Some of the examples in `apps/` require to build a local version of Croquet, which you can do by

    cd packages/croquet
    ./build.sh

Then the apps should work directly from their source in `apps/`.

Alternatively, run `build.sh` in this root folder, which will both build the Croquet library and build the `apps/` into a `_site/` folder. This also gets run via a GitHub action  which creates the GitHub Pages site.

The examples in `apps/` use a place holder Multisynq API key that is only valid for testing on the local network and the Croquet GitHub Pages site. You can get your own key on the [Multisynq](https://multisynq.io/coder) website. Alternatively, check out Croquet-in-a-Box below.

## Repo Layout

* `apps`: various examples and tests

* `docs`: JSDoc sources

* `packages`:
    * `croquet`: the client-side package
    * `reflector`: the node.js server package

* `server`:
    * `croquet-in-a-box`: via Docker Compose, an all-in-one server for local development, containing
        * a reflector
        * a web server
        * and a file server
