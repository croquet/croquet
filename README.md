# Croquet 🦩

*Croquet lets you build real-time multiuser apps without writing server-side code. Unlike traditional client/server architectures, the multiplayer code is executed on each client in a synchronized virtual machine, rather than on a server.*

Croquet is available as a JavaScript library that synchronizes Croquet apps using Multisynq's global DePIN network. Additionally, the reflector server keeping VMs in sync is available as a node.js package.

## License

Croquet is licensed under [Apache-2.0](LICENSE.txt).

## Repo Layout

* `apps`: various examples and tests

* `docs`: JSDoc sources

* `packages`:
    * `croquet`: the client-side package
    * `reflector`: the node.js server package

* `server`:
    * `croquet-in-a-box`: via Docker Compose, an all-in-one server for local development, bundling
        * a reflector
        * a web server
        * and a file server
