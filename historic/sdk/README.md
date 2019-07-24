
# What is Croquet?

_Croquet_ is a synchronization system for multiuser digital experiences. It allows multiple users to work or play together within a single shared distributed environment, and it guarantees that this distributed environment will remain bit-identical for every user.

This synchronization is largely invisible to the developer. Creating a _Croquet_ application does not require the developer to write separate client and server code, or deploy a server. Applications are developed as though they are local, single-user experiences, and the _Croquet_ library takes care of the rest.

# Main Concepts

Every _Croquet_ application consists of two parts:

- The **view** handles user input and output. It processes all keyboard / mouse / touch events, and determines what is displayed on the screen.

- The **model** handles all calculation and simulation. This is where the actual work of the application takes place. The model is also where save / load happens.

**The model is guaranteed to always be identical for all users.** However, the view is not. Different users might be running on different hardware platforms, or might display different representations of the model.

When you launch a _Croquet_ application, you automatically join a shared **session**. As long as you're in the session, your model will be identical to the models of every other user in the session.

To maintain this synchornization, the model and the view communicate through **events**. When you publish an event from the view, it's mirrored to everyone else in your session, so every model receives exactly the same event stream.

This mirroring is handled by **reflectors**. Reflectors are stateless, public message-passing services located in the cloud.

**Snapshots** are archived copies of a model. _Croquet_ apps periodically take snapshots and save them to the cloud. When you join an existing session, you synch with the other users by loading one of these snapshots.

# Creating a _Croquet_ App

To create a new a _Croquet_ app, you simply define your own model and view. These classes inherit from the base classes {@link Model} and {@link View} in the `croquet.js` library. The view contains all your input and output code, and the model  contains all your simulation code.

```
class MyModel extends Croquet.Model {
    init() {
        ...
    }
}
MyModel.register();

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

You then join a session by calling {@link startSession} from the `croquet.js` and passing it the name of your app, and your model and view classes. `startSession` automatically connects to a nearby reflector, synchronizes your model with the models of any other users already in the same session, and starts executing.

```
Croquet.startSession("myAppName", MyModel, MyView);
```
That it. You don't need to worry about setting up a server, or writing special synchronization code. _Croquet_ handles all of that invisibly, allowing you to concentrate on what your app _does_.

# Models

_Croquet_ models are a little different from normal JavaScript classes. For one thing, instead of having a constructor, they have an `init()` method. `init()` only executes the _very first time_ the model is instantiated within a brand new session. If you join a session that's already in progress, your model will be initialized from a snapshot instead.

```
class MyModel extends Croquet.Model {
    init() {
        ...
    }
}
MyModel.register();
```

Also, every _Croquet_ model needs to have its static `register()` method called after it is defined. This registers the model with _Croquet's_ internal class database so it can be properly stored and retrieved when a snapshot is created.

# Views

When `startSession()` creates the local model and view, it passes the view a pointer to the model. This way the view can initialize itself to reflect whatever state the model may currently be in. Remember that when you join a session, your model might be initalized by running its `init()` method, or it might be initialized by loading an existing snapshot. Having direct access to the model allows the view to configure itself properly no matter how the model was initialized.
```
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
This illustrates an important feature of _Croquet_: **The view can read directly from the model at any time.** The view doesn't need to receive an event from the model to update itself. It can just pull whatever data it needs directly from the model whenever it wants.  (Of course, the view shouldn't _write_ directly to the model, because that would break synchronization.)

The view's `update()` method is called every time the application window requests an animation frame (usually 60 times a second). This allows the view to continually refresh itself even if the model is updating more slowly. `update()` receives the local system time at the start of the frame as its argument.

# Events

Even though the view can read directly from the model, the primary way the model and the view communicate is through events.

To send an event, call `publish()`in either the model or the view:
```
publish(scope, event, data)
```
- _Scope_ is a namespace so you can use the same event in different contexts.
- _Event_ is the name of the event itself.
- _Data_ is an optional data object containing addtional information.

And to receive an event, call `subscribe()`:

```
subscribe(scope, event, this.handler)
```
- _Scope_ is a namespace so you can use the same event in different contexts.
- _Event_ is the name of the event itself.
- _Handler_ is the method that will be called when the event is published. (The handler accepts the data object as an argument.)

Events can be used to communicate between any two parts of your _Croquet_ app. However, events sent from view to model are handled differently:

**When you send an event from the view to the model, it is mirrored by the reflector and sent to every instance of the model in your current session.**

By mirroring view-to-model events through the reflector, _Croquet_ insures that all instances of the model stay in synch. All instances of the model receive exactly the same stream of events in exactly the same order.

There are also two special events that are generated by the reflector itself: `view-join` and `view-exit`. These are broadcast whenever a user joins or leaves a session.

# Time

The model has no concept of real-world time. All it knows about is **simulation time**.

Every event that passes through the reflector is timestamped. The current simulation time in the model is simply the timestamp of the last event it received. This allows different instances of the model to stay in synch even if their local real-world clocks diverge.

Calling `this.now()` will return the current simulation time.

In addition to normal events, the reflector also sends out a regular stream of **heartbeat ticks**. Heartbeat ticks advance the model's simulation time even if the view isn't sending any events. By default the reflector sends out heartbeat ticks 20 times a second, but you can change the frequency at session start.

The method `this.future()` can be used to schedule an event in the future. For example, if you wanted to create a tick routine in the model that executes every 100 milliseconds, it would look like this:

```
myTick() {
    // ... do some stuff ...
    this.future(100).myTick();
}
```


# Snapshots

Snapshots are copies of the model that are saved to the cloud. When your _Croquet_ application is running, the reflector will periodically tell it to perform a snapshot.

Snapshots are used to synchronize other users when they join a session that's already in progress. But they also provide automatic save functionality. If you quit or reload while your application is running, it will automatically reload the last snapshot when the application restarts.

_Note: The snapshot code is currently unoptimized, so you may experience a performance hitch when the snapshot is taken. The Croquet team is working to resolve this issue and make snapshots invisible to both user and developer, but for the time being your application may occasionally pause if your model is very large._

# Random

Croquet guarantees that the same sequence of random numbers is generated in every instance of the model. If you call `Math.random()` within the model it will return the same number for all instances.

Calls to `Math.random()` within the view will behave normally. Different instances will receive different random numbers.


# Changelog

| date       | item
|------------|---
| 2019-07-24 | **release 0.1.7** (bug fixes)
| 2019-07-23 | new US east coast reflector available in [startSession]{@link startSession}
| 2019-07-18 | **release 0.1.6** (bug fixes; documentation updates;<br/>inactive clients will now be disconnected after 10 seconds)
| 2019-07-10 | **release 0.1.5** (bug fixes)
| 2019-07-09 | **release 0.1.4** (bug fixes)
| 2019-07-09 | tutorial fleshed out: {@tutorial 1_5_3d_animation}
| 2019-07-06 | new tutorial: {@tutorial 1_4_view_smoothing}
| 2019-07-01 | **release 0.1.3** (bug fixes; add 5-letter moniker to session badge)
| 2019-06-29 | **release 0.1.2** (bug fixes)
| 2019-06-28 | **release 0.1.1** (bug fixes)
| 2019-06-27 | docs: [View.subscribe]{@link View#subscribe}, [startSession]{@link startSession}
| 2019-06-26 | **release 0.1.0**

Copyright © 2019 Croquet Studios

_THE CROQUET SDK IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE._
