Copyright © 2019 Croquet Studios

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