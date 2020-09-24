Copyright © 2019 Croquet Corporation

To create a _Croquet_ application, you need to define two classes that inherit from the base classes {@link Model} and {@link View} from the `croquet.js` library:

```
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
}
```

Your view will contain all your input and output code, and your model will contain all your simulation code.

(Note that every time you define a new model subclass, you must `register("name")` it so that _Croquet_ knows it exists, and under which name to find its instances in a snapshot.)

## Launching a session

You launch a session by calling {@link Session.join} from the `croquet.js` library.  Its arguments are the name of the session you're creating, the class types of your model and your view, and a set of session options (described below).

```
Croquet.Session.join("hello", MyModel, MyView);
```

Starting the session will do the following things:

1. Connect to a nearby public reflector
2. Instantiate the model
3. a) Run the initialization code in the model's init routine -or-<br>
   b) Initialize the model from a saved snapshot
4. Instantiate the view, passing the view constructor a reference to the model
5. Create a main event loop and begin executing

The main loop runs each time the window performs an animation update — commonly, 60 times per second. On each iteration of the main loop, it will first process all pending events in the model, then process all pending events in the view, then call {@link View#render}.

**Note that the code in your model's `init()` routine only runs the first time the application launches.** If another user joins a session that's in progress, they will load the most recent snapshot of model state. The same is true if you quit a session and rejoin it later.

**TODO:** mention how session ids are derived from code hashes and url session slugs

## Advanced Topic: Creating Your Own Main Loop

If you want more control over your main loop, you can pass out the `step: "manual"` directive and write a main loop yourself. For example:

```
const session = await Croquet.Session.join("hello", MyModel, MyView, {step: "manual"});
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
