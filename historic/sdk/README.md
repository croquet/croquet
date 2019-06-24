
Copyright © 2019 Croquet Studios

_THE CROQUET SDK IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE._

# Overview

_Croquet_ is a synchronization system for multiuser digital experiences. It allows multiple users to work or play together within a single shared distributed environment, and it guarantees that this distributed environment will remain bit-identical for every user.

This synchronization using the _Teatime_ protocol is largely invisible to the developer. Creating a _Croquet_ application does not require the programmer to write separate client and server code. Applications are developed as though they are local, single-user experiences, and the _Croquet_ library takes care of the rest.


# **Primary** Concepts

Every _Croquet_ application consists of two parts:

- The **view** handles user input and output.
  It processes all keyboard / mouse / touch events, and determines what is displayed on the screen.

- The **model** handles all calculation and simulation. This is where the actual work of the application takes place. The model is also where save / load happens.

**The state of the model is guaranteed to always be identical across all clients.** However, the state of the view is not. Different users might be running on different hardware platforms, or might display different representations of the simulation.

Internal communications between the model and view are handled through **events**. Whenever an object publishes an event, all objects that have subscribed to that event will execute a handler function.

When a _Croquet_ application starts up, it becomes part of a **session**. Other clients running the same application with the same session ID will also join the same session. The state of the model in every client in the session will be identical.

The routing of application events is handled by the **controller**. If the controller determines that an event is being sent from view to model, it isn't sent directly. Instead the controller bounces the event off a reflector.

**Reflectors** are stateless, public, message-passing services located in the cloud. When a reflector receives an event from a client, it mirrors it to all the other clients in the same session.

**Snapshots** are archived copies of a model's state. Clients periodically take snapshots of their state and save it to the cloud. When a new client joins a session, it can synch with the other clients by loading one of these snapshots.

- Input/output is routed through the view.
- The view can read from the model, but can't write to it.
- Messages from view to model are reflected to all clients.
- Model state can be saved to (and loaded from) snapshots.


# Writing a _Croquet_ Application

To create a _Croquet_ application, you need to define two classes that inherit from the base classes {@link Model} and {@link View} from the `croquet.js` library:

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
}
```

Your view will contain all your input and output code, and your model will contain all your simulation code.

(Note that every time you define a new model subclass, you must `register()` it so that _Croquet_ knows it exists. This step can be automated if you're using a build manager such as parcel. But if you're just writing plain JS, you'll need to do it yourself after you declare each model class.)

## Launching a session

You launch a session by calling {@link startSession} from the `croquet.js` library.  Its arguments are the name of the session you're creating, the class types of your model and your view, and a set of session options (described below).

```
Croquet.startSession("hello", MyModel, MyView, {step: "auto"});
```

Starting the session will do the following things:

1. Connect to a nearby public reflector
2. Instantiate the model
3. a) Run the initialization code in the model's init routine -or-<br>
   b) Initialize the model from a saved snapshot
4. Instantiate the view
5. Pass a reference to the model to the view in its constructor
6. Create a main event loop and begin executing

The main loop runs each time the window performs an animation update—usually 60 times per second. On each iteration of the main loop, it will first process all pending events in the model, then process all pending events in the view, then call {@link View#render}.

**Note that the code in your model's `init()` routine only runs the first time the application launches.** If another user joins a session that's in progress, they will load the most recent snapshot of model state. The same is true if you quit a session and rejoin it later.

**TODO:** mention how session ids are derived from code hashes and url session slugs

## Advanced Topic: Creating Your Own Main Loop

If you want more control over your main loop, you can leave out the `step: "auto"` directive and write a main loop yourself. For example:

```
const session = await Croquet.startSession("hello", MyModel, MyView);
window.requestAnimationFrame(frame);

function frame(now) {
    if (session.view) {
        session.view.myInputMethod();
        session.step(now);
        session.view.myOutputMethod();
    }
    window.requestAnimationFrame(frame);
}
```


# Writing a _Croquet_ View

Croquet makes no assumptions about how you implement the view. It operates like a normal JS application. You can directly access the DOM and instantiate whatever sub-objects or data types that you need, use any libraries etc.

The contents of the view are not replicated across clients. Because of this, you generally use the view only for handling input and output. If the user taps a button or clicks somewhere on screen, the view turns this action into an event and sends it to the model. And whenever the model changes, the view updates the visual representation that it displays on the screen. But in general, all of the actual calculation of the application should be done inside the model.

In order to update output quickly, the view has a reference to the model and can _read_ from it directly. However …

## **The view must NEVER write directly to the model!**

This is the **most important** rule of creating a stable _Croquet_ application. The view is given direct access to the model for efficiency, but in order for the local copy of the model to stay in synch with the remote copies running in other clients, _all changes to the model that originate in the view must be done through **events**_. That way they will be mirrored by the reflector to every client in the session.

### Other good practices for writing views:

**Create sub-views inside your main view.** You can derive other classes from the {@link View} base class and instantiate them during execution. Sub-views have access to all the same services as your main view, so they can schedule their own tick operations and publish and subscribe to events.

**Access the model through your main view.** Your main view receives a permanent reference to the main model when it is created. This reference can be stored and used to read directly from the model.

**Use the `future()` operator to create ticks.** If you want something to happen regularly in the view, use the future operator to schedule a looping tick. This is just for readability, you're free to use `setTimeout` or `setInterval` etc. in view code.

**Don't reply to the model.** Avoid having the model send an event to the view that requires the view to send a "reply" event back. This will result in large cascades of events that will choke off normal execution.

**Anticipate the model for immediate feedback.** Latency in _Croquet_ is low, but it's not zero. If you want your application to feel extremely responsive (for example, if the player is controlling a first-person avatar) drive the output directly from the input, then correct the output when you get the official simulation state from the updated model.

# Writing a _Croquet_ Model

Unlike the view, there are limits to what the model can do if it is going to stay synched across all the clients in the session:

**Model classes must be registered when defined.** Call `MyModel.register()` every time you define a new {@link Model} subclass.

**Use `create` and `destroy` to instantiate or dispose of models.** Do not use `new` to create sub-models. These models should be created/destroyed using the syntax `mySubModel.create()` and `mySubModel.destroy()`. Your `init` is called as part of the `create()` process.

**Use `init` to initialize models.** Do not implement a constructor. Model classes only call `init` when they are instantiated for the first time. Put all initialization code in this method. If you put initialization code in the constructor, it would also run when the model is reloaded from a snapshot.

**No global variables.** All variables in the model must be defined in the main model itself, or in sub-models instantiated by the main model. This way _Croquet_ can find them and save them to the snapshot. Instead, use Croquet.Constants. Croquet.Constants is a properly synced variable and any variable it contains will also be synced.

```
const Q = Object.assign(Croquet.Constants, {
    BALL_NUM: 25,              // how many balls do we want?
    STEP_MS: 1000 / 30,       // bouncing ball speed in virtual pixels / step
    SPEED: 10                 // max speed on a dimension, in units/s
});
```

This lets you use write ```this.future(Q.STEP_MS).step();``` where the STEP_MS value is registered and replicated. Just using STEP_MS will probably work, but there is no guarantee that it will be replicated and cause an accidental desyncing of the system.

**No regular classes.** All objects in the model must be derived from the Model base class. (Mostly. See below for more information.)

**No outside references.** The model must not use system services such as _Date.now()_, or reference JS globals such as _window_.

**No asynchronous functions.** Do not use _Promises_ or declare a function call with the _async_ keyword inside the model.

**Do not store function references or transmit them in events.** Functions can not be serialized as part of the model state. (It's fine to use function references that exist temporarily, such as in a forEach call. You just shouldn't store them.)

**Don't query the view.** Don't publish events that trigger the view to respond to the model with another event. This can create a cascade of events that clogs the system.



## Advanced Topic: Non-Model Objects in the Model

In general, every object in the model should be a subclass of {@link Model}. However, sometimes it's useful to be able to use the occasional non-model utility class inside your model code. This is allowed, as long as you provide _Croquet_ with information about how to save and restore the non-model class.

Model classes that use non-model objects must include a special static method named `types()` that declares all of the non-model classes:

```
class MyModel extends Croquet.Model {
    static types() {
        return {
            "MyFile.MyClass": MyClass,
        }
    }
}
```

This would use the default serializer to serialize the internals of that class. If you need to customize the serialization, add `write()` and `read()` methods that convert to and from the classes the serializer can handle (which is JSON plus built-in types like `Map`, `Set`, `Uint8Array` etc.):

```
class MyModel extends Croquet.Model {
    static types() {
        return {
            "MyFile.MyClass": {
                cls: MyClass,
                write: c => ({x: c.x}),
                read: ({x}) => new MyClass(x)
            }
        }
    }
}
```

This example shows a type definition for a non-model class that stores a single piece of data, the variable x. It includes methods to extract the class data into a standard data format, and then restore a new version of the class from the stored data.

# Simulation Time and Future Sends

The model has no concept of real-world time. All it knows about is _simulation time_.

Simulation time is the time in milliseconds since a session began. Any model can get the current simulation time by calling `this.now()`.

While a session is active, the reflector will send a steady stream of heartbeat ticks to every connected client. Simulation time only advances when a client receives a heartbeat tick.

What this means is that if you make a rapid series of calls to `this.now()`, it will always return the same value. It will not return a different value until the client has had the opportunity to receive and process the next heartbeat tick.

If you want to schedule a process to run in the future, don't poll `this.now()`, instead use _future send_. For example:
```
myTick() {
    // ... do some stuff ...
    this.future(100).myTick();
}
```
This creates a routine that will execute `myTick` every time 100 milliseconds have elapsed. If your simulation needs to update continuously, you will want to set up a tick routine in your model. Call it once at the end of the model's `init()` code, and then it will schedule itself to be called again each time it runs.

The delay value passed to `future` does not need to be a whole number.  For example, if you want something to run 60 times a second, you could pass it the value `1000/60`.

Note that individual sub-models can have their own tick routines, so different parts of your simulation can run at different rates. Models can even have multiple future sends active at the same time. For example, you could have a model that updates its position 60 times a second, and check for collisions 20 times a second.

Future can also be used for things besides ticks. It's a general-purpose scheduling tool. For example, if you wanted a sub-model to destroy itself half a second in the future, you could call:
```
this.future(500).destroy();
```
(Views can also use `future` but they operate on normal system time.)


# Events

Models and Views communicate using events. They use the same syntax for sending and receiving events. These functions are only available to classes that are derived from {@link Model} or {@link View}, so exposing them is one reason to define sub-models and sub-views.

- `publish(scope, event, data)`
- `subscribe(scope, event, handler)`
- `unsubscribe(scope, event)`
- `unsubscribeAll()`

**Publish** sends an event to all models and views that have subscribed to it.

- _Scope_ is a namespace so you can use the same event in different contexts (String).
- _Event_ is the name of the event itself (String).
- _Data_ is an optional argument containing additional information (any serializable type).

**Subscribe** registers a model or a view to receive the specified events.

- _handler_ is a function that accepts the event data structure as its argument.
- in a view, the handler can be any function
- in a model, the handler *must* use the form `arg => this.someMethodName(arg)`.<br>
  That's because functions cannot be serialized so actually only `"someMethodName"` is extracted from the function and stored.

**Unsubscribe** unregisters the model or view so it will no longer receive the event.

**UnsubscribeAll** unregisters all current subscriptions. Called automatically when you `destroy` a model or a view.

## Scopes

_TODO: ... mention `model.id`, global scopes (`sessionId`, `clientId`) ..._

## Event Handling

Depending on where the event originates and where it is handled, the controller routes it differently:

- _View-to-View / Model-to-Model_ - The event handler is executed immediately.

- _Model-to-View_ - The event is queued and will be executed by the local view when the current model simulation has finished.

- _View-to-Model_ - The event is transmitted to the reflector and mirrored to all clients. It will be executed during the next model simulation.

Note that multiple models and views all can subscribe to the same event. The controller will take care of routing the event to each subscriber using the appropriate route.

## Best practices

Publish and subscribe can be used to establish a direct communications channel between different parts of the model and the view. For example, suppose you have several hundred AI agents that are running independently in the model, and each one has a graphical representation in the view. If you call publish and subscribe using the agent's id as the scope, an event from a particular actor will only be delivered to its corresponding representation and vice versa.

Avoid creating chains of events that run from the model to the view then back to the model. View events can be triggered by the user, or by a timer, or by some other external source, but they should never be triggered by the model. Doing so can trigger a large cascade of events that will choke the system.

# Snapshots

Snapshots are copies of the model state that are saved to the cloud. When your _Croquet_ application is running, the reflector will periodically request one of the clients to perform a snapshot.

Snapshots provide automatic save functionality for your application. If you quit or reload while your application is running, it will automatically reload the last snapshot when the application restarts.

(When you write your initialization routine for your View, take into account that the Model may just have reloaded from a prior snapshot.)

More importantly, snapshots are how new clients synchronize when they join an existing session. When you join an existing session, the following series of events will occur:

1. The local model is initialized with data from the last snapshot.
2. The reflector resends the local model all events that were transmitted after the last snapshot was taken.
3. The local view starts executing
4. The model simulates all the events to bring the snapshot up-to-date

The combination of loading the last snapshot and replaying all the intervening events brings the new client in sync with the other clients in the session.

## Snapshot Performance

The snapshot code is currently unoptimized, so you may experience a performance hitch when the snapshot is taken. The _Croquet_ development team is working to resolve this issue and make snapshots invisible to both the user and developer, but for the time being you may see your application occasionally pause if your model is very large.


# Random Numbers

Croquet guarantees that the same sequence of random numbers is generated within the model on each client.
If you call `Math.random()` within the model it will return the same number on all clients.

Calls to `Math.random()` within the view will behave normally. Different clients will receive different random numbers.


# Class Documentation

Use the navigation menu to jump to a class or search for a method.
