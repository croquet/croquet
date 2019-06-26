Copyright © 2019 Croquet Studios

Every _Croquet_ application consists of two parts:

- The **view** handles user input and output.
  It processes all keyboard / mouse / touch events, and determines what is displayed on the screen.

- The **model** handles all calculation and simulation. This is where the actual work of the application takes place. The model is also where save / load happens.

**The state of the model is guaranteed to always be identical for all users.** However, the state of the view is not. Different users might be running on different hardware platforms, or might display different representations of the simulation.

Internal communications between the model and view are handled through **events**. Whenever an object publishes an event, all objects that have subscribed to that event will execute a handler function.

When a _Croquet_ application starts up, it becomes part of a **session**. Other users running the same application with the same session ID will also join the same session. The state of the model on every machine in the session will be identical.

The routing of application events is handled by the **controller**. If the controller determines that some event from a view is being routed to a model, the model isn't sent the event directly. Instead the controller bounces the event off a reflector.

**Reflectors** are stateless, public, message-passing services located in the cloud. When a reflector receives an event from a user, it mirrors it to all the other users in the same session.

**Snapshots** are archived copies of a model's state. Machines periodically take snapshots of the model state and save it to the cloud. When a new user joins a session, it can synch with the other users by loading one of these snapshots.

- Input/output is routed through the view.
- The view can read from the model, but can't write to it.
- Messages from view to model are reflected to all users.
- Model state can be saved to (and loaded from) snapshots.
