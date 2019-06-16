## Overview

_Croquet_ is a synchronization system for multiuser digital experiences. It allows multiple users to work or play together within a single shared distributed environment, and it guarantees that this distributed environment will remain bit-identical for every user.

This synchronization is largely invisible to the developer. Creating a _Croquet_ application does not require the programmer to write separate client and server code. Applications are developed as though they are local, single-user experiences, and the _Croquet_ library takes care of the rest.



## **Primary** Concepts

Every _Croquet_ application consists of two parts:

- The **view** handles user input and output. It processes all keyboard / mouse / touch events, and determines what is displayed on the screen.

- The **model** handles all calculation and simulation. This is where the actual work of the application takes place. The model is also where save / load happens.

**The state of the model is guaranteed to always be identical across all clients.** However, the state of the view is not. Different users might be running on different hardware platforms, or might display different representations of the simulation.



Internal communications between objects in the model and view are handled through **events**. Whenever an object publishes an event, all objects that have subscribed to that event will execute a callback function.

When a Croquet application starts up, it becomes part of a **session**. Other clients running the same application will also join the same session. The state of the model in every client in the session will be identical.

The routing of application events is handled by the **controller**. If the controller determines that an event is being sent from view to model, it isn't sent directly. Instead the controller bounces the event off a reflector.

**Reflectors** are stateless, public, message-passing services located in the cloud. When a reflector receives an event from a client, it mirrors it to all the other clients in the same session.

**Snapshots** are archived copies of a model's state. Clients periodically take snapshots if their state and save it to the cloud. When a new client joins a session, it can synch with the other clients by loading one of these snapshots.

- Input/output is routed through the view.
- The view can read from the model, but can't write to it.
- Messages from view to model are reflected to all clients.
- Model state can be saved to (and loaded from) snapshots.



## Writing a _Croquet_ Application

To create a Croquet application, you need to define two classes that inherit from the base classes Model and View from the Croquet.js library:

class MyModel extends Croquet.Model {

        init() {

}

}

MyModel.register();

class MyView extends Croquet.View {

        constructor(model) {

                super(model);

        }

}

Your view will contain all your input and output code, and your model will contain all your simulation code.

(Note that every time you define a new model, you must register it so that Croquet knows it exists. This step can be automated if you're using a build manager such as Node. But if you're just writing plain Javascript, you'll need to do it yourself after you declare each model class.)

You launch as session by calling startSession from the Croquet.js library.  Its arguments are the name of the session you're creating, the class types of your model and your view, and a set of session options (described below).

const session = {user: 'GUEST', random: '1234567'};

Croquet.startSession(&quot;hello&quot;, MyModel, MyView, {step: &quot;auto&quot;, session});

Starting the session will do the following things:

1. Connect to a nearby public reflector
2. Instantiate the model

3a. Run the initialization code in the model's init routine -or-

3b. Initialize the model from a saved snapshot

1. Instantiate the view
2. Pass a pointer to the model to the view in its constructor
3. Create a main event loop and begin executing

The main loop runs each time the window performs an animation update – usually 60 times per second. On each iteration of the main loop, it will first process all pending events in the model, then process all pending events in the view.

The session options are the name of the user who's joining and a random id. The random id allows the same user to have a different application ID if they join from two different devices. If you don't supply the name of a user, Croquet will request one through its default login dialog when the application starts.

**Note that the code in your model's init routine only runs the first time the application launches.** If another user joins a session that's in progress, they will load the most recent snapshot of model state. The same is true if you quit a session and rejoin it later.



Advanced Topic: Creating Your Own Main Loop

If you want more control over your main loop, you can leave out the &quot;step: auto&quot; directive and write your main loop yourself. For example:

window.requestAnimationFrame(frame);

    function frame(now) {

        if (session.view) {

            session.view.myInputMethod();

            session.step(now);

            session.view.myOuputMethod ();

        }

        window.requestAnimationFrame(frame);

    }



## Writing a _Croquet_ View

The view operates like a normal JavaScript application. You can directly access the DOM and instantiate whatever sub-objects or data types that you need.

The contents of the view are not replicated across clients. Because of this, you generally use the view only for handling input and output. If the user taps a button or clicks somewhere on screen, the view turns this action into an event and sends it to the model. And whenever the model changes, the view updates the visual representation that it displays on the screen. But, in general all of the actual calculation of the application is should be done inside the model.

In order to update output quickly, the view has a pointer to the model and can read from it directly. However …

**The view must NEVER write directly to the model.**

This is the most important rule of creating a stable _Croquet_ application. The view is given direct access to the model for efficiency, but in order for the local copy of the model to stay in synch with the remote copies running in other clients, _all changes to the model that originate in the view must be done through events_. That way they will be mirrored by the reflector to every client in the session.

Other good practices for writing views:

**Create sub-views inside your main view.** You can derive other classes from the View base class and instantiate them during execution. Sub-views have access to all the same services as your main view, so they can schedule their own tick operations and publish and subscribe to events.

**Access the model through your main view.** Your main view receives a permanent pointer to the main model when it is created. This pointer can be stored and used to read directly from the model.

**Use the future operator to create ticks.** If you want something to happen regularly in the view, use the future operator to schedule a looping tick.

**Don't reply to the model.** Avoid having the model send an event to the view that requires the view to send a &quot;reply&quot; event back. This will result in large cascades of events that will choke off normal execution.

**Anticipate the model for highest performance.** Latency in _Croquet_ is low, but it's not zero. If want your application to be extremely responsive (for example, if the player is controlling a first-person avatar) drive the output directly from the input, then correct the output when you get the official simulation state from the updated model.

## Writing a Croquet Model

Unlike the view, there are limits to what the model can do if is going to stay synched across all the clients in the session:

**Models must be registered when defined.** Call MyModel.register() every time you define a new model.

**Use &quot;create&quot; and &quot;destroy&quot; to instantiate or dispose of models.** Do not use &quot;new&quot; to create sub-models. These models should be created/destroyed using the syntax mySubModel.create() and mySubModel.destroy(). Init()is called as part of the create() process.

**Use &quot;init&quot; to initialize models.** Do not use the class constructor. Model classes only call &quot;init&quot; when they are instantiated for the first time. Put all initialization code in this method. If you put initialization code in the constructor, it will also run when the model is reloaded from a snapshot.

**No global variables.** All variables in the model must be defined in the main model itself, or in sub-models instantiated by the main model. This way _Croquet_ can find them and save them to the snapshot.

**No regular classes.** All objects in the model must be derived from the Model base class. (Mostly. See below for more information.)

**No outside references.** The model must not use system services such as _date_, or reference JavaScript globals such as _window_.

**No asynchronous functions.** Do not declare a function call with the _async_ keyword inside the model.

**Do not store function pointers or transmit them in events.** Functions are not recognized as part of the model state. (It's fine to use function pointers that exist temporarily, such as in a ForEach call. You just shouldn't store them.)

**Don't query the view.** Don't publish events that trigger the view to respond to the model with another event. This can create a cascade of events that clogs the system.



Advanced Topic: Non-Model Objects in the Model

In general, every object in the model should be a subclass of Model. However, sometimes it's useful to be able to use the occasional non-model utility class inside your model code. This is allowed, as long as you provide Croquet with information about how to save and restore the non-model class.

Model classes that use non-model objects must include a special static method named Types that defines all of the non-model classes they use and how to serialize them:



class MyModel extends Croquet.Model {

                static types() {

                        return {

                            &quot;MyClass&quot;: {

                                        cls: MyClass,

                                        write: c =\&gt; ({x: c.x}),

                                        read: ({x}) =\&gt; new MyClass(x)

}

                    };

                }

}

This example shows a type definition for a non-model class that stores a single piece of data, the variable x. It includes methods to extract the class data into a standard data format, and then restore a new version of the class from the stored data.

## Simulation Time

The model has no concept of real-world time. All it knows about is _simulation time_.

Simulation time is the time in milliseconds since a session began. Any model can get the current simulation time by calling myModel.now().

While a session is active, the reflector will send a steady stream of heartbeat ticks to every connected client. Simulation time only advances when a client receives a heartbeat tick.

What this means is that if you make a rapid series of calls to myModel.now(), it will always return the same value. It will not return a different value until the client has had the opportunity to receive and process the next heartbeat tick.

If you want to schedule a process to run in the future, don't poll myModel.now(), instead use myModel.future(delay). For example:

tick() {

// Do some stuff

        this.future(delay).tick();

}

This creates a routine that will execute every time a fixed number of milliseconds have elapsed. If your simulation needs to update continuously, you will want to set up a tick routine in your model. Call tick the first time at the end of the model's init() code, and then it schedule itself to be called again each time it runs.

The delay value passed to future does not need to be a whole number.  For example, if you want something to tick 60 times a second, you could pass it the value 1000/60.

Note that individual sub-models can have their own tick routines, so different parts of your simulation can tick at different rates. Models can even have multiple ticks active at the same time. For example, you could have a model that updates its position 60 times a second, and check for collisions 20 times a second.

Future can also be used for things besides ticks. It's a general-purpose scheduling tool. For example, if you wanted a sub-model to destroy itself half a second in the future, you could call:

this.future(500).destroy();

(Views can also use future but they operate on normal system time.)



## Events

Both models and views use the same syntax for sending and receiving events. These functions are only available to classes that are derived from Model or View, so exposing them is one reason to define sub-models and sub-views.

publish(scope,event,data)

subscribe(scope,event,callback)

unsubscribe(scope,event)

unsubscribeAll()

**Publish** sends an event to all models and views that have subscribed to it.

- _Scope_ is a namespace so you can use the same event in different contexts.
- _Event_ is the name of the event itself.
- _Data_ is an optional data structure containing additional information.

**Subscribe** registers a model or a view to receive the specified events.

- _Callback_ is a function that accepts the event data structure as its argument.

**Unsubscribe** unregisters the model or view so it will no longer received the event.

**UnsubscribeAll** unregisters all current subscriptions. Called automatically when you destroy a model or a view.

Depending on where the event originates and where it is sent, the controller handles it differently:

- _View-to-View / Model-to-Model_ - The event callback is executed immediately.

- _Model-to-View_ - The event is queued and will be executed by the local view when the current model simulation has finished.

- _View-to-Model_ - The event is transmitted to the reflector and mirrored to all clients. It will be executed during the next model simulation.

Note that multiple models and views all can subscribe to the same event. The controller will take care of routing a copy of the event to each subscriber using the appropriate route.

Publish and subscribe can be used to establish a direct communications channel between different parts of the model and the view. For example, suppose you have several hundred AI agents that are running independently in the model, and each one has a graphical representation in the view. If you call publish and subscribe using the actor's name as the scope, an event from a particular actor will only be delivered to its corresponding representation and vice versa.

Avoid creating chains of events that run from the model to the view then back to the model. View events can be triggered by the user, or by a timer, or by some other external source, but they should never be triggered by the model. Doing so can trigger a large cascade of events that will choke the system.

## Snapshots

Snapshots are copies of the model state that are saved to the cloud. When your _Croquet_ application is running, the reflector will periodically request one of the clients to perform a snapshot.

Snapshots provide automatic save functionality for your application. If you quit or reload while your application is running, it will automatically reload the last snapshot when the application restarts.

(When you write your initialization routine for your View, take into account that the Model may just have reloaded from a prior snapshot.)

More importantly, snapshots are how new clients synchronize when they join an existing session. When you join an existing session the following series of events will occur:

1. The local model is initialized with data from the last snapshot.
2. The local view starts executing
3. The reflector resends the local model all events and heartbeats that were transmitted after the last snapshot was taken.

The combination of loading the last snapshot and replaying all the intervening events and heartbeats brings the new client in sync with the other clients in the session.

#### Snapshot Performance

The snapshot code is currently unoptimized, so you may experience a performance hitch when the snapshot is taken. The Croquet development team is working to resolve this issue and make snapshots invisible to both the user and developer, but for the time being you may see your application occasionally pause if your model is very large.





## Random Numbers

Croquet guarantees that the same sequence of random numbers is generated within the model on each client.
If you call `Math.random()` within the model it will return the same number on all clients.

Calls to `Math.random()` within the view will behave normally. Different clients will receive different random numbers.
