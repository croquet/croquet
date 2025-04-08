# Croquet

*Croquet lets you build real-time multiuser apps without writing server-side code. Unlike traditional client/server architectures, the multiplayer code is executed on each client in a synchronized virtual machine, rather than on a server. Croquet is available as a JavaScript library that synchronizes Croquet apps using Multisynq's global DePIN network.*

* can be hosted as a **static website**
* **no server-side** code needed
* **no networking** code needed
* independent of UI framework

## Getting Started

Get a free API key from [multisynq.io](https://multisynq.io/coder)
_(you can run your own server too but by default the client uses the global Multisynq network)._

    npm i @croquet/croquet

You can also use the Croquet pre-bundled files, e.g. via a script tag

    <script src="https://cdn.jsdelivr.net/npm/@croquet/croquet@2.0.0/pub/croquet.min.js"></script>

or via direct import as a module

    import * as Croquet from "https://cdn.jsdelivr.net/npm/@croquet/croquet@2.0.0/pub/croquet.esm.js";

Structure your app into a synchronized part (subclassed from `Croquet.Model`) and a local part interacting with it (subclassed from `Croquet.View`). Uses `Croquet.Session.join()` with your API key to join a session.

That's it. No deployment of anything except your HTML+JS.

Follow the documentation at [multisynq.io/docs](https://multisynq.io/docs) and the example apps in the [Croquet GitHub repo](http://github.com/croquet/croquet).

## The Prime Directive

*Your Croquet Model must be completely self-contained.*

The model must only interact with the outside world via subscriptions to user input events that are published by a view. Everything else needs to be 100% deterministic. The model must not read any state from global variables, and the view must not modify model state directly (although it is allowed to read from it).

Besides being deterministic, the model must be serializable – it needs to store state in an object-oriented style. That means in particular that the model cannot store functions, which JavaScript does not allow to be introspected for serialization. That also means you cannot use async code in the model. On the view side outside the model you're free to use any style of programming you want.

## Servers and networking

By default Croquet runs on the [Multisynq DePIN network](https://multisynq.io) which automatically selects a server close to the first connecting user in a session. Alternatively, you can [run your own reflector](https://github.com/croquet/croquet/tree/main/packages/reflector), but be aware you won't get the benefits of a global deployment then.

All application code and data is only processed on the clients. All network communication and external data storage is end-to-end encrypted by the random session password – since the server does not process application data there is no need for it to be decrypted on the server. This makes Croquet one of the most private real-time multiplayer solutions available.

## Change Log

These are user-facing changes adhering to the [keep-a-changelog](https://keepachangelog.com/) format. For detailed internal changes see [CHANGELOG](./CHANGELOG.md).

### [2.0] - 2025-04-08

This is the first release licensed under Apache-2.0.

#### Added

- Support for Multisynq DePIN network (API key at [multisynq.io](https://multisynq.io/coder))
- add static `Model.isExecuting()` check
- add `Model.createQFunc()` to allow functions in snapshots
- add generic subscriptions (scope and/or event are `"*"`)
- add `activeSubscription()` to access scope, event, and source of currently executing event
- support snapshotting of static properties
- add `App.randomSession()` and `App.randomPassword()`
- `Session.join()` now supports `viewData` property that will be passed to `view-join` event

### [1.1] - 2024-03-20

#### Added

- `BigInt` snapshotting support
- `Model.cancelFuture()` allows to stop future message evaluation
- `Model.evaluate()` to evaluate some code with Model semantics (e.g. to initialize constants)
- `View.session` makes the session object returned from `Session.join()` available to views
- `Session.join()` now supports a `viewOptions` property
- `Model.unsubscribe()` and `View.unsubscribe()` can take a `handler` argument
- `"write"` debug flag detects accidental writes into model state
- `"offline"` debug flag lets you run without a network connection (single-user)
handler arg,
- Node.js support for running a client on Node

#### Fixed

- fixed snapshotting of shared buffers in Typed Arrays
- fixed deserialization of circular Set and Map refs


### [1.0] - 2021-08-23                                                                             |

Public release