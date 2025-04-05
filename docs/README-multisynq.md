Multisynq is a software system for creating multiuser digital experiences on the web. It lets you build real-time multiuser apps without writing a single line of server code, or deploying or managing any servers. As a developer you use the “Croquet” JavaScript library to synchronize Multisynq apps via the globally-deployed Multysynq Synchronizers, which provide seamless cross-platform real-time interactivity to any user with a network connection and a web browser.

While Multisynq itself is independent of any specific UI framework, we provide our own frameworks that build on top of the Croquet library (see [here](..)).


Scroll down for an **overview** of Multisynq, and the [**Changelog**](#changelog).

Use the Navigation Panel to try our **Tutorials and guides** and **API docs**.

Please review our [**Code of Conduct**](../../conduct.html) and
**join** our [**Developer Discord** <img alt="Discord" style="height: 1.5em" src="images/discord.png"/>](https://multisynq.io/discord/)

* [Quickstart](#quickstart)
* [What is Multisynq?](#what-is-multisynq%3F)
* [Main Concepts](#main-concepts)
* [Creating a Multisynq App](#creating-a-multisynq-app)
* [Models](#models)
* [Views](#views)
* [Events](#events)
* [Time](#time)
* [Snapshots](#snapshots)
* [Random](#random)
* [Technical FAQ](#technical-faq)
* [Changelog](#changelog)

# Quickstart

**_First, get a free API key from [multisynq.io/coder](https://multisynq.io/coder)_**

There are 3 main ways to getting started with Multisynq and the Croquet library:

1.  **CodePen:** play with our tutorials, click "Edit on CodePen", and develop your app there. To share it, change the view to full screen, and share the pen's url. Alternatively, click "Export" and choose "Export .zip" to download your app to your local computer for further editing and uploading to your own website.

2.  **Script Tag**: Add the following inside your page's `<head>` tag, replacing `@@CROQUET_VERSION@` with the version you want:

    ```HTML
    <meta charset="utf-8">
    <script src="https://cdn.jsdelivr.net/npm/@croquet/croquet@@CROQUET_VERSION@"></script>
    ```

    This will create the `Croquet` global to access `Croquet.Model` etc.

    See [jsdelivr.com](https://jsdelivr.com/) for ways to link to different versions or the latest version automatically. We recommend to link to a specific version in production.

3.  **NPM**: install the [`@croquet/croquet`](https://www.npmjs.com/package/@croquet/croquet) package:
    ```SH
    npm install @croquet/croquet
    ```

    Then import it in your JS file:
    ```JS
    import * as Croquet from "@croquet/croquet"
    ```

    Again, make sure to specify `charset="utf-8"` for your HTML or your script tags.

# What is Multisynq?

Multisynq is a synchronization system for multiuser digital experiences. It allows multiple users to work or play together within a single shared distributed environment, and it guarantees that this distributed environment will remain bit-identical for every user.

This synchronization is largely invisible to the developer. *Creating a Multisynq application does not require the developer to write any server-side or networking code.* Applications are structured into a shared and a local part, but both parts are executed locally and developed using only client-side tools. The Croquet library takes care of the rest.

# Main Concepts

Every Multisynq application consists of two parts:

* The **views** handle user input and output. They process all keyboard / mouse / touch events, and determine what is displayed on the screen.

* The **models** handle all calculation and simulation. This is where the actual work of the application takes place. The models are saved, shared, and loaded automatically.

**Models are guaranteed to always be identical for all users.** However, the views are not. Different users might be running on different hardware platforms, or might display different representations of the models.

When you launch a Multisynq application, you automatically join a shared **session**. As long as you're in the session, your models will be identical to the models of every other user in the session.

To maintain this synchronization, models for all users execute in lockstep based on a shared  session **time**.

The views interact with the models through **events**. When you publish an event from a view, it's mirrored to everyone else in your session, so everyone's models receive exactly the same event stream.

## Behind the scenes

Internally, the shared time and event mirroring is handled by a network connection to **synchronizers**. Synchronizers are stateless, public message-passing services organized as a [DePIN](https://en.wikipedia.org/wiki/Decentralized_physical_infrastructure_network).

**Snapshots** are archived copies of all models in a session. Multisynq apps periodically take snapshots and save them to the file servers. When you join an existing session, you sync with the other users by loading one of these snapshots.

Your **API Key** gives your app access to Multisynq's synchronizers, as well as to Multisynq's file servers for storing snapshots.

# Creating a Multisynq App

To create a new a Multisynq app, you define your own models and views. These classes inherit from the base classes {@link Model} and {@link View} in the Croquet library.

A simple app often only has one model and one view. In that case, the view contains all your input and output code, and the model contains all your simulation code.

```JS
class MyModel extends Croquet.Model {
    init() {
        ...
    }
}
MyModel.register("MyModel");

class MyView extends Croquet.View {
    constructor(model) {
        super(model);
        ...
    }

    update(time) {
        ...
    }
}
```

You then join a session by calling [Session.join()]{@link Session.join} and passing it your model and view classes. `Session.join` automatically connects to a nearby synchronizer, synchronizes your model with the models of any other users already in the same session, and starts executing.

You do need to provide some session meta data, like your API key, an appId, session name, and a password. Below we use `autoSession`/`autoPassword` but you can instead use whatever makes most sense for your app. In the tutorials we even often use constants for all, but you should not do that in production.

```JS
const apiKey = "your_api_key"; // paste from multisynq.io/coder
const appId = "com.example.myapp";
const name = Croquet.App.autoSession();
const password = Croquet.App.autoPassword();
Croquet.Session.join({apiKey, appId, name, password, model: MyModel, view: MyView});
```

That's it. You don't need to worry about setting up a server, or writing special synchronization code. Multisynq handles all of that invisibly, allowing you to concentrate on what your app _does_.

# Models

Croquet models are a little different from normal JavaScript classes. For one thing, instead of having a constructor, they have an [init()]{@link Model#init} method. `init` only executes the _very first time_ the model is instantiated within a brand new session. If you join a session that's already in progress, your model will be initialized from a snapshot instead.

```JS
class MyModel extends Croquet.Model {
    init() {
        ...
    }
}
MyModel.register("MyModel");
```

Also, every Croquet model class needs to have its static [register()]{@link Model.register} method called after it is defined. This registers the model class with Croquet's internal class database so it can be properly stored and retrieved when a snapshot is created.

The root model of your app (the one named in `Session.join()`) is instantiated automatically. If your application uses multiple models, you instantiate them by calling [create()]{@link Model.create} instead of `new`.

See {@link Model} for the full class documentation.

# Views

When {@link Session.join} creates the local root model and root view, it passes the view a reference to the model. This way the view can initialize itself to reflect whatever state the model may currently be in. Remember that when you join a session, your model might have been initalized by running its `init()` method, or it might have been loaded from an existing snapshot. Having direct access to the model allows the view to configure itself properly no matter how the model was initialized.

```JS
class MyView extends Croquet.View {
    constructor(model) {
        super(model);
        ...
    }

    update(time) {
        ...
    }
}
```

This illustrates an important feature of Multisynq: **A view can read directly from a model at any time.** A view doesn't need to receive an event from a model to update itself. It can just pull whatever data it needs directly from the model whenever it wants. (Of course, a view must never _write_ directly to a model, because that would break synchronization.)

The root view's [update()]{@link View#update} method is called automatically for every animation frame (usually 60 times a second). This allows the view to continually refresh itself, which is useful for continuous animation (as opposed to updating only when an event is received). Internally this uses a callback via the browser's `requestAnimationFrame` function, and the callback timestamp is passed as `update(timestamp)`.

If your app uses hierarchical views, your root view's `update` method needs to call all other views' `update`.

See {@link View} for the full class documentation.

# Events

Even though views can read directly from models, the only way for a view to interact with a model is through events.

To send an event, call `publish()`:

    this.publish(scope, event, data)

* _Scope_ is a namespace so you can use the same event in different contexts.
* _Event_ is the name of the event itself.
* _Data_ is an optional data object containing addtional information.

And to receive an event, call `subscribe()`:

    this.subscribe(scope, event, this.handler)

* _Scope_ is a namespace so you can use the same event in different contexts.
* _Event_ is the name of the event itself.
* _Handler_ is the method that will be called when the event is published. (The handler accepts the data object as an argument.)

An event is routed automatically based on who publishes and who subscribes to it:

**_Input events_ ([published]{@link View#publish} by a view and [handled]{@link Model#subscribe} by a model) are sent to every replica of the model in your current session.**

By sending view-to-model events to each participant, Multisynq ensures that all replicas of the model stay in sync. All replicas of the model receive exactly the same stream of events in exactly the same order.

**_Output events_ ([published]{@link Model#publish} by a model and [handled]{@link View#subscribe} by a view) are generated by each replica simultaneously and do not require a network roundtrip. Typically they are queued and handled before each frame is rendered.**

This is to ensure a strict separation between model code execution and view code execution. The model code must be executed precisely the same for every user to stay in sync, no matter if there are views subscribed on that user's machine or not. All event handlers are executed before invoking `update()`.

**_Model events_ ([published]{@link Model#publish} by a model and [handled]{@link Model#subscribe} by a model) are generated and handled by each replica locally. They are not sent via the network. Event handlers are invoked synchronously during publish.**

This allows you to use pub/sub inside of your model, if that makes sense for your app. It is equivalent to calling another model's method directly.

**_View events_ ([published]{@link View#publish} by a view and [handled]{@link View#subscribe} by a view) are also generated and handled locally. They are not sent via the network. Typically they are queued and handled before each frame is rendered.**

Again, this allows you to use pub/sub inside your view. It is *not* a way to communicate between different clients, for that, both clients need to communicate with the shared model.

Both models and views can subscribe to the same event. This can be used to implement immediate user feedback: the local view can update itself by listening to the same input event it is sending via the synchronizer to the model, anticipating what will happen once the event comes back from the synchronizer. Care has to be taken to handle the case that another event arrives in the mean time.

There are also two special events that are generated by the system itself: ["view-join"]{@link event:view-join} and ["view-exit"]{@link event:view-exit}. These are broadcast whenever a user joins or leaves a session.

# Time

Models have no concept of real-world time. All they know about is **simulation time**, which is governed by the synchronizer.

Every event that passes through the synchronizer is timestamped. The simulation time in the model is advanced up to the last event it received. This allows different replicas of the model to stay in sync even if their local real-world clocks diverge.

Calling [this.now()]{@link Model#now} will return the current simulation time.

In addition to normal events, the synchronizer also sends out a regular stream of **heartbeat ticks**. Heartbeat ticks advance the model's simulation time even if no view is sending any events. By default the synchronizer sends out heartbeat ticks 20 times a second, but you can change the frequency at session start.

The method [future()]{@link Model#future} can be used to schedule an event in the future. For example, if you wanted to create an animation routine in a model that executes every 100 milliseconds of simulation time, it would look like this:

```JS
step() {
    // ... do some stuff ...
    this.future(100).step();
}
```

Note that the ticks-per-second rate of the synchronizer is independent of the future interval used by your models. Individual models may use different future times.

# Snapshots

Snapshots are copies of the model that are encrypted and saved to public file servers. When your Multisynq application is running, it will periodically upload a snapshot.

Snapshots are used to synchronize other users when they join a session that's already in progress. They also provide automatic save functionality. If you quit or reload while your application is running, it will automatically reload the last snapshot when the application restarts. _However_, snapshots are only valid until you update the application code.

Automatic snapshotting is the reason your model state needs to be stored as object properties, as opposed to a more functional style. All the properties of your model objects are serialized automatically (except those whose names start with a dollar sign like `this.$foo`). JavaScript can not serialize functions, and does not provide access to closure variables, so these cannot be used to hold model state (see {@link Model.types} for what types are supported out-of-the-box by the Multisynq snapshot mechanism, and how to add support for custom types). The view code has no such restrictions, you can use any style you like, object-oriented or not.

# Random

Multisynq guarantees that the same sequence of random numbers is generated in every replica of your application. If you call `Math.random()` within a model it will return the same number for all replicas.

Calls to `Math.random()` within a view will behave normally. Different instances will receive different random numbers.


# Changelog

| date       | item                                                                                                    |
| ---------- |-------------------------------------------------------------------------------------------------------- |
| 2024-03-20 | **release 1.1.0** (bug fixes, optimizations, Node.js support, `BigInt` support, added [Model.cancelFuture]{@Link Model#cancelFuture}, [Model.evaluate]{@link Model.evaluate}, [View.session]{@link View#session}, `debug=write,offline` and `viewOptions` for [Session.join]{@link Session.join}, also [Model.unsubscribe]{@link Model#unsubscribe} and [View.unsubscribe]{@link View#unsubscribe} can take a handler arg, new tutorial: {@tutorial 1_6_multiblaster}) |
| 2021-08-23 | **release 1.0** |

Copyright © 2024 Croquet Labs

_THE CROQUET CLIENT LIBRARY IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE._
